// ────────────────────────────────────────────────────────────────────────────
// การตัดสินใจว่า "delivery นี้จะถูก apply ไหม" — pure function ตัวเดียวของโมดูล
//
// เทสต์ชุดนี้ตั้งใจไม่มี HTTP, ไม่มี DB, ไม่มี env เลย: ถ้าเรียกได้ด้วย object
// ธรรมดา ๆ แปลว่าตรรกะนี้แยกจากชั้นอื่นจริง (ไม่ใช่แค่ที่ชื่อว่า pure)
// ตัวที่พิสูจน์คือเรียกได้โดยไม่ต้องเปิดอะไรมาก่อน — ถ้ามันไปแตะ config/DB
// ชุดนี้จะรันไม่ผ่านตั้งแต่แรก
//
// ลำดับการตรวจสำคัญมาก: branch แรกที่ match จะเป็นคำตอบ การสลับลำดับ
// จะเปลี่ยน reason ที่ลูกค้าเห็น → ทึ้งทุกกรณีที่เขียนไว้ด้านล่าง
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import { decideCompletion } from '../src/services/payment-verification.service';

const completed = (obj: Record<string, unknown>) => ({
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_x', client_reference_id: 'XFR-1', amount_total: 25000, currency: 'thb', ...obj } },
});
const order = (over: Record<string, unknown> = {}) =>
  ({ ref_code: 'XFR-1', status: 'PENDING', amount_thb: 250, ...over }) as any;

/** ย่อ: ตอบ not_applied ตัวไหน */
const reasonOf = (d: any) => (d.kind === 'not_applied' ? d.reason : `unexpected:${d.kind}`);

test('event ที่ไม่ใช่ checkout.session.completed → ไม่ apply', () => {
  const d = decideCompletion({ type: 'payment_intent.succeeded', data: {} }, order());
  assert.strictEqual(d.kind, 'not_applied');
  assert.strictEqual(reasonOf(d), 'unsupported_event_type');
});

test('ไม่มี client_reference_id (หรือเป็นช่องว่าง) → ไม่ apply', () => {
  for (const bad of ['', '   ', undefined, null]) {
    const d = decideCompletion(completed({ client_reference_id: bad }), order());
    assert.strictEqual(reasonOf(d), 'missing_client_reference_id', `ค่า ${JSON.stringify(bad)}`);
  }
});

test('ไม่พบ order → ไม่ apply (ห้ามเดาว่าเป็น order ที่หายไป)', () => {
  const d = decideCompletion(completed({}), null);
  assert.strictEqual(reasonOf(d), 'order_not_found');
});

test('สกุลเงินไม่ใช่ thb → ไม่ apply', () => {
  const d = decideCompletion(completed({ currency: 'usd' }), order());
  assert.strictEqual(reasonOf(d), 'currency_mismatch');
});

test('order ไม่มียอดบาทที่ใช้ได้ → ไม่ apply', () => {
  for (const bad of [null, 0, -5, Number.NaN]) {
    const d = decideCompletion(completed({}), order({ amount_thb: bad }));
    assert.strictEqual(reasonOf(d), 'order_amount_unusable', `amount_thb = ${bad}`);
  }
});

test('ยอดไม่ตรง → ไม่ apply และบอกตัวเลขทั้งสองฝั่ง', () => {
  const d: any = decideCompletion(completed({ amount_total: 1 }), order());
  assert.strictEqual(d.kind, 'not_applied');
  assert.strictEqual(d.reason, 'amount_mismatch');
  assert.strictEqual(d.detail.expectedSatang, 25000);
  assert.strictEqual(d.detail.receivedSatang, 1);
});

test('ครบทุกเงื่อนไข → apply พร้อม refCode/sessionId/ยอดที่คาดไว้', () => {
  const d: any = decideCompletion(completed({}), order());
  assert.strictEqual(d.kind, 'apply');
  assert.strictEqual(d.refCode, 'XFR-1');
  assert.strictEqual(d.sessionId, 'cs_x');
  assert.strictEqual(d.expectedSatang, 25000);
});

test('ทุกเส้นทางที่ไม่ apply ต้องมีข้อความอธิบาย (ไม่มีเคสไหน error ไม่มีข้อความ)', () => {
  const cases = [
    [{ type: 'x', data: {} }, order()],
    [completed({ client_reference_id: '  ' }), order()],
    [completed({}), null],
    [completed({ currency: 'usd' }), order()],
    [completed({}), order({ amount_thb: 0 })],
    [completed({ amount_total: 1 }), order()],
  ] as const;
  for (const [event, ord] of cases) {
    const d: any = decideCompletion(event as any, ord as any);
    assert.strictEqual(d.kind, 'not_applied');
    assert.ok(typeof d.message === 'string' && d.message.length > 10, 'ต้องมีข้อความที่อ่านรู้เรื่อง');
  }
});

test('refCode ต้องถูก trim — order เก็บ key แบบไม่มีช่องว่าง', () => {
  const d: any = decideCompletion(completed({ client_reference_id: '  XFR-TRIM  ' }), order());
  assert.strictEqual(d.kind, 'apply');
  assert.strictEqual(d.refCode, 'XFR-TRIM');
});