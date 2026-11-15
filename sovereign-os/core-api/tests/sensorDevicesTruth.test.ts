// sensors: อุปกรณ์ (devices) + ลิสต์ค่าที่อ่านไม่ได้ — สิทธิ์และความจริงของคำตอบ
//
// 1) POST/DELETE /api/sensors/devices ใช้แค่ `authenticate` ⇒ บัญชี KID/SYSTEM_AI
//    เพิ่มหรือลบอุปกรณ์ของบ้านได้ (ลบอุปกรณ์ = ข้อมูล config/ประวัติผูกกับอุปกรณ์หาย)
// 2) `type` ไม่ถูกตรวจเลย และ `name` ถูกใช้สร้าง mqtt_topic ดิบ ๆ ⇒ ชื่อที่มี `/`,
//    `+`, `#` กลายเป็น topic pattern ที่กว้างเกินตั้งใจ (subscribe `#` = รับทุก topic)
//    และ `name` ที่ผู้ใช้พิมพ์ไม่ได้ถูกเก็บที่ไหนเลย (ตาราง devices ไม่มีคอลัมน์ name)
// 3) อ่าน DB ไม่ได้ = `GET /devices` ตอบ 500 + `[]` และ `/all` ตอบ 500 + `[]`
//    ⇒ หน้าเว็บขึ้น "0 อุปกรณ์ / ไม่มีข้อมูล" ทั้งที่ความจริงคือ "อ่านไม่ได้"
// 4) DELETE id ที่ไม่ใช่ uuid ⇒ Prisma P2023 → 500 "ลบไม่สำเร็จ" (ไม่บอกอะไรเลย)
//    และ id ที่ไม่มีจริงก็ 500 — ควรแยก 400 (รูปแบบผิด) กับ 404 (ไม่มีจริง)
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sensorRoutes from '../src/modules/sensors/sensor.routes';
import sensorDataRoutes from '../src/modules/sensors/sensor-data.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let devicesServer: TestServer;
let dataServer: TestServer;
let created: any[] = [];
let deleted: string[] = [];
let findManyImpl: () => Promise<any[]> = async () => [];
let deleteImpl: (id: string) => Promise<any> = async () => ({ id: 'x' });
let rawCalls: string[] = [];
let rawHandler: (sql: string) => any = () => [];

const asRole = (role: string) => ({
  Authorization: `Bearer ${makeToken(role)}`,
  'Content-Type': 'application/json',
});

before(async () => {
  mockModel(prisma, 'device', {
    findMany: async () => findManyImpl(),
    create: async ({ data }: any) => {
      const row = { id: `dev-${created.length + 1}`, last_heartbeat: null, ...data };
      created.push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      deleted.push(where.id);
      return deleteImpl(where.id);
    },
  });
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    rawCalls.push(sql);
    return rawHandler(sql);
  };
  devicesServer = await createTestServer((app) => app.use('/api/sensors', sensorRoutes));
  dataServer = await createTestServer((app) => app.use('/api/sensors', sensorDataRoutes));
});

after(async () => {
  if (devicesServer) await devicesServer.close();
  if (dataServer) await dataServer.close();
});

beforeEach(() => {
  created = [];
  deleted = [];
  rawCalls = [];
  findManyImpl = async () => [];
  rawHandler = () => [];
  deleteImpl = async (id: string) => ({ id });
});

function req(base: string, path: string, method: string, body?: unknown, role = 'SUPERADMIN') {
  return fetch(base + path, {
    method,
    headers: asRole(role),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('KID เพิ่มอุปกรณ์ไม่ได้ (403) และไม่แตะ DB', async () => {
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'POST', { name: 'x', type: 'ESP32' }, 'KID');
  assert.equal(res.status, 403);
  assert.equal(created.length, 0);
});

test('SYSTEM_AI ลบอุปกรณ์ไม่ได้ (403) และไม่แตะ DB', async () => {
  const res = await req(
    devicesServer.baseUrl,
    '/api/sensors/devices/aaaaaaaa-0000-4000-8000-000000000001',
    'DELETE',
    undefined,
    'SYSTEM_AI'
  );
  assert.equal(res.status, 403);
  assert.deepEqual(deleted, []);
});

test('ไม่ส่ง type = 400 (เดิมสร้างแถวที่ type เป็น undefined แล้ว 500)', async () => {
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'POST', { name: 'x' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /type/);
  assert.equal(created.length, 0);
});

test('type ที่ยาว/มีอักขระแปลก = 400', async () => {
  for (const type of ['A'.repeat(40), 'ESP32<script>', '']) {
    const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'POST', { type });
    assert.equal(res.status, 400, `type=${JSON.stringify(type)}`);
  }
  assert.equal(created.length, 0);
});

test('mqtt_topic ถูกสร้างจาก name ที่ปลอดภัย — ชื่อไทยยังใช้ได้ แต่ / + # ถูกตัดออก', async () => {
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'POST', {
    name: 'โรงเรือน 1/#',
    type: 'ESP32',
  });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.equal(body.mqtt_topic, 'sovereign/โรงเรือน-1/sensor/+');
  assert.equal(created.length, 1);
});

test('ไม่ส่ง name = topic ใช้ค่าเริ่มต้น ไม่มี segment ว่าง', async () => {
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'POST', { type: 'ESP8266' });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.equal(body.mqtt_topic, 'sovereign/device/sensor/+');
});

test('DELETE id ที่ไม่ใช่ uuid = 400 ก่อนแตะ Prisma', async () => {
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices/not-a-uuid', 'DELETE');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /id/);
  assert.deepEqual(deleted, []);
});

test('DELETE id ที่ไม่มีจริง = 404 (ไม่ใช่ 500 ที่อ่านไม่ออก)', async () => {
  deleteImpl = async () => {
    const err: any = new Error('Record to delete does not exist.');
    err.code = 'P2025';
    throw err;
  };
  const res = await req(
    devicesServer.baseUrl,
    '/api/sensors/devices/aaaaaaaa-0000-4000-8000-0000000000ff',
    'DELETE'
  );
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /ไม่พบ|not found/i);
});

test('DELETE ที่สำเร็จยังคืน success (ไม่เข้มเกิน)', async () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  const res = await req(devicesServer.baseUrl, `/api/sensors/devices/${id}`, 'DELETE');
  assert.equal(res.status, 200);
  assert.deepEqual(deleted, [id]);
});

test('GET /devices อ่าน DB ไม่ได้ = degraded: true + เหตุผล (ไม่ใช่ "0 อุปกรณ์")', async () => {
  findManyImpl = async () => {
    throw new Error('db down');
  };
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'GET');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.devices, []);
  assert.equal(body.degraded, true);
  assert.ok(String(body.reason).length > 0);
});

test('GET /devices อ่านได้ = degraded: false + อุปกรณ์จริง', async () => {
  findManyImpl = async () => [{ id: 'd1', type: 'ESP32', mqtt_topic: 'sovereign/d1/sensor/+', is_active: true, last_heartbeat: new Date() }];
  const res = await req(devicesServer.baseUrl, '/api/sensors/devices', 'GET');
  const body: any = await res.json();
  assert.equal(body.degraded, false);
  assert.equal(body.devices.length, 1);
  assert.equal(body.devices[0].online, true);
});

test('GET /all อ่าน DB ไม่ได้ = 500 พร้อม error + records: [] (ไม่ใช่ array ว่างเปล่า)', async () => {
  rawHandler = () => {
    throw new Error('db down');
  };
  const res = await fetch(dataServer.baseUrl + '/api/sensors/all', {
    headers: { Authorization: `Bearer ${makeToken('SUPERADMIN')}` },
  });
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.ok(String(body.error).length > 0);
  assert.deepEqual(body.records, []);
});

test('GET /metrics อ่าน DB ไม่ได้ = 500 พร้อม error + metrics: [] (ไม่ใช่ 200 [])', async () => {
  rawHandler = () => {
    throw new Error('db down');
  };
  const res = await fetch(dataServer.baseUrl + '/api/sensors/metrics', {
    headers: { Authorization: `Bearer ${makeToken('SUPERADMIN')}` },
  });
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.ok(String(body.error).length > 0);
  assert.deepEqual(body.metrics, []);
});
