"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface Camera { id: string; name: string; rtsp_url: string | null; location: string | null; enabled: boolean; last_event_at: string | null; }
interface Detection { id: string; camera: { name: string; location: string | null } | null; object_type: string; confidence: number | null; triggered_action: string | null; detected_at: string; }
interface WaterReading { id: string; tank_name: string; tds: number | null; ph: number | null; turbidity: number | null; source: string; measured_at: string; }
interface RadioMessage { id: string; direction: string; channel: string; text: string; remote_id: string | null; is_emergency: boolean; received_at: string; }
interface EquipmentItem { id: string; name: string; type: string; run_hours: number; service_interval_hours: number | null; last_service_at: string | null; notes: string | null; maintenance_due: boolean; hours_until_service: number | null; }

const OBJECT_LABELS: Record<string, string> = { person: 'คน', vehicle: 'ยานพาหนะ', animal: 'สัตว์', venomous: 'สัตว์อันตราย', other: 'อื่น ๆ' };
const CHANNEL_LABELS: Record<string, string> = { sdr: '📻 SDR', meshtastic: '📡 Meshtastic', lora: '📶 LoRa', fm: '🔊 FM' };

export default function InfrastructurePage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
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
    load().catch(() => setError('โหลดข้อมูลไม่สำเร็จ')).finally(() => setLoading(false));
  }, [isAuthenticated, user]);

  const addCamera = async () => {
    if (!camName.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/cameras`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: camName.trim(), location: camLoc.trim() || null }),
    });
    setCamName(''); setCamLoc(''); setFlash('✅ เพิ่มกล้องแล้ว'); await load();
  };

  const addEquipment = async () => {
    if (!eqName.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/equipment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: eqName.trim(), type: eqType, service_interval_hours: Number(eqInterval) || null }),
    });
    setEqName(''); setFlash('✅ เพิ่มอุปกรณ์แล้ว'); await load();
  };

  const logRunHours = async (id: string, hours: number) => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/equipment/${id}/run-hours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours }),
    });
    setFlash(`✅ บันทึก ${hours} ชม. แล้ว`); await load();
  };

  const addWater = async () => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/water`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tank_name: waterTank, tds: waterTds ? Number(waterTds) : null, ph: waterPh ? Number(waterPh) : null }),
    });
    setWaterTds(''); setWaterPh(''); setFlash('✅ บันทึกค่าน้ำแล้ว'); await load();
  };

  const sendRadio = async () => {
    if (!radioText.trim()) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/radio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'out', channel: 'meshtastic', text: radioText.trim() }),
    });
    setRadioText(''); setFlash('✅ ส่งข้อความผ่าน mesh แล้ว'); await load();
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  const pendingAlerts =
    detections.filter((d) => d.object_type === 'venomous').length +
    equipment.filter((e) => e.maintenance_due).length +
    radio.filter((r) => r.is_emergency).length;

  const tabs = [
    ['overview', '🏠 ภาพรวม'], ['security', '🎥 ความปลอดภัย'], ['water', '💧 น้ำ & อาหาร'],
    ['radio', '📡 วิทยุฉุกเฉิน'], ['equipment', '🔧 อุปกรณ์'],
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="🏭 Off-Grid Infrastructure Hub" actions={<div className="flex items-center gap-3">
          {pendingAlerts > 0 && <span className="text-xs bg-red-900/40 text-red-300 border border-red-700 rounded-lg px-3 py-1">⚠️ {pendingAlerts} รายการต้องดูแล</span>}
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>
        </div>}
        />
      </header>

      <div className="max-w-6xl mx-auto px-6 pt-4 flex gap-2 flex-wrap">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm ${tab === key ? 'bg-sky-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{label}</button>
        ))}
      </div>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}
        {flash && <div className="text-sm text-sky-300 bg-sky-900/20 border border-sky-700 rounded-lg px-4 py-3">{flash}</div>}

        {loading ? (
          <div className="text-gray-500">⏳ กำลังโหลด…</div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <div className="text-3xl mb-2">🎥</div>
                  <div className="text-2xl font-bold">{cameras.length}</div>
                  <div className="text-xs text-gray-500">กล้อง (CV / Perimeter)</div>
                  <div className="text-[11px] text-gray-600 mt-2">{detections.length} เหตุการณ์ล่าสุด</div>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <div className="text-3xl mb-2">💧</div>
                  <div className="text-2xl font-bold">{water.latest.length}</div>
                  <div className="text-xs text-gray-500">ถังน้ำที่ตรวจวัด</div>
                  {water.latest[0] && <div className="text-[11px] text-gray-600 mt-2">TDS ล่าสุด: {water.latest[0].tds ?? '—'} ppm</div>}
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <div className="text-3xl mb-2">📡</div>
                  <div className="text-2xl font-bold">{radio.filter((r) => r.is_emergency).length}</div>
                  <div className="text-xs text-gray-500">ข้อความฉุกเฉิน (radio/mesh)</div>
                  <div className="text-[11px] text-gray-600 mt-2">{radio.length} ข้อความทั้งหมด</div>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <div className="text-3xl mb-2">🔧</div>
                  <div className="text-2xl font-bold">{equipment.filter((e) => e.maintenance_due).length}</div>
                  <div className="text-xs text-gray-500">อุปกรณ์ถึงกำหนดบำรุง</div>
                  <div className="text-[11px] text-gray-600 mt-2">{equipment.length} รายการทั้งหมด</div>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">➕ เพิ่มกล้อง (Local AI: Frigate / YOLO)</h2>
                  <div className="flex gap-2 flex-wrap">
                    <input value={camName} onChange={(e) => setCamName(e.target.value)} placeholder="ชื่อกล้อง เช่น หน้าบ้าน" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
                    <input value={camLoc} onChange={(e) => setCamLoc(e.target.value)} placeholder="ตำแหน่ง (เช่น ประตูหน้า)" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
                    <button onClick={addCamera} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">เพิ่ม</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                    <h2 className="font-bold text-gray-200 mb-3">🎥 กล้องทั้งหมด</h2>
                    <div className="space-y-2">
                      {cameras.map((c) => (
                        <div key={c.id} className="flex justify-between items-center bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                          <div>
                            <div className="text-sm font-bold">{c.name} {!c.enabled && <span className="text-xs text-gray-500">(ปิด)</span>}</div>
                            <div className="text-xs text-gray-500">{c.location || '—'}{c.last_event_at && <> · เหตุการณ์ล่าสุด {new Date(c.last_event_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}</div>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded ${c.enabled ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-400'}`}>{c.enabled ? 'ออนไลน์' : 'ปิด'}</span>
                        </div>
                      ))}
                      {cameras.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีกล้อง — เพิ่มกล้องแรกด้านบน</div>}
                    </div>
                  </div>
                  <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                    <h2 className="font-bold text-gray-200 mb-3">🚨 เหตุการณ์ตรวจจับล่าสุด</h2>
                    <div className="space-y-2">
                      {detections.map((d) => (
                        <div key={d.id} className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2.5">
                          <div className="flex justify-between text-sm">
                            <span className={d.object_type === 'venomous' ? 'text-red-400 font-bold' : 'text-gray-200'}>
                              {d.object_type === 'venomous' ? '⚠️ ' : ''}{OBJECT_LABELS[d.object_type] || d.object_type}
                              {d.confidence != null && <span className="text-xs text-gray-500"> ({Math.round(d.confidence * 100)}%)</span>}
                            </span>
                            <span className="text-xs text-gray-500">{new Date(d.detected_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{d.camera?.name || '—'}{d.triggered_action && <span className="text-amber-400"> · สั่ง {d.triggered_action}</span>}</div>
                        </div>
                      ))}
                      {detections.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีเหตุการณ์ — API รอ Frigate/YOLO ส่งผลตรวจจับ</div>}
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'water' && (
              <>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">💧 บันทึกค่าน้ำ (TDS / pH)</h2>
                  <div className="flex gap-2 flex-wrap">
                    <select value={waterTank} onChange={(e) => setWaterTank(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                      <option>ถังฝน</option><option>ถังกรอง</option><option>บ่อน้ำบาดาล</option>
                    </select>
                    <input value={waterTds} onChange={(e) => setWaterTds(e.target.value)} placeholder="TDS (ppm)" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm w-28" />
                    <input value={waterPh} onChange={(e) => setWaterPh(e.target.value)} placeholder="pH" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm w-24" />
                    <button onClick={addWater} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">บันทึก</button>
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">📊 ค่าน้ำล่าสุดรายถัง</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {water.latest.map((r) => (
                      <div key={r.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
                        <div className="text-sm font-bold">{r.tank_name}</div>
                        <div className="text-xs text-gray-500 mt-1">{new Date(r.measured_at).toLocaleString('th-TH')}</div>
                        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.tds ?? '—'}</div><div className="text-[10px] text-gray-500">TDS ppm</div></div>
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.ph ?? '—'}</div><div className="text-[10px] text-gray-500">pH</div></div>
                          <div className="bg-gray-900 rounded p-2"><div className="text-sm font-bold">{r.turbidity ?? '—'}</div><div className="text-[10px] text-gray-500">NTU</div></div>
                        </div>
                      </div>
                    ))}
                    {water.latest.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีข้อมูล — บันทึกค่าน้ำแรก</div>}
                  </div>
                </div>
              </>
            )}

            {tab === 'radio' && (
              <>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">📡 ส่งข้อความผ่าน Meshtastic / LoRa (ไร้เน็ต)</h2>
                  <div className="flex gap-2">
                    <input value={radioText} onChange={(e) => setRadioText(e.target.value)} placeholder="ข้อความภาษาไทย ระยะ 5-10 กม. ถึงเพื่อนบ้านในเครือข่าย" className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                    <button onClick={sendRadio} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">ส่ง</button>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">เปิดใช้งานจริงเมื่อเชื่อมต่อ Meshtastic Gateway — API รับ-ส่งข้อความนี้แล้ว</div>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">📻 ข้อความล่าสุด (SDR / Mesh / FM)</h2>
                  <div className="space-y-2">
                    {radio.map((r) => (
                      <div key={r.id} className={`rounded-lg px-4 py-2.5 border ${r.is_emergency ? 'bg-red-900/20 border-red-700' : 'bg-gray-800/60 border-gray-700'}`}>
                        <div className="flex justify-between text-sm">
                          <span className={r.direction === 'out' ? 'text-sky-400' : 'text-gray-200'}>
                            {r.direction === 'out' ? '📤 ส่ง' : '📥 รับ'}{' '}{CHANNEL_LABELS[r.channel] || r.channel}
                            {r.is_emergency && <span className="text-red-400 font-bold ml-2">🚨 ฉุกเฉิน</span>}
                          </span>
                          <span className="text-xs text-gray-500">{new Date(r.received_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-sm mt-1">{r.text}</div>
                      </div>
                    ))}
                    {radio.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีข้อความ — SDR listener จะดักฟังคลื่นฉุกเฉินเมื่อเชื่อมต่อฮาร์ดแวร์</div>}
                  </div>
                </div>
              </>
            )}

            {tab === 'equipment' && (
              <>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">🔧 เพิ่มอุปกรณ์ (นับ Run Hours)</h2>
                  <div className="flex gap-2 flex-wrap">
                    <input value={eqName} onChange={(e) => setEqName(e.target.value)} placeholder="ชื่อ เช่น เครื่องปั่นไฟเบนซิน" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]" />
                    <select value={eqType} onChange={(e) => setEqType(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                      <option value="generator">เครื่องปั่นไฟ</option><option value="pump">ปั๊มน้ำ</option>
                      <option value="winch">เครื่องกว้าน</option><option value="solar">แผงโซลาร์</option><option value="other">อื่น ๆ</option>
                    </select>
                    <input value={eqInterval} onChange={(e) => setEqInterval(e.target.value)} placeholder="ช่วงถ่ายน้ำมันเครื่อง (ชม.)" className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm w-44" />
                    <button onClick={addEquipment} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">เพิ่ม</button>
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                  <h2 className="font-bold text-gray-200 mb-3">⏱️ สถานะบำรุงรักษา</h2>
                  <div className="space-y-2">
                    {equipment.map((e) => {
                      const pct = e.service_interval_hours ? Math.min(100, (e.run_hours / e.service_interval_hours) * 100) : 0;
                      return (
                        <div key={e.id} className={`bg-gray-800/60 border rounded-lg px-4 py-3 ${e.maintenance_due ? 'border-red-700' : 'border-gray-700'}`}>
                          <div className="flex justify-between items-center flex-wrap gap-2">
                            <div>
                              <div className="text-sm font-bold">{e.name} <span className="text-xs text-gray-500 font-normal">({e.type})</span></div>
                              <div className="text-xs text-gray-500 mt-0.5">{e.run_hours.toFixed(1)} ชม. / เกณฑ์ {e.service_interval_hours ?? '—'} ชม.</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-28 bg-gray-700 h-2 rounded-full overflow-hidden">
                                <div className={`h-2 rounded-full ${e.maintenance_due ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                              {e.maintenance_due
                                ? <span className="text-xs text-red-400 font-bold">⚠️ ถึงกำหนด</span>
                                : <span className="text-xs text-gray-500">เหลือ {e.hours_until_service?.toFixed(0)} ชม.</span>}
                              <button onClick={() => logRunHours(e.id, 1)} className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg">+1 ชม.</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {equipment.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีอุปกรณ์ — เพิ่มเครื่องแรก (แนะนำ: ตั้งเกณฑ์ตามคู่มือถ่ายน้ำมันเครื่อง)</div>}
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
