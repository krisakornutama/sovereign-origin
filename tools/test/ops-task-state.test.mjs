// tools/test/ops-task-state.test.mjs
//
// ── task ที่ "ปิดตั้งใจ" ต้องไม่ถูกนับเป็น task ล้ม ─────────────────────────
// เคสจริง: QUEUE สั่ง disable ShipShop3000 (23:59) เพราะสคริปต์เก่ารอ health
// นานเกินแล้วเปิด browser ทิ้งไว้ · แต่ Task Scheduler ยังเก็บ LastTaskResult=1
// ของรอบสุดท้าย ⇒ ops-status/STATUS.md จะฟ้อง "task ล้ม" ตลอดไปทั้งที่ปิดแล้ว
//
// กติกาที่ล็อก:
//   · State=Disabled → ok=null + disabled=true + ข้อความ "ปิดอยู่ (ตั้งใจ)"
//   · task ปกติยัง decode ตามรหัสเดิมทุกตัว (0, 0x41303, 0x800710E0, อื่น ๆ)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTaskResult } from '../ops-task-state.mjs';

test('Disabled = ไม่ใช่ความล้ม (ok null) แม้ LastTaskResult จะเป็น 1', () => {
  const r = decodeTaskResult(1, 'Disabled');
  assert.equal(r.ok, null);
  assert.equal(r.disabled, true);
  assert.match(r.text, /ปิดอยู่/);
});

test('task ปกติยัง decode ตามรหัสเดิมครบ', () => {
  assert.deepEqual(decodeTaskResult(0), { ok: true, text: 'OK' });
  // 0x41303 = 267011 = "ยังไม่เคยรัน" (คนละตัวกับ 0x41301 = กำลังรัน)
  assert.deepEqual(decodeTaskResult(267011), { ok: true, text: 'ยังไม่เคยรัน (0x41303)' });
  assert.deepEqual(decodeTaskResult(267009), { ok: true, text: 'กำลังรัน (0x41301)' });
  assert.equal(decodeTaskResult(2147946720).ok, false);
  assert.match(decodeTaskResult(2147946720).text, /ถูกบล็อกเงื่อนไข/);
  assert.deepEqual(decodeTaskResult(1), { ok: false, text: '0x00000001' });
});

test('state ว่าง/ไม่รู้จัก = ใช้รหัสเดิม (ไม่กลืนความล้ม)', () => {
  assert.equal(decodeTaskResult(1, '').ok, false);
  assert.equal(decodeTaskResult(1, 'Ready').ok, false);
  assert.equal(decodeTaskResult(1, undefined).ok, false);
});
