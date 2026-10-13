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

// ── 13/10/69: แยก "แอป desktop (Electron)" ออกจาก "เว็บ" ให้จบขาด ──
// เคสจริง: กดไอคอน Sovereign OS → เด้งไปหน้า "เข้าสนามทดลอง" ทันที
//  รากของบั๊ก: `NEXT_PUBLIC_PUBLIC_SITE=1` ถูกฝังใน build ของเว็บ production (โฟลเดอร์ .next
//  ตัวเดียวกับที่ Electron โหลดที่ :3000) → isPublicHostname() คืน true ทันทีโดยไม่สน hostname
//  → แอป desktop ซึ่งเป็น "เครื่องของเจ้าของ" ถูกจัดเป็นผู้มาเยือนภายนอก
//
// สัญญาณที่บอกว่าเป็น desktop (เรียงตามความน่าเชื่อถือ — ทั้งหมดเป็นสัญญาณเฉพาะที่เบราว์เซอร์ไม่มี):
//   1. window.sovereign        = preload ของ Electron เปิดให้ renderer เท่านั้น
//   2. userAgent มี "Electron/" = Electron ใส่ให้เสมอ
//   3. protocol = "file:"       = static export ที่แอปเปิดตรง ๆ (hostname ว่าง)
//
// กติกา: เช็ค desktop ก่อน BUILD_PUBLIC_MODE เสมอ → "สนามทดลอง/โหมดสาธารณะ" อยู่บนเว็บเท่านั้น
// (เทสต์: tools/test/desktop-shell.test.mjs)
export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false; // SSR → ไม่มีทางเป็น desktop
  try {
    const w = window as unknown as { sovereign?: unknown; navigator?: { userAgent?: string }; location?: { protocol?: string; hostname?: string } };
    if (w.sovereign && typeof w.sovereign === 'object') return true;      // preload bridge
    if (/Electron\//i.test(w.navigator?.userAgent || '')) return true;   // userAgent
    if ((w.location?.protocol || '') === 'file:') return true;           // static export
    if (!(w.location?.hostname || '')) return true;                      // hostname ว่าง = ไม่ใช่ผู้มาเยือนเว็บ
  } catch { /* ignore — ถ้าอ่านไม่ได้ถือว่าไม่ใช่ desktop */ }
  return false;
}

/** true เมื่อเปิดจากเครื่องตัวเอง (localhost/LAN/desktop) — ใช้แยก "เจ้าของเข้าจัดการ" ออกจากโหมดสาธารณะ */
export function isLocalHostname(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDesktopShell()) return true; // แอป desktop = เครื่องตัวเองเสมอ
  const h = window.location.hostname;
  return /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

export function isPublicHostname(): boolean {
  if (isDesktopShell()) return false; // 13/10/69: desktop ไม่มีโหมดสาธารณะ/สนามทดลอง — ตัดก่อนธง build
  if (BUILD_PUBLIC_MODE) return true; // build ของ production: โหมดสาธารณะทั้ง SSR และ client
  if (typeof window === 'undefined') return false; // SSR → ให้ hydration ตัดสินฝั่ง client
  const h = window.location.hostname;
  const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  return !isLocal;
}

// ── 13/10/69: ถอด "รายการหน้าที่ประกาศให้ Google" (PUBLIC_PATHS) ออกแล้ว ──
// รายการนี้มีไว้ให้ pages/sitemap.xml.ts ใช้ซึ่งเป็นของเว็บสาธารณะ
// (คำสั่งเจ้าของ: "เว็บไซต์คุณไม่ต้องยุ่ง · พัฒนาแค่ app desktop")
// โค้ดเดิมทั้งหมดอยู่ที่ E:\My work\Sovereign-Web-Standalone
//
// ที่เหลือในไฟล์นี้ = เครื่องมือตรวจว่า "ตอนนี้เปิดอยู่ในแอป desktop หรือเป็นเว็บ"
// (ใช้โดย tools/test/desktop-shell.test.mjs และเผื่อไว้ให้โค้ดใหม่ใช้ตัดสินว่าโหมดไหน)
