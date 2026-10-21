/**
 * เทสต์ "แกนตัดสินสลิป" — คุมกติกาที่เกี่ยวกับเงินโดยตรง
 * เขียนแบบ red-first ได้: ถ้าแก้ `evaluateSlip` ให้รับสลิปยอดไม่ครบ/สลิปซ้ำ/ผู้รับผิด เทสต์นี้แดงทันที
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountTail,
  evaluateSlip,
  fromSatang,
  normalizePayeeName,
  slipKey,
  toSatang,
  type SlipExpectation,
  type SlipFacts,
} from '../src/services/slip-verify.service';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const ORDER_AT = new Date('2026-10-21T11:00:00.000Z');

const baseFacts = (over: Partial<SlipFacts> = {}): SlipFacts => ({
  transRef: 'SLIP-0001',
  amount: 100,
  transDate: new Date('2026-10-21T11:30:00.000Z'),
  receiverName: 'สมชาย ใจดี',
  receiverAccountTail: '6789',
  provider: 'slipok',
  ...over,
});

const baseExpect = (over: Partial<SlipExpectation> = {}): SlipExpectation => ({
  amountDue: 100,
  payeeName: 'สมชาย ใจดี',
  payeeAccountTail: '6789',
  notBefore: ORDER_AT,
  now: NOW,
  ...over,
});

describe('ยอดเงิน — เทียบเป็นสตางค์', () => {
  test('ยอดตรงพอดี = รับ', () => {
    const d = evaluateSlip(baseFacts(), baseExpect());
    assert.equal(d.accepted, true);
    assert.equal(d.status, 'ACCEPTED');
    assert.deepEqual(d.reasons, []);
    assert.equal(d.matchedAmount, 100);
  });

  test('ต่างไม่เกิน 1 สตางค์ = รับ (เผื่อปัดเศษธนาคาร)', () => {
    const d = evaluateSlip(baseFacts({ amount: 99.99 }), baseExpect());
    assert.equal(d.accepted, true, 'ต่าง 1 สตางค์ต้องไม่ถูกปฏิเสธ');
  });

  test('ขาด 2 สตางค์ = ปฏิเสธ UNDERPAID', () => {
    const d = evaluateSlip(baseFacts({ amount: 99.98 }), baseExpect());
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'AMOUNT_MISMATCH');
    assert.ok(d.reasons.includes('UNDERPAID'));
  });

  test('โอนเกิน = ปฏิเสธ OVERPAID (ให้คนตัดสิน ไม่รับเงียบ ๆ)', () => {
    const d = evaluateSlip(baseFacts({ amount: 150 }), baseExpect());
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'AMOUNT_MISMATCH');
    assert.ok(d.reasons.includes('OVERPAID'));
  });

  test('เศษลอย 0.1 + 0.2 ต้องไม่ทำให้ยอด 0.30 ถูกปฏิเสธ', () => {
    const d = evaluateSlip(
      baseFacts({ amount: 0.1 + 0.2 }),
      baseExpect({ amountDue: 0.3, payeeName: null, payeeAccountTail: null })
    );
    assert.equal(d.accepted, true);
    assert.equal(d.matchedAmount, 0.3);
  });
});

describe('ผู้รับเงิน', () => {
  test('ชื่อต่างกันแค่คำนำหน้า/ช่องว่าง = ยังรับ', () => {
    const d = evaluateSlip(
      baseFacts({ receiverName: 'นางสาวสมชาย  ใจดี' }),
      baseExpect({ payeeName: 'สมชาย ใจดี' })
    );
    assert.equal(d.accepted, true);
  });

  test('ชื่อบริษัทตัด "บริษัท/จำกัด" แล้วตรงกัน = รับ', () => {
    const d = evaluateSlip(
      baseFacts({ receiverName: 'บจก. เอบีซี เทรดดิ้ง จำกัด', receiverAccountTail: '6789' }),
      baseExpect({ payeeName: 'เอบีซี เทรดดิ้ง', payeeAccountTail: '6789' })
    );
    assert.equal(d.accepted, true);
  });

  test('เลขบัญชีผู้รับผิด = ปฏิเสธ แม้ชื่อจะตรง', () => {
    const d = evaluateSlip(baseFacts({ receiverAccountTail: '1111' }), baseExpect());
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'PAYEE_MISMATCH');
    assert.ok(d.reasons.includes('PAYEE_ACCOUNT_MISMATCH'));
  });

  test('ชื่อผู้รับผิด = ปฏิเสธ', () => {
    const d = evaluateSlip(baseFacts({ receiverName: 'สมหญิง ใจร้าย' }), baseExpect());
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'PAYEE_MISMATCH');
    assert.ok(d.reasons.includes('PAYEE_NAME_MISMATCH'));
  });

  test('ร้านตั้งชื่อ/บัญชีไว้ แต่สลิปไม่มีข้อมูลผู้รับ = PAYEE_UNVERIFIED (ให้คนดู)', () => {
    const d = evaluateSlip(
      baseFacts({ receiverName: null, receiverAccountTail: null }),
      baseExpect()
    );
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'PAYEE_UNVERIFIED');
  });

  test('ร้านไม่ได้ตั้งชื่อ/บัญชี = ไม่เอามาติ้ง', () => {
    const d = evaluateSlip(baseFacts({ receiverName: null, receiverAccountTail: null }), baseExpect({ payeeName: null, payeeAccountTail: null }));
    assert.equal(d.accepted, true);
  });
});

describe('กันสลิปซ้ำ + เวลา', () => {
  test('transRef ที่เคยใช้แล้ว = DUPLICATE', () => {
    const d = evaluateSlip(baseFacts(), baseExpect({ seenTransRefs: new Set(['SLIP-0001']) }));
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'DUPLICATE');
  });

  test('สลิปซ้ำ + ยอดขาด = ยังรายงาน DUPLICATE (พร้อมเหตุผล UNDERPAID)', () => {
    const d = evaluateSlip(
      baseFacts({ amount: 50 }),
      baseExpect({ seenTransRefs: ['SLIP-0001'] })
    );
    assert.equal(d.status, 'DUPLICATE');
    assert.ok(d.reasons.includes('UNDERPAID'), 'ต้องเห็นทั้งสองปัญหา ไม่ใช่หยุดที่ข้อแรก');
  });

  test('สลิปเก่ากว่าออเดอร์ = STALE', () => {
    const d = evaluateSlip(
      baseFacts({ transDate: new Date('2026-10-21T09:00:00.000Z') }),
      baseExpect({ notBefore: ORDER_AT })
    );
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'STALE');
  });

  test('เวลาสลิปในอนาคตเกิน clock skew = INVALID', () => {
    const d = evaluateSlip(
      baseFacts({ transDate: new Date('2026-10-21T12:30:00.000Z') }),
      baseExpect({ maxClockSkewMs: 60_000 })
    );
    assert.equal(d.accepted, false);
    assert.equal(d.status, 'INVALID');
    assert.ok(d.reasons.includes('FUTURE_DATED'));
  });
});

describe('ข้อมูลเสีย / กุญแจกันซ้ำ', () => {
  test('ไม่มี transRef = INVALID (กันสลิปซ้ำไม่ได้)', () => {
    const d = evaluateSlip(baseFacts({ transRef: '' }), baseExpect());
    assert.equal(d.status, 'INVALID');
    assert.ok(d.reasons.includes('MISSING_TRANS_REF'));
  });

  test('ยอดติดลบ/ศูนย์/NaN = INVALID', () => {
    for (const amount of [0, -5, Number.NaN]) {
      const d = evaluateSlip(baseFacts({ amount }), baseExpect({ payeeName: null, payeeAccountTail: null }));
      assert.equal(d.status, 'INVALID', `amount=${amount} ต้องถูกปฏิเสธ`);
      assert.ok(d.reasons.includes('INVALID_AMOUNT'));
    }
  });

  test('วันที่ใช้ไม่ได้ = INVALID', () => {
    const d = evaluateSlip(baseFacts({ transDate: 'ไม่ใช่วันที่' }), baseExpect({ payeeName: null, payeeAccountTail: null }));
    assert.equal(d.status, 'INVALID');
    assert.ok(d.reasons.includes('INVALID_DATE'));
  });

  test('slipKey รวม provider + transRef และคืน null เมื่อไม่มีเลขอ้างอิง', () => {
    assert.equal(slipKey({ provider: 'SlipOK', transRef: ' ABC ' }), 'slipok:ABC');
    assert.equal(slipKey({ provider: 'slipok', transRef: '   ' }), null);
  });
});

describe('ตัวช่วยแปลงค่า', () => {
  test('toSatang/fromSatang ไปกลับได้', () => {
    assert.equal(toSatang(100.1), 10010);
    assert.equal(fromSatang(10010), 100.1);
  });

  test('normalizePayeeName ตัดคำนำหน้า/คำลงท้าย/ช่องว่าง/จุด', () => {
    assert.equal(normalizePayeeName('น.ส. สมชาย ใจดี'), 'สมชายใจดี');
    assert.equal(normalizePayeeName('บริษัท เอบีซี จำกัด'), 'เอบีซี');
    assert.equal(normalizePayeeName('บมจ. เอบีซี จำกัด (มหาชน)'), 'เอบีซี');
  });

  test('accountTail เอา 4 หลักท้าย ทนรูปแบบมีขีด', () => {
    assert.equal(accountTail('123-4-56789-0'), '7890');
    assert.equal(accountTail('6789'), '6789');
    assert.equal(accountTail(''), '');
  });
});
