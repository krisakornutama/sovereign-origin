// ────────────────────────────────────────────────────────────────────────────
// Stripe Checkout (THB) — pure payload logic + transport seam
//
// ทำไมต้องมีไฟล์นี้: ขั้นตอน "ชำระเงินจริง" ต้องแยกส่วนที่คิดเงินออกจากส่วนที่ยิง
// เน็ตออกจากกัน เพื่อให้ (1) เทสต์ตรรกะเงินได้โดยไม่ต้องต่อ Stripe
// และ (2) ไม่มีทางที่โค้ดจะยิง Stripe จริงโดยไม่ได้เปิดสวิตช์อย่างชัดเจน
//
// ── หน่วยเงิน (ข้อเท็จจริง ไม่ใช่การเดา) ──────────────────────────────────
// Stripe รับยอดเป็น "minor unit" ไม่ใช่หน่วยใหญ่
//   ที่มาของข้อเท็จจริง: docs.stripe.com/currencies
//     "Currencies are two-decimal currencies unless otherwise specified.
//      All API requests expect amount values in the currency's minor unit."
//   THB ไม่อยู่ในรายชื่อ zero-decimal (BIF CLP DJF GNF JPY KMF KRW MGA PYG
//   RWF UGX VND VUV XAF XCD XCG XOF XPF) และไม่ใช่ special case (ISK HUF TWD UGX)
//   → THB เป็นทศนิยม 2 ตำแหน่ง → 1 บาท = 100 สตางค์
//
// ⚠️ ความต่างกับที่เก็บอยู่ในระบบ: ทั่วโปรเจกต์เก็บยอดบาทเป็นทศนิยม (Float)
//   (TransferOrder.amount_thb, RestaurantOrderLine.priceTHB, Order.totalTHB)
//   ฟังก์ชันนี้จึงรับ "บาท" แล้วแปลงเป็น "สตางค์" ให้ Stripe — ไม่ใช่รับสตางค์มาแล้ว
//   จุดที่แปลงมีที่เดียว คือที่นี่ จุดอื่นไม่ต้องแตะ
// ────────────────────────────────────────────────────────────────────────────

/** Stripe รับยอดเป็นหน่วยเล็กสุดของสกุลเงิน — THB ทศนิยม 2 ตำแหน่ง → บาท × 100 = สตางค์ */
export const THB_MINOR_UNIT_DIVISOR = 100;

/**
 * เพดานบนของ unit_amount ตามเอกสาร Stripe:
 * "unit_amount — A positive integer, in THB (thb), in the smallest currency unit… Maximum: 99999999"
 * ตัวเลขนี้มาจากเอกสาร ไม่ใช่ค่าที่เราเลือก — ถ้าเปลี่ยนให้เช็คเอกสารใหม่
 *
 * ทำไมต้องเช็คตรงนี้: ถ้าไม่เช็ค เราจะสร้าง payload ที่ Stripe ปฏิเสธตอนยิงจริง
 * ทั้งที่ order ถูกสร้างไว้แล้ว → ลูกค้าจ่ายไม่ได้ และเงินค้างโดยไม่มีใครรู้
 */
export const THB_MAX_MINOR_UNIT = 99_999_999;

/**
 * เพดานยอดรวมของ session (หน่วยเล็กสุด) — ตัวเลขนี้มาจากเอกสาร Stripe จริง
 *
 * แหล่ง: docs.stripe.com/currencies → หัวข้อ "Maximum charge amounts"
 *   · "Other payment methods … 8 digits for all other currencies,
 *      for a maximum charge of 999,999.99 (99999999)"
 *   · ยกเว้น 12 หลัก (IDR), 10 หลัก (COP), 9 หลัก (INR) — THB ไม่อยู่ในรายการนั้น
 *     จึงตกอยู่ในกลุ่ม "all other currencies" = 8 หลัก
 *   · บัตร (Visa/Mastercard/debit ที่ไทยรับ) รองรับ 12 หลัก = 999,999,999,999
 *     ซึ่ง "หลวม" กว่า 8 หลัก → ตัวที่บังคับจริงคือ 99,999,999
 *   · บัญชีนี้มี promptpay_payments เปิดอยู่ ซึ่งเป็น non-card → ใช้เพดาน 8 หลัก
 *
 * หมายเหตุ: ตัวเลขนี้บังเอิญเท่ากับ THB_MAX_MINOR_UNIT พอดี (ทั้งคู่คือ 999,999.99)
 * แต่เป็นคนละเรื่องกัน: อันบนคือ "ต่อหน่วย" อันนี้คือ "ทั้ง session"
 * ถ้าอนาคต Stripe เปลี่ยนเพดานยอดรวม ตัวนี้ต้องแก้แยกจากอันบน
 */
export const THB_MAX_CHARGE_MINOR_UNIT = 99_999_999;

/** Stripe บังคับให้ส่งรหัสสกุลเงินเป็นตัวพิมพ์เล็ก */
export const THB_CURRENCY_CODE = 'thb';

/**
 * เพดานความยาว client_reference_id ตามเอกสาร Stripe:
 * "A unique string to reference the Checkout Session… The maximum length is 200 characters."
 * ตัวเลขนี้มาจากเอกสาร ไม่ใช่ค่าที่เราเลือก — ถ้าเปลี่ยนให้เช็คเอกสารใหม่
 */
export const CLIENT_REFERENCE_ID_MAX_LENGTH = 200;

/**
 * ทำความสะอาด client_reference_id ก่อนใช้ — ที่เดียวที่จริง ๆ
 * ทั้งฝั่งสร้าง session (routes) และฝั่งรับ webhook (payment-verification)
 * ใช้ค่านี้ต่อไปเป็น key หา order → ต้องเหมือนกันทุกเส้นทาง
 */
export function normalizeRefCode(raw: unknown): string {
  return String(raw ?? '').trim();
}

// ── อินพุต/เอาต์พุตของส่วนที่คิดเงิน ────────────────────────────────────────

export interface CheckoutSessionRequest {
  /** ยอดเงินเป็น "บาท" (ทศนิยมได้ ไม่เกิน 2 ตำแหน่ง) — ตรงกับที่ทั้งระบบเก็บ */
  amountBaht: number;
  productName: string;
  productDescription?: string;
  productMetadata?: Record<string, string>;
  /** รหัสอ้างอิงกลับไปหา order ของเรา — ใช้ค่า TransferOrder.ref_code (ยาวไม่เกิน 200) */
  clientReferenceId?: string;
  quantity?: number;
  /**
   * บังคับต้องมี — Stripe ทำเครื่องหมาย success_url ว่า "required conditionally"
   * และบอกว่า "not allowed if ui_mode is embedded_page or elements"
   * เราสร้าง hosted session (ไม่ได้ตั้ง ui_mode → ค่า default ของ Stripe)
   * แต่เงื่อนไขจริงอยู่ฝั่ง Stripe/บัญชี เราตรวจจากฝั่งเราไม่ได้ว่าเป็นแบบไหน
   * และ Dashboard อาจมี default อยู่แล้ว → ตัดสินใจปฏิเสธเมื่อไม่มีค่า
   * ดีกว่าปล่อยให้สร้าง session ที่ Stripe ไม่รับ
   */
  successUrl: string;
  /** ไม่บังคับ — Stripe ระบุว่า cancel_url เป็น optional จริง ๆ (ไม่มี requirement_text) */
  cancelUrl?: string;
}

export interface StripeCheckoutSessionParams {
  mode: 'payment';
  client_reference_id?: string;
  line_items: Array<{
    quantity: number;
    price_data: {
      currency: string;
      /** หน่วยเล็กสุด = สตางค์ (integer) */
      unit_amount: number;
      product_data: {
        name: string;
        description?: string;
        metadata?: Record<string, string>;
      };
    };
  }>;
  success_url?: string;
  cancel_url?: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  livemode: boolean;
  client_reference_id: string | null;
}

// ── แปลงบาท → สตางค์ ────────────────────────────────────────────────────────

/**
 * ปัดทศนิยมครึ่งขึ้นให้เป็นสตางค์โดยไม่ตกลงไปกับ float error
 * (เช่น 8.115 * 100 ใน JS ได้ 811.4999999999999 ไม่ใช่ 811.5)
 * ทำเป็น string ก่อนปัด จึงไม่พึ่งพฤติกรรมของเลขทศนิยมของ IEEE-754
 */
function roundBahtToSatang(amountBaht: number): number {
  const [intPart, fracPart = ''] = amountBaht.toFixed(6).split('.');
  const frac = (fracPart + '000000').slice(0, 6);
  let satang = Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) satang += 1;
  const whole = Number(intPart);
  // ทศนิยมปัดขึ้นจนกลายเป็น 100 สตางค์ = ทั้งบาท (เช่น 0.999 → 100)
  return satang === 100 ? (whole + 1) * 100 : whole * 100 + satang;
}

/**
 * แปลงยอดบาทเป็นสตางค์ (integer) ตามที่ Stripe ต้องการ
 *
 * หมายเหตุเรื่องยอด 0 — นี่คือ "นโยบายของเรา" ไม่ใช่ข้อบังคับของ Stripe:
 * เอกสาร Stripe ระบุว่า unit_amount เป็น "a non-negative integer" → 0 ผ่านได้
 * แต่เราเลือกโยน error เพราะ Checkout Session ที่เรียกเก็บ 0 บาทไม่มีความหมาย
 * ทางธุรกิจ และการปล่อยให้ผ่านทำให้ "สินค้าฟรี" ปนกับ "ข้อมูลผิด" ในเทสต์
 * ถ้าวันหนึ่งอยากให้ยอด 0 ผ่านได้จริง ให้เปลี่ยนที่นี่ที่เดียว
 *
 * @throws ถ้าไม่ใช่ตัวเลขจำนวนเต็มบวก หรือปัดลงแล้วไม่เหลือแม้แต่ 1 สตางค์
 */
export function toThbMinorUnit(amountBaht: number): number {
  if (typeof amountBaht !== 'number' || !Number.isFinite(amountBaht)) {
    throw new TypeError(`amountBaht must be a finite number (got ${typeof amountBaht})`);
  }
  if (amountBaht <= 0) {
    throw new RangeError(`amountBaht must be greater than 0 (got ${amountBaht})`);
  }
  const satang = roundBahtToSatang(amountBaht);
  if (satang < 1) {
    throw new RangeError(`amountBaht ${amountBaht} rounds to 0 satang — smaller than 1 satang`);
  }
  if (satang > THB_MAX_MINOR_UNIT) {
    // ข้อบังคับจริงของ Stripe (ไม่ใช่นโยบายของเรา) — จับก่อนสร้าง payload
    // ไม่งั้น Stripe จะปฏิเสธตอนยิงจริง หลัง order ถูกสร้างไปแล้ว
    throw new RangeError(
      `amountBaht ${amountBaht} = ${satang} satang exceeds Stripe's unit_amount maximum of ${THB_MAX_MINOR_UNIT}`,
    );
  }
  return satang;
}

// ── สร้าง payload ───────────────────────────────────────────────────────────

/**
 * สร้าง params สำหรับ POST /v1/checkout/sessions — เป็น pure function
 * ไม่ยิงเน็ต ไม่อ่าน env ไม่แตะ DB (ทดสอบได้ด้วยเทสต์ล้วน)
 */
export function buildCheckoutSessionParams(input: CheckoutSessionRequest): StripeCheckoutSessionParams {
  const name = String(input.productName ?? '').trim();
  if (!name) throw new TypeError('productName is required');

  const successUrl = String(input.successUrl ?? '').trim();
  if (!successUrl) throw new TypeError('successUrl is required for a hosted Checkout Session');

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer (got ${input.quantity})`);
  }

  const unitAmount = toThbMinorUnit(input.amountBaht);

  // เพดานต่อหน่วยไม่พอ: ต่อหน่วยที่เต็มเพดาน คูณ quantity แล้วยอดรวมจะเกิน
  // ที่ Stripe ยอมรับ → จับที่นี่ (จุดเดียวกับที่คิด unit_amount) ก่อนสร้าง payload
  const totalSatang = unitAmount * quantity;
  if (totalSatang > THB_MAX_CHARGE_MINOR_UNIT) {
    throw new RangeError(
      `total ${totalSatang} satang (${unitAmount} × ${quantity}) exceeds Stripe's maximum charge ` +
      `of ${THB_MAX_CHARGE_MINOR_UNIT} satang (THB ${(THB_MAX_CHARGE_MINOR_UNIT / 100).toFixed(2)})`,
    );
  }

  const params: StripeCheckoutSessionParams = {
    mode: 'payment',
    line_items: [
      {
        quantity,
        price_data: {
          currency: THB_CURRENCY_CODE,
          unit_amount: unitAmount,
          product_data: { name },
        },
      },
    ],
  };

  const description = String(input.productDescription ?? '').trim();
  if (description) params.line_items[0].price_data.product_data.description = description;
  if (input.productMetadata) params.line_items[0].price_data.product_data.metadata = input.productMetadata;

  const clientRef = String(input.clientReferenceId ?? '').trim();
  if (clientRef) {
    if (clientRef.length > CLIENT_REFERENCE_ID_MAX_LENGTH) {
      throw new RangeError(
        `client_reference_id must be at most ${CLIENT_REFERENCE_ID_MAX_LENGTH} characters (got ${clientRef.length})`,
      );
    }
    params.client_reference_id = clientRef;
  }

  params.success_url = successUrl;
  if (input.cancelUrl) params.cancel_url = input.cancelUrl;

  return params;
}

// ── Transport seam ──────────────────────────────────────────────────────────

/** จุดเสียบที่เดียวที่ "พูดกับ Stripe" — ที่อื่นทั้งหมดเป็น pure logic */
export interface StripeCheckoutTransport {
  createCheckoutSession(params: StripeCheckoutSessionParams): Promise<StripeCheckoutSession>;
}

export interface FakeStripeCheckoutTransport extends StripeCheckoutTransport {
  /** payload ทุกครั้งที่ถูกส่ง — ใช้ assert ในเทสต์ว่า "ยอดถูกต้อง" */
  readonly calls: StripeCheckoutSessionParams[];
}

/** ของปลอมสำหรับเทสต์/เล่นระบบในเครื่อง — ไม่ออกเน็ต ไม่ใช้ key */
export function createFakeStripeTransport(seed?: { prefix?: string }): FakeStripeCheckoutTransport {
  const calls: StripeCheckoutSessionParams[] = [];
  const prefix = seed?.prefix ?? 'cs_test_fake';
  let seq = 0;
  return {
    calls,
    async createCheckoutSession(params) {
      calls.push(params);
      seq += 1;
      return {
        id: `${prefix}_${seq.toString().padStart(4, '0')}`,
        url: `https://checkout.stripe.test/${prefix}_${seq.toString().padStart(4, '0')}`,
        livemode: false,
        client_reference_id: params.client_reference_id ?? null,
      };
    },
  };
}

export class LiveStripeTransportDisabledError extends Error {
  constructor() {
    super(
      'Live Stripe transport is disabled. Enable it explicitly (STRIPE_LIVE_ENABLED=true) — ' +
        'until then no request can leave this process.',
    );
    this.name = 'LiveStripeTransportDisabledError';
  }
}

export interface LiveStripeTransportOptions {
  secretKey: string;
  /** ต้องเป็น true อย่างชัดเจน — ค่าเริ่มต้น/ค่าว่าง = ไม่ยอมยิง */
  enabled: boolean;
  baseUrl?: string;
}

/**
 * client ตัวจริง — ยิง Stripe จริงได้ก็ต่อเมื่อผู้เรียกเปิดสวิตช์อย่างชัดเจน
 * เพราะบัญชีนี้เป็น live mode การยิงผิดทำให้เงินจริงหาย
 */
export function createLiveStripeTransport(opts: LiveStripeTransportOptions): StripeCheckoutTransport {
  if (opts.enabled !== true) throw new LiveStripeTransportDisabledError();
  const secretKey = String(opts.secretKey ?? '').trim();
  if (!secretKey) throw new TypeError('secretKey is required when the live transport is enabled');
  const baseUrl = (opts.baseUrl ?? 'https://api.stripe.com').replace(/\/$/, '');

  return {
    async createCheckoutSession(params) {
      const res = await fetch(`${baseUrl}/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(flattenParams(params)).toString(),
      });
      const body = (await res.json()) as any;
      if (!res.ok) throw new Error(`Stripe error ${res.status}: ${body?.error?.message ?? 'unknown'}`);
      return {
        id: body.id,
        url: body.url ?? null,
        livemode: Boolean(body.livemode),
        client_reference_id: body.client_reference_id ?? null,
      };
    },
  };
}

/** params แบบ nested → form-encoded ตามที่ Stripe คาด (price_data[...] ) */
function flattenParams(params: StripeCheckoutSessionParams): Record<string, string> {
  const out: Record<string, string> = { mode: params.mode };
  if (params.client_reference_id) out.client_reference_id = params.client_reference_id;
  if (params.success_url) out.success_url = params.success_url;
  if (params.cancel_url) out.cancel_url = params.cancel_url;
  params.line_items.forEach((item, i) => {
    const p = `line_items[${i}]`;
    out[`${p}[quantity]`] = String(item.quantity);
    out[`${p}[price_data][currency]`] = item.price_data.currency;
    out[`${p}[price_data][unit_amount]`] = String(item.price_data.unit_amount);
    out[`${p}[price_data][product_data][name]`] = item.price_data.product_data.name;
    if (item.price_data.product_data.description) {
      out[`${p}[price_data][product_data][description]`] = item.price_data.product_data.description;
    }
    for (const [k, v] of Object.entries(item.price_data.product_data.metadata ?? {})) {
      out[`${p}[price_data][product_data][metadata][${k}]`] = v;
    }
  });
  return out;
}
