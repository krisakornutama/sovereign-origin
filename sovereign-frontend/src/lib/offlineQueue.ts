/**
 * Offline request queue
 * - ขณะออฟไลน์: request แบบ POST/PUT/PATCH/DELETE (same-origin) จะถูกเก็บเข้า
 *   IndexedDB แทนการ fail ทันที แล้วคืน Response 503 ให้โค้ดจัดการตามปกติ
 * - เมื่อกลับ online: flushQueue() ส่งคิวทั้งหมดอีกครั้ง (ลบออกเมื่อสำเร็จ)
 * - subscribeOfflineQueue() ใช้แสดง badge จำนวนที่ค้าง
 */

const DB_NAME = 'sovereign-offline';
const STORE = 'actions';

export interface QueuedAction {
  id?: number;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Blob | null;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function addAction(action: QueuedAction): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(action);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function removeAction(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function countQueued(): Promise<number> {
  try {
    return (await getAllActions()).length;
  } catch {
    return 0;
  }
}

/** รายการ action ที่ค้างอยู่ (เรียงเก่าไปใหม่) */
export async function listQueued(): Promise<QueuedAction[]> {
  try {
    return (await getAllActions()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

/** ลบ action ทีละรายการ (ไม่ sync) */
export async function removeQueued(id: number): Promise<void> {
  try {
    await removeAction(id);
    await notify();
  } catch {
    // ignore
  }
}

/** ส่ง action เฉพาะรายการเดียว — คืน true ถ้าสำเร็จ (2xx และลบจากคิวแล้ว) */
export async function flushAction(id: number): Promise<boolean> {
  if (!originalFetch) return false;
  const actions = await getAllActions();
  const action = actions.find((a) => a.id === id);
  if (!action) return false;
  try {
    const res = await originalFetch(action.url, {
      method: action.method,
      headers: action.headers,
      body: action.body ?? undefined,
    });
    if (res.ok && action.id != null) {
      await removeAction(action.id);
      await notify();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** ส่งเฉพาะรายการที่เลือก — คืนจำนวนที่สำเร็จ */
export async function flushSelected(ids: number[]): Promise<number> {
  let ok = 0;
  for (const id of ids) {
    if (await flushAction(id)) ok++;
  }
  return ok;
}

// ── pub/sub สำหรับ badge ──
type Listener = (count: number) => void;
const listeners = new Set<Listener>();

export function subscribeOfflineQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function notify() {
  const count = await countQueued();
  for (const fn of listeners) fn(count);
}

// ── header/body normalization ──
function normalizeHeaders(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else {
    Object.assign(out, headers);
  }
  return out;
}

function normalizeBody(body?: BodyInit | null): string | Blob | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body;
  if (body instanceof FormData) return body as unknown as Blob; // เก็บได้ผ่าน structured clone
  return null; // ReadableStream/ArrayBuffer → ไม่เก็บ (rare)
}

let originalFetch: typeof fetch | null = null;
let initialized = false;

/** ติดตั้ง interceptor ครั้งเดียว (เรียกจาก useOfflineSync) */
export function initOfflineQueue(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (
      (init?.method || (input instanceof Request ? input.method : 'GET')) || 'GET'
    ).toUpperCase();
    const sameOrigin =
      url.startsWith(window.location.origin) || url.startsWith('/') || url.startsWith('./');

    // ออฟไลน์ + เป็น action ที่เปลี่ยนสถานะ → เก็บเข้าคิว
    if (!navigator.onLine && sameOrigin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try {
        await addAction({
          url,
          method,
          headers: normalizeHeaders(init?.headers),
          body: normalizeBody(init?.body),
          queuedAt: new Date().toISOString(),
        });
        await notify();
        return new Response(JSON.stringify({ queued: true, error: 'Offline — request queued' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // เก็บคิวไม่สำเร็จ → ส่งต่อไปตามปกติ (จะ fail เอง)
      }
    }
    return (originalFetch as typeof fetch)(input, init);
  };

  // กลับ online → flush ทันที
  window.addEventListener('online', () => {
    flushQueue().catch(console.error);
  });
}

/** ส่งคิวทั้งหมดอีกครั้ง — ลบรายการที่สำเร็จ (2xx) */
export async function flushQueue(): Promise<number> {
  if (!originalFetch) return 0;
  const actions = await getAllActions();
  let flushed = 0;

  for (const action of actions) {
    try {
      const res = await originalFetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body ?? undefined,
      });
      if (res.ok && action.id != null) {
        await removeAction(action.id);
        flushed++;
      }
    } catch {
      // network error → เก็บไว้ retry ครั้งหน้า
    }
  }
  await notify();
  return flushed;
}
