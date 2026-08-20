import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import aiRoutes from '../src/modules/ai/ai.routes';
import {
  prisma,
  buildSituationContext,
  runWhatIf,
  askAdvisor,
  summarizeImpact,
  linearSlopeCmPerHour,
  estimateWaterDaysLeft,
  type SituationContext,
  type AdvisorDataSources,
} from '../src/services/advisor.service';
import { mockModel, createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let token: string;

const baseCtx: SituationContext = {
  generatedAt: new Date().toISOString(),
  battery: { soc: 60, avgPowerKw: -0.25, hoursRemaining: 12, status: 'discharging' },
  water: { levelCm: 100, rateCmPerHour: 0.2, daysLeft: 20.8, trend: 'falling' },
  farm: {
    plots: 4, active: 3, growing: 2, harvested: 1, fallow: 0, activeAreaSqm: 120,
    upcomingHarvests: [{ name: 'แปลง A', crop: 'ผักกาด', daysLeft: 5 }],
  },
  inventory: {
    items: 10, waterQty: 20, foodQty: 30, expiring: 2, expired: 1, lowStock: 1,
    expiringSoon: [{ name: 'นม', category: 'FOOD', daysLeft: 3 }],
  },
  wealth: {
    totalUsd: 5000, portfolioUsd: 3000, inventoryUsd: 2000, runwayMonths: 6,
    monthlyBurnUsd: 1000, missingPrices: [],
  },
  risk: { threatOverall: 55, threatSummary: 'ปานกลาง', defcon: 3 },
  truncated: false,
};

function fakeDs(overrides: Partial<AdvisorDataSources> = {}): AdvisorDataSources {
  return {
    async latestTelemetry() {
      return { battery_soc: 60, power_kw: -0.25, water_level_cm: 100 };
    },
    async powerAvg24h() {
      return -0.25;
    },
    async waterHistory72h() {
      const now = Date.now();
      return Array.from({ length: 24 }, (_, i) => ({
        time: new Date(now - (24 - i) * 3600000),
        value: 110 - i * 0.4,
      }));
    },
    async farmPlots() {
      return [
        { status: 'growing', crop: 'ผักกาด', area_sqm: 40, expected_harvest_at: new Date(Date.now() + 5 * 86400000), name: 'แปลง A' },
        { status: 'active', crop: 'ข้าว', area_sqm: 80, expected_harvest_at: new Date(Date.now() + 30 * 86400000), name: 'แปลง B' },
        { status: 'harvested', crop: 'กะเพรา', area_sqm: 20, expected_harvest_at: null, name: 'แปลง C' },
      ];
    },
    async inventory() {
      return [
        { name: 'น้ำ', category: 'WATER', quantity: 20, unit_price_usd: 1, minimum_stock: 5, expiry_date: null },
        { name: 'ข้าวสาร', category: 'FOOD', quantity: 30, unit_price_usd: 2, minimum_stock: 10, expiry_date: null },
        { name: 'นม', category: 'FOOD', quantity: 4, unit_price_usd: 3, minimum_stock: 6, expiry_date: new Date(Date.now() + 3 * 86400000) },
        { name: 'ของเก่า', category: 'MATERIAL', quantity: 1, unit_price_usd: 5, minimum_stock: null, expiry_date: new Date(Date.now() - 86400000) },
      ];
    },
    async assets() {
      return [{ symbol: 'BTC', type: 'CRYPTO', quantity: 0.01 }];
    },
    async latestPrices() {
      return [{ symbol: 'BTC', price_usd: 100000 }];
    },
    async wealthHistory() {
      return { total_usd_value: 5000, payload: { runway: { months: 6, monthly_burn_usd: 1000 } } };
    },
    async threatIndex() {
      return { overall: 55, summary: 'ปานกลาง' };
    },
    ...overrides,
  };
}

before(async () => {
  mockModel(prisma, 'farmPlot', { findMany: async () => [] });
  mockModel(prisma, 'inventoryItem', { findMany: async () => [] });
  mockModel(prisma, 'assetPosition', { findMany: async () => [] });
  mockModel(prisma, 'wealthHistory', { findFirst: async () => null });
  mockModel(prisma, 'threatIndex', { findFirst: async () => null });
  try {
    (prisma as any).$queryRawUnsafe = async () => [];
  } catch {
    // proxy อาจไม่ยอม set — battery/water จะเป็น null ใน route test ได้
  }
  server = await createTestServer((app) => app.use('/api/ai', aiRoutes));
  token = makeToken('SUPERADMIN');
});

after(async () => {
  if (server) await server.close();
});

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

// ── Pure: water slope & days ────────────────────────────────────────────────

test('linearSlopeCmPerHour fits falling series correctly', () => {
  const now = Date.now();
  const samples = Array.from({ length: 10 }, (_, i) => ({
    time: new Date(now + i * 3600000),
    value: 100 - i * 0.5,
  }));
  const slope = linearSlopeCmPerHour(samples);
  assert.ok(slope != null);
  assert.ok(Math.abs(slope - (-0.5)) < 0.05, `slope = ${slope} ควร ≈ -0.5`);
});

test('linearSlopeCmPerHour returns null for insufficient data', () => {
  assert.strictEqual(linearSlopeCmPerHour([]), null);
  assert.strictEqual(linearSlopeCmPerHour([{ time: new Date(), value: 10 }, { time: new Date(), value: 9 }]), null);
  // ช่วงเวลา < 1 ชม.
  const t = Date.now();
  assert.strictEqual(
    linearSlopeCmPerHour([
      { time: new Date(t), value: 10 },
      { time: new Date(t + 60000), value: 9 },
      { time: new Date(t + 120000), value: 8 },
    ]),
    null
  );
});

test('estimateWaterDaysLeft math + null handling', () => {
  assert.ok(Math.abs((estimateWaterDaysLeft(100, 2) as number) - 100 / 2 / 24) < 1e-9);
  assert.strictEqual(estimateWaterDaysLeft(100, 0), null); // ไม่ลด = ไม่ขาดแคลน
  assert.strictEqual(estimateWaterDaysLeft(null, 2), null);
  assert.strictEqual(estimateWaterDaysLeft(0, 2), 0);
});

// ── Context builder ─────────────────────────────────────────────────────────

test('buildSituationContext gathers real data into compact context', async () => {
  const ctx = await buildSituationContext(fakeDs());
  assert.strictEqual(ctx.battery.soc, 60);
  assert.strictEqual(ctx.battery.status, 'discharging');
  assert.ok(Math.abs(ctx.battery.hoursRemaining! - ((60 / 100) * 5) / 0.25) < 0.01);
  assert.strictEqual(ctx.water.trend, 'falling');
  assert.ok(ctx.water.rateCmPerHour! > 0.3 && ctx.water.rateCmPerHour! < 0.5, `rate=${ctx.water.rateCmPerHour}`);
  assert.ok(ctx.water.daysLeft! > 8 && ctx.water.daysLeft! < 12);
  assert.strictEqual(ctx.farm.plots, 3);
  assert.strictEqual(ctx.farm.active, 2);
  assert.strictEqual(ctx.farm.growing, 1);
  assert.strictEqual(ctx.farm.activeAreaSqm, 120);
  assert.strictEqual(ctx.inventory.waterQty, 20);
  assert.strictEqual(ctx.inventory.foodQty, 34);
  assert.strictEqual(ctx.inventory.lowStock, 1);
  assert.strictEqual(ctx.inventory.expired, 1);
  assert.strictEqual(ctx.wealth.portfolioUsd, 1000); // 0.01 BTC × 100000
  assert.strictEqual(ctx.wealth.inventoryUsd, 20 + 60 + 12 + 5);
  assert.strictEqual(ctx.wealth.runwayMonths, 6);
  assert.strictEqual(ctx.wealth.monthlyBurnUsd, 1000);
  assert.strictEqual(ctx.risk.threatOverall, 55);
  assert.strictEqual(ctx.risk.defcon, 3);
  assert.strictEqual(ctx.truncated, false);
  assert.ok(JSON.stringify(ctx).length <= 6000, 'context ต้องไม่อ้วนเกิน');
});

test('buildSituationContext truncates long lists and flags truncated', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    name: `ของ ${i}`, category: 'FOOD' as const, daysLeft: i,
  }));
  const ctx = await buildSituationContext(
    fakeDs({
      async inventory() {
        return many.map((m) => ({ name: m.name, category: m.category, quantity: 1, unit_price_usd: 1, minimum_stock: null, expiry_date: new Date(Date.now() + m.daysLeft * 86400000) }));
      },
    })
  );
  assert.ok(ctx.inventory.expiringSoon.length <= 5, `expiringSoon = ${ctx.inventory.expiringSoon.length}`);
  assert.strictEqual(ctx.truncated, true);
});

test('buildSituationContext survives broken data sources', async () => {
  const ctx = await buildSituationContext(
    fakeDs({
      async latestTelemetry() {
        throw new Error('db down');
      },
      async powerAvg24h() {
        throw new Error('db down');
      },
      async assets() {
        throw new Error('db down');
      },
      async threatIndex() {
        throw new Error('db down');
      },
    })
  );
  assert.strictEqual(ctx.battery.soc, null);
  assert.strictEqual(ctx.battery.status, 'no_data');
  assert.strictEqual(ctx.wealth.portfolioUsd, null);
  assert.strictEqual(ctx.risk.threatOverall, null);
  assert.strictEqual(ctx.risk.defcon, null);
});

// ── What-if ─────────────────────────────────────────────────────────────────

test('runWhatIf no_rain reduces water days by scenario length', () => {
  const r = runWhatIf(baseCtx, { scenario: 'no_rain', days: 14 });
  assert.strictEqual(r.water.currentDaysLeft, baseCtx.water.daysLeft);
  assert.ok(Math.abs(r.water.daysLeftAfter! - (baseCtx.water.daysLeft! - 14)) < 0.01);
  assert.strictEqual(r.water.willRunOut, false);
  assert.ok(r.water.levelAfterCm! < 100);
  assert.strictEqual(r.impact, 'warning'); // เหลือ ~6.8 วัน
});

test('runWhatIf no_rain flags critical when water runs out', () => {
  const r = runWhatIf({ ...baseCtx, water: { ...baseCtx.water, daysLeft: 5 } }, { scenario: 'no_rain', days: 14 });
  assert.strictEqual(r.water.willRunOut, true);
  assert.strictEqual(r.water.daysLeftAfter, 0);
  assert.strictEqual(r.impact, 'critical');
});

test('runWhatIf no_power drains battery hours', () => {
  const r = runWhatIf({ ...baseCtx, battery: { ...baseCtx.battery, hoursRemaining: 600 } }, { scenario: 'no_power', days: 14 });
  assert.strictEqual(r.battery.hoursAfter, 600 - 336);
  assert.strictEqual(r.battery.willDie, false);
  assert.strictEqual(r.impact, 'ok');

  const c = runWhatIf({ ...baseCtx, battery: { ...baseCtx.battery, hoursRemaining: 72 } }, { scenario: 'no_power', days: 14 });
  assert.strictEqual(c.battery.willDie, true);
  assert.strictEqual(c.battery.hoursAfter, 0);
  assert.strictEqual(c.impact, 'critical');
});

test('runWhatIf cost_increase shrinks runway proportionally', () => {
  const r = runWhatIf(baseCtx, { scenario: 'cost_increase', days: 10 });
  assert.ok(Math.abs(r.food.daysLeft! - 180) < 0.01);
  // burn 1000 → 1100 → runway 6 × 1000/1100 = 5.45 เดือน = 163.6 วัน
  assert.match(r.impactNote, /1,100|1100/);
  assert.match(r.impactNote, /163\.6|163\.7|163\.5/);
});

test('runWhatIf unknown impact when no data', () => {
  const empty: SituationContext = {
    ...baseCtx,
    battery: { soc: null, avgPowerKw: null, hoursRemaining: null, status: 'no_data' },
    water: { levelCm: null, rateCmPerHour: null, daysLeft: null, trend: 'unknown' },
    wealth: { ...baseCtx.wealth, runwayMonths: null, monthlyBurnUsd: null },
  };
  const r = runWhatIf(empty, { scenario: 'no_rain', days: 14 });
  assert.strictEqual(r.water.willRunOut, null);
  assert.strictEqual(r.water.daysLeftAfter, null);
  assert.strictEqual(r.impact, 'unknown');
  assert.match(r.impactNote, /ข้อมูลไม่พอ|ไม่มีข้อมูล/);
});

// ── AI calls (llm override) ─────────────────────────────────────────────────

test('askAdvisor passes context + question to LLM and returns Thai reply', async () => {
  let prompt = '';
  const reply = await askAdvisor('ควรประหยัดอะไรก่อน?', baseCtx, async (p) => {
    prompt = p;
    return '☑️ ควรประหยัดน้ำก่อน เพราะเหลือ ~21 วัน';
  });
  assert.match(reply, /น้ำ/);
  assert.match(prompt, /ควรประหยัดอะไรก่อน/);
  assert.match(prompt, /"battery"/);
  assert.match(prompt, /"generatedAt"/);
});

test('askAdvisor falls back gracefully when LLM is offline', async () => {
  const reply = await askAdvisor('x', baseCtx, async () => {
    throw new Error('ollama down');
  });
  assert.match(reply, /AI ออฟไลน์/);
});

test('summarizeImpact returns LLM summary or computed note fallback', async () => {
  const r = runWhatIf(baseCtx, { scenario: 'no_rain', days: 14 });
  const ok = await summarizeImpact(r, baseCtx, async (p) => {
    assert.match(p, /"scenario"/);
    return 'ควรสำรองน้ำเพิ่มทันที';
  });
  assert.strictEqual(ok, 'ควรสำรองน้ำเพิ่มทันที');

  const fb = await summarizeImpact(r, baseCtx, async () => {
    throw new Error('down');
  });
  assert.strictEqual(fb, r.impactNote);
});

// ── Routes ──────────────────────────────────────────────────────────────────

test('advisor routes require authentication', async () => {
  for (const url of ['/api/ai/advisor', '/api/ai/advisor/what-if']) {
    const res = await fetch(server.baseUrl + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(res.status, 401, url);
  }
});

test('POST /advisor validates question', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ question: '  ' }),
  });
  assert.strictEqual(res.status, 400);

  const long = await fetch(server.baseUrl + '/api/ai/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ question: 'x'.repeat(2001) }),
  });
  assert.strictEqual(long.status, 400);
});

test('POST /advisor returns advice + real context (DB ยังว่าง/ล่ม → ยังตอบได้)', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ question: 'ควรทำอะไรดี' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.question, 'ควรทำอะไรดี');
  assert.ok(typeof body.advice === 'string' && body.advice.length > 0);
  assert.ok(body.context, 'ต้องคืนข้อมูลที่ AI ใช้');
  assert.ok(typeof body.context.battery === 'object');
  assert.ok(typeof body.context.inventory === 'object');
  assert.ok(typeof body.context.risk === 'object');
});

test('POST /advisor/what-if validates scenario + days', async () => {
  const bad = await fetch(server.baseUrl + '/api/ai/advisor/what-if', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ scenario: 'volcano', days: 14 }),
  });
  assert.strictEqual(bad.status, 400);

  const outOfRange = await fetch(server.baseUrl + '/api/ai/advisor/what-if', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ scenario: 'no_rain', days: 999 }),
  });
  assert.strictEqual(outOfRange.status, 400);
});

test('POST /advisor/what-if returns computed + AI summary', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/advisor/what-if', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ scenario: 'no_power', days: 2 }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.params.scenario, 'no_power');
  assert.strictEqual(body.params.days, 2);
  assert.ok(body.computed && typeof body.computed.impact === 'string');
  assert.ok(typeof body.computed.impactNote === 'string');
  assert.ok(typeof body.advice === 'string' && body.advice.length > 0);
  assert.ok(body.context);
});