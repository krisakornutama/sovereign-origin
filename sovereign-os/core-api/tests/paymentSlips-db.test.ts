// tests/paymentSlips-db.test.ts
//
// Payment slips — free-first persistence + manual review on real Postgres.
//
// สิ่งที่เทสนี้ล็อกไว้:
//   - อัปโหลดสลิปจริง (multipart) → row ใน payment_slips + image bytes + sha256
//   - กันสลิปซ้ำ: image hash เดียวกัน และ (provider, transRef) เดียวกัน = 409
//   - list ไม่ส่ง imageData ออกไป; image endpoint ส่ง bytes ต้นฉบับ
//   - review ได้ครั้งเดียว, เปลี่ยนคำตัดสินภายหลัง = 409, และมี audit row
//   - ไฟล์ที่ไม่ใช่รูปจริง = 400 และไม่สร้าง row
//
// Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (ใช้ DB จริงคนละ schema กับ production)
import './setup-env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, multipart, PNG_1X1, type CoreCtx } from './db-harness';
import { makeToken as signToken } from './helpers';

const PNG_ALT = Buffer.concat([PNG_1X1, Buffer.from([0])]);

describe('payment slips — manual review', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let businessId = '';
  let baseUrl = '';
  let close: () => Promise<void>;
  let token = '';
  let slipId = '';
  let outsiderId = '';
  let outsiderToken = '';

  const url = (suffix = '') => `${baseUrl}/api/payments/slips/${businessId}${suffix}`;
  const auth = () => ({ authorization: `Bearer ${token}` });

  async function upload(bytes: Buffer, fields: Record<string, string> = {}) {
    const { headers, body } = multipart(
      { amount: '123.45', provider: 'MANUAL', transRef: 'REF-001', ...fields },
      'file',
      'slip.png',
      'image/png',
      bytes,
    );
    return fetch(url(), { method: 'POST', headers: { ...auth(), ...headers }, body });
  }

  before(async () => {
    ctx = await setupCore();
    const business = await ctx.prisma.business.create({
      data: { name: 'Payment Slip Test Co', ownerId: ctx.userId },
    });
    businessId = business.id;
    token = ctx.makeToken('SUPERADMIN');

    const outsider = await ctx.prisma.user.create({
      data: { username: `slip-outsider-${Date.now()}`, password_hash: 'not-a-real-login', role: 'OPERATOR' },
    });
    outsiderId = outsider.id;
    outsiderToken = signToken('OPERATOR', { userId: outsider.id });

    const router = (await import('../src/modules/payments/payment-slips.routes')).default;
    const server = await ctx.createTestServer((app) => app.use('/api/payments/slips', router));
    baseUrl = server.baseUrl;
    close = server.close;
  });

  after(async () => {
    await ctx.prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    if (outsiderId) await ctx.prisma.user.delete({ where: { id: outsiderId } }).catch(() => {});
    await close?.();
    await teardownCore(ctx);
  });

  test('อัปโหลดสลิปจริง → row + bytes + sha256 (ไม่คืน imageData)', async () => {
    const res = await upload(PNG_1X1);
    const text = await res.text();
    assert.equal(res.status, 201, text.slice(0, 300));
    const body = JSON.parse(text);
    slipId = body.slip.id;
    assert.equal(body.slip.status, 'PENDING');
    assert.equal(body.slip.amountSatang, 12345);
    assert.equal(body.slip.provider, 'MANUAL');
    assert.equal(body.slip.transRef, 'REF-001');
    assert.equal(body.slip.imageData, undefined);

    const row = await ctx.prisma.paymentSlip.findUnique({ where: { id: slipId } });
    assert.ok(row, 'ต้องมี row payment_slips');
    assert.equal(row.businessId, businessId);
    assert.equal(row.status, 'PENDING');
    assert.equal(Buffer.from(row.imageData).toString('hex'), PNG_1X1.toString('hex'));
    assert.match(row.imageSha256, /^[0-9a-f]{64}$/);
    assert.equal(row.imageSize, PNG_1X1.length);
  });

  test('สลิปซ้ำ (รูปเดิม/เลขอ้างอิงเดิม) = 409 และไม่สร้าง row ซ้ำ', async () => {
    const sameImage = await upload(PNG_1X1, { transRef: 'REF-OTHER' });
    assert.equal(sameImage.status, 409);
    const sameRef = await upload(PNG_ALT, { transRef: 'REF-001' });
    assert.equal(sameRef.status, 409);
    const count = await ctx.prisma.paymentSlip.count({ where: { businessId } });
    assert.equal(count, 1);
  });

  test('list ไม่ส่ง imageData และ image endpoint คืน bytes ต้นฉบับ', async () => {
    const list = await fetch(url(), { headers: auth() });
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.slips.length, 1);
    assert.equal(body.slips[0].id, slipId);
    assert.equal(body.slips[0].imageData, undefined);

    const image = await fetch(url(`/${slipId}/image`), { headers: auth() });
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type') ?? '', /^image\/png/);
    assert.equal(Buffer.from(await image.arrayBuffer()).toString('hex'), PNG_1X1.toString('hex'));
  });

  test('review ได้ครั้งเดียว → APPROVED + reviewer + audit; เปลี่ยนคำตัดสิน = 409', async () => {
    const first = await fetch(url(`/${slipId}/review`), {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED', note: 'ยอดตรง' }),
    });
    const text = await first.text();
    assert.equal(first.status, 200, text.slice(0, 300));
    assert.equal(JSON.parse(text).slip.status, 'APPROVED');

    const row = await ctx.prisma.paymentSlip.findUnique({ where: { id: slipId } });
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.reviewedBy, ctx.userId);
    assert.ok(row.reviewedAt);

    const audit = await ctx.prisma.auditLog.count({
      where: { action_type: 'PAYMENT_SLIP_REVIEW', payload: { path: ['slipId'], equals: slipId } },
    });
    assert.equal(audit, 1, 'ต้องมี audit ตอน review 1 ครั้ง');

    const again = await fetch(url(`/${slipId}/review`), {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.equal(again.status, 200, 'คำตัดสินเดิม = idempotent');
    const changed = await fetch(url(`/${slipId}/review`), {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'REJECTED' }),
    });
    assert.equal(changed.status, 409);
  });

  test('คนนอกธุรกิจ (ไม่ใช่สมาชิก) ดู/อัปโหลดสลิปไม่ได้ = 403', async () => {
    const list = await fetch(url(), { headers: { authorization: `Bearer ${outsiderToken}` } });
    assert.equal(list.status, 403);

    const { headers, body } = multipart(
      { amount: '50', provider: 'MANUAL', transRef: 'REF-OUTSIDER' },
      'file',
      'slip.png',
      'image/png',
      Buffer.concat([PNG_1X1, Buffer.from([2])]),
    );
    const post = await fetch(url(), {
      method: 'POST',
      headers: { authorization: `Bearer ${outsiderToken}`, ...headers },
      body,
    });
    assert.equal(post.status, 403);
    assert.equal(await ctx.prisma.paymentSlip.count({ where: { businessId } }), 1);
  });

  test('ไฟล์ที่ไม่ใช่รูปจริง = 400 และไม่สร้าง row', async () => {
    const res = await upload(Buffer.from('not an image'), { transRef: 'REF-BAD' });
    assert.equal(res.status, 400);
    assert.equal(await ctx.prisma.paymentSlip.count({ where: { businessId } }), 1);
  });

  test('businessId ผิดรูปแบบ = 400 (ไม่ให้ Prisma UUID cast กลายเป็น 500)', async () => {
    const res = await fetch(`${baseUrl}/api/payments/slips/not-a-uuid`, { headers: auth() });
    assert.equal(res.status, 400);
  });
});
