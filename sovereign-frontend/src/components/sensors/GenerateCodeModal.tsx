"use client";
import { useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import type { Device } from './DeviceCard';

// สร้างโค้ด firmware ให้อุปกรณ์หนึ่งตัว — แยกไฟล์เพื่อให้ SensorsHub อยู่ในเพดานบรรทัด
export default function GenerateCodeModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const t = useLanguageStore((s) => s.t);
  const [ssid, setSsid] = useState('SolarKiller');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const generate = async () => {
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/generate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: device.type,
          sensors: device.sensors?.map((s) => s.metric) || ['rain_detect'],
          wifiSSID: ssid,
          wifiPass: pass,
          deviceId: device.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // คำขอล้ม = ต้องบอกผู้ใช้ ไม่ใช่ปล่อยช่องโค้ดว่างให้เดาเอง
        setCode('');
        setError(String(data?.error || t('sensorsHub.generateFailed', 'สร้างโค้ดไม่สำเร็จ')));
        return;
      }
      setCode(String(data?.code || ''));
    } catch {
      setCode('');
      setError(t('sensorsHub.generateFailed', 'สร้างโค้ดไม่สำเร็จ'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="card p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">{t('sensorsHub.modalTitle', 'Generate Arduino Code for {type}', { type: device.type })}</h3>
        <div className="mb-4">
          <label htmlFor="wifiSSID" className="label">WiFi SSID</label>
          <input id="wifiSSID" className="input w-full" value={ssid} onChange={(e) => setSsid(e.target.value)} />
        </div>
        <div className="mb-4">
          <label htmlFor="wifiPass" className="label">WiFi Password</label>
          <input id="wifiPass" type="password" className="input w-full" value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
        <button onClick={generate} className="px-4 py-2 btn-primary mb-4">Generate</button>
        {error && <div className="mb-3 p-2 rounded text-xs bg-red-900/30 text-red-400">{error}</div>}
        {code && (
          <textarea readOnly className="w-full h-64 bg-gray-800 text-emerald-400 text-xs p-2 rounded" value={code} />
        )}
        <button onClick={onClose} className="mt-4 px-4 py-2 btn-secondary rounded">Close</button>
      </div>
    </div>
  );
}
