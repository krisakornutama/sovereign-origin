"use client";
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

export default function ChangePasswordPage() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
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
        <div className="text-emerald-400 text-lg animate-pulse">{t('common.loading', 'กำลังโหลด...')}</div>
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
        <div className="relative w-full max-w-md px-6 panel-glow">
          <ChangePasswordForm forced />
        </div>
      </div>
    );
  }

  // ── โหมดสมัครใจ: สมาชิกทุกคนเปลี่ยนเองได้เมื่อไหร่ก็ได้ ──
  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
            eyebrow={t('changePassword.eyebrow', 'บัญชีของฉัน')}
            title={t('changePassword.title', 'เปลี่ยนรหัสผ่าน')}
            icon={<Icon name="password" size={18} />}
            subtitle={t('changePassword.subtitle', 'ตั้งรหัสผ่านใหม่ด้วยตัวเอง')}
            actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">Dashboard</Link>}
          />
        <main className="flex-1 w-full max-w-md mx-auto p-6 panel-glow">
          <ChangePasswordForm />
          <p className="mt-4 text-center text-[11px] text-gray-500 font-mono glow-text-cyan">
            {t('changePassword.sessionGate', 'SESSION GATE · เปลี่ยนแล้วต้องใช้รหัสใหม่ครั้งหน้า · รหัสถูกเข้ารหัส bcrypt')}
          </p>
        </main>
      </div>
    </div>
  );
}