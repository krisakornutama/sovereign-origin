// src/services/teach-kids-shared.ts
// ส่วนกลางของ teach-kids: notify ผู้ใหญ่ + audit log + ตรวจ PIN + guards (requireKid/normMoney)

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { sendTelegram } from '../modules/telegram/telegram.routes';

// ── แจ้งเตือนผู้ใหญ่ทาง Telegram (fire-and-forget — ไม่ทำให้รายการหลักล้มเหลว) ──
type NotifyFn = (message: string) => Promise<void>;
let notifySender: NotifyFn = async (message: string) => {
  try {
    await sendTelegram(message);
  } catch (err) {
    console.error('notify parent error:', err instanceof Error ? err.message : err);
  }
};

/** เปลี่ยนตัวส่งการแจ้งเตือน (ใช้ในเทสต์) */
export function setNotifySender(fn: NotifyFn): void {
  notifySender = fn;
}

export async function notifyParent(message: string): Promise<void> {
  try {
    await notifySender(message);
  } catch (err) {
    console.error('notify parent error:', err instanceof Error ? err.message : err);
  }
}

export { prisma };

/** ตรวจว่า kid มีอยู่จริง → คืน error ถ้าไม่มี */
export async function requireKid(kidId: string): Promise<void> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
}

export function normMoney(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) throw new Error('amount ต้องเป็นตัวเลข');
  return n;
}

// ── Audit log ของลูก — ประวัติการแลกคูปอง / PIN / ทำงาน / จ่ายบิล ──

/** บันทึกประวัติการใช้งานของลูก (best-effort — ไม่ทำให้รายการหลักล้มเหลว) */
export async function logKidAction(kidId: string, action: string, detail: string, actor: 'parent' | 'kid'): Promise<void> {
  try {
    await prisma.kidAuditLog.create({
      data: {
        kid_id: kidId,
        action,
        detail: String(detail ?? '').trim().slice(0, 300),
        actor,
      },
    });
  } catch (err) {
    console.error('Kid audit log error:', err instanceof Error ? err.message : err);
  }
}

/** ประวัติล่าสุดของเด็ก (สำหรับผู้ใหญ่ตรวจย้อนหลัง) */
export async function kidAuditLog(kidId: string, limit = 40): Promise<Array<{ id: string; action: string; detail: string | null; actor: string; created_at: Date }>> {
  return prisma.kidAuditLog.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}

/** ตรวจ PIN ของลูก (ถ้ามี) — ใช้ก่อนทำงานเสร็จ / แลกคูปอง */
export async function checkKidPin(kidId: string, pin?: string | null): Promise<void> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  if (kid.pin_hash) {
    let ok = false;
    if (typeof pin === 'string' && pin.length > 0) {
      try {
        ok = await bcrypt.compare(pin, kid.pin_hash);
      } catch {
        ok = false; // hash เสีย → ถือว่าผิด
      }
    }
    if (!ok) throw new Error('PIN ไม่ถูกต้อง — กรอกรหัสลับของลูกอีกครั้ง');
  }
}
