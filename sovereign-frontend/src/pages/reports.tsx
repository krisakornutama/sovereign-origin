"use client";
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

interface Report {
  id: string;
  type: string; // daily | weekly
  title: string;
  summary: string;
  created_at: string;
}

export default function ReportsPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/reports?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReports(await res.json());
    } catch (err) {
      console.error(err);
      setError(t('reports.loadError', 'โหลดรายงานไม่สำเร็จ — ตรวจว่า backend เปิดอยู่และรัน migration ล่าสุดแล้ว'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    loadReports();
  }, [isAuthenticated, user, loadReports]);

  const generate = async (type: 'daily' | 'weekly') => {
    setGenerating(true);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const report = await res.json();
      setMessage(t('reports.created', 'สร้างรายงานแล้ว: {title}', { title: report.title }));
      await loadReports();
    } catch (err) {
      console.error(err);
      setError(t('reports.generateError', 'สร้างรายงานไม่สำเร็จ — ตรวจว่า Ollama เปิดอยู่และมีข้อมูลใน TimescaleDB'));
    } finally {
      setGenerating(false);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('reports.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('reports.eyebrow', 'ข้อมูล & รายงาน')}
          title="AI Reports" icon={<Icon name="reports" size={18} />} actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('reports.backDashboard', '← กลับ Dashboard')}</Link>}
        />
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={() => generate('daily')}
            disabled={generating}
            className="btn-primary"
          >
            {generating ? t('reports.generating', 'กำลังสร้าง…') : t('reports.generateDaily', 'สร้างรายงานวันนี้')}
          </button>
          <button
            onClick={() => generate('weekly')}
            disabled={generating}
            className="btn-primary"
          >
            {generating ? t('reports.generating', 'กำลังสร้าง…') : (
              <>
                <Icon name="calendar" size={14} />
                {t('reports.generateWeekly', 'สร้างรายงานสัปดาห์')}
              </>
            )}
          </button>
          <button
            onClick={loadReports}
            disabled={loading}
            className="btn-secondary"
          >
            <Icon name="refresh" size={14} />
            {t('common.refresh', 'รีเฟรช')}
          </button>
        </div>

        {message && <div className="card px-4 py-3 text-sm text-emerald-400">{message}</div>}
        {error && <div className="card px-4 py-3 text-sm text-rose-400">{error}</div>}

        <div className="text-xs text-gray-500">
          {t('reports.automationNote', 'รายงานอัตโนมัติ: ทุกเช้า 06:00 (รายวัน) และวันอาทิตย์ 07:00 (รายสัปดาห์) — สรุปโดย AI จากข้อมูล TimescaleDB และส่งเข้า Telegram')}
        </div>

        {loading && reports.length === 0 && <div className="text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>}

        {!loading && reports.length === 0 && (
          <div className="card p-6 text-center">
            {t('reports.noReports', 'ยังไม่มีรายงาน — กดปุ่มด้านบนเพื่อสร้างรายงานแรก')}
          </div>
        )}

        <div className="space-y-4">
          {reports.map((r) => (
            <div key={r.id} className="card panel-cyan p-5">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{r.title}</h2>
                <span
                  className={
                    r.type === 'weekly'
                      ? 'text-[10px] px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700'
                      : 'text-[10px] px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700'
                  }
                >
                  {r.type === 'weekly' ? t('reports.weekly', 'รายสัปดาห์') : t('reports.daily', 'รายวัน')}
                </span>
              </div>
              <div className="text-xs text-gray-500 mb-3">
                {new Date(r.created_at).toLocaleString(fmtLocale())}
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{r.summary}</pre>
            </div>
          ))}
        </div>
      </main>
    </div>
      </div>
  );
}
