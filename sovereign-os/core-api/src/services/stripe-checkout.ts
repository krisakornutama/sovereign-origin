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

/** Stripe บังคับให้ส่งรหัสสกุลเงินเป็นตัวพิมพ์เล็ก */
export const THB_CURRENCY_CODE = 'thb';

// ── อินพุต/เอาต์พุตของส่วนที่คิดเงิน ────────────────────────────────────────

export interface CheckoutSessionRequest {
  /** ยอดเงินเป็น "บาท" (ทศนิยมได้ ไม่เกิน 2 ตำแหน่ง) — ตรงกับที่ทั้งระบบเก็บ */
  amountBaht: number;
  productName: string;
  productDescription?: string;
  productMetadata?: Record<string, string>;
  /** รหัสอ้างอิงกลับไปหา order ของเรา — ใช้ค่า TransferOrder.ref_code */
  clientReferenceId?: string;
  quantity?: number;
  successUrl?: string;
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

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer (got ${input.quantity})`);
  }

  const unitAmount = toThbMinorUnit(input.amountBaht);

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
  if (input.clientReferenceId) params.client_reference_id = input.clientReferenceId;
  if (input.successUrl) params.success_url = input.successUrl;
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
