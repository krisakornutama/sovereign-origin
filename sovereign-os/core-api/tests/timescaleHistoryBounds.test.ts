// ประวัติ Timescale ต้องมีเพดานจำนวนจุด — ก่อนหน้านี้ `from`/`to` คุมได้หมด
//
// query คือ `time_bucket('5 minutes', time) ... GROUP BY bucket ORDER BY bucket`
// ⇒ ช่วงวันที่กว้างเท่าไร จำนวนแถวก็โตตาม (ไม่ใช่ LIMIT ที่ตัดได้ตรง ๆ)
// 1 ปีย้อนหลังด้วย bucket 5 นาที = ~105,000 แถวต่อหนึ่งคำขอ · 10 ปี = ล้านแถว
// และหน้า /history ส่ง from/to อะไรก็ได้จากช่องกรอกวันที่ ⇒ คำขอเดียวทำให้ API/DB ล้มได้
//
// นโยบายเดียวกับ AUDIT-006 / sensors: เกินเพดาน = **400 พร้อมบอกทางแก้** (interval ใหญ่ขึ้น/แคบช่วง)
// ไม่ใช่ตัดเงียบแล้วคืนกราฟที่ดูเหมือนครบ
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import timescaleRoutes from '../src/modules/timescale/timescale.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let calls: string[] = [];
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    calls.push(String(sql));
    return [];
  };
  server = await createTestServer((app) => app.use('/api/timescale', timescaleRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  calls = [];
});

function get(path: string) {
  return fetch(server.baseUrl + path, { headers: AUTH });
}

test('ช่วงกว้างหลายปีด้วย bucket 5 นาที = 400 และไม่ยิง SQL', async () => {
  const res = await get('/api/timescale/history?metric=battery_soc&from=2020-01-01&to=2026-01-01');
  assert.equal(res.status, 400);
  const body: any = await res.json();
  assert.match(String(body.error), /ถี่เกิน|กว้าง|interval/i);
  assert.equal(calls.length, 0, 'ต้องไม่ดึงแถวออกมาก่อนจะรู้ว่าเกิน');
});

test('ช่วง 1 วันด้วย bucket 5 นาที = 200 (ไม่ปฏิเสธของปกติ)', async () => {
  const res = await get('/api/timescale/history?metric=battery_soc&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('1 ปี + interval ที่ใหญ่ขึ้น = 200 (ทางแก้ที่ 400 บอกไว้ต้องใช้ได้จริง)', async () => {
  const res = await get(
    '/api/timescale/history?metric=battery_soc&from=2025-01-01&to=2026-01-01&interval=1%20hour'
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('from/to ที่ไม่ใช่วันที่ = 400 (ไม่ใช่ปล่อยให้ Postgres โยนแล้วคืน [] )', async () => {
  const res = await get('/api/timescale/history?metric=battery_soc&from=not-a-date&to=2026-01-01');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('to ก่อน from = 400', async () => {
  const res = await get('/api/timescale/history?metric=battery_soc&from=2026-01-02&to=2026-01-01');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('range สำเร็จรูป (7d) ยังทำงานปกติ', async () => {
  const res = await get('/api/timescale/history?metric=battery_soc&range=7d');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});
