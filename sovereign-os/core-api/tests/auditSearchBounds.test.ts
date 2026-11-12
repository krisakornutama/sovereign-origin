// ค้น audit ด้วย `q` ต้องมีเพดาน — ก่อนหน้านี้ดึง "ทุก id ที่ match" เข้าหน่วยความจำ
//
// ปัญหา: buildWhere ยิง `SELECT id FROM audit_logs WHERE action_type ILIKE '%q%' OR payload::text ILIKE '%q%'`
// โดยไม่มี LIMIT แล้วเอา id ทั้งหมดไปทำ `id IN (...)`. audit_logs โตได้ไม่จำกัด (ไม่มี retention)
// ⇒ คำค้นกว้าง ๆ (เช่น "api", "a") วันหนึ่งจะดึง id แสนรายการเข้า RAM ต่อหนึ่งคำขอ
// และ `IN (...)` ที่ยาวขนาดนั้นก็ช้า/หนักทั้ง DB และแอป — เป็นช่องทางทำให้บริการล้มได้ด้วยคำขอเดียว
//
// นโยบาย: ตัดที่เพดาน **และบอกตรง ๆ** (400) ไม่ใช่ตัดเงียบ ๆ แล้วคืนผลบางส่วนที่ดูเหมือนครบ
// — "ผลลัพธ์ไม่ครบโดยไม่บอก" คือสิ่งที่งาน AUDIT-004 เพิ่งแก้ไปแล้วในไฟล์ export
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
let rawCalls: Array<{ sql: string; values: unknown[] }> = [];
let rawHits: Array<{ id: string }> = [];

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  mockModel(prisma, 'auditLog', {
    findMany: async (args: any) => {
      findManyArgs = args;
      return [];
    },
    count: async (args: any) => {
      countArgs = args;
      return 0;
    },
  });
  mock.method(prisma as any, '$queryRaw', async (query: any) => {
    rawCalls.push({ sql: String(query?.sql ?? query?.strings?.join('?') ?? ''), values: query?.values ?? [] });
    return rawHits;
  });
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
  rawCalls = [];
  rawHits = [];
});

function get(path: string, headers: Record<string, string> = AUTH) {
  return fetch(server.baseUrl + path, { headers });
}

test('คำสั่ง raw ของ q ต้องมี LIMIT (ไม่ดึง id ทั้งตารางเข้ามา)', async () => {
  await get('/api/audit?q=api');
  assert.equal(rawCalls.length, 1, 'q ต้องยิง raw search ครั้งเดียว');
  assert.match(rawCalls[0].sql, /limit/i, 'SQL ต้องมี LIMIT');
  const limitValue = rawCalls[0].values.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => b - a)[0];
  assert.ok(limitValue >= 1000, `LIMIT ต้องเป็นเพดานจริง (ได้ ${String(limitValue)})`);
});

test('ผลเกินเพดาน = 400 พร้อมบอกให้แคบคำค้น (ไม่คืนผลบางส่วนที่ดูเหมือนครบ)', async () => {
  rawHits = Array.from({ length: 20001 }, (_, i) => ({ id: `id-${i}` }));

  const res = await get('/api/audit?q=a');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(String(body.error), /กว้าง|เพดาน|เฉพาะเจาะจง|20,?000/i);
  assert.equal(findManyArgs, null, 'คำขอที่กว้างเกินต้องไม่ยิงคำถามหลักต่อ');
});

test('ผลพอดีเพดาน = ยังทำงานปกติ (ไม่ปฏิเสธเพราะกลัวเกิน)', async () => {
  rawHits = Array.from({ length: 20000 }, (_, i) => ({ id: `id-${i}` }));

  const res = await get('/api/audit?q=a');
  assert.equal(res.status, 200);
  assert.ok(findManyArgs, 'ต้องยิงคำถามหลัก');
});

test('export ก็ต้องได้ 400 ไม่ใช่ 500 และต้องไม่เริ่มสร้างไฟล์', async () => {
  rawHits = Array.from({ length: 20001 }, (_, i) => ({ id: `id-${i}` }));

  const res = await get('/api/audit/export?q=a');
  assert.equal(res.status, 400);
  assert.match(String(res.headers.get('content-type')), /application\/json/);
  assert.equal(findManyArgs, null, 'ต้องไม่ดึงแถวออกมาก่อนจะรู้ว่าเกิน');
  assert.equal(countArgs, null);
});

test('คำค้นที่แคบยังทำงานเหมือนเดิม และไม่โดนเพดาน', async () => {
  rawHits = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001' }];

  const res = await get('/api/audit?q=somchai');
  assert.equal(res.status, 200);
  assert.ok(findManyArgs, 'ต้องยิงคำถามหลักตามปกติ');
  assert.ok(Array.isArray(findManyArgs.where.OR), 'เงื่อนไขค้นหาต้องยังอยู่');
});
