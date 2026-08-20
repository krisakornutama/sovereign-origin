// tests/treasuryApi.test.ts — HTTP tests สำหรับ /api/treasury routes
// ครอบ: overview shape, 5 families, energy cost ใน burn, ขาย/ปันผล → เงินสดอัตโนมัติ,
// ถอนเงินสด (ติดลบ) ไม่เกิด double-credit, เจ้าของพอร์ตห้ามแตะของคนอื่น, 401
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import treasuryRoutes, { prisma } from '../src/modules/treasury/treasury.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;
let memberToken: string;

const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function positionRow(overrides: Record<string, any> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: OWNER_A,
    symbol: 'BTC',
    type: 'CRYPTO',
    quantity: 2,
    wallet_address: null,
    notes: null,
    strategy_family: 'FUNDAMENTAL',
    avg_cost_usd: 40000,
    expected_dividend_yield_pct: 0,
    catalyst_note: null,
    last_dividend_usd: null,
    last_dividend_at: null,
    realized_gain_usd: 0,
    sold_qty: 0,
    ...overrides,
  };
}

let sheets: Map<string, any>;
let events: any[];
let runways: any[];
let positions: Map<string, any>;
let rawQueries: string[];

before(async () => {
  sheets = new Map();
  events = [];
  runways = [];
  positions = new Map([[positionRow().id, positionRow()]]);
  rawQueries = [];

  const sheet = (userId: string, over: any = {}) =>
    ({ id: 'sheet-1', user_id: userId, liquid_cash_usd: 0, liabilities_usd: 0, monthly_burn_usd: 500, monthly_income_usd: 0, ...over });
  sheets.set(OWNER_A, sheet(OWNER_A, { liquid_cash_usd: 1000 }));

  mockModel(prisma, 'assetPosition', {
    findMany: async ({ where }: any) => [...positions.values()].filter((p) => !where?.user_id || p.user_id === where.user_id).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    findFirst: async ({ where }: any) => [...positions.values()].find((p) => p.id === where.id && p.user_id === where.user_id) || null,
    findUnique: async ({ where }: any) => positions.get(where.id) || null,
    create: async ({ data }: any) => ({ ...positionRow(), ...data, id: 'pos-new' }),
    update: async ({ where, data }: any) => {
      const p = positions.get(where.id);
      Object.assign(p, data);
      return p;
    },
    updateMany: async ({ where, data }: any) => {
      const p = positions.get(where.id);
      if (!p) return { count: 0 };
      const min = where?.quantity?.gte;
      if (min !== undefined && p.quantity < min) return { count: 0 };
      if (data?.quantity?.decrement !== undefined) p.quantity -= data.quantity.decrement;
      if (data?.sold_qty?.increment !== undefined) p.sold_qty = (p.sold_qty || 0) + data.sold_qty.increment;
      if (data?.realized_gain_usd?.increment !== undefined) p.realized_gain_usd = (p.realized_gain_usd || 0) + data.realized_gain_usd.increment;
      return { count: 1 };
    },
    delete: async ({ where }: any) => {
      positions.delete(where.id);
      return {};
    },
  });
  mockModel(prisma, 'personalBalanceSheet', {
    findUnique: async ({ where }: any) => sheets.get(where.user_id) || null,
    upsert: async ({ where, create }: any) => {
      let s = sheets.get(where.user_id);
      if (!s) { s = sheet(create.user_id); sheets.set(where.user_id, s); }
      return s;
    },
    update: async ({ where, data }: any) => {
      const s = sheets.get(where.user_id);
      Object.assign(s, data);
      return s;
    },
    updateMany: async ({ where, data }: any) => {
      const s = sheets.get(where.user_id);
      if (!s) return { count: 0 };
      const min = where?.liquid_cash_usd?.gte;
      if (min !== undefined && s.liquid_cash_usd < min) return { count: 0 };
      if (data?.liquid_cash_usd?.decrement !== undefined) s.liquid_cash_usd -= data.liquid_cash_usd.decrement;
      return { count: 1 };
    },
  });
  mockModel(prisma, 'treasuryEvent', {
    create: async ({ data }: any) => {
      const e = { id: `ev-${events.length + 1}`, created_at: new Date(), ...data };
      events.push(e);
      return e;
    },
    findMany: async ({ where }: any) => [...events].filter((e) => !where?.user_id || e.user_id === where.user_id).reverse(),
  });
  mockModel(prisma, 'survivalRunway', {
    create: async ({ data }: any) => {
      const r = { id: `rw-${runways.length + 1}`, ...data };
      runways.push(r);
      return r;
    },
    findMany: async ({ where }: any) => [...runways].filter((r) => !where?.user_id || r.user_id === where.user_id),
  });
  mockModel(prisma, 'inventoryItem', {
    findMany: async () => [],
  });
  mockModel(prisma, 'dimeStatement', {
    findMany: async () => [], // ยังไม่มี statement ใน test env → dime: null
  });
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    rawQueries.push(sql);
    if (sql.includes('DISTINCT ON (symbol)')) return [{ symbol: 'BTC', price_usd: 50000 }];
    if (sql.includes('power_kw')) return [{ avg_power: 0.5 }]; // 0.5 kW × 24 × 30 × 0.12 = 43.2
    return [];
  };

  server = await createTestServer((app) => app.use('/api/treasury', treasuryRoutes));
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

// ═══════ Overview — หน้าควบคุมรวม ═══════

test('GET /overview — รูปแบบครบ: netWorth/cashflow/runway/strategies/catalysts/income', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/overview', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.strictEqual(body.netWorth.liquidCashUsd, 1000);
  assert.strictEqual(body.netWorth.assetsUsd, 2 * 50000); // BTC 2 × 50000
  assert.ok(Math.abs(body.cashflow.energyCostUsd - 43.2) < 1e-9); // 0.5kW × 720h × 0.12
  assert.ok(Math.abs(body.cashflow.monthlyBurnUsd - 543.2) < 1e-9); // 500 + 43.2
  assert.ok(Math.abs(body.runway.months - (1000 + 0) / 543.2) < 1e-9);
  assert.deepEqual(body.strategies.families, ['FUNDAMENTAL', 'ASYMMETRIC', 'MACRO', 'QUANT', 'PASSIVE_INCOME']);
  assert.strictEqual(body.strategies.allocation.length, 5);
  assert.strictEqual(body.strategies.totalUsd, 100000);
  assert.ok(Array.isArray(body.catalysts));
  assert.ok(Array.isArray(body.income.events));
  assert.ok(Array.isArray(body.positions));
});

test('GET /overview — catalyst note แสดงใน watchlist + dividend stream เฉพาะ yield>0', async () => {
  positions.set('pos-cat', positionRow({ id: 'pos-cat', symbol: 'ETH', strategy_family: 'ASYMMETRIC', catalyst_note: 'Eth spot ETF', expected_dividend_yield_pct: 0 }));
  positions.set('pos-div', positionRow({ id: 'pos-div', symbol: 'AAPL', strategy_family: 'PASSIVE_INCOME', expected_dividend_yield_pct: 2.5 }));
  positions.set('pos-bad', positionRow({ id: 'pos-bad', symbol: 'OTHER', strategy_family: 'QUANT', expected_dividend_yield_pct: 0 }));
  try {
    const res = await fetch(server.baseUrl + '/api/treasury/overview', { headers: auth(adminToken) });
    const body = await res.json();
    assert.ok(body.catalysts.some((c: any) => c.symbol === 'ETH' && c.note === 'Eth spot ETF'));
    assert.ok(body.catalysts.every((c: any) => c.symbol !== 'OTHER')); // ไม่มี note → ไม่โผล่
    assert.strictEqual(body.income.dividendStreams.length, 1);
    assert.strictEqual(body.income.dividendStreams[0].symbol, 'AAPL');
  } finally {
    positions.delete('pos-cat');
    positions.delete('pos-div');
    positions.delete('pos-bad');
  }
});

test('GET /overview — สมาชิกมองเห็นเฉพาะข้อมูลตัวเอง (โดนบังคับเป็น OWNER_B)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/overview?userId=' + OWNER_A, { headers: auth(memberToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.positions.length, 0); // OWNER_B ไม่มี position
  assert.strictEqual(body.netWorth.liquidCashUsd, 0); // ensureBalanceSheet สร้างใหม่ 0
});

// ═══════ Balance Sheet + CASH_ADJUST ═══════

test('PATCH /balance-sheet — ฝากเงินสด (adj>0) → เครดิต + event', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/balance-sheet', {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustCashUsd: 500 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.adjustment.balance.liquid_cash_usd, 1500);
  assert.strictEqual(body.sheet.liquid_cash_usd, 1500);
  const cashEvents = events.filter((e) => e.type === 'CASH_ADJUST');
  assert.strictEqual(cashEvents.length, 1);
  assert.strictEqual(cashEvents[0].amount_usd, 500);
  sheets.get(OWNER_A).liquid_cash_usd = 1000; // รีเซ็ต
});

test('PATCH /balance-sheet — ถอนเงินสด (adj<0) → ลดตรง 1 event ไม่ double-credit', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/balance-sheet', {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustCashUsd: -300 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.adjustment.balance.liquid_cash_usd, 700);
  const neg = events.filter((e) => e.type === 'CASH_ADJUST' && e.amount_usd < 0);
  assert.strictEqual(neg.length, 1); // ไม่อนุญาต credit+debit คู่กัน
  assert.strictEqual(neg[0].amount_usd, -300);
  sheets.get(OWNER_A).liquid_cash_usd = 1000; // รีเซ็ต
  events.length = 0;
});

test('PATCH /balance-sheet — ค่าเป็นตัวเลขไม่ติดลบเท่านั้น', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/balance-sheet', {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyBurnUsd: -1 }),
  });
  assert.strictEqual(res.status, 400);
});

// ═══════ ขาย/ปันผล → เงินสดอัตโนมัติ (Cross-Linking) ═══════

test('POST /positions/:id/sell — กำไร 20000 → เงินสด 1000+20000 + event REALIZED_GAIN', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions/11111111-1111-1111-1111-111111111111/sell', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 1, priceUsd: 60000 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.sale.realizedGainUsd, 20000); // 1 × (60000-40000)
  assert.strictEqual(body.sale.remainingQty, 1);
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, 21000);
  assert.ok(events.some((e) => e.type === 'REALIZED_GAIN' && e.amount_usd === 20000 && e.symbol === 'BTC'));
  sheets.get(OWNER_A).liquid_cash_usd = 1000; // รีเซ็ต
  events.length = 0;
});

test('POST /positions/:id/dividend — 300 → เงินสด +300 + event DIVIDEND', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions/11111111-1111-1111-1111-111111111111/dividend', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountUsd: 300 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.payout.balance.liquid_cash_usd, 1300);
  assert.ok(events.some((e) => e.type === 'DIVIDEND' && e.amount_usd === 300));
  sheets.get(OWNER_A).liquid_cash_usd = 1000; // รีเซ็ต
  events.length = 0;
});

test('POST /positions/:id/sell — ขายของคนอื่น → 404 (กันข้ามเจ้าของ)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions/11111111-1111-1111-1111-111111111111/sell', {
    method: 'POST',
    headers: { ...auth(memberToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 1, priceUsd: 60000 }),
  });
  assert.strictEqual(res.status, 404);
});

test('POST /positions — strategyFamily ไม่ถูกต้อง → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'X', type: 'STOCK', quantity: 1, strategyFamily: 'ALIEN' }),
  });
  assert.strictEqual(res.status, 400);
});

// ═══════ Validation — ป้องกันตัวเลขเกินจริง/ติดลบทำบัญชีเงินสดเพี้ยน ═══════

test('POST /positions — avgCostUsd ติดลบ → 400 (กันกำไรลวงตอนขาย)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'BTC', type: 'CRYPTO', quantity: 1, avgCostUsd: -50000 }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST /positions — quantity ติดลบ → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'BTC', type: 'CRYPTO', quantity: -3 }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST /positions — yield เกิน 100% → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'AAPL', type: 'STOCK', quantity: 1, expectedDividendYieldPct: 150 }),
  });
  assert.strictEqual(res.status, 400);
});

test('PATCH /positions/:id — avgCostUsd ติดลบ → 400', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions/11111111-1111-1111-1111-111111111111', {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ avgCostUsd: -1 }),
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(positions.get('11111111-1111-1111-1111-111111111111').avg_cost_usd, 40000); // ไม่ถูกแก้
});

test('PATCH /balance-sheet — ถอนเกินเงินสด → หักเท่าที่มี + event บันทึกยอดจริง', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/balance-sheet', {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustCashUsd: -5000 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.sheet.liquid_cash_usd, 0); // 1000-1000 หักเท่าที่มี
  assert.strictEqual(body.adjustment.withdrawalUsd, 1000);
  const neg = events.filter((e) => e.type === 'CASH_ADJUST');
  assert.strictEqual(neg.length, 1);
  assert.strictEqual(neg[0].amount_usd, -1000); // ไม่บันทึก -5000 เกินจริง
  sheets.get(OWNER_A).liquid_cash_usd = 1000; // รีเซ็ต
  events.length = 0;
});

test('POST /positions/:id/sell — ราคา Infinity → 400 ไม่แตะพอร์ต/เงินสด', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/positions/11111111-1111-1111-1111-111111111111/sell', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 1, priceUsd: '1e999' }), // Number → Infinity
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(positions.get('11111111-1111-1111-1111-111111111111').quantity, 1); // เหลือจากเทสต์ขายก่อนหน้า
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, 1000);
});

test('GET /events?limit=-5 → 200 (clamp ไม่ 500)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/events?limit=-5', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray((await res.json()).events));
});

test('GET /runway/history?limit=abc → 200 (clamp ค่าไม่ถูกต้อง)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/runway/history?limit=abc', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
});

// ═══════ Runway Snapshot & History ═══════

test('POST /runway/snapshot — บันทึกเดือนที่อยู่รอด (สูตรเดียวกับ overview)', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/runway/snapshot', { method: 'POST', headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(runways.length, 1);
  assert.strictEqual(runways[0].user_id, OWNER_A);
  assert.strictEqual(body.months, (1000 + 0) / 543.2);
});

test('GET /runway/history — กลับลำดับเก่า→ใหม่', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/runway/history', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.history.length, 1);
  assert.strictEqual(body.history[0].months, runways[0].months);
});

test('ต้อง login ก่อน — 401 ทุก endpoint', async () => {
  for (const [url, method] of [
    ['/api/treasury/overview', 'GET'],
    ['/api/treasury/balance-sheet', 'PATCH'],
    ['/api/treasury/runway/snapshot', 'POST'],
    ['/api/treasury/runway/history', 'GET'],
    ['/api/treasury/positions', 'POST'],
    ['/api/treasury/events', 'GET'],
  ] as const) {
    const res = await fetch(server.baseUrl + url, { method });
    assert.strictEqual(res.status, 401, `${method} ${url} ควร 401`);
  }
});