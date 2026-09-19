import type { AppProps } from 'next/app';
import { useIsSuperadmin } from '../lib/roles';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/router';
import { applyAppearance } from '../lib/config';
import { installClientErrorReporter, installFetchFailureReporter } from '../lib/clientErrorReporter';
import ApiConnectionBanner from '../components/layout/ApiConnectionBanner';
import CapabilityBanner from '../components/layout/CapabilityBanner';
import MobileNav from '../components/layout/MobileNav';
import AgentBackgroundBadge from '../components/AgentBackgroundBadge';
import CommandPaletteHost from '../components/CommandPaletteHost';
import { useAuthStore } from '../stores/useAuthStore';
import { useFeatureStore } from '../stores/useFeatureStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import '../styles/globals.css';

// หน้าเฉพาะ SUPERADMIN — ซ่อน/ปิดให้สมาชิกเสมอ (กันเดา URL เข้า)
const ADMIN_PAGES = new Set(['/system', '/backup', '/users', '/audit', '/settings']);

// หน้าสาธารณะ (ไม่ต้อง login) — ลูกค้าไม่ควรเห็นเมนู/แผงควบคุมภายในของระบบ
const PUBLIC_PAGES = new Set(['/shop']);

export default function MyApp({ Component, pageProps }: AppProps) {
  const pathname = usePathname();
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const granted = useFeatureStore((s) => s.granted);
  const isBlocked = useFeatureStore((s) => s.isBlocked);
  const loadFeatures = useFeatureStore((s) => s.load);
  const isSuperadmin = useIsSuperadmin();
  const [blocked, setBlocked] = useState(false);

  // กันหน้าเปิดสิทธิ์: ยังไม่ได้เปลี่ยนรหัสผ่าน (บังคับหลัง login ครั้งแรก)
  // → ทุกหน้าถูกส่งไป /change-password จนกว่าจะเปลี่ยนสำเร็จ
  useEffect(() => {
    if (isHydrated && isAuthenticated && mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword, pathname, router]);

  // SPA navigation ระดับสากล: <a> ภายใน (href ขึ้นต้นด้วย /) ที่ไม่ได้มาผ่าน next/link
  // จะถูกแปลงเป็น router.push แทนการ reload หน้า — คลิกปกติเปลี่ยนหน้าแบบ SPA
  // (Ctrl/Cmd/Shift/Alt/มิดเดิลคลิก หรือ target=_blank ยังเปิดแท็บใหม่ตามปกติ)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const anchor = el?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//') || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      e.preventDefault();
      if (href === pathname + window.location.search + window.location.hash) return;
      // scroll:false = กัน Next เลื่อนหน้าขึ้นบนสุดเองตอนสลับหน้า (อ้างอิงโฟลว์ options.scroll
      // ใน pages router: scroll ขึ้นบนทุกครั้งที่นับได้ถ้าไม่สั่งปิด)
      router.push(href, undefined, { scroll: false });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router, pathname]);

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
    // Client Error Monitoring — จับ error ฝั่ง browser (WebView/LINE ฯลฯ) ส่ง beacon เข้า API
    // (server monitoring มองไม่เห็นพังที่เกิดก่อน request — นี่คือตาอีกข้าง)
    installClientErrorReporter();
    installFetchFailureReporter();

    // ใช้ธีม + ขนาดตัวอักษรที่ผู้ใช้ตั้งไว้ในหน้า Settings (ทันทีที่โหลด)
    applyAppearance();

    // hydration แบบบังคับ: persist ถูกตั้ง skipHydration ไว้ (กันค้างตอน module init)
    // — เรียก rehydrate ตอน mount เสมอ เพื่อให้ทุกหน้าได้ isHydrated/isAuthenticated
    // ตรงเวลา ไม่ติด "⏳ Loading..." ถาวร (onRehydrateStorage เป็นคน setState แจ้งทุกหน้า)
    Promise.resolve(useAuthStore.persist.rehydrate()).catch(() => {
      /* ไม่มี state ให้ hydrate — ไม่เป็นไร */
    });

    // ภาษา: หลัง mount เสร็จเท่านั้นถึงให้ใช้ภาษาใน localStorage ได้
    // (ก่อนหน้านี้ t() เรนเดอร์ไทยเสมอ = ตรงกับ HTML จาก server กัน hydration error)
    Promise.resolve(useLanguageStore.persist.rehydrate()).catch(() => {
      /* ไม่มี state ให้ hydrate — ไม่เป็นไร */
    });
    document.documentElement.dataset.langReady = '1';
    document.documentElement.lang =
      useLanguageStore.getState().lang === 'th' ? 'th' : 'en';

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
      {/* capability guard: เตือนเมื่อ browser/WebView ขาดของที่แอปต้องใช้ (LINE/FB in-app ฯลฯ) */}
      <CapabilityBanner />
      {blocked ? (
        <NoAccessScreen />
      ) : (
        <Component {...pageProps} />
      )}
      {/* ยังไม่ได้เปลี่ยนรหัสผ่านครั้งแรก (โหมดบังคับ) — ซ่อนเมนู/ป้าย ให้จดจ่อกับหน้าเปลี่ยนรหัส */}
      {!mustChangePassword && !PUBLIC_PAGES.has(normalizedPath) && (
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
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl border border-gray-800 bg-gray-900 flex items-center justify-center text-gray-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold mb-2">{t('app.noAccessTitle', 'หน้านี้ยังไม่ได้เปิดให้คุณดู')}</h1>
        <p className="text-sm text-gray-500 mb-6">
          {t('app.noAccessHint', 'ถ้าคิดว่าควรเห็นหน้านี้ ให้ผู้ดูแล (superadmin) เปิดสิทธิ์ให้ที่หน้า Users')}
        </p>
        <Link
          href="/dashboard" scroll={false}
          className="inline-block px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold transition-colors"
        >
          {t('app.backDashboard', 'กลับ Dashboard')}
        </Link>
      </div>
    </div>
  );
}