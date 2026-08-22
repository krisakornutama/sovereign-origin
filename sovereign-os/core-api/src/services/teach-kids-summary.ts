// src/services/teach-kids-summary.ts
// kidHome + Dashboard + รายงานรายสัปดาห์ (PDF) + สรุปประจำวันส่ง Telegram

import { prisma } from '../lib/prisma';
import { walletBalance, listWalletTxs } from './teach-kids-wallet';
import { piggyBalance, monthlyPiggyIn, piggyEta } from './teach-kids-piggy';
import { stockPortfolio, portfolioHistory, portfolioPerformance, portfolioDeposits } from './teach-kids-portfolio';
import { listCertificates, kidLevel, kidStats, type KidStats } from './teach-kids-profiles';

/** ข้อมูลทั้งหมดของ "หน้าบ้าน" ของเด็ก: งานบ้าน + บิล + ยอดเงิน + คูปอง + ถังแต้ม + ประวัติ */
export async function kidHome(kidId: string): Promise<{
  kid: {
    id: string; name: string; age: number | null; emoji: string | null; color: string | null;
    allowance_day: number | null; allowance_amount: number | null; allowance_last_paid: Date | null;
    savings_goal: number | null; has_pin: boolean;
    piggy_target_title: string | null; piggy_target_amount: number | null;
    xp: number; level: number; money_mode: string; invest_policy: string;
  };
  chores: Array<{ id: string; title: string; reward: number; emoji: string | null; status: string; repeat: string; completed_at: Date | null }>;
  bills: Array<{ id: string; title: string; amount: number; emoji: string | null; period: string; status: string }>;
  coupons: Array<{ id: string; title: string; cost: number; emoji: string | null; status: string; redeemed_at: Date | null }>;
  balance: number;
  piggy: number;
  piggy_month: number; // ฝากเข้ากระปุกในเดือนนี้ (เทียบเป้าหมายรายเดือน)
  piggy_eta: { balance: number; monthlyRate: number; months: number | null }; // เป้าหมายระยะยาว
  piggy_txs: Array<{ id: string; amount: number; note: string; created_at: Date }>;
  portfolio: {
    holdings: Array<{ symbol: string; name: string; emoji: string; units: number; avg_cost: number; price: number; value: number; profit: number; profitPct: number }>;
    value: number;
    totalCost: number;
    totalProfit: number;
  };
  portfolio_history: Array<{ date: string; value: number }>;
  portfolio_performance: {
    total_deposited: number; portfolio_value: number; profit: number; profit_pct: number;
    deposits_month: number; month_start_value: number | null; month_return_pct: number | null; target_pct: number;
  };
  portfolio_deposits: Array<{ id: string; amount: number; note: string; created_at: Date }>;
  certificates: Array<{ id: string; level: number; title: string; detail: string | null; created_at: Date }>;
  txs: Array<{ id: string; amount: number; note: string; category: string; created_at: Date }>;
}> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [kid, chores, bills, coupons, balance, txs, piggy, piggyMonth, piggyTxs, portfolio] = await Promise.all([
    prisma.kidProfile.findUnique({ where: { id: kidId } }),
    prisma.kidChore.findMany({ where: { kid_id: kidId, archived_at: null }, orderBy: [{ status: 'asc' }, { created_at: 'desc' }] }),
    prisma.kidBill.findMany({ where: { kid_id: kidId, archived_at: null }, orderBy: [{ status: 'asc' }, { created_at: 'desc' }] }),
    prisma.kidCoupon.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' } }),
    walletBalance(kidId),
    listWalletTxs(kidId),
    piggyBalance(kidId),
    monthlyPiggyIn(kidId, now),
    prisma.kidPiggyTx.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' }, take: 20 }),
    stockPortfolio(kidId),
  ]);
  if (!kid) throw new Error('kid not found');
  const eta = await piggyEta(kidId, kid.piggy_target_amount ?? null, now);
  return {
    kid: {
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      allowance_last_paid: kid.allowance_last_paid,
      savings_goal: kid.savings_goal,
      has_pin: !!kid.pin_hash,
      piggy_target_title: kid.piggy_target_title,
      piggy_target_amount: kid.piggy_target_amount,
      xp: kid.xp ?? 0,
      level: kidLevel(kid.xp ?? 0),
      money_mode: kid.money_mode ?? 'play',
      invest_policy: kid.invest_policy ?? '',
    },
    chores,
    bills,
    coupons,
    balance,
    piggy,
    piggy_month: piggyMonth,
    piggy_eta: eta,
    piggy_txs: piggyTxs,
    portfolio,
    portfolio_history: await portfolioHistory(kidId, 30),
    portfolio_performance: await portfolioPerformance(kidId),
    portfolio_deposits: await portfolioDeposits(kidId),
    certificates: await listCertificates(kidId),
    txs,
  };
}

/** สรุปสำหรับหน้า Dashboard — ทุกคนพร้อมสถิติ quiz + ยอดเงิน + งานค้าง/บิลค้าง */
export async function dashboardSummary(): Promise<Array<{
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  savings_goal: number | null;
  piggy: number;
  piggy_target_title: string | null;
  piggy_target_amount: number | null;
  portfolio_value: number;
  stats: KidStats;
  lastQuiz: { lesson_title: string; score: number; total: number; pct: number; completed_at: Date } | null;
  wallet: number;
  pendingChores: number;
  unpaidBills: number;
}>> {
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];

  const [progress, walletGroups, choreGroups, billGroups, piggyGroups] = await Promise.all([
    prisma.kidLessonProgress.findMany({ orderBy: { completed_at: 'desc' }, take: kids.length }),
    prisma.kidWalletTx.groupBy({ by: ['kid_id'], _sum: { amount: true } }),
    prisma.kidChore.groupBy({ by: ['kid_id'], where: { status: 'pending', archived_at: null }, _count: true }),
    prisma.kidBill.groupBy({ by: ['kid_id'], where: { status: 'unpaid', archived_at: null }, _count: true }),
    prisma.kidPiggyTx.groupBy({ by: ['kid_id'], _sum: { amount: true } }),
  ]);
  const lastByKid = new Map(progress.map((p) => [p.kid_id, p]));
  const walletByKid = new Map(walletGroups.map((g) => [g.kid_id, g._sum.amount ?? 0]));
  const choreByKid = new Map(choreGroups.map((g) => [g.kid_id, g._count ?? 0]));
  const billByKid = new Map(billGroups.map((g) => [g.kid_id, g._count ?? 0]));
  const piggyByKid = new Map(piggyGroups.map((g) => [g.kid_id, g._sum.amount ?? 0]));

  const out = [];
  for (const kid of kids) {
    const last = lastByKid.get(kid.id);
    const portfolio = await stockPortfolio(kid.id);
    out.push({
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day ?? null,
      allowance_amount: kid.allowance_amount ?? null,
      savings_goal: kid.savings_goal ?? null,
      piggy: piggyByKid.get(kid.id) ?? 0,
      piggy_target_title: kid.piggy_target_title ?? null,
      piggy_target_amount: kid.piggy_target_amount ?? null,
      portfolio_value: portfolio.value,
      xp: kid.xp ?? 0,
      level: kidLevel(kid.xp ?? 0),
      money_mode: kid.money_mode ?? 'play',
      stats: await kidStats(kid.id),
      lastQuiz: last
        ? {
            lesson_title: last.lesson_title,
            score: last.score,
            total: last.total,
            pct: last.total > 0 ? Math.round((last.score / last.total) * 100) : 0,
            completed_at: last.completed_at,
          }
        : null,
      wallet: walletByKid.get(kid.id) ?? 0,
      pendingChores: choreByKid.get(kid.id) ?? 0,
      unpaidBills: billByKid.get(kid.id) ?? 0,
    });
  }
  return out;
}

// ────────────────────────────────────────────────
// รายงานรายสัปดาห์ — สำหรับส่งออก PDF (คะแนน + งานบ้าน + บิล + ยอดเงิน)
// ────────────────────────────────────────────────

/** รวบรวมข้อมูลของทุกคนใน 7 วันล่าสุด ให้ frontend สร้าง PDF ผ่านหน้าต่างพิมพ์ */
export async function weeklyReport(days = 7): Promise<Array<Record<string, unknown>>> {
  const since = new Date(Date.now() - days * 86400000);
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];

  const out = [];
  for (const kid of kids) {
    const [progress, chores, bills, txs, balance, stats] = await Promise.all([
      prisma.kidLessonProgress.findMany({
        where: { kid_id: kid.id, completed_at: { gte: since } },
        orderBy: { completed_at: 'asc' },
      }),
      prisma.kidChore.findMany({ where: { kid_id: kid.id, archived_at: null }, orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.kidBill.findMany({ where: { kid_id: kid.id, archived_at: null }, orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.kidWalletTx.findMany({
        where: { kid_id: kid.id, created_at: { gte: since } },
        orderBy: { created_at: 'desc' },
        take: 100,
      }),
      walletBalance(kid.id),
      kidStats(kid.id),
    ]);
    out.push({
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      stats,
      progress,
      chores,
      bills,
      txs,
      balance,
    });
  }
  return out;
}

// ────────────────────────────────────────────────
// สรุปประจำวันของลูก — ส่ง Telegram ตอนเย็น (งานที่ทำ + คะแนน + ยอดเงิน)
// ────────────────────────────────────────────────

export interface DailySummaryRow {
  id: string;
  name: string;
  emoji: string | null;
  choresDone: number;
  choresReward: number;
  billsPaid: number;
  wallet: number;
  piggy: number;
}

/** รวบรวมกิจกรรม 24 ชม. ล่าสุดของทุกคน */
export async function buildDailySummary(now: Date = new Date()): Promise<{ kids: DailySummaryRow[]; generatedAt: Date }> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  const out: DailySummaryRow[] = [];
  for (const kid of kids) {
    const [choresDone, choresAgg, billsPaid, wallet, piggy] = await Promise.all([
      prisma.kidChore.count({ where: { kid_id: kid.id, status: 'done', completed_at: { gte: since } } }),
      prisma.kidWalletTx.aggregate({
        where: { kid_id: kid.id, category: 'chore', created_at: { gte: since } },
        _sum: { amount: true },
      }),
      prisma.kidBill.count({ where: { kid_id: kid.id, status: 'paid', paid_at: { gte: since } } }),
      walletBalance(kid.id),
      piggyBalance(kid.id),
    ]);
    out.push({
      id: kid.id,
      name: kid.name,
      emoji: kid.emoji,
      choresDone,
      choresReward: choresAgg._sum.amount ?? 0,
      billsPaid,
      wallet,
      piggy,
    });
  }
  return { kids: out, generatedAt: now };
}

/** แปลงสรุป → ข้อความ Telegram (HTML) */
export function formatDailySummary(s: { kids: DailySummaryRow[]; generatedAt: Date }): string {
  const date = s.generatedAt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const blocks = s.kids.map((k) => {
    const work = k.choresDone > 0
      ? `✅ ทำงานเสร็จ <b>${k.choresDone}</b> งาน (ได้ <b>${k.choresReward}฿</b>)`
      : '😴 วันนี้ยังไม่ได้ทำงานบ้าน';
    const bill = k.billsPaid > 0 ? ` · จ่ายบิล ${k.billsPaid} ใบ` : '';
    return `\n👶 <b>${k.emoji || '🧒'} ${k.name}</b>\n${work}${bill}\n💵 เงินในกระเป๋า: <b>${k.wallet.toLocaleString()}฿</b> · 🐷 ถังสะสมแต้ม: <b>${k.piggy.toLocaleString()}฿</b>`;
  }).join('\n');
  return `📋 <b>สรุปประจำวันของลูก</b> (${date})\n${blocks}\n\n💡 สอนลูกเรื่องการออม: เก็บ 10% ของที่ได้เข้ากระปุกก่อนใช้จ่าย แล้วลองเล่น <b>หุ้นจำลองของบ้าน</b> ในคลังความรู้ → หน้าที่ของลูก`;
}
