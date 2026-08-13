"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

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
  sent: { label: '📤 ส่งคำสั่ง', cls: 'bg-blue-900/50 text-blue-300 border-blue-700' },
  success: { label: '✅ อัปเดตสำเร็จ', cls: 'bg-green-900/50 text-green-300 border-green-700' },
  failed: { label: '❌ ล้มเหลว', cls: 'bg-red-900/50 text-red-300 border-red-700' },
  rebooted: { label: '🔄 รีบูตแล้ว (เวอร์ชันใหม่)', cls: 'bg-purple-900/50 text-purple-300 border-purple-700' },
  unknown: { label: '⚠️ ไม่รู้จัก', cls: 'bg-gray-800 text-gray-400 border-gray-600' },
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

export default function OtaPage() {
  const { user, isAuthenticated } = useAuthStore();
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

  const isSuperAdmin = user?.role === 'SUPERADMIN';

  const load = useCallback(async () => {
    try {
      const [fwRes, devRes, evRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/events`),
      ]);
      setFirmwares(await fwRes.json());
      setDevices(await devRes.json());
      setEvents(await evRes.json());
    } catch (err) {
      console.error(err);
      setError('โหลดข้อมูลไม่สำเร็จ — ตรวจว่า backend เปิดอยู่');
    }
  }, []);

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
      setError('ชื่อไฟล์ต้องลงท้ายด้วย .bin');
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
      setMessage(`✅ อัปโหลด ${name} สำเร็จ`);
      setSelectedFile(null);
      setCustomName('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      console.error(err);
      setError('อัปโหลดไม่สำเร็จ: ' + ((err as Error).message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: string) => {
    if (!window.confirm(`ลบ firmware "${file}"?`)) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares/${encodeURIComponent(file)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      console.error(err);
      setError('ลบไม่สำเร็จ');
    }
  };

  const deploy = async () => {
    if (!targetDevice || !targetFirmware) {
      setError('เลือกอุปกรณ์และ firmware ก่อน');
      return;
    }
    if (!window.confirm(`⚠️ ส่งคำสั่ง OTA ไปยังอุปกรณ์ "${targetDevice}"\nFirmware: ${targetFirmware}\nอุปกรณ์จะดาวน์โหลด + อัปเดต + รีบูตอัตโนมัติ`)) return;
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
      setMessage('🚀 ส่งคำสั่ง OTA แล้ว — รออุปกรณ์ดาวน์โหลดและรีบูต');
      await load();
    } catch (err) {
      console.error(err);
      setError('สั่ง OTA ไม่สำเร็จ: ' + ((err as Error).message || 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="อุปกรณ์ &amp; พลังงาน"
          title="🚀 ESP OTA Updates" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {!isSuperAdmin && (
          <div className="text-sm text-yellow-400 bg-yellow-900/30 border border-yellow-700 rounded-lg px-4 py-3">
            🔒 อัปโหลด/Deploy ใช้งานได้เฉพาะ SUPERADMIN (ดูรายการได้ทุก role)
          </div>
        )}

        {message && <div className="text-sm text-green-400 bg-green-900/30 border border-green-700 rounded-lg px-4 py-3">{message}</div>}
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}

        {/* อัปโหลด */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
          <h2 className="font-bold text-gray-200">📤 อัปโหลด Firmware (.bin)</h2>
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
              placeholder="ชื่อไฟล์ (เช่น esp32_v1.2.0.bin)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="flex-1 min-w-48 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
            />
            <button
              onClick={upload}
              disabled={!selectedFile || busy || !isSuperAdmin}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? '⏳ อัปโหลด…' : '📤 อัปโหลด'}
            </button>
          </div>
          <p className="text-xs text-gray-600">ใช้วิธี build ผ่าน Arduino IDE: Sketch → Export Compiled Binary แล้วอัปโหลดไฟล์จากโฟลเดอร์ build</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* รายการ firmware */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-gray-200">📦 Firmware ({firmwares.length})</h2>
              <button onClick={load} className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded">
                🔄 รีเฟรช
              </button>
            </div>
            {firmwares.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-6">ยังไม่มี firmware — อัปโหลดก่อน</div>
            ) : (
              <div className="space-y-2">
                {firmwares.map((fw) => (
                  <div key={fw.file} className="flex items-center justify-between gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-green-400 font-mono truncate">{fw.file}</div>
                      <div className="text-xs text-gray-500">{formatSize(fw.size)} · {new Date(fw.date).toLocaleString('th-TH')}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL}/api/ota/firmwares/${encodeURIComponent(fw.file)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-2.5 py-1 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded"
                      >
                        ⬇️
                      </a>
                      <button
                        onClick={() => setTargetFirmware(fw.file)}
                        className={`text-xs px-2.5 py-1 rounded border ${
                          targetFirmware === fw.file
                            ? 'bg-green-600 border-green-600 text-white'
                            : 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                        }`}
                      >
                        เลือก
                      </button>
                      {isSuperAdmin && (
                        <button onClick={() => remove(fw.file)} className="text-xs px-2.5 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded">
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Deploy */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
            <h2 className="font-bold text-gray-200">📡 สั่ง OTA ไปยังอุปกรณ์</h2>
            <div>
              <div className="text-xs text-gray-500 mb-1">เลือกอุปกรณ์ (nodeId):</div>
              <select
                value={targetDevice}
                onChange={(e) => setTargetDevice(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
              >
                <option value="">— เลือกอุปกรณ์ —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.node_id}>
                    {d.type} · {d.node_id} {d.is_active ? '' : '(ปิดใช้งาน)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Firmware ที่เลือก:</div>
              <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-green-400 font-mono">
                {targetFirmware || '— ยังไม่ได้เลือก —'}
              </div>
            </div>
            <button
              onClick={deploy}
              disabled={busy || !isSuperAdmin || !targetDevice || !targetFirmware}
              className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? '⏳ กำลังส่ง…' : '🚀 DEPLOY (ผ่าน MQTT)'}
            </button>
            <p className="text-xs text-gray-600">
              ส่ง JSON {'{ url, file, version }'} ไปที่ topic <code className="text-gray-400">sovereign/{"{nodeId}"}/ota/command</code> — อุปกรณ์ต้องรันโค้ด OTA (ดูตัวอย่างใน repo: firmware/esp32_ota_example.ino)
            </p>
          </div>
        </div>

        {/* ประวัติ OTA */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-gray-200">🕐 เหตุการณ์ OTA ({events.length}) <span className="text-xs text-gray-500 font-normal">— อัปเดตอัตโนมัติทุก 5 วิ</span></h2>
            <button onClick={load} className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded">
              🔄 รีเฟรช
            </button>
          </div>
          {events.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4">ยังไม่มีเหตุการณ์ — สั่ง deploy แล้วผลจากอุปกรณ์จะโผล่ตรงนี้</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-4">เวลา</th>
                    <th className="py-2 pr-4">Node</th>
                    <th className="py-2 pr-4">Firmware / Version</th>
                    <th className="py-2 pr-4">ประเภท</th>
                    <th className="py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const badge = statusBadges[e.status] || statusBadges.unknown;
                    return (
                      <tr key={e.id} className="border-b border-gray-800">
                        <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{new Date(e.created_at).toLocaleString('th-TH')}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-300">{e.node_id}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-green-400">
                          {e.firmware || e.version || '—'}
                          {e.error && <div className="text-red-400">{e.error}</div>}
                        </td>
                        <td className="py-2 pr-4 text-xs text-gray-500">{e.type === 'deploy' ? '📤 คำสั่ง' : '📡 รายงาน'}</td>
                        <td className="py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.cls}`}>
                            {badge.label}
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
