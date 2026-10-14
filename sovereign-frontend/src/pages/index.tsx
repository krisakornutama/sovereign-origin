"use client";
// หน้าแรกของแอป desktop = ประตูทางเข้า (ล็อกอิน) เท่านั้น
//
// 13/10/69: ถอด "หน้าต้อนรับสาธารณะ" ออกจากโปรเจกต์นี้ทั้งหมด (คำสั่งเจ้าของ:
//   "เว็บไซต์คุณไม่ต้องยุ่ง · คุณพัฒนาแค่ app desktop ตรงนี้เท่านั้น")
//   โค้ดส่วนที่ถูกถอดออกอยู่ที่ E:\My work\Sovereign-Web-Standalone (มี README วิธีนำกลับ)
//
// ⚠ กักันไว้ 14/10/69: ต้องพาผู้ใช้ที่ล็อกอินอยู่แล้วไป /dashboard เสมอ
//   เคยพังตอนถอดส่วนเว็บ เพราะเงื่อนไขเดิมเป็น `&& isPublicHostname()` ซึ่งคืน false
//   ในแอป desktop → หน้านี้คืน null ตลอด = หน้าต่างขาวเปล่า (298 element · มองไม่เห็นสักตัว)
//   ที่ผ่านมาก่อนหน้านี้เพราะ NEXT_PUBLIC_PUBLIC_SITE ถูกฝังผิดใน build
//   ที่ Electron โหลด (นั่นคือบั๊กเดียวกับที่เคยเด้งหน้าสนามทดลอง) — ห้ามพึ่งมันอีก
//   เงื่อนไขนี้ถูกต้องทั้งเว็บและแอป: มี session แล้ว = เข้า dashboard ไม่ใช่ฟอร์มล็อกอิน
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/useAuthStore';
import LoginForm from '../components/auth/LoginForm';
import { FounderCredit } from '../components/public/FounderCredit';
import { useLanguageStore } from '../stores/useLanguageStore';

export default function Home() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const router = useRouter();
  const t = useLanguageStore((s) => s.t);

  useEffect(() => {
    if (isHydrated && isAuthenticated) {
      router.push(mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword, router]);

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

  // กำลังพาไป /dashboard — อย่าวาดอะไรทั้งนั้น (ค้างแบบนี้ = จอขาว)
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-emerald-400 text-sm tracking-wide glow-text">{t('common.loading', 'กำลังโหลด...')}</div>
    </div>
  );
}