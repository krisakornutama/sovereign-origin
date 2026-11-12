// CSV export ต้องไม่โกหกว่ารวม "ทั้งหมด" — เพดาน 10,000 แถวเดิมถูกตัดเงียบ ๆ
//
// ผู้ตรวจ (PDPA / e-Tax) ได้ไฟล์ไปแล้วเชื่อว่าเป็นช่วงเวลาที่ขอทั้งช่วง ทั้งที่อาจถูกตัด
// ⇒ export ต้องบอกจำนวนที่ได้จริง เทียบกับจำนวนทั้งหมดที่ตรงตัวกรอง และธง "ถูกตัด"
// ให้ UI เตือนผู้ใช้ให้แบ่งช่วงวันที่แทนที่จะส่งไฟล์ไม่ครบโดยไม่มีใครรู้
import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import auditRoutes from '../src/modules/audit/audit.routes';
import { prisma } from '../src/lib/prisma';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let findManyArgs: any = null;
let countArgs: any = null;
let rows: any[] = [];
let total = 0;

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  mockModel(prisma, 'auditLog', {
    findMany: async (args: any) => {
      findManyArgs = args;
      return rows;
    },
    count: async (args: any) => {
      countArgs = args;
      return total;
    },
  });
  mock.method(prisma as any, '$queryRaw', async () => []);
  mock.method(AuditService, 'logAction', async () => undefined);
  server = await createTestServer((app) => app.use('/api/audit', auditRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

beforeEach(() => {
  findManyArgs = null;
  countArgs = null;
  rows = [];
  total = 0;
});

function exportCsv(path = '/api/audit/export', headers: Record<string, string> = AUTH) {
  return fetch(server.baseUrl + path, { headers });
}

test('บอกจำนวนแถวที่ได้จริง + จำนวนทั้งหมด และธงถูกตัดเมื่อเกินเพดาน', async () => {
  rows = [
    { id: 'a1', timestamp: new Date('2026-11-01T00:00:00.000Z'), action_type: 'A', payload: {}, user: null },
    { id: 'a2', timestamp: new Date('2026-11-02T00:00:00.000Z'), action_type: 'B', payload: {}, user: null },
  ];
  total = 5;

  const res = await exportCsv();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-audit-export-rows'), '2');
  assert.equal(res.headers.get('x-audit-export-total'), '5');
  assert.equal(res.headers.get('x-audit-export-truncated'), 'true');
});

test('ไม่ถูกตัด: จำนวนทั้งหมดเท่ากับที่ส่งออก = false', async () => {
  rows = [
    { id: 'a1', timestamp: new Date('2026-11-01T00:00:00.000Z'), action_type: 'A', payload: {}, user: null },
    { id: 'a2', timestamp: new Date('2026-11-02T00:00:00.000Z'), action_type: 'B', payload: {}, user: null },
  ];
  total = 2;

  const res = await exportCsv();
  assert.equal(res.headers.get('x-audit-export-rows'), '2');
  assert.equal(res.headers.get('x-audit-export-total'), '2');
  assert.equal(res.headers.get('x-audit-export-truncated'), 'false');
});

test('นับ "ทั้งหมด" ด้วยตัวกรองชุดเดียวกับรายการ (ไม่ใช่ทั้งตาราง)', async () => {
  rows = [];
  total = 0;

  await exportCsv('/api/audit/export?actionPrefix=USER_PASSWORD&from=2026-11-01T00:00:00.000Z&to=2026-11-10T23:59:59.000Z&q=somchai&limit=50');
  assert.ok(findManyArgs && countArgs, 'ต้องทั้ง findMany และ count');
  assert.deepEqual(countArgs.where, findManyArgs.where, 'สองคำถามต้องใช้ where ก้อนเดียวกัน');
  assert.equal(findManyArgs.where.action_type.startsWith, 'USER_PASSWORD');
  assert.match(JSON.stringify(findManyArgs.where), /somchai/, 'ตัวกรอง q ต้องอยู่ในคำถามนับด้วย');
});

test('limit ที่ขอถูกใช้กับทั้งสองคำถาม — ขอ 50 ได้ 50 และธงถูกตัดอิงจากทั้งหมด', async () => {
  rows = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, timestamp: new Date(2026, 0, 1, 0, i), action_type: 'A', payload: {}, user: null }));
  total = 120;

  const res = await exportCsv('/api/audit/export?limit=50');
  assert.equal(findManyArgs.take, 50);
  assert.equal(res.headers.get('x-audit-export-rows'), '50');
  assert.equal(res.headers.get('x-audit-export-truncated'), 'true');
});

test('export ยังเป็น SUPERADMIN เท่านั้น (401 / 403)', async () => {
  const anon = await fetch(server.baseUrl + '/api/audit/export');
  assert.equal(anon.status, 401);
  const operator = await exportCsv('/api/audit/export', { Authorization: `Bearer ${makeToken('OPERATOR')}` });
  assert.equal(operator.status, 403);
});
