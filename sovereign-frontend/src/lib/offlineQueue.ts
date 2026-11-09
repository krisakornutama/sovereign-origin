/**
 * Offline request queue
 * - ขณะออฟไลน์: request แบบ POST/PUT/PATCH/DELETE (same-origin) จะถูกเก็บเข้า
 *   IndexedDB แทนการ fail ทันที แล้วคืน Response 503 ให้โค้ดจัดการตามปกติ
 * - เมื่อกลับ online: flushQueue() ส่งคิวทั้งหมดอีกครั้ง (ลบออกเมื่อสำเร็จ)
 * - subscribeOfflineQueue() ใช้แสดง badge จำนวนที่ค้าง
 */

import { useAuthStore } from '../stores/useAuthStore';
import { ownQueuedActions, stampUserId, type QueueUserId } from './offline/queue-namespace';
import {
  QUEUE_MAX_AGE_MS,
  buildAuditRecord,
  recordAuditThenRemove,
  splitByAge,
  trimIds,
  type AuditStore,
  type RetentionAuditRecord,
} from './offline/queue-retention';

const DB_NAME = 'sovereign-offline';
const STORE = 'actions';
// v2: เพิ่ม store 'audit' — การเพิ่ม store ใหม่ตอน upgrade ไม่แตะข้อมูล store เดิม
const AUDIT_STORE = 'audit';
const DB_VERSION = 2;

export interface QueuedAction {
  id?: number;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Blob | null;
  queuedAt: string;
  /** เจ้าของคิว: user id ของ session ที่ enqueue · null = anonymous
   *  (record ที่ไม่มี field นี้ = เก่าก่อน deploy = Dormant — ไม่ flush/ไม่โชว์ รอ P1 retention) */
  userId?: QueueUserId;
}

/** ตัวตนเจ้าของคิวของ session ปัจจุบัน — อ่านสดจาก auth store ทุกครั้งที่ถูกเรียก
 *  (สลับบัญชี / logout / 401 ระหว่างทางก็ได้ตัวตนใหม่เสมอ ไม่ต้อง register หรือตั้งค่าล่วงหน้า) */
export function currentQueueUserId(): QueueUserId {
  return useAuthStore.getState().user?.id ?? null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(AUDIT_STORE)) {
        db.createObjectStore(AUDIT_STORE, { keyPath: 'id', autoIncrement: true });
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

// ── audit store (บันทึกการเก็บกวาดคิว) ──
/** adapter ของ audit store — put ต้องสำเร็จก่อน sweep จึงจะลบได้ (write-ahead) */
const auditStore: AuditStore = {
  async put(record: RetentionAuditRecord): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AUDIT_STORE, 'readwrite');
      tx.objectStore(AUDIT_STORE).add(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
    await trimAuditStore();
  },
  async list(): Promise<RetentionAuditRecord[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIT_STORE, 'readonly');
      const req = tx.objectStore(AUDIT_STORE).getAll();
      req.onsuccess = () => resolve(req.result as RetentionAuditRecord[]);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  },
};

/** ตัดบันทึกที่เกินเพดาน (cap ของบันทึกเอง ไม่แตะคิว) */
async function trimAuditStore(): Promise<void> {
  const records = await auditStore.list();
  const stale = trimIds(records);
  if (stale.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORE, 'readwrite');
    for (const id of stale) tx.objectStore(AUDIT_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** บันทึกการเก็บกวาดทั้งหมด (ใหม่ → เก่า) — ใช้แสดงผลในหน้า settings */
export async function listAudit(): Promise<RetentionAuditRecord[]> {
  try {
    return await auditStore.list();
  } catch {
    return [];
  }
}

/**
 * เก็บกวาดคิวที่เกินอายุ 30 วัน — เขียน audit ก่อนลบเสมอ
 * ไม่แตะคิวที่ยังไม่เกินอายุ · ไม่ล็อกอินก็เก็บกวาดได้ (ตัดสินจากอายุเท่านั้น ตาม R2)
 */
export async function sweepExpiredQueue(now: number = Date.now()): Promise<{ removed: number }> {
  try {
    const all = await getAllActions();
    const { removables } = splitByAge(all, now, QUEUE_MAX_AGE_MS);
    if (removables.length === 0) return { removed: 0 };

    const removed = await recordAuditThenRemove(
      removables.map((a) => a.id as number),
      buildAuditRecord(removables, now),
      auditStore,
      removeAction
    );
    if (removed > 0) await notify();
    return { removed };
  } catch (err) {
    // เขียนบันทึกล้ม = ไม่ลบ (write-ahead) — การเก็บกวาดล้มต้องไม่ทำให้แอปพัง
    console.error('[offline] retention sweep failed (nothing removed):', err);
    return { removed: 0 };
  }
}

/** จำนวน action ที่ค้าง — ไม่ส่ง userId = นับทั้งหมด (compat กับ caller เดิม) · ส่ง = เฉพาะเจ้าของนั้น */
export async function countQueued(userId?: QueueUserId): Promise<number> {
  try {
    const all = await getAllActions();
    return (userId === undefined ? all : ownQueuedActions(all, userId)).length;
  } catch {
    return 0;
  }
}

/** รายการ action ที่ค้างอยู่ (เรียงเก่าไปใหม่ = FIFO) — ไม่ส่ง userId = ทั้งหมด · ส่ง = เฉพาะเจ้าของนั้น */
export async function listQueued(userId?: QueueUserId): Promise<QueuedAction[]> {
  try {
    const sorted = (await getAllActions()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    return userId === undefined ? sorted : ownQueuedActions(sorted, userId);
  } catch {
    return [];
  }
}

/** ลบ action ทีละรายการ (ไม่ sync) — ลบได้เฉพาะของ session ปัจจุบันเท่านั้น */
export async function removeQueued(id: number): Promise<void> {
  try {
    const all = await getAllActions();
    const target = all.find((a) => a.id === id);
    if (!target) return;
    if (ownQueuedActions([target], currentQueueUserId()).length === 0) return; // ของคนอื่น/legacy → ห้ามแตะ
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
  // ส่งได้เฉพาะของ session ปัจจุบัน — ของคนอื่น/legacy มองไม่เห็นแม้รู้ id
  const owned = ownQueuedActions(actions, currentQueueUserId());
  const action = owned.find((a) => a.id === id);
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
  // badge นับเฉพาะของ session ปัจจุบันเสมอ — ของคนอื่น/legacy ไม่โชว์ (Dormant)
  const count = await countQueued(currentQueueUserId());
  for (const fn of listeners) fn(count);
}

// ── pub/sub สำหรับ syncing state (Sprint 2 ระยะ 3) ──
type SyncListener = (syncing: boolean) => void;
const syncListeners = new Set<SyncListener>();

export function subscribeOfflineSync(fn: SyncListener): () => void {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

function notifySync(syncing: boolean) {
  for (const fn of syncListeners) fn(syncing);
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
        await addAction(
          stampUserId(
            {
              url,
              method,
              headers: normalizeHeaders(init?.headers),
              body: normalizeBody(init?.body),
              queuedAt: new Date().toISOString(),
            },
            currentQueueUserId()
          )
        );
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

  // บูต: เก็บกวาดคิวที่เกินอายุ (เขียน audit ก่อนลบ · ล้มแล้วไม่ลบอะไร)
  void sweepExpiredQueue();
}

/** ส่งคิวทั้งหมดอีกครั้ง — ลบรายการที่สำเร็จ (2xx) */
export async function flushQueue(): Promise<number> {
  if (!originalFetch) return 0;
  notifySync(true);
  try {
    const all = await getAllActions();
    // flush เฉพาะของ session ปัจจุบัน — คิวคนอื่น/legacy รอเจ้าของกลับมาเอง
    const actions = ownQueuedActions(all, currentQueueUserId());
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
  } finally {
    notifySync(false);
  }
}
