// test/single-instance.test.mjs — กัน runner เปิดซ้อนสองตัว
//
// เจอจริง 31/10/69 บนเครื่อง 2: autostart ติดตั้งทั้ง Startup folder และ Scheduled Task
// ⇒ Windows เปิด runner สองโปรเซส ⇒ ทั้งคู่ long-poll `/api/machine-control/next` พร้อมกัน
// ⇒ HUB ปลด poll เก่าด้วย null ทุกครั้งที่มี poll ใหม่ ⇒ วน ~22 requests/วินาทีตลอดเวลา
//
// ทางแก้: ให้ runner จอง port loopback ตัวเดียวตอนบูต — ตัวที่สองออกทันที (exit 0)
// ใช้ port ไม่ใช่ไฟล์ lock เพราะ OS คืน port เองเมื่อโปรเซสตาย (ไม่มีไฟล์ค้างให้ลบมือ)
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LOCK_PORT, acquireSingleInstance } from '../src/single-instance.mjs';

const PORT = 49888;

/** ปิด server แบบรอจริง เพื่อไม่ให้ port ค้างไปข้ามเทสต์ */
function close(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
  });
}

test('acquireSingleInstance: ตัวแรกได้ lock', async () => {
  const first = await acquireSingleInstance({ port: PORT });
  assert.equal(first.ok, true);
  assert.ok(first.server, 'ต้องได้ server ที่ถือ port ไว้');
  await close(first.server);
});

test('acquireSingleInstance: ตัวที่สองต้องถูกปฏิเสธ (already-running)', async () => {
  const first = await acquireSingleInstance({ port: PORT });
  const second = await acquireSingleInstance({ port: PORT });

  assert.equal(second.ok, false, 'ต้องไม่ให้มี runner สองตัว');
  assert.equal(second.reason, 'already-running');
  assert.equal(second.server, null);

  await close(first.server);
});

test('acquireSingleInstance: ปล่อย lock แล้วตัวใหม่เข้าได้ (ไม่ค้างถาวร)', async () => {
  const first = await acquireSingleInstance({ port: PORT });
  await close(first.server);

  const second = await acquireSingleInstance({ port: PORT });
  assert.equal(second.ok, true);
  await close(second.server);
});

test('acquireSingleInstance: bind ไม่ได้ด้วยเหตุอื่น = fail-open (ห้ามกัน runner ไม่ให้ทำงาน)', async () => {
  // ที่อยู่ที่ bind ไม่ได้แต่ไม่ใช่ EADDRINUSE — ต้องไม่ทำให้เครื่องหลุดจาก HUB
  const result = await acquireSingleInstance({ port: PORT, host: '203.0.113.1' });
  assert.equal(result.ok, true);
  assert.match(String(result.reason ?? ''), /bind-failed/);
  await close(result.server);
});

test('DEFAULT_LOCK_PORT: ค่าคงที่และเปลี่ยนได้ด้วย env (ไม่ชนกับพอร์ตบริการ)', () => {
  assert.equal(typeof DEFAULT_LOCK_PORT, 'number');
  assert.ok(DEFAULT_LOCK_PORT > 1024 && DEFAULT_LOCK_PORT < 65536);
});
