"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface BackupEntry {
  file: string;
  size: number;
  date: string;
}

interface Schedule {
  enabled: boolean;
  time: string;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export default function BackupPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, time: '02:00' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const t = useLanguageStore((s) => s.t);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backup`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBackups(data.backups || []);
      setSchedule(data.schedule || { enabled: false, time: '02:00' });
    } catch (err) {
      console.error(err);
      setError(t('backup.loadingFail', 'โหลดข้อมูล backup ไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load();
  }, [isAuthenticated, user, load]);

  const createBackup = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backup`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage(t('backup.created', 'สร้าง backup สำเร็จ'));
      await load();
    } catch (err) {
      console.error(err);
      setError(t('backup.createFailed', 'สร้าง backup ไม่สำเร็จ: {msg}', { msg: (err as Error).message || 'unknown' }));
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backup/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(t('backup.scheduleSaved', 'บันทึกตารางเวลา backup แล้ว'));
    } catch (err) {
      console.error(err);
      setError(t('backup.scheduleSaveFailed', 'บันทึกตารางเวลาไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: string) => {
    if (!window.confirm(t('backup.restoreConfirm', 'ต้องการกู้คืนฐานข้อมูลจาก "{file}" หรือไม่?\nข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์ backup นี้', { file }))) return;
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage(t('backup.restored', 'กู้คืนสำเร็จ — backend อาจรีสตาร์ทเพื่อให้ระบบทำงานปกติ'));
    } catch (err) {
      console.error(err);
      setError(t('backup.restoreFailed', 'กู้คืนไม่สำเร็จ: {msg}', { msg: (err as Error).message || 'unknown' }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: string) => {
    if (!window.confirm(t('backup.deleteConfirm', 'ลบไฟล์ backup "{file}"?', { file }))) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backup/${encodeURIComponent(file)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      console.error(err);
      setError(t('backup.deleteFailed', 'ลบไม่สำเร็จ'));
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('backup.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('backup.page.eyebrow', 'ระบบ')}
          title="Backup &amp; Restore" icon={<Icon name="backup" size={18} />} actions={<a href="/dashboard" className="text-sm text-sky-400 hover:underline">{t('backup.page.backDashboard', '← กลับ Dashboard')}</a>}
        />
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {!isSuperAdmin && (
          <div className="card px-4 py-3 text-sm text-amber-400">
            {t('backup.adminOnly', 'หน้า Backup ใช้งานได้เฉพาะ SUPERADMIN')}
          </div>
        )}

        {message && <div className="card p-3 text-sm text-emerald-400">{message}</div>}
        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Backup ตอนนี้ */}
          <div className="panel panel-glow p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('backup.createNow', 'สร้าง Backup ตอนนี้')}</h2>
            <p className="text-xs text-gray-500">{t('backup.createHint', 'Dump ฐานข้อมูล TimescaleDB + บีบอัดเก็บไว้ในโฟลเดอร์ backups')}</p>
            <button
              onClick={createBackup}
              disabled={busy || !isSuperAdmin}
              className="btn-primary w-full"
            >
              {busy ? t('backup.working', 'กำลังทำงาน…') : <><Icon name="backup" size={14} /> {t('backup.nowBtn', 'Backup ตอนนี้')}</>}
            </button>
          </div>

          {/* ตารางเวลาอัตโนมัติ */}
          <div className="panel panel-glow p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('backup.autoTitle', 'Backup อัตโนมัติ')}</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
                  className="w-4 h-4 accent-green-500"
                />
                {t('common.enabled', 'เปิดใช้งาน')}
              </label>
              <input
                type="time"
                value={schedule.time}
                onChange={(e) => setSchedule({ ...schedule, time: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-white"
              />
            </div>
            <button
              onClick={saveSchedule}
              disabled={busy || !isSuperAdmin}
              className="btn-primary w-full"
            >
              {t('backup.scheduleLabel', 'บันทึกตารางเวลา')}
            </button>
          </div>
        </div>

        {/* รายการไฟล์ */}
        <div className="panel panel-cyan p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('backup.filesTitle', 'ไฟล์ Backup ({n})', { n: backups.length })}</h2>
            <button
              onClick={load}
              disabled={loading}
              className="btn-secondary"
            >
              <Icon name="refresh" size={14} /> {t('common.refresh', 'รีเฟรช')}
            </button>
          </div>

          {loading && backups.length === 0 && <div className="text-gray-500 text-sm">{t('common.loading', 'กำลังโหลด…')}</div>}

          {!loading && backups.length === 0 && (
            <div className="text-gray-500 text-sm text-center py-6">{t('backup.empty', 'ยังไม่มีไฟล์ backup — กดปุ่ม "Backup ตอนนี้"')}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700">
                  <th className="py-2 pr-4">{t('backup.thFile', 'ไฟล์')}</th>
                  <th className="py-2 pr-4">{t('backup.thSize', 'ขนาด')}</th>
                  <th className="py-2 pr-4">{t('common.date', 'วันที่')}</th>
                  <th className="py-2">{t('common.actions', 'การจัดการ')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.file} className="border-b border-gray-800">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-300">{b.file}</td>
                    <td className="py-2 pr-4 text-gray-400">{formatSize(b.size)}</td>
                    <td className="py-2 pr-4 text-gray-400">{new Date(b.date).toLocaleString(fmtLocale())}</td>
                    <td className="py-2 space-x-2">
                      <button
                        onClick={() => restore(b.file)}
                        disabled={busy || !isSuperAdmin}
                        className="text-xs px-2.5 py-1 bg-yellow-700/50 hover:bg-yellow-700 border border-yellow-600 rounded disabled:opacity-40"
                      >
                        {t('backup.restore', 'กู้คืน')}
                      </button>
                      <button
                        onClick={() => remove(b.file)}
                        disabled={busy || !isSuperAdmin}
                        className="text-xs px-2.5 py-1 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded disabled:opacity-40"
                      >
                        <Icon name="trash" size={14} /> {t('common.delete', 'ลบ')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
      </div>
  );
}
