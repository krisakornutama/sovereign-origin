import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { applyAppearance } from '../lib/config';
import ApiConnectionBanner from '../components/layout/ApiConnectionBanner';
import MobileNav from '../components/layout/MobileNav';
import AgentBackgroundBadge from '../components/AgentBackgroundBadge';
import CommandPaletteHost from '../components/CommandPaletteHost';
import { useAuthStore } from '../stores/useAuthStore';
import { useFeatureStore } from '../stores/useFeatureStore';
import '../styles/globals.css';

// หน้าเฉพาะ SUPERADMIN — ซ่อน/ปิดให้สมาชิกเสมอ (กันเดา URL เข้า)
const ADMIN_PAGES = new Set(['/system', '/backup', '/users', '/audit', '/settings']);

export default function MyApp({ Component, pageProps }: AppProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const granted = useFeatureStore((s) => s.granted);
  const isBlocked = useFeatureStore((s) => s.isBlocked);
  const loadFeatures = useFeatureStore((s) => s.load);
  const isSuperadmin = user?.role === 'SUPERADMIN';
  const [blocked, setBlocked] = useState(false);

  // กันเปิดสิทธิ์: ยังไม่ได้เปลี่ยนรหัสผ่าน (บังคับหลัง login ครั้งแรก)
  // → ทุกหน้าถูกส่งไป /change-password จนกว่าจะเปลี่ยนสำเร็จ
  useEffect(() => {
    if (isHydrated && isAuthenticated && mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword, pathname, router]);

  // โหลดสิทธิ์เมื่อ login แล้ว (สมาชิก) — SUPERADMIN เห็นหมดอยู่แล้ว
  useEffect(() => {
    if (isHydrated && isAuthenticated && user && !isSuperadmin) loadFeatures();
  }, [isHydrated, isAuthenticated, user, isSuperadmin, loadFeatures]);

  // กันเปิดหน้าที่ไม่มีสิทธิ์: สมาชิก + รู้สิทธิ์แล้ว + หน้านี้ไม่ได้ถูก grant
  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated || !user) {
      setBlocked(false);
      return;
    }
    if (isSuperadmin) {
      setBlocked(false);
      return;
    }
    const deniedAdmin = ADMIN_PAGES.has(pathname);
    setBlocked(deniedAdmin || (granted !== null && isBlocked(pathname)));
  }, [pathname, isHydrated, isAuthenticated, user, isSuperadmin, granted, isBlocked]);

  useEffect(() => {
    // ใช้ธีม + ขนาดตัวอักษรที่ผู้ใช้ตั้งไว้ในหน้า Settings (ทันทีที่โหลด)
    applyAppearance();

    // hydration แบบบังคับ: persist ถูกตั้ง skipHydration ไว้ (กันค้างตอน module init)
    // — เรียก rehydrate ตอน mount เสมอ เพื่อให้ทุกหน้าได้ isHydrated/isAuthenticated
    // ตรงเวลา ไม่ติด "⏳ Loading..." ถาวร (onRehydrateStorage เป็นคน setState แจ้งทุกหน้า)
    Promise.resolve(useAuthStore.persist.rehydrate()).catch(() => {
      /* ไม่มี state ให้ hydrate — ไม่เป็นไร */
    });

    // self-heal: ถ้า hydration ยังไม่จบ (dev HMR เปลี่ยน page chunk แต่ store chunk ค้าง
    // → module ผสมกันทำให้ rehydrate ไม่จบ) ลองใหม่ทุก 500ms — idempotent ปลอดภัย
    // พอ isHydrated ขึ้นจริงค่อยหยุด กันหน้า "⏳ Loading..." ค้างจนต้อง reload เอง
    const retry = setInterval(() => {
      if (useAuthStore.getState().isHydrated) {
        clearInterval(retry);
        return;
      }
      Promise.resolve(useAuthStore.persist.rehydrate()).catch(() => {
        /* retry ครั้งถัดไป */
      });
    }, 500);
    const stop = setTimeout(() => clearInterval(retry), 15000);

    // PWA: register service worker (เฉพาะ production — กันรบกวน hot-reload ใน dev)
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('SW registration failed:', err);
      });
    }

    return () => {
      clearInterval(retry);
      clearTimeout(stop);
    };
  }, []);

  return (
    <>
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#10b981" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Sovereign" />
      </Head>
      {/* self-healing: แสดงสถานะ "กำลังเชื่อมต่อใหม่" ถ้า API ตาย พร้อม retry อัตโนมัติ */}
      <ApiConnectionBanner />
      {blocked ? (
        <NoAccessScreen />
      ) : (
        <Component {...pageProps} />
      )}
      {/* ยังไม่ได้เปลี่ยนรหัสผ่านครั้งแรก (โหมดบังคับ) — ซ่อนเมนู/ป้าย ให้จดจ่อกับหน้าเปลี่ยนรหัส */}
      {!mustChangePassword && (
        <>
          {/* ป้ายแจ้งเตือนงาน AI เบื้องหลัง (ทุกหน้า) — คลิกไปหน้า AI Agent */}
          <AgentBackgroundBadge />
          {/* Command Palette — กด Ctrl/Cmd+K หรือปุ่มค้นหาใน Sidebar */}
          <CommandPaletteHost />
          {/* นำทางบนมือถือ/แท็บเล็ต — Sidebar ซ่อนบนจอเล็ก เลยมีแถบนี้แทน */}
          <MobileNav />
        </>
      )}
    </>
  );
}

// หน้าบอก "ไม่มีสิทธิ์" — กันสมาชิกเดา URL เปิดหน้าที่พ่อไม่เปิดให้
function NoAccessScreen() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold mb-2">หน้านี้ยังไม่ได้เปิดให้คุณดู</h1>
        <p className="text-sm text-gray-400 mb-6">
          ถ้าคิดว่าควรเห็นหน้านี้ ให้ผู้ดูแล (superadmin) เปิดสิทธิ์ให้ที่หน้า Users
        </p>
        <a
          href="/dashboard"
          className="inline-block px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold transition-colors"
        >
          ← กลับ Dashboard
        </a>
      </div>
    </div>
  );
}