"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
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

export default function SettingsPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
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
  const [swStatus, setSwStatus] = useState('ตรวจสอบ…');
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
          setSwStatus('ไม่ได้ลงทะเบียน (ใช้งานเฉพาะ production build)');
          return;
        }
        const state = reg.active
          ? 'active ✓'
          : reg.installing
            ? 'installing…'
            : reg.waiting
              ? 'waiting (มีเวอร์ชันใหม่)'
              : 'unknown';
        setSwStatus(`ลงทะเบียนแล้ว (${state})`);
      }).catch(() => setSwStatus('ไม่สามารถตรวจสอบได้'));
    } else {
      setSwStatus('เบราว์เซอร์ไม่รองรับ Service Worker');
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
        setMessage('✅ ติดตั้งแอป Sovereign แล้ว');
        setInstalled(true);
      }
    } catch (err) {
      console.error(err);
      setError('ติดตั้งไม่สำเร็จ');
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
      const sizeText = `${entries} รายการ · ${mb >= 1 ? mb.toFixed(2) + ' MB' : (total / 1024).toFixed(1) + ' KB'}`;
      setCacheSize(sizeText);
      setMessage('📦 ขนาด cache: ' + sizeText);
    } catch (err) {
      console.error(err);
      setError('วัดขนาด cache ไม่สำเร็จ');
    }
  };

  const updateNow = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setError('ไม่มี service worker ที่ลงทะเบียน');
        return;
      }
      await reg.update();
      // ถ้ามีเวอร์ชันใหม่รออยู่ → ให้ข้าม waiting แล้วรีโหลด
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setMessage('🔄 พบเวอร์ชันใหม่ — กำลังอัปเดต... (โหลดใหม่ครั้งหน้าได้เวอร์ชันล่าสุด)');
      } else {
        setMessage('✅ ตรวจสอบแล้ว — ใช้เวอร์ชันล่าสุดอยู่');
      }
    } catch (err) {
      console.error(err);
      setError('ตรวจสอบอัปเดตไม่สำเร็จ');
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
      setMessage(kept === 0 ? `✅ sync สำเร็จทั้งหมด ${flushed} รายการ` : `✅ sync สำเร็จ ${flushed} รายการ (เหลือ ${kept} ที่ยังไม่ได้)`);
      await reloadQueue();
    } catch (err) {
      console.error(err);
      setError('sync ไม่สำเร็จ');
    } finally {
      setQueueBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`ลบ ${selectedIds.size} รายการออกจากคิว? (จะไม่ถูกส่ง)`)) return;
    setQueueBusy(true);
    for (const id of selectedIds) await removeQueued(id);
    setMessage(`🗑️ ลบ ${selectedIds.size} รายการแล้ว`);
    await reloadQueue();
    setQueueBusy(false);
  };

  const deleteOne = async (id: number) => {
    await removeQueued(id);
    setMessage('🗑️ ลบรายการออกจากคิวแล้ว');
    await reloadQueue();
  };

  const clearCacheAndReload = async () => {
    if (!window.confirm('ล้าง cache ทั้งหมดของ PWA แล้วโหลดหน้าใหม่? (ครั้งแรกหลังล้างจะโหลดช้ากว่าปกติเล็กน้อย)')) return;
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    setCacheSize('');
    setMessage('🧹 ล้าง cache แล้ว — กำลังโหลดใหม่…');
    window.location.reload();
  };

  const saveApiUrl = () => {
    const trimmed = apiUrl.trim().replace(/\/+$/, ''); // ตัด slash ท้าย
    setApiUrl(trimmed || null);
    setMessage(`✅ บันทึก API URL แล้ว: ${trimmed || '(ใช้ค่าเริ่มต้น)'}`);
    setError('');
  };

  const resetApiUrl = () => {
    setApiUrl(null);
    setApiUrlInput(getApiUrl());
    setMessage('✅ กลับไปใช้ค่าเริ่มต้นแล้ว');
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
            ? 'Core API ตอบสนองปกติ'
            : res.statusText || `HTTP ${res.status}`,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        ms: Date.now() - started,
        detail: err?.name === 'TimeoutError' ? 'หมดเวลา (5 วิ) — ตรวจสอบว่า server เปิดอยู่' : err?.message || 'เชื่อมต่อไม่ได้',
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
      if (!res.ok || !data.package) throw new Error(data.error || 'สร้างแพ็กเกจไม่สำเร็จ');
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
      setMessage(`✅ ส่งออกแพ็กเกจแล้ว (${cloneSelected.size} ฟังก์ชั่น) — ไฟล์ถูกดาวน์โหลดแล้ว`);
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
      if (!res.ok || !data.success) throw new Error(data.error || 'นำเข้าไม่สำเร็จ');
      setCloneResult({ tables: data.restoredTables });
      setMessage(`✅ นำเข้าแพ็กเกจสำเร็จ — คืนค่า ${data.restoredTables} ตารางแล้ว`);
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
    setMessage(`✅ ธีม: ${next === 'light' ? 'สว่าง' : 'เข้ม'} (ใช้กับทุกหน้าทันที)`);
    setError('');
  };

  const changeFontScale = (next: FontScale) => {
    setFontScale(next);
    setFontScaleState(next);
    applyAppearance();
    const label = next === 'small' ? 'เล็ก' : next === 'large' ? 'ใหญ่' : 'ปกติ';
    setMessage(`✅ ขนาดตัวอักษร: ${label}`);
    setError('');
  };

  const resetAll = () => {
    resetUserSettings();
    setApiUrlInput(getApiUrl());
    setThemeState(getTheme());
    setFontScaleState(getFontScale());
    setMessage('✅ รีเซ็ตการตั้งค่าทั้งหมดแล้ว');
    setError('');
  };

  if (!isHydrated) {
    return <div className="text-white p-8">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900 border-b border-gray-700 px-6 py-3">
        <PageHeader
          eyebrow="ระบบ"
          title="🛠️ Settings"
          subtitle="ตั้งค่าระบบ · ธีม · clone/export"
          actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>}
        />
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        {message && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400">{message}</div>}
        {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>}

        {/* MFA */}
        <MfaSection />

        {/* API URL */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">🔗 API URL</h2>
          <p className="text-xs text-gray-500">
            ใช้กับทุกหน้าและ WebSocket (ค่าเริ่มต้น: จาก .env.local) — เปลี่ยนโดยไม่ต้อง build ใหม่
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrlInput(e.target.value)}
            placeholder="http://localhost:3001"
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
          />
          <div className="flex gap-3 flex-wrap">
            <button onClick={saveApiUrl} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold">
              💾 บันทึก
            </button>
            <button onClick={resetApiUrl} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              ↩️ ใช้ค่าเริ่มต้น
            </button>
          </div>
        </section>

        {/* ทดสอบการเชื่อมต่อ */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">🔌 ทดสอบการเชื่อมต่อ</h2>
          <div className="flex gap-3 items-center">
            <button
              onClick={testConnection}
              disabled={testing || !apiUrl.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50"
            >
              {testing ? '⏳ กำลังทดสอบ...' : '🧪 ทดสอบ /api/health'}
            </button>
          </div>
          {testResult && (
            <div
              className={`p-3 rounded text-sm ${
                testResult.ok
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-red-900/30 text-red-400'
              }`}
            >
              {testResult.ok ? '✅ ' : '❌ '}
              {testResult.detail || 'ไม่สามารถเชื่อมต่อได้'}
              {testResult.status !== undefined && ` (HTTP ${testResult.status})`}
              {testResult.ms !== undefined && ` — ${testResult.ms} ms`}
            </div>
          )}
        </section>

        {/* ธีม */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">🎨 ธีม</h2>
          <div className="flex gap-3">
            <button
              onClick={() => changeTheme('dark')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${
                theme === 'dark' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              🌙 เข้ม
            </button>
            <button
              onClick={() => changeTheme('light')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${
                theme === 'light' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              ☀️ สว่าง
            </button>
          </div>
        </section>

        {/* ขนาดตัวอักษร */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">🔠 ขนาดตัวอักษร</h2>
          <div className="flex gap-3">
            {(['small', 'normal', 'large'] as FontScale[]).map((s) => (
              <button
                key={s}
                onClick={() => changeFontScale(s)}
                className={`px-4 py-2 rounded text-sm font-semibold transition ${
                  fontScale === s ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {s === 'small' ? 'เล็ก' : s === 'large' ? 'ใหญ่' : 'ปกติ'}
              </button>
            ))}
          </div>
        </section>

        {/* PWA */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">📱 PWA / ติดตั้งแอป</h2>
          <div className="text-xs text-gray-400">
            สถานะ: <span className="text-gray-300">{swStatus}</span>{installed && <span className="text-green-400"> · ✅ ติดตั้งแล้ว</span>}
          </div>

          {installPrompt && !installed ? (
            <button
              onClick={installApp}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold"
            >
              📲 ติดตั้งแอป Sovereign
            </button>
          ) : (
            <div className="text-xs text-gray-600">
              ปุ่มติดตั้งจะโผล่ที่นี่เมื่อเบราว์เซอร์พร้อม — ต้องเปิดผ่าน HTTPS หรือ localhost และเยี่ยมชมอย่างน้อย 1 ครั้ง
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button onClick={measureCache} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              📦 วัดขนาด cache{cacheSize && `: ${cacheSize}`}
            </button>
            <button onClick={updateNow} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm">
              🔄 ตรวจสอบอัปเดต
            </button>
            <button onClick={clearCacheAndReload} className="px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded text-sm">
              🧹 ล้าง cache + โหลดใหม่
            </button>
          </div>
        </section>

        {/* คิว Offline */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">📥 คิว Offline ({queuedItems.length})</h2>
          <p className="text-xs text-gray-500">
            action ที่ค้างไว้ตอนออฟไลน์ (POST/PUT/PATCH/DELETE) — จะ sync อัตโนมัติเมื่อกลับ online หรือเลือกจัดการด้านล่าง
          </p>

          {queuedItems.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4">ไม่มี action ค้าง — คิวว่าง</div>
          ) : (
            <>
              <div className="overflow-x-auto border border-gray-700 rounded-lg">
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
                      <th className="py-2 pr-3 w-36">เวลา</th>
                      <th className="py-2 pr-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
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
                        <td className="py-2 pr-3 text-xs text-gray-500">{new Date(item.queuedAt).toLocaleString('th-TH')}</td>
                        <td className="py-2 pr-3">
                          <button
                            onClick={() => deleteOne(item.id!)}
                            title="ลบออกจากคิว (ไม่ส่ง)"
                            className="text-xs px-2 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded"
                          >
                            🗑️
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
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {queueBusy ? '⏳ กำลัง sync…' : `📤 Sync ที่เลือก (${selectedIds.size})`}
                </button>
                <button
                  onClick={deleteSelected}
                  disabled={queueBusy || selectedIds.size === 0}
                  className="px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🗑️ ลบที่เลือก
                </button>
                <button
                  onClick={async () => {
                    setQueueBusy(true);
                    const flushed = await syncNow();
                    setMessage(`✅ sync ทั้งหมดสำเร็จ ${flushed} รายการ`);
                    await reloadQueue();
                    setQueueBusy(false);
                  }}
                  disabled={queueBusy || queuedItems.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ⚡ Sync ทั้งหมด
                </button>
              </div>
            </>
          )}
        </section>

        {/* ── Export & Clone: ถอดแบบฟังก์ชั่นไปติดตั้งเครื่องอื่น ── */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold">📦 Export & Clone (ถอดแบบระบบ)</h2>
              <p className="text-xs text-gray-500 mt-1">
                ติ๊กเลือกฟังก์ชั่นที่อยากส่งออก → ดาวน์โหลดแพ็กเกจ JSON → นำไปติดตั้งที่เครื่องอื่น (อัปโหลดแพ็กเกจเพื่อคืนค่าเหมือนต้นฉบับ)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCloneSelected(new Set(cloneModules.map((m) => m.key)))}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs"
              >
                ✅ เลือกทั้งหมด
              </button>
              <button
                onClick={() => setCloneSelected(new Set())}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs"
              >
                🧹 เคลียร์
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {cloneModules.map((m) => (
              <label
                key={m.key}
                className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition ${
                  cloneSelected.has(m.key)
                    ? 'border-green-600 bg-green-900/20'
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
                  <div className="text-[10px] text-gray-600 mt-0.5">{m.tables.length} ตาราง</div>
                </div>
              </label>
            ))}
            {cloneModules.length === 0 && (
              <div className="md:col-span-2 text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-lg">
                กำลังโหลดรายการฟังก์ชั่น...
              </div>
            )}
          </div>

          <div className="flex gap-3 flex-wrap items-center">
            <button
              onClick={runExportClone}
              disabled={cloneBusy || cloneSelected.size === 0}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-semibold"
            >
              {cloneBusy ? '⏳ กำลังสร้างแพ็กเกจ...' : '📤 ส่งออกแพ็กเกจ (เลือกแล้ว ' + cloneSelected.size + ' รายการ)'}
            </button>
            <label className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-sm cursor-pointer">
              📥 นำเข้าแพ็กเกจจากเครื่องอื่น
              <input type="file" accept=".json,application/json" className="hidden" onChange={importCloneFile} />
            </label>
          </div>

          {cloneResult?.error && (
            <div className="p-3 rounded text-sm bg-red-900/30 text-red-400 border border-red-800">❌ {cloneResult.error}</div>
          )}
          {cloneResult && !cloneResult.error && (
            <div className="p-3 rounded text-sm bg-green-900/30 text-green-400 border border-green-800">
              {cloneResult.sizeKb !== undefined
                ? `✅ แพ็กเกจพร้อมใช้งาน — ${cloneResult.tables} ตาราง · ${cloneResult.sizeKb} KB`
                : `✅ นำเข้าแพ็กเกจสำเร็จ — คืนค่า ${cloneResult.tables} ตารางแล้ว`}
            </div>
          )}

          <div className="text-[11px] text-gray-600">
            💡 การนำเข้าจะ <span className="text-amber-300">ล้างและแทนที่</span> ข้อมูลของฟังก์ชั่นที่เลือกในเครื่องนี้ด้วยข้อมูลจากแพ็กเกจ — เหมาะกับการติดตั้งระบบใหม่/เครื่องที่สอง (ควรสำรองข้อมูลก่อน)
          </div>
        </section>

        {/* รีเซ็ต */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <button
            onClick={resetAll}
            className="px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded text-sm"
          >
            ♻️ รีเซ็ตการตั้งค่าทั้งหมด
          </button>
        </section>
      </main>
    </div>
      </div>
  );
}

// ── MFA (2FA) — ตั้งค่า/ปิดชั่วคราว ──
// flow: enroll → สแกน QR → confirm ด้วยรหัสจากแอป (กัน lockout)
function MfaSection() {
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
      setErr('โหลดสถานะ MFA ไม่สำเร็จ');
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
      if (!res.ok) throw new Error(data.error || 'สร้างคีย์ไม่สำเร็จ');
      setQr(data.qrCode);
      setSecret(data.secret);
      setPending(true);
      setMsg('สแกน QR ด้านล่างในแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setErr('กรอกรหัส 6 หลักจากแอป');
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
      if (!res.ok) throw new Error(data.error || 'ยืนยันไม่สำเร็จ');
      setQr(''); setSecret(''); setCode('');
      setMsg('✅ เปิดใช้งาน 2FA แล้ว — ครั้งหน้า login จะต้องกรอกรหัสจากแอป');
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm('ปิด 2FA ชั่วคราว? (เข้าระบบด้วยรหัสผ่านอย่างเดียว — เปิดใหม่ได้เสมอ)')) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/disable`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ปิดไม่สำเร็จ');
      setQr(''); setSecret(''); setCode('');
      setMsg('ℹ️ ปิด 2FA ชั่วคราวแล้ว — เปิดใหม่ได้จากหน้านี้');
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">🔐 2FA / MFA</h2>
        {enabled === true && <span className="text-xs bg-green-900/40 text-green-400 border border-green-700 rounded px-2 py-1">เปิดอยู่</span>}
        {enabled === false && <span className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700 rounded px-2 py-1">ปิดชั่วคราว</span>}
      </div>

      {msg && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400">{msg}</div>}
      {err && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400">{err}</div>}

      {enabled === true ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            2FA เปิดอยู่ — ทุกครั้งที่ login ต้องกรอกรหัส 6 หลักจากแอป Authenticator
          </p>
          <button onClick={disable} disabled={busy} className="px-4 py-2 bg-red-600/80 hover:bg-red-600 rounded text-sm disabled:opacity-50">
            🚫 ปิด 2FA ชั่วคราว
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            เข้าระบบด้วยรหัสผ่านอย่างเดียวตอนนี้ — เปิด 2FA เพื่อเพิ่มความปลอดภัย (คีย์ใหม่ถูกสร้างให้สแกน)
          </p>
          {!pending ? (
            <button onClick={enroll} disabled={busy} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold disabled:opacity-50">
              {busy ? '⏳ กำลังสร้าง…' : '🔐 ตั้งค่า 2FA ใหม่'}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 items-start flex-wrap">
                {qr && (
                  <img
                    src={qr}
                    alt="QR Code สำหรับแอป Authenticator"
                    className="w-40 h-40 bg-white rounded-lg p-2"
                  />
                )}
                <div className="space-y-2 flex-1 min-w-[220px]">
                  <div className="text-xs text-gray-500">
                    หรือกรอกคีย์นี้ในแอป (manual entry):
                  </div>
                  <code className="block bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-green-300 break-all select-all">
                    {secret}
                  </code>
                  <div className="flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="รหัส 6 หลักจากแอป"
                      inputMode="numeric"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white tracking-widest"
                    />
                    <button onClick={confirm} disabled={busy || code.length !== 6} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50">
                      ยืนยัน
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-600">
                💡 เปิดแอป Google Authenticator / Microsoft Authenticator → สแกน QR (หรือ + → ป้อนคีย์ด้วยตนเอง) → ระบบจะเปิด 2FA ต่อเมื่อรหัสจากแอปตรงกัน
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}