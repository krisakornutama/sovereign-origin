// tools/test/nightly-deadman.test.mjs
//
// ── Dead-man alert: nightly ไม่ผ่าน/หายติดกัน 2 คืนต้องถึง Telegram ─────────
// เคสจริง พ.ย. 69: nightly แดงติดกัน 7 คืน (31/10–6/11) แต่เจ้าของไม่รู้ เพราะ
// nightly-report อ่าน Telegram creds จาก DB อย่างเดียว — DB มีแค่ telegram.bizChatId
// (creds จริงอยู่ใน sovereign-os/infra/.env) ⇒ รายงานทุกคืนถูก "ข้าม" เงียบ ๆ
//
// กติกาที่ล็อก:
//   · รอบ nightly 02:00 เวลาไทย = 19:00 UTC และ entry ของ history ใช้วัน UTC
//     (รอบ 02:00 ของวันที่ 7 เวลาไทย เขียน day = 2026-11-06)
//   · นับเฉพาะรอบที่ "ควรมีผลแล้ว" (เลย 20:00 UTC ไปแล้ว) — ไม่เอา day ปัจจุบัน
//     ที่ยังไม่ถึงเวลาไปนับเป็นล้ม
//   · วันที่ไม่มี entry = ถือว่าไม่ผ่าน (nightly ไม่รัน/ค้าง) ไม่ใช่ "ข้าม"
//   · ผ่าน 1 คืน = streak ขาดทันที, เตือนซ้ำได้วันละครั้ง (dedup ตาม endDay)
//   · report ต้องใช้ creds เจ้าของเดียว (DB → infra/.env) ไม่ใช่อ่าน DB เอง
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THRESHOLD,
  buildAlertText,
  consecutiveFailures,
  decideDeadman,
  latestNightlyDay,
} from '../nightly-deadman.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('latestNightlyDay: 03:30 น. เวลาไทย = รอบเมื่อคืน · ก่อน 02:00 = รอบก่อนหน้า', () => {
  // 2026-11-07 03:30 +07:00 = 2026-11-06T20:30Z → รอบที่เพิ่งจบคือ day 2026-11-06
  assert.equal(latestNightlyDay(new Date('2026-11-06T20:30:00.000Z')), '2026-11-06');
  // 2026-11-07 01:00 +07:00 = 2026-11-06T18:00Z → รอบล่าสุดคือ 02:00 ของ 6/11 = day 2026-11-05
  assert.equal(latestNightlyDay(new Date('2026-11-06T18:00:00.000Z')), '2026-11-05');
  // 2026-11-07 15:00 +07:00 = 2026-11-07T08:00Z → ยังไม่ถึงรอบคืนนี้ ต้องคาดหวัง day 2026-11-06
  assert.equal(latestNightlyDay(new Date('2026-11-07T08:00:00.000Z')), '2026-11-06');
  assert.equal(latestNightlyDay('ไม่ใช่วันที่'), '');
});

test('ล้มติดกัน 3 คืน = streak 3 และไล่จากคืนล่าสุดย้อนหลัง', () => {
  const now = new Date('2026-11-06T20:30:00.000Z'); // คาดหวัง day 2026-11-06
  const history = [
    { day: '2026-11-03', ok: true },
    { day: '2026-11-04', ok: false },
    { day: '2026-11-05', ok: false },
    { day: '2026-11-06', ok: false },
  ];
  const r = consecutiveFailures(history, { now });
  assert.equal(r.endDay, '2026-11-06');
  assert.equal(r.streak, 3);
  assert.deepEqual(r.days.map((d) => d.day), ['2026-11-06', '2026-11-05', '2026-11-04']);
});

test('คืนที่ผ่าน 1 คืน = ตัด streak ทันที (ไม่ลากของเก่ามานับ)', () => {
  const now = new Date('2026-11-06T20:30:00.000Z');
  const r = consecutiveFailures([
    { day: '2026-11-04', ok: false },
    { day: '2026-11-05', ok: true },
    { day: '2026-11-06', ok: false },
  ], { now });
  assert.equal(r.streak, 1);
  assert.deepEqual(r.days.map((d) => d.day), ['2026-11-06']);
});

test('วันที่ไม่มี entry = นับเป็นคืนที่ไม่ผ่าน (nightly ไม่รัน/ค้าง)', () => {
  const now = new Date('2026-11-06T20:30:00.000Z');
  const r = consecutiveFailures([
    { day: '2026-11-03', ok: true },
    { day: '2026-11-04', ok: true },
    // 5/11 และ 6/11 ไม่มี entry
  ], { now });
  assert.equal(r.streak, 2);
  assert.deepEqual(r.days.map((d) => d.missing), [true, true]);
});

test('คืนล่าสุดผ่าน = streak 0 (แม้ประวัติเก่าจะแดง)', () => {
  const now = new Date('2026-11-06T20:30:00.000Z');
  const r = consecutiveFailures([
    { day: '2026-11-04', ok: false },
    { day: '2026-11-05', ok: false },
    { day: '2026-11-06', ok: true },
  ], { now });
  assert.equal(r.streak, 0);
  assert.deepEqual(r.days, []);
});

test('decideDeadman: ถึงเกณฑ์ 2 คืน = เตือน · 1 คืน = เงียบ', () => {
  const now = new Date('2026-11-06T20:30:00.000Z');
  const two = decideDeadman({ now, history: [{ day: '2026-11-04', ok: true }, { day: '2026-11-05', ok: false }, { day: '2026-11-06', ok: false }] });
  assert.equal(DEFAULT_THRESHOLD, 2);
  assert.equal(two.streak, 2);
  assert.equal(two.alert, true);

  const one = decideDeadman({ now, history: [{ day: '2026-11-04', ok: true }, { day: '2026-11-05', ok: true }, { day: '2026-11-06', ok: false }] });
  assert.equal(one.alert, false);
});

test('decideDeadman: เตือนซ้ำได้วันละครั้ง (dedup ตาม endDay)', () => {
  const now = new Date('2026-11-06T20:30:00.000Z');
  const history = [{ day: '2026-11-04', ok: true }, { day: '2026-11-05', ok: false }, { day: '2026-11-06', ok: false }];
  const first = decideDeadman({ now, history });
  assert.equal(first.streak, 2);
  assert.equal(first.alert, true);
  const again = decideDeadman({ now, history, lastAlertDay: first.endDay });
  assert.equal(again.alert, false);
  assert.equal(again.suppressed, true);
  // คืนถัดไปยังแดง = endDay ใหม่ → เตือนอีกครั้ง
  const nextNight = decideDeadman({
    now: new Date('2026-11-07T20:30:00.000Z'),
    history: [...history, { day: '2026-11-07', ok: false }],
    lastAlertDay: first.endDay,
  });
  assert.equal(nextNight.alert, true);
});

test('ข้อความแจ้งเตือนบอกจำนวนคืน วันที่ และแยก "ไม่มีผล" ออกจาก "ไม่ผ่าน"', () => {
  const text = buildAlertText({
    streak: 2,
    endDay: '2026-11-06',
    threshold: 2,
    days: [
      { day: '2026-11-06', ok: false, missing: false },
      { day: '2026-11-05', ok: null, missing: true },
    ],
  });
  assert.match(text, /ไม่ผ่านติดกัน 2 คืน/);
  assert.match(text, /2026-11-06/);
  assert.match(text, /2026-11-05 — ไม่พบผล/);
  assert.match(text, /last-run\.log/);
});

test('nightly-report ใช้ creds เจ้าของเดียว (DB → infra/.env) + dry mode ยังพิมพ์ข้อความได้', () => {
  const report = read('tools/nightly-report.mjs');
  assert.match(report, /verify\/telegram-creds\.mjs/, 'ต้อง import creds กลาง ไม่ใช่อ่าน DB เอง');
  assert.match(report, /readTelegramCreds/, 'ต้องใช้ readTelegramCreds()');
  assert.doesNotMatch(report, /docker exec sovereign-db psql/, 'ต้องไม่เหลือโค้ด query DB ซ้ำ');
  assert.match(report, /--dry/, 'ต้องมี dry mode สำหรับทดสอบโดยไม่กวนเจ้าของ');
  assert.match(report, new RegExp("notify\\([^)]*parseMode"), 'ต้องส่ง HTML ได้เหมือนเดิม');
});

test('มี task deadman 03:30 ที่ผูกผ่าน run-hidden.vbs (ไม่มีหน้าต่างเด้ง)', () => {
  const ps = read('tools/register-nightly-task.ps1');
  assert.match(ps, /Sovereign Nightly Deadman/);
  assert.match(ps, /03:30/);
  assert.match(ps, /run-hidden\.vbs/, 'task ต้องผ่าน hidden launcher');
  assert.ok(
    existsSync(join(ROOT, 'tools', 'hidden-tasks', 'sovereign-nightly-deadman.cmd')),
    'ต้องมี command file ของ task deadman',
  );
});
