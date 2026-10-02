// src/lib/publicAccess.ts
// P11 (30/9/69): หน้าแรกต้องรู้ว่ากำลังเปิดจาก "โดเมนสาธารณะ" หรือ "เครื่องเรา"
//  - โดเมนสาธารณะ (Cloudflare Tunnel) → ผู้มาเยือนเห็นหน้าทดลองทันที (ไม่มีฟอร์มล็อกอินขวาง)
//  - localhost/LAN → เจ้าของ/ผู้ดูแล เข้าสู่ระบบจัดการตามเดิม
// วิธีเดียวกับ getApiUrl() ใน config.ts (แยกไฟล์เพื่อไม่ให้หน้าแรกดึง config ทั้งก้อน)
//
// ── P24 (3/10/69): SSR ของหน้าสาธารณะ ──
// เคสจริง: isPublicHostname() คืน false ตอน SSR (ไม่มี window) → HTML ที่ server ส่ง
// เป็น branch ล็อกอิน → Googlebot ดึงหน้าแรกมาได้แค่ title/description ไม่มี h1 และไม่มีเนื้อหา
// (เนื้อหาโผล่หลัง JS รัน) · ทางแก้ = ธงตอน build: ตั้ง NEXT_PUBLIC_PUBLIC_SITE=1 เฉพาะตอน
// build ของ production → ทั้ง SSR และ client ตอบ "สาธารณะ" ตรงกัน (ไม่เกิด hydration mismatch)
// ไม่ตั้งธง = พฤติกรรมเดิมทุกประการ (dev/เครื่องเจ้าของยังเป็นโหมดล็อกอิน)
const BUILD_PUBLIC_MODE = process.env.NEXT_PUBLIC_PUBLIC_SITE === '1';

/** true เมื่อเปิดจากเครื่องตัวเอง (localhost/LAN) — ใช้แยก "เจ้าของเข้าจัดการ" ออกจากโหมดสาธารณะ */
export function isLocalHostname(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

export function isPublicHostname(): boolean {
  if (BUILD_PUBLIC_MODE) return true; // build ของ production: โหมดสาธารณะทั้ง SSR และ client
  if (typeof window === 'undefined') return false; // SSR → ให้ hydration ตัดสินฝั่ง client
  const h = window.location.hostname;
  const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  return !isLocal;
}

/** true เมื่อ build นี้ถูกทำเป็น "โหมดสาธารณะ" ตอน build (ใช้แสดงหมายเหตุ/ทดสอบ) */
export function isBuiltPublicMode(): boolean {
  return BUILD_PUBLIC_MODE;
}
