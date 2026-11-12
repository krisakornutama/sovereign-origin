"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { roleIsSuperadmin } from '../lib/roles';
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
// คำนำหน้า action_type ของวงจรรหัสผ่าน — ใช้เป็นปุ่มกรองด่วนในหน้า
const PASSWORD_PREFIX = 'USER_PASSWORD';

export default function AuditPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [limit, setLimit] = useState(100);
  // แบ่งหน้าแบบ offset: เห็นแค่ N แถวล่าสุดไม่พอสำหรับ "ตรวจย้อนได้"
  // — API บอก "มีต่อไหม" ทาง header (ดึงเกินมา 1 แถว) ไม่ต้องนับทั้งตาราง
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [passwordOnly, setPasswordOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  // ช่วงวันเวลา — ต้องเป็นเวลาสัมบูรณ์ (ISO) ไม่ใช่สตริง datetime-local ดิบ ๆ
  // เพราะ browser กับ server อยู่คนละ timezone ได้: แปลงที่ browser แล้วส่ง ISO
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // ผลของการส่งออก — ไฟล์ที่ถูกตัดเพดานต้องบอกให้รู้ ไม่ใช่เงียบ
  const [exportNote, setExportNote] = useState<{ rows: number; total: number; truncated: boolean } | null>(null);

  const rangeParams = (params: URLSearchParams) => {
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) params.set('from', d.toISOString());
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) params.set('to', d.toISOString());
    }
    return params;
  };

  // ดาวน์โหลด CSV ตามตัวกรองปัจจุบัน — ใช้เป็นหลักฐานส่งผู้ตรวจได้โดยไม่ต้องเปิด DB
  const exportCsv = async () => {
    setExporting(true);
    setError('');
    setExportNote(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (passwordOnly) params.set('actionPrefix', PASSWORD_PREFIX);
      rangeParams(params);
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/audit/export?${params.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // server บอกจำนวนจริงของไฟล์นี้ (header ถูก expose ใน CORS แล้ว) — ถ้าอ่านไม่ได้
      // ให้ถือว่า "ไม่รู้" ไม่ใช่ "ครบ" เพื่อไม่ให้ผู้ใช้เชื่อไฟล์ที่อาจถูกตัด
      const rows = Number(res.headers.get('X-Audit-Export-Rows'));
      const total = Number(res.headers.get('X-Audit-Export-Total'));
      const truncated = res.headers.get('X-Audit-Export-Truncated') === 'true';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (Number.isFinite(rows) && Number.isFinite(total)) setExportNote({ rows, total, truncated });
    } catch (err: any) {
      setError(t('audit.exportError', 'ส่งออกไม่สำเร็จ: {msg}', { msg: err.message || '' }));
    } finally {
      setExporting(false);
    }
  };

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (offset > 0) params.set('offset', String(offset));
      if (query.trim()) params.set('q', query.trim());
      if (passwordOnly) params.set('actionPrefix', PASSWORD_PREFIX);
      rangeParams(params);
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/audit?${params.toString()}`);
      if (!res.ok) {
        // 400 จากเพดานผลค้นหามีข้อความบอกทางแก้ — ต้องแสดงข้อความนั้น ไม่ใช่ "HTTP 400"
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLogs(data);
      setHasMore(res.headers.get('X-Audit-List-Has-More') === 'true');
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
  }, [isHydrated, isAuthenticated, limit, passwordOnly, offset]);

  if (!isHydrated) {
    return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('audit.unauthorized', 'Unauthorized')}</div>;
  }

  if (!roleIsSuperadmin(user.role)) {
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
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('audit.eyebrow', 'ระบบ')}
          title="บันทึกการตรวจสอบ"
          icon={<Icon name="audit" size={18} />}
          subtitle="ใครทำอะไรในระบบนี้ ทุกอย่างถูกจดไว้" actions={<div className="flex gap-3 items-center">
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">Dashboard</Link>
        </div>}
        />

      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('audit.title', 'ประวัติการกระทำ (Audit Log)')}</h2>
          <div className="flex gap-3 items-center">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                // เปลี่ยนตัวกรองแล้วต้องกลับหน้าแรก ไม่งั้นจะค้างอยู่ offset เก่า
                // แล้วเห็น "ว่าง" ทั้งที่มีข้อมูล (อ่านผิดว่าไม่มีเหตุการณ์)
                if (offset !== 0) setOffset(0);
                else loadLogs();
              }}
              className="flex gap-2 items-center"
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('audit.searchPlaceholder', 'ค้น action/payload เช่น somchai, /api/users')}
                className="input text-sm w-64"
              />
              <button type="submit" className="btn-secondary" disabled={loading}>
                {t('audit.search', 'ค้นหา')}
              </button>
            </form>
            <button
              onClick={() => {
                setPasswordOnly((v) => !v);
                if (offset !== 0) setOffset(0);
              }}
              className={passwordOnly ? 'btn-primary' : 'btn-secondary'}
            >
              🔑 {t('audit.passwordOnly', 'เรื่องรหัสผ่าน')}
            </button>
            <button onClick={exportCsv} className="btn-secondary" disabled={exporting || loading}>
              ⬇ {exporting ? t('audit.exporting', 'กำลังส่งออก...') : t('audit.exportCsv', 'ส่งออก CSV')}
            </button>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                if (offset !== 0) setOffset(0);
              }}
              className="input text-sm"
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>{t('audit.showLimit', 'แสดง {n} รายการ', { n })}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ช่วงเวลา — ตัวกรองใช้ทั้งรายการและไฟล์ export (กด "ค้นหา" เพื่อใช้กับรายการ) */}
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-gray-500">{t('audit.rangeLabel', 'ช่วงเวลา')}</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input text-sm"
            aria-label={t('audit.fromLabel', 'ตั้งแต่')}
          />
          <span className="text-gray-500">–</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input text-sm"
            aria-label={t('audit.toLabel', 'ถึง')}
          />
          {(from || to) && (
            <button
              type="button"
              onClick={() => { setFrom(''); setTo(''); }}
              className="btn-secondary"
            >
              {t('audit.clearRange', 'ล้างช่วง')}
            </button>
          )}
          <span className="text-xs text-gray-500">{t('audit.rangeHint', 'ใช้กับทั้งรายการและไฟล์ที่ส่งออก')}</span>
        </div>

        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        {exportNote && (
          <div className={`card p-3 text-sm ${exportNote.truncated ? 'text-amber-300 border border-amber-700/60' : 'text-emerald-300'}`}>
            {exportNote.truncated
              ? t(
                  'audit.exportTruncated',
                  'ไฟล์ที่ได้มี {rows} จากทั้งหมด {total} รายการ — ถูกตัดเพราะถึงเพดานต่อไฟล์ อย่าส่งต่อว่าเป็นข้อมูลครบทั้งช่วง ให้แบ่งช่วงวันที่แล้วส่งออกหลายไฟล์',
                  { rows: exportNote.rows, total: exportNote.total }
                )
              : t('audit.exportComplete', 'ส่งออกครบทั้งช่วงแล้ว: {rows} รายการ', { rows: exportNote.rows })}
          </div>
        )}

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
                <tr key={log.id} className={log.action_type.startsWith(PASSWORD_PREFIX) ? 'bg-amber-500/10 hover:bg-amber-500/20' : 'hover:bg-gray-800/50'}>
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

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
          <span>
            {logs.length > 0
              ? t('audit.rangeShown', 'รายการที่ {from}–{to} (ใหม่สุดก่อน)', { from: offset + 1, to: offset + logs.length })
              : offset > 0
                ? t('audit.emptyPage', 'ไม่พบรายการในหน้านี้ — กลับไปหน้าแรก')
                : t('audit.noLogsShort', 'ยังไม่มีรายการ')}
          </span>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0 || loading}
              className="btn-secondary"
            >
              {t('audit.prevPage', '← ก่อนหน้า')}
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + limit)}
              disabled={!hasMore || loading}
              className="btn-secondary"
            >
              {t('audit.nextPage', 'ถัดไป →')}
            </button>
          </div>
        </div>
      </main>
    </div>
      </div>
  );
}
