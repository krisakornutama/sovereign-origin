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
      return res.status(400).json({ error: 'webhook signing secret is not configured' });
    }

    const raw = rawBodyOf(req);
    const verified = verifyStripeSignature({
      header: req.headers['stripe-signature'] as string | undefined,
      rawBody: raw,
      secret,
    });
    if (!verified.ok) {
      return res.status(400).json({ error: `invalid stripe signature: ${verified.reason}` });
    }

    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'webhook body is not valid JSON' });
    }
    if (event?.type !== 'checkout.session.completed') {
      // event อื่นไม่ใช่ธุระของเรา — ตอบ 200 เพื่อไม่ให้ Stripe retry
      return res.status(200).json({ success: true, ignored: true, type: event?.type ?? null });
    }

    const session = event?.data?.object ?? {};
    const refCode = String(session.client_reference_id ?? '').trim();
    if (!refCode) {
      return res.status(400).json({ error: 'missing client_reference_id — จับคู่ order ไม่ได้' });
    }

    const db = deps.prisma ?? prisma;
    const order = await db.transferOrder.findFirst({ where: { ref_code: refCode } });
    if (!order) return res.status(404).json({ error: `no transfer order for ref_code ${refCode}` });

    // ── ยอดเงิน: ตัวเลขที่เชื่อคือของ ORDER ไม่ใช่ของ session ─────────────
    // session.amount_total มาจากฝั่ง Stripe (ผู้โจมตีแก้เองได้ถ้าไม่ตรวจลายเซ็น
    // แต่แม้ผ่านลายเซ็นแล้ว เราก็ยังต้องเทียบกับ "ราคาที่ order คาดไว้"
    // คาดหวังมาจาก TransferOrder.amount_thb (เก็บเป็นบาท) → แปลงเป็นสตางค์
    if (String(session.currency) !== THB_CURRENCY_CODE) {
      return res.status(400).json({
        error: `currency mismatch: order is ${THB_CURRENCY_CODE}, session charged ${session.currency}`,
      });
    }
    const expectedThb = Number(order.amount_thb);
    let expectedMinor: number;
    try {
      expectedMinor = toThbMinorUnit(expectedThb);
    } catch {
      return res.status(400).json({ error: `order ${refCode} has no usable THB amount` });
    }
    if (Number(session.amount_total) !== expectedMinor) {
      // ปฏิเสธอย่างดัง ๆ — ห้ามใช้ยอดใน session มาเป็นความจริงแทน order
      return res.status(400).json({
        error: `amount mismatch: order ${refCode} expects ${expectedMinor} satang (THB ${(expectedMinor / 100).toFixed(2)}), session paid ${session.amount_total}`,
      });
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
      // ตอบ 200 เพื่อไม่ให้ Stripe retry ซ้ำ (ตอนนี้ order อยู่ในสถานะที่ยืนยันแล้ว
      // หรือถูกยกเลิก — ไม่ย้อนสถานะกลับ)
      const fresh = await db.transferOrder.findFirst({ where: { ref_code: refCode } });
      return res.status(200).json({
        success: true,
        alreadyApplied: true,
        refCode,
        status: fresh?.status ?? null,
      });
    }

    return res.status(200).json({
      success: true,
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

// ตัวที่ routes.ts เอาไป mount — ใช้ transport ตาม config (ค่า default = ของปลอม)
const defaults = resolvePaymentsTransport();
export default createPaymentsRouter({
  transport: defaults.transport,
  prisma,
  webhookSecret: config.stripe.webhookSecret,
});
