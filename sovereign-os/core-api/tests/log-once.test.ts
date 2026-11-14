// log-once: ตอน DB ใช้ไม่ได้ แอปต้องบอกเหตุครั้งเดียว ไม่สแปม stderr ทุกคำขอ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogOnce } from '../src/lib/log-once.js';

function harness(windowMs = 300_000) {
  let now = 1_000_000;
  const out: string[] = [];
  const logOnce = createLogOnce({ windowMs, now: () => now, log: (m) => out.push(m) });
  return { out, logOnce, advance: (ms: number) => (now += ms) };
}

test('ครั้งแรกพิมพ์เต็ม ส่วนครั้งต่อไปที่ซ้ำกันถูกกลืน', () => {
  const { out, logOnce } = harness();
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  assert.equal(out.length, 1);
  assert.equal(out[0], 'Failed to record anomaly: table missing');
});

test('เมื่อผ่านหน้าต่างเวลา ออกสรุปพร้อมจำนวนที่กลืนไป', () => {
  const { out, logOnce, advance } = harness(60_000);
  logOnce('anomaly', 'boom');
  logOnce('anomaly', 'boom');
  logOnce('anomaly', 'boom');
  advance(60_001);
  logOnce('anomaly', 'boom');
  assert.equal(out.length, 2);
  assert.match(out[1], /^boom — ซ้ำ 2 ครั้ง/);
});

test('key ต่างกันนับแยก และสรุปของ key หนึ่งไม่กลืนของอีก key', () => {
  const { out, logOnce } = harness();
  logOnce('a', 'A1');
  logOnce('b', 'B1');
  logOnce('a', 'A1');
  assert.deepEqual(out, ['A1', 'B1']);
});

test('ข้อความที่เปลี่ยนไปภายใต้ key เดียวกันยังถูกกลืน (กันสแปมจาก error ที่มี id)', () => {
  const { out, logOnce } = harness();
  logOnce('anomaly', 'id 1');
  logOnce('anomaly', 'id 2');
  assert.equal(out.length, 1);
});
