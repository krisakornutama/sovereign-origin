// ─────────────────────────────────────────────────────────────
// PromptPay QR payload builder — pure functions (ไม่พึ่ง lib, test ได้ง่าย)
// ตาม EMVCo Merchant-Presented QR + Thai PromptPay (AID A000000677010112)
//  - dynamic QR (tag 01 = 12) พร้อมยอดเงินบาท (tag 54)
//  - เป้า: โทรศัพท์ 08x… → 66 ตามด้วยเลขหลัง 0 ตัวแรก / เลขบัตรประชาชน 13 หลัก
//  - CRC16-CCITT (poly 0x1021, init 0xFFFF) tag 63
// ─────────────────────────────────────────────────────────────
export const PROMPTPAY_AID = 'A000000677010112';

/** ตัวเลข 2 หลักของความยาว (EMVCo: id + len + value, len = 2 หลัก) */
function encode(id: string, value: string): string {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

/** CRC16-CCITT (XMODEM: poly 0x1021, init 0xFFFF) — ใช้กับ payload + "6304" */
export function crc16Ccitt(data: string): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * ปรับเป้า PromptPay ให้เป็นรูปแบบมาตรฐาน
 *  - โทรศัพท์ 10 หลักขึ้นต้น 0 → 66 + 9 หลัก (66XXXXXXXXX)
 *  - เลขบัตรประชาชน 13 หลัก → ตามเดิม
 *  - คืน null ถ้าไม่รู้จัก (กัน payload ผิดพลาด)
 */
export function normalizePromptPayTarget(target: string): string | null {
  const digits = String(target || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return '66' + digits.slice(1);
  if (digits.length === 13) return digits;
  return null;
}

/** ยอดบาทสำหรับ tag 54 — 2 ทศนิยม ไม่มี trailing zero ถ้าเต็มบาท */
export function formatThbAmount(amountThb: number): string {
  const n = Number(amountThb);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
}

export interface PromptPayOptions {
  /** เบอร์มือถือ (08XXXXXXXX) หรือเลขบัตรประชาชน 13 หลัก */
  target: string;
  /** ยอดบาท — 0/ไม่ระบุ → static QR ไร้ยอด */
  amountThb?: number;
  /** ชื่อร้านค้า/บัญชี (สูงสุด 25 ตัวอักษร) */
  name?: string;
  city?: string;
  postal?: string;
}

/**
 * สร้าง EMVCo payload เต็ม (รวม CRC tag 63)
 * คืน null เมื่อ target ไม่ถูกต้อง
 */
export function buildPromptPayPayload(opts: PromptPayOptions): string | null {
  const target = normalizePromptPayTarget(opts.target);
  if (!target) return null;

  const merchantAccount = encode('02', PROMPTPAY_AID) + encode('03', target); // เบอร์มือถือ/เลขบัตร → tag 29
  const amount = formatThbAmount(opts.amountThb ?? 0);

  const withoutCrc =
    encode('00', '01') + // Payload Format Indicator
    encode('01', amount ? '12' : '11') + // 12 = dynamic (มียอด) | 11 = static
    encode('29', merchantAccount) + // Merchant Account Information
    encode('52', '0000') + // Merchant Category Code (ไม่ระบุ)
    encode('53', '764') + // Currency = THB
    (amount ? encode('54', amount) : '') + // ยอดบาท (dynamic เท่านั้น)
    encode('58', 'TH') + // ประเทศ
    encode('59', (opts.name || 'SOVEREIGN').slice(0, 25)) + // ชื่อผู้รับ
    encode('60', (opts.city || 'BANGKOK').slice(0, 15)) +
    encode('61', (opts.postal || '10100').slice(0, 10));

  return withoutCrc + '6304' + crc16Ccitt(withoutCrc + '6304').toString(16).toUpperCase().padStart(4, '0');
}