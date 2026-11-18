// Role gates for device writes — SEC-047
//
// ปัญหาจริง: `PUT /api/devices/:id` ล็อกแค่ `authenticate` ขณะที่
//   POST '/'            = SUPERADMIN / NODE_ADMIN
//   DELETE '/:id'       = SUPERADMIN
// ⇒ บัญชีที่ล็อกอินได้ทุก role (รวม SYSTEM_AI, SITE_ADMIN ที่ประกาศว่า read-only, KID)
//   แก้ `mqtt_topic` ของอุปกรณ์ได้ = เปลี่ยนปลายทางของคำสั่งสั่งงานฮาร์ดแวร์
//
// กติกา: การแก้ค่าอุปกรณ์ = ชุดเดียวกับงานสั่งการ (SUPERADMIN / NODE_ADMIN / OPERATOR)
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import deviceRoutes from '../src/modules/devices/device.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

let devices: TestServer;
const ANY_UUID = '11111111-1111-4111-8111-111111111111';

before(async () => {
  devices = await createTestServer((app) => app.use('/api/devices', deviceRoutes));
});

after(async () => {
  if (devices) await devices.close();
});

function call(path: string, method: string, body: unknown, token?: string) {
  return fetch(devices.baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const DENIED_ROLES = ['SYSTEM_AI', 'SITE_ADMIN', 'KID'];
const ALLOWED_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

test('PUT /devices/:id: ไม่มี token = 401', async () => {
  const res = await call(`/api/devices/${ANY_UUID}`, 'PUT', { is_active: false });
  assert.equal(res.status, 401);
});

test('PUT /devices/:id: SYSTEM_AI / SITE_ADMIN / KID โดน 403 (แก้ mqtt_topic อุปกรณ์ไม่ได้)', async () => {
  for (const role of DENIED_ROLES) {
    const res = await call(`/api/devices/${ANY_UUID}`, 'PUT', { mqtt_topic: 'evil/topic' }, makeToken(role));
    assert.equal(res.status, 403, `${role} ต้องถูกปฏิเสธ`);
  }
});

test('PUT /devices/:id: role ที่มีสิทธิ์ไม่โดน 403 (ด่านไม่ over-block)', async () => {
  for (const role of ALLOWED_ROLES) {
    const res = await call(`/api/devices/${ANY_UUID}`, 'PUT', { is_active: true }, makeToken(role));
    assert.notEqual(res.status, 403, `${role} ไม่ควรถูกบล็อกด้วย role gate`);
  }
});

test('DELETE /devices/:id: ยัง SUPERADMIN เท่านั้น (NODE_ADMIN โดน 403)', async () => {
  const res = await call(`/api/devices/${ANY_UUID}`, 'DELETE', undefined, makeToken('NODE_ADMIN'));
  assert.equal(res.status, 403);
});
