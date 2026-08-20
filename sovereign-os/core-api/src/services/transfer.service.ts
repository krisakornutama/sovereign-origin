// ─────────────────────────────────────────────────────────────
// Transfer Orders — วงจรโอน/รับเงินจริง (Option A: Ledger + ยืนยันการโอน)
//  PENDING (สร้าง + QR PromptPay) → โอนจริงผ่านแอปธนาคาร → VERIFIED (กรอก txid)
//  - VERIFIED = จุดที่จะอัปเดต ledger (PersonalBalanceSheet) อัตโนมัติ
//      OUT  → หักเงินสด (atomic conditional decrement, กัน double-verify)
//      IN   → เครดิตเงินสด (เหมือนขาย/ปันผล cross-link)
//  - ทุกคำสั่งมี ref_code + ฟีด TreasuryEvent ทุกครั้งที่กระทบ ledger
// pure-ish: prisma แบบ mockable (โครงสร้างเดียวกับ treasury.service)
// ─────────────────────────────────────────────────────────────
import { buildPromptPayPayload } from './promptpay';

export type TransferDirection = 'IN' | 'OUT';
export type TransferStatus = 'PENDING' | 'VERIFIED' | 'CANCELLED';

export const TRANSFER_CATEGORIES = ['BILL', 'FOOD', 'UTILITY', 'SALARY', 'INVESTMENT', 'LOAN', 'MEDICAL', 'EDUCATION', 'OTHER'] as const;
export const isTransferCategory = (v: string): v is (typeof TRANSFER_CATEGORIES)[number] =>
  (TRANSFER_CATEGORIES as readonly string[]).includes(v);

export interface TransferPrisma {
  transferOrder: {
    create: (a: any) => Promise<any>;
    findMany: (a: any) => Promise<any[]>;
    findFirst: (a: any) => Promise<any | null>;
    updateMany: (a: any) => Promise<{ count: number }>;
  };
  personalBalanceSheet: {
    findUnique: (a: any) => Promise<any | null>;
    update: (a: any) => Promise<any>;
    updateMany: (a: any) => Promise<{ count: number }>;
    upsert: (a: any) => Promise<any>;
  };
  treasuryEvent: { create: (a: any) => Promise<any> };
}

export interface CreateTransferInput {
  direction: TransferDirection;
  category?: string;
  amountUsd: number;
  amountThb?: number | null;
  payee?: string | null;
  bank?: string | null;
  accountNumber?: string | null;
  note?: string | null;
  usdThbRate?: number; // อัตราแปลงยอดบาท (ถ้าไม่ระบุ amountThb)
  promptpayTarget?: string | null; // เบอร์/เลขบัตร — ถ้าไม่ตั้ง → ไม่มี QR payload
  promptpayName?: string | null;
}

export interface TransferCreateResult {
  ok: boolean;
  reason?: string;
  order?: any;
  qrPayload?: string | null;
}

/** สร้าง ref_code อ่านง่ายแบบ XFR-XXXXXX (ไม่ซ้ำกันจริง — กัน collision ด้วย timestamp) */
export function makeRefCode(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0');
  return `XFR-${t}${r}`;
}

/** ตรวจสอบยอดเงิน — ค่าไม่ใช่ตัวเลข/ติดลบ/เกินจริง → คืน null (caller ส่ง 400) */
export function nonNegativeFinite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

let counter = 0;

/** สร้างคำสั่งโอน — ยังไม่แตะ ledger (PENDING) จนกว่าจะ VERIFIED */
export async function createTransferOrder(prisma: TransferPrisma, userId: string, input: CreateTransferInput): Promise<TransferCreateResult> {
  const amountUsd = nonNegativeFinite(input.amountUsd);
  if (amountUsd === null || amountUsd === 0)
    return { ok: false, reason: 'amountUsd ต้องเป็นตัวเลขมากกว่า 0' };
  if (input.direction !== 'IN' && input.direction !== 'OUT')
    return { ok: false, reason: 'direction ต้องเป็น IN หรือ OUT' };
  const category = String(input.category || 'OTHER').toUpperCase();
  if (!isTransferCategory(category)) return { ok: false, reason: `หมวดต้องเป็น: ${TRANSFER_CATEGORIES.join(', ')}` };

  counter += 1;
  const ref_code = makeRefCode();
  const amountThb = nonNegativeFinite(input.amountThb ?? 0);
  const thbForQr =
    (amountThb !== null && amountThb > 0)
      ? amountThb
      : amountUsd * Math.max(0.01, Number(input.usdThbRate || 35)); // fallback rate — ถ้าไม่ตั้งค่านั่นเอง

  const qrPayload = input.promptpayTarget
    ? buildPromptPayPayload({ target: input.promptpayTarget, amountThb: thbForQr, name: input.promptpayName || undefined })
    : null;

  const order = await prisma.transferOrder.create({
    data: {
      user_id: userId,
      direction: input.direction,
      category,
      amount_usd: amountUsd,
      amount_thb: amountThb !== null && amountThb > 0 ? amountThb : null,
      payee: input.payee || null,
      bank: input.bank || null,
      account_number: input.accountNumber || null,
      note: input.note || null,
      ref_code,
      qr_payload: qrPayload,
      requested_by: userId,
    },
  });
  return { ok: true, order, qrPayload };
}

/** กัน double-verify: อัปเดตเฉพาะ order ที่ยัง PENDING อยู่ */
async function claimPending(prisma: TransferPrisma, orderId: string, userId: string, verifiedBy: string, txid: string): Promise<{ count: number }> {
  return prisma.transferOrder.updateMany({
    where: { id: orderId, user_id: userId, status: 'PENDING' },
    data: { status: 'VERIFIED', txid, verified_by: verifiedBy, verified_at: new Date() },
  });
}

/**
 * ยืนยันการโอนจริง — กระทบ ledger ทันที (atomic)
 * OUT: หักเงินสดด้วย conditional decrement — ถ้ายอดไม่พอหักเท่าที่ยังมี (แบบเดียวกับ "ถอนเงินสด")
 * IN:  เครดิตเข้าบัญชี (เหมือนขายทำกำไร/ปันผล)
 * คืน actualDebitedUsd เพื่อให้ UI แสดงความจริงของการหัก
 */
export async function confirmTransfer(
  prisma: TransferPrisma,
  order: any,
  verifiedBy: string,
  txid: string
): Promise<{
  ok: boolean;
  reason?: string;
  order?: any;
  actualDebitedUsd?: number;
  balance?: { liquid_cash_usd: number };
}> {
  const txidStr = String(txid || '').trim();
  if (txidStr.length < 4) return { ok: false, reason: 'txid ต้องมาจากแอปธนาคาร (อย่างน้อย 4 ตัวอักษร)' };

  const claimed = await claimPending(prisma, order.id, order.user_id, verifiedBy, txidStr);
  if (claimed.count !== 1) {
    const fresh = await prisma.transferOrder.findFirst({ where: { id: order.id, user_id: order.user_id } });
    return { ok: false, reason: fresh?.status === 'VERIFIED' ? 'คำสั่งนี้ถูกยืนยันไปแล้ว' : 'คำสั่งนี้ถูกยกเลิกแล้ว ไม่สามารถยืนยันได้' };
  }

  const amountUsd = Math.max(0, Number(order.amount_usd) || 0);
  let actualDebitedUsd = 0;

  if (order.direction === 'OUT') {
    // หักเงินสดแบบ atomic — กัน 2 ยืนยันพร้อมกันหักซ้ำ (แบบเดียวกับ withdrawal)
    const step = await prisma.personalBalanceSheet.updateMany({
      where: { user_id: order.user_id, liquid_cash_usd: { gte: amountUsd } },
      data: { liquid_cash_usd: { decrement: amountUsd } },
    });
    if (step.count === 1) {
      actualDebitedUsd = amountUsd;
    } else {
      const avail = Math.max(0, (await ensureSheet(prisma, order.user_id)).liquid_cash_usd || 0);
      if (avail > 0) {
        const step2 = await prisma.personalBalanceSheet.updateMany({
          where: { user_id: order.user_id, liquid_cash_usd: { gte: avail } },
          data: { liquid_cash_usd: { decrement: avail } },
        });
        if (step2.count === 1) actualDebitedUsd = avail;
      }
    }
    if (actualDebitedUsd > 0) {
      await prisma.treasuryEvent.create({
        data: {
          user_id: order.user_id,
          type: 'TRANSFER_OUT',
          amount_usd: -actualDebitedUsd,
          note: `โอนออก ${order.category} ${order.ref_code}${order.payee ? ' → ' + order.payee : ''} (txid ${txidStr})`,
        },
      });
    } else {
      // เงินสด 0 อยู่แล้ว — บันทึกเหตุการณ์ไว้เป็นหลักฐาน 0 บาท
      await prisma.treasuryEvent.create({
        data: {
          user_id: order.user_id,
          type: 'TRANSFER_OUT',
          amount_usd: 0,
          note: `โอนออก ${order.category} ${order.ref_code} — ไม่มีเงินสดใน ledger ให้หัก (txid ${txidStr})`,
        },
      });
    }
    const balance = await prisma.personalBalanceSheet.findUnique({ where: { user_id: order.user_id } });
    return { ok: true, order: { ...order, status: 'VERIFIED', txid: txidStr }, actualDebitedUsd, balance: balance || { liquid_cash_usd: 0 } };
  }

  // IN — เครดิตเงินสด (read → set แบบเดียวกับ creditLiquidCash)
  const sheet = await ensureSheet(prisma, order.user_id);
  const balance = await prisma.personalBalanceSheet.update({
    where: { user_id: order.user_id },
    data: { liquid_cash_usd: Math.max(0, (sheet.liquid_cash_usd || 0) + amountUsd) },
  });
  await prisma.treasuryEvent.create({
    data: {
      user_id: order.user_id,
      type: 'TRANSFER_IN',
      amount_usd: amountUsd,
      note: `รับเงิน ${order.category} ${order.ref_code}${order.payee ? ' จาก ' + order.payee : ''} (txid ${txidStr})`,
    },
  });
  return { ok: true, order: { ...order, status: 'VERIFIED', txid: txidStr }, actualDebitedUsd: 0, balance };
}

/** ยกเลิกคำสั่ง PENDING — ยังไม่เคยแตะ ledger เลย ปลอดภัยเสมอ */
export async function cancelTransfer(prisma: TransferPrisma, orderId: string, userId: string): Promise<{ ok: boolean; reason?: string; order?: any }> {
  const res = await prisma.transferOrder.updateMany({
    where: { id: orderId, user_id: userId, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelled_at: new Date() },
  });
  if (res.count !== 1) {
    const fresh = await prisma.transferOrder.findFirst({ where: { id: orderId, user_id: userId } });
    if (!fresh) return { ok: false, reason: 'ไม่พบคำสั่งโอน' };
    return { ok: false, reason: fresh.status === 'VERIFIED' ? 'คำสั่งที่ VERIFIED แล้วยกเลิกไม่ได้' : 'คำสั่งนี้ถูกยกเลิกไปแล้ว' };
  }
  return { ok: true, order: { id: orderId, status: 'CANCELLED' } };
}

async function ensureSheet(prisma: TransferPrisma, userId: string) {
  const existing = await prisma.personalBalanceSheet.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  return prisma.personalBalanceSheet.upsert({ where: { user_id: userId }, create: { user_id: userId }, update: {} });
}