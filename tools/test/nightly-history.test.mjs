// tools/test/nightly-history.test.mjs
//
// ── nightly-history ห้ามหายเงียบ ────────────────────────────────────────────
// เคสจริง: entry ของ 7/9/13/14/17 ต.ค. หายไปจาก nightly-history.json และไม่มีใครรู้
// (กราฟแนวโน้มบน /system-health แค่มีจุดขาด โดยไม่มีคำอธิบาย)
// กติกาที่ล็อก:
//   · findHistoryGaps() ตรวจ "เมื่อวานย้อนหลัง N วัน" — ไม่นับวันนี้ (รอบ 02:00 เขียนวันนี้เอง)
//   · mergeHistoryEntry() เขียนทับรายวันเดิม ไม่ duplicate และเรียงเก่า→ใหม่
//   · nightly ต้องใส่ historyGaps ลง status.json และรายงาน Telegram ต้องเตือน
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayKey, findHistoryGaps, mergeHistoryEntry } from '../nightly-history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('dayKey ใช้วันตาม UTC (ให้ตรงกับ finishedAt.slice(0,10) เดิม)', () => {
  assert.equal(dayKey('2026-11-03T02:00:00.000Z'), '2026-11-03');
  assert.equal(dayKey('2026-11-03T20:00:00.000+07:00'), '2026-11-03');
  assert.equal(dayKey(new Date('2026-11-03T23:59:00.000Z')), '2026-11-03');
  assert.equal(dayKey('ไม่ใช่วันที่'), '');
});

test('ไม่มีช่องว่างเมื่อ 7 วันก่อนหน้าครบ', () => {
  const days = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
  const gaps = findHistoryGaps(days.map((day) => ({ day })), { today: '2026-11-03' });
  assert.deepEqual(gaps, []);
});

test('จับช่องว่างจริง: เมื่อวานไม่มี entry = ต้องเตือน', () => {
  // เคสจริง 03/11/69: รอบ 02:00 ของวันที่ 3 ไม่ได้เขียน entry → history จบที่ 2
  const hist = ['2026-10-30', '2026-10-31', '2026-11-01'].map((day) => ({ day }));
  const gaps = findHistoryGaps(hist, { today: '2026-11-04', windowDays: 2 });
  assert.deepEqual(gaps, ['2026-11-02', '2026-11-03']);
});

test('ไม่นับวันนี้เป็นช่องว่าง (รอบ 02:00 เขียนวันนี้เอง)', () => {
  // ประวัติมีแค่วันเมื่อวาน → ไม่มีช่องว่าง แม้ยังไม่มี entry ของวันนี้
  assert.deepEqual(findHistoryGaps([{ day: '2026-11-02' }], { today: '2026-11-03', windowDays: 1 }), []);
  // แต่ถ้าเมื่อวานหาย = ช่องว่างทันที
  assert.deepEqual(findHistoryGaps([], { today: '2026-11-03', windowDays: 1 }), ['2026-11-02']);
});

test('ประวัติว่าง = เตือนครบหน้าต่างที่ตรวจ (ไม่ throw)', () => {
  const gaps = findHistoryGaps([], { today: '2026-11-03' });
  assert.equal(gaps.length, 7);
  assert.equal(gaps[gaps.length - 1], '2026-11-02');
  assert.deepEqual(findHistoryGaps(null, { today: '2026-11-03', windowDays: 2 }), ['2026-11-01', '2026-11-02']);
});

test('merge: เขียนทับรายวันเดิม ไม่ duplicate และเรียงเก่า→ใหม่', () => {
  const old = [
    { day: '2026-11-02', ok: true },
    { day: '2026-11-01', ok: false },
    { day: '2026-10-31', ok: true },
  ];
  const next = mergeHistoryEntry(old, { day: '2026-11-02', ok: false, durationMin: 9 });
  assert.equal(next.length, 3);
  assert.deepEqual(next.map((e) => e.day), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(next[2].ok, false, 'รายวันเดิมต้องถูกแทนที่ด้วยผลรอบล่าสุด');
  assert.equal(next[2].durationMin, 9);
});

test('merge: เก็บไม่เกิน 30 วัน และไม่ทำ history เดิมหายทั้งก้อน', () => {
  const old = Array.from({ length: 35 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  const next = mergeHistoryEntry(old, { day: '2026-10-05', ok: true });
  assert.equal(next.length, 30);
  assert.equal(next[next.length - 1].day, '2026-10-05');
  assert.equal(next[0].day, '2026-09-07', 'ต้องตัดของเก่าออก ไม่ใช่ทิ้งของใหม่');
});

test('merge: ข้อมูลเสีย (null/ไม่มี day/ไม่ใช่ array) ไม่ทำให้ทั้งก้อนหาย', () => {
  const next = mergeHistoryEntry([null, { ok: true }, { day: '2026-11-01' }], { day: '2026-11-02' });
  assert.deepEqual(next.map((e) => e.day), ['2026-11-01', '2026-11-02']);
  assert.deepEqual(mergeHistoryEntry('ไม่ใช่ array', { day: '2026-11-02' }).map((e) => e.day), ['2026-11-02']);
});

test('nightly ใส่ historyGaps ลง status และรายงาน Telegram เตือน', () => {
  const nightly = read('tools/nightly-verify.mjs');
  assert.match(nightly, /nightly-history\.mjs/, 'ต้องใช้โมดูลกลาง (เทสต์ได้) ไม่ใช่ logic inline');
  assert.match(nightly, /historyGaps/, 'status.json ต้องมี historyGaps');

  const report = read('tools/nightly-report.mjs');
  assert.match(report, /historyGaps/, 'Telegram ต้องมีบรรทัดเตือนช่องว่าง');
});
