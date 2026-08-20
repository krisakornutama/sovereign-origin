"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';

interface Zone {
  id: string; name: string; type: string;
  x: number; y: number; z: number;
  width_m: number; length_m: number; height_m: number;
  color?: string | null; note?: string | null;
}
interface Point {
  id: string; name: string; type: string;
  zone_id?: string | null;
  x: number; y: number; z: number;
  radius_m: number; reason?: string | null;
  enabled: boolean; last_triggered_at?: string | null;
}
interface ScoredPoint { point: Point; score: number; reasons: string[] }
interface Suggestion { name: string; type: string; x: number; y: number; z: number; reason: string }

const ZONE_TYPES = ['บ้าน', 'สวน', 'รั้ว', 'ประตู', 'ที่จอดรถ', 'โรงเก็บ', 'ที่โล่ง', 'ทางเข้า', 'อื่น'];
const POINT_TYPES = ['กล้อง', 'เซ็นเซอร์ตรวจจับ', 'กับดัก', 'ไฟ'];

export default function PropertyPage() {
  const { isAuthenticated, user, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [zones, setZones] = useState<Zone[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [scored, setScored] = useState<ScoredPoint[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [land, setLand] = useState<{ width: number; length: number }>({ width: 30, length: 20 });
  const [mapSvg, setMapSvg] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [zoneForm, setZoneForm] = useState({ name: '', type: 'บ้าน', x: '5', y: '5', width_m: '6', length_m: '4', height_m: '2.5' });
  const [pointForm, setPointForm] = useState({ name: '', type: 'กล้อง', x: '1', y: '1', z: '2', radius_m: '6', reason: '' });
  const mapRef = useRef<HTMLImageElement>(null);

  // ── ลากจุดยุทธศาสตร์ด้วยเมาส์ (2D board) ──
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  const pointAtPointer = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return {
      x: Math.round(px * land.width * 10) / 10,
      y: Math.round(py * land.length * 10) / 10,
    };
  };

  const startDrag = (pt: Point) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragPreview({ id: pt.id, x: pt.x, y: pt.y });
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragPreview) return;
    const pos = pointAtPointer(e);
    if (pos) setDragPreview({ id: dragPreview.id, x: pos.x, y: pos.y });
  };

  const endDrag = async () => {
    if (!dragPreview) return;
    const { id, x, y } = dragPreview;
    setDragPreview(null);
    setMessage(''); setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('property.errMovePoint', 'ย้ายจุดไม่สำเร็จ'));
      setMessage(t('property.movedPoint', 'ย้ายจุดไปที่ x={x}, y={y} แล้ว', { x, y }));
      await load();
    } catch (e: any) {
      setError(e.message);
      await load();
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [zr, pr, sr, mr] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/zones`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/strategy`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/map.svg`),
      ]);
      const z = await zr.json();
      const p = await pr.json();
      const s = await sr.json();
      setZones(z.zones ?? []);
      setPoints(p.points ?? []);
      setScored(s.scored ?? []);
      setSuggestions(s.suggestions ?? []);
      if (z.land) setLand(z.land);
      if (mr.ok) setMapSvg(await mr.text());
    } catch {
      setError(t('property.errLoadMap', 'โหลดแผนที่ไม่สำเร็จ — ตรวจว่า Core API เปิดอยู่'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user) load();
  }, [isAuthenticated, user, load]);

  const reloadMap = async () => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/map.svg`);
    if (r.ok) setMapSvg(await r.text());
  };

  const addZone = async () => {
    setError(''); setMessage('');
    if (!zoneForm.name.trim()) return setError(t('property.errZoneName', 'ระบุชื่อโซน'));
    setBusy(true);
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/zones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: zoneForm.name, type: zoneForm.type,
          x: Number(zoneForm.x) || 0, y: Number(zoneForm.y) || 0,
          width_m: Number(zoneForm.width_m) || 2, length_m: Number(zoneForm.length_m) || 2,
          height_m: Number(zoneForm.height_m) || 2,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('property.errAddZone', 'เพิ่มโซนไม่สำเร็จ'));
      setMessage(t('property.zoneAdded', 'เพิ่มโซน "{name}" แล้ว', { name: zoneForm.name }));
      setZoneForm({ ...zoneForm, name: '', x: '5', y: '5' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteZone = async (id: string, name: string) => {
    if (!window.confirm(t('property.confirmDeleteZone', 'ลบโซน "{name}"?', { name }))) return;
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/zones/${id}`, { method: 'DELETE' });
    if (r.ok) { setMessage(t('property.zoneDeleted', 'ลบโซนแล้ว')); load(); }
  };

  const addPoint = async (p?: Suggestion) => {
    setError(''); setMessage('');
    const name = p?.name || pointForm.name;
    const x = (p?.x != null ? p.x : Number(pointForm.x) || 0);
    const y = (p?.y != null ? p.y : Number(pointForm.y) || 0);
    const z = (p?.z != null ? p.z : Number(pointForm.z) || 0);
    const type = p?.type || pointForm.type;
    const reason = p?.reason || pointForm.reason;
    if (!name.trim()) return setError(t('property.errPointName', 'ระบุชื่อจุด'));
    setBusy(true);
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, x, y, z, radius_m: Number(pointForm.radius_m) || 4, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('property.errAddPoint', 'เพิ่มจุดไม่สำเร็จ'));
      setMessage(t('property.pointAdded', 'เพิ่ม "{name}" ({type}) ที่ x={x} y={y}', { name, type, x, y }));
      setPointForm({ ...pointForm, name: '', reason: '' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePoint = async (pt: Point) => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points/${pt.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !pt.enabled }),
    });
    if (r.ok) load();
  };

  const deletePoint = async (id: string, name: string) => {
    if (!window.confirm(t('property.confirmDeletePoint', 'ลบจุด "{name}"?', { name }))) return;
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points/${id}`, { method: 'DELETE' });
    if (r.ok) { setMessage(t('property.pointDeleted', 'ลบจุดแล้ว')); load(); }
  };

  const triggerPoint = async (pt: Point) => {
    const subject = window.prompt(t('property.triggerPrompt', 'อะไรผ่านจุดนี้? (เช่น "คนแปลกหน้า", "สุนัข")'), t('property.triggerDefault', 'บุคคล'));
    if (subject === null) return;
    setMessage(''); setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/property/points/${pt.id}/trigger`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject || 'บุคคล/สัตว์' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('property.errTrigger', 'trigger ไม่สำเร็จ'));
      setMessage(d.message);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('property.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold glow-text">{t('property.title', 'แผนที่บ้าน & จุดยุทธศาสตร์')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('property.subtitle', 'จำลองที่ดิน {w}×{l} ม. (3 มิติ) + วิเคราะห์จุดวางกับดัก/กล้อง/เซ็นเซอร์ตรวจจับคน-สัตว์', { w: land.width, l: land.length })}
          </p>
        </div>
        <Link href="/dashboard" scroll={false} className="text-sm text-gray-400 hover:text-gray-200">{t('property.backDashboard', '← กลับ Dashboard')}</Link>
      </div>

      {message && <div className="mb-3 bg-emerald-900/40 border border-emerald-700 rounded-lg px-4 py-2 text-sm text-emerald-300">{message}</div>}
      {error && <div className="mb-3 bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-300">{error}</div>}

      {/* ── แผนที่ 3 มิติ ── */}
      <div className="card panel-glow p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('property.mapTitle', 'แผนที่จำลอง (2D + ไอโซเมตริก 3D)')}</h2>
          <button onClick={reloadMap} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs inline-flex items-center gap-1"><Icon name="refresh" size={12} /> {t('property.refreshMap', 'รีเฟรชแผนที่')}</button>
        </div>
        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">{t('property.mapping', 'กำลังสร้างแผนที่...')}</div>
        ) : mapSvg ? (
          <div className="overflow-auto rounded-lg bg-gray-950 border border-cyan-800/50 max-h-[70vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(mapSvg)))}`} alt={t('property.mapAlt', 'แผนที่ที่ดิน')} className="max-w-none" />
          </div>
        ) : (
          <div className="text-gray-500 text-sm">{t('property.noZonesMap', 'ยังไม่มีโซน — เพิ่มโซนแรกด้านล่างเพื่อสร้างแผนที่')}</div>
        )}

        {/* ── ลากจุดยุทธศาสตร์ด้วยเมาส์ ── */}
        <div className="mt-4">
          <h3 className="font-bold mb-1">{t('property.dragTitle', 'ลากจุดยุทธศาสตร์ (คลิกค้างแล้วลาก — บันทึกอัตโนมัติเมื่อปล่อย)')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('property.boardHint', 'มุมมอง 2 มิติ: พื้นที่ {w}×{l} ม. · สีจัตุรัส = โซน · จุด = กล้อง/เซ็นเซอร์/กับดัก/ไฟ', { w: land.width, l: land.length })}</p>
          <div
            ref={boardRef}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            className="relative rounded-lg bg-gray-950 border border-gray-700 overflow-hidden select-none"
            style={{ aspectRatio: `${land.width} / ${land.length}` }}
          >
            {/* gridlines ทุก 5 ม. */}
            {Array.from({ length: Math.floor(land.width / 5) + 1 }).map((_, i) => (
              <div key={`v${i}`} className="absolute top-0 bottom-0 border-l border-gray-800/60" style={{ left: `${(i * 5 / land.width) * 100}%` }} />
            ))}
            {Array.from({ length: Math.floor(land.length / 5) + 1 }).map((_, i) => (
              <div key={`h${i}`} className="absolute left-0 right-0 border-t border-gray-800/60" style={{ top: `${(i * 5 / land.length) * 100}%` }} />
            ))}
            {/* โซน */}
            {zones.map((z) => (
              <div
                key={z.id}
                className="absolute rounded border bg-gray-800/40 border-gray-700/60 flex items-center justify-center text-[9px] text-gray-400 overflow-hidden"
                style={{
                  left: `${(z.x / land.width) * 100}%`,
                  top: `${(z.y / land.length) * 100}%`,
                  width: `${(z.width_m / land.width) * 100}%`,
                  height: `${(z.length_m / land.length) * 100}%`,
                }}
              >
                {z.name}
              </div>
            ))}
            {/* จุดที่ลากได้ */}
            {points.map((p) => {
              const preview = dragPreview?.id === p.id ? dragPreview : null;
              const px = (preview?.x ?? p.x) / land.width * 100;
              const py = (preview?.y ?? p.y) / land.length * 100;
              const color = p.type === 'กับดัก' ? 'bg-red-500 border-red-300' : p.type === 'กล้อง' ? 'bg-blue-500 border-blue-300' : p.type === 'ไฟ' ? 'bg-yellow-500 border-yellow-300' : 'bg-cyan-400 border-cyan-200';
              return (
                <div
                  key={p.id}
                  onPointerDown={startDrag(p)}
                  title={t('property.dragTitleAttr', '{name} ({x},{y}) — ลากเพื่อย้าย', { name: p.name, x: p.x, y: p.y })}
                  className={`absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 ${color} shadow-lg cursor-grab active:cursor-grabbing ${preview ? 'ring-2 ring-white/70 scale-110' : ''} ${p.enabled ? '' : 'opacity-40'}`}
                  style={{ left: `${px}%`, top: `${py}%`, touchAction: 'none' }}
                />
              );
            })}
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">{t('property.noPointsBoard', 'ยังไม่มีจุด — เพิ่มจุดด้านล่างแล้วลากมาวางได้เลย')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── โซน ── */}
        <div className="card panel-cyan p-4">
          <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('property.zonesTitle', 'โซนในที่ดิน ({n})', { n: zones.length })}</h3>
          <div className="space-y-2">
            {zones.length === 0 && <div className="text-gray-500 text-xs">{t('property.noZones', 'ยังไม่มีโซน — เช่น บ้าน, สวนทุเรียน, ประตูหน้า, โรงเก็บ')}</div>}
            {zones.map((z) => (
              <div key={z.id} className="flex items-center justify-between inset px-3 py-2 text-sm">
                <div>
                  <span className="font-bold">{z.name}</span>{' '}
                  <span className="text-gray-500 text-xs">{z.type} · {z.width_m}×{z.length_m}×{z.height_m} ม. @({z.x},{z.y})</span>
                </div>
                <button onClick={() => deleteZone(z.id, z.name)} className="text-red-400 hover:text-red-300 text-xs"><Icon name="trash" size={12} /></button>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            <input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder={t('property.zoneNamePlaceholder', 'ชื่อโซน เช่น สวนทุเรียน')} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <select value={zoneForm.type} onChange={(e) => setZoneForm({ ...zoneForm, type: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-2 py-2">
                {ZONE_TYPES.map((zt) => <option key={zt} value={zt}>{t(`property.zoneType.${zt}`, zt)}</option>)}
              </select>
              <input value={zoneForm.x} onChange={(e) => setZoneForm({ ...zoneForm, x: e.target.value })} placeholder={t('property.xM', 'X (ม.)')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={zoneForm.y} onChange={(e) => setZoneForm({ ...zoneForm, y: e.target.value })} placeholder={t('property.yM', 'Y (ม.)')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={zoneForm.width_m} onChange={(e) => setZoneForm({ ...zoneForm, width_m: e.target.value })} placeholder={t('property.width', 'กว้าง')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={zoneForm.length_m} onChange={(e) => setZoneForm({ ...zoneForm, length_m: e.target.value })} placeholder={t('property.length', 'ยาว')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={zoneForm.height_m} onChange={(e) => setZoneForm({ ...zoneForm, height_m: e.target.value })} placeholder={t('property.height', 'สูง')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
            </div>
            <button onClick={addZone} disabled={busy} className="btn-primary w-full">{t('property.addZone', 'เพิ่มโซน')}</button>
          </div>
        </div>

        {/* ── จุดยุทธศาสตร์ ── */}
        <div className="card panel-cyan p-4">
          <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('property.pointsTitle', 'จุดยุทธศาสตร์ ({n})', { n: points.length })}</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {points.length === 0 && <div className="text-gray-500 text-xs">{t('property.noPoints', 'ยังไม่มีจุด — ใช้คำแนะนำด้านล่างหรือเพิ่มเอง')}</div>}
            {points.map((p) => {
              const s = scored.find((x) => x.point.id === p.id);
              return (
                <div key={p.id} className={`inset px-3 py-2 text-xs ${p.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm inline-flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${p.type === 'กับดัก' ? 'bg-red-500' : p.type === 'กล้อง' ? 'bg-blue-500' : p.type === 'ไฟ' ? 'bg-yellow-500' : 'bg-cyan-400'}`} />
                      {p.name}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => togglePoint(p)} className="text-gray-400 hover:text-gray-200">{p.enabled ? <Icon name="eye" size={12} className="text-emerald-400" /> : <Icon name="eye-off" size={12} />}</button>
                      <button onClick={() => deletePoint(p.id, p.name)} className="text-red-400 hover:text-red-300"><Icon name="trash" size={12} /></button>
                    </div>
                  </div>
                  <div className="text-gray-400 mt-1">{t('property.pointPos', '@{x},{y},{z} · รัศมี {r} ม.', { x: p.x, y: p.y, z: p.z, r: p.radius_m })}</div>
                  {p.reason && <div className="text-gray-500 mt-0.5">{p.reason}</div>}
                  {s && (
                    <div className="mt-1">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${s.score >= 70 ? 'bg-red-900/60 text-red-300' : s.score >= 40 ? 'bg-amber-900/60 text-amber-300' : 'bg-gray-800 text-gray-300'}`}>{t('property.score', 'คะแนน {score}/100', { score: s.score })}</span>
                      <span className="text-gray-500 ml-1">{s.reasons.join(' · ')}</span>
                    </div>
                  )}
                  <button onClick={() => triggerPoint(p)} className="mt-1.5 w-full py-1 bg-rose-900/50 hover:bg-rose-800/60 border border-rose-800 rounded text-[11px] font-bold inline-flex items-center justify-center gap-1"><Icon name="alerts" size={11} /> {t('property.testDetect', 'ทดสอบตรวจจับ')}</button>
                </div>
              );
            })}
          </div>
          <div className="mt-4 space-y-2">
            <input value={pointForm.name} onChange={(e) => setPointForm({ ...pointForm, name: e.target.value })} placeholder={t('property.pointNamePlaceholder', 'ชื่อจุด เช่น กล้องมุมรั้ว')} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            <div className="grid grid-cols-4 gap-2 text-xs">
              <select value={pointForm.type} onChange={(e) => setPointForm({ ...pointForm, type: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-1 py-2">
                {POINT_TYPES.map((pt) => <option key={pt} value={pt}>{t(`property.pointType.${pt}`, pt)}</option>)}
              </select>
              <input value={pointForm.x} onChange={(e) => setPointForm({ ...pointForm, x: e.target.value })} placeholder={t('property.x', 'X')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={pointForm.y} onChange={(e) => setPointForm({ ...pointForm, y: e.target.value })} placeholder={t('property.y', 'Y')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
              <input value={pointForm.radius_m} onChange={(e) => setPointForm({ ...pointForm, radius_m: e.target.value })} placeholder={t('property.radius', 'รัศมี')} className="bg-gray-800 border border-gray-700 rounded px-2 py-2" />
            </div>
            <input value={pointForm.reason} onChange={(e) => setPointForm({ ...pointForm, reason: e.target.value })} placeholder={t('property.reasonPlaceholder', 'เหตุผลที่วาง (เช่น คนต้องผ่านทางนี้)')} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            <button onClick={() => addPoint()} disabled={busy} className="btn-primary w-full">{t('property.addPoint', 'เพิ่มจุด')}</button>
          </div>
        </div>

        {/* ── คำแนะนำอัตโนมัติ ── */}
        <div className="card panel-glow p-4">
          <h3 className="text-sm font-semibold text-gray-200 glow-text mb-3">{t('property.analyzeTitle', 'วิเคราะห์จุดยุทธศาสตร์')}</h3>
          <p className="text-xs text-gray-500 mb-3">
            {t('property.analyzeDesc', 'ระบบวิเคราะห์จากตำแหน่งโซน: จุดที่คน/สัตว์ต้องผ่าน (ขอบรั้ว, ประตู, ระหว่างบ้าน↔สวน) ได้คะแนนสูงสุด')}
          </p>
          <div className="text-xs font-bold text-amber-300 mb-2 flex items-center gap-1"><Icon name="map-pin" size={12} /> {t('property.suggestedTitle', 'ตำแหน่งแนะนำให้วางจุดตรวจจับ ({n})', { n: suggestions.length })}</div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <div key={i} className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-xs">
                <div className="font-bold inline-flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${s.type === 'กับดัก' ? 'bg-red-500' : s.type === 'กล้อง' ? 'bg-blue-500' : s.type === 'ไฟ' ? 'bg-yellow-500' : 'bg-cyan-400'}`} />
                  {s.name} @({s.x},{s.y})
                </div>
                <div className="text-gray-500 mt-0.5">{s.reason}</div>
                <button onClick={() => addPoint(s)} className="mt-1.5 w-full py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px] font-bold">{t('property.addThisPoint', 'เพิ่มจุดนี้')}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
