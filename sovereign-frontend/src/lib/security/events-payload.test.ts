// "0 เหตุการณ์" กับ "อ่านไม่ได้" ต้องไม่ถูกแสดงเหมือนกัน
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventsPayload } from './events-payload';

test('รูปแบบใหม่ { events, degraded } อ่านได้', () => {
  const v = parseEventsPayload({
    events: [{ id: 'e1', event_type: 'INTRUSION', severity: 'critical' }],
    degraded: false,
  });
  assert.equal(v.events.length, 1);
  assert.equal(v.degraded, false);
  assert.equal(v.reason, '');
});

test('degraded: true พร้อมเหตุผล ต้องถูกส่งต่อให้ UI พูดว่า "ไม่รู้"', () => {
  const v = parseEventsPayload({ events: [], degraded: true, reason: 'อ่าน DB ไม่ได้' });
  assert.equal(v.events.length, 0);
  assert.equal(v.degraded, true);
  assert.match(v.reason, /อ่าน DB ไม่ได้/);
});

test('array ล้วน (mock/preview เก่า) ยังใช้ได้', () => {
  const v = parseEventsPayload([{ id: 'e1' }, { id: 'e2' }]);
  assert.equal(v.events.length, 2);
  assert.equal(v.degraded, false);
});

test('payload ผิดรูปต้องไม่ทำให้หน้าเว็บ crash', () => {
  for (const bad of [null, undefined, 'oops', 42, {}, { events: 'nope' }]) {
    const v = parseEventsPayload(bad);
    assert.ok(Array.isArray(v.events), 'ต้องได้ array เสมอ');
    assert.equal(v.events.length, 0);
    assert.equal(v.degraded, false);
  }
});
