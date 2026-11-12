// เทสต์กติกา "ข้อความลบข้อมูลต้องตรงกับผลจาก server" (red-first ก่อนแก้ SensorsHub.deleteAll)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteRejection, deleteFailureMessage } from './delete-outcome';

const fakeT = (_key: string, fallback?: string) => fallback || _key;

test('2xx + success ไม่ใช่ rejection', () => {
  assert.equal(deleteRejection(200, { success: true }), null);
  assert.equal(deleteRejection(204, null), null);
});

test('403 = forbidden (ไม่ใช่ "ลบแล้ว")', () => {
  assert.equal(deleteRejection(403, { error: 'Insufficient role' }), 'forbidden');
  assert.match(deleteFailureMessage('forbidden', 403, null, fakeT), /ไม่มีสิทธิ์ลบข้อมูลเทเลเมตรี/);
});

test('500 / 404 = failed', () => {
  assert.equal(deleteRejection(500, { error: 'ลบไม่สำเร็จ' }), 'failed');
  assert.equal(deleteRejection(404, null), 'failed');
});

test('200 แต่ success:false = failed (ไม่ใช่สำเร็จ)', () => {
  assert.equal(deleteRejection(200, { success: false, error: 'ไม่พบข้อมูล' }), 'failed');
});

test('ข้อความ failed ต้องบอก error จาก server และ status', () => {
  const msg = deleteFailureMessage('failed', 500, { error: 'db down' }, fakeT);
  assert.match(msg, /db down/);
  assert.match(msg, /500/);
});
