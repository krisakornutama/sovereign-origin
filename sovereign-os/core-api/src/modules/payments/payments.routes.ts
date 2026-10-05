// src/modules/payments/payments.routes.ts
// Payments — จุดเข้า Checkout Session (THB)
//
// ขอบเขตของ pass นี้: สร้าง session แล้วส่ง id + URL กลับให้ลูกค้าไปจ่ายต่อ
// ยังไม่มี webhook receiver · ไม่แตะ schema · ไม่สร้าง Price/Product จริง
//
// ── ทำไมต้องมี factory ──────────────────────────────────────────────────────
// ขั้นตอนนี้ใช้ "ของปลอม" เสมอ (createFakeStripeTransport) เพราะบัญชีที่มี key
// เป็น live mode และสิทธิ์การเขียนยังไม่ได้ยืนยัน — ถ้ายิงจริงโดยไม่ตั้งใจ
// เงินจริงจะหายทันที ตัวจริงจึงยอมทำงานก็ต่อเมื่อเปิด STRIPE_LIVE_ENABLED=true
// เท่านั้น (ดู createLiveStripeTransport) และค่า default ของมันคือ false
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import {
  buildCheckoutSessionParams,
  createFakeStripeTransport,
  createLiveStripeTransport,
  normalizeRefCode,
  type StripeCheckoutTransport,
} from '../../services/stripe-checkout';
import { verifyStripeSignature } from '../../services/stripe-webhook.service';
import {
  decideCompletion,
  decideStorefrontCompletion,
  REASON_ORDER_NOT_PENDING,
  type NotAppliedReason,
} from '../../services/payment-verification.service';
import {
  applyStorefrontOrderCompletion,
  applyTransferOrderCompletion,
} from '../../services/payment-apply.service';
import {
  buildRejectedDeliveryEvidence,
  safeRecordRejectedDelivery,
  type RejectedDeliveryEvidence,
} from '../../services/payment-rejected-deliveries.service';
import type { PrismaClient } from '@prisma/client';

/**
 * ผู้เขียนหลักฐานของ delivery ที่ถูกปฏิเสธถาวร
 *
 * เป็น dependency แยกจาก prisma โดยเด็ดขาด เพราะหลักฐานคือ "ร่องรอยที่คนตามได้"
 * ไม่ใช่ส่วนหนึ่งของการจ่ายเงิน: เขียนคนละที่ (ไฟล์ ไม่ใช่ตารางเงิน) และล้มได้
 * โดยที่ห้ามลากคำตอบของ webhook ไปด้วย (ดู recordEvidence ใน notApplied)
 *
 * ไม่ใส่ = ใช้ของจริง (เขียน JSONL ลง data/) · ใส่ = เทสต์แทน
 */
export type EvidenceWriter = (evidence: RejectedDeliveryEvidence) => Promise<unknown>;

export interface PaymentsRouterDeps {
  transport: StripeCheckoutTransport;
  /** ใช้ตอน webhook เท่านั้น (ตอน checkout ไม่แตะ DB) — ใส่ตอนเทสต์ได้ */
  prisma?: PrismaClient;
  /** signing secret ของ webhook endpoint (whsec_…) · คนละตัวกับ STRIPE_SECRET_KEY */
  webhookSecret?: string;
  /**
   * ผู้เขียนหลักฐานเงินที่เข้ามาแต่ถูกปฏิเสธถาวร — ค่า default คือของจริง (ไฟล์ JSONL)
   *
   * แยกจาก apply path โดยตั้งใจ: หลักฐานล้มต้อง *ไม่* ทำให้ webhook ล้ม เพราะ
   * เงินจริงเข้ามาแล้วและเราจะตอบ 2xx อยู่ดี — ถ้าหลักฐานล้มไปทำให้ไม่ตอบ
   * เงินก็หายเงียบกลางคัน ซึ่งแย่กว่าไม่มีหลักฐานเสียอีก
   */
  evidenceWriter?: EvidenceWriter;
}

export interface PaymentsRouterDefault {
  transport: StripeCheckoutTransport;
  mode: 'mock' | 'live';
}

/**
 * เลือก transport ตาม config — ค่า default คือของปลอม (ไม่ออกเน็ต)
 * โยกไปตัวจริงได้ก็ต่อเมื่อเจ้าของตั้ง STRIPE_LIVE_ENABLED=true อย่างชัดเจน
 *
 * เป็นของไฟล์นี้เพราะเป็น "การเดินสายให้" ระหว่าง config กับ transport
 * ซึ่งเป็นหน้าที่ของชั้นที่ mount route (services ต้องไม่รู้จัก env/config)
 */
function resolvePaymentsTransport(): PaymentsRouterDefault {
  if (config.stripe.liveEnabled) {
    return {
      transport: createLiveStripeTransport({ enabled: true, secretKey: config.stripe.secretKey }),
      mode: 'live',
    };
  }
  return { transport: createFakeStripeTransport(), mode: 'mock' };
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): Router {
  const router = Router();

  // POST /api/payments/checkout-session
  // body: { amountBaht, productName, productDescription?, refCode, quantity?, successUrl, cancelUrl? }
  //   → 201 { success, sessionId, url, refCode, mode }
  router.post('/checkout-session', authenticate, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      // refCode = รหัสอ้างอิงของ order ที่มีอยู่แล้ว (ดูหมายเหตุด้านล่างว่ารับได้อะไรบ้าง)
      // ใช้เป็น client_reference_id ตามที่ Stripe ระบุไว้ตรง ๆ ว่า
      // "a cart ID, or similar, and can be used to reconcile the session
      //  with your internal systems" — webhook จะจับคู่ด้วยค่านี้
      //
      // รับได้สองแบบ (webhook เป็นคนตัดสินว่าจะจับคู่แบบไหน):
      //   · TransferOrder.ref_code  — คำสั่งโอน/รับเงินในส่วนกระเป๋าเงิน
      //   · BusinessOrder.publicToken — ออเดอร์หน้าร้าน (ของที่ขายหน้าบ้าน)
      // route นี้ไม่แตะ DB เลย (ไม่เดาว่ามี order จริง) — เป็นหน้าที่ของ webhook ตอนจ่ายจริง
      //
      // ทำไมไม่ใช้ orderNo: มันไม่ unique ข้ามร้าน (B20261004-0001 เกิดซ้ำได้ทุกร้าน)
      // ใช้ publicToken (UUID @unique) จึงชี้ของชุดเดียวทั้งระบบ
      //
      // กติกา (ว่างไม่ได้ / ยาวเกิน 200) เป็นของ stripe-checkout ไม่ใช่ของ route
      // route ไม่ตรวจซ้ำ ไม่เขียนข้อความของตัวเอง — ปล่อยให้ builder ตัดสิน
      // แล้ว catch ด้านล่างแปลงเป็น 400 พร้อมข้อความของเจ้าของกติกา
      const refCode = normalizeRefCode(body.refCode);

      // ส่งต่อให้ buildCheckoutSessionParams ตรวจที่เหลือ (refCode/ยอด/สินค้า/successUrl/จำนวน)
      const params = buildCheckoutSessionParams({
        amountBaht: body.amountBaht as number,
        productName: String(body.productName ?? ''),
        productDescription:
          body.productDescription === undefined ? undefined : String(body.productDescription),
        clientReferenceId: refCode,
        quantity: body.quantity === undefined ? undefined : (body.quantity as number),
        successUrl: String(body.successUrl ?? ''),
        cancelUrl: body.cancelUrl === undefined ? undefined : String(body.cancelUrl),
      });

      const session = await deps.transport.createCheckoutSession(params);

      return res.status(201).json({
        success: true,
        sessionId: session.id,
        url: session.url,
        refCode,
        mode: session.livemode ? 'live' : 'mock',
      });
    } catch (err: any) {
      return res.status(400).json({ error: String(err?.message || 'สร้าง Checkout Session ไม่สำเร็จ') });
    }
  });

  // ── Webhook ────────────────────────────────────────────────────────────
  // POST /api/payments/webhook — Stripe ส่งมาเอง ไม่มี bearer token
  // การยืนยันตัวตนทำหน้าที่แทน authenticate: ตรวจลายเซ็นจาก signing secret
  // ไม่งั้นใครก็ยิงมาบอกว่า "จ่ายแล้ว" ได้
  //
  // body ต้องเป็น BYTE ต้นฉบับ (server.ts mount express.raw ไว้ก่อน express.json
  // สำหรับ path นี้) เพราะลายเซ็นคำนวณจาก byte จริง
  router.post('/webhook', async (req, res) => {
    // ── กันไม่ให้หลุดออกจาก handler (Express 4 ไม่ส่ง error ออกจาก async handler) ──
    // ถ้า await ข้างในโยน (เช่น Prisma P2023 เมื่อ refCode ไม่ใช่ UUID ตอนหา
    // BusinessOrder) จะไม่มี response ออกไปเลย ⇒ Stripe timeout แล้ว retry ไม่จบ
    // ทั้งที่เงินเข้าจริงแล้ว = "จ่ายแล้วระบบไม่รู้" รูปแบบที่แย่ที่สุด
    // ทุกเส้นทางหลังผ่านลายเซ็นจึงต้องมี try/catch และตอบ non-2xx เมื่อล้ม
    try {
      // ตัดช่องว่างทิ้งก่อนตรวจ — ถ้าเหลือแต่ช่องว่างถือว่า "ยังไม่ได้ตั้ง"
      // ไม่งั้น secret ที่เป็นช่องว่างจะกลายเป็น secret ที่ใครก็เดาได้ (copy/paste เหลือช่องว่าง)
      const secret = String(deps.webhookSecret ?? config.stripe.webhookSecret ?? '').trim();
      if (!secret) {
        console.error('[payments] webhook: ยังไม่ได้ตั้ง STRIPE_WEBHOOK_SECRET — ปฏิเสธทุก delivery (ไม่แตะ order ใด ๆ)');
        return reject(res, 'webhook signing secret is not configured');
      }

      const raw = rawBodyOf(req);
      const verified = verifyStripeSignature({
        header: req.headers['stripe-signature'] as string | undefined,
        rawBody: raw,
        secret,
      });
      if (!verified.ok) {
        // ตั้งใจคง non-2xx: secret อาจเพิ่งหมุน/ยังไม่ได้ตั้ง → การส่งซ้ำอาจผ่าน
        // ตอบ 2xx ตรงนี้ = บอก Stripe ว่าเลิกส่ง = เงินที่จ่ายจริงหายเงียบ
        console.warn(`[payments] webhook: ลายเซ็นไม่ผ่าน (${verified.reason}) — ปฏิเสธและรอ Stripe ส่งใหม่`);
        return reject(res, `invalid stripe signature: ${verified.reason}`);
      }

      let event: any;
      try {
        event = JSON.parse(raw);
      } catch {
        return reject(res, 'webhook body is not valid JSON', 400);
      }

      // ── ตัดสินใจว่าจะ apply ไหม ──────────────────────────────────────────
      // ตรรกะทั้งหมดอยู่ใน payment-verification.service (pure) — ที่นี่ทำแค่
      // เตรียมข้อมูลให้มัน: หา order จาก refCode ที่ตัดสินใจบอกกลับมา
      const refCode = normalizeRefCode(event?.data?.object?.client_reference_id);
      const db = deps.prisma ?? prisma;
      const order = refCode ? await db.transferOrder.findFirst({ where: { ref_code: refCode } }) : null;

      // publicToken เป็นคอลัมน์ @db.Uuid ⇒ ค่าที่ไม่ใช่ UUID ทำให้ Prisma ตอบ
      // P2023 ก่อนได้คำตอบเสมอ = จับคู่ไม่ได้ถาวร ไม่ใช่แข่งขันเวลา
      // ถ้าไม่กรองตรงนี้ จะยิง DB ให้ระเบิดแล้วตอบ 503 ไปเรื่อย ๆ จน Stripe
      // ปิด endpoint ทั้งทั้งที่ไม่มีทางสำเร็จ
      const isUuid = refCode ? UUID_SHAPE.test(refCode) : false;
      if (!order && refCode && !isUuid) return invalidRefCode(res, refCode);

      // ออเดอร์หน้าร้าน — จับคู่ด้วย publicToken เมื่อไม่ใช่คำสั่งโอน
      // (ลอง ref_code ก่อนเสมอ เพื่อให้เส้นทางเดิมที่ทำงานอยู่แล้วไม่เปลี่ยนพฤติกรรม)
      const shopOrder = !order && refCode
        ? await db.businessOrder.findFirst({ where: { publicToken: refCode } })
        : null;
      if (shopOrder) return respondStorefrontOrder(res, db, event, shopOrder, deps.evidenceWriter);

      const decision = decideCompletion(event, order);
      if (decision.kind === 'not_applied') {
        return notApplied(
          res,
          decision.reason,
          decision.message,
          decision.detail,
          deps.evidenceWriter,
          event,
        );
      }

      const outcome = await applyTransferOrderCompletion(db, decision);
      if (!outcome.applied) {
        console.warn(
          `[payments] webhook: ส่งซ้ำ order ${decision.refCode} (สถานะ ${outcome.status ?? 'ไม่รู้'}) — ไม่เขียนซ้ำ`,
        );
        return alreadyApplied(res, decision.refCode, outcome.status);
      }

      return applied(res, {
        refCode: decision.refCode,
        sessionId: decision.sessionId,
        status: 'VERIFIED',
      });
    } catch (err: any) {
      console.error(`[payments] webhook: ค้นหาออเดอร์/บันทึกไม่สำเร็จ — ${err?.message ?? err}`);
      return lookupFailed(res, err);
    }
  });

  return router;
}

/** byte ต้นฉบับของ body — ต้องเซ็นบน byte จริง ห้าม stringify ใหม่ */
/**
 * รูป UUID มาตรฐาน (ไม่รับ urn:uuid: prefix) — ใช้ตรวจก่อนแตะคอลัมน์ @db.Uuid
 * เพราะค่าผิดรูปแบบไม่ใช่ข้อมูลชั่วคราว แต่เป็นความผิดพลาดถาวรที่แก้เองไม่ได้
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ตอบกรณี refCode จับคู่ไม่ได้ถาวร — 422 + retryable:false
 *
 * แยกจาก "UUID ถูกรูปแต่ยังไม่มีออเดอร์" (order_not_found) โดยเด็ดขาด
 * เพราะอันหลังอาจเป็นแข่งขันเวลา (webhook มาก่อนออเดอร์ถูกเขียน) ส่วนอันนี้
 * คือค่าที่ไม่มีวันจับคู่ได้ ไม่ว่ารอนานเท่าไร — Stripe จะ retry ทุก non-2xx
 * (เอกสารของ Stripe ไม่มีสถานะที่ "หยุด retry เด็ดขาด") เราจึงตอบ 422 พร้อม
 * retryable:false + permanent:true เพื่อให้ผู้ดูแลอ่านจาก log ได้ทันที
 * ว่าเป็น "จับคู่ไม่ได้ถาวร" ไม่ใช่ระบบล่มชั่วคราว
 */
function invalidRefCode(res: any, refCode: string) {
  console.warn(
    `[payments] webhook: client_reference_id "${refCode}" ไม่ใช่รูปแบบ UUID — `
    + 'จับคู่ออเดอร์หน้าร้านไม่ได้ถาวร (publicToken เป็น @db.Uuid) · '
    + 'ไม่ใช่แข่งขันเวลา retry ซ้ำก็ไม่มีทางผ่าน',
  );
  return res.status(422).json({
    success: false,
    applied: false,
    rejected: true,
    retryable: false,
    permanent: true,
    reason: 'invalid_refcode_format',
    error: `client_reference_id "${refCode}" ไม่ใช่รูปแบบ UUID — จับคู่ออเดอร์ไม่ได้ (ถาวร ไม่ใช่ชั่วคราว)`,
    refCode,
  });
}

/**
 * ตอบเมื่อ handler ล้มโดยไม่คาดคิด (เช่น Prisma P2023 / DB ตัดการเชื่อมต่อ)
 *
 * 503 โดยเจตนา: non-2xx = Stripe ส่งซ้ำได้ ซึ่งถูกต้อง เพราะเงินอาจเข้าจริงแล้ว
 * แต่เรายังบันทึกไม่ได้ — ถ้าตอบ 200 จะเป็นการบอก Stripe ว่าสำเร็จ
 * ทั้งที่ออเดอร์ยังค้าง = เงินหายเงียบโดยไม่มีใครรู้
 */
function lookupFailed(res: any, err: any) {
  return res.status(503).json({
    success: false,
    applied: false,
    rejected: true,
    retryable: true,
    reason: 'order_lookup_failed',
    error: `ค้นหาออเดอร์ไม่สำเร็จ (order lookup failed): ${String(err?.message ?? err)}`,
  });
}

/**
 * ตอบออเดอร์หน้าร้าน — route นี้แค่แปลงคำตัดสินของ service เป็น HTTP
 * (การเขียน DB อยู่ที่ payment-apply.service ตามหน้าที่ของมัน)
 *
 * เหตุผลที่แยกจากของ TransferOrder: ตารางคนละตาราง, คอลัมน์คนละชื่อ (publicToken/total
 * ไม่ใช่ ref_code/amount_thb) และสถานะปลายทางต่างกัน (PAID ไม่ใช่ VERIFIED)
 * การยุบรวมเป็นฟังก์ชันเดียวจะต้องมี if/else ซ้อนทั้งสองทางในทุกจุด
 */
async function respondStorefrontOrder(
  res: any,
  db: PrismaClient,
  event: any,
  shopOrder: any,
  evidenceWriter?: EvidenceWriter,
) {
  const decision = decideStorefrontCompletion(event, shopOrder);
  if (decision.kind === 'not_applied') {
    return notApplied(res, decision.reason, decision.message, decision.detail, evidenceWriter, event);
  }

  const outcome = await applyStorefrontOrderCompletion(db, decision);
  if (!outcome.applied) {
    console.warn(
      `[payments] webhook: ส่งซ้ำออเดอร์หน้าร้าน ${decision.publicToken} ` +
      `(สถานะ ${outcome.status ?? 'ไม่รู้'}) — ไม่เขียนซ้ำ`,
    );
    return alreadyApplied(res, decision.publicToken, outcome.status);
  }

  return applied(res, {
    refCode: decision.publicToken,
    sessionId: decision.sessionId,
    status: 'PAID',
  });
}

/**
 * เหตุผลที่ "ยังมีโอกาสสำเร็จถ้าลองอีกครั้ง" ⇒ ต้องตอบ non-2xx ให้ Stripe ยิงซ้ำ
 *
 * order_not_found แยกจากที่เหลือโดยเด็ดขาด เพราะ UUID ที่ถูกรูปแต่ยังไม่มี
 * แถวในฐาน = webhook อาจมาก่อนแถว order ถูกเขียน (แข่งขันเวลา) ซึ่งเกิดได้จริง
 * ถ้าตอบ 200 Stripe จะถือว่าสำเร็จแล้วและไม่ยิงซ้ำ ⇒ เงินจริงที่เข้ามาไม่มี
 * ที่เก็บ (ไม่มีแถว business_payments) และระบบยังไม่มีตัวไล่เช็ค Stripe มากู้
 *
 * เหตุผลอื่น (สกุลเงินไม่ตรง ยอดไม่ตรง ไม่ใช่ event ที่เราดูแล ฯลฯ) retry ซ้ำก็
 * ไม่มีทางสำเร็จ จึงคง 2xx + log เหมือนเดิม ไม่ให้ Stripe retry เปล่า ๆ
 */
const RETRYABLE_REASONS = new Set<NotAppliedReason>(['order_not_found']);

/** ตอบ 2xx: apply แล้ว (ทั้งสองทางใช้รูปเดียวกัน เพื่อไม่ให้สัญญาของ client แตกทาง) */
function applied(res: any, ok: { refCode: string; sessionId: string; status: string }) {
  return res.status(200).json({
    success: true,
    applied: true,
    alreadyApplied: false,
    refCode: ok.refCode,
    sessionId: ok.sessionId,
    status: ok.status,
  });
}

/** ตอบ 2xx: ส่งซ้ำ/มีเจ้าของเป็นคนอื่นแล้ว → ไม่ย้อนสถานะ ไม่เขียนเงินซ้ำ */
function alreadyApplied(res: any, key: string, status: string | null) {
  return res.status(200).json({
    success: true,
    applied: false,
    alreadyApplied: true,
    reason: REASON_ORDER_NOT_PENDING,
    refCode: key,
    status,
  });
}

function rawBodyOf(req: any): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body ?? {});
}

// ── สัญญาการตอบกลับของ webhook ─────────────────────────────────────────────
// หัวใจคือคำถามข้อเดียว: "ถ้า Stripe ส่งชุดเดิมมาอีก คำตอบจะเปลี่ยนไหม?"
//
//   notApplied → เปลี่ยนไม่ได้ (ยอดไม่ตรงจะไม่ตรงในการส่งครั้งหนังด้วย)
//                 → 2xx เพื่อหยุด retry แต่บอกว่า "ไม่ได้จ่าย" ให้ชัด + log เสียงดัง
//   reject     → เปลี่ยนได้ (secret หมุน/ยังไม่ได้ตั้ง/เซ็นผิดชั่วคราว)
//                 → non-2xx ให้ Stripe ส่งต่อจนกว่าจะผ่าน
//   applied    → เขียน order เป็น VERIFIED แล้ว
//
// ทำไม reject ต้องไม่ตอบ 2xx: ถ้าตอบ 2xx เราจะสั่ง Stripe ว่า "ไม่ต้องส่งอีก"
// แล้วเงินที่ลูกค้าจ่ายจริงจะหายไปเงียบ ๆ — order ไม่มีวันเป็น VERIFIED
// นี่แย่กว่า retry ดัง ๆ มาก เพราะเงินหายโดยไม่มีใครรู้

/**
 * ตอบ 2xx + บอกตรง ๆ ว่า "ไม่ได้จ่าย" — สำหรับ delivery ที่ไม่มีทางสำเร็จในการส่งครั้งหนัง
 *
 * reason พิมพ์เป็น NotAppliedReason (ไม่ใช่ string) โดยเจตนา
 * คือจุดที่ทำให้ union ใน payment-verification.service "มีผลจริง":
 * ถ้าจุดเขียนนี้เป็น string ไป สะกดผิดแล้วคอมไพล์ผ่าน
 * และ client ที่อ่าน reason จะพังโดยไม่มีใครเห็นตอน build
 *
 * async เพราะต้อง "บันทึกหลักฐานก่อน" แล้วค่อยตอบ Stripe: ถ้าตอบ 2xx แล้วค่อย
 * เขียนทีหลัง แล้ว process ตายกลางทาง หลักฐานจะหายถาวรพร้อมกับที่ Stripe
 * เลิกส่ง event — ไม่มีใครรู้ว่าเงินเข้ามาแล้ว
 */
async function notApplied(
  res: any,
  reason: NotAppliedReason,
  message: string,
  extra: Record<string, unknown> = {},
  evidenceWriter: EvidenceWriter = safeRecordRejectedDelivery,
  event?: any,
) {
  // log เสียงดัง: การตอบ 2xx ทำให้ event นี้ไม่โผล่ในหน้า Stripe อีก
  // ถ้าไม่ log เงินค้างจะเงียบไปตลอดจนกว่าจะมีคนไปเจอเอง
  // ต้อง stringify เอง — ถ้าส่ง object เข้าไป console จะกลายเป็น [object Object]
  // ทำให้ ref_code กับตัวเลขที่ต้องไปแก้หายไปทั้งหมด
  const detail = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  const retryable = RETRYABLE_REASONS.has(reason);
  const label = retryable ? 'รอออเดอร์ปรากฏ — Stripe จะยิงซ้ำ' : 'ไม่ได้ apply';
  console.error(`[payments] webhook ${label} (${reason}) — ${message}${detail}`);

  // ── หลักฐานของเงินที่เข้ามาแต่ถูกปฏิเสธถาวร ───────────────────────────────
  // ทำ *ก่อน* ตอบ เพราะการตอบ 2xx คือการบอก Stripe "เลิกส่ง event นี้ถาวร"
  // ถ้าหลักฐานเขียนไม่สำเร็จเราก็ยังตอบเหมือนเดิม (retry ช่วยไม่ได้อยู่แล้ว
  // การเปลี่ยนเป็น non-2xx จะทำให้หน้าเว็บไม่ตอบ = เงินหายเงียบกลางคัน ซึ่งแย่กว่า)
  // → wrap ไว้ใน try/catch ที่กลืน ไม่ให้หลักฐานเป็นเหตุให้ webhook ล้ม
  await recordEvidence(evidenceWriter, {
    event,
    reason,
    message,
    detail: extra,
  });

  // non-2xx = Stripe ส่งซ้ำ (เอกสาร Stripe: ทุก non-2xx ถูก retry ไม่มีสถานะ
  // ที่ "หยุดเด็ดขาด") · 2xx = เขาจะเลิกส่งและ event นี้หายจากหน้าเว็บ
  return res.status(retryable ? 409 : 200).json({
    success: false,
    applied: false,
    ignored: !retryable,
    retryable,
    reason,
    error: retryable
      ? `${message} — กำลังรอให้ออเดอร์ปรากฏ (Stripe จะยิงซ้ำอัตโนมัติ)`
      : message,
    ...extra,
  });
}

/**
 * บันทึกหลักฐานเงินที่เข้ามาแต่ระบบปฏิเสธถาวร — ไม่เคยทำให้ผู้เรียกล้ม
 *
 * เป็นจุดที่รับประกันข้อ 2 ของงานนี้: "หลักฐานล้ม ≠ เงินหายเพิ่ม"
 *   · ไม่เขียนเอง → เรียกผู้เขียนหลักฐานล้มเงียบ ๆ (ผู้เรียกจะได้ยังตอบเหมือนเดิม)
 *   · ผู้เขียนหลักฐานโยน → กลืนพร้อม log เสียงดัง (ไม่ใช่กลืนเงียบ)
 *   · เหตุผลไม่ถาวร (order_not_found ฯลฯ) → ไม่เขียนเลย ไฟล์หลักฐานต้องอ่านรู้เรื่อง
 *
 * ตัดสินใจว่าอะไรเข้าไฟล์อยู่ใน payment-rejected-deliveries.service (ที่เดียว)
 * ที่นี่ทำแค่เรียก + กันไม่ให้มันกลายเป็นเหตุให้ webhook ล้ม
 */
async function recordEvidence(
  writer: EvidenceWriter,
  input: { event?: any; reason: NotAppliedReason; message: string; detail: Record<string, unknown> },
) {
  try {
    const evidence = buildRejectedDeliveryEvidence(input);
    if (!evidence) return;
    await writer(evidence);
  } catch (err: any) {
    // ไม่โยนต่อ: คำตอบของ webhook ต้องเหมือนเดิมทุกครั้ง ไม่ว่าหลักฐานจะเป็นอย่างไร
    // (ผู้เขียนหลักฐานที่เป็นของจริงจะ log รายละเอียดเอง — บรรทัดนี้คือกันชั้นที่สอง
    //  สำหรับตัวที่แทรกเข้ามาในเทสต์/อนาคต)
    console.error(
      `[payments] webhook: บันทึกหลักฐานการปฏิเสธไม่สำเร็จ (${input.reason}) — ${String(err?.message ?? err)} · ` +
      'ตอบผู้เรียกตามเดิม เงินจริงอาจเข้าแล้วแต่ไม่มีแถว: ให้ไล่จาก event id ใน log',
    );
  }
}

/** ตอบ non-2xx — สำหรับ delivery ที่ยังมีโอกาสสำเร็จในการส่งครั้งหนัง */
function reject(res: any, message: string, status = 401) {
  return res.status(status).json({
    success: false,
    applied: false,
    rejected: true,
    error: message,
  });
}

// ตัวที่ routes.ts เอาไป mount — ใช้ transport ตาม config (ค่า default = ของปลอม)
const defaults = resolvePaymentsTransport();
export default createPaymentsRouter({
  transport: defaults.transport,
  prisma,
  webhookSecret: config.stripe.webhookSecret,
});
