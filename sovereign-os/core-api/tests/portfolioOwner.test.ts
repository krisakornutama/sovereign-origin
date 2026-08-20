import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import portfolioRoutes, { prisma, resolveOwnerId } from '../src/modules/portfolio/portfolio.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;
let memberToken: string;
let db: any;

const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function assetRow(overrides: Record<string, any> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: OWNER_A,
    symbol: 'BTC',
    type: 'CRYPTO',
    quantity: 1,
    wallet_address: null,
    notes: null,
    ...overrides,
  };
}

before(async () => {
  db = mockModel(prisma, 'assetPosition', {
    findMany: async ({ where }: any) => [assetRow({ user_id: where?.user_id })],
    findFirst: async ({ where }: any) => (where?.id === '11111111-1111-1111-1111-111111111111' && where?.user_id === OWNER_A ? assetRow() : null),
    create: async ({ data }: any) => assetRow(data),
    delete: async () => ({}),
    update: async () => ({}),
  });
  mockModel(prisma, 'inventoryItem', {
    findMany: async ({ where }: any) => [{ id: '22222222-2222-2222-2222-222222222222', user_id: where?.user_id, name: 'ข้าวสาร', category: 'FOOD', quantity: 10, unit: 'kg', unit_price_usd: 2 }],
    findFirst: async ({ where }: any) => (where?.id === '22222222-2222-2222-2222-222222222222' && where?.user_id === OWNER_A ? { id: '22222222-2222-2222-2222-222222222222', user_id: OWNER_A, name: 'ข้าวสาร', category: 'FOOD', quantity: 10, unit: 'kg', unit_price_usd: 2 } : null),
    create: async ({ data }: any) => ({ id: '22222222-2222-2222-2222-222222222222', ...data }),
    delete: async () => ({}),
  });
  mockModel(prisma, 'wealthHistory', {
    findMany: async ({ where }: any) => [{ id: '33333333-3333-3333-3333-333333333333', user_id: where?.user_id, timestamp: new Date(), total_usd_value: 100, payload: {} }],
  });
  // $queryRawUnsafe เป็น method ตรง ๆ ไม่ใช่ model delegate — assign ฟังก์ชันโดยตรง
  (prisma as any).$queryRawUnsafe = async () => [];

  server = await createTestServer((app) => app.use('/api/portfolio', portfolioRoutes));
  adminToken = makeToken('SUPERADMIN', { userId: OWNER_A });
  memberToken = makeToken('OPERATOR', { userId: OWNER_B });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── resolveOwnerId — ตรรกะเจ้าของพอร์ต ──

test('resolveOwnerId: สมาชิกทั่วไปมองเห็นได้เฉพาะพอร์ตตัวเอง (ไม่เชื่อ ?userId= จากฝั่ง UI)', () => {
  const req: any = { user: { id: OWNER_B, role: 'OPERATOR' }, query: { userId: OWNER_A } };
  assert.strictEqual(resolveOwnerId(req), OWNER_B);
});

test('resolveOwnerId: SUPERADMIN ดูพอร์ตสมาชิกคนอื่นได้ผ่าน ?userId=', () => {
  const req: any = { user: { id: OWNER_A, role: 'SUPERADMIN' }, query: { userId: OWNER_B } };
  assert.strictEqual(resolveOwnerId(req), OWNER_B);
});

test('resolveOwnerId: SUPERADMIN ไม่ส่ง ?userId= = พอร์ตของตัวเอง', () => {
  const req: any = { user: { id: OWNER_A, role: 'SUPERADMIN' }, query: {} };
  assert.strictEqual(resolveOwnerId(req), OWNER_A);
});

// ── HTTP — กรองตามเจ้าของ + กันข้ามคน ──

// เก็บ where ที่ prisma.asset.findMany เรียกครั้งล่าสุด เพื่อตรวจว่า backend กรองถูกคน
let lastAssetWhere: any = null;

function trackAssetWhere() {
  mock.method(db, 'findMany', async ({ where }: any) => {
    lastAssetWhere = where;
    return [assetRow({ user_id: where?.user_id })];
  });
}

test('GET /assets กรอง asset เฉพาะเจ้าของพอร์ต (สมาชิกส่ง ?userId= ของคนอื่นก็โดนบังคับเป็นตัวเอง)', async () => {
  trackAssetWhere();
  const res = await fetch(server.baseUrl + '/api/portfolio/assets?userId=' + OWNER_A, { headers: auth(memberToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.assets));
  assert.strictEqual(lastAssetWhere?.user_id, OWNER_B); // backend กรองเป็น OWNER_B ไม่เชื่อ ?userId=
});

test('GET /assets — SUPERADMIN ดูพอร์ตคนอื่นได้ผ่าน ?userId=', async () => {
  trackAssetWhere();
  const res = await fetch(server.baseUrl + '/api/portfolio/assets?userId=' + OWNER_B, { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(lastAssetWhere?.user_id, OWNER_B);
});

test('GET /assets — SUPERADMIN ไม่ส่ง ?userId= = ดูพอร์ตตัวเอง', async () => {
  trackAssetWhere();
  const res = await fetch(server.baseUrl + '/api/portfolio/assets', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(lastAssetWhere?.user_id, OWNER_A);
});

test('POST /assets — สมาชิกเพิ่ม asset เข้าพอร์ตตัวเอง', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/assets', {
    method: 'POST',
    headers: { ...auth(memberToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'ETH', type: 'CRYPTO', quantity: 2 }),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.success, true);
});

test('DELETE /assets/:id — ลบ asset ของคนอื่นไม่ได้ (ไม่พบในพอร์ตของเรา)', async () => {
  // mock findFirst คืน null เมื่อ id/owner ไม่ตรง — ลบของคนอื่นควร 404
  mock.method(db, 'findFirst', async ({ where }: any) =>
    where?.id === '11111111-1111-1111-1111-111111111111' && where?.user_id === OWNER_A ? assetRow() : null
  );
  const res = await fetch(server.baseUrl + '/api/portfolio/assets/11111111-1111-1111-1111-111111111111', {
    method: 'DELETE',
    headers: auth(memberToken),
  });
  assert.strictEqual(res.status, 404);
});

// ── Validation — ตารางเดียวกันกับ treasury → กัน bypass ──

test('POST /assets — quantity ติดลบ → 400 (กัน bypass validation treasury)', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/assets', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'BTC', type: 'CRYPTO', quantity: -3 }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST /assets — quantity Infinity → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/assets', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'BTC', type: 'CRYPTO', quantity: '1e999' }),
  });
  assert.strictEqual(res.status, 400);
});

test('PUT /assets/:id — quantity ติดลบ → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/assets/11111111-1111-1111-1111-111111111111', {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: -1 }),
  });
  assert.strictEqual(res.status, 400);
});

test('PUT /inventory/:id — unit_price_usd ติดลบ → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/inventory/22222222-2222-2222-2222-222222222222', {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_price_usd: -5 }),
  });
  assert.strictEqual(res.status, 400);
});

test('GET /history?limit=-5 → 200 (clamp ไม่ 500)', async () => {
  const res = await fetch(server.baseUrl + '/api/portfolio/history?limit=-5', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
});

test('ต้อง login ก่อน — 401 ทุก endpoint', async () => {
  for (const url of ['/api/portfolio/assets', '/api/portfolio/summary', '/api/portfolio/inventory', '/api/portfolio/history']) {
    const res = await fetch(server.baseUrl + url);
    assert.strictEqual(res.status, 401, `${url} ควร 401`);
  }
});
