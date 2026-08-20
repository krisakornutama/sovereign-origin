// tests/treasury.test.ts — Treasury & Wealth Engine (LIFE & FINANCE)
// pure functions + cross-linking (ขาย/ปันผล → อัปเดตเงินสดอัตโนมัติ)
import './setup-env';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGY_FAMILIES,
  isStrategyFamily,
  computeRunwayMonths,
  computeAnnualizedDividendUsd,
  computeNetWorth,
  computeFamilyAllocation,
  ensureBalanceSheet,
  creditLiquidCash,
  recordPositionSale,
  recordDividend,
  recordRunwaySnapshot,
} from '../src/services/treasury.service';

// ═══════════ Runway: (เงินสด + รายได้ปันผลรายปี) / ค่าใช้จ่ายรายเดือน ═══════════
describe('computeRunwayMonths — สูตร Survival Runway', () => {
  test('(cash 8000 + dividend 4000) / burn 1000 → 12 เดือน', () => {
    assert.equal(computeRunwayMonths({ liquidCashUsd: 8000, annualizedDividendUsd: 4000, monthlyBurnUsd: 1000 }), 12);
  });

  test('ไม่มีปันผล → เดือน = cash/burn', () => {
    assert.equal(computeRunwayMonths({ liquidCashUsd: 6000, annualizedDividendUsd: 0, monthlyBurnUsd: 600 }), 10);
  });

  test('burn = 0 → null (อยู่ได้ตลอด ไม่มีตัวหาร)', () => {
    assert.equal(computeRunwayMonths({ liquidCashUsd: 100, annualizedDividendUsd: 0, monthlyBurnUsd: 0 }), null);
  });

  test('cash ติดลบ → ถือ 0 ไม่ทำให้เดือนติดลบ', () => {
    assert.equal(computeRunwayMonths({ liquidCashUsd: -500, annualizedDividendUsd: 100, monthlyBurnUsd: 100 }), 1);
  });
});

// ═══════════ Annualized Dividend Income ═══════════
describe('computeAnnualizedDividendUsd', () => {
  test('Σ qty × price × yield% — 2 ตำแหน่งปันผล', () => {
    const positions = [
      { quantity: 10, priceUsd: 100, expectedDividendYieldPct: 5 }, // 10×100×5% = 50
      { quantity: 4, priceUsd: 250, expectedDividendYieldPct: 2 },  // 4×250×2% = 20
      { quantity: 8, priceUsd: 50, expectedDividendYieldPct: 0 },   // ไม่มี yield → 0
    ];
    assert.equal(computeAnnualizedDividendUsd(positions as any), 70);
  });

  test('ไม่มีราคา (priceUsd null) → ไม่มีส่วนร่วม', () => {
    assert.equal(
      computeAnnualizedDividendUsd([{ quantity: 10, priceUsd: null, expectedDividendYieldPct: 10 }] as any),
      0
    );
  });
});

// ═══════════ Net Worth ═══════════
describe('computeNetWorth', () => {
  test('cash + สินทรัพย์ + เสบียง − หนี้สิน', () => {
    assert.equal(computeNetWorth({ liquidCashUsd: 5000, assetsUsd: 20000, inventoryUsd: 3000, liabilitiesUsd: 8000 }), 20000);
  });

  test('หนี้เกินทรัพย์ → 0 (ไม่ติดลบ)', () => {
    assert.equal(computeNetWorth({ liquidCashUsd: 100, assetsUsd: 0, inventoryUsd: 0, liabilitiesUsd: 500 }), 0);
  });
});

// ═══════════ 5-Family Allocation Matrix ═══════════
describe('computeFamilyAllocation — 5 Strategy Families', () => {
  test('ครบ 5 ตระกูลเรียง FUNDAMENTAL..PASSIVE_INCOME + % รวม 100', () => {
    const { allocation, totalUsd } = computeFamilyAllocation([
      { strategyFamily: 'FUNDAMENTAL', valueUsd: 4000, expectedDividendYieldPct: 0 },
      { strategyFamily: 'ASYMMETRIC', valueUsd: 1000, expectedDividendYieldPct: 0 },
      { strategyFamily: 'MACRO', valueUsd: 2000, expectedDividendYieldPct: 0 },
      { strategyFamily: 'QUANT', valueUsd: 1000, expectedDividendYieldPct: 0 },
      { strategyFamily: 'PASSIVE_INCOME', valueUsd: 2000, expectedDividendYieldPct: 10 },
    ] as any);
    assert.equal(totalUsd, 10000);
    assert.deepEqual(allocation.map((a) => a.family), [...STRATEGY_FAMILIES]);
    const pctSum = allocation.reduce((s, a) => s + a.pct, 0);
    assert.ok(Math.abs(pctSum - 100) < 0.001);
    assert.equal(allocation[0].pct, 40); // FUNDAMENTAL 4000/10000
    assert.equal(allocation[4].dividendYieldPct, 10); // ถ่วงน้ำหนัก = 10%
  });

  test('family ไม่รู้จัก → รวมเข้า FUNDAMENTAL', () => {
    const { allocation } = computeFamilyAllocation([{ strategyFamily: 'ALIEN', valueUsd: 500, expectedDividendYieldPct: 0 }] as any);
    assert.equal(allocation[0].valueUsd, 500);
  });

  test('ไม่มีมูลค่า → ทุก family 0% ไม่ NaN', () => {
    const { allocation, totalUsd } = computeFamilyAllocation([]);
    assert.equal(totalUsd, 0);
    assert.ok(allocation.every((a) => a.pct === 0 && Number.isFinite(a.pct)));
  });

  test('isStrategyFamily — รับเฉพาะ 5 ตระกูล', () => {
    assert.equal(isStrategyFamily('FUNDAMENTAL'), true);
    assert.equal(isStrategyFamily('passive_income'), false);
    assert.equal(isStrategyFamily('ALIEN'), false);
  });
});

// ═══════════ In-memory DB mock (เลียนแบบ treasurer Prisma) ═══════════
function makeDb() {
  const sheets = new Map<string, any>();
  const events: any[] = [];
  const runways: any[] = [];
  const positions = new Map<string, any>();
  const db = {
    personalBalanceSheet: {
      findUnique: async ({ where }: any) => sheets.get(where.user_id) || null,
      upsert: async ({ where, create }: any) => {
        let s = sheets.get(where.user_id);
        if (!s) { s = { id: 'sheet-1', ...create, liquid_cash_usd: 0, liabilities_usd: 0, monthly_burn_usd: 0, monthly_income_usd: 0 }; sheets.set(where.user_id, s); }
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
    },
    treasuryEvent: {
      create: async ({ data }: any) => { const e = { id: `ev-${events.length + 1}`, ...data }; events.push(e); return e; },
      findMany: async () => [...events].reverse(),
    },
    survivalRunway: {
      create: async ({ data }: any) => { const r = { id: `rw-${runways.length + 1}`, ...data }; runways.push(r); return r; },
      findMany: async () => runways,
    },
    assetPosition: {
      findUnique: async ({ where }: any) => positions.get(where.id) || null,
      update: async ({ where, data }: any) => { const p = positions.get(where.id); Object.assign(p, data); return p; },
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
    },
    _sheets: sheets,
    _events: events,
    _runways: runways,
    _positions: positions,
  };
  return db as any;
}

const POSITION = (over: any = {}) => ({
  id: 'pos-1',
  user_id: 'user-1',
  symbol: 'AAPL',
  quantity: 100,
  avg_cost_usd: 150,
  sold_qty: 0,
  realized_gain_usd: 0,
  ...over,
});

// ═══════════ Cross-Linking: ขาย/ปันผล → เงินสดอัตโนมัติ ═══════════
describe('recordPositionSale — realized gain → liquid cash', () => {
  test('ขายกำไร: เข้าเงินสด + อัปเดต quantity/realizedGain + บันทึก event REALIZED_GAIN', async () => {
    const db = makeDb();
    const pos = POSITION();
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 1000, liabilities_usd: 0, monthly_burn_usd: 0, monthly_income_usd: 0 });
    await db.personalBalanceSheet.upsert({ where: { user_id: 'user-1' }, create: { user_id: 'user-1' }, update: {} });

    const r = await recordPositionSale(db, pos, 40, 200); // 40 หน่วย @200 ต้นทุน 150 → กำไร 50×40 = 2000
    assert.equal(r.ok, true);
    assert.equal(r.realizedGainUsd, 2000);
    assert.equal(r.creditUsd, 2000);
    assert.equal(pos.quantity, 60);
    assert.equal(pos.sold_qty, 40);
    assert.equal(pos.realized_gain_usd, 2000);
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 3000); // 1000 + 2000
  });

  test('ขายขาดทุน: ไม่หักเงินสด แต่บันทึก realized_gain ติดลบสะสม', async () => {
    const db = makeDb();
    const pos = POSITION();
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 5000 });
    await db.personalBalanceSheet.upsert({ where: { user_id: 'user-1' }, create: { user_id: 'user-1' }, update: {} });

    const r = await recordPositionSale(db, pos, 50, 100); // ขาดทุน 50×50 = 2500
    assert.equal(r.ok, true);
    assert.equal(r.realizedGainUsd, -2500);
    assert.equal(r.creditUsd, 0);
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 5000); // ไม่เปลี่ยน
    assert.equal(pos.realized_gain_usd, -2500);
    assert.equal(db._events.length, 0); // ไม่มี event กำไร
  });

  test('ขายเกินพอร์ต → ปฏิเสธ (ไม่แตะเงินสด)', async () => {
    const db = makeDb();
    const pos = POSITION();
    db._positions.set(pos.id, pos);
    const r = await recordPositionSale(db, pos, 101, 200);
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    assert.equal(pos.quantity, 100);
  });

  test('ต้นทุนติดลบ (ข้อมูลเก่าหรือ bypass) → clamp เป็น 0 กำไรเต็มราคาไม่บวกเกินจริง', async () => {
    const db = makeDb();
    const pos = POSITION({ avg_cost_usd: -100 });
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 1000 });
    await db.personalBalanceSheet.upsert({ where: { user_id: 'user-1' }, create: { user_id: 'user-1' }, update: {} });

    const r = await recordPositionSale(db, pos, 2, 50); // ถ้าไม่ clamp กำไร = (50-(-100))×2 = 300
    assert.equal(r.ok, true);
    assert.equal(r.realizedGainUsd, 100); // 50×2 — ต้นทุนถือเป็น 0
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 1100);
  });

  test('ขายซ้อนเกินพอร์ต (ผู้อ่าน snapshot เดิม 2 คน ขายรวม > ยอดถือ) → รอบสองถูกปฏิเสธ ไม่เครดิตซ้ำ (กัน TOCTOU)', async () => {
    const db = makeDb();
    const pos = POSITION();
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 1000 });
    await db.personalBalanceSheet.upsert({ where: { user_id: 'user-1' }, create: { user_id: 'user-1' }, update: {} });

    const readerA = { ...pos }; // request แรกอ่านพอร์ตก่อน
    const readerB = { ...pos }; // request ที่สองอ่านพร้อมกัน (quantity ยัง 100 ทั้งคู่)
    const r1 = await recordPositionSale(db, readerA, 80, 200); // ขาย 80
    const r2 = await recordPositionSale(db, readerB, 80, 200); // เหลือจริง 20 → ต้องโดนปฏิเสธ
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, false);
    assert.ok(r2.reason);
    assert.equal(pos.quantity, 20); // หักแค่ 80 ไม่เกิน
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 1000 + 4000); // เครดิตแค่กำไรรอบเดียว 80×50
    assert.equal(db._events.filter((e: any) => e.type === 'REALIZED_GAIN').length, 1);
  });

  test('ราคา/จำนวนเป็น Infinity → เทียบเท่า 0 → ปฏิเสธ ไม่เขียน DB', async () => {
    const db = makeDb();
    const pos = POSITION();
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 1000 });
    const r = await recordPositionSale(db, pos, Number('1e999'), 200); // Infinity
    assert.equal(r.ok, false);
    const r2 = await recordPositionSale(db, pos, 5, Number('1e999')); // ราคา Infinity
    assert.equal(r2.ok, false);
    assert.equal(pos.quantity, 100); // ไม่ถูกแตะ
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 1000);
  });
});

describe('recordDividend — payout → liquid cash', () => {
  test('ปันผล 300 → เงินสด +850 + lastDividend อัปเดต + event DIVIDEND', async () => {
    const db = makeDb();
    const pos = POSITION({ quantity: 85 });
    db._positions.set(pos.id, pos);
    db._sheets.set('user-1', { id: 'sheet-1', user_id: 'user-1', liquid_cash_usd: 550 });
    await db.personalBalanceSheet.upsert({ where: { user_id: 'user-1' }, create: { user_id: 'user-1' }, update: {} });

    const r = await recordDividend(db, pos, 300);
    assert.equal(r.ok, true);
    assert.equal(db._sheets.get('user-1').liquid_cash_usd, 850);
    assert.equal(pos.last_dividend_usd, 300);
    assert.ok(pos.last_dividend_at);
    assert.equal(db._events[0].type, 'DIVIDEND');
    assert.equal(db._events[0].amount_usd, 300);
  });

  test('amount ≤ 0 → ปฏิเสธ', async () => {
    const db = makeDb();
    const r = await recordDividend(db, POSITION(), 0);
    assert.equal(r.ok, false);
  });
});

describe('creditLiquidCash + ensureBalanceSheet', () => {
  test('CASH_ADJUST: สร้าง sheet อัตโนมัติถ้ายังไม่มี + event บันทึก', async () => {
    const db = makeDb();
    const out = await creditLiquidCash(db, 'user-new', 2500, { type: 'CASH_ADJUST', note: 'ฝากเงินสด' });
    assert.equal(out.balance.liquid_cash_usd, 2500);
    assert.equal(db._events[0].type, 'CASH_ADJUST');
    assert.equal(db._events[0].amount_usd, 2500);
  });

  test('ensureBalanceSheet — idempotent (เรียกซ้ำไม่สร้างซ้ำ)', async () => {
    const db = makeDb();
    const a = await ensureBalanceSheet(db, 'u-1');
    const b = await ensureBalanceSheet(db, 'u-1');
    assert.equal(a.id, b.id);
    assert.equal(db._sheets.size, 1);
  });
});

describe('recordRunwaySnapshot', () => {
  test('บันทึกสแนปชอตที่คำนวณด้วยสูตรเดียวกัน', async () => {
    const db = makeDb();
    await recordRunwaySnapshot(db, 'user-1', { liquidCashUsd: 9000, annualizedDividendUsd: 3000, monthlyBurnUsd: 1000 });
    assert.equal(db._runways.length, 1);
    assert.equal(db._runways[0].months, 12);
    assert.equal(db._runways[0].annualized_dividend_usd, 3000);
  });
});