"use client";
import { useState, useEffect, useCallback } from 'react';
import { useCanWriteModules } from '../lib/roles';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import { api } from '../lib/apiClient';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import VoiceCommand from '../components/dashboard/VoiceCommand';
import CompostPanel from '../components/farm/CompostPanel';
import type { FarmPlot } from '../types';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

const STATUS_LABEL: Record<string, string> = {
  active: 'ปลูกอยู่',
  growing: 'กำลังโต',
  harvested: 'เก็บเกี่ยวแล้ว',
  fallow: 'พักแปลง',
};

const CROP_KEYS: Record<string, string> = {
  ทุเรียน: 'durian',
  มะเขือเทศ: 'tomato',
  ข้าว: 'rice',
  ผักสลัด: 'lettuce',
  กล้วย: 'banana',
  อ้อย: 'sugarcane',
  มะนาว: 'lime',
  พริก: 'chili',
  'ฟ้าทะลายโจร': 'andrographis',
  'ขมิ้นชัน': 'turmeric',
  'กระเจี๊ยบแดง': 'hibiscus',
  'ขิง': 'ginger',
  'บัวบก': 'gotu-kola',
  'มะขามป้อม': 'amla',
  'ดอกคำฝอย': 'safflower',
  'กระเพรา': 'holy-basil',
  'ตะไคร้': 'lemongrass',
  'ว่านหางจระเข้': 'aloe',
};

const HERB_CROPS = ['ฟ้าทะลายโจร', 'ขมิ้นชัน', 'กระเจี๊ยบแดง', 'ขิง', 'บัวบก', 'มะขามป้อม', 'ดอกคำฝอย', 'กระเพรา', 'ตะไคร้', 'ว่านหางจระเข้'];
const STANDARD_CROPS = ['ทุเรียน', 'มะเขือเทศ', 'ข้าว', 'ผักสลัด', 'กล้วย', 'อ้อย', 'มะนาว', 'พริก'];
const ALL_CROPS = [...STANDARD_CROPS, ...HERB_CROPS];
const HERB_SET = new Set(HERB_CROPS);
const isHerbCrop = (crop?: string | null) => !!crop && HERB_SET.has(crop.trim());

// ── วิเคราะห์ดิน + NPK/ความชื้น + แผนบำรุงดิน (ต่อแปลง) ──
function SoilAnalyzer({ plot }: { plot: FarmPlot }) {
  const t = useLanguageStore((s) => s.t);
  const [form, setForm] = useState({ n: '', p: '', k: '', ph: '', moisture_pct: '', ec: '', note: '' });
  const [crop, setCrop] = useState(plot.crop || 'ทุเรียน');
  const [analysis, setAnalysis] = useState<any>(null);
  const [plan, setPlan] = useState<string[] | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const runAnalysis = async () => {
    setLoading(true); setErr('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}/analysis?crop=${encodeURIComponent(crop)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('farm.analyzer.analyzeFailed', 'วิเคราะห์ไม่สำเร็จ'));
      if (!d.analysis) { setErr(d.message || t('farm.analyzer.noSoilData', 'ยังไม่มีค่าดิน')); setAnalysis(null); setPlan(null); return; }
      setAnalysis(d.analysis);
      setPlan(d.plan || null);
      setHistory((await (await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}/soil-readings`)).json()).readings || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveReading = async () => {
    setErr(''); setMsg('');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}/soil-readings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n: num(form.n), p: num(form.p), k: num(form.k), ph: num(form.ph), moisture_pct: num(form.moisture_pct), ec: num(form.ec), note: form.note }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('farm.analyzer.saveFailed', 'บันทึกไม่สำเร็จ'));
      setMsg(t('farm.analyzer.saved', 'บันทึกค่าดินแล้ว'));
      setForm({ n: '', p: '', k: '', ph: '', moisture_pct: '', ec: '', note: '' });
      await runAnalysis();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const moisture = Number(analysis?.findings?.find((f: any) => f.kind === 'moisture')?.current ?? NaN);
  const moistureAlert = analysis?.findings?.find((f: any) => f.kind === 'moisture');

  return (
    <div className="border-t border-cyan-800/50 pt-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-lime-300">{t('farm.analyzer.title', 'วิเคราะห์ดิน')}</span>
        <select value={crop} onChange={(e) => setCrop(e.target.value)} className="input text-[11px] flex-1">
          {ALL_CROPS.map((c) => <option key={c} value={c}>{t('farm.crops.' + CROP_KEYS[c], c)}</option>)}
        </select>
        <button onClick={runAnalysis} disabled={loading} className="shrink-0 px-2 py-1 bg-lime-700/60 hover:bg-lime-700 border border-lime-600/50 rounded text-[11px] font-bold disabled:opacity-50">
          {loading ? t('farm.analyzer.analyzing', 'กำลังวิเคราะห์...') : t('farm.analyzer.analyze', 'วิเคราะห์')}
        </button>
      </div>

      {/* ค่าดินล่าสุด */}
      <div className="grid grid-cols-4 gap-1.5 text-[11px]">
        {[['n', 'N'], ['p', 'P'], ['k', 'K'], ['ph', 'pH'], ['moisture_pct', 'ชื้น%'], ['ec', 'EC']].map(([key, label]) => (
          <input key={key} value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder={t('farm.analyzer.' + key, label)} className="input text-[11px] px-1.5 py-1" />
        ))}
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t('farm.analyzer.notesPlaceholder', 'หมายเหตุ')} className="input text-[11px] px-1.5 py-1 col-span-2" />
      </div>
      <div className="flex gap-2">
        <button onClick={saveReading} className="px-2.5 py-1 bg-emerald-700/60 hover:bg-emerald-700 rounded text-[11px] font-bold inline-flex items-center gap-1"><Icon name="save" size={12} />{t('farm.analyzer.saveAndAnalyze', 'บันทึกค่า + วิเคราะห์')}</button>
        <button onClick={runAnalysis} className="btn-secondary text-[11px] inline-flex items-center gap-1"><Icon name="refresh" size={12} />{t('farm.analyzer.analyzeLatest', 'วิเคราะห์จากค่าล่าสุด')}</button>
      </div>
      {msg && <div className="text-[11px] text-emerald-400">{msg}</div>}
      {err && <div className="text-[11px] text-red-400">{err}</div>}

      {/* ผลวิเคราะห์ */}
      {analysis && (
        <div className="bg-gray-950/60 border border-lime-900 rounded-lg p-2 space-y-1.5 panel-cyan">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-lime-300 glow-text-cyan">{t('farm.analyzer.resultFor', 'ผลวิเคราะห์สำหรับ {crop}', { crop: analysis.crop })}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold glow-text ${analysis.score >= 70 ? 'bg-emerald-900/60 text-emerald-300' : analysis.score >= 40 ? 'bg-amber-900/60 text-amber-300' : 'bg-red-900/60 text-red-300'}`}>
              {t('farm.analyzer.score', 'คะแนน {score}/100', { score: analysis.score })}
            </span>
          </div>
          <div className="text-[11px] text-gray-400">{analysis.summary}</div>

          {/* แจ้งเตือนรดน้ำด่วน */}
          {moistureAlert?.severity === 'high' && moistureAlert.kind === 'moisture' && (
            <div className="flex items-center gap-2 bg-red-950/50 border border-red-700 rounded px-2 py-1.5 text-[11px] text-red-200">
              <Icon name="droplet" size={12} className="shrink-0" /> {moistureAlert.action}
            </div>
          )}

          {analysis.findings.length > 0 ? (
            <ul className="space-y-1">
              {analysis.findings.map((f: any, i: number) => (
                <li key={i} className={`text-[11px] rounded px-2 py-1 border ${f.severity === 'high' ? 'bg-red-950/30 border-red-900 text-red-200' : f.severity === 'medium' ? 'bg-amber-950/30 border-amber-900 text-amber-200' : 'bg-gray-900 border-gray-800 text-gray-300'}`}>
                  <div>{f.message}</div>
                  {f.action && <div className="text-[10px] text-gray-400 mt-0.5">→ {f.action}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1"><Icon name="check-circle" size={12} />{t('farm.analyzer.readyFor', 'ดินพร้อมสำหรับ {crop} — รักษาระดับนี้ไว้', { crop: analysis.crop })}</div>
          )}

          {plan && plan.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-amber-300 font-bold">{t('farm.analyzer.planTitle', 'แผนบำรุงดินให้เหมาะกับ {crop} (ทีละขั้น)', { crop: analysis.crop })}</summary>
              <ol className="mt-1.5 space-y-1 pl-1">
                {plan.map((s: string, i: number) => <li key={i}>• {s}</li>)}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  growing: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  harvested: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fallow: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const EMPTY_FORM = {
  name: '',
  location: '',
  crop: '',
  area_sqm: '',
  soil_notes: '',
  planted_at: '',
  expected_harvest_at: '',
  status: 'active',
  notes: '',
};

export default function FarmPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [plots, setPlots] = useState<FarmPlot[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [herbHarvest, setHerbHarvest] = useState<Record<string, { qtyGram: string; saveSeed: boolean }>>({});

  const canWrite = useCanWriteModules();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q:any={}; if(statusFilter!=='ALL') q.status=statusFilter;
      const body = await api.getObject<any>('/api/farm/plots', q);
      setPlots(body?.plots ?? []);
    } catch (e: any) {
      setError(e.message || t('farm.page.loadFailed', 'โหลดข้อมูลไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);
  useEffect(()=>{
    const h=(e:any)=>{
      const r=e.detail as any;
      if(!r) return;
      if(r.intent==='farm_plant' && r.entities?.crop){ setForm(f=>({...f, crop: r.entities.crop, name: f.name||`แปลง ${r.entities.crop}`})); setMessage(`🎙️ เติมฟอร์มจากเสียง: ปลูก ${r.entities.crop}`); }
      if(r.intent==='farm_harvest' && r.entities?.crop){ const target=plots.find(p=> (p.crop||'').toLowerCase().includes(String(r.entities.crop).toLowerCase())); if(target) window.location.hash=`plot-${target.id}`; setMessage(`🎙️ สั่งเก็บเกี่ยว: ${r.entities.crop}`); }
    };
    window.addEventListener('sovereign:voice-prefill', h as any);
    return ()=> window.removeEventListener('sovereign:voice-prefill', h as any);
  },[plots]);

  // support ?crop= linking from healing/health
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const qc = sp.get('crop');
      if (qc && ALL_CROPS.includes(qc)) {
        setForm((prev) => ({ ...prev, crop: qc }));
      }
    }
  }, []);

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('farm.unauthorized', 'Unauthorized')}</div>;
  }

  const create = async () => {
    if (!form.name.trim()) return setMessage(t('farm.page.nameRequired', 'ต้องระบุชื่อแปลง'));
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        status: form.status,
      };
      if (form.location) body.location = form.location;
      if (form.crop) body.crop = form.crop;
      if (form.area_sqm) body.area_sqm = Number(form.area_sqm);
      if (form.soil_notes) body.soil_notes = form.soil_notes;
      if (form.planted_at) body.planted_at = form.planted_at;
      if (form.expected_harvest_at) body.expected_harvest_at = form.expected_harvest_at;
      if (form.notes) body.notes = form.notes;

      await api.post('/api/farm/plots', body);
      setMessage(t('farm.page.added', 'เพิ่มแปลง "{name}" แล้ว', { name: form.name }));
      setForm(EMPTY_FORM);
      load();
    } catch (e: any) {
      setError(e.message || t('farm.page.error', 'เกิดข้อผิดพลาด'));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (plot: FarmPlot, status: string) => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('farm.page.updateFailed', 'อัปเดตไม่สำเร็จ'));
      setMessage(t('farm.page.statusChanged', '"{name}" → {status}', { name: plot.name, status: t('farm.status.' + status, STATUS_LABEL[status] ?? status) }));
      load();
    } catch (e: any) {
      setError(e.message || t('farm.page.error', 'เกิดข้อผิดพลาด'));
    }
  };

  const remove = async (plot: FarmPlot) => {
    if (!window.confirm(t('farm.page.deleteConfirm', 'ลบแปลง "{name}"?', { name: plot.name }))) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('farm.page.deleteFailed', 'ลบไม่สำเร็จ'));
      setMessage(t('farm.page.deleted', 'ลบ "{name}" แล้ว', { name: plot.name }));
      load();
    } catch (e: any) {
      setError(e.message || t('farm.page.error', 'เกิดข้อผิดพลาด'));
    }
  };

  const doHerbHarvest = async (plot: FarmPlot) => {
    const state = herbHarvest[plot.id] || { qtyGram: '', saveSeed: false };
    const qty = Number(state.qtyGram);
    if (!qty || qty <= 0) {
      setError(t('farm.herb.qtyRequired', 'ระบุปริมาณเป็นกรัม (qtyGram)'));
      return;
    }
    setError(''); setMessage('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}/herb-harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qtyGram: qty, saveSeed: state.saveSeed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('farm.herb.harvestFailed', 'เก็บเกี่ยวสมุนไพรไม่สำเร็จ'));
      setMessage(t('farm.herb.harvested', 'เก็บเกี่ยว {crop} {qty}g แล้ว{seed}', { crop: plot.crop || plot.name, qty, seed: state.saveSeed ? t('farm.herb.withSeed', ' + เก็บเมล็ด') : '' }));
      setHerbHarvest((prev) => ({ ...prev, [plot.id]: { qtyGram: '', saveSeed: false } }));
      load();
    } catch (e: any) {
      setError(e.message || t('farm.herb.harvestFailed', 'เก็บเกี่ยวสมุนไพรไม่สำเร็จ'));
    }
  };

  const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(fmtLocale()) : '—');

  const herbPlots = plots.filter((p) => isHerbCrop(p.crop));
  const herbUpcoming = herbPlots.filter((p) => typeof p.daysToHarvest === 'number' && p.daysToHarvest >= 0 && p.daysToHarvest <= 30 && p.status !== 'harvested');
  const herbHarvested = herbPlots.filter((p) => p.status === 'harvested');
  const filteredPlots = categoryFilter === 'HERB' ? plots.filter((p) => isHerbCrop(p.crop)) : plots;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full">
          <PageHeader
            eyebrow={t('farm.page.eyebrow', 'ชีวิต & การเงิน')}
            title={t('farm.page.title', 'แปลงเกษตร')}
            subtitle={t('farm.page.subtitle', 'จัดการแปลงปลูก วิเคราะห์ดิน และติดตามการเก็บเกี่ยว')}
            icon={<Icon name="farm" size={18} />}
          />
          <VoiceCommand />
          {/* ── Herb Garden Dashboard — S3+S4 ── */}
          <div className="card panel-cyan p-4 space-y-3">
            <h3 className="text-xs font-bold tracking-widest text-emerald-300 flex items-center gap-1.5"><Icon name="healing" size={13} /> {t('farm.herbGarden.title', 'สวนสมุนไพร')}</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                <div className="mono text-xl font-bold text-emerald-300">{herbPlots.length}</div>
                <div className="text-[11px] text-gray-400">{t('farm.herbGarden.totalBeds', 'แปลงสมุนไพร')}</div>
              </div>
              <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                <div className="mono text-xl font-bold text-amber-300">{herbUpcoming.length}</div>
                <div className="text-[11px] text-gray-400">{t('farm.herbGarden.upcoming', 'ใกล้เก็บเกี่ยว (30วัน)')}</div>
              </div>
              <div className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2">
                <div className="mono text-xl font-bold text-sky-300">{herbHarvested.length}</div>
                <div className="text-[11px] text-gray-400">{t('farm.herbGarden.dryingStock', 'ตากแห้ง/เก็บแล้ว')}</div>
              </div>
            </div>
            {herbUpcoming.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {herbUpcoming.slice(0, 6).map((p) => (
                  <span key={p.id} className="px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                    {p.crop || p.name} · {t('farm.herbGarden.daysLeft', '{n} วัน', { n: p.daysToHarvest ?? 0 })}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── วงจรปุ๋ยหมัก — ขยะ → กองหมัก → ปุ๋ยเข้าคลังอัตโนมัติ ── */}
          <CompostPanel />

          {/* ── Agri-Hub Dense Top — 3D + Breedhouse + Forecast (ภาพ 3) ── */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 lg:col-span-7 card panel-glow p-3 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold tracking-widest text-emerald-300 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 glow-dot" /> Agri-Hub · Few Plots</h3>
                <span className="text-[9px] font-mono tracking-widest text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">{plots.length} PLOTS</span>
              </div>
              <div className="relative h-[148px] rounded-lg bg-[#0b1220] border border-gray-800 overflow-hidden flex items-center justify-center">
                <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'linear-gradient(rgba(52,211,153,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(52,211,153,0.08) 1px, transparent 1px)', backgroundSize: '18px 18px', transform: 'perspective(300px) rotateX(38deg) translateY(-10px)' }} />
                <div className="grid grid-cols-4 gap-1.5 p-4" style={{ transform: 'perspective(280px) rotateX(32deg) rotateZ(-8deg)' }}>
                  {Array.from({ length: 8 }).map((_, i) => {
                    const p = plots[i];
                    const isActive = p != null;
                    return (
                      <div key={i} className={`w-14 h-10 rounded-sm border flex items-center justify-center text-[8px] font-mono ${isActive ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                        {p ? p.name.slice(0, 4) : '—'}
                      </div>
                    );
                  })}
                </div>
                <div className="absolute bottom-1 left-2 text-[8px] font-mono tracking-widest text-gray-500">ISOMETRIC · {plots.filter(p => p.status === 'growing').length} GROWING</div>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 card p-3 space-y-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200">Breedhouse Conditions</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { k: 'Dust', v: 23, max: 100, c: '#10b981' },
                  { k: 'Stress', v: Math.min(100, plots.filter(p => p.status === 'fallow').length * 25 + 12), max: 100, c: '#f59e0b' },
                  { k: 'Temp', v: 28.6, max: 50, c: '#22d3ee' },
                  { k: 'Hum', v: 61, max: 100, c: '#38bdf8' },
                ].map((m) => (
                  <div key={m.k} className="bg-gray-800/40 border border-gray-700/40 rounded-lg px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] tracking-widest font-mono text-gray-500">{m.k}</span>
                      <span className="mono text-[11px] font-bold" style={{ color: m.c }}>{m.v}{m.k === 'Temp' ? '°C' : m.k === 'Hum' ? '%' : '%'}</span>
                    </div>
                    <div className="h-1 bg-gray-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (m.v / m.max) * 100)}%`, background: m.c }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-950/40 border border-gray-800 rounded-lg p-2">
                <div className="text-[9px] tracking-widest font-mono text-gray-500 mb-1">Harvest Forecast</div>
                <div className="flex items-end gap-1 h-[36px]">
                  {[12, 18, 9, 22, 15].map((h, i) => (
                    <div key={i} className="flex-1 bg-emerald-500/30 border border-emerald-500/30 rounded-sm" style={{ height: `${h * 1.6}px` }} />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] font-mono tracking-widest text-gray-600 mt-1"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span></div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('farm.page.h2', 'แปลงเกษตร (Farm Plots)')}</h2>
            <div className="text-sm text-gray-400">
              {categoryFilter === 'HERB'
                ? t('farm.page.filteredTotal', 'ทั้งหมด {n} แปลง · สมุนไพร {m} แปลง', { n: plots.length, m: filteredPlots.length })
                : t('farm.page.total', 'ทั้งหมด {n} แปลง', { n: plots.length })}
            </div>
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}
          {message && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{message}</div>}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input">
              <option value="ALL">{t('farm.page.allStatus', 'ทุกสถานะ')}</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{t('farm.status.' + key, label)}</option>)}
            </select>
            <div className="flex gap-1">
              <button onClick={() => setCategoryFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${categoryFilter === 'ALL' ? 'bg-gray-800 border-gray-600 text-white' : 'bg-gray-900 border-gray-700 text-gray-400'}`}>{t('farm.filter.all', 'ทั้งหมด')}</button>
              <button onClick={() => setCategoryFilter('HERB')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1 ${categoryFilter === 'HERB' ? 'bg-emerald-900/40 border-emerald-600 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-400'}`}><Icon name="healing" size={12} /> {t('farm.filter.herb', 'สมุนไพร (HERB)')} · {herbPlots.length}</button>
            </div>
            <button onClick={load} className="btn-secondary ml-auto">
              <Icon name="refresh" size={14} /> {t('farm.page.reload', 'รีโหลด')}
            </button>
          </div>

          {/* Add form */}
          {canWrite && (
            <div className="card panel-glow p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Icon name="plus" size={14} />
                </span>
                <div>
                  <div className="text-sm font-bold text-gray-100">{t('farm.page.addTitle', 'เพิ่มแปลงใหม่')}</div>
                  <div className="text-xs text-gray-500">{t('farm.page.addSubtitle', 'ตั้งชื่อแปลง เลือกพืช และกำหนดวันปลูก/เก็บเกี่ยว')}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('farm.page.namePlaceholder', 'ชื่อแปลง *')} className="input" />
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t('farm.page.locationPlaceholder', 'ตำแหน่ง/โซน')} className="input" />
                <select value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })} className="input">
                  <option value="">{t('farm.page.cropPlaceholder', 'พืชที่ปลูก')}</option>
                  <optgroup label={t('farm.page.cropGroupStandard', 'พืชทั่วไป')}>
                    {STANDARD_CROPS.map((c) => <option key={c} value={c}>{t('farm.crops.' + CROP_KEYS[c], c)}</option>)}
                  </optgroup>
                  <optgroup label={t('farm.page.cropGroupHerb', 'สมุนไพร')}>
                    {HERB_CROPS.map((c) => <option key={c} value={c}>{t('farm.crops.' + CROP_KEYS[c], c)}</option>)}
                  </optgroup>
                </select>
                <input value={form.area_sqm} onChange={(e) => setForm({ ...form, area_sqm: e.target.value })} placeholder={t('farm.page.areaPlaceholder', 'พื้นที่ (ตร.ม.)')} type="number" min="0" className="input" />
                <input value={form.planted_at} onChange={(e) => setForm({ ...form, planted_at: e.target.value })} type="date" className="input" />
                <input value={form.expected_harvest_at} onChange={(e) => setForm({ ...form, expected_harvest_at: e.target.value })} type="date" className="input" />
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
                  {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{t('farm.status.' + key, label)}</option>)}
                </select>
                <input value={form.soil_notes} onChange={(e) => setForm({ ...form, soil_notes: e.target.value })} placeholder={t('farm.page.soilPlaceholder', 'ดิน/ปุ๋ย (pH ฯลฯ)')} className="input" />
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('farm.page.notesPlaceholder', 'หมายเหตุ')} className="input col-span-2" />
              </div>
              <button onClick={create} disabled={saving} className="btn-primary">
                {saving ? t('farm.page.saving', 'กำลังบันทึก…') : t('common.save', 'บันทึก')}
              </button>
            </div>
          )}

          {/* Plots */}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-500"><span className="w-4 h-4 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" /><span className="text-sm">{t('farm.page.loading', 'กำลังโหลด…')}</span></div>
          ) : filteredPlots.length === 0 ? (
            <div className="card"><EmptyState icon={<Icon name="farm" size={20} />} title={t('farm.page.noPlots', 'ยังไม่มีแปลง')} description={t('farm.page.noPlotsDesc', 'เริ่มสร้างแปลงแรกเพื่อติดตามการปลูกและวิเคราะห์ดิน')} /></div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPlots.map((plot) => (
                <div key={plot.id} className="card p-5 space-y-3 card-hover group relative overflow-hidden">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate group-hover:text-emerald-300 transition-colors">{plot.name}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <Icon name="map-pin" size={12} className="text-gray-500 shrink-0" />
                        <span className="truncate">{plot.location ? plot.location : t('farm.page.unknownLocation', 'ไม่ระบุตำแหน่ง')}</span>
                        {plot.area_sqm ? <span className="text-gray-500">{t('farm.page.areaSuffix', ' · {n} ตร.ม.', { n: plot.area_sqm })}</span> : null}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs border whitespace-nowrap shrink-0 ${STATUS_COLOR[plot.status] ?? STATUS_COLOR.fallow}`}>
                      {t('farm.status.' + plot.status, STATUS_LABEL[plot.status] ?? plot.status)}
                    </span>
                  </div>

                  {plot.crop && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                        <Icon name="farm" size={12} /> {plot.crop}
                      </div>
                      {isHerbCrop(plot.crop) && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-lime-900/40 border border-lime-700 text-lime-300 font-bold">
                          <Icon name="healing" size={10} /> {t('farm.badge.herb', 'สมุนไพร')}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div className="flex items-center gap-1"><Icon name="calendar" size={11} className="text-gray-600" />{t('farm.page.planted', 'ปลูก:')} <span className="text-gray-200">{formatDate(plot.planted_at)}</span></div>
                    <div className="flex items-center gap-1"><Icon name="calendar" size={11} className="text-amber-500/60" />{t('farm.page.harvest', 'เก็บเกี่ยว:')} <span className="text-gray-200">{formatDate(plot.expected_harvest_at)}</span></div>
                  </div>

                  {typeof plot.daysToHarvest === 'number' && (
                    <div className="text-xs">
                      {plot.daysToHarvest > 0 ? (
                        <span className="text-amber-300">{t('farm.page.daysToHarvest', 'เหลืออีก {n} วันถึงเก็บเกี่ยว', { n: plot.daysToHarvest })}</span>
                      ) : (
                        <span className="text-emerald-300 inline-flex items-center gap-1"><Icon name="check-circle" size={12} />{t('farm.page.ready', 'พร้อมเก็บเกี่ยวแล้ว!')}</span>
                      )}
                    </div>
                  )}

                  {plot.soil_notes && <div className="text-xs text-gray-500">{plot.soil_notes}</div>}
                  {plot.notes && <div className="text-xs text-gray-500 italic">{plot.notes}</div>}

                  {/* ── วิเคราะห์ดิน + NPK/ความชื้น ── */}
                  <SoilAnalyzer plot={plot} />

                  {isHerbCrop(plot.crop) && canWrite && (
                    <div className="flex flex-wrap gap-1.5 items-center bg-lime-950/20 border border-lime-900/40 rounded-lg p-2">
                      <input
                        value={herbHarvest[plot.id]?.qtyGram ?? ''}
                        onChange={(e) => setHerbHarvest((prev) => ({ ...prev, [plot.id]: { qtyGram: e.target.value, saveSeed: prev[plot.id]?.saveSeed ?? false } }))}
                        placeholder={t('farm.herb.qtyPlaceholder', 'กรัม')}
                        type="number"
                        min="1"
                        className="input text-[11px] w-20 px-1.5 py-1"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-gray-300">
                        <input
                          type="checkbox"
                          checked={herbHarvest[plot.id]?.saveSeed ?? false}
                          onChange={(e) => setHerbHarvest((prev) => ({ ...prev, [plot.id]: { qtyGram: prev[plot.id]?.qtyGram ?? '', saveSeed: e.target.checked } }))}
                          className="accent-emerald-500"
                        />
                        {t('farm.herb.saveSeed', 'เก็บเมล็ด')}
                      </label>
                      <button onClick={() => doHerbHarvest(plot)} className="text-xs bg-lime-700/60 hover:bg-lime-700 border border-lime-600/50 text-lime-100 rounded px-3 py-1 font-bold inline-flex items-center gap-1">
                        <Icon name="healing" size={11} /> {t('farm.herb.harvestBtn', 'เก็บเกี่ยวสมุนไพร')}
                      </button>
                    </div>
                  )}

                  {canWrite && (
                    <div className="flex gap-2 pt-1 border-t border-gray-800">
                      {(plot.status !== 'harvested') && (
                        <button onClick={() => updateStatus(plot, 'harvested')} className="text-xs bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-600/40 rounded px-3 py-1">
                          {t('farm.page.harvestBtn', 'เก็บเกี่ยว')}
                        </button>
                      )}
                      {plot.status !== 'fallow' && (
                        <button onClick={() => updateStatus(plot, 'fallow')} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded px-3 py-1">
                          {t('farm.page.fallowBtn', 'พักแปลง')}
                        </button>
                      )}
                      {plot.status !== 'growing' && plot.status !== 'active' && (
                        <button onClick={() => updateStatus(plot, 'growing')} className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40 rounded px-3 py-1">
                          {t('farm.page.growBtn', 'ปลูกต่อ')}
                        </button>
                      )}
                      <button onClick={() => remove(plot)} className="ml-auto text-red-400 hover:text-red-300 text-xs"><Icon name="trash" size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}