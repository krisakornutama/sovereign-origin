// ────────────────────────────────────────────────────────────────────────────
// Stripe Checkout (THB) — pure payload logic + transport seam
//
// หน่วยเงิน: Stripe คิดเป็น "minor unit" — THB เป็นสกุลเงินทศนิยม 2 ตำแหน่ง
// (ไม่ใช่ zero-decimal) → 1 บาท = 100 สตางค์ → ตัวคูณ 100
// ที่มาของข้อเท็จจริง: docs.stripe.com/currencies
//   "Currencies are two-decimal currencies unless otherwise specified.
//    All API requests expect amount values in the currency's minor unit."
//   THB ไม่อยู่ในรายชื่อ zero-decimal และไม่ใช่ special case → ทศนิยม 2 ตำแหน่ง
//
// ความเสี่ยงที่เทสต์นี้ตั้งใจกัน: สลับบาท/สตางค์ผิด (factor of 100)
// คนอ่านโค้ดอย่างเดียวมักเข้าใจผิดว่า unit_amount คือ "จำนวนบาท"
// ────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert';
import {
  THB_MINOR_UNIT_DIVISOR,
  THB_CURRENCY_CODE,
  toThbMinorUnit,
  buildCheckoutSessionParams,
  createFakeStripeTransport,
  createLiveStripeTransport,
  LiveStripeTransportDisabledError,
  type CheckoutSessionRequest,
} from '../src/services/stripe-checkout';

// ── ค่าคงที่หน่วยเงิน ────────────────────────────────────────────────────────

test('THB เป็นสกุลเงินทศนิยม 2 ตำแหน่ง → ตัวคูณต้องเป็น 100 ไม่ใช่ 1', () => {
  assert.strictEqual(THB_MINOR_UNIT_DIVISOR, 100);
});

test('รหัสสกุลเงินต้องเป็นตัวพิมพ์เล็กตามที่ Stripe บังคับ', () => {
  assert.strictEqual(THB_CURRENCY_CODE, 'thb');
  assert.strictEqual(THB_CURRENCY_CODE, THB_CURRENCY_CODE.toLowerCase());
});

// ── แปลงบาท → สตางค์ ────────────────────────────────────────────────────────

test('แปลงบาทเป็นสตางค์: กรณีพื้นฐาน', () => {
  assert.strictEqual(toThbMinorUnit(1), 100);
  assert.strictEqual(toThbMinorUnit(100), 10000);
  assert.strictEqual(toThbMinorUnit(0.01), 1);
  assert.strictEqual(toThbMinorUnit(1234.56), 123456);
});

test('แปลงบาทเป็นสตางค์: ต้องไม่หลุดเพราะเลขทศนิยมของ float', () => {
  // 0.07 * 100 = 7.000000000000001 ใน JS → ต้องปัด ไม่ใช่ floor ให้ 7 ผ่านการแสดงผล
  assert.strictEqual(toThbMinorUnit(0.07), 7);
  assert.strictEqual(toThbMinorUnit(0.29), 29);
  assert.strictEqual(toThbMinorUnit(19.99), 1999);
  assert.strictEqual(toThbMinorUnit(8.115), 812, 'ปัดทศนิยมให้เป็นสตางค์ก่อนคูณ');
});

test('แปลงบาทเป็นสตางค์: ต้องไม่ใช้บาทดิบ (กัน factor-of-100 ผิดทาง)', () => {
  // ถ้าใคร "ลืม" คูณ 100 ค่าทั้งหมดนี้จะพังทันที
  assert.notStrictEqual(toThbMinorUnit(250), 250);
  assert.notStrictEqual(toThbMinorUnit(250), 25);
});

test('แปลงบาทเป็นสตางค์: ยอดที่รับไม่ได้ต้องโยน error ไม่ใช่คืน 0 หรือ NaN', () => {
  assert.throws(() => toThbMinorUnit(0), /must be greater than 0/);
  assert.throws(() => toThbMinorUnit(-1), /must be greater than 0/);
  assert.throws(() => toThbMinorUnit(NaN), /must be a finite number/);
  assert.throws(() => toThbMinorUnit(Infinity), /must be a finite number/);
  assert.throws(() => toThbMinorUnit('100' as unknown as number), /must be a finite number/);
});

// กติกา: ปัดครึ่งขึ้นให้เป็นสตางค์ (ตรงกับที่คนอ่านราคา และกับ formatThbAmount
// ที่ปัดด้วย Math.round) — ทิ้งเฉพาะกรณีที่ปัดลงแล้วเหลือ 0 สตางค์
test('แปลงบาทเป็นสตางค์: ที่ปัดลงเหลือ 0 สตางค์ต้องโยน error', () => {
  assert.throws(() => toThbMinorUnit(0.001), /smaller than 1 satang/);
  assert.throws(() => toThbMinorUnit(0.004), /smaller than 1 satang/);
});

test('แปลงบาทเป็นสตางค์: ปัดครึ่งขึ้น ไม่ใช่ปัดลง (0.009 คือ 1 สตางค์ ไม่ใช่ error)', () => {
  assert.strictEqual(toThbMinorUnit(0.009), 1);
  assert.strictEqual(toThbMinorUnit(0.005), 1);
});

// ── สร้าง payload ของ Checkout Session ────────────────────────────────────

const base: CheckoutSessionRequest = {
  amountBaht: 250,
  productName: 'Sovereign Origin — สมาชิกปี',
};

test('payload ต้องส่ง unit_amount เป็นสตางค์ ไม่ใช่บาท', () => {
  const p = buildCheckoutSessionParams(base);
  assert.strictEqual(p.mode, 'payment');
  assert.strictEqual(p.line_items.length, 1);
  assert.strictEqual(p.line_items[0].price_data.currency, 'thb');
  assert.strictEqual(p.line_items[0].price_data.unit_amount, 25000);
  assert.notStrictEqual(p.line_items[0].price_data.unit_amount, 250);
});

test('payload ต้องพา metadata ของสินค้าและ client_reference_id ผ่านไปด้วย', () => {
  const p = buildCheckoutSessionParams({
    ...base,
    productDescription: 'สิทธิ์ใช้งานครบทุกโมดูล',
    productSku: 'sovereign-annual',
    productMetadata: { tier: 'annual', seats: '5' },
    clientReferenceId: 'XFR-ABC123',
  });
  assert.strictEqual(p.line_items[0].price_data.product_data.name, 'Sovereign Origin — สมาชิกปี');
  assert.strictEqual(p.line_items[0].price_data.product_data.description, 'สิทธิ์ใช้งานครบทุกโมดูล');
  assert.deepStrictEqual(p.line_items[0].price_data.product_data.metadata, { tier: 'annual', seats: '5' });
  assert.strictEqual(p.client_reference_id, 'XFR-ABC123');
});

test('payload ต้องคูณจำนวนสินค้าให้ถูกทั้งแบบรายชิ้นและรวมบิล', () => {
  const one = buildCheckoutSessionParams({ ...base, amountBaht: 19.99, quantity: 3 });
  assert.strictEqual(one.line_items[0].quantity, 3);
  assert.strictEqual(one.line_items[0].price_data.unit_amount, 1999, 'unit_amount คือราคาต่อชิ้น');
  assert.strictEqual(one.line_items[0].price_data.unit_amount * 3, 5997, 'รวมบิล = 59.97 บาท');
});

test('payload ต้องปฏิเสธสินค้าที่ไม่มีชื่อ และจำนวนที่ไม่ใช่เลขจำนวนเต็มบวก', () => {
  assert.throws(() => buildCheckoutSessionParams({ ...base, productName: '' }), /productName is required/);
  assert.throws(() => buildCheckoutSessionParams({ ...base, quantity: 0 }), /quantity/);
  assert.throws(() => buildCheckoutSessionParams({ ...base, quantity: 1.5 }), /quantity/);
});

// ── Transport seam ─────────────────────────────────────────────────────────

test('fake transport คืน session ปลอมและไม่แตะเครือข่าย', async () => {
  const transport = createFakeStripeTransport();
  const p = buildCheckoutSessionParams({ ...base, clientReferenceId: 'XFR-FAKE1' });
  const session = await transport.createCheckoutSession(p);

  assert.ok(session.id.startsWith('cs_'), 'id ต้องขึ้นต้นด้วย cs_');
  assert.strictEqual(session.livemode, false, 'ของปลอมต้องไม่ใช่ของจริง');
  assert.strictEqual(session.client_reference_id, 'XFR-FAKE1');
  assert.strictEqual(transport.calls.length, 1, 'ต้องบันทึก payload ที่ถูกส่ง');
  assert.strictEqual(transport.calls[0].line_items[0].price_data.unit_amount, 25000);
});

test('fake transport แยก session ต่อหนึ่งครั้งที่เรียก', async () => {
  const transport = createFakeStripeTransport();
  const p = buildCheckoutSessionParams(base);
  const a = await transport.createCheckoutSession(p);
  const b = await transport.createCheckoutSession(p);
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(transport.calls.length, 2);
});

// ── Live transport: ต้องปิดสวิตช์ไว้ ไม่งั้นไม่ยอมรัน ──────────────────────

test('live transport ต้องปฏิเสธการทำงานถ้าไม่ได้เปิดอย่างชัดเจน', () => {
  assert.throws(
    () => createLiveStripeTransport({ secretKey: 'sk_live_dummy', enabled: false }),
    LiveStripeTransportDisabledError,
    'enabled=false ต้องโยน ไม่ใช่คืน object ที่พร้อมยิง',
  );
});

test('live transport ต้องไม่ยอมรับ secretKey ที่ว่าง แม้เปิดสวิตช์แล้ว', () => {
  assert.throws(
    () => createLiveStripeTransport({ secretKey: '', enabled: true }),
    /secretKey is required/,
  );
});

test('live transport เปิดสวิตช์แล้วสร้างได้ แต่ยังไม่ยิงอะไรจนกว่าจะถูกเรียก', () => {
  const transport = createLiveStripeTransport({ secretKey: 'sk_live_dummy', enabled: true });
  assert.strictEqual(typeof transport.createCheckoutSession, 'function');
});

// ── config: server ต้อง start ได้ตอนไม่มี Stripe ───────────────────────────

test('config ต้องไม่ throw ตอน boot แม้ไม่มีค่า Stripe เลย และสวิตช์ยิงของจริงต้องเป็น false', async () => {
  // config/index.ts ต้องการสองค่านี้ (ไม่งั้น throw ตอน import) — ใส่เฉพาะตอนทดสอบ
  process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef';
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
  // ล้างค่าสวิตช์ทิ้งก่อน import — ถ้า .env ของเครื่องตั้งไว้ เทสต์นี้จะแดง
  // (ซึ่งถูกต้อง: เครื่องที่ตั้งยิงของจริงไว้ควรได้ยืนยันว่าตั้งใจ)
  delete process.env.STRIPE_ENABLED;
  delete process.env.STRIPE_LIVE_ENABLED;

  const { config } = await import('../src/config');
  assert.strictEqual(config.stripe.enabled, false);
  assert.strictEqual(config.stripe.liveEnabled, false, 'ค่า default ต้องไม่ยอมยิง Stripe จริง');
  assert.strictEqual(config.stripe.currency, 'thb');
});
