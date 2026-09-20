"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';

export default function HealthExportPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
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
        setError(t('healthExport.loadFailed', 'โหลดรายงานไม่สำเร็จ'));
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
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('healthExport.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="atmo-wellness min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          title={t('healthExport.page.title', 'รายงานสุขภาพ 30 วัน (ส่งแพทย์)')} icon={<Icon name="reports" size={18} />} actions={<div className="flex items-center gap-3">
          <button onClick={() => (window.frames[0] as any)?.print?.() ?? window.print()} disabled={!html} className="btn-primary"><Icon name="file" size={13} /> {t('healthExport.printPdf', 'พิมพ์ / บันทึก PDF')}</button>
          <button onClick={downloadCsv} className="btn-secondary"><Icon name="download" size={13} /> {t('healthExport.downloadCsv', 'ดาวน์โหลด CSV')}</button>
          <Link href="/health" scroll={false} className="text-sm text-sky-400 hover:underline">{t('healthExport.back', '← กลับ')}</Link>
        </div>}
        />
      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-4xl mx-auto w-full">
        {error && <div className="text-sm text-red-400 inset px-4 py-3">{error}</div>}
        {loading && <div className="text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>}
        {html && (
          <iframe
            title={t('healthExport.frameTitle', 'รายงานสุขภาพ')}
            srcDoc={html}
            sandbox="allow-same-origin allow-modals allow-popups"
            className="w-full h-[75vh] bg-white rounded-xl border border-gray-700 panel-cyan"
          />
        )}
      </main>
    </div>
      </div>
  );
}
