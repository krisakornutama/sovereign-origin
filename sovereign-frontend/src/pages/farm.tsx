"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
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
};

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
        <select value={crop} onChange={(e) => setCrop(e.target.value)} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] flex-1">
          {['ทุเรียน', 'มะเขือเทศ', 'ข้าว', 'ผักสลัด', 'กล้วย', 'อ้อย', 'มะนาว', 'พริก'].map((c) => <option key={c} value={c}>{t('farm.crops.' + CROP_KEYS[c], c)}</option>)}
        </select>
        <button onClick={runAnalysis} disabled={loading} className="shrink-0 px-2 py-1 bg-lime-700/60 hover:bg-lime-700 border border-lime-600/50 rounded text-[11px] font-bold disabled:opacity-50">
          {loading ? t('farm.analyzer.analyzing', 'กำลังวิเคราะห์...') : t('farm.analyzer.analyze', 'วิเคราะห์')}
        </button>
      </div>

      {/* ค่าดินล่าสุด */}
      <div className="grid grid-cols-4 gap-1.5 text-[11px]">
        {[['n', 'N'], ['p', 'P'], ['k', 'K'], ['ph', 'pH'], ['moisture_pct', 'ชื้น%'], ['ec', 'EC']].map(([key, label]) => (
          <input key={key} value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder={t('farm.analyzer.' + key, label)} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px]" />
        ))}
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t('farm.analyzer.notesPlaceholder', 'หมายเหตุ')} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px] col-span-2" />
      </div>
      <div className="flex gap-2">
        <button onClick={saveReading} className="px-2.5 py-1 bg-emerald-700/60 hover:bg-emerald-700 rounded text-[11px] font-bold inline-flex items-center gap-1"><Icon name="save" size={12} />{t('farm.analyzer.saveAndAnalyze', 'บันทึกค่า + วิเคราะห์')}</button>
        <button onClick={runAnalysis} className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[11px] inline-flex items-center gap-1"><Icon name="refresh" size={12} />{t('farm.analyzer.analyzeLatest', 'วิเคราะห์จากค่าล่าสุด')}</button>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const canWrite = user?.role === 'SUPERADMIN' || user?.role === 'NODE_ADMIN' || user?.role === 'OPERATOR';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setPlots(body.plots ?? []);
    } catch (e: any) {
      setError(e.message || t('farm.page.loadFailed', 'โหลดข้อมูลไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

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

      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('farm.page.saveFailed', 'บันทึกไม่สำเร็จ'));
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

  const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(fmtLocale()) : '—');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
          <PageHeader
            eyebrow={t('farm.page.eyebrow', 'ชีวิต & การเงิน')}
            title={t('farm.page.title', 'SOVEREIGN OS')}
            icon={<Icon name="farm" size={18} />}
            subtitle={t('farm.page.subtitle', 'Farm Plots')} actions={<div className="flex gap-3 items-center">
              <a href="/dashboard" className="text-sm text-sky-400 hover:underline">{t('farm.page.dashboardLink', 'Dashboard')}</a>
            </div>}
          />
        </header>

        <main className="max-w-7xl mx-auto p-6 space-y-4 w-full">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('farm.page.h2', 'แปลงเกษตร (Farm Plots)')}</h2>
            <div className="text-sm text-gray-400">
              {t('farm.page.total', 'ทั้งหมด {n} แปลง', { n: plots.length })}
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
            <button onClick={load} className="btn-secondary ml-auto">
              <Icon name="refresh" size={14} /> {t('farm.page.reload', 'รีโหลด')}
            </button>
          </div>

          {/* Add form */}
          {canWrite && (
            <div className="card panel-glow p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="plus" size={14} className="text-gray-400" />{t('farm.page.addTitle', 'เพิ่มแปลงใหม่')}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('farm.page.namePlaceholder', 'ชื่อแปลง *')} className="input" />
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t('farm.page.locationPlaceholder', 'ตำแหน่ง/โซน')} className="input" />
                <input value={form.crop} onChange={(e) => setForm({ ...form, crop: e.target.value })} placeholder={t('farm.page.cropPlaceholder', 'พืชที่ปลูก')} className="input" />
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
            <div className="text-gray-500 text-center py-12">{t('farm.page.loading', 'กำลังโหลด…')}</div>
          ) : plots.length === 0 ? (
            <div className="text-gray-500 text-center py-12 border border-dashed border-gray-700 rounded-xl">{t('farm.page.noPlots', 'ยังไม่มีแปลง')}</div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plots.map((plot) => (
                <div key={plot.id} className="card p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-white">{plot.name}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <Icon name="map-pin" size={12} className="text-gray-500 shrink-0" />
                        {plot.location ? plot.location : t('farm.page.unknownLocation', 'ไม่ระบุตำแหน่ง')}
                        {plot.area_sqm ? t('farm.page.areaSuffix', ' · {n} ตร.ม.', { n: plot.area_sqm }) : ''}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${STATUS_COLOR[plot.status] ?? STATUS_COLOR.fallow}`}>
                      {t('farm.status.' + plot.status, STATUS_LABEL[plot.status] ?? plot.status)}
                    </span>
                  </div>

                  {plot.crop && (
                    <div className="text-sm text-emerald-300">{plot.crop}</div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                    <div>{t('farm.page.planted', 'ปลูก:')} <span className="text-gray-200">{formatDate(plot.planted_at)}</span></div>
                    <div>{t('farm.page.harvest', 'เก็บเกี่ยว:')} <span className="text-gray-200">{formatDate(plot.expected_harvest_at)}</span></div>
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