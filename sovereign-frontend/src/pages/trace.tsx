"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

// ────────────────────────────────────────────────────────────────────────────
// /trace — Traceability เฟส 2: ตามรอยล็อตผลผลิต Farm → Inventory → Shop → ครัว
// - พิมพ์/สแกนรหัส LOT-XXXXXX → GET /api/trace/:lotCode (สาธารณะ ไม่ต้อง login)
// - ไทม์ไลน์เหตุการณ์ HARVESTED → SOLD → DELIVERED → CONSUMED/PROCESSED ฯลฯ
// - QR generator สำหรับติดสินค้า: GET /api/trace/:lotCode/qr (login) — ปริ้นได้
// - รองรับลิงก์ QR /trace?lot=LOT-XXXXXX ที่พิมพ์ติดสินค้ามาแล้วเปิดเอง
// ────────────────────────────────────────────────────────────────────────────

interface TraceEvent { type: string; detail: string | null; at: string; }
interface TraceLot {
  lotCode: string;
  crop: string | null;
  quantityKg: number;
  harvestedAt: string;
  plotName: string | null;
  plotLocation: string | null;
  sold: boolean;
  events: TraceEvent[];
}
interface LotSummary {
  lotCode: string;
  crop: string | null;
  quantityKg: number;
  harvestedAt: string;
  plot?: { name?: string | null } | null;
  events?: Array<{ type: string }>;
}

const EVENT_STYLE: Record<string, { cls: string; icon: string }> = {
  HARVESTED: { cls: 'bg-lime-500/15 text-lime-300 border-lime-500/30', icon: 'farm' },
  PROCESSED: { cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'automation' },
  TESTED: { cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30', icon: 'check-circle' },
  SOLD: { cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', icon: 'coin' },
  DELIVERED: { cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', icon: 'send' },
  RESTOCKED: { cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30', icon: 'inventory' },
  CONSUMED: { cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30', icon: 'recycle' },
  NOTE: { cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30', icon: 'note' },
};
const EVENT_TH: Record<string, string> = {
  HARVESTED: 'เก็บเกี่ยว',
  PROCESSED: 'แปรรูป/ทำอาหาร',
  TESTED: 'ตรวจคุณภาพ',
  SOLD: 'ขายแล้ว',
  DELIVERED: 'ส่งมอบแล้ว',
  RESTOCKED: 'กลับเข้าคลัง',
  CONSUMED: 'ใช้วัตถุดิบ',
  NOTE: 'บันทึก',
};
const eventStyle = (t: string) => EVENT_STYLE[t] ?? EVENT_STYLE.NOTE;
const eventLabel = (t: string, tFn: (f: string, d: string) => string) => EVENT_TH[t] ?? tFn('trace.event.' + t, t);

/** สแกน QR ด้วยกล้องหน้า — BarcodeDetector (Chrome/Edge) โดยไม่เพิ่ม dependency */
function useQrScanner(active: boolean, onResult: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const Detector = (window as any).BarcodeDetector;
    setSupported(typeof Detector === 'function');
    if (!active || typeof Detector !== 'function') return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const detector = new Detector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue as string | undefined;
            if (raw) {
              // ลิงก์ตามรอย (…/trace?lot=LOT-XXXXXX) หรือรหัสตรง ๆ ก็จับ
              const m = raw.match(/lot=([A-Za-z0-9-]+)/i) || raw.match(/(LOT-[A-Z2-9]{6})/i);
              onResult(m ? m[1] : raw.trim());
            }
          } catch { /* เฟรมข้ามได้ */ }
        }, 500);
      } catch (e: any) {
        setError(e?.message || 'เปิดกล้องไม่ได้');
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onResult]);

  return { supported, error, videoRef };
}

export default function TracePage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [code, setCode] = useState('');
  const [lot, setLot] = useState<TraceLot | null>(null);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [qr, setQr] = useState<{ lotCode: string; qrDataUrl: string; url: string } | null>(null);
  const searchedRef = useRef(false);

  const search = useCallback(async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    setCode(c);
    setLoading(true);
    setError('');
    setQr(null);
    try {
      const res = await fetch(`${getApiUrl()}/api/trace/${encodeURIComponent(c)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(res.status === 404 ? t('trace.notFound', 'ไม่พบล็อตนี้ — ตรวจรหัสอีกครั้ง (รูปแบบ LOT-XXXXXX)') : data?.error || `HTTP ${res.status}`);
      setLot(data);
      setLots([]);
      if (typeof window !== 'undefined') window.history.replaceState(null, '', `/trace?lot=${encodeURIComponent(c)}`);
    } catch (e: any) {
      setLot(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // เปิดจาก QR ที่ติดสินค้า: /trace?lot=LOT-XXXXXX → ตามรอยทันที
  useEffect(() => {
    if (searchedRef.current) return;
    searchedRef.current = true;
    const q = new URLSearchParams(window.location.search).get('lot');
    if (q) void search(q);
  }, [search]);

  // รายการล็อตล่าสุด (ต้อง login — เป็นจุดเริ่มเลือกล็อตเมื่อยังไม่สแกน)
  const loadLots = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/trace`);
      if (!res.ok) return;
      const data = await res.json();
      setLots(Array.isArray(data?.lots) ? data.lots : []);
    } catch { /* ไม่ login ก็ข้าม — ยังตามรอยด้วยรหัสได้ */ }
  }, []);
  useEffect(() => { if (isAuthenticated && !lot) void loadLots(); }, [isAuthenticated, lot, loadLots]);

  const scan = useQrScanner(scanning, (text) => { setScanning(false); void search(text); });

  const genQr = async (lotCode: string) => {
    setError('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/trace/${encodeURIComponent(lotCode)}/qr`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้าง QR ไม่สำเร็จ');
      setQr(data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const printQr = () => {
    if (!qr) return;
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<html><head><title>QR ${qr.lotCode}</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">${qr.lotCode}</div>
      <div style="font-size:12px;color:#555;margin-bottom:16px">สแกนเพื่อดูที่มาผลผลิต</div>
      <img src="${qr.qrDataUrl}" width="280" height="280" />
      <div style="font-size:10px;color:#888;margin-top:16px">Sovereign Origin · Traceability</div>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  return (
    <div className="atmo-nature min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">
          <PageHeader
            eyebrow={t('trace.eyebrow', 'ฟาร์ม & ทรัพยากร')}
            title={t('trace.title', 'ตามรอยผลผลิต')}
            subtitle={t('trace.subtitle', 'พิมพ์หรือสแกนรหัสล็อต LOT-XXXXXX เพื่อดูที่มาตั้งแต่แปลงจนถึงมือผู้บริโภค — สาธารณะ ไม่ต้อง login')}
            icon={<Icon name="search" size={18} />}
          />

          {/* ── ช่องค้นหา + สแกนกล้อง ── */}
          <div className="card panel-cyan p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && search(code)}
                placeholder={t('trace.placeholder', 'LOT-XXXXXX')}
                className="input mono flex-1 min-w-[200px] tracking-widest"
                aria-label={t('trace.placeholder', 'รหัสล็อต')}
              />
              <button onClick={() => search(code)} disabled={loading || !code.trim()} className="btn-primary inline-flex items-center gap-1.5">
                <Icon name="search" size={14} /> {loading ? t('trace.searching', 'กำลังค้น…') : t('trace.search', 'ตามรอย')}
              </button>
              {scan.supported && (
                <button onClick={() => setScanning((s) => !s)} className={`btn-secondary inline-flex items-center gap-1.5 ${scanning ? 'border-emerald-500/60 text-emerald-300' : ''}`}>
                  <Icon name="camera" size={14} /> {scanning ? t('trace.scanStop', 'ปิดกล้อง') : t('trace.scan', 'สแกน QR')}
                </button>
              )}
            </div>
            {scan.error && <div className="text-xs text-red-400">{scan.error}</div>}
            {scanning && (
              <div className="relative rounded-lg overflow-hidden border border-emerald-700/40 bg-black max-w-sm">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={scan.videoRef} className="w-full" muted playsInline />
                <div className="absolute inset-6 border-2 border-emerald-400/70 rounded-lg pointer-events-none" />
                <div className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-emerald-300 font-mono">{t('trace.scanHint', 'ชี้กล้องที่ QR บนสินค้า')}</div>
              </div>
            )}
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}

          {/* ── ผลตามรอย ── */}
          {lot && (
            <div className="space-y-4">
              <div className="card panel-glow p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-lg font-bold text-emerald-300 glow-text tracking-widest">{lot.lotCode}</span>
                  {lot.crop && <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 inline-flex items-center gap-1"><Icon name="farm" size={12} /> {lot.crop}</span>}
                  {lot.sold && <span className="px-2 py-0.5 rounded-full text-xs bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">{t('trace.sold', 'ขายแล้ว')}</span>}
                  {isAuthenticated && (
                    <button onClick={() => genQr(lot.lotCode)} className="ml-auto btn-secondary text-xs inline-flex items-center gap-1.5">
                      <Icon name="grid" size={13} /> {t('trace.qrBtn', 'QR ติดสินค้า')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                    <div className="text-gray-500">{t('trace.quantity', 'ปริมาณ')}</div>
                    <div className="mono text-sm text-gray-100">{lot.quantityKg} {t('trace.kg', 'กก.')}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                    <div className="text-gray-500">{t('trace.harvested', 'เก็บเกี่ยว')}</div>
                    <div className="text-gray-100">{fmtDate(lot.harvestedAt)}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                    <div className="text-gray-500">{t('trace.plot', 'แปลงต้นทาง')}</div>
                    <div className="text-gray-100">{lot.plotName ?? '—'}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                    <div className="text-gray-500">{t('trace.location', 'ตำแหน่ง')}</div>
                    <div className="text-gray-100">{lot.plotLocation ?? '—'}</div>
                  </div>
                </div>

                {/* QR ติดสินค้า */}
                {qr && qr.lotCode === lot.lotCode && (
                  <div className="flex flex-wrap items-center gap-4 bg-gray-950/60 border border-emerald-800/50 rounded-lg p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr.qrDataUrl} alt={`QR ${qr.lotCode}`} width={120} height={120} className="rounded bg-white p-1" />
                    <div className="text-xs space-y-1 min-w-0">
                      <div className="text-emerald-300 font-bold">{t('trace.qrTitle', 'ฉลาก QR สำหรับติดสินค้า')}</div>
                      <div className="text-gray-400 break-all">{qr.url}</div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={printQr} className="px-3 py-1 rounded bg-emerald-700/60 hover:bg-emerald-700 border border-emerald-600/50 text-emerald-100 font-bold inline-flex items-center gap-1"><Icon name="file" size={12} /> {t('trace.qrPrint', 'ปริ้นฉลาก')}</button>
                        <button onClick={() => navigator.clipboard?.writeText(qr.url)} className="btn-secondary text-xs">{t('trace.qrCopy', 'คัดลอกลิงก์')}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ไทม์ไลน์ */}
              <div className="card p-5">
                <h3 className="text-xs font-bold tracking-widest text-gray-300 mb-3 flex items-center gap-1.5"><Icon name="history" size={13} /> {t('trace.timeline', 'ไทม์ไลน์ตามรอย')}</h3>
                {lot.events.length === 0 ? (
                  <div className="text-xs text-gray-500">{t('trace.noEvents', 'ยังไม่มีเหตุการณ์')}</div>
                ) : (
                  <ol className="relative border-l-2 border-gray-800 ml-2 space-y-4">
                    {lot.events.map((ev, i) => {
                      const st = eventStyle(ev.type);
                      return (
                        <li key={i} className="ml-5">
                          <span className={`absolute -left-[11px] w-5 h-5 rounded-full border flex items-center justify-center ${st.cls}`} style={{ backgroundColor: '#0a0f0a' }}>
                            <Icon name={st.icon as any} size={11} />
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}>{eventLabel(ev.type, t)}</span>
                            <span className="text-[11px] text-gray-500">{fmtDate(ev.at)}</span>
                          </div>
                          {ev.detail && <div className="text-xs text-gray-300 mt-1">{ev.detail}</div>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          )}

          {/* ── รายการล็อตล่าสุด (login) ── */}
          {!lot && !error && lots.length > 0 && (
            <div className="card p-5">
              <h3 className="text-xs font-bold tracking-widest text-gray-300 mb-3 flex items-center gap-1.5"><Icon name="layers" size={13} /> {t('trace.recent', 'ล็อตล่าสุด')}</h3>
              <div className="grid md:grid-cols-2 gap-2">
                {lots.slice(0, 12).map((l) => (
                  <button key={l.lotCode} onClick={() => search(l.lotCode)} className="text-left border border-gray-800 rounded-lg p-3 hover:border-emerald-600/50 transition-colors group">
                    <div className="flex items-center gap-2">
                      <span className="mono text-sm font-bold text-emerald-300 group-hover:text-emerald-200">{l.lotCode}</span>
                      {l.crop && <span className="text-xs text-gray-400">{l.crop}</span>}
                      <span className="ml-auto text-[11px] text-gray-500">{l.events?.[0]?.type ? eventLabel(l.events[0].type, t) : ''}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {l.quantityKg} {t('trace.kg', 'กก.')} · {l.plot?.name ?? '—'} · {fmtDate(l.harvestedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ยังไม่ค้น + ไม่มีรายการ */}
          {!lot && !error && lots.length === 0 && (
            <div className="card"><EmptyState icon={<Icon name="search" size={20} />} title={t('trace.empty', 'เริ่มตามรอยที่รหัสล็อต')} description={t('trace.emptyDesc', 'รหัสอยู่บนฉลาก QR ของสินค้า หรือจากหน้าเก็บเกี่ยว (รูปแบบ LOT-XXXXXX)')} /></div>
          )}

          <footer className="text-center text-[10px] text-gray-600 pt-2">
            Powered by <a href="https://github.com/krisakornutama/sovereign-dms" className="hover:text-gray-400 underline underline-offset-2">Sovereign OS</a> · open source
          </footer>
        </main>
      </div>
    </div>
  );
}
