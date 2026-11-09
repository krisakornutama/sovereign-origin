// src/lib/offline/queue-retention.test.ts — red-first test ของ offline queue retention sweep
// รันด้วย: npx tsx src/lib/offline/queue-retention.test.ts
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-queue-retention.test.mjs)
//
// กติกาที่ล็อกไว้ (docs/OFFLINE-QUEUE-RETENTION-PLAN.md §5):
//   R1  อายุ < 30 วัน = เก็บ · = 30 วันพอดี = เก็บ · > 30 วัน = ตัด
//   R2  คิวเก่าของทุกกลุ่ม (ตัวเอง/คนอื่น/legacy) เข้าชุดตัดด้วยเกณฑ์เดียวกัน
//   R3  เขียน audit ล้ม = ไม่มีการลบเลย (write-ahead)
//   R4  audit 1 record/รอบ · removedCount ตรง · รายชื่อ id เป๊ะตามลำดับอายุ
//   R5  ชุดตัดว่าง = ไม่เขียนบันทึกเปล่า
//   R6  audit cap 50 · เก็บใหม่→เก่า
//   R7  คิวที่เหลือ FIFO เดิมไม่พลิก
//
// ทุกเคสเป็น pure + injection (MemoryAuditStore) — ไม่พึ่ง IDB/window
import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueuedAction } from '../offlineQueue';
import {
  AUDIT_CAP,
  QUEUE_MAX_AGE_DAYS,
  QUEUE_MAX_AGE_MS,
  applyAuditCap,
  buildAuditRecord,
  recordAuditThenRemove,
  splitByAge,
  type AuditStore,
  type RetentionAuditRecord,
} from './queue-retention';

// ── fixture ────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-09T00:00:00.000Z');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const mk = (
  id: number,
  queuedAt: string,
  userId: string | null = 'user-a',
  url = `/api/queued/${id}`
): QueuedAction => ({ id, url, method: 'POST', body: null, queuedAt, userId });

/** ของเก่าก่อน deploy P0 — ไม่มี field userId เลย (Dormant) */
const mkLegacy = (id: number, queuedAt: string): QueuedAction => ({
  id,
  url: `/api/queued/${id}`,
  method: 'DELETE',
  body: null,
  queuedAt,
});

class MemoryAuditStore implements AuditStore {
  records: RetentionAuditRecord[] = [];
  failWrites = false;
  puts = 0;
  private nextId = 1;

  async put(record: RetentionAuditRecord): Promise<void> {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.puts += 1;
    this.records = applyAuditCap([{ ...record, id: this.nextId++ }, ...this.records]);
  }

  async list(): Promise<RetentionAuditRecord[]> {
    return this.records;
  }
}

// ── T1 · R1 ────────────────────────────────────────────────────────────────
test('T1 · splitByAge: 29 วันเก็บ · 30 วันพอดีเก็บ · 31 วันตัด (ขอบเข้ม >)', () => {
  const fresh = mk(1, at(29));
  const edge = mk(2, at(QUEUE_MAX_AGE_DAYS));
  const stale = mk(3, at(31));

  const { removables, kept } = splitByAge([fresh, edge, stale], NOW, QUEUE_MAX_AGE_MS);
  assert.deepStrictEqual(removables.map((a) => a.id), [3]);
  assert.deepStrictEqual(kept.map((a) => a.id), [1, 2]);
});

test('T1b · ค่าคงที่ตรงสัญญา (30 วัน = 30*24h)', () => {
  assert.equal(QUEUE_MAX_AGE_DAYS, 30);
  assert.equal(QUEUE_MAX_AGE_MS, 30 * DAY);
  assert.equal(AUDIT_CAP, 50);
});

// ── T2 · R2 ────────────────────────────────────────────────────────────────
test('T2 · อายุเกิน 30 วันของทุกกลุ่ม (ตัวเอง/คนอื่น/legacy) เข้าชุดตัดพร้อมกัน', () => {
  const mine = mk(1, at(40), 'user-a');
  const other = mk(2, at(45), 'user-b');
  const legacy = mkLegacy(3, at(35));
  const freshOther = mk(4, at(2), 'user-b');

  const { removables, kept } = splitByAge([mine, other, legacy, freshOther], NOW, QUEUE_MAX_AGE_MS);
  // เรียงเก่า → ใหม่ (ลำดับที่ใช้อธิบายใน audit)
  assert.deepStrictEqual(removables.map((a) => a.id), [2, 1, 3]);
  assert.deepStrictEqual(kept.map((a) => a.id), [4]);
});

test('T2b · record ที่ไม่มี id ลบไม่ได้ → ต้องไม่เข้าชุดตัด (กัน audit อ้างสิ่งที่ลบไม่ได้)', () => {
  const noId: QueuedAction = { url: '/api/x', method: 'POST', queuedAt: at(60) };
  const { removables, kept } = splitByAge([noId], NOW, QUEUE_MAX_AGE_MS);
  assert.equal(removables.length, 0);
  assert.equal(kept.length, 1);
});

test('T2c · queuedAt อ่านไม่ได้ → เก็บไว้ (ตัดสินอายุไม่ได้ = ห้ามลบ)', () => {
  const broken = mk(9, 'not-a-date');
  const { removables, kept } = splitByAge([broken], NOW, QUEUE_MAX_AGE_MS);
  assert.equal(removables.length, 0);
  assert.equal(kept.length, 1);
});

// ── T3 · R3 (write-ahead) ───────────────────────────────────────────────────
test('T3 · audit เขียนล้ม → ไม่เรียก removeOne แม้แต่ครั้งเดียว และ throw ออกไป', async () => {
  const store = new MemoryAuditStore();
  store.failWrites = true;
  const removed: number[] = [];
  const { removables } = splitByAge([mk(1, at(40)), mk(2, at(50))], NOW, QUEUE_MAX_AGE_MS);

  await assert.rejects(
    recordAuditThenRemove(
      removables.map((a) => a.id as number),
      buildAuditRecord(removables, NOW),
      store,
      async (id) => {
        removed.push(id);
      }
    ),
    /QuotaExceeded/
  );
  assert.deepStrictEqual(removed, []);
  assert.equal(store.records.length, 0);
});

// ── T4 · R4 ────────────────────────────────────────────────────────────────
test('T4 · audit สำเร็จ → ลบครบทุก id ตามลำดับที่ส่ง และคืนจำนวนที่ลบ', async () => {
  const store = new MemoryAuditStore();
  const removed: number[] = [];
  const { removables } = splitByAge([mk(1, at(40)), mk(2, at(50)), mk(3, at(45))], NOW, QUEUE_MAX_AGE_MS);
  const ids = removables.map((a) => a.id as number);
  assert.deepStrictEqual(ids, [2, 3, 1]); // เก่า → ใหม่

  const count = await recordAuditThenRemove(ids, buildAuditRecord(removables, NOW), store, async (id) => {
    removed.push(id);
  });

  assert.equal(count, 3);
  assert.deepStrictEqual(removed, ids);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].removedCount, 3);
});

// ── T5 · R4 (รูปร่างบันทึก) ─────────────────────────────────────────────────
test('T5 · buildAuditRecord: at ISO · removedCount · removedRange · refs เป๊ะ (ไม่มี body/headers)', () => {
  const { removables } = splitByAge([mk(1, at(40)), mkLegacy(2, at(50))], NOW, QUEUE_MAX_AGE_MS);
  const rec = buildAuditRecord(removables, NOW);

  assert.equal(rec.at, new Date(NOW).toISOString());
  assert.equal(rec.removedCount, 2);
  assert.deepStrictEqual(rec.removedRange, { oldestQueuedAt: at(50), newestQueuedAt: at(40) });
  assert.deepStrictEqual(rec.removed.map((r) => r.id), [2, 1]);
  // ref มีแค่ 4 field — ไม่ลาก body/headers ของ request ลงบันทึก
  for (const ref of rec.removed) {
    assert.deepStrictEqual(Object.keys(ref).sort(), ['id', 'queuedAt', 'url', 'userId']);
  }
  // legacy ที่ไม่มี userId → null (ไม่ใช่ undefined หายไปจาก JSON)
  assert.equal(rec.removed[0].userId, null);
  assert.equal(rec.removed[1].userId, 'user-a');
});

// ── T5b · R5 ───────────────────────────────────────────────────────────────
test('T5b · removables ว่าง → ไม่เขียนบันทึก และคืน 0', async () => {
  const store = new MemoryAuditStore();
  const count = await recordAuditThenRemove([], buildAuditRecord([], NOW), store, async () => {
    assert.fail('ต้องไม่ลบอะไรเลยเมื่อชุดว่าง');
  });
  assert.equal(count, 0);
  assert.equal(store.puts, 0);
  assert.equal(store.records.length, 0);
});

// ── T6 · R6 (cap) ──────────────────────────────────────────────────────────
test('T6 · cap 50: เก็บ 50 รายการล่าสุด เรียงใหม่→เก่า', () => {
  const many: RetentionAuditRecord[] = Array.from({ length: 55 }, (_, i) => ({
    id: i + 1,
    at: new Date(NOW - i * 1000).toISOString(),
    removedCount: 1,
    removedRange: null,
    removed: [],
  }));

  const capped = applyAuditCap(many, AUDIT_CAP);
  assert.equal(capped.length, 50);
  assert.equal(capped[0].id, 55);
  assert.equal(capped[49].id, 6);
  // ลำดับใหม่ → เก่าตลอดสาย
  for (let i = 1; i < capped.length; i++) {
    assert.ok((capped[i - 1].id as number) > (capped[i].id as number));
  }
});

// ── T7 · R7 (ไม่พลิก FIFO) ──────────────────────────────────────────────────
test('T7 · kept รักษาลำดับ FIFO เดิม และ removables เรียงตามอายุเท่านั้น', () => {
  const list = [mk(5, at(29)), mk(1, at(60)), mk(4, at(30)), mk(3, at(80)), mk(2, at(0))];
  const { removables, kept } = splitByAge(list, NOW, QUEUE_MAX_AGE_MS);

  assert.deepStrictEqual(kept.map((a) => a.id), [5, 4, 2]);
  assert.deepStrictEqual(removables.map((a) => a.id), [3, 1]);
  // ไม่แก้ object เดิม (pure)
  assert.equal(list.length, 5);
});
