import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect } from 'react';
import { applyAppearance } from '../lib/config';
import ApiConnectionBanner from '../components/layout/ApiConnectionBanner';
import MobileNav from '../components/layout/MobileNav';
import AgentBackgroundBadge from '../components/AgentBackgroundBadge';
import CommandPaletteHost from '../components/CommandPaletteHost';
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // ใช้ธีม + ขนาดตัวอักษรที่ผู้ใช้ตั้งไว้ในหน้า Settings (ทันทีที่โหลด)
    applyAppearance();

    // PWA: register service worker (เฉพาะ production — กันรบกวน hot-reload ใน dev)
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('SW registration failed:', err);
      });
    }
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
      <Component {...pageProps} />
      {/* ป้ายแจ้งเตือนงาน AI เบื้องหลัง (ทุกหน้า) — คลิกไปหน้า AI Agent */}
      <AgentBackgroundBadge />
      {/* Command Palette — กด Ctrl/Cmd+K หรือปุ่มค้นหาใน Sidebar */}
      <CommandPaletteHost />
      {/* นำทางบนมือถือ/แท็บเล็ต — Sidebar ซ่อนบนจอเล็ก เลยมีแถบนี้แทน */}
      <MobileNav />
    </>
  );
}