"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import {
  getApiUrl,
  setApiUrl,
  getTheme,
  setTheme,
  getFontScale,
  setFontScale,
  applyAppearance,
  resetUserSettings,
  type Theme,
  type FontScale,
} from '../lib/config';
import { authFetch } from '../lib/apiFetch';
import { useOfflineSync } from '../hooks/useOfflineSync';
import {
  listQueued,
  removeQueued,
  flushSelected,
  type QueuedAction,
} from '../lib/offlineQueue';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

export default function SettingsPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const [apiUrl, setApiUrlInput] = useState('');
  const [theme, setThemeState] = useState<Theme>('dark');
  const [fontScale, setFontScaleState] = useState<FontScale>('normal');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status?: number;
    ms?: number;
    detail?: string;
  } | null>(null);
  // ── PWA state ──
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [swStatus, setSwStatus] = useState(t('settings.sw.checking', 'ตรวจสอบ…'));
  const [cacheSize, setCacheSize] = useState('');
  // ── Offline queue state ──
  const { queuedCount, syncNow } = useOfflineSync();
  const [queuedItems, setQueuedItems] = useState<QueuedAction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [queueBusy, setQueueBusy] = useState(false);

  // ── Export & Clone: ติ๊กเลือกฟังก์ชั่น → ส่งออกแพ็กเกจ → นำเข้าเครื่องอื่น ──
  const [cloneModules, setCloneModules] = useState<any[]>([]);
  const [cloneSelected, setCloneSelected] = useState<Set<string>>(new Set());
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneResult, setCloneResult] = useState<{ tables?: number; sizeKb?: number; error?: string } | null>(null);

  useEffect(() => {
    setApiUrlInput(getApiUrl());
    setThemeState(getTheme());
    setFontScaleState(getFontScale());
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadCloneManifest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // จับ beforeinstallprompt เพื่อแสดงปุ่มติดตั้งเอง
    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // สถานะ service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) {
          setSwStatus(t('settings.sw.notRegistered', 'ไม่ได้ลงทะเบียน (ใช้งานเฉพาะ production build)'));
          return;
        }
        const state = reg.active
          ? 'active'
          : reg.installing
            ? 'installing…'
            : reg.waiting
              ? t('settings.sw.waiting', 'waiting (มีเวอร์ชันใหม่)')
              : 'unknown';
        setSwStatus(t('settings.sw.registered', 'ลงทะเบียนแล้ว ({state})', { state }));
      }).catch(() => setSwStatus(t('settings.sw.checkFailed', 'ไม่สามารถตรวจสอบได้')));
    } else {
      setSwStatus(t('settings.sw.unsupported', 'เบราว์เซอร์ไม่รองรับ Service Worker'));
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setMessage(t('settings.install.installed', 'ติดตั้งแอป Sovereign แล้ว'));
        setInstalled(true);
      }
    } catch (err) {
      console.error(err);
      setError(t('settings.install.failed', 'ติดตั้งไม่สำเร็จ'));
    } finally {
      setInstallPrompt(null);
    }
  };

  const measureCache = async () => {
    if (!('caches' in window)) return;
    try {
      const names = await caches.keys();
      let total = 0;
      let entries = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        entries += keys.length;
        for (const k of keys) {
          const resp = await cache.match(k);
          if (resp) total += (await resp.clone().blob()).size;
        }
      }
      const mb = total / 1024 / 1024;
      const sizeText = t('settings.cache.sizeFormat', '{entries} รายการ · {size}', { entries, size: mb >= 1 ? mb.toFixed(2) + ' MB' : (total / 1024).toFixed(1) + ' KB' });
      setCacheSize(sizeText);
      setMessage(t('settings.cache.sizeMsg', 'ขนาด cache: {size}', { size: sizeText }));
    } catch (err) {
      console.error(err);
      setError(t('settings.cache.measureFailed', 'วัดขนาด cache ไม่สำเร็จ'));
    }
  };

  const updateNow = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setError(t('settings.update.noSw', 'ไม่มี service worker ที่ลงทะเบียน'));
        return;
      }
      await reg.update();
      // ถ้ามีเวอร์ชันใหม่รออยู่ → ให้ข้าม waiting แล้วรีโหลด
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setMessage(t('settings.update.found', 'พบเวอร์ชันใหม่ — กำลังอัปเดต... (โหลดใหม่ครั้งหน้าได้เวอร์ชันล่าสุด)'));
      } else {
        setMessage(t('settings.update.latest', 'ตรวจสอบแล้ว — ใช้เวอร์ชันล่าสุดอยู่'));
      }
    } catch (err) {
      console.error(err);
      setError(t('settings.update.failed', 'ตรวจสอบอัปเดตไม่สำเร็จ'));
    }
  };

  // ── Offline queue handlers ──
  const reloadQueue = async () => {
    const items = await listQueued();
    setQueuedItems(items);
    setSelectedIds((prev) => new Set([...prev].filter((id) => items.some((q) => q.id === id))));
  };

  useEffect(() => {
    reloadQueue();
    // reload ทุกครั้งที่ badge เปลี่ยน (คิวถูกเพิ่ม/ลบจากที่อื่น)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedCount]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === queuedItems.length ? new Set() : new Set(queuedItems.map((q) => q.id!))));
  };

  const syncSelected = async () => {
    if (selectedIds.size === 0) return;
    setQueueBusy(true);
    setError('');
    try {
      const flushed = await flushSelected([...selectedIds]);
      const kept = selectedIds.size - flushed;
      setMessage(kept === 0 ? t('settings.queue.syncAllOk', 'sync สำเร็จทั้งหมด {n} รายการ', { n: flushed }) : t('settings.queue.syncPartial', 'sync สำเร็จ {n} รายการ (เหลือ {kept} ที่ยังไม่ได้)', { n: flushed, kept }));
      await reloadQueue();
    } catch (err) {
      console.error(err);
      setError(t('settings.queue.syncFailed', 'sync ไม่สำเร็จ'));
    } finally {
      setQueueBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(t('settings.queue.deleteConfirm', 'ลบ {n} รายการออกจากคิว? (จะไม่ถูกส่ง)', { n: selectedIds.size }))) return;
    setQueueBusy(true);
    for (const id of selectedIds) await removeQueued(id);
    setMessage(t('settings.queue.deleted', 'ลบ {n} รายการแล้ว', { n: selectedIds.size }));
    await reloadQueue();
    setQueueBusy(false);
  };

  const deleteOne = async (id: number) => {
    await removeQueued(id);
    setMessage(t('settings.queue.deletedOne', 'ลบรายการออกจากคิวแล้ว'));
    await reloadQueue();
  };

  const clearCacheAndReload = async () => {
    if (!window.confirm(t('settings.cache.clearConfirm', 'ล้าง cache ทั้งหมดของ PWA แล้วโหลดหน้าใหม่? (ครั้งแรกหลังล้างจะโหลดช้ากว่าปกติเล็กน้อย)'))) return;
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    setCacheSize('');
    setMessage(t('settings.cache.cleared', 'ล้าง cache แล้ว — กำลังโหลดใหม่…'));
    window.location.reload();
  };

  const saveApiUrl = () => {
    const trimmed = apiUrl.trim().replace(/\/+$/, ''); // ตัด slash ท้าย
    setApiUrl(trimmed || null);
    setMessage(t('settings.api.saved', 'บันทึก API URL แล้ว: {url}', { url: trimmed || t('settings.api.default', '(ใช้ค่าเริ่มต้น)') }));
    setError('');
  };

  const resetApiUrl = () => {
    setApiUrl(null);
    setApiUrlInput(getApiUrl());
    setMessage(t('settings.api.resetMsg', 'กลับไปใช้ค่าเริ่มต้นแล้ว'));
    setError('');
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    const base = apiUrl.trim().replace(/\/+$/, '');
    const started = Date.now();
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json().catch(() => ({}));
      setTestResult({
        ok: res.ok && data.status === 'ok',
        status: res.status,
        ms: Date.now() - started,
        detail:
          data.status === 'ok'
            ? t('settings.test.ok', 'Core API ตอบสนองปกติ')
            : res.statusText || `HTTP ${res.status}`,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        ms: Date.now() - started,
        detail: err?.name === 'TimeoutError' ? t('settings.test.timeout', 'หมดเวลา (5 วิ) — ตรวจสอบว่า server เปิดอยู่') : err?.message || t('settings.test.unreachable', 'เชื่อมต่อไม่ได้'),
      });
    } finally {
      setTesting(false);
    }
  };

  // ── Export & Clone ──
  const loadCloneManifest = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/clone/manifest`);
      if (res.ok) {
        const data = await res.json();
        setCloneModules(data.modules || []);
      }
    } catch {
      // เงียบ — หน้า settings ยังใช้งานได้
    }
  };

  const runExportClone = async () => {
    if (cloneSelected.size === 0) return;
    setCloneBusy(true);
    setCloneResult(null);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/clone/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: Array.from(cloneSelected) }),
      });
      const data = await res.json();
      if (!res.ok || !data.package) throw new Error(data.error || t('settings.clone.createFailed', 'สร้างแพ็กเกจไม่สำเร็จ'));
      const pkg = data.package;
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sovereign-clone-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const tables = pkg.modules.reduce((n: number, m: any) => n + (m.tables?.length ?? 0), 0);
      setCloneResult({ tables, sizeKb: Math.round(blob.size / 1024) });
      setMessage(t('settings.clone.exported', 'ส่งออกแพ็กเกจแล้ว ({n} ฟังก์ชั่น) — ไฟล์ถูกดาวน์โหลดแล้ว', { n: cloneSelected.size }));
    } catch (e: any) {
      setCloneResult({ error: e.message });
    } finally {
      setCloneBusy(false);
    }
  };

  const importCloneFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCloneBusy(true);
    setCloneResult(null);
    setError('');
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/clone/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || t('settings.clone.importFailed', 'นำเข้าไม่สำเร็จ'));
      setCloneResult({ tables: data.restoredTables });
      setMessage(t('settings.clone.imported', 'นำเข้าแพ็กเกจสำเร็จ — คืนค่า {n} ตารางแล้ว', { n: data.restoredTables }));
    } catch (e: any) {
      setCloneResult({ error: e.message });
    } finally {
      setCloneBusy(false);
    }
  };

  const changeTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
    applyAppearance();
    setMessage(t('settings.theme.changed', 'ธีม: {name} (ใช้กับทุกหน้าทันที)', { name: next === 'light' ? t('settings.theme.light', 'สว่าง') : t('settings.theme.dark', 'เข้ม') }));
    setError('');
  };

  const changeFontScale = (next: FontScale) => {
    setFontScale(next);
    setFontScaleState(next);
    applyAppearance();
    const label = next === 'small' ? t('settings.font.small', 'เล็ก') : next === 'large' ? t('settings.font.large', 'ใหญ่') : t('settings.font.normal', 'ปกติ');
    setMessage(t('settings.font.changed', 'ขนาดตัวอักษร: {name}', { name: label }));
    setError('');
  };

  const resetAll = () => {
    resetUserSettings();
    setApiUrlInput(getApiUrl());
    setThemeState(getTheme());
    setFontScaleState(getFontScale());
    setMessage(t('settings.reset.done', 'รีเซ็ตการตั้งค่าทั้งหมดแล้ว'));
    setError('');
  };

  if (!isHydrated) {
    return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('settings.unauthorized', 'Unauthorized')}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('settings.eyebrow', 'ระบบ')}
          title="Settings"
          icon={<Icon name="settings" size={18} />}
          subtitle={t('settings.subtitle', 'ตั้งค่าระบบ · ธีม · clone/export')}
          actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">Dashboard</Link>}
        />

      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-3xl mx-auto w-full">
        {message && <div className="card p-3 text-sm text-emerald-400">{message}</div>}
        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        {/* MFA */}
        <MfaSection />

        {/* API URL */}
        <section className="panel panel-glow p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text">API URL</h2>
          <p className="text-xs text-gray-500">
            {t('settings.api.desc', 'ใช้กับทุกหน้าและ WebSocket (ค่าเริ่มต้น: จาก .env.local) — เปลี่ยนโดยไม่ต้อง build ใหม่')}
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrlInput(e.target.value)}
            placeholder="http://localhost:3001"
            className="input w-full text-sm"
          />
          <div className="flex gap-3 flex-wrap">
            <button onClick={saveApiUrl} className="btn-primary">
              <Icon name="save" size={14} />
              {t('common.save', 'บันทึก')}
            </button>
            <button onClick={resetApiUrl} className="btn-secondary">
              {t('settings.api.resetBtn', 'ใช้ค่าเริ่มต้น')}
            </button>
          </div>
        </section>

        {/* Telegram Alerts */}
        <TelegramSection />

        {/* ทดสอบการเชื่อมต่อ */}
        <section className="panel p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">{t('settings.test.title', 'ทดสอบการเชื่อมต่อ')}</h2>
          <div className="flex gap-3 items-center">
            <button
              onClick={testConnection}
              disabled={testing || !apiUrl.trim()}
              className="btn-primary"
            >
              {testing ? t('settings.test.testing', 'กำลังทดสอบ...') : t('settings.test.button', 'ทดสอบ /api/health')}
            </button>
          </div>
          {testResult && (
            <div
              className={`card p-3 text-sm ${
                testResult.ok
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {testResult.detail || t('settings.test.failed', 'ไม่สามารถเชื่อมต่อได้')}
              {testResult.status !== undefined && ` (HTTP ${testResult.status})`}
              {testResult.ms !== undefined && ` — ${testResult.ms} ms`}
            </div>
          )}
        </section>

        {/* ธีม */}
        <section className="panel p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">{t('settings.theme.title', 'ธีม')}</h2>
          <div className="flex gap-3">
            <button
              onClick={() => changeTheme('dark')}
              className={theme === 'dark' ? 'btn-primary' : 'btn-secondary'}
            >
              {t('settings.theme.dark', 'เข้ม')}
            </button>
            <button
              onClick={() => changeTheme('light')}
              className={theme === 'light' ? 'btn-primary' : 'btn-secondary'}
            >
              {t('settings.theme.light', 'สว่าง')}
            </button>
          </div>
        </section>

        {/* ภาษา */}
        <section className="panel panel-cyan p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
            {t('settings.language.title', 'ภาษา / Language')}
          </h2>
          <div className="flex gap-3">
            <button
              onClick={() => setLang('th')}
              className={lang === 'th' ? 'btn-primary' : 'btn-secondary'}
            >
              <Icon name="globe" size={13} />
              {t('settings.language.thai', 'ไทย')}
            </button>
            <button
              onClick={() => setLang('en')}
              className={lang === 'en' ? 'btn-primary' : 'btn-secondary'}
            >
              <Icon name="globe" size={13} />
              {t('settings.language.english', 'English')}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {t('settings.language.hint', 'เปลี่ยนภาษาทั้งระบบได้ทันที (เก็บไว้ในเครื่องนี้)')}
          </p>
        </section>

        {/* ขนาดตัวอักษร */}
        <section className="panel p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">{t('settings.font.title', 'ขนาดตัวอักษร')}</h2>
          <div className="flex gap-3">
            {(['small', 'normal', 'large'] as FontScale[]).map((s) => (
              <button
                key={s}
                onClick={() => changeFontScale(s)}
                className={fontScale === s ? 'btn-primary' : 'btn-secondary'}
              >
                {s === 'small' ? t('settings.font.small', 'เล็ก') : s === 'large' ? t('settings.font.large', 'ใหญ่') : t('settings.font.normal', 'ปกติ')}
              </button>
            ))}
          </div>
        </section>

        {/* PWA */}
        <section className="panel p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">{t('settings.pwa.title', 'PWA / ติดตั้งแอป')}</h2>
          <div className="text-xs text-gray-400">
            {t('settings.pwa.statusLabel', 'สถานะ: ')}<span className="text-gray-300">{swStatus}</span>{installed && <span className="text-emerald-400">{t('settings.pwa.installed', ' · ติดตั้งแล้ว')}</span>}
          </div>

          {installPrompt && !installed ? (
            <button
              onClick={installApp}
              className="btn-primary"
            >
              {t('settings.pwa.install', 'ติดตั้งแอป Sovereign')}
            </button>
          ) : (
            <div className="text-xs text-gray-600">
              {t('settings.pwa.installHint', 'ปุ่มติดตั้งจะโผล่ที่นี่เมื่อเบราว์เซอร์พร้อม — ต้องเปิดผ่าน HTTPS หรือ localhost และเยี่ยมชมอย่างน้อย 1 ครั้ง')}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button onClick={measureCache} className="btn-secondary">
              <Icon name="package" size={14} />
              {t('settings.pwa.measureCache', 'วัดขนาด cache')}{cacheSize && `: ${cacheSize}`}
            </button>
            <button onClick={updateNow} className="btn-primary">
              <Icon name="refresh" size={14} />
              {t('settings.pwa.checkUpdate', 'ตรวจสอบอัปเดต')}
            </button>
            <button onClick={clearCacheAndReload} className="btn-danger">
              {t('settings.pwa.clearCache', 'ล้าง cache + โหลดใหม่')}
            </button>
          </div>
        </section>

        {/* คิว Offline */}
        <section className="panel panel-cyan p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('settings.queue.title', 'คิว Offline ({n})', { n: queuedItems.length })}</h2>
          <p className="text-xs text-gray-500">
            {t('settings.queue.desc', 'action ที่ค้างไว้ตอนออฟไลน์ (POST/PUT/PATCH/DELETE) — จะ sync อัตโนมัติเมื่อกลับ online หรือเลือกจัดการด้านล่าง')}
          </p>

          {queuedItems.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4">{t('settings.queue.empty', 'ไม่มี action ค้าง — คิวว่าง')}</div>
          ) : (
            <>
              <div className="overflow-x-auto border border-cyan-800/50 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-700 bg-gray-800/50">
                      <th className="py-2 px-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === queuedItems.length && queuedItems.length > 0}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 accent-green-500"
                        />
                      </th>
                      <th className="py-2 pr-3 w-16">Method</th>
                      <th className="py-2 pr-3">URL</th>
                      <th className="py-2 pr-3 w-36">{t('common.time', 'เวลา')}</th>
                      <th className="py-2 pr-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {queuedItems.map((item) => (
                      <tr key={item.id} className="border-b border-gray-800">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id!)}
                            onChange={() => toggleSelect(item.id!)}
                            className="w-4 h-4 accent-green-500"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              item.method === 'POST'
                                ? 'bg-green-900/50 text-green-300'
                                : item.method === 'PUT'
                                  ? 'bg-blue-900/50 text-blue-300'
                                  : item.method === 'DELETE'
                                    ? 'bg-red-900/50 text-red-300'
                                    : 'bg-amber-900/50 text-amber-300'
                            }`}
                          >
                            {item.method}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-gray-300 break-all">{item.url}</td>
                        <td className="py-2 pr-3 text-xs text-gray-500">{new Date(item.queuedAt).toLocaleString(fmtLocale())}</td>
                        <td className="py-2 pr-3">
                          <button
                            onClick={() => deleteOne(item.id!)}
                            title={t('settings.queue.removeTitle', 'ลบออกจากคิว (ไม่ส่ง)')}
                            className="text-xs px-2 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={syncSelected}
                  disabled={queueBusy || selectedIds.size === 0}
                  className="btn-primary"
                >
                  {queueBusy ? t('settings.queue.syncing', 'กำลัง sync…') : t('settings.queue.syncSelected', 'Sync ที่เลือก ({n})', { n: selectedIds.size })}
                </button>
                <button
                  onClick={deleteSelected}
                  disabled={queueBusy || selectedIds.size === 0}
                  className="btn-danger"
                >
                  <Icon name="trash" size={14} />
                  {t('settings.queue.deleteSelected', 'ลบที่เลือก')}
                </button>
                <button
                  onClick={async () => {
                    setQueueBusy(true);
                    const flushed = await syncNow();
                    setMessage(t('settings.queue.syncAllDone', 'sync ทั้งหมดสำเร็จ {n} รายการ', { n: flushed }));
                    await reloadQueue();
                    setQueueBusy(false);
                  }}
                  disabled={queueBusy || queuedItems.length === 0}
                  className="btn-primary"
                >
                  <Icon name="zap" size={14} />
                  {t('settings.queue.syncAll', 'Sync ทั้งหมด')}
                </button>
              </div>
            </>
          )}
        </section>

        {/* ── Export & Clone: ถอดแบบฟังก์ชั่นไปติดตั้งเครื่องอื่น ── */}
        <section className="panel panel-cyan p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('settings.clone.title', 'Export & Clone (ถอดแบบระบบ)')}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.clone.desc', 'ติ๊กเลือกฟังก์ชั่นที่อยากส่งออก → ดาวน์โหลดแพ็กเกจ JSON → นำไปติดตั้งที่เครื่องอื่น (อัปโหลดแพ็กเกจเพื่อคืนค่าเหมือนต้นฉบับ)')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCloneSelected(new Set(cloneModules.map((m) => m.key)))}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                <Icon name="check" size={14} />
                {t('settings.clone.selectAll', 'เลือกทั้งหมด')}
              </button>
              <button
                onClick={() => setCloneSelected(new Set())}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                {t('settings.clone.clear', 'เคลียร์')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {cloneModules.map((m) => (
              <label
                key={m.key}
                className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition ${
                  cloneSelected.has(m.key)
                    ? 'border-emerald-600 bg-gray-900/70'
                    : 'border-gray-800 bg-gray-950/50 hover:border-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={cloneSelected.has(m.key)}
                  onChange={() => {
                    const next = new Set(cloneSelected);
                    if (next.has(m.key)) next.delete(m.key);
                    else next.add(m.key);
                    setCloneSelected(next);
                  }}
                  className="mt-1 w-4 h-4 accent-green-500"
                />
                <div>
                  <div className="text-sm font-bold">{m.emoji} {m.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{m.description}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{t('settings.clone.tables', '{n} ตาราง', { n: m.tables.length })}</div>
                </div>
              </label>
            ))}
            {cloneModules.length === 0 && (
              <div className="md:col-span-2 text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-lg">
                {t('settings.clone.loading', 'กำลังโหลดรายการฟังก์ชั่น...')}
              </div>
            )}
          </div>

          <div className="flex gap-3 flex-wrap items-center">
            <button
              onClick={runExportClone}
              disabled={cloneBusy || cloneSelected.size === 0}
              className="btn-primary"
            >
              {cloneBusy ? t('settings.clone.building', 'กำลังสร้างแพ็กเกจ...') : t('settings.clone.exportBtn', 'ส่งออกแพ็กเกจ (เลือกแล้ว {n} รายการ)', { n: cloneSelected.size })}
            </button>
            <label className="btn-secondary cursor-pointer">
              <Icon name="download" size={14} />
              {t('settings.clone.importBtn', 'นำเข้าแพ็กเกจจากเครื่องอื่น')}
              <input type="file" accept=".json,application/json" className="hidden" onChange={importCloneFile} />
            </label>
          </div>

          {cloneResult?.error && (
            <div className="card p-3 text-sm text-rose-400"> {cloneResult.error}</div>
          )}
          {cloneResult && !cloneResult.error && (
            <div className="card p-3 text-sm text-emerald-400">
              {cloneResult.sizeKb !== undefined
                ? t('settings.clone.resultExport', 'แพ็กเกจพร้อมใช้งาน — {n} ตาราง · {size} KB', { n: cloneResult.tables, size: cloneResult.sizeKb })
                : t('settings.clone.resultImport', 'นำเข้าแพ็กเกจสำเร็จ — คืนค่า {n} ตารางแล้ว', { n: cloneResult.tables })}
            </div>
          )}

          <div className="text-[11px] text-gray-600">
            {t('settings.clone.warnBefore', 'การนำเข้าจะ ')}<span className="text-amber-300">{t('settings.clone.warnHighlight', 'ล้างและแทนที่')}</span>{t('settings.clone.warnAfter', ' ข้อมูลของฟังก์ชั่นที่เลือกในเครื่องนี้ด้วยข้อมูลจากแพ็กเกจ — เหมาะกับการติดตั้งระบบใหม่/เครื่องที่สอง (ควรสำรองข้อมูลก่อน)')}
          </div>
        </section>

        {/* รีเซ็ต */}
        <section className="panel p-5">
          <button
            onClick={resetAll}
            className="btn-danger"
          >
            <Icon name="refresh" size={14} />
            {t('settings.reset.button', 'รีเซ็ตการตั้งค่าทั้งหมด')}
          </button>
        </section>
      </main>
    </div>
      </div>
  );
}

// ── Telegram Alerts — ตั้งค่า bot token / chat ID ผ่าน UI (บันทึกลง DB, ไม่ต้องแตะ .env) ──
function TelegramSection() {
  const t = useLanguageStore((s) => s.t);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<'env' | 'db' | 'none'>('none');
  const [masked, setMasked] = useState('');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [testOutcome, setTestOutcome] = useState<'idle' | 'ok' | 'fail'>('idle');

  const loadConfig = async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`);
      if (!res.ok) return;
      const data = await res.json();
      setConfigured(data.configured === true);
      setSource(data.source);
      setMasked(data.botTokenMasked || '');
      setChatId(data.chatId || '');
      setTestOutcome('idle');
    } catch {
      // เงียบ — แสดงสถานะไม่พร้อม
    }
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const body: Record<string, string> = {};
      if (botToken.trim()) body.botToken = botToken.trim();
      if (chatId.trim()) body.chatId = chatId.trim();
      if (Object.keys(body).length === 0) {
        setErr(t('settings.telegram.saveFailed', 'บันทึกไม่สำเร็จ: {error}', { error: t('common.invalid', 'ข้อมูลไม่ถูกต้อง') }));
        return;
      }
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBotToken('');
      setMsg(t('settings.telegram.saved', 'บันทึก Telegram credentials แล้ว — ระบบจะใช้ค่านี้ทันที'));
      await loadConfig();
    } catch (e: any) {
      setErr(t('settings.telegram.saveFailed', 'บันทึกไม่สำเร็จ: {error}', { error: e.message }));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setErr(''); setMsg(''); setTestOutcome('idle');
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/test`, { method: 'POST' });
      const data = await res.json();
      setTestOutcome(data.success === true ? 'ok' : 'fail');
      if (data.success === true) setMsg(t('settings.telegram.testOk', 'ส่งข้อความทดสอบแล้ว — ตรวจสอบ Telegram ของคุณ'));
    } catch {
      setTestOutcome('fail');
    } finally {
      setBusy(false);
    }
  };

  const useEnv = async () => {
    if (!window.confirm(t('settings.telegram.useEnv', 'ใช้ค่าจาก .env'))) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`, { method: 'DELETE' });
      const data = await res.json();
      setMsg(t('settings.telegram.reverted', 'ลบ override แล้ว — กลับไปใช้ค่าใน .env'));
      setConfigured(data.configured === true);
      setSource(data.source);
      setMasked(data.botTokenMasked || '');
      setChatId(data.chatId || '');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = !configured
    ? t('settings.telegram.notConfigured', 'ยังไม่ได้ตั้งค่า')
    : source === 'db'
      ? t('settings.telegram.fromDb', 'ตั้งค่าแล้ว (DB)')
      : t('settings.telegram.fromEnv', 'จาก .env');

  return (
    <section className="panel panel-glow p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('settings.telegram.title', 'Telegram Alerts')}</h2>
        <span className={`text-xs border rounded px-2 py-1 ${configured ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700' : 'bg-amber-900/40 text-amber-300 border-amber-700'}`}>
          {t('settings.telegram.statusLabel', 'สถานะ: ')}{statusBadge}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {t('settings.telegram.desc', 'ตั้งค่า bot token และ chat ID เพื่อรับข้อความแจ้งเตือนจากระบบ (บันทึกลง DB — ไม่ต้องแก้ไฟล์ .env บนเครื่อง)')}
      </p>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-rose-400">{err}</div>}

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('settings.telegram.botToken', 'Bot Token')}</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={masked ? t('settings.telegram.botTokenMasked', 'ตั้งค่าแล้ว: {masked} — ปล่อยว่างเพื่อใช้ค่าเดิม', { masked }) : t('settings.telegram.botTokenPh', 'กรอก bot token จาก @BotFather (เช่น 123456789:AAF…)')}
            autoComplete="new-password"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('settings.telegram.chatId', 'Chat ID')}</label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder={t('settings.telegram.chatIdPh', 'เช่น 123456789 หรือ @username')}
            className="input w-full text-sm"
          />
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <button onClick={save} disabled={busy || (!botToken.trim() && !chatId.trim())} className="btn-primary">
          <Icon name="save" size={14} />
          {t('settings.telegram.save', 'บันทึก')}
        </button>
        <button onClick={test} disabled={busy || !configured} className="btn-secondary">
          {busy ? t('common.loading', 'กำลังโหลด...') : t('settings.telegram.test', 'ส่งข้อความทดสอบ')}
        </button>
        {source === 'db' && (
          <button onClick={useEnv} disabled={busy} className="btn-secondary">
            {t('settings.telegram.useEnv', 'ใช้ค่าจาก .env')}
          </button>
        )}
      </div>
      {testOutcome === 'fail' && (
        <div className="card p-3 text-sm text-rose-400">
          {t('settings.telegram.testFail', 'ส่งไม่สำเร็จ — ตรวจ token / chat ID หรือการเชื่อมต่ออินเทอร์เน็ต')}
        </div>
      )}
      {!configured && (
        <div className="text-[11px] text-gray-600">
          {t('settings.telegram.notAdmin', 'เฉพาะ SUPERADMIN ตั้งค่า Telegram ได้')}
        </div>
      )}
    </section>
  );
}

// ── MFA (2FA) — ตั้งค่า/ปิดชั่วคราว ──
// flow: enroll → สแกน QR → confirm ด้วยรหัสจากแอป (กัน lockout)
function MfaSection() {
  const t = useLanguageStore((s) => s.t);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const refresh = async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/status`);
      const data = await res.json();
      setEnabled(data.enabled === true);
      setPending(data.pending === true);
    } catch (e) {
      setErr(t('settings.mfa.loadFailed', 'โหลดสถานะ MFA ไม่สำเร็จ'));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enroll = async () => {
    setBusy(true); setMsg(''); setErr(''); setCode('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/enroll`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.enrollFailed', 'สร้างคีย์ไม่สำเร็จ'));
      setQr(data.qrCode);
      setSecret(data.secret);
      setPending(true);
      setMsg(t('settings.mfa.scanHint', 'สแกน QR ด้านล่างในแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setErr(t('settings.mfa.codeRequired', 'กรอกรหัส 6 หลักจากแอป'));
      return;
    }
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.confirmFailed', 'ยืนยันไม่สำเร็จ'));
      setQr(''); setSecret(''); setCode('');
      setMsg(t('settings.mfa.enabled', 'เปิดใช้งาน 2FA แล้ว — ครั้งหน้า login จะต้องกรอกรหัสจากแอป'));
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm(t('settings.mfa.disableConfirm', 'ปิด 2FA ชั่วคราว? (เข้าระบบด้วยรหัสผ่านอย่างเดียว — เปิดใหม่ได้เสมอ)'))) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/disable`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.disableFailed', 'ปิดไม่สำเร็จ'));
      setQr(''); setSecret(''); setCode('');
      setMsg(t('settings.mfa.disabled', 'ปิด 2FA ชั่วคราวแล้ว — เปิดใหม่ได้จากหน้านี้'));
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel-glow p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">2FA / MFA</h2>
        {enabled === true && <span className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700 rounded px-2 py-1">{t('settings.mfa.on', 'เปิดอยู่')}</span>}
        {enabled === false && <span className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700 rounded px-2 py-1">{t('settings.mfa.off', 'ปิดชั่วคราว')}</span>}
      </div>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-rose-400">{err}</div>}

      {enabled === true ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t('settings.mfa.enabledDesc', '2FA เปิดอยู่ — ทุกครั้งที่ login ต้องกรอกรหัส 6 หลักจากแอป Authenticator')}
          </p>
          <button onClick={disable} disabled={busy} className="btn-danger disabled:opacity-50">
            <Icon name="x-circle" size={14} />
            {t('settings.mfa.disable', 'ปิด 2FA ชั่วคราว')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t('settings.mfa.disabledDesc', 'เข้าระบบด้วยรหัสผ่านอย่างเดียวตอนนี้ — เปิด 2FA เพื่อเพิ่มความปลอดภัย (คีย์ใหม่ถูกสร้างให้สแกน)')}
          </p>
          {!pending ? (
            <button onClick={enroll} disabled={busy} className="btn-primary">
              {busy ? t('settings.mfa.creating', 'กำลังสร้าง…') : (
                <>
                  <Icon name="lock" size={14} />
                  {t('settings.mfa.setup', 'ตั้งค่า 2FA ใหม่')}
                </>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 items-start flex-wrap">
                {qr && (
                  <img
                    src={qr}
                    alt={t('settings.mfa.qrAlt', 'QR Code สำหรับแอป Authenticator')}
                    className="w-40 h-40 bg-white rounded-lg p-2"
                  />
                )}
                <div className="space-y-2 flex-1 min-w-[220px]">
                  <div className="text-xs text-gray-500">
                    {t('settings.mfa.manualEntry', 'หรือกรอกคีย์นี้ในแอป (manual entry):')}
                  </div>
                  <code className="block bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-green-300 break-all select-all glow-text">
                    {secret}
                  </code>
                  <div className="flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t('settings.mfa.codePh', 'รหัส 6 หลักจากแอป')}
                      inputMode="numeric"
                      className="input text-sm flex-1"
                    />
                    <button onClick={confirm} disabled={busy || code.length !== 6} className="btn-primary">
                      {t('common.confirm', 'ยืนยัน')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-600">
                {t('settings.mfa.howTo', 'เปิดแอป Google Authenticator / Microsoft Authenticator → สแกน QR (หรือ + → ป้อนคีย์ด้วยตนเอง) → ระบบจะเปิด 2FA ต่อเมื่อรหัสจากแอปตรงกัน')}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}