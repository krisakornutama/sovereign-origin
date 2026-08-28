// src/services/teach-kids-wallet.ts
// กระเป๋าเงิน + บิล (ค่าไฟ/ค่าน้ำ/ค่าห้อง) + คูปองรางวัล

import { prisma } from '../lib/prisma';
import { requireKid, normMoney, checkKidPin, logKidAction, notifyParent } from './teach-kids-shared';

// ── บิล (ค่าไฟ / ค่าน้ำ / ค่าห้อง) ──

export interface BillInput {
  title: string;
  amount: number;
  emoji?: string | null;
  period?: string; // one-time | monthly
}

export async function addBill(kidId: string, input: BillInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const amount = normMoney(input?.amount);
  if (amount <= 0) throw new Error('amount ต้องมากกว่า 0');
  const item = await prisma.kidBill.create({
    data: {
      kid_id: kidId,
      title,
      amount,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      period: input?.period === 'monthly' ? 'monthly' : 'one-time',
      status: 'unpaid',
    },
  });
  return { id: item.id };
}

export async function deleteBill(kidId: string, billId: string): Promise<void> {
  await prisma.kidBill.delete({ where: { id: billId, kid_id: kidId } });
}

/** เด็กจ่ายบิลจากกระเป๋าเงิน (หักเงิน — ติดลบได้ = บทเรียนเรื่องเงิน) */
export async function payBill(kidId: string, billId: string): Promise<{ id: string; amount: number }> {
  await requireKid(kidId);
  const bill = await prisma.kidBill.findUnique({ where: { id: billId } });
  if (!bill || bill.kid_id !== kidId) throw new Error('bill not found');
  if (bill.status === 'paid') return { id: bill.id, amount: bill.amount }; // จ่ายซ้ำ → ไม่หักซ้ำ
  await prisma.kidBill.update({ where: { id: billId }, data: { status: 'paid', paid_at: new Date() } });
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -bill.amount, note: `จ่าย${bill.title}`, category: 'bill' },
  });
  await logKidAction(kidId, 'bill_pay', `${bill.emoji ? bill.emoji + ' ' : ''}${bill.title} -${bill.amount}฿`, 'kid');
  return { id: bill.id, amount: bill.amount };
}

// ── กระเป๋าเงิน ──

/** ยอดคงเหลือ = ผลรวมธุรกรรม (ติดลบได้) */
export async function walletBalance(kidId: string): Promise<number> {
  const agg = await prisma.kidWalletTx.aggregate({
    where: { kid_id: kidId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** ผู้ใหญ่เติม/หักเงินให้ (ค่าขนม, ค่าปรับ ฯลฯ) — amount ติดลบได้ */
export async function addWalletMoney(kidId: string, amount: number, note?: string | null): Promise<{ id: string }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt === 0) throw new Error('amount ต้องไม่เป็น 0');
  const item = await prisma.kidWalletTx.create({
    data: {
      kid_id: kidId,
      amount: amt,
      note: String(note ?? '').trim().slice(0, 300) || 'เติมเงิน',
      category: 'manual',
    },
  });
  return { id: item.id };
}

export async function listWalletTxs(kidId: string, limit = 30): Promise<Array<{ id: string; amount: number; note: string; category: string; created_at: Date }>> {
  return prisma.kidWalletTx.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}

// ────────────────────────────────────────────────
// คูปองรางวัล — ผู้ใหญ่สร้างรางวัลพิเศษ ให้ลูกแลกด้วยคะแนนจากการทำงานบ้าน
// ────────────────────────────────────────────────

export interface CouponInput {
  title: string;
  cost: number; // คะแนน/บาท ที่ต้องใช้แลก
  emoji?: string | null;
}

/** ผู้ใหญ่สร้างคูปองรางวัล เช่น "เล่นเกม 30 นาที" 50 คะแนน */
export async function addCoupon(kidId: string, input: CouponInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const cost = normMoney(input?.cost);
  if (cost <= 0) throw new Error('cost ต้องมากกว่า 0');
  const item = await prisma.kidCoupon.create({
    data: {
      kid_id: kidId,
      title,
      cost,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      status: 'available',
    },
  });
  return { id: item.id };
}

export async function deleteCoupon(kidId: string, couponId: string): Promise<void> {
  await prisma.kidCoupon.delete({ where: { id: couponId, kid_id: kidId } });
}

/** ลูกแลกคูปอง → หักคะแนนจากกระเป๋าเงิน + ขึ้นสถานะ redeemed (แลกได้ครั้งเดียว) — ถ้าเด็กมี PIN ต้องกรอก */
export async function redeemCoupon(kidId: string, couponId: string, pin?: string | null): Promise<{ id: string; title: string; cost: number }> {
  await checkKidPin(kidId, pin);
  const coupon = await prisma.kidCoupon.findUnique({ where: { id: couponId } });
  if (!coupon || coupon.kid_id !== kidId) throw new Error('coupon not found');
  if (coupon.status !== 'available') throw new Error('coupon already redeemed');
  const balance = await walletBalance(kidId);
  if (balance < coupon.cost) throw new Error('not enough balance');
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -coupon.cost, note: `แลกคูปอง: ${coupon.title}`, category: 'coupon' },
  });
  await prisma.kidCoupon.update({ where: { id: couponId }, data: { status: 'redeemed', redeemed_at: new Date() } });
  await logKidAction(kidId, 'coupon_redeem', `${coupon.emoji ? coupon.emoji + ' ' : ''}${coupon.title} -${coupon.cost} แต้ม`, pin ? 'kid' : 'parent');
  // แจ้งผู้ใหญ่ทาง Telegram ทันที (best-effort)
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId }, select: { name: true } });
  await notifyParent(`🎁 ${kid?.name ?? 'ลูก'} แลกคูปอง: ${coupon.emoji ? coupon.emoji + ' ' : ''}${coupon.title} (${coupon.cost} แต้ม)\n💼 เงินคงเหลือ: ${balance - coupon.cost}฿`);
  return { id: coupon.id, title: coupon.title, cost: coupon.cost };
}
