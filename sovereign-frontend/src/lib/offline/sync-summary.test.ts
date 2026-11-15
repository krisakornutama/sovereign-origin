// ข้อความหลังกด "Sync ทั้งหมด" ต้องตรงกับความจริงในคิว
//
// ก่อนหน้านี้ OfflineQueuePanel ประกาศ "sync ทั้งหมดสำเร็จ {n} รายการ" ทันทีที่รู้จำนวน
// ที่ส่งสำเร็จ โดยไม่ดูว่าคิวยังเหลืออะไร — แต่รายการที่ server ปฏิเสธถาวร (4xx) ถูก
// "พักไว้ ไม่ลบ" ตามนโยบาย OFFLINE-001 (ข้อมูลผู้ใช้ห้ามหาย) และไม่ถูกส่งซ้ำเอง
// ⇒ ผู้ใช้อ่านว่า "คิวว่างแล้ว" ทั้งที่ยังมีข้อมูลค้างที่ต้องตัดสินใจ = ข้อมูลหายจากสายตา
//
// เทสต์นี้ล็อกกติกา: เหลือของในคิว > 0 = ห้ามใช้ข้อความ "สำเร็จทั้งหมด"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncOutcomeMessage } from './sync-summary';

test('คิวว่างหลัง sync = บอกว่าสำเร็จทั้งหมดได้', () => {
  const o = syncOutcomeMessage(5, 0);
  assert.equal(o.key, 'settings.queue.syncAllDone');
  assert.deepEqual(o.vars, { n: 5 });
  assert.equal(o.tone, 'ok');
});

test('เหลือของที่ถูกพัก = ห้ามบอกว่าสำเร็จทั้งหมด', () => {
  const o = syncOutcomeMessage(2, 3);
  assert.notEqual(o.key, 'settings.queue.syncAllDone', 'เหลือ 3 รายการแต่บอกว่าสำเร็จทั้งหมด = โกหก');
  assert.equal(o.key, 'settings.queue.syncAllPartial');
  assert.deepEqual(o.vars, { n: 2, kept: 3 });
  assert.equal(o.tone, 'warn');
});

test('ส่งไม่ได้สักรายการ = บอกตรง ๆ ว่ายังไม่ได้ส่ง', () => {
  const o = syncOutcomeMessage(0, 4);
  assert.equal(o.key, 'settings.queue.syncAllNone');
  assert.deepEqual(o.vars, { kept: 4 });
  assert.equal(o.tone, 'warn');
});

test('ค่าติดลบ/เศษทศนิยมต้องไม่หลุดเป็นข้อความแปลก', () => {
  const clamped = syncOutcomeMessage(2, -3);
  assert.equal(clamped.key, 'settings.queue.syncAllDone');
  assert.deepEqual(clamped.vars, { n: 2 });

  const truncated = syncOutcomeMessage(1.7, 2.9);
  assert.equal(truncated.key, 'settings.queue.syncAllPartial');
  assert.deepEqual(truncated.vars, { n: 1, kept: 2 });
});
