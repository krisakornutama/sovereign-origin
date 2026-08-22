// src/services/teach-kids-piggy.ts
// ถังสะสมแต้ม + เป้าหมายออม (รายเดือน/ระยะยาว) + PIN ส่วนตัวของลูก

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireKid, normMoney, logKidAction } from './teach-kids-shared';
import { walletBalance } from './teach-kids-wallet';

// ────────────────────────────────────────────────
// ถังสะสมแต้ม — เปลี่ยนคะแนนจากงานบ้านเป็นเหรียญเก็บกระปุก + เป้าหมายออมรายเดือน
// ────────────────────────────────────────────────

/** ยอดในกระปุก = ผลรวมธุรกรรมถัง (ติดลบไม่ได้ — ถอนได้เท่าที่มี) */
export async function piggyBalance(kidId: string): Promise<number> {
  const agg = await prisma.kidPiggyTx.aggregate({ where: { kid_id: kidId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

/** ฝากเข้ากระปุกในเดือนนี้ (เทียบเป้าหมายรายเดือน) */
export async function monthlyPiggyIn(kidId: string, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.kidPiggyTx.aggregate({
    where: { kid_id: kidId, amount: { gt: 0 }, created_at: { gte: monthStart } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** ตั้งเป้าหมายออมรายเดือน (บาท) — 0/ว่าง = ปิด */
export async function setSavingsGoal(kidId: string, goal: number): Promise<{ goal: number | null }> {
  await requireKid(kidId);
  const g = Math.floor(Number(goal));
  if (!Number.isFinite(g) || g < 0) throw new Error('goal ต้องเป็นตัวเลข ≥ 0');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { savings_goal: g > 0 ? g : null } });
  return { goal: g > 0 ? g : null };
}

/**
 * ฝาก/ถอนเหรียญ: amount > 0 = หักจากกระเป๋าเงินเข้าถัง, amount < 0 = ถอนกลับกระเป๋า
 * บันทึกทั้ง 2 ฝั่ง (wallet tx หมวด piggy + piggy tx)
 */
export async function piggyTransfer(kidId: string, amount: number, note?: string | null): Promise<{ id: string; amount: number; balance: number }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt === 0) throw new Error('amount ต้องไม่เป็น 0');
  const label = String(note ?? '').trim().slice(0, 300) || (amt > 0 ? 'ฝากเข้าถัง' : 'ถอนจากถัง');
  if (amt > 0) {
    // ฝากเข้า — หักจากกระเป๋าเงินก่อน (ต้องพอ)
    const balance = await walletBalance(kidId);
    if (balance < amt) throw new Error('not enough balance');
    await prisma.kidWalletTx.create({
      data: { kid_id: kidId, amount: -amt, note: `ฝากเข้าถัง: ${label}`, category: 'piggy' },
    });
  } else {
    // ถอนออก — ต้องมีในกระปุกพอ
    const piggy = await piggyBalance(kidId);
    if (piggy < -amt) throw new Error('not enough in piggy');
    await prisma.kidWalletTx.create({
      data: { kid_id: kidId, amount: -amt, note: `ถอนจากถัง: ${label}`, category: 'piggy' },
    });
  }
  const item = await prisma.kidPiggyTx.create({
    data: { kid_id: kidId, amount: amt, note: label },
  });
  return { id: item.id, amount: amt, balance: (await piggyBalance(kidId)) };
}

// ────────────────────────────────────────────────
// PIN ส่วนตัวของลูก — ให้เด็กกดทำงานเสร็จ/แลกคูปองเองได้ (ไม่พึ่งผู้ใหญ่)
// ────────────────────────────────────────────────

/** ตั้ง/เปลี่ยน/ล้าง PIN ของลูก (4-6 หลัก) — เก็บเป็น bcrypt hash */
export async function setKidPin(kidId: string, pin: string): Promise<{ has_pin: boolean }> {
  await requireKid(kidId);
  const p = String(pin ?? '').trim();
  if (p !== '' && !/^\d{4,6}$/.test(p)) throw new Error('PIN ต้องเป็นตัวเลข 4-6 หลัก');
  const pin_hash = p ? await bcrypt.hash(p, 10) : null;
  await prisma.kidProfile.update({ where: { id: kidId }, data: { pin_hash } });
  await logKidAction(kidId, pin_hash ? 'pin_set' : 'pin_clear', pin_hash ? 'ตั้ง PIN ใหม่' : 'ล้าง PIN', 'parent');
  return { has_pin: !!pin_hash };
}

/** ตรวจ PIN — false เมื่อไม่มี PIN ตั้งไว้ หรือ PIN ผิด */
export async function verifyKidPin(kidId: string, pin: string): Promise<boolean> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid || !kid.pin_hash) return false;
  try {
    return await bcrypt.compare(String(pin ?? ''), kid.pin_hash);
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────
// เป้าหมายระยะยาวของถังสะสมแต้ม + ระยะเวลาคาดว่าจะถึง
// ────────────────────────────────────────────────

/** ตั้งเป้าหมายระยะยาว (เช่น "ซื้อจักรยาน 500฿") — amount 0 = ล้าง */
export async function setPiggyTarget(kidId: string, input: { title: string; amount: number }): Promise<{ title: string | null; amount: number | null }> {
  await requireKid(kidId);
  const amount = Math.floor(Number(input?.amount));
  if (!Number.isFinite(amount) || amount < 0) throw new Error('amount ต้องเป็นตัวเลข ≥ 0');
  const title = String(input?.title ?? '').trim().slice(0, 100);
  if (amount > 0 && !title) throw new Error('title is required');
  await prisma.kidProfile.update({
    where: { id: kidId },
    data: {
      piggy_target_amount: amount > 0 ? amount : null,
      piggy_target_title: amount > 0 ? title : null,
    },
  });
  return { title: amount > 0 ? title : null, amount: amount > 0 ? amount : null };
}

/** คำนวณระยะเวลา (เดือน) ที่คาดว่าจะถึงเป้าหมาย จากอัตราฝาก 30 วันล่าสุด */
export async function piggyEta(kidId: string, target: number | null, now: Date = new Date()): Promise<{ balance: number; monthlyRate: number; months: number | null }> {
  const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
  const [balance, deposits] = await Promise.all([
    piggyBalance(kidId),
    prisma.kidPiggyTx.aggregate({
      where: { kid_id: kidId, amount: { gt: 0 }, created_at: { gte: thirtyAgo } },
      _sum: { amount: true },
    }),
  ]);
  const monthlyRate = deposits._sum.amount ?? 0;
  let months: number | null = null;
  if (target != null && target > balance && monthlyRate > 0) {
    months = Math.max(1, Math.ceil((target - balance) / monthlyRate));
  }
  return { balance, monthlyRate, months };
}
