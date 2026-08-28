// src/services/teach-kids-chores.ts
// งานบ้าน (ทำงานแลกเงิน) + รีเซ็ตงานรายวัน + เก็บถาวรงาน/บิลเก่า

import { prisma } from '../lib/prisma';
import { requireKid, normMoney, checkKidPin, logKidAction, notifyParent } from './teach-kids-shared';
import { addXp } from './teach-kids-profiles';
import { walletBalance } from './teach-kids-wallet';

// ────────────────────────────────────────────────
// หน้าที่ของลูก: งานบ้าน (ทำงานแลกเงิน) + บิล (ค่าไฟ/น้ำ/ห้อง) + กระเป๋าเงิน
// ────────────────────────────────────────────────

// ── งานบ้าน ──

export interface ChoreInput {
  title: string;
  reward: number; // บาทที่ได้เมื่อทำเสร็จ
  emoji?: string | null;
  repeat?: string; // none | daily — งานรายวันจะรีเซ็ตเป็นค้างใหม่ทุกเช้า
}

/** ผู้ใหญ่เพิ่มงานบ้าน (ทำงาน → ได้เงิน) */
export async function addChore(kidId: string, input: ChoreInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const reward = normMoney(input?.reward);
  if (reward <= 0) throw new Error('reward ต้องมากกว่า 0');
  const repeat = input?.repeat === 'daily' ? 'daily' : 'none';
  const item = await prisma.kidChore.create({
    data: {
      kid_id: kidId,
      title,
      reward,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      repeat,
      status: 'pending',
    },
  });
  return { id: item.id };
}

export async function deleteChore(kidId: string, choreId: string): Promise<void> {
  await prisma.kidChore.delete({ where: { id: choreId, kid_id: kidId } });
}

/** เด็กกด "ทำเสร็จแล้ว" → ได้เงินเข้าบัญชี (กันทำซ้ำ) — ถ้าเด็กมี PIN ต้องกรอก */
export async function completeChore(kidId: string, choreId: string, pin?: string | null): Promise<{ id: string; reward: number }> {
  await requireKid(kidId);
  await checkKidPin(kidId, pin);
  const chore = await prisma.kidChore.findUnique({ where: { id: choreId } });
  if (!chore || chore.kid_id !== kidId) throw new Error('chore not found');
  if (chore.status === 'done') return { id: chore.id, reward: chore.reward }; // ทำซ้ำ → ไม่ได้เงินซ้ำ
  await prisma.kidChore.update({ where: { id: choreId }, data: { status: 'done', completed_at: new Date() } });
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: chore.reward, note: `ทำงาน: ${chore.title}`, category: 'chore' },
  });
  await logKidAction(kidId, 'chore_complete', `${chore.emoji ? chore.emoji + ' ' : ''}${chore.title} +${chore.reward}฿`, pin ? 'kid' : 'parent');
  await addXp(kidId, chore.reward, 'การทำงานบ้าน');
  // แจ้งผู้ใหญ่ทาง Telegram ทันที (best-effort)
  const balance = await walletBalance(kidId);
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId }, select: { name: true } });
  await notifyParent(`🎉 ${kid?.name ?? 'ลูก'} ทำงานเสร็จ: ${chore.emoji ? chore.emoji + ' ' : ''}${chore.title} +${chore.reward}฿\n💼 เงินในกระเป๋า: ${balance}฿`);
  return { id: chore.id, reward: chore.reward };
}

/** เปิดงานเดิมให้ทำใหม่ได้ (เช่น กวาดบ้านทุกวัน) */
export async function reopenChore(kidId: string, choreId: string): Promise<{ status: string; completed_at: Date | null }> {
  await prisma.kidChore.update({
    where: { id: choreId, kid_id: kidId },
    data: { status: 'pending', completed_at: null },
  });
  return { status: 'pending', completed_at: null };
}

// ────────────────────────────────────────────────
// เก็บถาวรอัตโนมัติ — งาน/บิลที่จบแล้วเกิน 30 วัน (หน้าบ้านไม่รก)
// ────────────────────────────────────────────────

/** ทำเครื่องหมายงานที่เสร็จ / บิลที่จ่ายแล้วเกิน `days` วันเป็น archived (ซ่อนจากหน้าบ้าน) */
export async function archiveOldItems(now: Date = new Date(), days = 30): Promise<{ chores: number; bills: number }> {
  const cutoff = new Date(now.getTime() - days * 86400000);
  const [chores, bills] = await Promise.all([
    prisma.kidChore.updateMany({
      where: { status: 'done', archived_at: null, completed_at: { lt: cutoff } },
      data: { archived_at: now },
    }),
    prisma.kidBill.updateMany({
      where: { status: 'paid', archived_at: null, paid_at: { lt: cutoff } },
      data: { archived_at: now },
    }),
  ]);
  return { chores: chores.count, bills: bills.count };
}

// ────────────────────────────────────────────────
// งานบ้านรายวัน — เช็กลิสต์ที่รีเซ็ตเป็นค้างใหม่เองทุกเช้า
// ────────────────────────────────────────────────

/** รีเซ็ตงานรายวันที่ทำเสร็จก่อนเช้านี้ → กลับเป็นค้าง (ทำได้ใหม่ทุกวัน) */
export async function resetDailyChores(now: Date = new Date()): Promise<{ reset: number }> {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const res = await prisma.kidChore.updateMany({
    where: { repeat: 'daily', status: 'done', completed_at: { lt: todayStart } },
    data: { status: 'pending', completed_at: null },
  });
  return { reset: res.count };
}
