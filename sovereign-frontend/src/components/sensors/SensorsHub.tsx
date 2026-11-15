"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import Sidebar from '../layout/Sidebar';
import Icon from '../ui/Icon';
import PageHeader from '../ui/PageHeader';
import StatCard from '../ui/StatCard';
import EmptyState from '../ui/EmptyState';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
import { useTelemetryDelete } from '../../lib/sensors/use-telemetry-delete';
import { METRIC_OPTIONS, METRIC_LABEL } from '../../lib/sensors/metrics';
import DeviceCard, { type Device } from './DeviceCard';
import GenerateCodeModal from './GenerateCodeModal';

type Tab = 'devices' | 'data';

// ── ข้อมูลร่วมระหว่างแท็บ (METRIC_OPTIONS / METRIC_LABEL อยู่ใน lib/sensors/metrics.ts) ──
interface SensorRecord {
  time: string;
  node_id: string;
  device_id: string;
  metric: string;
  value: number;
}

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
  // อ่านรายการไม่ได้ ≠ ไม่มีอุปกรณ์ — ต้องแยกสถานะให้ผู้ใช้เห็น (หลักฐานเท็จ = ห้าม)
  const [devicesDegraded, setDevicesDegraded] = useState(false);
  const [devicesReason, setDevicesReason] = useState('');
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('ESP8266');
  const [message, setMessage] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // ── แท็บข้อมูล (Sensor Data) ──
  const [records, setRecords] = useState<SensorRecord[]>([]);
  const [dataError, setDataError] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);

  const loadDevices = async () => {
    if (!token) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/devices`);
      const data = await res.json();
      // รูปแบบจริงคือ { devices, degraded, reason } — รองรับ array เดิมของ mock/preview ด้วย
      const list = Array.isArray(data) ? data : Array.isArray(data?.devices) ? data.devices : [];
      setDevices(list);
      setDevicesDegraded(!Array.isArray(data) && data?.degraded === true);
      setDevicesReason(String(data?.reason || ''));
    } catch {
      setDevices([]);
      setDevicesDegraded(true);
      setDevicesReason(t('sensorsHub.devicesUnreachable', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — สถานะอุปกรณ์ไม่ทราบ'));
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/sensors/all?metric=${filter}&limit=${limit}`
      );
      const data = await res.json();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : [];
      // กรอง row ที่ metric ว่าง (ข้อมูลเสียจากอดีต) — แสดงไม่ได้และลบทีละแถวไม่ได้
      // เพราะ URL ลบคือ /api/sensors/{metric} (segment ว่างไม่ match route)
      setRecords(rows.filter((r: SensorRecord) => r.metric && r.metric.trim()));
      // อ่านไม่สำเร็จ = ต้องบอก ไม่ใช่โชว์ตารางว่างที่อ่านว่า "ไม่มีข้อมูล"
      setDataError(res.ok ? '' : String(data?.error || t('sensorsHub.dataUnavailable', 'อ่านข้อมูลเซ็นเซอร์ไม่ได้')));
    } catch {
      setRecords([]);
      setDataError(t('sensorsHub.dataUnavailable', 'อ่านข้อมูลเซ็นเซอร์ไม่ได้'));
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
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/devices/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(`❌ ${data?.error || t('sensorsHub.deleteDeviceFailed', 'ลบอุปกรณ์ไม่สำเร็จ')}`);
        return;
      }
      setMessage(t('sensorsHub.deleteDeviceSuccess', '✅ ลบอุปกรณ์แล้ว'));
      loadDevices();
    } catch {
      setMessage(t('sensorsHub.deleteDeviceFailed', 'ลบอุปกรณ์ไม่สำเร็จ'));
    }
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
  // ผลลัพธ์ของคำขอลบ: ข้อความ + reload ต้องมาจาก server จริง (403/500 ≠ "ลบแล้ว")
  const { deleteByUrl } = useTelemetryDelete({ t, setMessage, reload: loadData });

  const deleteOne = (record: SensorRecord) => {
    if (!confirm(t('sensorsHub.confirmDeleteOne', 'ลบ {label} = {value}?', { label: t(`sensorsHub.metric.${record.metric}`, METRIC_LABEL[record.metric] || record.metric), value: record.value }))) return;
    deleteByUrl(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/${record.metric}?device_id=${record.device_id}`, t('sensorsHub.deletedOne', '✅ ลบแล้ว'));
  };

  const deleteAll = (metric: string) => {
    if (!confirm(t('sensorsHub.confirmDeleteAll', 'ลบข้อมูล "{label}" ทั้งหมด?', { label: t(`sensorsHub.metric.${metric}`, METRIC_LABEL[metric] || metric) }))) return;
    deleteByUrl(`${process.env.NEXT_PUBLIC_API_URL}/api/sensors/${metric}/all`, t('sensorsHub.deleteAllSuccess', '✅ ลบ {label} ทั้งหมดแล้ว', { label: t(`sensorsHub.metric.${metric}`, METRIC_LABEL[metric] || metric) }));
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
    <div className="atmo-power min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow={t('sensorsHub.eyebrow', 'อุปกรณ์ & พลังงาน')}
            title={t('sensorsHub.title', 'อุปกรณ์และเซ็นเซอร์')}
            subtitle={t('sensorsHub.headerSub', 'จัดการอุปกรณ์ ESP/เซ็นเซอร์ และดูข้อมูลย้อนหลัง')}
            theme="power"
            icon={<Icon name="sensors" size={18} />}
          />

          {/* Tabs */}
          <div className="flex border-b border-gray-800 bg-gray-900/60 rounded-lg overflow-hidden">
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

          <div className="space-y-6">
          {message && (
            <div className={`p-3 rounded text-sm ${message.startsWith('✅') ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{message}</div>
          )}

          {/* ════════════════ แท็บ: อุปกรณ์ ════════════════ */}
          {tab === 'devices' && (
            <>
              {devicesDegraded && (
                <div className="p-3 rounded text-sm bg-amber-900/30 text-amber-300">
                  {t('sensorsHub.devicesDegraded', 'อ่านรายการอุปกรณ์จากเซิร์ฟเวอร์ไม่ได้ — สถานะ "ไม่ทราบ" ไม่ใช่ "ไม่มีอุปกรณ์"')}
                  {devicesReason ? ` (${devicesReason})` : ''}
                </div>
              )}
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('sensorsHub.deviceCount', 'อุปกรณ์ทั้งหมด ({n})', { n: devices.length })}</h2>
                <button onClick={() => setShowAddDevice(!showAddDevice)} className="btn-primary text-sm px-4 py-2">
                  {showAddDevice ? <><Icon name="x" size={13} /> {t('common.close', 'ปิด')}</> : <><Icon name="plus" size={13} /> {t('sensorsHub.addDevice', 'เพิ่มอุปกรณ์')}</>}
                </button>
              </div>

              {showAddDevice && (
                <div className="card p-4 space-y-3">
                  <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={t('sensorsHub.deviceNamePlaceholder', 'ชื่ออุปกรณ์ (เช่น ESP8266-Home)')} className="input w-full" />
                  <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className="input w-full">
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
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onGenerate={setSelectedDevice}
                    onLocation={setDeviceLocation}
                    onDelete={deleteDevice}
                  />
                ))}
                {devices.length === 0 && !devicesDegraded && <div className="card"><EmptyState icon={<Icon name="sensors" size={20} />} title={t('sensorsHub.noDevices', 'ยังไม่มีอุปกรณ์')} description={t('sensorsHub.noDevicesDesc', 'เพิ่มอุปกรณ์แรกของคุณ')} /></div>}
              </div>

              {/* Generate Code Modal */}
              {selectedDevice && (
                <GenerateCodeModal device={selectedDevice} onClose={() => setSelectedDevice(null)} />
              )}
            </>
          )}

          {/* ════════════════ แท็บ: ข้อมูลเซ็นเซอร์ ════════════════ */}
          {tab === 'data' && (
            <>
              {dataError && (
                <div className="p-3 rounded text-sm bg-amber-900/30 text-amber-300">
                  {t('sensorsHub.dataDegraded', 'อ่านข้อมูลเซ็นเซอร์ไม่ได้ — ตารางว่างไม่ใช่ "ไม่มีข้อมูล"')}: {dataError}
                </div>
              )}
              {/* สถิติรวม */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label={t('sensorsHub.statShowing', 'ข้อมูลที่แสดง')} value={records.length} icon={<Icon name="database" size={14} />} />
                <StatCard label={t('sensorsHub.statBattery', 'แบตเตอรี่ล่าสุด')} value={latestBattery != null ? `${latestBattery}%` : 'N/A'} icon={<Icon name="battery" size={14} />} />
                <StatCard label={t('sensorsHub.statTemp', 'อุณหภูมิ')} value={latestTemp != null ? `${latestTemp}°C` : 'N/A'} icon={<Icon name="thermometer" size={14} />} />
                <StatCard label={t('sensorsHub.statRain', 'ฝนตก')} value={latestRain === 1 ? t('sensorsHub.raining', 'ตก') : latestRain === 0 ? t('sensorsHub.notRaining', 'ไม่ตก') : 'N/A'} icon={<Icon name="droplet" size={14} />} />
              </div>

              {/* Controls */}
              <div className="flex gap-4 flex-wrap items-end">
                <div>
                    <label htmlFor="sensors-filter" className="label">{t('sensorsHub.filterBy', 'กรองตามประเภท')}</label>
                  <select id="sensors-filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="input"
                  >
                    {METRIC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(`sensorsHub.metric.${opt.value}`, opt.label)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sensors-limit" className="label">{t('sensorsHub.limitBy', 'จำนวนที่แสดง')}</label>
                  <select id="sensors-limit"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="input"
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
              <div className="card panel-cyan overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-emerald-500/50 via-cyan-500/30 to-transparent" />
                <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-950/40 backdrop-blur-sm">
                    <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                      <th className="px-4 py-3 font-semibold">{t('sensorsHub.colTime', 'เวลา')}</th>
                      <th className="px-4 py-3 font-semibold">Device</th>
                      <th className="px-4 py-3 font-semibold">Metric</th>
                      <th className="px-4 py-3 font-semibold">{t('common.value', 'ค่า')}</th>
                      <th className="px-4 py-3 font-semibold">{t('sensorsHub.colActions', 'จัดการ')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {records.map((rec, i) => (
                      <tr key={i} className="hover:bg-gray-800/50 transition-colors group">
                        <td className="px-4 py-2 text-xs text-gray-400">{new Date(rec.time).toLocaleString(fmtLocale())}</td>
                        <td className="px-4 py-2 text-xs text-gray-300">{rec.device_id}</td>
                        <td className="px-4 py-2 text-emerald-300">{t(`sensorsHub.metric.${rec.metric}`, METRIC_LABEL[rec.metric] || rec.metric)}</td>
                        <td className="px-4 py-2 font-bold text-white glow-text">{rec.value}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => deleteOne(rec)} className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1"><Icon name="trash" size={11} /> {t('common.delete', 'ลบ')}</button>
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && !loading && !dataError && (
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
              </div>
              <div className="text-xs text-gray-500">{t('sensorsHub.footerInfo', 'แสดง {n} รายการ · โหลดอัตโนมัติทุก 10 วินาที', { n: records.length })}</div>
            </>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
