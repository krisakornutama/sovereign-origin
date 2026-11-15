// Timescale (หน้า /history + /energy + trend ใน dashboard): อ่านไม่ได้ต้องไม่ตอบ "ว่าง"
//
// ก่อนหน้านี้:
//   GET /api/timescale/metrics → catch { res.json([]) } = **200 []**
//   GET /api/timescale/history  → catch { res.status(500).json([]) } = **500 []**
// ⇒ หน้า /history เห็น `metrics = []` แล้วขึ้น "ยังไม่มีข้อมูลเซ็นเซอร์ในฐานข้อมูล — รอข้อมูลจาก MQTT"
//   ทั้งที่ความจริงคือ DB อ่านไม่ได้ · และ /history ที่ 500 พร้อม `[]` ก็ทำให้ผู้เรียกที่อ่าน body
//   ก่อน status เข้าใจว่า "ไม่มีข้อมูลในช่วงนี้"
//
// นโยบายเดียวกับ SEC-023/SEC-027: read failure = 500 + เหตุผล (+ degraded สำหรับ list)
// และ `/metrics` ต้องไม่ส่งชื่อ metric ที่ว่าง/null ออกไป (ผู้เรียกเอาไปต่อ query ไม่ได้)
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import timescaleRoutes from '../src/modules/timescale/timescale.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let calls: string[] = [];
let mode: 'ok' | 'fail' = 'ok';
let rows: Array<Record<string, any>> = [];
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    calls.push(String(sql));
    if (mode === 'fail') throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    return rows;
  };
  server = await createTestServer((app) => app.use('/api/timescale', timescaleRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  calls = [];
  mode = 'ok';
  rows = [];
});

function get(path: string) {
  return fetch(server.baseUrl + path, { headers: AUTH });
}

test('/metrics: อ่าน DB ไม่ได้ = 500 + degraded (ไม่ใช่ 200 [])', async () => {
  mode = 'fail';
  const res = await get('/api/timescale/metrics');
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.equal(body.degraded, true);
  assert.deepEqual(body.metrics, []);
  assert.match(String(body.error), /metric/i);
  assert.ok(String(body.detail || '').length > 0, 'ต้องมี detail ให้ผู้ดูแลเห็นสาเหตุ');
});

test('/metrics: อ่านได้ = 200 { metrics, degraded:false } (รูปแบบเดียวกับ sensors)', async () => {
  rows = [{ metric: 'battery_soc' }, { metric: 'power_kw' }];
  const res = await get('/api/timescale/metrics');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.metrics, ['battery_soc', 'power_kw']);
  assert.equal(body.degraded, false);
});

test('/metrics: ชื่อ metric ที่ว่าง/null ต้องไม่หลุดออกไป', async () => {
  rows = [{ metric: 'soil_moisture' }, { metric: null }, { metric: '   ' }];
  const res = await get('/api/timescale/metrics');
  const body: any = await res.json();
  assert.deepEqual(body.metrics, ['soil_moisture']);
});

test('/history: อ่าน DB ไม่ได้ = 500 + เหตุผล (ไม่ใช่ 500 [] ที่อ่านว่า "ไม่มีข้อมูล")', async () => {
  mode = 'fail';
  const res = await get('/api/timescale/history?metric=battery_soc&range=7d');
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.match(String(body.error), /ประวัติ|history|อ่าน/i);
  assert.deepEqual(body.buckets, []);
  assert.ok(String(body.detail || '').length > 0);
});

test('/history: สำเร็จยังคืน array ตรง ๆ (dashboard/energy อ่านแบบ array)', async () => {
  rows = [{ bucket: '2026-01-01T00:00:00.000Z', metric: 'battery_soc', avg_value: 55, min_value: 50, max_value: 60 }];
  const res = await get('/api/timescale/history?metric=battery_soc&range=24h');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.ok(Array.isArray(body), 'success ต้องคงรูป array เดิม');
  assert.equal(body[0].avg_value, 55);
});
