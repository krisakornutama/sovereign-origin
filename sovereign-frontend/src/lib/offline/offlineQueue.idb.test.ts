// src/lib/offline/offlineQueue.idb.test.ts — เทสต์ sweep/boot บน IndexedDB จริง (fake-indexeddb)
// รันด้วย: npx tsx src/lib/offline/offlineQueue.idb.test.ts
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-queue-retention-idb.test.mjs)
//
// ทำไมต้องมี: queue-retention.test.ts เป็น pure logic ล้วน — ไม่พิสูจน์ว่า
//   • DB v1 ของผู้ใช้เดิมอัปเกรดเป็น v2 แล้ว "คิวเดิมไม่หาย" และได้ store audit
//   • boot trigger (initOfflineQueue) เรียก sweep จริงตอนแอปเปิด
//   • audit ที่เขียนลง IDB อ่านกลับมาได้และตรงกับที่ลบ
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';

const DB_NAME = 'sovereign-offline';
const STORE = 'actions';
const AUDIT_STORE = 'audit';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  url: string;
  method: string;
  queuedAt: string;
  userId?: string | null;
}

/** zustand/persist แตะ localStorage ตอน import — ให้ของปลอมแบบMap เพื่อไม่ให้ warn/พังบน Node */
function installFakeLocalStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openRaw(version?: number, onUpgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // ไม่ส่ง version = เปิดเวอร์ชันปัจจุบัน (ไม่ trigger upgrade ที่จะสร้าง DB เปล่า)
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => onUpgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

/** สร้าง DB เวอร์ชัน 1 แบบเดียวกับโค้ดเดิมก่อนมี audit store */
async function seedV1(rows: Row[]): Promise<void> {
  const db = await openRaw(1, (d) => {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const row of rows) tx.objectStore(STORE).add(row);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** อ่านทุกแถวตรง ๆ (ไม่ผ่านตัวกรองเจ้าของคิว) — ใช้หาว่า id ไหนคือแถวเก่า */
async function allRows(): Promise<Array<Row & { id?: number }>> {
  const db = await openRaw();
  const rows = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  db.close();
  return rows as Array<Row & { id?: number }>;
}

async function storeNames(): Promise<string[]> {
  const db = await openRaw();
  const names = Array.from(db.objectStoreNames);
  db.close();
  return names;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor: หมดเวลา — สภาพที่คาดหวังไม่เกิด');
}

function row(url: string, ageDays: number, userId: string | null = 'u1'): Row {
  return { url, method: 'POST', queuedAt: new Date(Date.now() - ageDays * DAY_MS).toISOString(), userId };
}

installFakeLocalStorage();

/** import แบบ lazy — tsx รันไฟล์นี้เป็น CJS จึงใช้ top-level await ไม่ได้ */
function queueModule() {
  return import('../offlineQueue');
}

test('T1: DB v1 → v2 — คิวเดิมไม่หาย และได้ store audit', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seedV1([row('/api/keep', 1), row('/api/old', 45)]);

  const listed = await queue.listQueued();
  assert.deepEqual(
    listed.map((a) => a.url).sort(),
    ['/api/keep', '/api/old'],
    'การอัปเกรดต้องไม่ลบหรือเขียนทับคิวเดิม'
  );

  const names = await storeNames();
  assert.ok(names.includes(STORE), 'ต้องยังมี store actions');
  assert.ok(names.includes(AUDIT_STORE), 'v2 ต้องมี store audit');
});

test('T2: boot trigger (initOfflineQueue) เก็บกวาดเฉพาะคิวเกิน 30 วัน + เขียน audit', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seedV1([row('/api/fresh', 1), row('/api/old', 40)]);
  const oldId = (await allRows()).find((r) => r.url === '/api/old')?.id;
  assert.equal(typeof oldId, 'number', 'ต้องมีแถวเก่าให้ตัด');

  const fakeWindow = {
    fetch: async () => new Response('{}', { status: 200 }),
    addEventListener: () => undefined,
    location: { origin: 'http://localhost:3000' },
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });

  queue.initOfflineQueue();
  await waitFor(async () => (await queue.listQueued()).length === 1);

  const remaining = await queue.listQueued();
  assert.deepEqual(remaining.map((a) => a.url), ['/api/fresh'], 'คิวที่ยังไม่ครบ 30 วันต้องอยู่ครบ');

  const audit = await queue.listAudit();
  assert.equal(audit.length, 1, 'boot sweep ต้องเขียน audit 1 ครั้ง');
  assert.equal(audit[0].removedCount, 1);
  assert.deepEqual(
    audit[0].removed.map((r) => (r as { id?: number }).id),
    [oldId],
    'audit ต้องอ้างถึง id ของแถวที่ถูกลบจริง'
  );
  assert.ok(audit[0].at, 'ต้องมีเวลาที่ sweep');
});

test('T3: initOfflineQueue เรียกซ้ำไม่ติดตั้ง interceptor/ sweep ซ้ำ', async () => {
  const queue = await queueModule();
  const before = (globalThis as { window?: { fetch: unknown } }).window?.fetch;
  queue.initOfflineQueue();
  await new Promise((r) => setTimeout(r, 100));
  const after = (globalThis as { window?: { fetch: unknown } }).window?.fetch;
  assert.equal(after, before, 'initialized guard ต้องกันการติดตั้งซ้ำ');
  assert.equal((await queue.listAudit()).length, 1, 'เรียกซ้ำต้องไม่เขียน audit เพิ่ม');
});

test('T4: sweepExpiredQueue บน IDB จริง — ลบตามอายุ, audit ใหม่→เก่า, รอบว่างไม่เขียนบันทึก', async () => {
  const queue = await queueModule();
  // เพิ่มคิวเก่าอีก 1 แถวตรง ๆ ใน DB v2 (จำลองคิวที่ค้างมาจาก session ก่อน)
  const db = await openRaw();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(row('/api/ancient', 31));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });

  const first = await queue.sweepExpiredQueue();
  assert.equal(first.removed, 1, '31 วันต้องถูกตัด');
  assert.deepEqual((await queue.listQueued()).map((a) => a.url), ['/api/fresh']);

  const audit = await queue.listAudit();
  assert.equal(audit.length, 2, 'ต้องมีบันทึกรอบใหม่เพิ่ม');
  const ancient = audit.find((r) => r.removed.some((x) => (x as { url?: string }).url === '/api/ancient'));
  assert.ok(ancient, 'บันทึกรอบใหม่ต้องระบุแถวที่ลบ (/api/ancient)');
  assert.equal(ancient.removedCount, 1);

  const second = await queue.sweepExpiredQueue();
  assert.equal(second.removed, 0, 'ไม่มีอะไรเกินอายุ = ไม่ลบ');
  assert.equal((await queue.listAudit()).length, 2, 'รอบว่างต้องไม่เขียนบันทึกเปล่า');
});
