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
import type { PrismaClient } from '@prisma/client';

export interface PaymentsRouterDeps {
  transport: StripeCheckoutTransport;
  /** ใช้ตอน webhook เท่านั้น (ตอน checkout ไม่แตะ DB) — ใส่ตอนเทสต์ได้ */
  prisma?: PrismaClient;
  /** signing secret ของ webhook endpoint (whsec_…) · คนละตัวกับ STRIPE_SECRET_KEY */
  webhookSecret?: string;
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

    // ออเดอร์หน้าร้าน — จับคู่ด้วย publicToken เมื่อไม่ใช่คำสั่งโอน
    // (ลอง ref_code ก่อนเสมอ เพื่อให้เส้นทางเดิมที่ทำงานอยู่แล้วไม่เปลี่ยนพฤติกรรม)
    const shopOrder = !order && refCode
      ? await db.businessOrder.findFirst({ where: { publicToken: refCode } })
      : null;
    if (shopOrder) return respondStorefrontOrder(res, db, event, shopOrder);

    const decision = decideCompletion(event, order);
    if (decision.kind === 'not_applied') {
      return notApplied(res, decision.reason, decision.message, decision.detail);
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
  });

  return router;
}

/** byte ต้นฉบับของ body — ต้องเซ็นบน byte จริง ห้าม stringify ใหม่ */
/**
 * ตอบออเดอร์หน้าร้าน — route นี้แค่แปลงคำตัดสินของ service เป็น HTTP
 * (การเขียน DB อยู่ที่ payment-apply.service ตามหน้าที่ของมัน)
 *
 * เหตุผลที่แยกจากของ TransferOrder: ตารางคนละตาราง, คอลัมน์คนละชื่อ (publicToken/total
 * ไม่ใช่ ref_code/amount_thb) และสถานะปลายทางต่างกัน (PAID ไม่ใช่ VERIFIED)
 * การยุบรวมเป็นฟังก์ชันเดียวจะต้องมี if/else ซ้อนทั้งสองทางในทุกจุด
 */
async function respondStorefrontOrder(res: any, db: PrismaClient, event: any, shopOrder: any) {
  const decision = decideStorefrontCompletion(event, shopOrder);
  if (decision.kind === 'not_applied') {
    return notApplied(res, decision.reason, decision.message, decision.detail);
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
 */
function notApplied(
  res: any,
  reason: NotAppliedReason,
  message: string,
  extra: Record<string, unknown> = {},
) {
  // log เสียงดัง: การตอบ 2xx ทำให้ event นี้ไม่โผล่ในหน้า Stripe อีก
  // ถ้าไม่ log เงินค้างจะเงียบไปตลอดจนกว่าจะมีคนไปเจอเอง
  // ต้อง stringify เอง — ถ้าส่ง object เข้าไป console จะกลายเป็น [object Object]
  // ทำให้ ref_code กับตัวเลขที่ต้องไปแก้หายไปทั้งหมด
  const detail = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  console.error(`[payments] webhook ไม่ได้ apply (${reason}) — ${message}${detail}`);
  return res.status(200).json({
    success: false,
    applied: false,
    ignored: true,
    reason,
    error: message,
    ...extra,
  });
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
