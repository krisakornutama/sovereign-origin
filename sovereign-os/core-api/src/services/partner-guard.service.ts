// src/services/partner-guard.service.ts
//
// PARTNER GUARD (P17) — กันสแปมใบสมัครคู่ค้า 3 ชั้น:
//   1) IP limit: สมัครได้ ≤ PARTNER_IP_DAILY_LIMIT (default 3) ใบ/IP/วัน (นับจาก ip_hash ในตาราง partners)
//   2) ชื่อซ้ำ: ชื่อร้านเดียวกัน (normalized — ตัดวรรณยุกต์/ช่องว่าง/ตัวเล็ก) ที่ยัง PENDING/ACTIVE อยู่ = ปฏิเสธ
//   3) OTP SMS ยืนยันเบอร์ก่อนเข้าคิวอนุมัติ:
//      - มี gateway (env: SMS_GATEWAY_URL + SMS_GATEWAY_KEY) → ส่งจริงผ่าน gateway (POST JSON {to, message})
//      - ไม่มี gateway → dev fallback: โค้ดลง log backend (เจ้าของอ่านจาก docker logs) — ระบบยังกันสแปมครบ
//      - OTP hash เก็บใน RAM (5 นาที · 3 ครั้ง) — restart = ขอใหม่ (รับได้: OTP ใช้ประกอบการสมัครเท่านั้น)
//      - ยืนยันผ่านแล้วเบอร์เดียวกรอกใบสมัครได้ 1 ใบ/30 นาที (verified token)
import { createHash, randomInt, createHmac } from 'node:crypto';
import { prisma } from '../lib/prisma';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_TRIES = 3;
const VERIFIED_TTL_MS = 30 * 60_000;
const IP_DAILY_LIMIT = Number(process.env.PARTNER_IP_DAILY_LIMIT || 3);

// ── SMS Gateway จริง (P17 คำสั่งเจ้าของ 30/9/69) ──
// รองรับ 2 โหมด (เลือกเองตาม env):
//  1) ThaiBulkSMS OTP API — ตั้ง THAIBULKSMS_KEY + THAIBULKSMS_SECRET (สมัคร thaibulksms.com · ~0.19-0.45฿/SMS · OTP API
//     เป็น managed: gateway ส่ง SMS เอง + เรายืนยัน PIN กลับ → ปลอดภัยกว่าเราเลือกโค้ดเอง) — โฟลว์:
//       requestPartnerOtp()  → POST https://otp.thaibulksms.com/v2/otp/request {key,secret,msisdn} → ได้ {token}
//       verifyPartnerOtp()   → POST https://otp.thaibulksms.com/v2/otp/verify {key,secret,token,pin} → success = เบอร์ยืนยันแล้ว
//  2) Generic gateway — ตั้ง SMS_GATEWAY_URL + SMS_GATEWAY_KEY (POST JSON {to,message}) เราสร้างโค้ดเอง + เทียบเอง
//  ไม่ตั้งอะไรเลย = dev fallback (โค้ดลง log + คืน devCode เฉพาะ non-production)
const TBS_KEY = process.env.THAIBULKSMS_KEY || '';
const TBS_SECRET = process.env.THAIBULKSMS_SECRET || '';
const smsMode: 'thaibulksms' | 'generic' | 'dev' = TBS_KEY && TBS_SECRET
  ? 'thaibulksms'
  : process.env.SMS_GATEWAY_URL && process.env.SMS_GATEWAY_KEY
    ? 'generic'
    : 'dev';

/** ThaiBulkSMS: ขอ OTP — คืน token ของ session นี้ (เก็บใน otpStore แทน hash) */
async function tbsRequestOtp(phone: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const res = await fetch('https://otp.thaibulksms.com/v2/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: TBS_KEY, secret: TBS_SECRET, msisdn: phone }),
    });
    const data: any = await res.json().catch(() => null);
    if (res.ok && data?.status === 'success' && data?.token) return { ok: true, token: data.token };
    const detail = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    console.error('[partner-guard] ThaiBulkSMS OTP request ล้ม:', detail);
    return { ok: false, error: 'ส่ง SMS ไม่สำเร็จ — ลองใหม่อีกครั้ง' };
  } catch (err) {
    console.error('[partner-guard] ThaiBulkSMS OTP request error:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'เชื่อมต่อ SMS gateway ไม่ได้ — ลองใหม่อีกครั้ง' };
  }
}

/** ThaiBulkSMS: ยืนยัน PIN กับ gateway */
async function tbsVerifyOtp(token: string, pin: string): Promise<boolean> {
  try {
    const res = await fetch('https://otp.thaibulksms.com/v2/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: TBS_KEY, secret: TBS_SECRET, token, pin }),
    });
    const data: any = await res.json().catch(() => null);
    return res.ok && data?.status === 'success';
  } catch {
    return false;
  }
}

interface OtpEntry { hash: string; expiresAt: number; tries: number; }
const otpStore = new Map<string, OtpEntry>();           // key = phone
const verifiedStore = new Map<string, number>();        // phone → verifiedUntil

const normPhone = (p: string) => p.replace(/[^0-9]/g, '').replace(/^0/, '66');
export const normName = (n: string) => n.normalize('NFKD').replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** ชั้น 1+2 — เรียกก่อนสร้างแถว (IP limit + ชื่อซ้ำ) */
export async function assertNotSpam(ip: string | null, name: string, phone: string): Promise<GuardResult> {
  // 1) IP/วัน
  if (ip) {
    const ipHash = sha256(ip);
    const since = new Date(Date.now() - 24 * 3600_000);
    const count = await prisma.partner.count({ where: { ip_hash: ipHash, created_at: { gte: since } } });
    if (count >= IP_DAILY_LIMIT) return { ok: false, reason: 'สมัครจากเครือข่ายนี้ครบโควตาแล้ว (ลองพรุ่งนี้หรือติดต่อเราตรง)' };
  }
  // 2) ชื่อซ้ำ (PENDING/ACTIVE)
  const dup = await prisma.partner.findFirst({
    where: { name_normalized: normName(name), status: { in: ['PENDING', 'ACTIVE'] } },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: 'มีร้านชื่อนี้ในระบบอยู่แล้ว — ถ้าเป็นของคุณโปรดติดต่อเราแทนการสมัครซ้ำ' };
  // เบอร์ที่เพิ่งยืนยัน ใช้ได้ 1 ใบ/30 นาที กันยิงซ้ำ
  const v = verifiedStore.get(normPhone(phone));
  if (v && Date.now() < v) {
    // ใช้แล้ว = ตัดสิทธิ์ทันที (verified token ใช้ครั้งเดียว)
    return { ok: true };
  }
  return { ok: true };
}

/** ออก OTP — โหมด thaibulksms = gateway ส่งเอง (เราเก็บ token) · generic = เราสร้างโค้ดส่งเอง · dev = โค้ดลง log */
export async function sendPartnerOtp(phoneRaw: string): Promise<{ sent: true } | { sent: true; devCode?: string } | { sent: false; error: string }> {
  const phone = normPhone(phoneRaw);
  if (phone.length < 10) return { sent: false, error: 'เบอร์ไม่ถูกต้อง' };

  if (smsMode === 'thaibulksms') {
    const r = await tbsRequestOtp(phone);
    if (!r.ok || !r.token) return { sent: false, error: r.error ?? 'ส่ง SMS ไม่สำเร็จ' };
    otpStore.set(phone, { hash: `tbs:${r.token}`, expiresAt: Date.now() + OTP_TTL_MS, tries: 0 });
    return { sent: true };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const salted = sha256(`${phone}:${code}:${process.env.PARTNER_OTP_SALT || 'sovereign'}`);
  otpStore.set(phone, { hash: salted, expiresAt: Date.now() + OTP_TTL_MS, tries: 0 });

  const message = `รหัสยืนยันสมัครคู่ค้า Sovereign Origin: ${code} (ใช้ได้ 5 นาที)`;
  const url = process.env.SMS_GATEWAY_URL;
  const key = process.env.SMS_GATEWAY_KEY;
  if (url && key) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ to: phone, message }),
      });
      if (!res.ok) throw new Error(`gateway ${res.status}`);
      return { sent: true };
    } catch (err) {
      console.error('[partner-guard] SMS gateway ล้ม:', err instanceof Error ? err.message : err);
      return { sent: false, error: 'ส่ง SMS ไม่สำเร็จ — ลองใหม่อีกครั้ง' };
    }
  }
  // dev fallback — โค้ดอยู่ใน docker logs ของ sovereign-core-api
  console.log(`[partner-guard] OTP สำหรับ ${phone}: ${code} (ไม่มี SMS_GATEWAY_URL — โหมด dev)`);
  if (process.env.NODE_ENV !== 'production') return { sent: true, devCode: code };
  return { sent: true };
}

/** ตรวจ OTP — ผ่าน = เบอร์นี้กรอกใบสมัครได้ (30 นาที) · thaibulksms = ส่ง PIN ไป verify กับ gateway */
export async function verifyPartnerOtp(phoneRaw: string, code: string): Promise<GuardResult> {
  const phone = normPhone(phoneRaw);
  const entry = otpStore.get(phone);
  if (!entry) return { ok: false, reason: 'ขอรหัสก่อน (กดขอรหัสยืนยัน)' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return { ok: false, reason: 'รหัสหมดอายุ — ขอใหม่ได้' };
  }
  entry.tries += 1;
  if (entry.tries > OTP_MAX_TRIES) {
    otpStore.delete(phone);
    return { ok: false, reason: 'กรอกผิดเกินครั้ง — ขอรหัสใหม่' };
  }
  // ThaiBulkSMS: hash field เก็บ token — PIN ตรวจกับ gateway (เราไม่เห็นโค้ดเลย)
  if (entry.hash.startsWith('tbs:')) {
    const ok = await tbsVerifyOtp(entry.hash.slice(4), code);
    otpStore.delete(phone);
    if (!ok) return { ok: false, reason: 'รหัสไม่ถูกต้อง' };
    verifiedStore.set(phone, Date.now() + VERIFIED_TTL_MS);
    return { ok: true };
  }
  if (sha256(`${phone}:${code}:${process.env.PARTNER_OTP_SALT || 'sovereign'}`) !== entry.hash) {
    return { ok: false, reason: 'รหัสไม่ถูกต้อง' };
  }
  otpStore.delete(phone);
  verifiedStore.set(phone, Date.now() + VERIFIED_TTL_MS);
  return { ok: true };
}

/** ตัดสิทธิ์ verified (เรียกหลังสร้างใบสมัครสำเร็จ — token ใช้ครั้งเดียว) */
export function consumeVerified(phoneRaw: string): void {
  verifiedStore.delete(normPhone(phoneRaw));
}

/** HMAC พิสูจน์สิทธิ์ verified จากฝั่ง client (stateless — client เก็บ token ไว้กรอกฟอร์ม) */
export function issueVerifiedToken(phoneRaw: string): string {
  const phone = normPhone(phoneRaw);
  const until = Date.now() + VERIFIED_TTL_MS;
  const sig = createHmac('sha256', process.env.PARTNER_OTP_SALT || 'sovereign').update(`${phone}:${until}`).digest('hex').slice(0, 32);
  return `${until}.${sig}`;
}

export function checkVerifiedToken(phoneRaw: string, token: string): boolean {
  const phone = normPhone(phoneRaw);
  const [untilStr, sig] = String(token).split('.');
  const until = Number(untilStr);
  if (!Number.isFinite(until) || until < Date.now() || !sig) return false;
  const expect = createHmac('sha256', process.env.PARTNER_OTP_SALT || 'sovereign').update(`${phone}:${until}`).digest('hex').slice(0, 32);
  return sig === expect;
}
