"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import Sidebar from '../layout/Sidebar';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

type Tab = 'devices' | 'data';

// ── ข้อมูลร่วมระหว่างแท็บ ──
const METRIC_OPTIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'battery_soc', label: 'แบตเตอรี่' },
  { value: 'water_level_cm', label: 'ระดับน้ำ' },
  { value: 'power_kw', label: 'กำลังไฟฟ้า' },
  { value: 'temperature', label: 'อุณหภูมิ' },
  { value: 'humidity', label: 'ความชื้นอากาศ' },
  { value: 'soil_moisture', label: 'ความชื้นดิน' },
  { value: 'ec_value', label: 'ค่า EC' },
  { value: 'ph', label: 'pH ดิน' },
  { value: 'solar_radiation', label: 'แสงอาทิตย์' },
  { value: 'wind_speed', label: 'ความเร็วลม' },
  { value: 'rainfall', label: 'ปริมาณน้ำฝน' },
  { value: 'ultrasonic_distance', label: 'Ultrasonic' },
  { value: 'pir_motion', label: 'PIR Motion' },
  { value: 'rain_detect', label: 'ตรวจจับฝน' },
  { value: 'smoke', label: 'Smoke' },
  { value: 'gas_leak', label: 'Gas Leak' },
  { value: 'door_state', label: 'Door' },
];

interface Device {
  id: string;
  type: string;
  mqtt_topic: string;
  is_active: boolean;
  online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  sensors: { metric: string; value: number }[];
}

interface SensorRecord {
  time: string;
  node_id: string;
  device_id: string;
  metric: string;
  value: number;
}

const METRIC_LABEL: Record<string, string> = {
  battery_soc: 'แบตเตอรี่',
  water_level_cm: 'ระดับน้ำ',
  power_kw: 'กำลังไฟฟ้า',
  temperature: 'อุณหภูมิ',
  humidity: 'ความชื้นอากาศ',
  soil_moisture: 'ความชื้นดิน',
  ec_value: 'ค่า EC',
  ph: 'pH ดิน',
  solar_radiation: 'แสงอาทิตย์',
  wind_speed: 'ความเร็วลม',
  rainfall: 'ปริมาณน้ำฝน',
  ultrasonic_distance: 'Ultrasonic',
  pir_motion: 'PIR Motion',
  rain_detect: 'ตรวจจับฝน',
  smoke: 'Smoke',
  gas_leak: 'Gas Leak',
  door_state: 'Door',
};

export default function SensorsHub({ initialTab = 'devices' }: { initialTab?: Tab }) {
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [tab, setTab] = useState<Tab>(initialTab);

  // รองรับ /sensors?tab=data — ลิงก์จาก Dashboard เข้ามาที่แท็บข้อมูลเซ็นเซอร์
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q === 'data') setTab('data');
    } catch {
      /* noop */
    }
  }, []);

  // ── แท็บอุปกรณ์ (Device Manager) ──
  const [devices, setDevices] = useState<Device[]>([]);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('ESP8266');
  const [message, setMessage] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');

  // ── แท็บข้อมูล (Sensor Data) ──
  const [records, setRecords] = useState<SensorRecord[]>([]);
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);

  const loadDevices = async () => {
    if (!token) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/devices`);
      const data = await res.json();
      setDevices(data);
    } catch (err) {
      console.error('Load devices error:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/sensors/all?metric=${filter}&limit=${limit}`
      );
      const data = await res.json();
      setRecords(data);
    } catch {
      setRecords([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadDevices();
    const interval = setInterval(loadDevices, 10000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, token]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, token, filter, limit]);

  // ── Actions: อุปกรณ์ ──
  const addDevice = async () => {
    if (!deviceName.trim()) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: deviceName,
          type: deviceType,
          mqtt_topic: `sovereign/${deviceName}/sensor/+`,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(t('sensorsHub.addDeviceSuccess', '✅ เพิ่มอุปกรณ์ {name} สำเร็จ', { name: deviceName }));
        setDeviceName('');
        setShowAddDevice(false);
        loadDevices();
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage(t('sensorsHub.addDeviceFailed', '❌ ไม่สามารถเพิ่มอุปกรณ์ได้'));
    }
  };

  const deleteDevice = async (id: string) => {
    if (!confirm(t('sensorsHub.confirmDeleteDevice', 'ยืนยันการลบอุปกรณ์?'))) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/devices/${id}`, {
      method: 'DELETE',
    });
    loadDevices();
  };

  const setDeviceLocation = async (device: Device) => {
    const current = device.latitude != null && device.longitude != null
      ? `${device.latitude}, ${device.longitude}`
      : '';
    const input = prompt(t('sensorsHub.gpsPrompt', 'พิกัด GPS (ละติจูด, ลองจิจูด เช่น 13.7563, 100.5018):'), current)?.trim();
    if (!input) return;
    const parts = input.split(',').map((s) => s.trim());
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (parts.length < 2 || Number.isNaN(lat) || Number.isNaN(lng)) {
      setMessage(t('sensorsHub.gpsInvalid', '❌ รูปแบบพิกัดไม่ถูกต้อง — ใช้ lat, lng เช่น 13.7563, 100.5018'));
      return;
    }
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices/${device.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(`❌ ${data.error || t('sensorsHub.gpsSetFailed', 'ตั้งพิกัดไม่สำเร็จ')}`);
        return;
      }
      setMessage(t('sensorsHub.gpsSetSuccess', '✅ ตั้งพิกัด {lat}, {lng} สำเร็จ', { lat: lat.toFixed(4), lng: lng.toFixed(4) }));
      loadDevices();
    } catch {
      setMessage(t('sensorsHub.gpsSetError', '❌ ไม่สามารถตั้งพิกัดได้'));
    }
  };

  // ── Actions: ข้อมูล ──
  const deleteOne = async (record: SensorRecord) => {
    if (!confirm(t('sensorsHub.confirmDeleteOne', 'ลบ {label} = {value}?', { label: t(`sensorsHub.metric.${record.metric}`, METRIC_LABEL[record.metric] || record.metric), value: record.value }))) return;
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/sensors/${record.metric}?device_id=${record.device_id}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      setMessage(data.success ? t('sensorsHub.deletedOne', '✅ ลบแล้ว') : `❌ ${data.error}`);
      loadData();
    } catch {
      setMessage(t('sensorsHub.deleteFailed', '❌ ลบไม่สำเร็จ'));
    }
  };

  const deleteAll = async (metric: string) => {
    if (!confirm(t('sensorsHub.confirmDeleteAll', 'ลบข้อมูล "{label}" ทั้งหมด?', { label: t(`sensorsHub.metric.${metric}`, METRIC_LABEL[metric] || metric) }))) return;
    try {
      await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/sensors/${metric}/all`,
        { method: 'DELETE' }
      );
      setMessage(t('sensorsHub.deleteAllSuccess', '✅ ลบ {label} ทั้งหมดแล้ว', { label: t(`sensorsHub.metric.${metric}`, METRIC_LABEL[metric] || metric) }));
      loadData();
    } catch {
      setMessage(t('sensorsHub.deleteFailed', '❌ ลบไม่สำเร็จ'));
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('sensorsHub.unauthorized', 'Unauthorized')}</div>;
  }

  const latestBattery = records.filter(r => r.metric === 'battery_soc')[0]?.value;
  const latestTemp = records.filter(r => r.metric === 'temperature')[0]?.value;
  const latestRain = records.filter(r => r.metric === 'rain_detect')[0]?.value;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex justify-between items-center">
          <h1 className="text-sm font-semibold text-gray-200">
            SOVEREIGN OS <span className="text-xs text-gray-500 ml-2">{t('sensorsHub.headerSub', 'Sensors & Devices')}</span>
          </h1>
          <a href="/dashboard" className="text-sm text-sky-400 hover:underline">Dashboard</a>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 bg-gray-900/60">
          <button
            onClick={() => setTab('devices')}
            className={`px-6 py-3 text-sm font-bold border-b-2 transition ${tab === 'devices' ? 'border-emerald-400 text-emerald-400 shadow-neon-green' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            {t('sensorsHub.tabDevices', 'อุปกรณ์ (Device Manager)')}
          </button>
          <button
            onClick={() => setTab('data')}
            className={`px-6 py-3 text-sm font-bold border-b-2 transition ${tab === 'data' ? 'border-emerald-400 text-emerald-400 shadow-neon-green' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            {t('sensorsHub.tabData', 'ข้อมูลเซ็นเซอร์ (Sensor Data)')}
          </button>
        </div>

        <main className="max-w-6xl mx-auto p-6 space-y-6 w-full">
          {message && (
            <div className={`p-3 rounded text-sm ${message.startsWith('✅') ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{message}</div>
          )}

          {/* ════════════════ แท็บ: อุปกรณ์ ════════════════ */}
          {tab === 'devices' && (
            <>
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('sensorsHub.deviceCount', 'อุปกรณ์ทั้งหมด ({n})', { n: devices.length })}</h2>
                <button onClick={() => setShowAddDevice(!showAddDevice)} className="btn-primary text-sm px-4 py-2">
                  {showAddDevice ? <><Icon name="x" size={13} /> {t('common.close', 'ปิด')}</> : <><Icon name="plus" size={13} /> {t('sensorsHub.addDevice', 'เพิ่มอุปกรณ์')}</>}
                </button>
              </div>

              {showAddDevice && (
                <div className="panel p-4 space-y-3">
                  <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={t('sensorsHub.deviceNamePlaceholder', 'ชื่ออุปกรณ์ (เช่น ESP8266-Home)')} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white" />
                  <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white">
                    <option value="ESP8266">ESP8266</option>
                    <option value="ESP32">ESP32</option>
                    <option value="Arduino">Arduino</option>
                    <option value="RaspberryPi">Raspberry Pi</option>
                    <option value="Other">{t('sensorsHub.otherType', 'อื่นๆ')}</option>
                  </select>
                  <button onClick={addDevice} className="w-full btn-primary py-2"><Icon name="save" size={13} /> {t('sensorsHub.saveDevice', 'บันทึกอุปกรณ์')}</button>
                </div>
              )}

              <div className="space-y-4">
                {devices.map((device) => (
                  <div key={device.id} className="panel p-4">
                    <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-200">{device.type}</h3>
                        <p className="text-xs text-gray-400">{device.id}</p>
                        <p className="text-xs text-gray-500">{device.mqtt_topic}</p>
                        <span className={`inline-flex items-center gap-1 text-xs ${device.online ? 'text-emerald-400' : 'text-red-400'}`}>
                          <span className={`w-2 h-2 rounded-full ${device.online ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          {device.online ? t('common.online', 'ออนไลน์') : t('common.offline', 'ออฟไลน์')}
                        </span>
                        {device.latitude != null && device.longitude != null && (
                          <span className="inline-flex items-center gap-1 text-xs text-cyan-500 ml-2"><Icon name="map-pin" size={11} /> {device.latitude.toFixed(3)}, {device.longitude.toFixed(3)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedDevice(device)} className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"><Icon name="code" size={12} /> Generate Code</button>
                        <button onClick={() => setDeviceLocation(device)} className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center gap-1" title={t('sensorsHub.setLocationTitle', 'ตั้งพิกัด GPS สำหรับแผนที่')}><Icon name="map-pin" size={12} /> {t('sensorsHub.locationBtn', 'พิกัด')}</button>
                        <button onClick={() => deleteDevice(device.id)} className="text-red-400 hover:text-red-300 text-sm"><Icon name="trash" size={13} /></button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {device.sensors?.map((sensor) => (
                        <div key={sensor.metric} className="inset p-2 text-center">
                          <div className="text-xs text-gray-400">{t(`sensorsHub.metric.${sensor.metric}`, METRIC_LABEL[sensor.metric] || sensor.metric)}</div>
                          <div className="text-lg font-bold text-emerald-400 glow-text">{sensor.value}</div>
                        </div>
                      ))}
                      {(!device.sensors || device.sensors.length === 0) && (
                        <div className="text-xs text-gray-500 col-span-3">{t('sensorsHub.noSensorData', 'ยังไม่มีข้อมูลเซ็นเซอร์ — ดูข้อมูลที่แท็บ "ข้อมูลเซ็นเซอร์"')}</div>
                      )}
                    </div>
                  </div>
                ))}
                {devices.length === 0 && <div className="text-gray-500 text-center py-8">{t('sensorsHub.noDevices', 'ยังไม่มีอุปกรณ์ — เพิ่มอุปกรณ์แรกของคุณ')}</div>}
              </div>

              {/* Generate Code Modal */}
              {selectedDevice && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                  <div className="panel p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
                    <h3 className="text-lg font-bold mb-4">{t('sensorsHub.modalTitle', 'Generate Arduino Code for {type}', { type: selectedDevice.type })}</h3>
                    <div className="mb-4">
                      <label className="text-sm text-gray-400">WiFi SSID</label>
                      <input id="wifiSSID" className="w-full bg-gray-800 border rounded px-3 py-2" defaultValue="SolarKiller" />
                    </div>
                    <div className="mb-4">
                      <label className="text-sm text-gray-400">WiFi Password</label>
                      <input id="wifiPass" type="password" className="w-full bg-gray-800 border rounded px-3 py-2" />
                    </div>
                    <button onClick={async () => {
                      const ssid = (document.getElementById('wifiSSID') as HTMLInputElement).value;
                      const pass = (document.getElementById('wifiPass') as HTMLInputElement).value;
                      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/generate-code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: selectedDevice.type,
                          sensors: selectedDevice.sensors?.map(s => s.metric) || ['rain_detect'],
                          wifiSSID: ssid,
                          wifiPass: pass,
                          deviceId: selectedDevice.id,
                        }),
                      });
                      const data = await res.json();
                      setGeneratedCode(data.code);
                    }} className="px-4 py-2 btn-primary mb-4">Generate</button>
                    {generatedCode && (
                      <textarea readOnly className="w-full h-64 bg-gray-800 text-emerald-400 text-xs p-2 rounded" value={generatedCode} />
                    )}
                    <button onClick={() => { setSelectedDevice(null); setGeneratedCode(''); }} className="mt-4 px-4 py-2 btn-secondary rounded">Close</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════ แท็บ: ข้อมูลเซ็นเซอร์ ════════════════ */}
          {tab === 'data' && (
            <>
              {/* สถิติรวม */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="panel panel-cyan p-3">
                  <div className="text-xs text-gray-400 flex items-center gap-1"><Icon name="database" size={11} /> {t('sensorsHub.statShowing', 'ข้อมูลที่แสดง')}</div>
                  <div className="text-2xl font-bold glow-text">{records.length}</div>
                </div>
                <div className="panel panel-cyan p-3">
                  <div className="text-xs text-gray-400 flex items-center gap-1"><Icon name="battery" size={11} /> {t('sensorsHub.statBattery', 'แบตเตอรี่ล่าสุด')}</div>
                  <div className="text-2xl font-bold glow-text">{latestBattery ?? 'N/A'}%</div>
                </div>
                <div className="panel panel-cyan p-3">
                  <div className="text-xs text-gray-400 flex items-center gap-1"><Icon name="thermometer" size={11} /> {t('sensorsHub.statTemp', 'อุณหภูมิ')}</div>
                  <div className="text-2xl font-bold glow-text">{latestTemp ?? 'N/A'}°C</div>
                </div>
                <div className="panel panel-cyan p-3">
                  <div className="text-xs text-gray-400 flex items-center gap-1"><Icon name="droplet" size={11} /> {t('sensorsHub.statRain', 'ฝนตก')}</div>
                  <div className="text-2xl font-bold glow-text">{latestRain === 1 ? t('sensorsHub.raining', 'ตก') : latestRain === 0 ? t('sensorsHub.notRaining', 'ไม่ตก') : 'N/A'}</div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex gap-4 flex-wrap items-end">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('sensorsHub.filterBy', 'กรองตามประเภท')}</label>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    {METRIC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(`sensorsHub.metric.${opt.value}`, opt.label)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t('sensorsHub.limitBy', 'จำนวนที่แสดง')}</label>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button onClick={loadData} className="px-4 py-2 btn-secondary text-sm flex items-center gap-1"><Icon name="refresh" size={13} /> {t('common.refresh', 'รีเฟรช')}</button>
                {filter !== 'all' && (
                  <button onClick={() => deleteAll(filter)} className="px-4 py-2 btn-danger text-sm flex items-center gap-1">
                    <Icon name="trash" size={13} /> {t('sensorsHub.deleteAllMetric', 'ลบ "{metric}" ทั้งหมด', { metric: t(`sensorsHub.metric.${filter}`, METRIC_LABEL[filter] || filter) })}
                  </button>
                )}
              </div>

              {/* Table */}
              <div className="panel panel-cyan overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3">{t('sensorsHub.colTime', 'เวลา')}</th>
                      <th className="px-4 py-3">Device</th>
                      <th className="px-4 py-3">Metric</th>
                      <th className="px-4 py-3">{t('common.value', 'ค่า')}</th>
                      <th className="px-4 py-3">{t('sensorsHub.colActions', 'จัดการ')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {records.map((rec, i) => (
                      <tr key={i} className="hover:bg-gray-800/50">
                        <td className="px-4 py-2 text-xs text-gray-400">{new Date(rec.time).toLocaleString(fmtLocale())}</td>
                        <td className="px-4 py-2 text-xs text-gray-300">{rec.device_id}</td>
                        <td className="px-4 py-2 text-emerald-300">{t(`sensorsHub.metric.${rec.metric}`, METRIC_LABEL[rec.metric] || rec.metric)}</td>
                        <td className="px-4 py-2 font-bold text-white glow-text">{rec.value}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => deleteOne(rec)} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1"><Icon name="trash" size={11} /> {t('common.delete', 'ลบ')}</button>
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && !loading && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        {filter === 'all' ? t('sensorsHub.emptyAll', 'ยังไม่มีข้อมูลเซ็นเซอร์') : t('sensorsHub.emptyFiltered', 'ไม่มีข้อมูลสำหรับ "{metric}"', { metric: t(`sensorsHub.metric.${filter}`, METRIC_LABEL[filter] || filter) })}
                      </td></tr>
                    )}
                    {loading && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-gray-500">{t('sensorsHub.footerInfo', 'แสดง {n} รายการ · โหลดอัตโนมัติทุก 10 วินาที', { n: records.length })}</div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
