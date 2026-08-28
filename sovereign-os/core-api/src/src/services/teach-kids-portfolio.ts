// src/services/teach-kids-portfolio.ts
// หุ้นจำลองของบ้าน + พอร์ตย้อนหลัง + เงินจริง/นโยบายลงทุน

import { prisma } from '../lib/prisma';
import { requireKid, normMoney, logKidAction } from './teach-kids-shared';
import { walletBalance } from './teach-kids-wallet';

// ────────────────────────────────────────────────
// หุ้นจำลองของบ้าน — สอนลูกเรื่องการลงทุน (ราคาเปลี่ยนทุกวันแบบกำหนดได้)
// ────────────────────────────────────────────────

/** หุ้นของ "ที่บ้าน" — ธีมเดียวกับระบบ (น้ำ/โซลาร์/แปลงผัก) */
export const STOCK_CATALOG = [
  { symbol: 'WATER', name: 'น้ำป่า (ระบบน้ำ)', emoji: '💧', base: 50 },
  { symbol: 'SOLAR', name: 'ไร่แสง (โซลาร์)', emoji: '☀️', base: 80 },
  { symbol: 'FARM', name: 'ไร่ผัก (แปลงเกษตร)', emoji: '🥬', base: 30 },
] as const;

export type StockSymbol = (typeof STOCK_CATALOG)[number]['symbol'];

function symbolHash(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}

/** ราคาหุ้นจำลอง — deterministic ตามวัน (sin wave + trend + jitter จาก seed เดียวกัน) */
export function stockPrice(symbol: string, date: Date = new Date()): number {
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) return 0;
  const day = Math.floor(date.getTime() / 86400000);
  const wave = Math.sin((day + item.base) * 1.7) * 0.12;
  const drift = ((day % 90) - 45) * 0.002;
  const seed = Math.sin(day * 12.9898 + symbolHash(symbol)) * 43758.5453;
  const jitter = (seed - Math.floor(seed) - 0.5) * 0.06;
  return Math.max(1, Math.round(item.base * (1 + wave + drift + jitter) * 100) / 100);
}

/** ราคา/มูลค่าพอร์ตของเด็ก */
export async function stockPortfolio(kidId: string): Promise<{
  holdings: Array<{ symbol: string; name: string; emoji: string; units: number; avg_cost: number; price: number; value: number; profit: number; profitPct: number }>;
  value: number;
  totalCost: number;
  totalProfit: number;
}> {
  const rows = await prisma.kidInvestment.findMany({ where: { kid_id: kidId } });
  const holdings = rows.map((r) => {
    const item = STOCK_CATALOG.find((s) => s.symbol === r.symbol);
    const price = stockPrice(r.symbol);
    const value = Math.round(r.units * price * 100) / 100;
    const cost = r.avg_cost * r.units;
    const profit = Math.round((value - cost) * 100) / 100;
    return {
      symbol: r.symbol,
      name: item?.name ?? r.symbol,
      emoji: item?.emoji ?? '📈',
      units: r.units,
      avg_cost: r.avg_cost,
      price,
      value,
      profit,
      profitPct: cost > 0 ? Math.round((profit / cost) * 100) : 0,
    };
  });
  const value = Math.round(holdings.reduce((a, h) => a + h.value, 0) * 100) / 100;
  const totalCost = Math.round(holdings.reduce((a, h) => a + h.avg_cost * h.units, 0) * 100) / 100;
  return {
    holdings,
    value,
    totalCost,
    totalProfit: Math.round((value - totalCost) * 100) / 100,
  };
}

/** ลูกซื้อหุ้นด้วยเงินจากกระเป๋า — หักเงิน + บันทึก holding (เฉลี่ยต้นทุน) */
export async function buyStock(kidId: string, symbol: string, units: number): Promise<{ symbol: string; units: number; price: number; cost: number }> {
  await requireKid(kidId);
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) throw new Error('unknown symbol');
  const qty = Math.floor(Number(units));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('units ต้องเป็นจำนวนเต็ม > 0');
  const price = stockPrice(symbol);
  const cost = Math.round(qty * price);
  const balance = await walletBalance(kidId);
  if (balance < cost) throw new Error('not enough balance');
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -cost, note: `ซื้อหุ้น ${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, category: 'stock' },
  });
  const existing = await prisma.kidInvestment.findUnique({ where: { kid_id_symbol: { kid_id: kidId, symbol } } });
  if (existing) {
    const newUnits = existing.units + qty;
    const newAvg = (existing.avg_cost * existing.units + cost) / newUnits;
    await prisma.kidInvestment.update({
      where: { id: existing.id },
      data: { units: newUnits, avg_cost: Math.round(newAvg * 100) / 100 },
    });
  } else {
    await prisma.kidInvestment.create({
      data: { kid_id: kidId, symbol, units: qty, avg_cost: Math.round(price * 100) / 100 },
    });
  }
  await logKidAction(kidId, 'stock_buy', `${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, 'kid');
  return { symbol, units: qty, price, cost };
}

/** ลูกขายหุ้น — ได้เงินเข้ากระเป๋า (หักหน่วยจาก holding) */
export async function sellStock(kidId: string, symbol: string, units: number): Promise<{ symbol: string; units: number; price: number; proceeds: number }> {
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) throw new Error('unknown symbol');
  const qty = Math.floor(Number(units));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('units ต้องเป็นจำนวนเต็ม > 0');
  const holding = await prisma.kidInvestment.findUnique({ where: { kid_id_symbol: { kid_id: kidId, symbol } } });
  if (!holding || holding.units < qty) throw new Error('not enough units');
  const price = stockPrice(symbol);
  const proceeds = Math.round(qty * price);
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: proceeds, note: `ขายหุ้น ${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, category: 'stock' },
  });
  const remaining = holding.units - qty;
  if (remaining <= 0) {
    await prisma.kidInvestment.delete({ where: { id: holding.id } });
  } else {
    await prisma.kidInvestment.update({ where: { id: holding.id }, data: { units: remaining } });
  }
  await logKidAction(kidId, 'stock_sell', `${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, 'kid');
  return { symbol, units: remaining <= 0 ? 0 : remaining, price, proceeds };
}

// ────────────────────────────────────────────────
// พอร์ตหุ้นย้อนหลัง + เงินจริง/นโยบายลงทุน
// ────────────────────────────────────────────────

/** บันทึก snapshot มูลค่าพอร์ตของวันนี้ (วันละ 1 แถวต่อเด็ก — แก้ไขแทนการซ้ำ) */
export async function recordPortfolioSnapshot(kidId: string): Promise<void> {
  try {
    const portfolio = await stockPortfolio(kidId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const existing = await prisma.kidPortfolioSnapshot.findFirst({
      where: { kid_id: kidId, created_at: { gte: startOfDay } },
      orderBy: { created_at: 'desc' },
    });
    if (existing) {
      await prisma.kidPortfolioSnapshot.update({
        where: { id: existing.id },
        data: { value: portfolio.value },
      });
    } else {
      await prisma.kidPortfolioSnapshot.create({
        data: { kid_id: kidId, value: portfolio.value },
      });
    }
  } catch (err) {
    console.error('recordPortfolioSnapshot error:', err instanceof Error ? err.message : err);
  }
}

/** บันทึก snapshot ให้เด็กทุกคน (worker รายวัน) */
export async function snapshotAllPortfolios(): Promise<{ saved: number }> {
  const kids = await prisma.kidProfile.findMany({ select: { id: true } });
  let saved = 0;
  for (const kid of kids) {
    try {
      await recordPortfolioSnapshot(kid.id);
      saved += 1;
    } catch {
      // ข้ามเด็กที่ error
    }
  }
  return { saved };
}

/** ประวัติมูลค่าพอร์ต (รายวัน — ใหม่สุดก่อน) */
export async function portfolioHistory(kidId: string, days = 60): Promise<Array<{ date: string; value: number }>> {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.kidPortfolioSnapshot.findMany({
    where: { kid_id: kidId, created_at: { gte: since } },
    orderBy: { created_at: 'asc' },
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.created_at.toISOString().slice(0, 10), r.value); // วันหลัง ๆ ทับวันเก่า
  }
  return [...byDay.entries()].map(([date, value]) => ({ date, value }));
}

/** เปลี่ยนโหมดเงิน: 'play' = เงินจำลอง (หัดเล่น) | 'real' = เงินจริงที่พ่อแม่มอบหมายให้ลูกบริหาร */
export async function setKidMoneyMode(kidId: string, mode: string): Promise<{ money_mode: string }> {
  if (mode !== 'play' && mode !== 'real') throw new Error('money_mode ต้องเป็น play หรือ real');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { money_mode: mode } });
  await logKidAction(kidId, 'money_mode', `เปลี่ยนโหมดเงินเป็น ${mode === 'real' ? 'เงินจริง 💵' : 'เงินจำลอง 🎮'}`, 'parent');
  return { money_mode: mode };
}

/** นโยบายของผู้ใหญ่: ลูกต้องเก็บ/ลงทุนยังไง (เช่น เก็บ 20% เข้าถังและลงทุนเสมอ) */
export async function setInvestPolicy(kidId: string, text: string): Promise<{ invest_policy: string }> {
  const t = String(text ?? '').trim().slice(0, 500);
  await prisma.kidProfile.update({ where: { id: kidId }, data: { invest_policy: t } });
  if (t) await logKidAction(kidId, 'invest_policy', `ตั้งนโยบายลงทุน: ${t}`, 'parent');
  return { invest_policy: t };
}

/** เป้าหมายผลตอบแทนรายเดือน (%) ของพอร์ตเงินจริง — เทียบในรายงาน */
export async function setInvestTargetPct(kidId: string, pct: number): Promise<{ invest_target_pct: number }> {
  const p = Number(pct);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('invest_target_pct ต้องอยู่ระหว่าง 0-100');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { invest_target_pct: Math.round(p * 10) / 10 } });
  await logKidAction(kidId, 'invest_target', `ตั้งเป้าหมายผลตอบแทนรายเดือน ${p}%`, 'parent');
  return { invest_target_pct: Math.round(p * 10) / 10 };
}

// ── พ่อแม่เติมเงินจริงเข้าพอร์ตหุ้น (เงินเก็บของลูกที่มอบหมายให้ลูกบริหาร) ──

/** เพิ่มเงินฝากเข้าพอร์ต: เข้าบัญชี + บันทึกยอดฝาก + audit */
export async function addPortfolioDeposit(kidId: string, amount: number, note?: string | null): Promise<{ id: string; amount: number }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt <= 0) throw new Error('amount ต้องมากกว่า 0');
  const text = String(note ?? '').trim().slice(0, 200) || 'พ่อแม่เติมเงินจริงเข้าพอร์ต';
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: amt, note: `💰 ${text}`, category: 'stock_deposit' },
  });
  const item = await prisma.kidPortfolioDeposit.create({
    data: { kid_id: kidId, amount: amt, note: text },
  });
  await logKidAction(kidId, 'portfolio_deposit', `พ่อแม่เติมเงินจริงเข้าพอร์ต +${amt}฿ (${text})`, 'parent');
  return { id: item.id, amount: amt };
}

/** ประวัติยอดฝากเข้าพอร์ต (ใหม่สุดก่อน) */
export async function portfolioDeposits(kidId: string): Promise<Array<{ id: string; amount: number; note: string; created_at: Date }>> {
  return prisma.kidPortfolioDeposit.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * ผลตอบแทนพอร์ต: เงินฝากทั้งหมด vs มูลค่าปัจจุบัน + ผลตอบแทนรายเดือน (จาก snapshot)
 * month_return_pct ≈ (value_now - month_start - deposits_month) / (month_start + deposits_month) * 100
 */
export async function portfolioPerformance(kidId: string): Promise<{
  total_deposited: number;
  portfolio_value: number;
  profit: number;
  profit_pct: number;
  deposits_month: number;
  month_start_value: number | null;
  month_return_pct: number | null;
  target_pct: number;
}> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [deposits, agg, portfolio, monthDepAgg, monthStartSnap] = await Promise.all([
    prisma.kidPortfolioDeposit.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.kidPortfolioDeposit.aggregate({ where: { kid_id: kidId }, _sum: { amount: true } }),
    stockPortfolio(kidId),
    prisma.kidPortfolioDeposit.aggregate({ where: { kid_id: kidId, created_at: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.kidPortfolioSnapshot.findFirst({ where: { kid_id: kidId, created_at: { gte: monthStart } }, orderBy: { created_at: 'asc' } }),
  ]);
  const totalDeposited = agg._sum.amount ?? 0;
  const depositsMonth = monthDepAgg._sum.amount ?? 0;
  const monthStartValue = monthStartSnap?.value ?? null;
  const value = portfolio.value;
  let monthReturnPct: number | null = null;
  if (monthStartValue != null) {
    const base = monthStartValue + depositsMonth;
    if (base > 0) monthReturnPct = Math.round(((value - base) / base) * 1000) / 10;
  }
  const profit = Math.round((value - totalDeposited) * 100) / 100;
  return {
    total_deposited: totalDeposited,
    portfolio_value: value,
    profit,
    profit_pct: totalDeposited > 0 ? Math.round((profit / totalDeposited) * 1000) / 10 : 0,
    deposits_month: depositsMonth,
    month_start_value: monthStartValue,
    month_return_pct: monthReturnPct,
    target_pct: kid.invest_target_pct ?? 0,
  };
}
