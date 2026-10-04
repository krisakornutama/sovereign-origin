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
import {
  buildCheckoutSessionParams,
  createFakeStripeTransport,
  createLiveStripeTransport,
  CLIENT_REFERENCE_ID_MAX_LENGTH,
  type StripeCheckoutTransport,
} from '../../services/stripe-checkout';

export interface PaymentsRouterDeps {
  transport: StripeCheckoutTransport;
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

  return router;
}

// ตัวที่ routes.ts เอาไป mount — ใช้ transport ตาม config (ค่า default = ของปลอม)
const defaults = resolvePaymentsTransport();
export default createPaymentsRouter(defaults);
