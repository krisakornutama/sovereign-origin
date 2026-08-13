"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

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
      setError(`❌ ${err.message || 'ไม่สามารถดึง audit log ได้'}`);
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
    return <div className="text-white p-8">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  if (user.role !== 'SUPERADMIN') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-mono p-8">
        🔒 หน้านี้ใช้ได้เฉพาะ SUPERADMIN
      </div>
    );
  }

  const statusColor = (s?: number) => {
    if (!s) return 'text-gray-400';
    if (s < 300) return 'text-green-400';
    if (s < 400) return 'text-blue-400';
    if (s < 500) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ระบบ"
          title="🏰 SOVEREIGN OS"
          subtitle="Audit Log" actions={<div className="flex gap-3 items-center">
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>
        </div>}
        />
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">📜 ประวัติการกระทำ (Audit Log)</h2>
          <div className="flex gap-3 items-center">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>แสดง {n} รายการ</option>
              ))}
            </select>
            <button
              onClick={loadLogs}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
            >
              🔄 รีเฟรช
            </button>
          </div>
        </div>

        {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>}

        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">เวลา</th>
                <th className="px-4 py-3">ผู้ใช้</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('th-TH')}
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
                        <summary className="cursor-pointer select-none">ดู</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-[10px] text-gray-400 bg-gray-950/60 border border-gray-800 rounded p-2">
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
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">ยังไม่มีประวัติการกระทำ</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">⏳ กำลังโหลด...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">แสดง {logs.length} รายการ (ล่าสุดก่อน)</div>
      </main>
    </div>
      </div>
  );
}
