"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { roleIsSuperadmin } from '../lib/roles';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

// ────────────────────────────────────────────────────────────────────────────
// /alert-history — ประวัติ alert ทั้งหมดของระบบ (Phase 3: ช่องทางแจ้งเตือนที่ 2)
// ย้อนดูได้ว่า truth-watchdog/dispatcher เคยแจ้งอะไรเมื่อไร ส่ง Telegram สำเร็จหรือ
// ถูกยับ (dedup/rate-limit) — จบเคส "Telegram token พังแล้วไม่มีใครรู้ว่าระบบเคยเตือน"
// ข้อมูลจาก GET /api/telegram/alerts ← ตาราง alert_events (telegram เป็นเจ้าของ)
// ────────────────────────────────────────────────────────────────────────────

interface AlertEvent {
  id: string;
  createdAt: string;
  severity: 'critical' | 'warn' | 'info' | string;
  eventKey: string;
  title: string;
  detail: string;
  sent: boolean;
  suppressed: string | null;
  source: string;
}

interface AlertsPayload {
  events: AlertEvent[];
  stats24h: Record<string, number>;
}

const SEV_CLS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

export default function AlertHistoryPage() {
  const user = useAuthStore((s) => s.user);
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState<string>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = sevFilter === 'ALL' ? '' : `?severity=${sevFilter}`;
      const res = await authFetch(`${getApiUrl()}/api/telegram/alerts?limit=200${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  }, [sevFilter]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // รีเฟรชเบา ๆ ทุก 30 วิ
    return () => clearInterval(iv);
  }, [load]);

  if (!roleIsSuperadmin(user?.role)) {
    return (
      <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 p-8">
        {t('alertHistory.superadminOnly', 'หน้านี้ใช้ได้เฉพาะ SUPERADMIN')}
      </div>
    );
  }

  const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={t('alertHistory.eyebrow', 'ระบบ')}
          title={t('alertHistory.title', 'ประวัติแจ้งเตือน')}
          icon={<Icon name="system" size={18} />}
          subtitle={t('alertHistory.subtitle', 'ทุก alert ที่ระบบจดไว้ — ส่ง Telegram สำเร็จหรือถูกยับ ย้อนดูได้เสมอ')}
          actions={
            data && (
              <div className="flex gap-2 text-xs">
                {(['critical', 'warn', 'info'] as const).map((sev) => (
                  <span key={sev} className={`px-2 py-1 rounded-full border ${SEV_CLS[sev]}`}>
                    {sev}: {data.stats24h?.[sev] ?? 0}/24ชม.
                  </span>
                ))}
              </div>
            )
          }
        />
        <main className="flex-1 p-4 lg:p-6 space-y-4 max-w-7xl mx-auto w-full">
          {/* ตัวกรอง severity */}
          <div className="flex gap-2 text-sm">
            {['ALL', 'critical', 'warn', 'info'].map((sev) => (
              <button key={sev} onClick={() => { setLoading(true); setSevFilter(sev); }}
                className={`px-3 py-1.5 rounded-lg border ${sevFilter === sev ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200' : 'border-gray-700 hover:bg-gray-800/40 text-gray-400'}`}>
                {sev === 'ALL' ? t('alertHistory.all', 'ทั้งหมด') : sev}
              </button>
            ))}
          </div>

          {loading && <div className="text-gray-400">{t('alertHistory.loading', 'กำลังโหลด…')}</div>}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm">
              {t('alertHistory.loadError', 'โหลดข้อมูลไม่ได้')}: {error}
            </div>
          )}
          {data && !loading && data.events.length === 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 text-gray-400 text-sm">
              {t('alertHistory.empty', 'ยังไม่มี alert ที่จดไว้ — ระบบปกติดี หรือ watchdog ยังไม่เคยเจอความผิดปกติ')}
            </div>
          )}
          {data && !loading && data.events.map((ev) => (
            <button key={ev.id} onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
              className="w-full text-left rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-2 hover:border-gray-700 transition-colors">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded-full border text-xs ${SEV_CLS[ev.severity] ?? SEV_CLS.info}`}>{ev.severity}</span>
                <span className="font-medium">{ev.title}</span>
                {ev.sent ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✓ ส่งแล้ว</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-600/30 text-gray-400 border border-gray-600" title={ev.suppressed ?? ''}>ยับ: {ev.suppressed ?? '—'}</span>
                )}
                <span className="ml-auto text-xs text-gray-500">{fmtTime(ev.createdAt)}</span>
              </div>
              <div className="flex gap-2 text-[10px] text-gray-500">
                <span className="px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-700">{ev.source}</span>
                <span className="font-mono truncate max-w-xs">{ev.eventKey}</span>
              </div>
              {expanded === ev.id && (
                <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-300 bg-gray-950/70 border border-gray-800 rounded-lg p-3 max-h-72 overflow-auto">{ev.detail}</pre>
              )}
            </button>
          ))}
        </main>
      </div>
    </div>
  );
}
