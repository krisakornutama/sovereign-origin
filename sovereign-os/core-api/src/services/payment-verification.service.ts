// ────────────────────────────────────────────────────────────────────────────
// payment-verification.service.ts — ตัดสินใจว่า delivery ของ Stripe "จะถูก apply ไหม"
//
// ทำไมต้องเป็นโมดูลตัวเดียว: คำถามนี้เคยอยู่กลาง route handler ปนกับ HTTP
// (สถานะ/header/body) ทำให้ตรรกะที่สำคัญที่สุดของระบบเงินทดสอบยาก และแก้แล้ว
// ไม่รู้ว่ากระทบอะไร — ที่นี่แยกออกมาเป็น pure function ชั้นเดียว:
//
//   · ไม่แตะ HTTP  · ไม่แตะ DB  · ไม่อ่าน config/env  · ไม่ยิงเน็ต
//   · รับ object ธรรมดา → คืนคำตัดสิน
//
// เจ้าของของศัพท์เหล่านี้อยู่ที่นี่ที่เดียว: NotAppliedReason (reason code ที่
// route ส่งกลับและ log) และลำดับการตรวจ (branch แรกที่ match คือคำตอบ)
//
// สิ่งที่ "ไม่" อยู่ที่นี่โดยเจตนา: การเขียน DB (CAS) ต้องรู้ว่าเขียนสำเร็จไหม
// จึงอยู่ที่ route · และรูปร่าง response เป็นเรื่องการนำเสนอ จึงอยู่ที่ route
// ────────────────────────────────────────────────────────────────────────────

import { normalizeRefCode, toThbMinorUnit, THB_CURRENCY_CODE } from './stripe-checkout';

/** รหัสเหตุผลที่ delivery นั้น "ไม่ถูก apply" — คำตอบของ API + ข้อความใน log */
export type NotAppliedReason =
  | 'unsupported_event_type'
  | 'missing_client_reference_id'
  | 'order_not_found'
  | 'currency_mismatch'
  | 'order_amount_unusable'
  | 'amount_mismatch'
  /** order ไม่ได้อยู่ PENDING อีกแล้ว — คำตัดสินหลัง CAS ไม่สำเร็จ */
  | 'order_not_pending';

/**
 * reason ที่ route ผลิตเองหลัง CAS ไม่สำเร็จ (order ไม่ PENDING)
 *
 * ให้มาเป็น "ค่าคงที่ที่มีชนิด" แทน string ตรง ๆ เพื่อให้:
 *   · จุดเขียนใน route ถูกบังคับด้วยชนิด NotAppliedReason เสมอ
 *   · สะกดผิดแล้วคอมไพล์ไม่ผ่าน ไม่ใช่คอมไพล์ผ่านแล้วพังตอนรัน
 * ถ้าวันหนึ่งต้องการเพิ่ม reason ที่ route ผลิตเอง ให้เพิ่มใน union ข้างบนก่อนเสมอ
 */
export const REASON_ORDER_NOT_PENDING: NotAppliedReason = 'order_not_pending';

export interface NotAppliedDecision {
  kind: 'not_applied';
  reason: NotAppliedReason;
  /** ข้อความสำหรับคนอ่าน — ต้องบอกได้ว่าอะไรผิดและตัวเลขเท่าไร */
  message: string;
  /** ข้อมูลประกอบการแก้ไข (refCode/ตัวเลข) — เข้าไปอยู่ใน log ด้วย */
  detail?: Record<string, unknown>;
}

export interface ApplyDecision {
  kind: 'apply';
  refCode: string;
  sessionId: string;
  /** ยอดที่ order คาดไว้ (สตางค์) — ให้ route ใช้ตรวจซ้ำตอนเขียนได้ */
  expectedSatang: number;
}

export type CompletionDecision = ApplyDecision | NotAppliedDecision;

/** event type ที่เราดูแล — ที่เหลือคือ "ไม่ใช่ธุระของเรา" */
const HANDLED_EVENT_TYPE = 'checkout.session.completed';

/**
 * ตัดสินใจว่าจะ apply delivery นี้ไหม — pure: ไม่แตะ HTTP/DB/config
 *
 * ลำดับการตรวจสำคัญ: branch แรกที่ match คือคำตอบ การสลับลำดับเปลี่ยน
 * reason ที่ลูกค้าเห็นและที่ log ได้ → ถ้าจะเพิ่มเงื่อนไข ให้คิดว่าทำไม
 * ต้องมาก่อน/หลังของเดิม
 */
export function decideCompletion(
  event: any,
  order: { ref_code?: unknown; status?: unknown; amount_thb?: unknown } | null,
): CompletionDecision {
  // 1) ไม่ใช่ event ที่เราดูแล — ไม่มีทางกลายเป็นจริงในการส่งครั้งหนัง
  if (event?.type !== HANDLED_EVENT_TYPE) {
    return {
      kind: 'not_applied',
      reason: 'unsupported_event_type',
      message: `ไม่ใช่ event ที่เราดูแล: ${event?.type ?? 'ไม่ระบุ'}`,
      detail: { type: event?.type ?? null },
    };
  }

  const session = event?.data?.object ?? {};

  // 2) ไม่มี key จับคู่ order — เดาไม่ได้ และห้ามสร้าง order ใหม่
  const refCode = normalizeRefCode(session.client_reference_id);
  if (!refCode) {
    return {
      kind: 'not_applied',
      reason: 'missing_client_reference_id',
      message: 'ไม่มี client_reference_id — จับคู่ order ไม่ได้ (ไม่เดา ไม่สร้าง order ใหม่)',
      detail: { sessionId: String(session.id ?? '') || null },
    };
  }

  // 3) order ต้องมีอยู่ก่อนชำระเงินเสมอ — ไม่มีอยู่ = ไม่มีทางสำเร็จในการส่งครั้งหนัง
  if (!order) {
    return {
      kind: 'not_applied',
      reason: 'order_not_found',
      message: `ไม่พบ order สำหรับ ref_code ${refCode} — ตรวจว่า client_reference_id ถูกต้องไหม`,
      detail: { refCode },
    };
  }

  // 4) สกุลเงินต้องตรงกับที่ระบบเก็บ
  if (String(session.currency) !== THB_CURRENCY_CODE) {
    return {
      kind: 'not_applied',
      reason: 'currency_mismatch',
      message: `สกุลเงินไม่ตรง: order เป็น ${THB_CURRENCY_CODE} แต่ session จ่าย ${session.currency}`,
      detail: { refCode, expectedCurrency: THB_CURRENCY_CODE, receivedCurrency: session.currency ?? null },
    };
  }

  // 5) ตัวเลขที่เชื่อได้คือยอดของ ORDER ไม่ใช่ของ session
  //    (session.amount_total มาจากฝั่ง Stripe และแก้เองได้ถ้าไม่ตรวจลายเซ็น)
  let expectedSatang: number;
  try {
    expectedSatang = toThbMinorUnit(Number(order.amount_thb));
  } catch {
    return {
      kind: 'not_applied',
      reason: 'order_amount_unusable',
      message: `order ${refCode} ไม่มียอดบาทที่ใช้ได้ (${order.amount_thb})`,
      detail: { refCode, amountThb: order.amount_thb ?? null },
    };
  }
  if (Number(session.amount_total) !== expectedSatang) {
    return {
      kind: 'not_applied',
      reason: 'amount_mismatch',
      message:
        `ยอดไม่ตรง: order ${refCode} คาด ${expectedSatang} สตางค์ ` +
        `(THB ${(expectedSatang / 100).toFixed(2)}) แต่จ่ายมา ${session.amount_total}`,
      detail: { refCode, expectedSatang, receivedSatang: session.amount_total ?? null },
    };
  }

  // 6) ผ่านทุกอย่าง → อนุญาตให้เขียน (CAS ที่ route ทำต่อ)
  return { kind: 'apply', refCode, sessionId: String(session.id ?? ''), expectedSatang };
}

// ──────────────────────────────────────────────────────────────────────────────
// ออเดอร์หน้าร้าน (BusinessOrder) — คนละตารางกับ TransferOrder จึงแยกชุดตรรกะ
//
// ทำไมต้องแยก: ของที่ขายหน้าร้าน (ซอฟต์แวร์/แพ็กเกจ) เป็น BusinessOrder ไม่ใช่ TransferOrder
// และยอดที่เชื่อได้อยู่ที่ `total` ไม่ใช่ `amount_thb` — ใช้ decideCompletion เดิม
// ด้วย shape ของ TransferOrder จะอ่านยอดได้ undefined → ปฏิเสธทุกครั้ง
//
// ทำไมถึงไม่แก้ decideCompletion เดิมให้รับได้ทั้งสองแบบ: union ของ order จะทำให้
// จุดที่อ่าน `amount_thb` กลายเป็น `number | undefined` โดยไม่มีใครเห็นตอน compile
// (เหตุผลเดียวกับที่ reason ถูกพิมพ์เป็น NotAppliedReason ไม่ใช่ string)
//
// ──────────────────────────────────────────────────────────────────────────────

/** สถานะ BusinessOrder ที่ยังรอชำระ — เขียนทับได้เฉพาะสถานะเหล่านี้เท่านั้น */
export const STOREFRONT_PAYABLE_STATUSES = ['QUOTE', 'ORDERED'] as const;

export interface StorefrontApplyDecision {
  kind: 'apply';
  /** publicToken ของ order (UUID @unique ทั้งระบบ) — ใช้เป็น where ตอน CAS */
  publicToken: string;
  orderId: string;
  sessionId: string;
  /** ยอดที่ order คาดไว้ (สตางค์) */
  expectedSatang: number;
}

export type StorefrontCompletionDecision = StorefrontApplyDecision | NotAppliedDecision;

/**
 * ตัดสินใจว่า delivery นี้ "จะ mark ออเดอร์หน้าร้านเป็น PAID ไหม" — pure เหมือนตัวบน
 *
 * ลำดับการตรวจเหมือน decideCompletion ทุกข้อ เพราะความหมายเดียวกัน:
 *   เราเชื่อตัวเลขของ ORDER ไม่ใช่ของ session (session.amount_total แก้เองได้
 *   ถ้าไม่เช็คลายเซ็น) และไม่เดา order ที่ไม่มีอยู่จริง
 */
export function decideStorefrontCompletion(
  event: any,
  order: { id?: unknown; publicToken?: unknown; status?: unknown; total?: unknown } | null,
): StorefrontCompletionDecision {
  if (event?.type !== HANDLED_EVENT_TYPE) {
    return {
      kind: 'not_applied',
      reason: 'unsupported_event_type',
      message: `ไม่ใช่ event ที่เราดูแล: ${event?.type ?? 'ไม่ระบุ'}`,
      detail: { type: event?.type ?? null },
    };
  }

  const session = event?.data?.object ?? {};

  const publicToken = normalizeRefCode(session.client_reference_id);
  if (!publicToken) {
    return {
      kind: 'not_applied',
      reason: 'missing_client_reference_id',
      message: 'ไม่มี client_reference_id — จับคู่ออเดอร์ไม่ได้ (ไม่เดา ไม่สร้างออเดอร์ใหม่)',
      detail: { sessionId: String(session.id ?? '') || null },
    };
  }

  if (!order) {
    return {
      kind: 'not_applied',
      reason: 'order_not_found',
      message: `ไม่พบออเดอร์หน้าร้านสำหรับ publicToken ${publicToken} — ตรวจว่า client_reference_id ถูกต้องไหม`,
      detail: { publicToken },
    };
  }

  if (String(session.currency) !== THB_CURRENCY_CODE) {
    return {
      kind: 'not_applied',
      reason: 'currency_mismatch',
      message: `สกุลเงินไม่ตรง: ออเดอร์เป็น ${THB_CURRENCY_CODE} แต่ session จ่าย ${session.currency}`,
      detail: { publicToken, expectedCurrency: THB_CURRENCY_CODE, receivedCurrency: session.currency ?? null },
    };
  }

  let expectedSatang: number;
  try {
    expectedSatang = toThbMinorUnit(Number(order.total));
  } catch {
    return {
      kind: 'not_applied',
      reason: 'order_amount_unusable',
      message: `ออเดอร์ ${publicToken} ไม่มียอดรวมที่ใช้ได้ (${order.total})`,
      detail: { publicToken, total: order.total ?? null },
    };
  }

  if (Number(session.amount_total) !== expectedSatang) {
    return {
      kind: 'not_applied',
      reason: 'amount_mismatch',
      message:
        `ยอดไม่ตรง: ออเดอร์ ${publicToken} คาด ${expectedSatang} สตางค์ ` +
        `(THB ${(expectedSatang / 100).toFixed(2)}) แต่จ่ายมา ${session.amount_total}`,
      detail: { publicToken, expectedSatang, receivedSatang: session.amount_total ?? null },
    };
  }

  return {
    kind: 'apply',
    publicToken,
    orderId: String(order.id ?? ''),
    sessionId: String(session.id ?? ''),
    expectedSatang,
  };
}