// src/lib/publicAccess.ts
// P11 (30/9/69): หน้าแรกต้องรู้ว่ากำลังเปิดจาก "โดเมนสาธารณะ" หรือ "เครื่องเรา"
//  - โดเมนสาธารณะ (Cloudflare Tunnel) → ผู้มาเยือนเห็นหน้าทดลองทันที (ไม่มีฟอร์มล็อกอินขวาง)
//  - localhost/LAN → เจ้าของ/ผู้ดูแล เข้าสู่ระบบจัดการตามเดิม
// วิธีเดียวกับ getApiUrl() ใน config.ts (แยกไฟล์เพื่อไม่ให้หน้าแรกดึง config ทั้งก้อน)
export function isPublicHostname(): boolean {
  if (typeof window === 'undefined') return false; // SSR → ให้ hydration ตัดสินฝั่ง client
  const h = window.location.hostname;
  const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  return !isLocal;
}
