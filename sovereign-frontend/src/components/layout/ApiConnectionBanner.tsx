"use client";
import { useEffect, useRef, useState } from 'react';
import { useApiConnection, API_RECONNECTED_EVENT } from '../../hooks/useApiConnection';
import { useLanguageStore } from '../../stores/useLanguageStore';

/**
 * แถบแสดงสถานะการเชื่อมต่อ API (self-healing):
 * - API ตาย → แสดง "กำลังเชื่อมต่อใหม่…" + จำนวนครั้งที่ลอง พร้อมปุ่มลองทันที
 * - กลับมาได้ → แสดง "เชื่อมต่อแล้ว" สั้น ๆ แล้วหายไป
 */
export default function ApiConnectionBanner() {
  const { status, attempt, retryNow } = useApiConnection();
  const [justBack, setJustBack] = useState(false);
  const justBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useLanguageStore((s) => s.t);

  // แสดง "เชื่อมต่อแล้ว" สั้น ๆ เมื่อ API กลับมา
  useEffect(() => {
    const onReconnected = () => {
      setJustBack(true);
      if (justBackTimer.current) clearTimeout(justBackTimer.current);
      justBackTimer.current = setTimeout(() => setJustBack(false), 4000);
    };
    window.addEventListener(API_RECONNECTED_EVENT, onReconnected);
    return () => {
      window.removeEventListener(API_RECONNECTED_EVENT, onReconnected);
      if (justBackTimer.current) clearTimeout(justBackTimer.current);
    };
  }, []);

  if (status !== 'connecting' && !justBack) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[60] px-4 py-2.5 text-sm flex items-center justify-center gap-3 border-b backdrop-blur-md ${
        status === 'connecting'
          ? 'bg-amber-950/90 border-amber-700/60 text-amber-200'
          : 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200'
      }`}
    >
      {status === 'connecting' ? (
        <>
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          <span>
            <b>{t('app.banner.connecting', 'กำลังเชื่อมต่อใหม่…')}</b>{t('app.banner.connectingDetail', ' (ลองครั้งที่ {n}) — API ยังไม่ตอบสนอง ระบบจะลองเองอัตโนมัติทุกไม่กี่วินาที', { n: attempt })}
          </span>
          <button
            onClick={retryNow}
            className="px-3 py-1 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-amber-50 text-xs font-semibold"
          >
            {t('app.banner.retryNow', 'ลองทันที')}
          </button>
        </>
      ) : (
        <span><b>{t('app.banner.reconnected', 'เชื่อมต่อ API แล้ว')}</b>{t('app.banner.reconnectedDetail', ' — กำลังโหลดข้อมูลให้อัตโนมัติ…')}</span>
      )}
    </div>
  );
}
