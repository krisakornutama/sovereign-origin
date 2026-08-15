"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/useAuthStore';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

export default function ChangePasswordPage() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const router = useRouter();

  // ยืนยันก่อนปิดหน้า (โหมดบังคับยังเปลี่ยนไม่เสร็จ)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (mustChangePassword) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [mustChangePassword]);

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-green-400 text-lg animate-pulse">⏳ Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    router.push('/');
    return null;
  }

  // ── โหมดบังคับ (หลัง login ครั้งแรก): เต็มจอ ไม่มีเมนู ข้ามไม่ได้ ──
  if (mustChangePassword) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 w-[520px] h-[300px] rounded-full bg-green-500/10 blur-3xl pointer-events-none" />
        <div className="relative w-full max-w-md px-6">
          <ChangePasswordForm forced />
        </div>
      </div>
    );
  }

  // ── โหมดสมัครใจ: สมาชิกทุกคนเปลี่ยนเองได้เมื่อไหร่ก็ได้ ──
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
          <PageHeader
            eyebrow="บัญชีของฉัน"
            title="🔑 เปลี่ยนรหัสผ่าน"
            subtitle="ตั้งรหัสผ่านใหม่ด้วยตัวเอง"
            actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>}
          />
        </header>
        <main className="flex-1 w-full max-w-md mx-auto p-6">
          <ChangePasswordForm />
          <p className="mt-4 text-center text-[11px] text-gray-500 font-mono">
            SESSION GATE · เปลี่ยนแล้วต้องใช้รหัสใหม่ครั้งหน้า · รหัสถูกเข้ารหัส bcrypt
          </p>
        </main>
      </div>
    </div>
  );
}