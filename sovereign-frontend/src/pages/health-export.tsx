"use client";
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

export default function HealthExportPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/export?format=html&days=30`)
      .then(async (res) => {
        if (!res.ok) throw new Error('load failed');
        setHtml(await res.text());
      })
      .catch((err) => {
        console.error(err);
        setError('โหลดรายงานไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, user]);

  const downloadCsv = async () => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/export?format=csv&days=30`);
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'health-report-30d.csv';
    link.click();
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
          title="📄 รายงานสุขภาพ 30 วัน (ส่งแพทย์)" actions={<div className="flex items-center gap-3">
          <button onClick={() => (window.frames[0] as any)?.print?.() ?? window.print()} disabled={!html} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm">🖨️ พิมพ์ / บันทึก PDF</button>
          <button onClick={downloadCsv} className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm">📥 ดาวน์โหลด CSV</button>
          <a href="/health" className="text-sm text-blue-400 hover:underline">← กลับ</a>
        </div>}
        />
      </header>
      <main className="max-w-4xl mx-auto p-6">
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}
        {loading && <div className="text-gray-500">⏳ กำลังโหลด…</div>}
        {html && (
          <iframe
            title="รายงานสุขภาพ"
            srcDoc={html}
            sandbox="allow-same-origin allow-modals allow-popups"
            className="w-full h-[75vh] bg-white rounded-xl border border-gray-700"
          />
        )}
      </main>
    </div>
      </div>
  );
}
