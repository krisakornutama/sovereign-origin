import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import softwareRoutes, { prisma } from '../src/modules/software/software.routes';
import { suggestPrice } from '../src/services/software-catalog.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;
let opToken: string;

before(async () => {
  server = await createTestServer((app) => app.use('/api/software', softwareRoutes));
  adminToken = makeToken('SUPERADMIN');
  opToken = makeToken('OPERATOR');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const biz = { id: 'biz-1', name: 'Sovereign Devices' };
const item = { id: 'item-1', name: 'ซอฟต์แวร์ Sovereign (license)' };

test('suggestPrice — สูตรโปร่งใส: โมดูลใหญ่+มีเทสต์ = แพงกว่า โมดูลเล็กอย่างน้อย 290', async () => {
  assert.ok(suggestPrice(0, 0, 0) >= 290);
  assert.ok(suggestPrice(15, 500, 13) > suggestPrice(3, 100, 1));
  const p = suggestPrice(8, 300, 5);
  assert.strictEqual(p % 10, 9, 'ปิดท้าย 9');
});

test('GET /api/software/scan — ไม่ login = 401 · OPERATOR = 403 · SUPERADMIN = 200 ได้ข้อมูลจริง', async () => {
  mockModel(prisma, 'business', { findFirst: async () => biz });
  mockModel(prisma, 'businessProduct', { findMany: async () => [] });

  const anon = await fetch(server.baseUrl + '/api/software/scan');
  assert.strictEqual(anon.status, 401);

  const op = await fetch(server.baseUrl + '/api/software/scan', { headers: auth(opToken) });
  assert.strictEqual(op.status, 403, 'OPERATOR จัดการราคาไม่ได้');

  const ok = await fetch(server.baseUrl + '/api/software/scan', { headers: auth(adminToken) });
  assert.strictEqual(ok.status, 200);
  const body: any = await ok.json();
  assert.ok(Array.isArray(body.rows) && body.rows.length >= 20, `สแกนได้ทั้งโฟลเดอร์ modules (ได้ ${body.rows?.length})`);
  const farm = body.rows.find((r: any) => r.moduleKey === 'farm');
  assert.ok(farm.facts.endpoints >= 5, 'farm มี endpoints จริงจากโค้ด');
  assert.ok(farm.facts.testRefs >= 1, 'farm ถูกอ้างในเทสต์จริง');
  assert.ok(farm.sku.startsWith('SW-'));
  assert.ok(farm.facts.suggestedPrice >= 290);
});

test('POST /api/software/publish — เปิดขายได้ (สร้างใหม่/อัปเดตเดิม) + ตั้งราคาเอง', async () => {
  let created: any = null;
  let updated = 0;
  mockModel(prisma, 'business', { findFirst: async () => biz });
  mockModel(prisma, 'inventoryItem', { findFirst: async () => item });
  mockModel(prisma, 'businessProduct', {
    findFirst: async () => null,
    findMany: async () => [],
    create: async ({ data }: any) => { created = { id: 'p-1', ...data }; return created; },
    update: async ({ data }: any) => { updated += 1; return { id: 'p-1', ...data }; },
    updateMany: async () => ({ count: 1 }),
  });
  const res = await fetch(server.baseUrl + '/api/software/publish', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleKey: 'farm', salePrice: 2490, name: 'ระบบฟาร์มอัจฉริยะ' }),
  });
  assert.strictEqual(res.status, 201);
  const body: any = await res.json();
  assert.strictEqual(body.salePrice, 2490);
  assert.strictEqual(created?.sku, 'SW-FARM');
  assert.strictEqual(created?.businessId, 'biz-1');
  assert.ok(String(created?.specs).includes('endpoints'), 'specs สร้างจากข้อมูลจริงอัตโนมัติ');
});

test('POST /api/software/publish — moduleKey ไม่มีจริง = 404', async () => {
  mockModel(prisma, 'business', { findFirst: async () => biz });
  const res = await fetch(server.baseUrl + '/api/software/publish', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleKey: 'no-such-module' }),
  });
  assert.strictEqual(res.status, 404);
});

test('POST /api/software/unpublish — ปิดขาย = isActive=false (ไม่ลบ)', async () => {
  const calls: any[] = [];
  mockModel(prisma, 'business', { findFirst: async () => biz });
  mockModel(prisma, 'businessProduct', { updateMany: async ({ data }: any) => { calls.push(data); return { count: 1 }; } });
  const res = await fetch(server.baseUrl + '/api/software/unpublish', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleKey: 'farm' }),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls[0]?.isActive, false, 'ปิดขาย = isActive false (ข้อมูลคงอยู่)');
});
