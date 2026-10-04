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
  toThbMinorUnit,
  THB_CURRENCY_CODE,
  CLIENT_REFERENCE_ID_MAX_LENGTH,
  type StripeCheckoutTransport,
} from '../../services/stripe-checkout';
import { verifyStripeSignature } from '../../services/stripe-webhook.service';

export interface PaymentsRouterDeps {
  transport: StripeCheckoutTransport;
  /** ใช้ตอน webhook เท่านั้น (ตอน checkout ไม่แตะ DB) — ใส่ตอนเทสต์ได้ */
  prisma?: any;
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
 */
export function resolvePaymentsTransport(): PaymentsRouterDefault {
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

      // refCode = ref_code ของ order ที่มีอยู่แล้ว (TransferOrder.ref_code)
      // ใช้เป็น client_reference_id ตามที่ Stripe ระบุไว้ตรง ๆ ว่า
      // "a cart ID, or similar, and can be used to reconcile the session
      //  with your internal systems" — webhook ในอนาคตจะจับคู่ด้วยค่านี้
      const refCode = String(body.refCode ?? '').trim();
      if (!refCode) {
        return res.status(400).json({ error: 'refCode is required — ใช้ ref_code ของ order เป็น join key' });
      }
      if (refCode.length > CLIENT_REFERENCE_ID_MAX_LENGTH) {
        return res.status(400).json({
          error: `refCode must be at most ${CLIENT_REFERENCE_ID_MAX_LENGTH} characters (got ${refCode.length})`,
        });
      }

      // ส่งต่อให้ buildCheckoutSessionParams ตรวจที่เหลือ (ยอด/สินค้า/successUrl/จำนวน)
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
    if (event?.type !== 'checkout.session.completed') {
      // event อื่นไม่ใช่ธุระของเรา — ไม่มีทางกลายเป็นจริงในการส่งครั้งหนัง
      return notApplied(
        res,
        'unsupported_event_type',
        `ไม่ใช่ event ที่เราดูแล: ${event?.type ?? 'ไม่ระบุ'}`,
        { type: event?.type ?? null },
      );
    }

    const session = event?.data?.object ?? {};
    const refCode = String(session.client_reference_id ?? '').trim();
    if (!refCode) {
      return notApplied(
        res,
        'missing_client_reference_id',
        'ไม่มี client_reference_id — จับคู่ order ไม่ได้ (ไม่เดา ไม่สร้าง order ใหม่)',
        { sessionId: String(session.id ?? '') || null },
      );
    }

    const db = deps.prisma ?? prisma;
    const order = await db.transferOrder.findFirst({ where: { ref_code: refCode } });
    if (!order) {
      return notApplied(
        res,
        'order_not_found',
        `ไม่พบ order สำหรับ ref_code ${refCode} — ตรวจว่า client_reference_id ถูกต้องไหม`,
        { refCode },
      );
    }

    // ── ยอดเงิน: ตัวเลขที่เชื่อคือของ ORDER ไม่ใช่ของ session ─────────────
    // session.amount_total มาจากฝั่ง Stripe (ผู้โจมตีแก้เองได้ถ้าไม่ตรวจลายเซ็น
    // แต่แม้ผ่านลายเซ็นแล้ว เราก็ยังต้องเทียบกับ "ราคาที่ order คาดไว้"
    // คาดหวังมาจาก TransferOrder.amount_thb (เก็บเป็นบาท) → แปลงเป็นสตางค์
    if (String(session.currency) !== THB_CURRENCY_CODE) {
      return notApplied(
        res,
        'currency_mismatch',
        `สกุลเงินไม่ตรง: order เป็น ${THB_CURRENCY_CODE} แต่ session จ่าย ${session.currency}`,
        { refCode, expectedCurrency: THB_CURRENCY_CODE, receivedCurrency: session.currency ?? null },
      );
    }
    const expectedThb = Number(order.amount_thb);
    let expectedMinor: number;
    try {
      expectedMinor = toThbMinorUnit(expectedThb);
    } catch {
      return notApplied(
        res,
        'order_amount_unusable',
        `order ${refCode} ไม่มียอดบาทที่ใช้ได้ (${order.amount_thb})`,
        { refCode, amountThb: order.amount_thb ?? null },
      );
    }
    if (Number(session.amount_total) !== expectedMinor) {
      // ห้ามใช้ยอดใน session มาเป็นความจริงแทน order
      return notApplied(
        res,
        'amount_mismatch',
        `ยอดไม่ตรง: order ${refCode} คาด ${expectedMinor} สตางค์ (THB ${(expectedMinor / 100).toFixed(2)}) แต่จ่ายมา ${session.amount_total}`,
        { refCode, expectedSatang: expectedMinor, receivedSatang: session.amount_total ?? null },
      );
    }

    // ── กันส่งซ้ำ: conditional update แบบ claimPending ของ transfer.service ──
    // เขียนได้ก็ต่อเมื่อยัง PENDING → Stripe ส่งซ้ำจะได้ count 0
    const claimed = await db.transferOrder.updateMany({
      where: { ref_code: refCode, status: 'PENDING' },
      data: {
        status: 'VERIFIED',
        txid: String(session.id ?? ''),
        verified_by: 'stripe-webhook',
        verified_at: new Date(),
      },
    });
    if (claimed.count !== 1) {
      // ตอนนี้ order อยู่ในสถานะที่ยืนยันแล้ว หรือถูกยกเลิก — ไม่ย้อนสถานะกลับ
      // ครั้งนี้ไม่ได้เขียนอะไร แต่ "เงินจ่ายแล้ว" เป็นความจริงอยู่แล้ว
      // จึงไม่ใช่เคสผิดปกติเท่า mismatch — log ระดับ info พอ
      const fresh = await db.transferOrder.findFirst({ where: { ref_code: refCode } });
      console.warn(
        `[payments] webhook: ส่งซ้ำ order ${refCode} (สถานะ ${fresh?.status ?? 'ไม่รู้'}) — ไม่เขียนซ้ำ`,
      );
      return res.status(200).json({
        success: true,
        applied: false,
        alreadyApplied: true,
        reason: 'order_not_pending',
        refCode,
        status: fresh?.status ?? null,
      });
    }

    return res.status(200).json({
      success: true,
      applied: true,
      alreadyApplied: false,
      refCode,
      sessionId: String(session.id ?? ''),
      status: 'VERIFIED',
    });
  });

  return router;
}

/** byte ต้นฉบับของ body — ต้องเซ็นบน byte จริง ห้าม stringify ใหม่ */
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

/** ตอบ 2xx + บอกตรง ๆ ว่า "ไม่ได้จ่าย" — สำหรับ delivery ที่ไม่มีทางสำเร็จในการส่งครั้งหนัง */
function notApplied(res: any, reason: string, message: string, extra: Record<string, unknown> = {}) {
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
