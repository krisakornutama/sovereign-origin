// src/services/teach-kids-allowance.ts
// ค่าขนมรายสัปดาห์อัตโนมัติ — ผู้ใหญ่ตั้งวัน + จำนวนเงิน แล้ว worker จ่ายให้เอง
// รวมจ่ายย้อนหลังด้วยมือ + ประวัติการจ่ายทุกคน

import { prisma } from '../lib/prisma';
import { requireKid, normMoney, logKidAction } from './teach-kids-shared';

// ────────────────────────────────────────────────
// ค่าขนมรายสัปดาห์อัตโนมัติ — ผู้ใหญ่ตั้งวัน + จำนวนเงิน แล้ว worker จ่ายให้เอง
// ────────────────────────────────────────────────

export const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

interface AllowanceKid {
  id: string;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: Date | null;
}

/** กำหนดค่าขนมรายสัปดาห์: day = 0 (อาทิตย์) … 6 (เสาร์), amount = บาท */
export async function setAllowance(kidId: string, input: { day: number; amount: number }): Promise<{ day: number; amount: number }> {
  await requireKid(kidId);
  const day = Math.floor(Number(input?.day));
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('day ต้องเป็น 0-6 (0=อาทิตย์ … 6=เสาร์)');
  const amount = normMoney(input?.amount);
  if (amount <= 0) throw new Error('amount ต้องมากกว่า 0');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { allowance_day: day, allowance_amount: amount } });
  return { day, amount };
}

/**
 * ถึงกำหนดจ่ายหรือยัง? — จ่าย 1 ครั้งต่อสัปดาห์ โดยนับสัปดาห์จากวันจ่าย
 * anchor = ครั้งล่าสุดของวันจ่ายที่ผ่านมา ถ้ายังไม่เคยจ่ายในรอบนี้ → จ่าย
 */
export function allowanceDueNow(kid: AllowanceKid, now: Date): boolean {
  if (kid.allowance_day == null || kid.allowance_amount == null) return false;
  const day = kid.allowance_day;
  const diff = (now.getDay() - day + 7) % 7; // กี่วันแล้วนับจากวันจ่ายล่าสุด
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  if (!kid.allowance_last_paid) return true;
  const lastPaid = new Date(kid.allowance_last_paid);
  return lastPaid < anchor;
}

/** worker: จ่ายค่าขนมให้ทุกคนที่ถึงกำหนด (กันจ่ายซ้ำด้วย allowance_last_paid) */
export async function payWeeklyAllowances(now: Date = new Date()): Promise<{ paid: number; total: number }> {
  const kids = await prisma.kidProfile.findMany({
    where: { allowance_day: { not: null }, allowance_amount: { not: null } },
  });
  let paid = 0;
  let total = 0;
  for (const kid of kids) {
    if (!allowanceDueNow(kid, now)) continue;
    const amount = kid.allowance_amount!;
    await prisma.kidWalletTx.create({
      data: {
        kid_id: kid.id,
        amount,
        note: `ค่าขนมรายสัปดาห์ (${WEEKDAYS[kid.allowance_day!]})`,
        category: 'allowance',
      },
    });
    await prisma.kidProfile.update({ where: { id: kid.id }, data: { allowance_last_paid: now } });
    paid += 1;
    total += amount;
  }
  return { paid, total };
}

// ────────────────────────────────────────────────
// ค่าขนม: จ่ายย้อนหลังด้วยมือ + ประวัติการจ่ายทุกคน
// ────────────────────────────────────────────────

/** จ่ายค่าขนมให้คนเดียวทันที (ถ้าถึงกำหนด) — ใช้เมื่อ worker พลาด */
export async function payAllowanceNow(kidId: string, now: Date = new Date()): Promise<{ paid: boolean; amount: number | null }> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  if (!allowanceDueNow(kid, now)) return { paid: false, amount: null };
  const amount = kid.allowance_amount!;
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount, note: `ค่าขนมรายสัปดาห์ (${WEEKDAYS[kid.allowance_day!]})`, category: 'allowance' },
  });
  await prisma.kidProfile.update({ where: { id: kidId }, data: { allowance_last_paid: now } });
  await logKidAction(kidId, 'allowance_pay', `ค่าขนมรายสัปดาห์ +${amount}฿`, 'parent');
  return { paid: true, amount };
}

/** ประวัติการจ่ายค่าขนมของทุกคน — ตั้งค่า + รายการจ่ายล่าสุด */
export async function allowanceHistory(): Promise<Array<{
  id: string;
  name: string;
  emoji: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: Date | null;
  txs: Array<{ id: string; amount: number; note: string; created_at: Date }>;
}>> {
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];
  const out = [];
  for (const kid of kids) {
    const txs = await prisma.kidWalletTx.findMany({
      where: { kid_id: kid.id, category: 'allowance' },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
    out.push({
      id: kid.id,
      name: kid.name,
      emoji: kid.emoji,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      allowance_last_paid: kid.allowance_last_paid,
      txs,
    });
  }
  return out;
}
