"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
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
import OfflineQueuePanel from '../components/system/OfflineQueuePanel';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import TelegramSection from '../components/system/settings/TelegramSection';
import MfaSection from '../components/system/settings/MfaSection';
import VoiceAutoSection from '../components/system/settings/VoiceAutoSection';

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

  const [activeTab, setActiveTab] = useState<'general'|'connection'|'app'|'security'>('general');
  const [settingsSearch, setSettingsSearch] = useState('');

  if (!isHydrated) {
    return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('settings.unauthorized', 'Unauthorized')}</div>;
  }

  const tabDefs = [
    { id: 'general' as const, label: 'ทั่วไป', icon: 'settings', target: 'sec-general' },
    { id: 'connection' as const, label: 'การเชื่อมต่อ', icon: 'wifi', target: 'sec-connection' },
    { id: 'app' as const, label: 'แอป & ข้อมูล', icon: 'package', target: 'sec-app' },
    { id: 'security' as const, label: 'ความปลอดภัย', icon: 'shield', target: 'sec-security' },
  ] as const;
  const scrollToSec = (id: string) => { try { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
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

        {/* Tabs + Search - คลิกแล้วเลื่อนไปหา section */}
        <div className="flex flex-wrap gap-2 items-center sticky top-2 z-10 bg-gray-950/80 backdrop-blur p-1 rounded-full">
          <div className="flex gap-1.5 p-1 bg-gray-900 border border-gray-800 rounded-full">
            {tabDefs.map(tab => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); scrollToSec((tab as any).target); }} className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${activeTab===tab.id?'bg-emerald-600 text-white':'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}><Icon name={tab.icon} size={12} />{tab.label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input value={settingsSearch} onChange={e=>setSettingsSearch(e.target.value)} placeholder="ค้นหาตั้งค่า..." className="input text-sm w-40" />
            {settingsSearch && <button onClick={()=>setSettingsSearch('')} className="text-xs text-gray-500 hover:text-gray-300">ล้าง</button>}
          </div>
        </div>

        <div id="sec-security"><MfaSection /></div>
        <div id="sec-connection" className="space-y-5">
        <section className="panel panel-glow p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text">API URL</h2>
          <p className="text-xs text-gray-500">
            {t('settings.api.desc', 'ใช้กับทุกหน้าและ WebSocket (ค่าเริ่มต้น: จาก .env.local) — เปลี่ยนโดยไม่ต้อง build ใหม่')}
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrlInput(e.target.value)}
            onBlur={() => { if (apiUrl.trim()) testConnection(); }}
            placeholder="http://localhost:3001"
            className="input w-full text-sm"
          />
          {testResult && <div className={`text-xs ${testResult.ok?'text-emerald-400':'text-amber-400'}`}>{testResult.ok?`✓ เชื่อมต่อได้ ${testResult.ms}ms`:`○ ${testResult.detail}`}</div>}
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

        {/* Connection */}
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
        </div>
        <div id="sec-general" className="space-y-5">
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

        {/* พูดคุยอัตโนมัติ */}
        <VoiceAutoSection />

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
        </div>
        <div id="sec-app" className="space-y-5">
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
        <OfflineQueuePanel onMessage={setMessage} onError={setError} />

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

        </div>
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
