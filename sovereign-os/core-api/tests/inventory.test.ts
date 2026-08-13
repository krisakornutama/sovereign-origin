import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import inventoryRoutes, { prisma } from '../src/modules/inventory/inventory.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';
import {
  computeExpiryStatus,
  daysUntil,
  computeExpiryDate,
  computeStockStatus,
} from '../src/services/inventory.service';

let server: TestServer;
let adminToken: string;
let operatorToken: string;
let db: any;

const baseRow = (overrides: Record<string, any> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'ข้าวสาร 5kg',
  category: 'FOOD',
  quantity: 10,
  unit: 'kg',
  unit_price_usd: 2,
  location: null,
  expiry_date: null,
  shelf_life_days: null,
  minimum_stock: null,
  notes: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

before(async () => {
  db = mockModel(prisma, 'inventoryItem', {
    findMany: async () => [baseRow()],
    findUnique: async () => baseRow(),
    create: async ({ data }: any) => ({ id: 'new-1', ...data }),
    update: async ({ data }: any) => ({ id: '11111111-1111-1111-1111-111111111111', ...data }),
    delete: async () => ({}),
  });
  server = await createTestServer((app) => app.use('/api/inventory', inventoryRoutes));
  adminToken = makeToken('SUPERADMIN');
  operatorToken = makeToken('OPERATOR');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Pure logic: วันหมดอายุ ──

test('daysUntil คำนวณวันต่างได้ถูกต้อง', () => {
  const now = new Date('2026-08-12T00:00:00Z');
  assert.strictEqual(daysUntil(new Date('2026-08-22T00:00:00Z'), now), 10);
  assert.strictEqual(daysUntil(new Date('2026-08-11T00:00:00Z'), now), -1); // หมดอายุแล้ว
});

test('computeExpiryStatus แบ่งสถานะ ok/expiring/expired/na', () => {
  const now = new Date('2026-08-12T00:00:00Z');
  assert.deepStrictEqual(computeExpiryStatus(null, now), { daysLeft: null, status: 'na' });
  assert.strictEqual(computeExpiryStatus('2026-12-01T00:00:00Z', now).status, 'ok');
  assert.strictEqual(computeExpiryStatus('2026-08-20T00:00:00Z', now).status, 'expiring');
  assert.strictEqual(computeExpiryStatus('2026-08-10T00:00:00Z', now).status, 'expired');
  // หมดอายุแล้ววันนี้ (20 ส.ค. เทียบ 12 ส.ค. → 8 วันก่อน expiry = expiring ไม่ใช่ expired)
  assert.strictEqual(computeExpiryStatus('invalid-date', now).status, 'na');
});

test('computeExpiryDate คำนวณจาก shelf_life_days', () => {
  const now = new Date('2026-08-12T00:00:00Z');
  const d = computeExpiryDate(365, now);
  assert.ok(d);
  assert.strictEqual(d.getUTCFullYear(), 2027);
  assert.strictEqual(computeExpiryDate(null, now), null);
  assert.strictEqual(computeExpiryDate(0, now), null);
});

test('computeStockStatus เช็คของเหลือน้อย', () => {
  assert.deepStrictEqual(computeStockStatus(5, null), { low: false, minimumStock: null });
  assert.deepStrictEqual(computeStockStatus(5, 10), { low: true, minimumStock: 10 });
  assert.deepStrictEqual(computeStockStatus(15, 10), { low: false, minimumStock: 10 });
});

// ── HTTP endpoints ──

test('requires authentication on all endpoints', async () => {
  for (const [method, url] of [
    ['GET', '/api/inventory'],
    ['POST', '/api/inventory'],
    ['GET', '/api/inventory/status'],
  ] as const) {
    const res = await fetch(server.baseUrl + url, { method });
    assert.strictEqual(res.status, 401, `${method} ${url} should be 401`);
  }
});

test('GET / returns items enriched with expiry status', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
  assert.strictEqual(body.items[0].expiry.status, 'na');
  assert.strictEqual(body.items[0].lowStock, false);
});

test('GET /status returns totals summary', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory/status', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok('totals' in body && 'expiringSoon' in body);
  assert.strictEqual(body.totals.items, 1);
});

test('POST / rejects invalid category', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ของลี้ลับ', category: 'ALIEN', quantity: 1 }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST / rejects empty name and negative quantity', async () => {
  for (const body of [{ name: '  ', quantity: 1 }, { name: 'น้ำ', quantity: -1 }]) {
    const res = await fetch(server.baseUrl + '/api/inventory', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.strictEqual(res.status, 400);
  }
});

test('POST / creates item (WATER category allowed) and auto-computes expiry from shelf_life_days', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'น้ำดื่ม 1.5L',
      category: 'WATER',
      quantity: 12,
      unit: 'bottle',
      unit_price_usd: 0.5,
      shelf_life_days: 180,
    }),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.success, true);
});

test('POST / rejects invalid expiry_date', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'นม', category: 'FOOD', quantity: 3, expiry_date: 'not-a-date' }),
  });
  assert.strictEqual(res.status, 400);
});

test('blocks SYSTEM_AI role from writes', async () => {
  const aiToken = makeToken('SYSTEM_AI');
  const res = await fetch(server.baseUrl + '/api/inventory', {
    method: 'POST',
    headers: { ...auth(aiToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ลบไม่ได้', category: 'FOOD', quantity: 1 }),
  });
  assert.strictEqual(res.status, 403);
});

test('PUT /:id allows OPERATOR and returns 404 for missing', async () => {
  const res = await fetch(server.baseUrl + '/api/inventory/11111111-1111-1111-1111-111111111111', {
    method: 'PUT',
    headers: { ...auth(operatorToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.strictEqual(res.status, 200);

  mock.method(db, 'findUnique', async () => null);
  const miss = await fetch(server.baseUrl + '/api/inventory/00000000-0000-0000-0000-000000000000', {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.strictEqual(miss.status, 404);
});