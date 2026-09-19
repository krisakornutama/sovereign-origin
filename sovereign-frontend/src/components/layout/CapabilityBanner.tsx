"use client";
import { useEffect, useState } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { checkCapabilities, reportCapabilities, type CapabilityReport } from '../../lib/capabilityGuard';

/**
 * แถบเตือนความเข้ากันได้ (capability guard) — เคส LINE WebView ที่หน้าพังเงียบ ๆ:
 * - เบราว์เซอร์ขาดของที่แอปต้องใช้ (localStorage/crypto.subtle/fetch) → เตือนระดับแรง + แนะนำเบราว์เซอร์
 * - เปิดผ่าน in-app browser (LINE/Facebook/Instagram) → เตือนอ่อน แนะนำเปิดใน Chrome/Safari
 * ผลเช็กทุกอย่างถูกรายงานเข้า /api/client-monitor/error (kind=capability) เพื่อเห็นสถิติจริง
 * ในแผง Client Health — ปิดชั่วคราวได้ (session เดียว) และห้าม throw เด็ดขาด
 */
export default function CapabilityBanner() {
  const t = useLanguageStore((s) => s.t);
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      // dismiss ต่อ session — คนที่กดปิดแล้วไม่ต้องเจอซ้ำจนกว่าจะปิดแท็บ
      if (sessionStorage.getItem('sovereign-capability-dismissed') === '1') {
        setDismissed(true);
        return;
      }
    } catch {
      // sessionStorage ใช้ไม่ได้ = เคสที่ต้องเตือนพอดี — แสดงต่อเลย
    }
    try {
      const r = checkCapabilities();
      setReport(r);
      reportCapabilities(r);
    } catch {
      // เช็กไม่ได้ = อย่าทำหน้าเว็บพังตาม
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('sovereign-capability-dismissed', '1');
    } catch {
      // ปิดแค่ state นี้ก็พอ
    }
  };

  if (!report || dismissed || report.ok) return null;

  const blocking = report.issues.filter((i) => i.key !== 'serviceWorker');
  const onlySw = blocking.length === 0; // ขาดแค่ SW = เสียฟีเจอร์ย่อย ไม่ใช่หน้าพัง
  const isWebViewWarn = !onlySw && report.isWebView;

  return (
    <div
      role="alert"
      className={`fixed top-0 left-0 right-0 z-[61] px-4 py-2.5 text-sm border-b backdrop-blur-md ${
        onlySw
          ? 'bg-gray-900/90 border-gray-700/60 text-gray-300'
          : 'bg-rose-950/90 border-rose-700/60 text-rose-100'
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5">{onlySw ? 'ℹ️' : '⚠️'}</span>
        <div className="flex-1 min-w-0">
          {onlySw ? (
            <span>
              <b>{t('app.capability.swTitle', 'โหมดออฟไลน์ (PWA) ใช้ไม่ได้ในเบราว์เซอร์นี้')}</b>
              {' — '}
              {t('app.capability.swHint', 'เปิดใน Chrome หรือ Safari จะใช้งานได้ครบทุกฟีเจอร์')}
            </span>
          ) : (
            <>
              <b>{t('app.capability.title', 'เบราว์เซอร์นี้อาจใช้งานระบบได้ไม่เต็มที่')}</b>
              <div className="text-xs opacity-90 mt-0.5">
                {report.issues.map((i) => (
                  <div key={i.key}>• {i.key}: {i.detail}</div>
                ))}
                {isWebViewWarn && (
                  <div className="mt-1 font-semibold">
                    {t('app.capability.webviewHint', 'คุณกำลังเปิดผ่าน in-app browser (LINE/Facebook ฯลฯ) — แนะนำกด ⋮ หรือ … แล้วเลือก "เปิดในเบราว์เซอร์" (Chrome/Safari)')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
        >
          {t('app.capability.dismiss', 'รับทราบ')}
        </button>
      </div>
    </div>
  );
}
