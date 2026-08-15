"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface Report {
  id: string;
  type: string; // daily | weekly
  title: string;
  summary: string;
  created_at: string;
}

export default function ReportsPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
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
      setError('โหลดรายงานไม่สำเร็จ — ตรวจว่า backend เปิดอยู่และรัน migration ล่าสุดแล้ว');
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
      setMessage(`✅ สร้างรายงานแล้ว: ${report.title}`);
      await loadReports();
    } catch (err) {
      console.error(err);
      setError('สร้างรายงานไม่สำเร็จ — ตรวจว่า Ollama เปิดอยู่และมีข้อมูลใน TimescaleDB');
    } finally {
      setGenerating(false);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ข้อมูล &amp; รายงาน"
          title="📊 AI Reports" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={() => generate('daily')}
            disabled={generating}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {generating ? '⏳ กำลังสร้าง…' : '🌅 สร้างรายงานวันนี้'}
          </button>
          <button
            onClick={() => generate('weekly')}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {generating ? '⏳ กำลังสร้าง…' : '📅 สร้างรายงานสัปดาห์'}
          </button>
          <button
            onClick={loadReports}
            disabled={loading}
            className="px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded-lg text-sm disabled:opacity-50"
          >
            🔄 รีเฟรช
          </button>
        </div>

        {message && <div className="text-sm text-green-400 bg-green-900/30 border border-green-700 rounded-lg px-4 py-3">{message}</div>}
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}

        <div className="text-xs text-gray-500">
          🤖 รายงานอัตโนมัติ: ทุกเช้า 06:00 (รายวัน) และวันอาทิตย์ 07:00 (รายสัปดาห์) — สรุปโดย AI จากข้อมูล TimescaleDB และส่งเข้า Telegram
        </div>

        {loading && reports.length === 0 && <div className="text-gray-500">⏳ กำลังโหลด…</div>}

        {!loading && reports.length === 0 && (
          <div className="text-gray-500 bg-gray-900 border border-gray-700 rounded-xl p-6 text-center">
            ยังไม่มีรายงาน — กดปุ่มด้านบนเพื่อสร้างรายงานแรก
          </div>
        )}

        <div className="space-y-4">
          {reports.map((r) => (
            <div key={r.id} className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h2 className="text-base font-bold text-green-400">{r.title}</h2>
                <span
                  className={
                    r.type === 'weekly'
                      ? 'text-[10px] px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700'
                      : 'text-[10px] px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700'
                  }
                >
                  {r.type === 'weekly' ? 'รายสัปดาห์' : 'รายวัน'}
                </span>
              </div>
              <div className="text-xs text-gray-500 mb-3">
                🕐 {new Date(r.created_at).toLocaleString('th-TH')}
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
