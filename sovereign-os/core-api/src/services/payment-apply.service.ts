// ────────────────────────────────────────────────────────────────────────────
// payment-apply.service.ts — เขียนผลของ Stripe ลงฐานข้อมูล
//
// ทำไมต้องมีไฟล์นี้: "ตัดสินใจ" กับ "ลงบัญชี" เป็นคนละเรื่อง
//   · payment-verification.service — pure: ตอบว่า apply ได้ไหม (ไม่แตะ DB)
//   · payment-apply.service (ที่นี่) — เขียนจริง: CAS + แถวเงิน (ต้องรู้ว่าเขียนสำเร็จไหม)
//   · payments.routes — รับ/เซ็น/ตอบ HTTP เท่านั้น
//
// คำสั่งแบบนี้ทำให้ "เขียนเงิน" มีเจ้าของเดียว: ทุกจุดที่แตะ order/payment เพื่อ
// บันทึกการจ่ายของ Stripe อยู่ในไฟล์นี้ ไม่มี CAS ซ่อนอยู่ใน route อีก
//
// กันเงินซ้ำด้วย CAS ไม่ใช่ด้วยการเช็คแถวก่อนเขียน: Stripe ส่ง delivery เดิมซ้ำได้
// และ "เช็คแล้วค่อยเขียน" แข่งกับตัวเองเองได้ CAS แบบ claimPending คือผู้ชนะมี
// คนเดียวโดยโครงสร้างข้อมูล ไม่ต้องเชื่อเวลา
//
// ชนิดของ db คือ PrismaClient ตัวจริง (ไม่ใช่ any) → ชื่อคอลัมน์/ชนิดข้อมูลที่เขียนผิด
// จะเป็น compile error แทนที่จะเป็น runtime error ตอน Stripe ส่งมา
// ────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import {
  STOREFRONT_PAYABLE_STATUSES,
  STRIPE_PAYMENT_METHOD,
  type ApplyDecision,
  type StorefrontApplyDecision,
} from './payment-verification.service';

/** ผลของการเขียน: apply ได้ไหม + สถานะล่าสุดของ order (ไว้ log/ตอบกลับ) */
export interface WriteOutcome {
  applied: boolean;
  /** สถานะจริงของ order หลังพยายามเขียน (null = หาไม่เจอ) */
  status: string | null;
}

/**
 * TransferOrder — คำสั่งโอนที่จ่ายจริงแล้ว: PENDING → VERIFIED
 *
 * ไม่มีแถวเงินแยก (เงินเข้า ledger ผ่าน confirmTransfer ของฝั่งร้าน) — ที่นี่แค่
 * ยืนยันว่า Stripe จ่ายแล้ว ซึ่งเป็นหลักฐานประกอบ txid
 */
export async function applyTransferOrderCompletion(
  db: PrismaClient,
  decision: ApplyDecision,
): Promise<WriteOutcome> {
  const claimed = await db.transferOrder.updateMany({
    where: { ref_code: decision.refCode, status: 'PENDING' },
    data: {
      status: 'VERIFIED',
      txid: decision.sessionId,
      // verified_by เป็นคอลัมน์ @db.Uuid (schema.prisma:375) = uuid ของ "คน" ที่กดยืนยัน
      // (transfer.service เขียน userId ลงตรงนี้) — webhook ไม่ใช่คน จึงเป็น null
      //
      // เดิมเขียนค่า 'stripe-webhook' ซึ่งผ่านทุกเทสต์ที่ใช้ mock แต่พังกับของจริง:
      // Prisma โยน P2023 → express 4 ไม่ส่ง error ออกจาก async handler → request ค้าง
      // → Stripe retry ไม่จบ → คำสั่งโอนไม่เคยเป็น VERIFIED
      // ใครยืนยันจริงแล้วดูจาก verified_at + txid (cs_…) แทน
      verified_by: null,
      verified_at: new Date(),
    },
  });
  if (claimed.count === 1) return { applied: true, status: 'VERIFIED' };

  // ตอนนี้ order อยู่ในสถานะที่ยืนยันแล้ว หรือถูกยกเลิก — ไม่ย้อนสถานะกลับ
  // ครั้งนี้ไม่ได้เขียนอะไร แต่ "เงินจ่ายแล้ว" เป็นความจริงอยู่แล้ว
  // จึงไม่ใช่เคสผิดปกติเท่า mismatch — log ระดับ info พอ
  const fresh = await db.transferOrder.findFirst({ where: { ref_code: decision.refCode } });
  return { applied: false, status: fresh?.status ?? null };
}

/**
 * ออเดอร์หน้าร้าน — จ่ายจริงแล้ว: QUOTE/ORDERED → PAID + บันทึกแถวเงิน
 *
 * ต้องมีแถวใน business_payments เพราะ getPublicOrderByToken คิด "ยอดที่ชำระแล้ว"
 * จากผลรวมของแถวในตารางนี้ ไม่ใช่จาก order.paidAmount ถ้าเขียนแค่ order
 * ลูกค้าที่จ่ายบัตรแล้วจะยังเห็น "ค้างชำระ" เต็มจำนวนพร้อม QR PromptPay ซ้ำ
 * = เงินเข้าแล้วแต่หน้าจอบอกว่ายังไม่จ่าย
 *
 * CAS + แถวเงินต้องเป็นเรื่องเดียวกัน (transaction) ไม่งั้นอาจมีออเดอร์ PAID
 * ที่ไม่มีเงิน — ซึ่งแย่กว่าการไม่เขียนเลย
 */
export async function applyStorefrontOrderCompletion(
  db: PrismaClient,
  decision: StorefrontApplyDecision,
): Promise<WriteOutcome> {
  // กัน float เป็น 9899.999999999998 (expectedSatang/100 อาจไม่ลงตัว)
  const paidThb = Number((decision.expectedSatang / 100).toFixed(2));

  const claimed = await db.$transaction(async (tx) => {
    const res = await tx.businessOrder.updateMany({
      where: { publicToken: decision.publicToken, status: { in: [...STOREFRONT_PAYABLE_STATUSES] } },
      data: { status: 'PAID', paidAmount: paidThb },
    });
    // ไม่ได้เป็นเจ้าของ (ส่งซ้ำ/ถูกยกเลิก) = ห้ามแตะเงิน
    if (res.count !== 1) return res;
    await tx.businessPayment.create({
      data: {
        orderId: decision.orderId,
        amount: paidThb,
        method: STRIPE_PAYMENT_METHOD,
        reference: decision.sessionId, // cs_… = เลขอ้างอิงฝั่ง Stripe ย้อนหาได้
      },
    });
    return res;
  });

  if (claimed.count === 1) return { applied: true, status: 'PAID' };

  const fresh = await db.businessOrder.findFirst({ where: { publicToken: decision.publicToken } });
  return { applied: false, status: fresh?.status ?? null };
}