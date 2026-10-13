"use client";
// หน้าแรกของแอป desktop = ประตูทางเข้า (ล็อกอิน) เท่านั้น
//
// 13/10/69: ถอด "หน้าต้อนรับสาธารณะ" ออกจากโปรเจกต์นี้ทั้งหมด (คำสั่งเจ้าของ:
//   "เว็บไซต์คุณไม่ต้องยุ่ง · คุณพัฒนาแค่ app desktop ตรงนี้เท่านั้น")
//   เดิมหน้านี้สลับ 2 โหมด: โดเมนสาธารณะ → landing + SEO + การ์ดเชิญชม
//   · localhost/desktop → LoginForm · ตอนนี้เหลือ LoginForm อย่างเดียว
//   โค้ดส่วนที่ถูกถอดออกอยู่ที่ E:\My work\Sovereign-Web-Standalone (มี README วิธีนำกลับ)
//
// ยังใช้ FounderCredit เหมือนเดิม — เป็นป้ายกำกับท้ายหน้าจอ ไม่ใช่ส่วนของเว็บ
import { useAuthStore } from '../stores/useAuthStore';
import LoginForm from '../components/auth/LoginForm';
import { FounderCredit } from '../components/public/FounderCredit';
import { useLanguageStore } from '../stores/useLanguageStore';

export default function Home() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);

  // รอจนกว่า store จะ hydrate ก่อนตัดสินใจว่าจะโชว์ฟอร์มล็อกอินหรือไม่
  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-emerald-400 text-sm tracking-wide glow-text">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <LoginForm />
        <FounderCredit />
      </>
    );
  }

  // ล็อกอินแล้ว → _app.tsx จัดการแสดง Sidebar + เนื้อหาหลักต่อเอง
  return null;
}