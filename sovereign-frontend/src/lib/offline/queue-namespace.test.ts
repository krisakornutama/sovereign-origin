// src/lib/offline/queue-namespace.test.ts — red-first test ของ offline queue namespace
// รันด้วย: npx --prefix ../sovereign-os/core-api tsx src/lib/offline/queue-namespace.test.ts
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-queue-namespace.test.mjs)
//
// กติกาที่ล็อกไว้ (Sprint offline-queue-namespace · docs/OFFLINE-QUEUE-NAMESPACE-PLAN.md):
//   I1  flush/อ่าน/ลบ เฉพาะคิวของ session ปัจจุบันเท่านั้น (ห้ามข้ามบัญชี)
//   I2  logout / หมดอายุ 401 → คิวของเจ้าของยังอยู่ครบ (data intent ห้ามลบ) — module นี้ห้ามมี API ลบ/ล้าง
//   I3  badge + หน้า settings แสดง/จัดการเฉพาะของ session ปัจจุบัน (ล้อกับ I1)
//   I4  ลำดับ FIFO ต่อเจ้าของ ไม่พลิก
//   I5  legacy (record ไม่มี stamp) = สถานะพัก (Dormant) — ไม่ผ่านการกรองไม่ว่า current เป็นอะไร
//   I6  สลับบัญชี → ชุดที่มองเห็นต่างกัน ไม่มีทางผสมข้ามบัญชี
//
// ทุกเคสทดสอบ **pure function เท่านั้น** (ไม่พึ่ง IDB/window — แนวเดียวกับ logout-purge รอบ #53)
import assert from 'node:assert/strict';
import test from 'node:test';
import * as queueNamespaceExports from './queue-namespace';
import { ownQueuedActions, stampUserId } from './queue-namespace';
import type { QueuedAction } from '../offlineQueue';
import { attachOfflinePurge, type PurgeAuthSnapshot } from './logout-purge';

// ── fixture ────────────────────────────────────────────────────────────────
// ประเภทผู้ใช้กับคิว: 'user-a' / 'user-b' = บัญชีล็อกอิน · null = anonymous (session ไร้ตัวตน)
const mk = (
  id: number,
  userId: string | null,
  queuedAt: string,
  url = `/api/queued/${id}`
): QueuedAction => ({ id, url, method: 'POST', body: null, queuedAt, userId });

/** ของเก่าก่อน deploy — record ใน IDB ไม่มี field `userId` เลย (ต่างจาก explicit undefined) */
const mkLegacy = (id: number, queuedAt: string): QueuedAction => ({
  id,
  url: `/api/queued/${id}`,
  method: 'POST',
  body: null,
  queuedAt,
});

type PurgeCallback = Parameters<typeof attachOfflinePurge>[1];

async function drainAsync(): Promise<void> {
  // purge เป็น fire-and-forget — รอ microtask/macrotask 2 รอบพอสำหรับเทสต์
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

const T0 = '2026-01-01T10:00:00Z';
const T1 = '2026-01-01T10:01:00Z';
const T2 = '2026-01-01T10:02:00Z';
const T3 = '2026-01-01T10:03:00Z';
const T4 = '2026-01-01T10:04:00Z';

// ── T1 · stampUserId ───────────────────────────────────────────────────────
test('T1 · stampUserId: ใส่ userId ตามค่าที่ส่ง (user/string · null = anonymous) และไม่แก้ของเดิม', () => {
  const legacy = mkLegacy(1, T0);

  const stamped = stampUserId(legacy, 'user-a');
  assert.equal(stamped.userId, 'user-a');
  assert.equal(stamped.url, legacy.url);
  assert.equal(stamped.method, legacy.method);
  assert.equal(stamped.queuedAt, legacy.queuedAt);
  assert.ok(stamped !== legacy, 'ต้องคืน object ใหม่ ไม่ mutate ของเดิม');
  assert.ok(!('userId' in legacy), 'ของเดิมต้องไม่ถูกแตะ (ยังไร้ stamp เหมือน legacy จริงของ IDB)');

  const anon = stampUserId(mkLegacy(2, T1), null);
  assert.ok('userId' in anon, 'anonymous ต้องถูก stamp เป็น null ชัด ๆ — ห้ามตกไปเป็น undefined (= legacy)');
  assert.equal(anon.userId, null);
});

// ── T2 · ownQueuedActions กรองตามเจ้าของ ───────────────────────────────────
test('T2 · ผสมคิว [A, B, anon, legacy] + current=user-a → ได้เฉพาะของ A ตามลำดับเดิม ไม่แตะต้นทาง', () => {
  const queue = [
    mk(1, 'user-a', T0),
    mk(2, 'user-b', T1),
    mk(3, null, T2),
    mk(4, 'user-a', T3),
    mkLegacy(5, T4), // legacy ไม่มี stamp
    mk(6, 'user-b', '2026-01-01T10:05:00Z'),
  ];
  const before = JSON.parse(JSON.stringify(queue));

  const owned = ownQueuedActions(queue, 'user-a');
  assert.deepEqual(
    owned.map((a) => a.id),
    [1, 4],
    'ต้องเหลือเฉพาะของ A · ลำดับตามคิวเดิม (legacy/B/anon หลุดหมด)'
  );
  assert.deepEqual(queue, before, 'คิวต้นทางต้องไม่ถูก mutate');
  assert.ok(owned !== queue, 'ต้องคืน array ใหม่');
});

// ── T3 · current = null (anonymous session) ────────────────────────────────
test('T3 · current=null → ได้เฉพาะ action ที่ userId===null — ไม่มีทางได้ของ user อื่นหรือ legacy', () => {
  const queue = [mk(1, 'user-a', T0), mk(2, null, T1), mk(3, 'user-b', T2), mkLegacy(4, T3)];

  const owned = ownQueuedActions(queue, null);
  assert.deepEqual(owned.map((a) => a.id), [2]);
});

// ── T4 · legacy = Dormant ──────────────────────────────────────────────────
test('T4 · legacy (ไม่มี stamp) ไม่ผ่านการกรองในทุกกรณี — string / null / ว่างก็เท่ากัน', () => {
  const queue = [mkLegacy(10, T0), mk(11, 'user-a', T1), mk(12, null, T2)];

  for (const current of ['user-a', 'user-b', null] as Array<string | null>) {
    const owned = ownQueuedActions(queue, current as never);
    assert.ok(
      !owned.some((a) => a.id === 10),
      `current=${String(current)} → legacy ต้องไม่ผ่าน (Dormant รอ P1 retention)`
    );
  }
  // ควบคู่: โดน stamp แล้ว (deploy จากนี้) ถึงจะมีเจ้าของ
  const stamped = ownQueuedActions([...queue, stampUserId(mkLegacy(13, T3), 'user-a')], 'user-a');
  assert.deepEqual(stamped.map((a) => a.id), [11, 13], 'stamp ใหม่เท่านั้นที่ได้สิทธิ์เป็นของเจ้าของ');
});

// ── T5 · สลับบัญชี ──────────────────────────────────────────────────────────
test('T5 · สลับบัญชี current=user-a → user-b: ชุดของ B ไม่มีของ A แม้แต่ชิ้นเดียว (I6)', () => {
  const queue = [mk(1, 'user-a', T0), mk(2, 'user-b', T1), mk(3, 'user-a', T2)];

  const asA = ownQueuedActions(queue, 'user-a');
  assert.deepEqual(asA.map((a) => a.id), [1, 3]);

  const asB = ownQueuedActions(queue, 'user-b'); // สลับ session แล้ว
  assert.deepEqual(asB.map((a) => a.id), [2]);
  for (const a of asA) assert.ok(!asB.includes(a), 'ของ A ต้องไม่ปนในชุดของ B');
});

// ── T6 · FIFO ต่อเจ้าของ ───────────────────────────────────────────────────
test('T6 · FIFO ต่อเจ้าของ — ลำดับที่ได้ตามคิวต้นทาง ไม่พลิกเพราะคนอื่นแทรก', () => {
  const queue = [
    mk(1, 'user-a', T0),
    mk(2, 'user-b', T1),
    mk(3, 'user-a', T2),
    mk(4, 'user-b', T3),
    mk(5, 'user-a', T4),
  ];

  const owned = ownQueuedActions(queue, 'user-a');
  assert.deepEqual(owned.map((a) => a.id), [1, 3, 5]);

  // พิสูจน์ว่าลำดับ index ในคิวต้นทางเดิม (ไม่มีการ sort แทรกจากตัวกรอง)
  const inputIndices = [1, 3, 5].map((id) => queue.findIndex((a) => a.id === id));
  assert.deepEqual(
    inputIndices,
    [...inputIndices].sort((x, y) => x - y),
    'ลำดับที่ได้ต้องเพิ่มขึ้นตามตำแหน่งในคิวเดิมเสมอ'
  );
});

// ── T7 · I2 logout ไม่ลบคิว + export ห้ามมี API ลบ ─────────────────────────────
test('T7 · logout transition ผ่าน attachOfflinePurge → คิวของ A ต้องอยู่ครบเหมือนก่อน + module นี้ไม่มี API ลบ', async () => {
  // โครงสร้างภายใน: ทุก export ของ queue-namespace ห้ามมีชื่อแนวลบ/ล้าง (I2 — พิสูจน์ที่ interface ด้วย)
  const exportNames = Object.keys(queueNamespaceExports);
  assert.ok(
    exportNames.includes('stampUserId') && exportNames.includes('ownQueuedActions'),
    `ต้อง export ยูทิลิตีกลางครบ · ได้: ${exportNames.join(', ')}`
  );
  for (const name of exportNames) {
    assert.doesNotMatch(
      name,
      /purge|delete|remove|clear|drop/i,
      `export '${name}' ห้ามเป็น API ลบ/ล้าง — คิว = data intent ต้องรอดข้าม logout`
    );
  }

  const queue = [
    mk(1, 'user-a', T0),
    mk(2, 'user-b', T1),
    mk(3, null, T2),
    mkLegacy(4, T3),
    mk(5, 'user-a', T4),
  ];
  const before = queue.map((a) => a.id);

  // fake store แนวเดียวกับ user-read-cache.test.ts (subscribe เรียกทันทีด้วย state ปัจจุบัน)
  let subscribed: ((s: PurgeAuthSnapshot) => void) | null = null;
  const fakeStore = {
    subscribe(fn: (s: PurgeAuthSnapshot) => void): () => void {
      subscribed = fn;
      fn({ isAuthenticated: true, user: { id: 'user-a' } });
      return () => {
        subscribed = null;
      };
    },
  };
  const purged: Array<string | null> = [];
  const onPurge: PurgeCallback = async (uid) => {
    purged.push(uid); // ในระบบจริงคือล้าง read-cache — ไม่มีทางแตะคิว (ไม่มี API ให้เรียก)
  };
  const unsub = attachOfflinePurge(fakeStore, onPurge);

  // จำลอง logout: authenticated → anonymous
  (subscribed as (s: PurgeAuthSnapshot) => void)({ isAuthenticated: false, user: null });
  await drainAsync();
  unsub();

  assert.deepEqual(purged, ['user-a'], 'transition ต้องถูกตรวจจับ (purge ฝั่ง read-cache เท่านั้น)');
  assert.deepEqual(
    queue.map((a) => a.id),
    before,
    'logout แล้วคิวทั้งกองต้องอยู่ครบทุกชิ้น — ไม่ลดจำนวน (I2 + ห้าม destructive purge)'
  );
  assert.deepEqual(
    ownQueuedActions(queue, 'user-a').map((a) => a.id),
    [1, 5],
    'เจ้าของกลับเข้าใหม่ต้องเห็นคิวตัวเองครบเท่าเดิม'
  );
});
