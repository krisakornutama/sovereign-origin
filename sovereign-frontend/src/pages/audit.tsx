"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

interface AuditPayload {
  method?: string;
  path?: string;
  statusCode?: number;
  ip?: string;
  [key: string]: any;
}

interface AuditLog {
  id: string;
  timestamp: string;
  action_type: string;
  payload?: AuditPayload;
  user?: { username: string } | null;
}

const LIMIT_OPTIONS = [50, 100, 200, 500];

export default function AuditPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/audit?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogs(data);
    } catch (err: any) {
      setError(`${err.message || t('audit.loadError', 'ไม่สามารถดึง audit log ได้')}`);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadLogs();
  }, [isHydrated, isAuthenticated, limit]);

  if (!isHydrated) {
    return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('audit.unauthorized', 'Unauthorized')}</div>;
  }

  if (user.role !== 'SUPERADMIN') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
        {t('audit.superadminOnly', 'หน้านี้ใช้ได้เฉพาะ SUPERADMIN')}
      </div>
    );
  }

  const statusColor = (s?: number) => {
    if (!s) return 'text-gray-400';
    if (s < 300) return 'text-emerald-400';
    if (s < 400) return 'text-blue-400';
    if (s < 500) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('audit.eyebrow', 'ระบบ')}
          title="SOVEREIGN OS"
          icon={<Icon name="audit" size={18} />}
          subtitle="Audit Log" actions={<div className="flex gap-3 items-center">
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">Dashboard</Link>
        </div>}
        />

      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('audit.title', 'ประวัติการกระทำ (Audit Log)')}</h2>
          <div className="flex gap-3 items-center">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="input text-sm"
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>{t('audit.showLimit', 'แสดง {n} รายการ', { n })}</option>
              ))}
            </select>
            <button
              onClick={loadLogs}
              className="btn-secondary"
            >
              <Icon name="refresh" size={14} />
              {t('common.refresh', 'รีเฟรช')}
            </button>
          </div>
        </div>

        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        <div className="card panel-cyan overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-emerald-500/50 via-cyan-500/30 to-transparent" />
          <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-950/40 backdrop-blur-sm">
              <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                <th className="px-4 py-3 font-semibold">{t('common.time', 'เวลา')}</th>
                <th className="px-4 py-3 font-semibold">{t('audit.colUser', 'ผู้ใช้')}</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 font-semibold">Path</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">IP</th>
                <th className="px-4 py-3 font-semibold">{t('common.details', 'รายละเอียด')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString(fmtLocale())}
                  </td>
                  <td className="px-4 py-2 text-gray-200">{log.user?.username || '-'}</td>
                  <td className="px-4 py-2 text-green-300 whitespace-nowrap">{log.action_type}</td>
                  <td className="px-4 py-2 text-xs">{log.payload?.method || '-'}</td>
                  <td className="px-4 py-2 text-xs text-gray-300 break-all">{log.payload?.path || '-'}</td>
                  <td className={`px-4 py-2 font-bold ${statusColor(log.payload?.statusCode)}`}>
                    {log.payload?.statusCode ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{log.payload?.ip || '-'}</td>
                  <td className="px-4 py-2 text-xs">
                    {log.payload ? (
                      <details className="text-gray-500 hover:text-gray-300">
                        <summary className="cursor-pointer select-none">{t('audit.view', 'ดู')}</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-[10px] text-gray-400 bg-gray-950/60 border border-cyan-800/50 rounded p-2">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('audit.noLogs', 'ยังไม่มีประวัติการกระทำ')}</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="text-xs text-gray-500">{t('audit.countLabel', 'แสดง {n} รายการ (ล่าสุดก่อน)', { n: logs.length })}</div>
      </main>
    </div>
      </div>
  );
}
