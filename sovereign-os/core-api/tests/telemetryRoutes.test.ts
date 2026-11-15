// Telemetry routes — คำตอบต้องตรงกับความจริง และคำขอต้องไม่ค้าง
//
// 1) GET /api/telemetry/history ยังไม่ได้ทำ แต่ตอบ `[]`
//    ⇒ ผู้เรียกอ่านว่า "ไม่มีข้อมูล" ทั้งที่ไม่เคยมีข้อมูลให้อ่าน (และไม่รู้ว่าต้องไปใช้
//    /api/timescale/history) — ต้องเป็น 501 พร้อมบอกทางไป endpoint ที่ใช้งานได้
// 2) GET /api/telemetry/latest เป็น async handler ที่ await DB โดยไม่มี try/catch
//    ⇒ Express 4 ไม่ดัก async throw: DB ล่มเมื่อไรคำขอ "ค้าง" จน client timeout
//    ไม่ใช่ 500 (กับดักที่บันทึกไว้ใน AGENTS.md)
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import telemetryRoutes from '../src/modules/telemetry/telemetry.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let calls: Array<{ sql: string; params: any[] }> = [];
let handler: (sql: string, params: any[]) => any = () => [];
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  (prisma as any).$queryRawUnsafe = async (sql: string, ...params: any[]) => {
    calls.push({ sql, params });
    return handler(sql, params);
  };
  server = await createTestServer((app) => app.use('/api/telemetry', telemetryRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  calls = [];
  handler = () => [];
});

test('GET /history ที่ยังไม่ได้ทำ = 501 พร้อมทางไป endpoint จริง (ไม่ใช่ [] ที่อ่านว่า "ไม่มีข้อมูล")', async () => {
  const res = await fetch(server.baseUrl + '/api/telemetry/history?metric=battery_soc', { headers: AUTH });
  assert.equal(res.status, 501);
  const body: any = await res.json();
  assert.equal(body.implemented, false);
  assert.match(String(body.error), /timescale\/history/, 'ต้องบอกว่าให้ไปใช้ endpoint ไหน');
  assert.equal(calls.length, 0, 'endpoint ที่ยังไม่ทำต้องไม่แตะ DB');
});

test('GET /latest — DB ล่ม = 500 ทันที ไม่ใช่คำขอค้างจน timeout', async () => {
  handler = () => {
    throw new Error('db down');
  };
  const res = await fetch(server.baseUrl + '/api/telemetry/latest', {
    headers: AUTH,
    signal: AbortSignal.timeout(4000),
  });
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.ok(String(body.error).length > 0, 'ต้องมีข้อความบอกผู้ใช้');
});

test('GET /latest — คืนค่าล่าสุดของ metric ที่ระบบใช้ และ null เมื่อยังไม่มีข้อมูล', async () => {
  // metric ถูกส่งเป็น parameter ไม่ได้อยู่ใน SQL — ต้องดูจาก params
  handler = (_sql, params) => (params[params.length - 1] === 'battery_soc' ? [{ value: 87.5 }] : []);
  const res = await fetch(server.baseUrl + '/api/telemetry/latest', { headers: AUTH });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.battery_soc, 87.5);
  assert.equal(body.power_kw, null, 'ไม่มีข้อมูล = null ไม่ใช่ 0');
  assert.equal(calls.length, 4, 'ดึง 4 metric ที่ระบบใช้');
});

test('NODE_ADMIN เห็นเฉพาะ node ของตัวเอง — ขอ node อื่น = 403', async () => {
  const token = makeToken('NODE_ADMIN', { assigned_node_id: 'node-a' });
  const res = await fetch(server.baseUrl + '/api/telemetry/latest?node_id=node-b', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0, 'ต้องปฏิเสธก่อนแตะ DB');
});

test('NODE_ADMIN ไม่ระบุ node = บังคับใช้ node ที่ผูกไว้', async () => {
  const token = makeToken('NODE_ADMIN', { assigned_node_id: 'node-a' });
  const res = await fetch(server.baseUrl + '/api/telemetry/latest', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(c.params[0], 'node-a', 'ต้องกรองด้วย node ของตัวเองเสมอ');
});
