"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useIsSuperadmin } from '../lib/roles';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface Firmware {
  file: string;
  size: number;
  date: string;
}

interface Device {
  id: string;
  node_id: string;
  type: string;
  mqtt_topic: string;
  is_active: boolean;
}

interface OtaEvent {
  id: string;
  node_id: string;
  type: string; // deploy | status
  status: string; // sent | success | failed | rebooted | unknown
  firmware: string | null;
  version: string | null;
  error: string | null;
  created_at: string;
}

const statusBadges: Record<string, { label: string; cls: string }> = {
  sent: { label: 'ส่งคำสั่ง', cls: 'bg-blue-900/50 text-blue-300 border-blue-700' },
  success: { label: 'อัปเดตสำเร็จ', cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700' },
  failed: { label: 'ล้มเหลว', cls: 'bg-rose-900/50 text-rose-300 border-rose-700' },
  rebooted: { label: 'รีบูตแล้ว (เวอร์ชันใหม่)', cls: 'bg-purple-900/50 text-purple-300 border-purple-700' },
  unknown: { label: 'ไม่รู้จัก', cls: 'bg-gray-800 text-gray-400 border-gray-600' },
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export default function OtaPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [firmwares, setFirmwares] = useState<Firmware[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<OtaEvent[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [targetDevice, setTargetDevice] = useState('');
  const [targetFirmware, setTargetFirmware] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = useIsSuperadmin();
  const t = useLanguageStore((s) => s.t);

  const load = useCallback(async () => {
    try {
      const [fwRes, devRes, evRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/events`),
      ]);
      // กัน .map พัง: backend ตอบ 500/403 กลับมาเป็น {error:...} — ยัดเข้า state ตรงๆ
      // แล้วหน้าจอระเบิดตอน render (firmwares.map is not a function)
      const [fw, dev, ev] = await Promise.all([fwRes.json(), devRes.json(), evRes.json()]);
      setFirmwares(Array.isArray(fw) ? fw : []);
      setDevices(Array.isArray(dev) ? dev : []);
      setEvents(Array.isArray(ev) ? ev : []);
    } catch (err) {
      console.error(err);
      setError(t('ota.loadingFail', 'โหลดข้อมูลไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
    }
  }, [t]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load();
    // poll สถานะทุก 5 วิ — ดูผลจากอุปกรณ์แบบสดๆ
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated, user, load]);

  const onPickFile = (f: File | null) => {
    setSelectedFile(f);
    if (f && !customName) setCustomName(f.name);
  };

  const upload = async () => {
    if (!selectedFile) return;
    const name = customName.trim() || selectedFile.name;
    if (!name.endsWith('.bin')) {
      setError(t('ota.fileExtError', 'ชื่อไฟล์ต้องลงท้ายด้วย .bin'));
      return;
    }
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: selectedFile,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage(t('ota.uploadSuccess', 'อัปโหลด {name} สำเร็จ', { name }));
      setSelectedFile(null);
      setCustomName('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      console.error(err);
      setError(t('ota.uploadFailed', 'อัปโหลดไม่สำเร็จ: {msg}', { msg: (err as Error).message || 'unknown' }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: string) => {
    if (!window.confirm(t('ota.deleteConfirm', 'ลบ firmware "{file}"?', { file }))) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares/${encodeURIComponent(file)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      console.error(err);
      setError(t('ota.deleteFailed', 'ลบไม่สำเร็จ'));
    }
  };

  const deploy = async () => {
    if (!targetDevice || !targetFirmware) {
      setError(t('ota.pickFirst', 'เลือกอุปกรณ์และ firmware ก่อน'));
      return;
    }
    if (!window.confirm(t('ota.deployConfirm', 'ส่งคำสั่ง OTA ไปยังอุปกรณ์ "{device}"\nFirmware: {firmware}\nอุปกรณ์จะดาวน์โหลด + อัปเดต + รีบูตอัตโนมัติ', { device: targetDevice, firmware: targetFirmware }))) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: targetDevice, file: targetFirmware }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage(t('ota.deploySent', 'ส่งคำสั่ง OTA แล้ว — รออุปกรณ์ดาวน์โหลดและรีบูต'));
      await load();
    } catch (err) {
      console.error(err);
      setError(t('ota.deployFailed', 'สั่ง OTA ไม่สำเร็จ: {msg}', { msg: (err as Error).message || 'unknown' }));
    } finally {
      setBusy(false);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('ota.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('ota.page.eyebrow', 'อุปกรณ์ & พลังงาน')}
          title={t('ota.page.title', 'ESP OTA Updates')} icon={<Icon name="ota" size={18} />} actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('ota.page.backDashboard', '← กลับ Dashboard')}</Link>}
        />
      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">
        {!isSuperAdmin && (
          <div className="card px-4 py-3 text-sm text-amber-400">
            {t('ota.adminOnly', 'อัปโหลด/Deploy ใช้งานได้เฉพาะ SUPERADMIN (ดูรายการได้ทุก role)')}
          </div>
        )}

        {message && <div className="card p-3 text-sm text-emerald-400">{message}</div>}
        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        {/* อัปโหลด */}
        <div className="panel panel-glow p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('ota.uploadTitle', 'อัปโหลด Firmware (.bin)')}</h2>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".bin"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="text-sm text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 file:text-sm file:cursor-pointer"
            />
            <input
              type="text"
              placeholder={t('ota.fileNamePlaceholder', 'ชื่อไฟล์ (เช่น esp32_v1.2.0.bin)')}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="input flex-1 min-w-48 text-sm"
            />
            <button
              onClick={upload}
              disabled={!selectedFile || busy || !isSuperAdmin}
              className="btn-primary"
            >
              {busy ? t('ota.uploading', 'อัปโหลด…') : <><Icon name="upload" size={14} /> {t('ota.upload', 'อัปโหลด')}</>}
            </button>
          </div>
          <p className="text-xs text-gray-600">{t('ota.buildHint', 'ใช้วิธี build ผ่าน Arduino IDE: Sketch → Export Compiled Binary แล้วอัปโหลดไฟล์จากโฟลเดอร์ build')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* รายการ firmware */}
          <div className="panel panel-cyan p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('ota.firmwareList', 'Firmware ({n})', { n: firmwares.length })}</h2>
              <button onClick={load} className="btn-secondary">
                <Icon name="refresh" size={14} /> {t('common.refresh', 'รีเฟรช')}
              </button>
            </div>
            {firmwares.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-6">{t('ota.noFirmware', 'ยังไม่มี firmware — อัปโหลดก่อน')}</div>
            ) : (
              <div className="space-y-2">
                {firmwares.map((fw) => (
                  <div key={fw.file} className="flex items-center justify-between gap-2 inset px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-emerald-400 font-mono truncate glow-text">{fw.file}</div>
                      <div className="text-xs text-gray-500">{formatSize(fw.size)} · {new Date(fw.date).toLocaleString(fmtLocale())}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares/${encodeURIComponent(fw.file)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary text-xs px-2.5 py-1"
                      >
                        <Icon name="download" size={14} />
                      </a>
                      <button
                        onClick={() => setTargetFirmware(fw.file)}
                        className={`text-xs px-2.5 py-1 rounded border ${
                          targetFirmware === fw.file
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                        }`}
                      >
                        {t('common.select', 'เลือก')}
                      </button>
                      {isSuperAdmin && (
                        <button onClick={() => remove(fw.file)} className="text-xs px-2.5 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded">
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Deploy */}
          <div className="panel panel-glow p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('ota.deployTitle', 'สั่ง OTA ไปยังอุปกรณ์')}</h2>
            <div>
              <div className="text-xs text-gray-500 mb-1">{t('ota.pickDeviceLabel', 'เลือกอุปกรณ์ (nodeId):')}</div>
              <select
                value={targetDevice}
                onChange={(e) => setTargetDevice(e.target.value)}
                className="input w-full text-sm"
              >
                <option value="">{t('ota.pickDevicePlaceholder', '— เลือกอุปกรณ์ —')}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.node_id}>
                    {d.type} · {d.node_id} {d.is_active ? '' : t('ota.inactive', '(ปิดใช้งาน)')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">{t('ota.selectedFirmwareLabel', 'Firmware ที่เลือก:')}</div>
              <div className="input text-sm">
                {targetFirmware || t('ota.notSelected', '— ยังไม่ได้เลือก —')}
              </div>
            </div>
            <button
              onClick={deploy}
              disabled={busy || !isSuperAdmin || !targetDevice || !targetFirmware}
              className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? t('ota.sending', 'กำลังส่ง…') : t('ota.deployBtn', 'DEPLOY (ผ่าน MQTT)')}
            </button>
            <p className="text-xs text-gray-600">
              {t('ota.deployHintStart', 'ส่ง JSON {payload} ไปที่ topic ', { payload: '{ url, file, version }' })}<code className="text-gray-400">sovereign/{"{nodeId}"}/ota/command</code>{t('ota.deployHintEnd', ' — อุปกรณ์ต้องรันโค้ด OTA (ดูตัวอย่างใน repo: firmware/esp32_ota_example.ino)')}
            </p>
          </div>
        </div>

        {/* ประวัติ OTA */}
        <div className="panel panel-cyan p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('ota.eventsTitle', 'เหตุการณ์ OTA ({n}) ', { n: events.length })}<span className="text-xs text-gray-500 font-normal">{t('ota.autoUpdateHint', '— อัปเดตอัตโนมัติทุก 5 วิ')}</span></h2>
            <button onClick={load} className="btn-secondary">
              <Icon name="refresh" size={14} /> {t('common.refresh', 'รีเฟรช')}
            </button>
          </div>
          {events.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4">{t('ota.noEvents', 'ยังไม่มีเหตุการณ์ — สั่ง deploy แล้วผลจากอุปกรณ์จะโผล่ตรงนี้')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-4">{t('common.time', 'เวลา')}</th>
                    <th className="py-2 pr-4">Node</th>
                    <th className="py-2 pr-4">{t('ota.thFirmware', 'Firmware / Version')}</th>
                    <th className="py-2 pr-4">{t('ota.thType', 'ประเภท')}</th>
                    <th className="py-2">{t('common.status', 'สถานะ')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {events.map((e) => {
                    const badge = statusBadges[e.status] || statusBadges.unknown;
                    return (
                      <tr key={e.id} className="border-b border-gray-800">
                        <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{new Date(e.created_at).toLocaleString(fmtLocale())}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-300">{e.node_id}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-emerald-400">
                          {e.firmware || e.version || '—'}
                          {e.error && <div className="text-red-400">{e.error}</div>}
                        </td>
                        <td className="py-2 pr-4 text-xs text-gray-500">{e.type === 'deploy' ? t('ota.typeDeploy', 'คำสั่ง') : t('ota.typeReport', 'รายงาน')}</td>
                        <td className="py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.cls}`}>
                            {t('ota.status.' + e.status, badge.label)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
      </div>
  );
}
