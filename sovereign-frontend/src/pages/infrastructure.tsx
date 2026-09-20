"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface Camera { id: string; name: string; rtsp_url: string | null; location: string | null; enabled: boolean; last_event_at: string | null; }
interface Detection { id: string; camera: { name: string; location: string | null } | null; object_type: string; confidence: number | null; triggered_action: string | null; detected_at: string; }
interface WaterReading { id: string; tank_name: string; tds: number | null; ph: number | null; turbidity: number | null; source: string; measured_at: string; }
interface RadioMessage { id: string; direction: string; channel: string; text: string; remote_id: string | null; is_emergency: boolean; received_at: string; }
interface EquipmentItem { id: string; name: string; type: string; run_hours: number; service_interval_hours: number | null; last_service_at: string | null; notes: string | null; maintenance_due: boolean; hours_until_service: number | null; }

const OBJECT_LABELS: Record<string, string> = { person: 'คน', vehicle: 'ยานพาหนะ', animal: 'สัตว์', venomous: 'สัตว์อันตราย', other: 'อื่น ๆ' };
const CHANNEL_LABELS: Record<string, string> = { sdr: 'SDR', meshtastic: 'Meshtastic', lora: 'LoRa', fm: 'FM' };

export default function InfrastructurePage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [water, setWater] = useState<{ latest: WaterReading[] }>({ latest: [] });
  const [radio, setRadio] = useState<RadioMessage[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [flash, setFlash] = useState('');

  // form state
  const [camName, setCamName] = useState('');
  const [camLoc, setCamLoc] = useState('');
  const [eqName, setEqName] = useState('');
  const [eqType, setEqType] = useState('generator');
  const [eqInterval, setEqInterval] = useState('100');
  const [waterTank, setWaterTank] = useState('ถังฝน');
  const [waterTds, setWaterTds] = useState('');
  const [waterPh, setWaterPh] = useState('');
  const [radioText, setRadioText] = useState('');

  const load = async () => {
    const [c, d, w, r, e] = await Promise.all([
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/cameras`).then((x) => x.json()),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/detections?limit=10`).then((x) => x.json()),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/water`).then((x) => x.json()),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/radio?limit=10`).then((x) => x.json()),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/equipment`).then((x) => x.json()),
    ]);
    setCameras(c); setDetections(d); setWater(w); setRadio(r); setEquipment(e);
  };

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load().catch(() => setError(t('infrastructure.errLoad', 'โหลดข้อมูลไม่สำเร็จ'))).finally(() => setLoading(false));
  }, [isAuthenticated, user]);

  const addCamera = async () => {
    if (!camName.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/cameras`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: camName.trim(), location: camLoc.trim() || null }),
    });
    setCamName(''); setCamLoc(''); setFlash(t('infrastructure.flashAddCamera', '✅ เพิ่มกล้องแล้ว')); await load();
  };

  const addEquipment = async () => {
    if (!eqName.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/equipment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: eqName.trim(), type: eqType, service_interval_hours: Number(eqInterval) || null }),
    });
    setEqName(''); setFlash(t('infrastructure.flashAddEquipment', '✅ เพิ่มอุปกรณ์แล้ว')); await load();
  };

  const logRunHours = async (id: string, hours: number) => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/equipment/${id}/run-hours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours }),
    });
    setFlash(t('infrastructure.flashRunHours', '✅ บันทึก {hours} ชม. แล้ว', { hours })); await load();
  };

  const addWater = async () => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/water`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tank_name: waterTank, tds: waterTds ? Number(waterTds) : null, ph: waterPh ? Number(waterPh) : null }),
    });
    setWaterTds(''); setWaterPh(''); setFlash(t('infrastructure.flashAddWater', '✅ บันทึกค่าน้ำแล้ว')); await load();
  };

  const sendRadio = async () => {
    if (!radioText.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/radio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'out', channel: 'meshtastic', text: radioText.trim() }),
    });
    setRadioText(''); setFlash(t('infrastructure.flashRadioSent', '✅ ส่งข้อความผ่าน mesh แล้ว')); await load();
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('infrastructure.unauthorized', 'Unauthorized')}</div>;

  const pendingAlerts =
    detections.filter((d) => d.object_type === 'venomous').length +
    equipment.filter((e) => e.maintenance_due).length +
    radio.filter((r) => r.is_emergency).length;

  const tabs = [
    ['overview', t('common.nav.group.overview', 'ภาพรวม')], ['security', t('common.nav.group.security', 'ความปลอดภัย')], ['water', t('infrastructure.tabWater', 'น้ำ & อาหาร')],
    ['radio', t('infrastructure.tabRadio', 'วิทยุฉุกเฉิน')], ['equipment', t('infrastructure.tabEquipment', 'อุปกรณ์')],
  ];

  return (
    <div className="atmo-power min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('infrastructure.eyebrow', 'ความปลอดภัย')}
          title={t('infrastructure.title', 'Off-Grid Infrastructure Hub')} theme="power" icon={<Icon name="infrastructure" size={18} />} actions={<div className="flex items-center gap-3">
          {pendingAlerts > 0 && <span className="text-xs bg-red-900/40 text-red-300 border border-red-700 rounded-lg px-3 py-1 flex items-center gap-1"><Icon name="alert-triangle" size={12} /> {t('infrastructure.pendingAlerts', '{n} รายการต้องดูแล', { n: pendingAlerts })}</span>}
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('infrastructure.backDashboard', '← กลับ Dashboard')}</Link>
        </div>}
        />

      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
        {/* ── Dense Top — Infrastructure Map + System Health + User Registry (ภาพ 3) ── */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 lg:col-span-7 card panel-cyan p-3 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-cyan-300 flex items-center gap-1.5"><Icon name="infrastructure" size={12} /> Infrastructure Map</h3>
              <span className="text-[9px] font-mono tracking-widest text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">{cameras.length} CAMS · {equipment.length} EQUIP</span>
            </div>
            <div className="relative h-[132px] rounded-lg bg-[#0b1220] border border-gray-800 overflow-hidden">
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(300px 120px at 20% 30%, rgba(34,211,238,0.25), transparent 60%), radial-gradient(280px 120px at 70% 60%, rgba(52,211,153,0.18), transparent 60%)' }} />
              <svg viewBox="0 0 320 120" className="absolute inset-0 w-full h-full">
                {[
                  { x: 40, y: 30 }, { x: 110, y: 22 }, { x: 190, y: 34 }, { x: 260, y: 28 },
                  { x: 66, y: 78 }, { x: 140, y: 72 }, { x: 210, y: 82 },
                ].map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="7" fill={i < 4 ? 'rgba(34,211,238,0.9)' : 'rgba(52,211,153,0.85)'} stroke="rgba(255,255,255,0.9)" strokeWidth="0.8" />
                    <circle cx={p.x} cy={p.y} r="12" fill="none" stroke={i < 4 ? 'rgba(34,211,238,0.25)' : 'rgba(52,211,153,0.2)'} strokeWidth="0.7" />
                  </g>
                ))}
                <path d="M 40 30 L 110 22 L 190 34 L 260 28 M 40 30 L 66 78 L 140 72 L 210 82 M 110 22 L 140 72 M 190 34 L 210 82" stroke="rgba(100,150,200,0.35)" strokeWidth="0.8" fill="none" strokeDasharray="3 3" />
              </svg>
              <div className="absolute bottom-1 left-2 text-[8px] font-mono tracking-widest text-gray-500">MESH · {radio.length} MSGS · LAT -90→90</div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5 grid grid-cols-2 gap-3">
            <div className="card p-3 flex flex-col items-center justify-center">
              <div className="text-[9px] tracking-widest font-mono text-gray-500 mb-1">System Health</div>
              <div className="w-16 h-16 rounded-full border-4 border-emerald-500/30 flex items-center justify-center relative">
                <div className="absolute inset-1 rounded-full border-2 border-emerald-400" style={{ clipPath: 'inset(0 0 30% 0)' }} />
                <span className="mono text-lg font-bold text-emerald-400">90%</span>
              </div>
              <div className="text-[9px] font-mono tracking-widest text-gray-500 mt-1">VALID · 121 NODES</div>
            </div>
            <div className="card p-3">
              <div className="text-[9px] tracking-widest font-mono text-gray-500 mb-2">User Registry</div>
              <div className="flex -space-x-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-7 h-7 rounded-full bg-gray-700 border-2 border-gray-900 flex items-center justify-center text-[10px]">◯</div>
                ))}
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center text-[9px] font-bold text-emerald-300">+3</div>
              </div>
              <div className="text-[9px] font-mono tracking-widest text-gray-500 mt-2">{cameras.length} REGISTRY · {equipment.filter(e=>e.maintenance_due).length} DUE</div>
              <div className="h-1 bg-gray-800 rounded-full overflow-hidden mt-2"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (cameras.length + equipment.length) * 8)}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-ghost'}>{label}</button>
          ))}
        </div>
        {error && <div className="text-sm text-red-400 inset px-4 py-3">{error}</div>}
        {flash && <div className="text-sm text-sky-300 inset px-4 py-3">{flash}</div>}

        {loading ? (
          <div className="text-gray-500">{t('infrastructure.loading', 'กำลังโหลด…')}</div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card panel-glow p-5">
                  <div className="text-gray-400 mb-2"><Icon name="camera" size={28} /></div>
                  <div className="text-2xl font-bold glow-text">{cameras.length}</div>
                  <div className="text-xs text-gray-500">{t('infrastructure.camerasCard', 'กล้อง (CV / Perimeter)')}</div>
                  <div className="text-[11px] text-gray-600 mt-2">{t('infrastructure.recentEvents', '{n} เหตุการณ์ล่าสุด', { n: detections.length })}</div>
                </div>
                <div className="card panel-glow p-5">
                  <div className="text-gray-400 mb-2"><Icon name="droplet" size={28} /></div>
                  <div className="text-2xl font-bold glow-text">{water.latest.length}</div>
                  <div className="text-xs text-gray-500">{t('infrastructure.waterTanksCard', 'ถังน้ำที่ตรวจวัด')}</div>
                  {water.latest[0] && <div className="text-[11px] text-gray-600 mt-2">{t('infrastructure.latestTds', 'TDS ล่าสุด: {value} ppm', { value: water.latest[0].tds ?? '—' })}</div>}
                </div>
                <div className="card panel-glow p-5">
                  <div className="text-gray-400 mb-2"><Icon name="wifi" size={28} /></div>
                  <div className="text-2xl font-bold glow-text">{radio.filter((r) => r.is_emergency).length}</div>
                  <div className="text-xs text-gray-500">{t('infrastructure.emergencyMsgs', 'ข้อความฉุกเฉิน (radio/mesh)')}</div>
                  <div className="text-[11px] text-gray-600 mt-2">{t('infrastructure.totalMsgs', '{n} ข้อความทั้งหมด', { n: radio.length })}</div>
                </div>
                <div className="card panel-glow p-5">
                  <div className="text-gray-400 mb-2"><Icon name="settings" size={28} /></div>
                  <div className="text-2xl font-bold glow-text">{equipment.filter((e) => e.maintenance_due).length}</div>
                  <div className="text-xs text-gray-500">{t('infrastructure.dueMaintenance', 'อุปกรณ์ถึงกำหนดบำรุง')}</div>
                  <div className="text-[11px] text-gray-600 mt-2">{t('infrastructure.totalItems', '{n} รายการทั้งหมด', { n: equipment.length })}</div>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <>
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3">{t('infrastructure.addCameraTitle', 'เพิ่มกล้อง (Local AI: Frigate / YOLO)')}</h2>
                  <div className="flex gap-2 flex-wrap">
                    <input value={camName} onChange={(e) => setCamName(e.target.value)} placeholder={t('infrastructure.camNamePlaceholder', 'ชื่อกล้อง เช่น หน้าบ้าน')} className="input flex-1 min-w-[160px]" />
                    <input value={camLoc} onChange={(e) => setCamLoc(e.target.value)} placeholder={t('infrastructure.camLocPlaceholder', 'ตำแหน่ง (เช่น ประตูหน้า)')} className="input flex-1 min-w-[160px]" />
                    <button onClick={addCamera} className="btn-primary">{t('common.add', 'เพิ่ม')}</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card panel-cyan p-5">
                    <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('infrastructure.allCameras', 'กล้องทั้งหมด')}</h2>
                    <div className="space-y-2">
                      {cameras.map((c) => (
                        <div key={c.id} className="flex justify-between items-center inset px-4 py-3">
                          <div>
                            <div className="text-sm font-bold">{c.name} {!c.enabled && <span className="text-xs text-gray-500">{t('infrastructure.off', '(ปิด)')}</span>}</div>
                            <div className="text-xs text-gray-500">{c.location || '—'}{c.last_event_at && <> {t('infrastructure.lastEvent', ' · เหตุการณ์ล่าสุด {time}', { time: new Date(c.last_event_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</>}</div>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded ${c.enabled ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>{c.enabled ? t('common.online', 'ออนไลน์') : t('common.off', 'ปิด')}</span>
                        </div>
                      ))}
                      {cameras.length === 0 && <div className="text-gray-500 text-sm">{t('infrastructure.noCameras', 'ยังไม่มีกล้อง — เพิ่มกล้องแรกด้านบน')}</div>}
                    </div>
                  </div>
                  <div className="card panel-cyan p-5">
                    <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('infrastructure.recentDetections', 'เหตุการณ์ตรวจจับล่าสุด')}</h2>
                    <div className="space-y-2 log-stream">
                      {detections.map((d) => (
                        <div key={d.id} className="inset px-4 py-2.5">
                          <div className="flex justify-between text-sm">
                            <span className={d.object_type === 'venomous' ? 'text-red-400 font-bold' : 'text-gray-200'}>
                              {d.object_type === 'venomous' ? <Icon name="alert-triangle" size={12} /> : null}{t(`infrastructure.obj.${d.object_type}`, OBJECT_LABELS[d.object_type] || d.object_type)}
                              {d.confidence != null && <span className="text-xs text-gray-500"> ({Math.round(d.confidence * 100)}%)</span>}
                            </span>
                            <span className="text-xs text-gray-500">{new Date(d.detected_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{d.camera?.name || '—'}{d.triggered_action && <span className="text-amber-400">{t('infrastructure.triggered', ' · สั่ง {action}', { action: d.triggered_action })}</span>}</div>
                        </div>
                      ))}
                      {detections.length === 0 && <div className="text-gray-500 text-sm">{t('infrastructure.noDetections', 'ยังไม่มีเหตุการณ์ — API รอ Frigate/YOLO ส่งผลตรวจจับ')}</div>}
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'water' && (
              <>
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3">{t('infrastructure.addWaterTitle', 'บันทึกค่าน้ำ (TDS / pH)')}</h2>
                  <div className="flex gap-2 flex-wrap">
                    <select value={waterTank} onChange={(e) => setWaterTank(e.target.value)} className="input">
                      <option value="ถังฝน">{t('infrastructure.tankRain', 'ถังฝน')}</option><option value="ถังกรอง">{t('infrastructure.tankFilter', 'ถังกรอง')}</option><option value="บ่อน้ำบาดาล">{t('infrastructure.tankWell', 'บ่อน้ำบาดาล')}</option>
                    </select>
                    <input value={waterTds} onChange={(e) => setWaterTds(e.target.value)} placeholder={t('infrastructure.tdsPlaceholder', 'TDS (ppm)')} className="input w-28" />
                    <input value={waterPh} onChange={(e) => setWaterPh(e.target.value)} placeholder={t('infrastructure.phPlaceholder', 'pH')} className="input w-24" />
                    <button onClick={addWater} className="btn-primary">{t('common.save', 'บันทึก')}</button>
                  </div>
                </div>
                <div className="card panel-cyan p-5">
                  <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('infrastructure.latestWater', 'ค่าน้ำล่าสุดรายถัง')}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {water.latest.map((r) => (
                      <div key={r.id} className="inset p-4">
                        <div className="text-sm font-bold">{r.tank_name}</div>
                        <div className="text-xs text-gray-500 mt-1">{new Date(r.measured_at).toLocaleString(fmtLocale())}</div>
                        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.tds ?? '—'}</div><div className="text-[10px] text-gray-500">TDS ppm</div></div>
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.ph ?? '—'}</div><div className="text-[10px] text-gray-500">pH</div></div>
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.turbidity ?? '—'}</div><div className="text-[10px] text-gray-500">NTU</div></div>
                        </div>
                      </div>
                    ))}
                    {water.latest.length === 0 && <div className="text-gray-500 text-sm">{t('infrastructure.noWater', 'ยังไม่มีข้อมูล — บันทึกค่าน้ำแรก')}</div>}
                  </div>
                </div>
              </>
            )}

            {tab === 'radio' && (
              <>
                <div className="card p-5">
<h2 className="text-sm font-semibold text-gray-200 mb-3">{t('infrastructure.radioSendTitle', 'ส่งข้อความผ่าน Meshtastic / LoRa (ไร้เน็ต)')}</h2>
                  <div className="flex gap-2">
                    <input value={radioText} onChange={(e) => setRadioText(e.target.value)} placeholder={t('infrastructure.radioPlaceholder', 'ข้อความภาษาไทย ระยะ 5-10 กม. ถึงเพื่อนบ้านในเครือข่าย')} className="input flex-1" />
                    <button onClick={sendRadio} className="btn-primary">{t('common.send', 'ส่ง')}</button>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">{t('infrastructure.radioHint', 'เปิดใช้งานจริงเมื่อเชื่อมต่อ Meshtastic Gateway — API รับ-ส่งข้อความนี้แล้ว')}</div>
                </div>
                <div className="card panel-cyan p-5">
                  <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('infrastructure.latestRadio', 'ข้อความล่าสุด (SDR / Mesh / FM)')}</h2>
                  <div className="space-y-2 log-stream">
                    {radio.map((r) => (
                      <div key={r.id} className={`rounded-lg px-4 py-2.5 border ${r.is_emergency ? 'bg-red-900/20 border-red-700' : 'bg-gray-800/60 border-gray-700'}`}>
                        <div className="flex justify-between text-sm">
                          <span className={r.direction === 'out' ? 'text-sky-400' : 'text-gray-200'}>
                            {r.direction === 'out' ? t('infrastructure.directionOut', 'ส่ง') : t('infrastructure.directionIn', 'รับ')}{' '}{CHANNEL_LABELS[r.channel] || r.channel}
                            {r.is_emergency && <span className="text-red-400 font-bold ml-2 flex items-center gap-1"><Icon name="alert-triangle" size={12} /> {t('infrastructure.emergency', 'ฉุกเฉิน')}</span>}
                          </span>
                          <span className="text-xs text-gray-500">{new Date(r.received_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-sm mt-1">{r.text}</div>
                      </div>
                    ))}
                    {radio.length === 0 && <div className="text-gray-500 text-sm">{t('infrastructure.noRadio', 'ยังไม่มีข้อความ — SDR listener จะดักฟังคลื่นฉุกเฉินเมื่อเชื่อมต่อฮาร์ดแวร์')}</div>}
                  </div>
                </div>
              </>
            )}

            {tab === 'equipment' && (
              <>
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3">{t('infrastructure.addEquipmentTitle', 'เพิ่มอุปกรณ์ (นับ Run Hours)')}</h2>
                  <div className="flex gap-2 flex-wrap">
                    <input value={eqName} onChange={(e) => setEqName(e.target.value)} placeholder={t('infrastructure.eqNamePlaceholder', 'ชื่อ เช่น เครื่องปั่นไฟเบนซิน')} className="input flex-1 min-w-[180px]" />
                    <select value={eqType} onChange={(e) => setEqType(e.target.value)} className="input">
                      <option value="generator">{t('infrastructure.eqGenerator', 'เครื่องปั่นไฟ')}</option><option value="pump">{t('infrastructure.eqPump', 'ปั๊มน้ำ')}</option>
                      <option value="winch">{t('infrastructure.eqWinch', 'เครื่องกว้าน')}</option><option value="solar">{t('infrastructure.eqSolar', 'แผงโซลาร์')}</option><option value="other">{t('infrastructure.eqOther', 'อื่น ๆ')}</option>
                    </select>
                    <input value={eqInterval} onChange={(e) => setEqInterval(e.target.value)} placeholder={t('infrastructure.eqIntervalPlaceholder', 'ช่วงถ่ายน้ำมันเครื่อง (ชม.)')} className="input w-44" />
                    <button onClick={addEquipment} className="btn-primary">{t('common.add', 'เพิ่ม')}</button>
                  </div>
                </div>
                <div className="card panel-cyan p-5">
                  <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('infrastructure.maintenanceStatus', 'สถานะบำรุงรักษา')}</h2>
                  <div className="space-y-2">
                    {equipment.map((e) => {
                      const pct = e.service_interval_hours ? Math.min(100, (e.run_hours / e.service_interval_hours) * 100) : 0;
                      return (
                        <div key={e.id} className={`inset px-4 py-3 ${e.maintenance_due ? 'border-red-700' : ''}`}>
                          <div className="flex justify-between items-center flex-wrap gap-2">
                            <div>
                              <div className="text-sm font-bold">{e.name} <span className="text-xs text-gray-500 font-normal">({e.type})</span></div>
                              <div className="text-xs text-gray-500 mt-0.5">{t('infrastructure.runHours', '{run} ชม. / เกณฑ์ {interval} ชม.', { run: e.run_hours.toFixed(1), interval: e.service_interval_hours ?? '—' })}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-28 bg-gray-700 h-2 rounded-full overflow-hidden">
                                <div className={`h-2 rounded-full ${e.maintenance_due ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                              {e.maintenance_due
                                ? <span className="text-xs text-red-400 font-bold flex items-center gap-1"><Icon name="alert-triangle" size={12} /> {t('infrastructure.due', 'ถึงกำหนด')}</span>
                                : <span className="text-xs text-gray-500">{t('infrastructure.hoursLeft', 'เหลือ {n} ชม.', { n: e.hours_until_service?.toFixed(0) })}</span>}
                              <button onClick={() => logRunHours(e.id, 1)} className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg">{t('infrastructure.plus1Hour', '+1 ชม.')}</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {equipment.length === 0 && <div className="text-gray-500 text-sm">{t('infrastructure.noEquipment', 'ยังไม่มีอุปกรณ์ — เพิ่มเครื่องแรก (แนะนำ: ตั้งเกณฑ์ตามคู่มือถ่ายน้ำมันเครื่อง)')}</div>}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
      </div>
  );
}
