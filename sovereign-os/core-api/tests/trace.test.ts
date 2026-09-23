import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import traceRoutes, { prisma } from '../src/modules/trace/trace.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

const baseLot = (overrides: Record<string, any> = {}) => ({
  id: '33333333-3333-3333-3333-333333333333',
  lotCode: 'LOT-ABC234',
  inventoryItemId: '44444444-4444-4444-4444-444444444444',
  plotId: '22222222-2222-2222-2222-222222222222',
  crop: 'มะเขือเทศ',
  quantityKg: 12.5,
  harvestedAt: new Date('2026-09-20T00:00:00Z'),
  soldCustomerId: null,
  soldAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

before(async () => {
  mockModel(prisma, 'productLot', {
    findUnique: async ({ where }: any) => {
      if (where?.lotCode === 'LOT-ABC234') return baseLot({ events: [] });
      if (where?.lotCode === 'LOT-SOLD99') {
        return baseLot({
          lotCode: 'LOT-SOLD99',
          soldCustomerId: '55555555-5555-5555-5555-555555555555',
          soldAt: new Date(),
          plot: { name: 'แปลง A', location: 'โซน A' },
          events: [{ type: 'HARVESTED', detail: 'เก็บเกี่ยว 12.5 กก.', createdAt: new Date('2026-09-20T00:00:00Z') }, { type: 'SOLD', detail: 'ขายผ่านออเดอร์ B20260922-0001', createdAt: new Date() }],
        });
      }
      return null;
    },
    create: async ({ data }: any) => ({ id: '33333333-3333-3333-3333-333333333333', ...data }),
    findMany: async () => [baseLot({ plot: { name: 'แปลง A' }, events: [{ type: 'HARVESTED', detail: null, createdAt: new Date() }] })],
  });
  mockModel(prisma, 'traceEvent', {
    create: async ({ data }: any) => ({ id: '66666666-6666-6666-6666-666666666666', ...data }),
  });
  mockModel(prisma, 'inventoryItem', {
    findUnique: async ({ where }: any) =>
      where?.id === '44444444-4444-4444-4444-444444444444' ? { id: where.id, name: 'มะเขือเทศ', category: 'FOOD' } : null,
  });
  server = await createTestServer((app) => app.use('/api/trace', traceRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('GET /:lotCode สาธารณะ — ไม่ต้อง login ได้ข้อมูลตามรอยครบ', async () => {
  const res = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.strictEqual(body.lotCode, 'LOT-SOLD99');
  assert.strictEqual(body.crop, 'มะเขือเทศ');
  assert.strictEqual(body.sold, true);
  assert.strictEqual(body.plotName, 'แปลง A');
  assert.ok(Array.isArray(body.events) && body.events.length >= 2);
  // สาธารณะห้ามเห็น id ภายใน/ทุน — เช็คกันหลุดโครง
  assert.ok(!('id' in body) && !('inventoryItemId' in body));
});

test('GET /:lotCode — รหัสผิดรูปแบบ/ไม่พบ = 404 กลาง', async () => {
  for (const code of ['not-a-code', 'LOT-ZZZZZZ']) {
    const res = await fetch(server.baseUrl + `/api/trace/${code}`);
    assert.strictEqual(res.status, 404, `${code} should be 404`);
  }
});

test('GET / ต้อง login', async () => {
  const res = await fetch(server.baseUrl + '/api/trace');
  assert.strictEqual(res.status, 401);
});

test('GET / คืนรายการล็อตล่าสุด', async () => {
  const res = await fetch(server.baseUrl + '/api/trace', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.ok(Array.isArray(body.lots) && body.lots.length >= 1);
  assert.strictEqual(body.lots[0].lotCode, 'LOT-ABC234');
});

test('POST / สร้างล็อตจาก InventoryItem ที่มีจริง', async () => {
  const res = await fetch(server.baseUrl + '/api/trace', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: '44444444-4444-4444-4444-444444444444', quantityKg: 5, crop: 'ผักกาด' }),
  });
  assert.strictEqual(res.status, 201);
  const body: any = await res.json();
  assert.match(body.lotCode, /^LOT-[A-Z2-9]{6}$/);
  assert.strictEqual(body.quantityKg, 5);
});

test('POST / — inventoryItemId ไม่มีจริง = 404, quantityKg ไม่ผ่าน = 400, ไม่มี token = 401', async () => {
  const badItem = await fetch(server.baseUrl + '/api/trace', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: '99999999-9999-9999-9999-999999999999', quantityKg: 1 }),
  });
  assert.strictEqual(badItem.status, 404);

  const badQty = await fetch(server.baseUrl + '/api/trace', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: '44444444-4444-4444-4444-444444444444', quantityKg: 0 }),
  });
  assert.strictEqual(badQty.status, 400);

  const noAuth = await fetch(server.baseUrl + '/api/trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId: '44444444-4444-4444-4444-444444444444', quantityKg: 1 }),
  });
  assert.strictEqual(noAuth.status, 401);
});

// ── integration กับ farm/business (mock ที่จุดเชื่อมต่อ) ──

test('trace.service createLotFromHarvest สร้างล็อต + เหตุการณ์ HARVESTED', async () => {
  const { createLotFromHarvest, generateLotCode } = await import('../src/services/trace.service');
  const created: any[] = [];
  mockModel(prisma, 'productLot', {
    findUnique: async () => null, // generateLotCode — ไม่ชนซ้ำ
    create: async ({ data }: any) => {
      created.push({ id: 'lot-new', ...data });
      return created[created.length - 1];
    },
  });
  const events: any[] = [];
  mockModel(prisma, 'traceEvent', {
    create: async ({ data }: any) => {
      events.push(data);
      return { id: 'ev-new', ...data };
    },
  });
  const code = await generateLotCode();
  assert.match(code, /^LOT-[A-Z2-9]{6}$/);
  const lot = await createLotFromHarvest({ inventoryItemId: '44444444-4444-4444-4444-444444444444', plotId: '22222222-2222-2222-2222-222222222222', crop: 'มะเขือเทศ', quantityKg: 7 });
  assert.match(lot.lotCode, /^LOT-[A-Z2-9]{6}$/);
  assert.strictEqual(created.length, 1);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'HARVESTED');
});

test('markLotsSold/Delivered/Restocked best-effort — tx พังไม่ throw', async () => {
  const { markLotsSold, markLotsDelivered, markLotsRestocked } = await import('../src/services/trace.service');
  const tx = {
    productLot: {
      findMany: async () => [{ id: 'lot-1', lotCode: 'LOT-AAA223', soldCustomerId: null, harvestedAt: new Date() }],
      update: async () => ({}),
    },
    traceEvent: { create: async () => ({}) },
    businessCustomer: { findUnique: async () => ({ name: 'ลูกค้า A' }) },
  };
  // ทำงานปกติ
  await markLotsSold(tx, 'biz-1', ['prod-1'], 'cust-1', 'B20260922-0001');
  await markLotsDelivered(tx, 'B20260922-0001', 'ลูกค้า A');
  await markLotsRestocked(tx, 'B20260922-0001');
  // tx พัง (query throw) — ต้องกลืน error ไม่ให้ล้มออเดอร์
  const brokenTx = {
    productLot: { findMany: async () => { throw new Error('db down'); }, update: async () => ({}), },
    traceEvent: { create: async () => ({}), findMany: async () => { throw new Error('db down'); } },
  };
  await markLotsSold(brokenTx, 'biz-1', ['prod-1'], null, 'B1');
  await markLotsDelivered(brokenTx, 'B1');
  await markLotsRestocked(brokenTx, 'B1');
  // productIds ว่าง = ไม่ทำอะไร
  await markLotsSold(tx, 'biz-1', [], null, 'B2');
});

// ── เฟส 2 — QR generator, events endpoint, ร้านอาหารใช้ล็อต ──

test('GET /:lotCode/qr — คืน QR data URL + ลิงก์ตามรอย (login)', async () => {
  // re-mock — เทส integration ด้านบนทับ findUnique เป็น () => null (process เดียวกัน ไม่ restore)
  mockModel(prisma, 'productLot', {
    findUnique: async ({ where }: any) =>
      where?.lotCode === 'LOT-SOLD99'
        ? baseLot({ lotCode: 'LOT-SOLD99', soldCustomerId: '55555555-5555-5555-5555-555555555555', soldAt: new Date(), plot: { name: 'แปลง A', location: 'โซน A' }, events: [{ type: 'SOLD', detail: null, createdAt: new Date() }] })
        : null,
  });
  const res = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/qr', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.strictEqual(body.lotCode, 'LOT-SOLD99');
  assert.match(body.qrDataUrl, /^data:image\/png;base64,/);
  assert.ok(String(body.url).includes('/trace?lot=LOT-SOLD99'));

  const noAuth = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/qr');
  assert.strictEqual(noAuth.status, 401);

  const missing = await fetch(server.baseUrl + '/api/trace/LOT-ZZZZZZ/qr', { headers: auth(adminToken) });
  assert.strictEqual(missing.status, 404);
});

test('GET/POST /:lotCode/events — อ่าน + เพิ่มเหตุการณ์มือ (login/WRITE_ROLES)', async () => {
  mockModel(prisma, 'productLot', {
    findUnique: async ({ where }: any) => {
      if (where?.lotCode === 'LOT-SOLD99') {
        return { id: 'lot-sold', lotCode: 'LOT-SOLD99', crop: 'มะเขือเทศ', events: [{ type: 'HARVESTED', detail: null, createdAt: new Date() }] };
      }
      return null;
    },
  });
  const createdEvents: any[] = [];
  mockModel(prisma, 'traceEvent', {
    create: async ({ data }: any) => {
      createdEvents.push(data);
      return { id: 'ev-manual', createdAt: new Date(), ...data };
    },
  });

  const read = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/events', { headers: auth(adminToken) });
  assert.strictEqual(read.status, 200);
  const readBody: any = await read.json();
  assert.ok(Array.isArray(readBody.events) && readBody.events.length >= 1);

  const write = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/events', {
    method: 'POST', headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'NOTE', detail: 'แช่เย็นก่อนส่ง' }),
  });
  assert.strictEqual(write.status, 201);
  assert.strictEqual(createdEvents[0].type, 'NOTE');

  const badType = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/events', {
    method: 'POST', headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'HACKED', detail: 'x' }),
  });
  assert.strictEqual(badType.status, 400);

  const noAuth = await fetch(server.baseUrl + '/api/trace/LOT-SOLD99/events');
  assert.strictEqual(noAuth.status, 401);
});

test('markLotsConsumedByRecipes — FIFO + ตัด quantityKg + CONSUMED/PROCESSED + best-effort', async () => {
  const { markLotsConsumedByRecipes } = await import('../src/services/trace.service');
  const lots = [
    { id: 'lot-old', inventoryItemId: 'inv-1', quantityKg: 0.5, harvestedAt: new Date('2026-09-01'), soldCustomerId: null },
    { id: 'lot-new', inventoryItemId: 'inv-1', quantityKg: 2, harvestedAt: new Date('2026-09-10'), soldCustomerId: null },
  ];
  const updates: any[] = [];
  const events: any[] = [];
  const okTx = {
    productLot: {
      findMany: async ({ where }: any) => lots.filter((l) => where?.inventoryItemId?.in?.includes(l.inventoryItemId) && l.soldCustomerId === null),
      update: async ({ where, data }: any) => {
        const lot = lots.find((l) => l.id === where.id);
        Object.assign(lot, data);
        updates.push({ id: where.id, ...data });
        return lot;
      },
    },
    traceEvent: { create: async ({ data }: any) => { events.push(data); return data; } },
  };
  await markLotsConsumedByRecipes(okTx, [{ inventoryItemId: 'inv-1', qtyGram: 1200, menuName: 'ส้มตำ', orderNo: 'ORD-X' }]);
  // FIFO — ล็อตเก่าโดนก่อน: 0.5kg = 500g หมดล็อต, ที่เหลือ 700g ตัดจากล็อตใหม่
  assert.strictEqual(lots[0].quantityKg, 0);
  assert.ok(Math.abs(lots[1].quantityKg - 1.3) < 1e-9);
  const consumed = events.filter((e) => e.type === 'CONSUMED');
  const processed = events.filter((e) => e.type === 'PROCESSED');
  assert.strictEqual(consumed.length, 2, 'ทั้งสองล็อตมี CONSUMED');
  assert.ok(consumed[0].detail.includes('ส้มตำ') && consumed[0].detail.includes('ORD-X'));
  assert.strictEqual(processed.length, 2);

  // tx พัง — กลืน error ไม่ throw (best-effort เหมือนเฟส 1)
  const brokenTx = { productLot: { findMany: async () => { throw new Error('db down'); } }, traceEvent: { create: async () => ({}) } };
  await markLotsConsumedByRecipes(brokenTx, [{ inventoryItemId: 'inv-1', qtyGram: 100, orderNo: 'ORD-Y' }]);
});
