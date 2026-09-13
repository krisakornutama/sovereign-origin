// ─────────────────────────────────────────────────────────────
// Treasury & Wealth Engine — LIFE & FINANCE unified module
// 1) Net Worth & Cashflow        — เงินสด + สินทรัพย์ − หนี้สิน, อัตราการเผาผลาญรายเดือน
// 2) Survival Runway             — (เงินสดรวม + รายได้ปันผลรายปี) / ค่าใช้จ่ายรายเดือน
// 3) Investment Strategies       — 5 Strategy Families + Catalyst Watchlist + Income Feeds
//
// Cross-linking: AssetPosition (ลงทุน) เชื่อมตรงกับ PersonalBalanceSheet และ SurvivalRunway
//  - ขายทำกำไร (realized gain) / รับเงินปันผล → อัปเดตยอดเงินสด (liquidCap) อัตโนมัติ
//  - pure functions แยกจาก DB เพื่อ test ได้โดยไม่ต้องต่อฐานข้อมูล
// ─────────────────────────────────────────────────────────────

// ── 5 Strategy Families ──
export const STRATEGY_FAMILIES = ['FUNDAMENTAL', 'ASYMMETRIC', 'MACRO', 'QUANT', 'PASSIVE_INCOME'] as const;
export type StrategyFamily = (typeof STRATEGY_FAMILIES)[number];

export const isStrategyFamily = (v: string): v is StrategyFamily =>
  (STRATEGY_FAMILIES as readonly string[]).includes(v);

// ── Runway: (Total Liquid Cash + Annualized Dividend Income) / Monthly Burn Rate ──

export interface RunwayComponents {
  liquidCashUsd: number;
  annualizedDividendUsd: number;
  monthlyBurnUsd: number;
}

/**
 * จำนวนเดือนที่อยู่รอด = (เงินสดสภาพคล่อง + รายได้ปันผลรายปี) ÷ ค่าใช้จ่ายต่อเดือน
 * null เมื่อ burn = 0 (อยู่ได้ตลอด — ไม่มีตัวหาร)
 */
export function computeRunwayMonths(p: RunwayComponents): number | null {
  const liquidity = Math.max(0, p.liquidCashUsd) + Math.max(0, p.annualizedDividendUsd);
  return p.monthlyBurnUsd > 0 ? liquidity / p.monthlyBurnUsd : null;
}

// ── Annualized Dividend Income: Σ quantity × price × yield% (เฉพาะ yield > 0) ──

export interface PositionValuation {
  symbol: string;
  type: 'CRYPTO' | 'STOCK' | 'COMMODITY';
  quantity: number;
  strategyFamily: string;
  expectedDividendYieldPct: number;
  catalystNote: string | null;
  avgCostUsd: number | null;
  realizedGainUsd: number;
  soldQty: number;
  priceUsd: number | null;
  valueUsd: number;
}

/**
 * รายได้ปันผลรายปีโดยประมาณ = Σ (จำนวนหน่วย × ราคาล่าสุด × อัตราผลตอบแทน %)
 * ตำแหน่งที่ไม่มีราคา (priceUsd null) หรือ yield = 0 → ไม่มีส่วนร่วม
 */
export function computeAnnualizedDividendUsd(positions: Array<Pick<PositionValuation, 'quantity' | 'priceUsd' | 'expectedDividendYieldPct'>>): number {
  return positions.reduce((sum, p) => {
    if (!p.priceUsd || p.expectedDividendYieldPct <= 0) return sum;
    return sum + p.quantity * p.priceUsd * (p.expectedDividendYieldPct / 100);
  }, 0);
}

// ── Net Worth: เงินสด + สินทรัพย์รวม + เสบียง − หนี้สิน ──

/**
 * Net Worth = เงินสด + สินทรัพย์รวม + เสบียง − หนี้สิน
 * คลamp ที่ 0 — หนี้เกินทรัพย์แสดง 0 ไม่ติดลบ (ตรงนโยบายเดียวกับ runway)
 */
export function computeNetWorth(p: {
  liquidCashUsd: number;
  assetsUsd: number;
  inventoryUsd: number;
  liabilitiesUsd: number;
}): number {
  return Math.max(
    0,
    Math.max(0, p.liquidCashUsd) + Math.max(0, p.assetsUsd) + Math.max(0, p.inventoryUsd) - Math.max(0, p.liabilitiesUsd)
  );
}

// ── 5-Family Allocation Matrix ──

export interface FamilyAllocation {
  family: string;
  valueUsd: number;
  pct: number; // 0-100 ของมูลค่ารวม (เฉพาะที่มีราคา)
  positions: number;
  dividendYieldPct: number; // ถ่วงน้ำหนักด้วยมูลค่า — อัตราปันผลเฉลี่ยของตระกูล
}

/** จัดสรรพอร์ตตาม 5 Strategy Families — มีค่าเป็น 0 ก็แสดง (matrix ครบ 5 แถว) */
export function computeFamilyAllocation(
  positions: Array<Pick<PositionValuation, 'strategyFamily' | 'valueUsd' | 'expectedDividendYieldPct'>>
): { allocation: FamilyAllocation[]; totalUsd: number } {
  const init = new Map<string, FamilyAllocation>();
  for (const f of STRATEGY_FAMILIES) {
    init.set(f, { family: f, valueUsd: 0, pct: 0, positions: 0, dividendYieldPct: 0 });
  }
  for (const p of positions) {
    const family = isStrategyFamily(p.strategyFamily) ? p.strategyFamily : 'FUNDAMENTAL';
    const row = init.get(family)!;
    row.valueUsd += Math.max(0, p.valueUsd);
    row.positions += 1;
    if (p.valueUsd > 0) row.dividendYieldPct += Math.max(0, p.expectedDividendYieldPct) * p.valueUsd;
  }
  const totalUsd = STRATEGY_FAMILIES.reduce((s, f) => s + init.get(f)!.valueUsd, 0);
  const allocation = STRATEGY_FAMILIES.map((f) => {
    const row = init.get(f)!;
    row.pct = totalUsd > 0 ? (row.valueUsd / totalUsd) * 100 : 0;
    row.dividendYieldPct = row.valueUsd > 0 ? row.dividendYieldPct / row.valueUsd : 0;
    return row;
  });
  return { allocation, totalUsd };
}

// ─────────────────────────────────────────────────────────────
// DB-bound helpers — prisma ใช้โครงสร้างย่อ (ง่ายต่อ test/mock)
// ─────────────────────────────────────────────────────────────

export interface TreasuryPrisma {
  personalBalanceSheet: { findUnique: (a: any) => Promise<any>; upsert: (a: any) => Promise<any>; update: (a: any) => Promise<any>; updateMany: (a: any) => Promise<{ count: number }> };
  treasuryEvent: { create: (a: any) => Promise<any>; findMany: (a: any) => Promise<any[]> };
  survivalRunway: { create: (a: any) => Promise<any>; findMany: (a: any) => Promise<any[]> };
  assetPosition: { findUnique: (a: any) => Promise<any>; update: (a: any) => Promise<any>; updateMany: (a: any) => Promise<{ count: number }> };
}

/** ดึง/สร้าง Balance Sheet ของผู้ใช้ (upsert 1:1 ไม่ซ้ำ) */
export async function ensureBalanceSheet(
  prisma: Pick<TreasuryPrisma, 'personalBalanceSheet'>,
  userId: string
): Promise<{ id: string; liquid_cash_usd: number; liabilities_usd: number; monthly_burn_usd: number; monthly_income_usd: number }> {
  const existing = await prisma.personalBalanceSheet.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  return prisma.personalBalanceSheet.upsert({
    where: { user_id: userId },
    create: { user_id: userId },
    update: {},
  });
}

export interface CashCreditOpts {
  type: 'REALIZED_GAIN' | 'DIVIDEND' | 'CASH_ADJUST' | 'SHOP_INCOME';
  symbol?: string | null;
  assetPositionId?: string | null;
  note?: string | null;
}

/**
 * หัวใจของ Data Cross-Linking: เครดิตยอดเงินสดอัตโนมัติ
 * - อัปเดต PersonalBalanceSheet.liquid_cash_usd += amount
 * - บันทึก TreasuryEvent (ฟีดรายได้) ทุกครั้ง
 */
export async function creditLiquidCash(
  prisma: TreasuryPrisma,
  userId: string,
  amountUsd: number,
  opts: CashCreditOpts
): Promise<{ balance: { liquid_cash_usd: number }; event: any }> {
  const raw = Number(amountUsd);
  const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0; // Infinity/NaN/ค่าลบ → 0
  const sheet = await ensureBalanceSheet(prisma, userId);
  const balance = await prisma.personalBalanceSheet.update({
    where: { user_id: userId },
    data: { liquid_cash_usd: Math.max(0, sheet.liquid_cash_usd + amount) },
  });
  const event = await prisma.treasuryEvent.create({
    data: {
      user_id: userId,
      type: opts.type,
      symbol: opts.symbol || null,
      asset_position_id: opts.assetPositionId || null,
      amount_usd: amount,
      note: opts.note || null,
    },
  });
  return { balance, event };
}

/**
 * ขายตำแหน่งลงทุน → คำนวณ realized gain เทียบ avg cost → หักหน่วยออกจากพอร์ต
 * → เครดิตกำไรเข้าบัญชีเงินสด (Realized Gain อัปเดต Liquid Cash อัตโนมัติ)
 * ขาดทุน (gain ติดลบ) → บันทึกสะสมในตำแหน่ง ไม่หักเงินสด (ไม่เก็บเงินออกซ้ำสอง)
 */
export async function recordPositionSale(
  prisma: TreasuryPrisma,
  position: any,
  qtySold: number,
  salePriceUsd: number,
  opts: Partial<CashCreditOpts> = {}
): Promise<{
  ok: boolean;
  reason?: string;
  realizedGainUsd: number;
  remainingQty: number;
  creditUsd: number;
  balance?: { liquid_cash_usd: number };
  event?: any;
}> {
  const rawQty = Number(qtySold);
  const qty = Number.isFinite(rawQty) ? Math.max(0, rawQty) : 0; // Infinity/NaN/ค่าลบ → 0
  const rawPrice = Number(salePriceUsd);
  const price = Number.isFinite(rawPrice) ? Math.max(0, rawPrice) : 0;
  if (qty <= 0) return { ok: false, reason: 'quantity ต้องมากกว่า 0', realizedGainUsd: 0, remainingQty: position.quantity, creditUsd: 0 };
  if (qty > position.quantity)
    return { ok: false, reason: `เหลือในพอร์ตเพียง ${position.quantity}`, realizedGainUsd: 0, remainingQty: position.quantity, creditUsd: 0 };
  if (price <= 0) return { ok: false, reason: 'ราคาขายต้องมากกว่า 0', realizedGainUsd: 0, remainingQty: position.quantity, creditUsd: 0 };

  const avgCost = Math.max(0, Number(position.avg_cost_usd) || 0); // คลamp — ต้นทุนติดลบ = สร้างกำไรลวงได้
  const gainPerUnit = avgCost > 0 ? price - avgCost : price; // ไม่มีต้นทุน → ถือว่าได้กำไรเต็มราคา
  const realizedGainUsd = gainPerUnit * qty;
  const remainingQty = position.quantity - qty;

  // Atomic conditional decrement — กัน TOCTOU: 2 request พร้อมกันขายหน่วยเดียวซ้ำ 2 รอบ
  const upd = await prisma.assetPosition.updateMany({
    where: { id: position.id, user_id: position.user_id, quantity: { gte: qty } },
    data: {
      quantity: { decrement: qty },
      sold_qty: { increment: qty },
      realized_gain_usd: { increment: Number.isFinite(realizedGainUsd) ? realizedGainUsd : 0 },
    },
  });
  if (upd.count !== 1)
    return { ok: false, reason: `เหลือในพอร์ตไม่พอ — ถูกขายไปก่อนหน้านี้แล้ว (เหลือ ${position.quantity})`, realizedGainUsd: 0, remainingQty: position.quantity, creditUsd: 0 };

  // กำไรเท่านั้นที่เครดิตเงินสด — ขาดทุนบันทึกในพอร์ตแต่ไม่หักเงินสด
  if (realizedGainUsd > 0) {
    const { balance, event } = await creditLiquidCash(prisma, position.user_id, realizedGainUsd, {
      type: 'REALIZED_GAIN',
      symbol: position.symbol,
      assetPositionId: position.id,
      note: opts.note || `ขาย ${position.symbol} ${qty} @$${price.toFixed(2)} (กำไร $${realizedGainUsd.toFixed(2)})`,
    });
    return { ok: true, realizedGainUsd, remainingQty, creditUsd: realizedGainUsd, balance, event };
  }
  return { ok: true, realizedGainUsd, remainingQty, creditUsd: 0 };
}

/**
 * บันทึกเงินปันผล → อัปเดต filled position (ฐาน yield) + เครดิตเงินสด (Dividend Payout
 * อัปเดต Liquid Cash อัตโนมัติ) + ฟีดรายได้
 */
export async function recordDividend(
  prisma: TreasuryPrisma,
  position: any,
  amountUsd: number,
  note?: string | null
): Promise<{ ok: boolean; balance?: { liquid_cash_usd: number }; event?: any }> {
  const raw = Number(amountUsd);
  const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0; // Infinity/NaN/ค่าลบ → 0
  if (amount <= 0) return { ok: false };
  await prisma.assetPosition.update({
    where: { id: position.id },
    data: { last_dividend_usd: amount, last_dividend_at: new Date() },
  });
  const { balance, event } = await creditLiquidCash(prisma, position.user_id, amount, {
    type: 'DIVIDEND',
    symbol: position.symbol,
    assetPositionId: position.id,
    note: note || `ปันผล ${position.symbol} $${amount.toFixed(2)}`,
  });
  return { ok: true, balance, event };
}

/** บันทึกสแนปชอต runway (ประวัติเส้น runway) */
export async function recordRunwaySnapshot(
  prisma: Pick<TreasuryPrisma, 'survivalRunway'>,
  userId: string,
  c: RunwayComponents
): Promise<any> {
  return prisma.survivalRunway.create({
    data: {
      user_id: userId,
      months: computeRunwayMonths(c) ?? 0,
      liquid_cash_usd: Math.max(0, c.liquidCashUsd),
      annualized_dividend_usd: Math.max(0, c.annualizedDividendUsd),
      monthly_burn_usd: Math.max(0, c.monthlyBurnUsd),
    },
  });
}