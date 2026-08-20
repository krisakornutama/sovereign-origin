// tests/promptpay.test.ts — PromptPay QR payload builder (pure, ไม่ต่อ DB)
// ครอบ: normalize เป้า (โทรศัพท์/บัตร), รูปแบบ payload ตาม EMVCo,
//       CRC16 ตรวจซ้ำแบบอิสระ (กัน regression), static vs dynamic
import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildPromptPayPayload,
  crc16Ccitt,
  formatThbAmount,
  normalizePromptPayTarget,
  PROMPTPAY_AID,
} from '../src/services/promptpay';

// ── CRC16-CCITT: implementation อิสระ (bit-by-bit ต่างโครงสร้างจากต้นทาง) ──
function crcIndependent(data: string): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 7; bit >= 0; bit--) {
      const msb = (crc >>> 15) & 1;
      crc = ((crc << 1) & 0xffff) ^ (msb ? 0x1021 : 0);
    }
  }
  return crc & 0xffff;
}

test('crc16Ccitt — ตรงกับ implementation อิสระ (หลาย payload)', () => {
  for (const data of ['000201010212', 'hello', '6304', 'A000000677010112', '0002010102112937A00000067701011203XXXX']) {
    assert.strictEqual(crc16Ccitt(data), crcIndependent(data), `CRC mismatch: ${data}`);
  }
});

test('normalizePromptPayTarget — โทรศัพท์ 08x → 66 + 9 หลัก', () => {
  assert.strictEqual(normalizePromptPayTarget('0812345678'), '66812345678');
  assert.strictEqual(normalizePromptPayTarget('08-1234-5678'), '66812345678'); // ตัวคั่นหลุด
});

test('normalizePromptPayTarget — เลขบัตรประชาชน 13 หลัก ผ่านตรง', () => {
  assert.strictEqual(normalizePromptPayTarget('1234567890123'), '1234567890123');
});

test('normalizePromptPayTarget — คืน null เมื่อไม่รู้จัก', () => {
  assert.strictEqual(normalizePromptPayTarget('1223'), null);
  assert.strictEqual(normalizePromptPayTarget(''), null);
  assert.strictEqual(normalizePromptPayTarget(null as any), null);
  assert.strictEqual(normalizePromptPayTarget('081234567'), null); // 9 หลัก ไม่ใช่โทรศัพท์มาตรฐาน
});

test('formatThbAmount — 2 ทศนิยม, ตัด .00, null/0/ไม่ใช่ตัวเลข → ว่าง', () => {
  assert.strictEqual(formatThbAmount(100), '100');
  assert.strictEqual(formatThbAmount(100.5), '100.50');
  assert.strictEqual(formatThbAmount(100.555), '100.56'); // ปัด 2 ทศนิยม
  assert.strictEqual(formatThbAmount(0), '');
  assert.strictEqual(formatThbAmount(NaN), '');
  assert.strictEqual(formatThbAmount(-5), '');
});

test('buildPromptPayPayload — โครงสร้าง EMVCo ครบ + CRC ตรง tail', () => {
  const p = buildPromptPayPayload({ target: '0812345678', amountThb: 150.5, name: 'TEST SHOP' });
  assert.ok(p);
  // payload เริ่มต้น: 00 01, dynamic QR (01=12) → "000201" + "010212"
  assert.ok(p.startsWith('000201010212'));
  // มี AID PromptPay
  assert.ok(p.includes('0216' + PROMPTPAY_AID));
  // เป้า normalized 66XXXXXXXXX (tag 03 + len 11)
  assert.ok(p.includes('031166812345678'));
  // สกุลเงิน THB + ยอดบาท 2 ทศนิยม
  assert.ok(p.includes('03764'));
  // tag 54 + ยอดบาท (150.50 → len 6 → "5406")
  assert.ok(p.includes('5406150.50'));
  // CRC: 4 ตัวท้าย = crc ของส่วนที่เหลือ
  const raw = p.slice(0, -4);
  assert.strictEqual(p.slice(-4), crc16Ccitt(raw).toString(16).toUpperCase().padStart(4, '0'));
  // tag 63 ประกบก่อน CRC
  assert.ok(raw.endsWith('6304'));
});

test('buildPromptPayPayload — static QR (ไร้ยอด) เมื่อ amountThb ไม่ใส่', () => {
  const p = buildPromptPayPayload({ target: '1234567890123' });
  assert.ok(p);
  assert.ok(p.startsWith('000201010211')); // static = 11
  assert.ok(!p.includes('1254') && !p.includes('0754')); // ไม่มี tag 54
});

test('buildPromptPayPayload — target ไม่ถูกต้อง → null (ไม่สร้าง garbage payload)', () => {
  assert.strictEqual(buildPromptPayPayload({ target: 'Bob' }), null);
});

test('buildPromptPayPayload — ชื่อโดนตัด 25 ตัว / city 15 / postal 10', () => {
  const p = buildPromptPayPayload({ target: '0812345678', amountThb: 1, name: 'X'.repeat(40), city: 'Y'.repeat(20), postal: 'Z'.repeat(15) });
  assert.ok(p);
  const nameLen = p.length - p.indexOf('59') - 2;
  const tag59 = p.match(/59(\d{2})/);
  assert.ok(tag59);
  assert.ok(Number(tag59[1]) <= 25);
  const tag60 = p.match(/60(\d{2})/);
  assert.ok(tag60 && Number(tag60[1]) <= 15);
  const tag61 = p.match(/61(\d{2})/);
  assert.ok(tag61 && Number(tag61[1]) <= 10);
});