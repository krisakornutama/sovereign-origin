// src/lib/offline/queue-rejection.test.ts — pure spec ของ "คำขอที่ถูกปฏิเสธถาวร"
//
// ทำไมต้องมี: offline queue เดิม retry ทุกอย่างที่ไม่ใช่ 2xx ทุกครั้งที่กลับ online
// → คำขอที่ผิดถาวร (400/404/409/422) ถูกยิงซ้ำตลอดกาล และคิวไม่เคยว่าง
// นโยบายที่เทสต์นี้ยึด: 4xx ที่ตัดสินว่าถาวร = "พัก" ไม่ใช่ "ลบ" (ข้อมูลผู้ใช้ห้ามหาย)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RETRYABLE_4XX,
  classifyFlushStatus,
  isQuiesced,
  shouldAttempt,
  withRejection,
  withoutRejection,
} from './queue-rejection';

const base = {
  id: 7,
  url: '/api/users/1',
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer old' },
  body: '{"name":"สมชาย"}',
  queuedAt: '2026-11-01T00:00:00.000Z',
  userId: 'u1',
} as const;

test('2xx = ok (ลบออกจากคิวได้)', () => {
  for (const status of [200, 201, 204, 299]) assert.equal(classifyFlushStatus(status), 'ok', String(status));
});

test('4xx ที่ผิดถาวร = rejected (พักไว้ ไม่ยิงซ้ำอัตโนมัติ)', () => {
  for (const status of [400, 401, 403, 404, 409, 410, 422, 451]) {
    assert.equal(classifyFlushStatus(status), 'rejected', String(status));
  }
});

test('4xx ที่ยังมีโอกาสสำเร็จ = retry (timeout / too early / rate limit)', () => {
  for (const status of [408, 425, 429]) {
    assert.ok(RETRYABLE_4XX.has(status), `${status} ต้องอยู่ในชุดที่ลองใหม่ได้`);
    assert.equal(classifyFlushStatus(status), 'retry', String(status));
  }
});

test('5xx และค่าผิดปกติ = retry (ฝั่ง server อาจฟื้น / ไม่ใช่ความผิดของคำขอ)', () => {
  for (const status of [500, 502, 503, 504, 0, -1, Number.NaN]) {
    assert.equal(classifyFlushStatus(status), 'retry', String(status));
  }
});

test('withRejection ติดป้ายพร้อมเวลา และไม่แตะ object เดิม (payload ยังอยู่ครบ)', () => {
  const marked = withRejection(base, 400, new Date('2026-11-12T03:00:00.000Z'));
  assert.deepEqual(marked.lastRejection, { status: 400, at: '2026-11-12T03:00:00.000Z' });
  assert.equal(marked.body, base.body, 'body ต้องไม่หาย — ผู้ใช้ต้องกดลองใหม่ด้วยของเดิมได้');
  assert.deepEqual(marked.headers, base.headers);
  assert.equal(marked.userId, 'u1');
  assert.equal((base as { lastRejection?: unknown }).lastRejection, undefined, 'ต้องไม่แก้ object เดิม');
});

test('withRejection ใช้เวลาปัจจุบันได้ (number seed) และป้ายรอด JSON round-trip (structured clone)', () => {
  const marked = withRejection({ ...base }, 404, 1_700_000_000_000);
  assert.equal(marked.lastRejection?.at, new Date(1_700_000_000_000).toISOString());
  const cloned = JSON.parse(JSON.stringify(marked));
  assert.equal(cloned.lastRejection.status, 404, 'IDB เก็บ object ผ่าน structured clone — ต้องไม่พัง');
});

test('isQuiesced / shouldAttempt: ป้ายมีผลกับ flush อัตโนมัติเท่านั้น', () => {
  assert.equal(isQuiesced(base), false);
  assert.equal(shouldAttempt(base), true);

  const marked = withRejection(base, 409);
  assert.equal(isQuiesced(marked), true);
  assert.equal(shouldAttempt(marked), false);
});

test('withoutRejection ถอดป้ายออกโดยไม่แตะ field อื่น (ผู้ใช้สั่งลองใหม่แบบสะอาด)', () => {
  const marked = withRejection(base, 400);
  const clean = withoutRejection(marked);
  assert.equal(clean.lastRejection, undefined);
  assert.equal(clean.body, base.body);
  assert.equal(clean.userId, base.userId);
  assert.ok(marked.lastRejection, 'ของเดิมต้องยังมีป้ายอยู่');
});
