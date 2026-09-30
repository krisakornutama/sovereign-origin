"use client";
import { useAuthStore } from '../stores/useAuthStore';
import LoginForm from '../components/auth/LoginForm';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useLanguageStore } from '../stores/useLanguageStore';
import { isPublicHostname } from '../lib/publicAccess';

export default function Home() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const router = useRouter();
  const t = useLanguageStore((s) => s.t);

  // P11 (30/9/69): บนโดเมนสาธารณะถ้า browser มี session เจ้าของอยู่แล้ว เด้งเข้า dashboard ตามเดิม
  useEffect(() => {
    if (isHydrated && isAuthenticated && isPublicHostname()) {
      router.push(mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword, router]);

  // รอจนกว่า store จะ hydrate ก่อนแสดงอะไร
  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-emerald-400 text-sm tracking-wide glow-text">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  // โหมดทดลอง (คำสั่งเจ้าของ 30/9/69: "เว็บนี้มันควรจะขึ้นเลย เปิดให้ใช้สำหรับทดลอง ไม่ใช่ให้เข้ารหัสใด ๆ")
  // ผู้มาเยือนโดเมนสาธารณะที่ยังไม่ล็อกอิน → หน้าทดลองทันที ไม่มีฟอร์มขวาง
  if (isPublicHostname() && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <main className="max-w-2xl mx-auto px-4 py-14 space-y-8">
          <header className="space-y-3 text-center pt-6">
            <div className="mono text-[10px] tracking-[0.3em] uppercase text-cyan-400/80">sovereign origin</div>
            <h1 className="font-ledger text-3xl md:text-4xl font-bold glow-text">ระบบฟาร์ม · ปศุสัตว์ · การเงิน<br />ลองใช้ได้ทันที ไม่ต้องสมัคร</h1>
            <p className="text-sm text-gray-400">
              เปิดให้ทดลองใช้งานฟรีด้วยข้อมูลตัวอย่าง — ไม่มีล็อกอินขวาง<br />
              ข้อมูลจริงอยู่หลังระบบภายในเท่านั้น
            </p>
          </header>

          <div className="grid gap-3">
            <a href="/demo" className="block card p-5 hover:border-cyan-500/60 transition group">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl">🧪</span>
                <div>
                  <div className="font-ledger text-lg text-cyan-300 group-hover:glow-text">เข้าสนามทดลอง</div>
                  <div className="text-xs text-gray-500">ฟาร์ม · ปศุสัตว์ · การเงิน — ข้อมูลตัวอย่างล้วน กดเล่นได้ทุกแท็บ</div>
                </div>
              </div>
            </a>
            <a href="/shop" className="block card p-5 hover:border-emerald-500/60 transition group">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl">🛒</span>
                <div>
                  <div className="font-ledger text-lg text-emerald-300">ร้านอุปกรณ์ & ซอฟต์แวร์</div>
                  <div className="text-xs text-gray-500">ชุดอุปกรณ์ DMS · ซอฟต์แวร์แยกโมดูล — พร้อมบัตรตามรอยการผลิต</div>
                </div>
              </div>
            </a>
            <a href="/trace" className="block card p-5 hover:border-amber-500/60 transition group">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl">🔎</span>
                <div>
                  <div className="font-ledger text-lg text-amber-300">ตามรอยผลผลิต</div>
                  <div className="text-xs text-gray-500">ใส่รหัสล็อตดูที่มาทั้งสาย — ต้นทางถึงมือคุณ</div>
                </div>
              </div>
            </a>
          </div>

          <p className="text-center text-[11px] text-gray-600">
            เจอปัญหาหรืออยากเสนอฟีเจอร์ → ปุ่ม 💬 มุมขวาล่างของทุกหน้าทดลอง
          </p>

          <div className="pt-2 text-center">
            <a href="/login" className="text-[11px] text-gray-600 hover:text-gray-400 underline underline-offset-2">เข้าสู่ระบบ (ผู้ดูแลระบบ)</a>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return null;
}