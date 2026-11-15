// Role gates for relay (actuator) control — SEC-045
//
// ปัญหาจริง: `POST /api/relay/control` และ CRUD ของ `/schedules` ล็อกแค่
// `authenticate` ⇒ บัญชีที่ล็อกอินได้ทุก role (รวม SYSTEM_AI / SITE_ADMIN ที่
// ประกาศว่า "อ่านได้เท่านั้น" / KID) สั่งสลับรีเลย์จริงในบ้านได้
// และตารางเวลา (schedule) ที่ตั้งไว้จะทำงานเองแม้ไม่มีใครอยู่หน้าเว็บ
//
// กติกาที่ล็อกไว้: การสั่งงานฮาร์ดแวร์ = SUPERADMIN / NODE_ADMIN / OPERATOR
// (ตรงกับ actuation + energy) — AI และบัญชีอ่านอย่างเดียวต้องไม่ได้
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import relayRoutes from '../src/modules/relay/relay.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

let relay: TestServer;

before(async () => {
  relay = await createTestServer((app) => app.use('/api/relay', relayRoutes));
});

after(async () => {
  if (relay) await relay.close();
});

const DENIED_ROLES = ['SYSTEM_AI', 'SITE_ADMIN', 'KID'];
const ALLOWED_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

function call(path: string, method: string, body: unknown, token?: string) {
  return fetch(relay.baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('POST /control: ไม่มี token = 401', async () => {
  const res = await call('/api/relay/control', 'POST', { relayId: 'r1', state: 1 });
  assert.equal(res.status, 401);
});

test('POST /control: SYSTEM_AI / SITE_ADMIN / KID โดน 403 (ห้ามสั่งฮาร์ดแวร์)', async () => {
  for (const role of DENIED_ROLES) {
    const res = await call('/api/relay/control', 'POST', { relayId: 'r1', state: 1 }, makeToken(role));
    assert.equal(res.status, 403, `${role} ต้องถูกปฏิเสธ`);
  }
});

test('POST /control: role ที่มีสิทธิ์ไม่โดน 403 (ด่านไม่บล็อกคนที่ควรสั่งได้)', async () => {
  for (const role of ALLOWED_ROLES) {
    const res = await call('/api/relay/control', 'POST', { relayId: 'r1', state: 1 }, makeToken(role));
    assert.notEqual(res.status, 403, `${role} ไม่ควรถูกบล็อกด้วย role gate`);
  }
});

test('POST /schedules: SYSTEM_AI / SITE_ADMIN / KID โดน 403', async () => {
  for (const role of DENIED_ROLES) {
    const res = await call('/api/relay/schedules', 'POST', { relayId: 'r1', time: '08:00', days: '*', state: 1 }, makeToken(role));
    assert.equal(res.status, 403, `${role} ต้องตั้งตารางสั่งฮาร์ดแวร์ไม่ได้`);
  }
});

test('DELETE /schedules/:id: SYSTEM_AI โดน 403', async () => {
  const res = await call(`/api/relay/schedules/${'00000000-0000-0000-0000-000000000000'}`, 'DELETE', undefined, makeToken('SYSTEM_AI'));
  assert.equal(res.status, 403);
});

test('GET /status ยังเปิดให้ทุก role ที่ล็อกอินแล้ว (การอ่านไม่ถูกบล็อก)', async () => {
  const res = await call('/api/relay/status', 'GET', undefined, makeToken('SITE_ADMIN'));
  assert.notEqual(res.status, 403);
});
