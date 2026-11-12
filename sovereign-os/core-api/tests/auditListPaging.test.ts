// หน้ารายการ audit ดูย้อนได้แค่ N แถวล่าสุด — ไม่มีทาง "ถอยหลัง" ไปก่อนหน้านั้น
//
// ผลจริงที่เจอ: ผู้ตรวจเห็น 100 แถวล่าสุด แต่เหตุการณ์ที่ต้องดูอยู่เมื่อวาน (ก่อน 100 แถว)
// เข้าไม่ถึงจาก UI เลย ต้องส่งออก CSV ทั้งช่วงแทน — ซึ่งไม่ตอบคำถาม "ขอดูถัดไปทีละหน้า"
//
// เทสต์นี้ยึดสัญญาของการแบ่งหน้า:
//   - `offset` ต้องกลายเป็น `skip` ของ Prisma และติดลบ/ไม่ใช่ตัวเลข = 0 (ไม่ error)
//   - ต้องดึง `limit + 1` แถวเพื่อ "รู้ว่ามีต่อ" โดยไม่ต้องนับทั้งตาราง (ตาราง audit โตได้ไม่จำกัด)
//   - แถวที่เกินมาต้องไม่หลุดไปให้ client และต้องบอกทาง header ว่ามีต่อ
//   - limit ยังถูกเพดาน 500 และค่าติดลบต้องไม่ทำให้ Prisma พัง
//   - ตัวกรองเดิม (q / actionPrefix / from-to) ต้องยังอยู่ครบตอนแบ่งหน้า
import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import auditRoutes from '../src/modules/audit/audit.routes';
import { prisma } from '../src/lib/prisma';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let findManyArgs: any = null;
let rows: any[] = [];
let rawHits: Array<{ id: string }> = [];

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

function log(id: string, when: string) {
  return { id, timestamp: new Date(when), action_type: 'A', payload: {}, user: null };
}

before(async () => {
  mockModel(prisma, 'auditLog', {
    findMany: async (args: any) => {
      findManyArgs = args;
      return rows;
    },
  });
  mock.method(prisma as any, '$queryRaw', async () => rawHits);
  mock.method(AuditService, 'logAction', async () => undefined);
  server = await createTestServer((app) => app.use('/api/audit', auditRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

beforeEach(() => {
  findManyArgs = null;
  rows = [];
  rawHits = [];
});

function get(path: string, headers: Record<string, string> = AUTH) {
  return fetch(server.baseUrl + path, { headers });
}

test('ไม่มี offset = เริ่มจากแถวแรก และขอ limit+1 เพื่อรู้ว่ามีต่อ', async () => {
  rows = Array.from({ length: 101 }, (_, i) => log(`a${i}`, `2026-11-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`));

  const res = await get('/api/audit?limit=100');
  assert.equal(res.status, 200);
  assert.equal(findManyArgs.skip, 0, 'ไม่ระบุ offset ต้องเท่ากับ skip 0 ไม่ใช่ undefined');
  assert.equal(findManyArgs.take, 101, 'ต้องดึงเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไป');
  assert.equal(findManyArgs.orderBy.timestamp, 'desc', 'ใหม่สุดก่อนเสมอ');
  assert.equal(JSON.parse(await res.text()).length, 100, 'แถวที่เกินมาต้องไม่หลุดไปให้ client');
  assert.equal(res.headers.get('x-audit-list-has-more'), 'true');
  assert.equal(res.headers.get('x-audit-list-offset'), '0');
});

test('offset กลายเป็น skip และบอกตำแหน่งที่กำลังดูอยู่', async () => {
  rows = Array.from({ length: 51 }, (_, i) => log(`b${i}`, '2026-11-01T00:00:00.000Z'));

  const res = await get('/api/audit?limit=50&offset=200');
  assert.equal(res.status, 200);
  assert.equal(findManyArgs.skip, 200);
  assert.equal(findManyArgs.take, 51);
  assert.equal(res.headers.get('x-audit-list-offset'), '200');
  assert.equal(res.headers.get('x-audit-list-has-more'), 'true');
});

test('แถวไม่ถึง limit+1 = ไม่มีหน้าถัดไป (ไม่เดาจากจำนวนที่ขอ)', async () => {
  rows = [log('c1', '2026-11-01T00:00:00.000Z')];

  const res = await get('/api/audit?limit=100&offset=0');
  assert.equal(res.headers.get('x-audit-list-has-more'), 'false');
  assert.equal(JSON.parse(await res.text()).length, 1);
});

test('offset ติดลบ/ไม่ใช่ตัวเลข = 0 และ limit ติดลบต้องไม่ทำให้ Prisma พัง', async () => {
  rows = [];
  await get('/api/audit?offset=-20&limit=-5');
  assert.equal(findManyArgs.skip, 0);
  assert.ok(findManyArgs.take >= 1, `take ต้องมากกว่าหรือเท่ากับ 1 (ได้ ${findManyArgs.take})`);
});

test('limit เกินเพดานยังถูกตัดที่ 500 (ดึง 501 เพื่อเช็ก has-more)', async () => {
  rows = [];
  await get('/api/audit?limit=99999');
  assert.equal(findManyArgs.take, 501);
});

test('offset เกินเพดาน = 400 บอกตรง ๆ (ไม่ใช่คืนลิสต์ว่างที่ดูเหมือน "ไม่มีข้อมูลแล้ว")', async () => {
  rows = [];
  findManyArgs = null;

  const res = await get('/api/audit?offset=100001');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /offset/i);
  assert.equal(findManyArgs, null, 'คำขอที่ผิดต้องไม่ยิง DB');

  const boundary = await get('/api/audit?offset=100000');
  assert.equal(boundary.status, 200, 'ค่าที่เท่าเพดานพอดีต้องใช้ได้');
});

test('ตัวกรองเดิมยังอยู่ครบเมื่อแบ่งหน้า (q + actionPrefix + from/to)', async () => {
  rows = [];
  rawHits = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001' }];

  await get('/api/audit?q=somchai&actionPrefix=USER_PASSWORD&from=2026-11-01T00:00:00.000Z&to=2026-11-10T23:59:59.000Z&limit=50&offset=100');

  assert.equal(findManyArgs.skip, 100);
  assert.equal(findManyArgs.take, 51);
  assert.equal(findManyArgs.where.action_type.startsWith, 'USER_PASSWORD');
  assert.equal(findManyArgs.where.timestamp.gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(findManyArgs.where.timestamp.lte.toISOString(), '2026-11-10T23:59:59.000Z');
  assert.ok(Array.isArray(findManyArgs.where.OR), 'เงื่อนไขค้นหาต้องไม่หายไปตอนแบ่งหน้า');
});

test('ยังเป็น SUPERADMIN เท่านั้น (401 / 403)', async () => {
  const anon = await fetch(server.baseUrl + '/api/audit');
  assert.equal(anon.status, 401);
  const denied = await fetch(server.baseUrl + '/api/audit', {
    headers: { Authorization: `Bearer ${makeToken('OPERATOR')}` },
  });
  assert.equal(denied.status, 403);
});
