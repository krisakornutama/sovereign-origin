// src/services/orchestrator-alert-phone.service.ts
//
// ที่เก็บเบอร์โทรของ "ชั้น call" ใน Agent Orchestration
//
// ปัญหาที่ service นี้แก้: notifyJobFinished/notifyJobNeedsApproval รับพารามิเตอร์ callTo
// แต่ไม่มีที่ไหนในระบบส่งค่านี้ให้เลย ⇒ เปิด CALL_PROVIDER=bland แล้วก็โทรไม่ออก
// เพราะไม่มีเบอร์ให้โทร (ผู้ใช้เปิดสวิตช์เห็นว่า "พร้อม" แต่กดแล้วไม่มีอะไรเกิดขึ้น)
//
// หลักการ (เหมือน telegram-credentials.service ตามธรรมเนียมบ้าน):
//   · เก็บใน system_settings ซึ่งเป็น sharedTable อยู่แล้ว ⇒ ไม่ต้องแตะ schema / ไม่ต้อง migration
//   · db override ชนะ env เหมือนกันทั้งบ้าน
//   · เบอร์คือ PII ⇒ เข้ารหัส enc:v1: ก่อนลง DB เหมือน telegram.botToken (ไม่เก็บ plaintext)
//   · ต้องเป็น E.164 เท่านั้น (กันยิงผิดปลายทาง) — validate ตอนบันทึก ไม่ใช่ตอนโทร
//   · ทุกทางล้มเหลว = คืน null ไม่ throw (ชั้นแจ้งเตือนต้องพังเงียบ ๆ ได้)
import { prisma } from '../lib/prisma';
import { encryptField, decryptField } from './field-crypto.service';
import { isDialableNumber } from './caller.service';

/** key ใน system_settings — เจ้าของเดียวกับ telegram.* ในไฟล์เดียวกัน */
export const ALERT_PHONE_KEY = 'orchestrator.callPhone';

// อ่าน env สดตอนเรียกใช้ (ไม่ capture ตอน module load) — เทสต์จำลอง "ไม่มีเบอร์" ได้
const envPhone = () => process.env.CALLER_ALERT_PHONE || '';

// cache ระยะสั้น (5 วิ) เหมือน telegram credentials — แจ้งเตือนตอนจบงานถี่ ไม่ต้องดึง DB ทุกครั้ง
let cache: { phone: string | null } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

/** ตัดช่องว่างรอบ ๆ — ไม่แปลงรูปแบบอื่น (0xx ต้องให้ผู้ใช้พิมพ์เป็น +66 เอง) */
export function normalizeAlertPhone(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  return isDialableNumber(v) ? v : null;
}

/**
 * เบอร์ที่จะโทร — db override ชนะ env
 * คืน null เมื่อไม่มี/อ่านไม่ได้ (ชั้น call ต้องข้ามเป็น no-op ไม่ใช่ error)
 */
export async function getAlertPhone(): Promise<string | null> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache.phone;
  let phone: string | null = null;
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: ALERT_PHONE_KEY } });
    const fromDb = row ? decryptField(row.value).trim() : '';
    phone = normalizeAlertPhone(fromDb) ?? normalizeAlertPhone(envPhone());
  } catch (err) {
    // DB ล้ม = ยังโทรไม่ได้ แต่ห้ามทำให้งานที่เพิ่งจบกลายเป็น error
    console.error('[orchestrator-alert-phone] อ่านเบอร์โทรไม่สำเร็จ:', err instanceof Error ? err.message : err);
    phone = normalizeAlertPhone(envPhone());
  }
  cache = { phone };
  cacheTime = now;
  return phone;
}

/** ตั้งเบอร์โทรผ่าน UI — บังคับ E.164 ก่อน (ไม่งั้นไม่เขียนลง DB แม้แต่ครั้งเดียว) */
export async function setAlertPhone(raw: unknown): Promise<string> {
  const phone = normalizeAlertPhone(raw);
  if (!phone) {
    throw new Error('เบอร์ต้องอยู่ในรูปแบบ E.164 เช่น +66812345678');
  }
  await prisma.systemSetting.upsert({
    where: { key: ALERT_PHONE_KEY },
    create: { key: ALERT_PHONE_KEY, value: encryptField(phone) },
    update: { value: encryptField(phone) },
  });
  cache = { phone };
  cacheTime = Date.now();
  return phone;
}

/** ลบ override กลับไปใช้ค่าจาก env */
export async function clearAlertPhone(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: ALERT_PHONE_KEY } });
  cache = { phone: normalizeAlertPhone(envPhone()) };
  cacheTime = Date.now();
}

/** แสดงเบอร์แบบ mask — ไม่คืนเบอร์เต็มกลับไป UI */
export function maskPhone(phone: string | null | undefined): string {
  const v = String(phone ?? '');
  if (!v) return '';
  if (v.length <= 8) return '••••';
  return v.slice(0, 3) + '…' + v.slice(-4);
}

/** ล้าง cache — ใช้ในเทสต์ */
export function __resetAlertPhoneCache(): void {
  cache = null;
  cacheTime = 0;
}
