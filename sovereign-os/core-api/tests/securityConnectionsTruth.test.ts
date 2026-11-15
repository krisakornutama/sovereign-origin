// ตาราง "Active Connections" ของหน้า /security ต้องเป็นของจริง หรือบอกว่า "อ่านไม่ได้"
//
// ก่อนหน้านี้ GET /api/security/connections ตกไปคืน **ข้อมูลจำลอง 2 แถว** เมื่อเรียก netstat ไม่ได้
// (192.168.1.100:3001 → 10.12.55.5:54321, pid 1234) โดยไม่มีเครื่องหมายใด ๆ ว่าเป็นของปลอม
// ⇒ หน้าความปลอดภัยแสดง "การเชื่อมต่อที่กำลังใช้งาน" ที่ไม่มีอยู่จริง = หลักฐานความปลอดภัยเท็จ
// และเลข 0/2 บนการ์ดก็อ่านผิดความหมาย (0 ที่แปลว่า "ไม่มี" กับ 0 ที่แปลว่า "ไม่รู้" ต่างกัน)
//
// เทสต์นี้ล็อกกติกา: อ่านไม่ได้ = connections ว่าง + degraded: true + เหตุผล ห้ามมีแถวปลอม
import './setup-env';
import { test, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import securityRoutes from '../src/modules/security/security.routes';
import {
  hostConnections,
  parseEstablishedConnections,
} from '../src/services/host-connections.service';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  server = await createTestServer((app) => app.use('/api/security', securityRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

afterEach(() => {
  mock.restoreAll();
});

test('parseEstablishedConnections: อ่าน netstat จริงได้ และข้ามบรรทัดหัวตาราง', () => {
  const stdout = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:3001         127.0.0.1:54321        ESTABLISHED     4242',
    '  TCP    10.12.55.234:5432      10.12.55.9:51000       ESTABLISHED     991',
    '',
  ].join('\r\n');

  const rows = parseEstablishedConnections(stdout);
  assert.equal(rows.length, 2, 'ต้องได้ 2 แถว (หัวตารางไม่นับ)');
  assert.deepEqual(rows[0], {
    protocol: 'TCP',
    local_address: '127.0.0.1:3001',
    foreign_address: '127.0.0.1:54321',
    state: 'ESTABLISHED',
    pid: '4242',
  });
});

test('อ่าน netstat ไม่ได้ = บอกตรง ๆ (degraded) ไม่ใช่คืนแถวปลอม', async () => {
  mock.method(hostConnections, 'read', async () => {
    throw new Error('findstr: command not found');
  });

  const res = await fetch(server.baseUrl + '/api/security/connections', { headers: AUTH });
  assert.equal(res.status, 200);
  const body: any = await res.json();

  assert.ok(Array.isArray(body.connections), 'ต้องมี connections เป็น array (ว่างก็ได้)');
  assert.equal(body.connections.length, 0, 'ห้ามคืนแถวที่ไม่ได้มาจากโฮสต์');
  assert.equal(body.degraded, true, 'ต้องบอกว่าเป็นสถานะอ่านไม่ได้');
  assert.ok(String(body.reason).length > 0, 'ต้องบอกเหตุผลให้ผู้ใช้รู้');

  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('192.168.1.100'), 'ห้ามมีแถวจำลองเดิมหลุดมา');
  assert.ok(!raw.includes('1234'), 'ห้ามมี pid จำลองหลุดมา');
});

test('อ่านได้ = ส่งของจริงพร้อม degraded: false', async () => {
  mock.method(hostConnections, 'read', async () => [
    {
      protocol: 'TCP',
      local_address: '127.0.0.1:3001',
      foreign_address: '10.12.55.9:51000',
      state: 'ESTABLISHED',
      pid: '991',
    },
  ]);

  const res = await fetch(server.baseUrl + '/api/security/connections', { headers: AUTH });
  const body: any = await res.json();
  assert.equal(body.degraded, false);
  assert.equal(body.connections.length, 1);
  assert.equal(body.connections[0].foreign_address, '10.12.55.9:51000');
});

test('ต้องยืนยันตัวตนก่อน — ไม่มี token = 401 (ไม่ใช่รายการเชื่อมต่อ)', async () => {
  const res = await fetch(server.baseUrl + '/api/security/connections');
  assert.equal(res.status, 401);
});
