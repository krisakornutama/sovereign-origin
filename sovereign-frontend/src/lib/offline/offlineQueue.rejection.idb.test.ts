// src/lib/offline/offlineQueue.rejection.idb.test.ts — เทสต์นโยบาย "ปฏิเสธถาวร" บน IndexedDB จริง
// รันด้วย: npx tsx src/lib/offline/offlineQueue.rejection.idb.test.ts
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-queue-rejection-idb.test.mjs)
//
// ทำไมต้องมี: queue-rejection.test.ts เป็น pure logic — ไม่พิสูจน์ว่า flush จริง
//   • ไม่ลบ record ที่ server ตอบ 400 (ข้อมูลผู้ใช้ห้ามหายเพื่อให้คิวสวย)
//   • ไม่ยิงซ้ำรายการที่ถูกพักแล้วในการ flush รอบถัดไป (retry storm หมดไป)
//   • 5xx ยัง retry (ไม่ติดป้ายผิด)
//   • มือคนกด "ลองใหม่" (flushAction) ยังยิงจริงแม้ถูกพัก และลบได้เมื่อสำเร็จ
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';

const DB_NAME = 'sovereign-offline';
const STORE = 'actions';
const AUDIT_STORE = 'audit';

interface Row {
  url: string;
  method: string;
  queuedAt: string;
  userId?: string | null;
}

/** คำตอบของ fake fetch — ใช้ร่วมกันทุกเคส (originalFetch ถูกจับครั้งเดียวตอน init) */
const statusByUrl = new Map<string, number>();
const calls: string[] = [];

function installFakeLocalStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

/** window ปลอมติดตั้งครั้งเดียวก่อน import offlineQueue — interceptor ถูกติดตั้งครั้งเดียวต่อโปรเซส */
function installFakeWindow(): void {
  const fakeWindow = {
    fetch: async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: statusByUrl.get(url) ?? 200 });
    },
    addEventListener: () => undefined,
    location: { origin: 'http://localhost:3000' },
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openRaw(version?: number, onUpgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

async function seed(rows: Row[]): Promise<void> {
  const db = await openRaw(2, (d) => {
    if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    if (!d.objectStoreNames.contains(AUDIT_STORE)) d.createObjectStore(AUDIT_STORE, { keyPath: 'id', autoIncrement: true });
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

async function allRows(): Promise<Array<Row & { id?: number; lastRejection?: { status: number; at: string } }>> {
  const db = await openRaw();
  const rows = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  db.close();
  return rows as Array<Row & { id?: number; lastRejection?: { status: number; at: string } }>;
}

function row(url: string, ageMs = 1000): Row {
  return { url, method: 'POST', queuedAt: new Date(Date.now() - ageMs).toISOString(), userId: null };
}

installFakeLocalStorage();
installFakeWindow();

/** import แบบ lazy — tsx รันไฟล์นี้เป็น CJS จึงใช้ top-level await ไม่ได้ */
function queueModule() {
  return import('../offlineQueue');
}

test('R-1: 400 ถูกพัก (ไม่ลบ) · 200 ถูกลบ · 5xx ไม่ติดป้ายและยัง retry', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seed([row('/api/ok'), row('/api/bad'), row('/api/flaky')]);
  statusByUrl.clear();
  statusByUrl.set('/api/ok', 200);
  statusByUrl.set('/api/bad', 400);
  statusByUrl.set('/api/flaky', 503);
  calls.length = 0;

  queue.initOfflineQueue();

  const flushed = await queue.flushQueue();
  assert.equal(flushed, 1, 'เฉพาะ 200 ที่ถูกลบ');

  const remaining = await queue.listQueued();
  assert.deepEqual(
    remaining.map((a) => a.url).sort(),
    ['/api/bad', '/api/flaky'],
    '400 ต้องยังอยู่ในคิว (ห้ามลบข้อมูลผู้ใช้) และ 5xx ก็ยังอยู่'
  );

  const bad = remaining.find((a) => a.url === '/api/bad');
  const flaky = remaining.find((a) => a.url === '/api/flaky');
  assert.equal(bad?.lastRejection?.status, 400, '400 ต้องถูกติดป้ายพร้อม status');
  assert.ok(bad?.lastRejection?.at, 'ต้องมีเวลาที่ถูกปฏิเสธ');
  assert.equal(flaky?.lastRejection, undefined, '5xx ยังไม่ใช่ความผิดถาวร — ห้ามติดป้าย');

  // รอบสอง: bad ต้องไม่ถูกยิงซ้ำ · flaky ยังลองใหม่
  const beforeBad = calls.filter((u) => u === '/api/bad').length;
  const beforeFlaky = calls.filter((u) => u === '/api/flaky').length;
  await queue.flushQueue();
  assert.equal(calls.filter((u) => u === '/api/bad').length, beforeBad, 'รายการที่ถูกพักต้องไม่ถูกยิงซ้ำอัตโนมัติ');
  assert.equal(calls.filter((u) => u === '/api/flaky').length, beforeFlaky + 1, '5xx ต้องยัง retry');

  // มือคนกดลองใหม่: เปลี่ยนคำตอบเป็น 200 แล้วต้องส่งได้จริงและลบออก
  statusByUrl.set('/api/bad', 200);
  const ok = await queue.flushAction(bad!.id!);
  assert.equal(ok, true, 'flushAction ต้องยิงจริงแม้ถูกพัก และสำเร็จเมื่อ server รับ');
  assert.deepEqual((await queue.listQueued()).map((a) => a.url), ['/api/flaky']);
});

test('R-2: 401/403 ถูกพักเช่นกัน (token เก่าฝังใน headers — retry ไม่มีทางผ่าน)', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seed([row('/api/auth-expired'), row('/api/forbidden')]);
  statusByUrl.clear();
  statusByUrl.set('/api/auth-expired', 401);
  statusByUrl.set('/api/forbidden', 403);
  calls.length = 0;

  await queue.flushQueue();
  const rows = await queue.listQueued();
  assert.equal(rows.length, 2, 'ห้ามลบ (ข้อมูลอาจต้องใช้หลังล็อกอินใหม่)');
  assert.equal(rows.find((a) => a.url === '/api/auth-expired')?.lastRejection?.status, 401);
  assert.equal(rows.find((a) => a.url === '/api/forbidden')?.lastRejection?.status, 403);
});

test('R-3: 429 = retry (ไม่ติดป้าย) — rate limit ไม่ใช่ความผิดถาวรของคำขอ', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seed([row('/api/rate-limited')]);
  statusByUrl.clear();
  statusByUrl.set('/api/rate-limited', 429);
  calls.length = 0;

  await queue.flushQueue();
  const rows = await queue.listQueued();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastRejection, undefined, '429 ต้องไม่ติดป้าย — รอรอบถัดไป');
});

test('R-4: ป้ายถูกเขียนลง IDB จริง (ไม่ใช่แค่ object ในหน่วยความจำ)', async () => {
  const queue = await queueModule();
  await deleteDb();
  await seed([row('/api/persist')]);
  statusByUrl.clear();
  statusByUrl.set('/api/persist', 409);
  calls.length = 0;

  await queue.flushQueue();

  // อ่านดิบจาก store อีก transaction — ต้องเห็นป้ายที่เขียนลง IDB
  const raw = await allRows();
  const parked = raw.find((r) => r.url === '/api/persist');
  assert.ok(parked, 'แถวต้องยังอยู่ (ห้ามลบ)');
  assert.equal(parked.lastRejection?.status, 409, 'ป้ายต้องถูก persist ลง IDB');
  assert.ok(parked.lastRejection?.at);
});
