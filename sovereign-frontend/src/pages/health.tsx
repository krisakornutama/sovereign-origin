"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import Sparkline from '../components/ui/Sparkline';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface CategoryCount {
  category: string;
  count: number;
  threshold: number;
  triggered: boolean;
  herb: string;
  herbId: string;
  blocked: boolean;
  reasons: string[];
  pendingFlag: boolean;
}

interface Observation {
  id: string;
  category: string;
  detail: string | null;
  source: string;
  severity: number;
  observed_at: string;
}

interface HealthFlag {
  id: string;
  flag_type: string;
  category: string;
  status: string;
  note: string | null;
  created_at: string;
  cleared_at: string | null;
}

interface Consent {
  id: string;
  category: string;
  granted: boolean;
}

interface Profile {
  conditions: string[];
  medications: string[];
}

interface Reading {
  id: string;
  type: string;
  value: number;
  systolic: number | null;
  diastolic: number | null;
  note: string | null;
  measured_at: string;
}

interface ReadingAnalysis {
  type: string;
  count: number;
  latest: { value: number; systolic: number | null; diastolic: number | null; measured_at: string; note: string | null } | null;
  trend: 'up' | 'down' | 'flat';
  slopePerDay: number | null;
  changePct: number | null;
  anomalies: Array<{ time: string; value: number; z: number; severity: 'warning' | 'critical' }>;
  reference: { level: 'ok' | 'warning' | 'critical' | 'low'; label: string; note: string } | null;
}

const VITAL_META: Record<string, { icon: string; label: string; unit: string }> = {
  WEIGHT: { icon: 'gauge', label: 'น้ำหนัก', unit: 'kg' },
  BP: { icon: 'heart-pulse', label: 'ความดัน', unit: 'mmHg' },
  SUGAR: { icon: 'droplet', label: 'น้ำตาล', unit: 'mg/dL' },
  TEMP: { icon: 'thermometer', label: 'อุณหภูมิ', unit: '°C' },
};

const TREND_ICON: Record<string, string> = { up: 'trending-up', down: 'trending-down', flat: 'arrow-right' };
const TREND_LABEL: Record<string, string> = { up: 'เพิ่มขึ้น', down: 'ลดลง', flat: 'คงที่' };

const REF_STYLE: Record<string, string> = {
  ok: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  warning: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  critical: 'text-red-300 border-red-500/40 bg-red-500/10',
  low: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
};

const CATEGORY_LABELS: Record<string, string> = {
  URINATION: 'ปัสสาวะผิดปกติ', SLEEP: 'การนอนหลับ', APPETITE: 'ความอยากอาหาร',
  FATIGUE: 'ความอ่อนเพลีย', FEVER: 'ไข้', DIGESTION: 'ระบบย่อยอาหาร',
  MOOD: 'อารมณ์/ความเครียด', OTHER: 'อื่น ๆ',
};
const CATEGORY_ICONS: Record<string, string> = {
  URINATION: 'droplet', SLEEP: 'clock', FATIGUE: 'battery',
  FEVER: 'thermometer', MOOD: 'healing', OTHER: 'map-pin',
};
const CONDITION_LABELS: Record<string, string> = {
  kidney_disease: 'โรคไต', gallbladder: 'โรคท่อน้ำดี/ถุงน้ำดี',
  anticoagulant: 'ยาละลายลิ่มเลือด', pregnancy: 'ตั้งครรภ์',
  hypotension: 'ความดันต่ำ', diabetes: 'เบาหวาน', hypertension: 'ความดันสูง',
};
const FLAG_TYPE_LABELS: Record<string, string> = {
  CHECK_URINATION: 'ปัสสาวะบ่อย/ผิดปกติ', CHECK_SLEEP: 'นอนไม่หลับ',
  CHECK_APPETITE: 'เบื่ออาหาร', CHECK_FATIGUE: 'อ่อนเพลียผิดปกติ',
  CHECK_FEVER: 'ไข้ซ้ำ', CHECK_DIGESTION: 'ระบบย่อยอาหารผิดปกติ',
  CHECK_MOOD: 'อารมณ์แปรปรวน', CHECK_OTHER: 'ข้อสงสัยอื่น ๆ',
};

export default function HealthPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [counts, setCounts] = useState<CategoryCount[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [flags, setFlags] = useState<HealthFlag[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [profile, setProfile] = useState<Profile>({ conditions: [], medications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('SLEEP');
  const [detail, setDetail] = useState('');
  const [severity, setSeverity] = useState(2);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState('');

  const [readings, setReadings] = useState<Reading[]>([]);
  const [vitalAnalysis, setVitalAnalysis] = useState<Record<string, ReadingAnalysis>>({});
  const [rType, setRType] = useState('WEIGHT');
  const [rValue, setRValue] = useState('');
  const [rSys, setRSys] = useState('');
  const [rDia, setRDia] = useState('');
  const [rNote, setRNote] = useState('');
  const [rSaving, setRSaving] = useState(false);
  const [rError, setRError] = useState('');

  const loadReadings = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/readings?limit=40`);
      if (!res.ok) return;
      const data = await res.json();
      setReadings(data.rows ?? []);
      setVitalAnalysis(data.analysis ?? {});
    } catch { /* ไม่บังคับ */ }
  };

  const addReading = async () => {
    const isBp = rType === 'BP';
    const value = isBp ? rSys : rValue;
    if (value === '' || (isBp && (rSys === '' || rDia === ''))) {
      setRError(t('health.vital.enterValue', 'กรุณากรอกค่าก่อนบันทึก'));
      return;
    }
    setRSaving(true);
    setRError('');
    try {
      const body: Record<string, unknown> = {
        type: rType,
        value: Number(value),
        systolic: isBp ? Number(rSys) : undefined,
        diastolic: isBp ? Number(rDia) : undefined,
        note: rNote.trim() || null,
      };
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('health.vital.saveFailed', 'บันทึกไม่สำเร็จ'));
      setFlash(t('health.vital.saved', 'บันทึกค่า {label} แล้ว', { label: t('health.vital.' + rType, VITAL_META[rType]?.label ?? rType) }));
      setRValue(''); setRSys(''); setRDia(''); setRNote('');
      await Promise.all([loadReadings(), load()]);
    } catch (e: any) {
      setRError(e.message || t('health.error', 'เกิดข้อผิดพลาด'));
    } finally {
      setRSaving(false);
    }
  };

  const deleteReading = async (id: string) => {
    if (!window.confirm(t('health.vital.deleteConfirm', 'ลบค่านี้?'))) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/readings/${id}`, { method: 'DELETE' });
    await loadReadings();
  };

  const load = async () => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/overview`);
    const data = await res.json();
    setCounts(data.counts || []);
    setObservations(data.observations || []);
    setFlags(data.flags || []);
    setConsents(data.consents || []);
    setProfile(data.profile || { conditions: [], medications: [] });
  };

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load().catch(() => setError(t('health.loadingFail', 'โหลดข้อมูลสุขภาพไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'))).finally(() => setLoading(false));
    loadReadings();
  }, [isAuthenticated, user]);

  const addObservation = async () => {
    setAdding(true);
    setFlash('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, detail: detail.trim() || null, severity }),
      });
      const data = await res.json();
      if (data.flag) setFlash(t('health.observation.flagCreated', 'พบอาการซ้ำ ≥ 3 ครั้งใน 14 วัน — สร้าง flag: {flag}', { flag: t('health.flagType.' + data.flag.flag_type, FLAG_TYPE_LABELS[data.flag.flag_type] || data.flag.flag_type) }));
      else setFlash(t('health.observation.saved', 'บันทึก {category} แล้ว', { category: t('health.category.' + category, CATEGORY_LABELS[category]) }));
      setDetail('');
      await load();
    } catch (err) {
      console.error(err);
      setError(t('health.observation.saveFailed', 'บันทึกไม่สำเร็จ'));
    } finally {
      setAdding(false);
    }
  };

  const clearFlag = async (id: string) => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/flags/${id}/clear`, { method: 'POST' });
    await load();
  };

  const toggleConsent = async (cat: string, granted: boolean) => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/consents`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [cat]: !granted }),
    });
    await load();
  };

  const toggleProfileCode = async (kind: 'conditions' | 'medications', code: string) => {
    const list = profile[kind];
    const next = list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, [kind]: next }),
    });
    await load();
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('health.unauthorized', 'Unauthorized')}</div>;

  const consentMap = Object.fromEntries(consents.map((c) => [c.category, c.granted]));
  const pendingFlags = flags.filter((f) => f.status === 'PENDING');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('health.page.eyebrow', 'ชีวิต & การเงิน')}
          title={t('health.page.title', 'Health Screening (Ambient)')} icon={<Icon name="health" size={18} />} actions={<div className="flex items-center gap-3">
          <Link href="/health-export" scroll={false} className="btn-secondary"><Icon name="reports" size={13} /> {t('health.page.report30d', 'รายงาน 30 วัน (PDF/CSV)')}</Link>
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('health.page.backDashboard', '← กลับ Dashboard')}</Link>
        </div>}
        />
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {error && <div className="text-sm text-red-400 inset px-4 py-3">{error}</div>}
        {flash && <div className="text-sm text-amber-300 inset px-4 py-3">{flash}</div>}

        {loading ? (
          <div className="text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>
        ) : (
          <>
            {/* P6: Vital readings + AI trend */}
            <section className="card panel-cyan p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text-cyan"><Icon name="heart-pulse" size={15} className="text-emerald-400" /> {t('health.vital.title', 'Vital Signs — บันทึกด้วยมือ + แนวโน้ม AI')}</h2>
                <span className="text-xs text-gray-500">{t('health.vital.hint', 'วัดแล้วกรอก — ระบบหาค่าผิดปกติ (z-score)')}</span>
              </div>

              <div className="flex flex-wrap gap-2 items-end">
                <select value={rType} onChange={(e) => { setRType(e.target.value); setRError(''); }} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                  {Object.entries(VITAL_META).map(([k, v]) => <option key={k} value={k}>{t('health.vital.' + k, v.label)}</option>)}
                </select>
                {rType === 'BP' ? (
                  <>
                    <input value={rSys} onChange={(e) => setRSys(e.target.value)} placeholder={t('health.vital.bpSys', 'ความดันบน (systolic)')} type="number" className="w-44 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                    <input value={rDia} onChange={(e) => setRDia(e.target.value)} placeholder={t('health.vital.bpDia', 'ความดันล่าง (diastolic)')} type="number" className="w-44 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  </>
                ) : (
                  <input value={rValue} onChange={(e) => setRValue(e.target.value)} placeholder={t('health.vital.valuePlaceholder', 'ค่า ({unit})', { unit: VITAL_META[rType]?.unit ?? '' })} type="number" step="any" className="w-44 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                )}
                <input value={rNote} onChange={(e) => setRNote(e.target.value)} placeholder={t('health.vital.notePlaceholder', 'หมายเหตุ (ตอนเช้า/หลังอาหาร...)')} className="flex-1 min-w-40 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                <button onClick={addReading} disabled={rSaving} className="btn-primary">
                  {rSaving ? t('health.vital.saving', 'กำลังบันทึก...') : <><Icon name="save" size={14} /> {t('health.vital.save', 'บันทึกค่า')}</>}
                </button>
              </div>
              {rError && <div className="text-xs text-red-400 inset p-2">{rError}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(VITAL_META).map(([type, meta]) => {
                  const a = vitalAnalysis[type];
                  const series = readings.filter((r) => r.type === type).map((r) => r.value).reverse();
                  return (
                    <div key={type} className="inset rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Icon name={meta.icon} size={13} /> {t('health.vital.' + type, meta.label)} <span className="text-gray-600">({meta.unit})</span></span>
                        {a && <span className="text-gray-500">{t('health.vital.readingCount', '{n} ครั้ง', { n: a.count })}</span>}
                      </div>
                      <div className="text-2xl font-bold glow-text">
                        {a?.latest ? (type === 'BP' ? `${a.latest.systolic}/${a.latest.diastolic}` : a.latest.value) : '—'}
                        {a?.latest && <span className="text-xs text-gray-500 ml-1">{meta.unit}</span>}
                      </div>
                      {a ? (
                        <>
                          <div className="flex gap-2 text-[11px] items-center flex-wrap">
                            <span className="flex items-center gap-1 text-gray-300"><Icon name={TREND_ICON[a.trend]} size={13} /> {t('health.trend.' + a.trend, TREND_LABEL[a.trend])}</span>
                            {a.changePct != null && <span className="text-gray-500">{a.changePct > 0 ? '+' : ''}{a.changePct.toFixed(1)}%</span>}
                            {a.anomalies.length > 0 && <span className="text-red-400 font-bold flex items-center gap-1 glow-text-red"><Icon name="alert-triangle" size={12} /> {t('health.vital.anomalies', 'ค่าผิดปกติ {n}', { n: a.anomalies.length })}</span>}
                          </div>
                          {a.reference && (
                            <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${REF_STYLE[a.reference.level] || REF_STYLE.ok}`}>
                              {a.reference.label}
                            </span>
                          )}
                          {series.length >= 2 && <Sparkline data={series} width={120} height={32} color="#2dd4bf" />}
                        </>
                      ) : (
                        <div className="text-xs text-gray-600">{t('health.vital.noData', 'ยังไม่มีข้อมูล — บันทึกครั้งแรกด้านบน')}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Stage 1: หมวดอาการ + เกณฑ์ */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {counts.map((c) => (
                <div key={c.category} className={`card p-4 panel-cyan ${c.triggered ? (c.blocked ? 'border-red-700' : 'border-amber-600') : ''}`}>
                  <div className="flex justify-between items-start">
                    {CATEGORY_ICONS[c.category] && <Icon name={CATEGORY_ICONS[c.category]} size={24} className="text-gray-500" />}
                    {c.pendingFlag && <span className="text-[10px] bg-red-600/30 text-red-400 border border-red-700 rounded px-1.5 py-0.5">FLAG</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-2">{t('health.category.' + c.category, CATEGORY_LABELS[c.category])}</div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className={`text-2xl font-bold glow-text ${c.triggered ? 'text-amber-400' : 'text-gray-200'}`}>{c.count}</span>
                    <span className="text-xs text-gray-500">{t('health.daysWindow', '/ 14 วัน (เกณฑ์ {threshold})', { threshold: c.threshold })}</span>
                  </div>
                  {c.triggered && (
                    <div className="mt-2 text-xs">
                      <div className="text-amber-300 flex items-center gap-1"><Icon name="farm" size={12} /> {c.herb}</div>
                      {c.blocked && <div className="text-red-400 flex items-center gap-1"><Icon name="x-circle" size={12} /> {t('health.blocked', 'ห้ามใช้: {reasons}', { reasons: c.reasons.map((r) => t('health.condition.' + r, CONDITION_LABELS[r] || r)).join(', ') })}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Stage 2/3: บันทึกอาการ + Flag */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 panel-glow">
                <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-1.5 glow-text"><Icon name="note" size={14} className="text-emerald-400" /> {t('health.observation.title', 'บันทึกอาการ (Micro-Triage)')}</h2>
                <div className="flex gap-2 flex-wrap">
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{t('health.category.' + k, v)}</option>)}
                  </select>
                  <select value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                    <option value={1}>{t('health.observation.severity1', 'ความรุนแรง 1/5')}</option><option value={2}>{t('health.observation.severity2', '2/5')}</option><option value={3}>{t('health.observation.severity3', '3/5')}</option><option value={4}>{t('health.observation.severity4', '4/5')}</option><option value={5}>{t('health.observation.severity5', '5/5')}</option>
                  </select>
                </div>
                <div className="flex gap-2 mt-2">
                  <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('health.observation.detailPlaceholder', 'รายละเอียด เช่น เข้าห้องน้ำ 3 ครั้งกลางดึก')} className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
                  <button onClick={addObservation} disabled={adding} className="btn-primary">{t('common.save', 'บันทึก')}</button>
                </div>
                <div className="text-xs text-gray-500 mt-2">{t('health.observation.hint', 'อาการซ้ำกัน ≥ 3 ครั้งใน 14 วัน → ระบบจะสร้าง Flag อัตโนมัติ')}</div>

                {pendingFlags.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-500 mb-1">{t('health.observation.pending', 'Flag ที่รอตรวจสอบ ({n}):', { n: pendingFlags.length })}</div>
                    {pendingFlags.map((f) => (
                      <div key={f.id} className="flex items-center justify-between inset px-3 py-2 mb-1 text-sm">
                        <div>
                          <span className="text-red-400 font-bold glow-text-red">{t('health.flagType.' + f.flag_type, FLAG_TYPE_LABELS[f.flag_type] || f.flag_type)}</span>
                          {f.note && <div className="text-xs text-gray-400">{f.note}</div>}
                        </div>
                        <button onClick={() => clearFlag(f.id)} className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1"><Icon name="check" size={12} /> {t('health.observation.clear', 'ล้าง')}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 panel-cyan">
                <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-1.5 glow-text-cyan"><Icon name="history" size={14} className="text-emerald-400" /> {t('health.observation.history', 'ประวัติอาการล่าสุด')}</h2>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {observations.map((o) => (
                    <div key={o.id} className="text-xs text-gray-400 py-1.5 border-b border-gray-800 flex justify-between gap-2">
                      <span>{CATEGORY_ICONS[o.category] && <Icon name={CATEGORY_ICONS[o.category]} size={12} className="inline-block mr-1 align-[-2px]" />}<b className="text-gray-300">{t('health.category.' + o.category, CATEGORY_LABELS[o.category])}</b> — {o.detail || ''}</span>
                      <span className="text-gray-600 shrink-0">{new Date(o.observed_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {o.severity}/5</span>
                    </div>
                  ))}
                  {observations.length === 0 && <div className="text-gray-500 text-sm">{t('health.observation.noHistory', 'ยังไม่มีข้อมูล — บันทึกอาการแรกด้านซ้าย')}</div>}
                </div>
              </div>
            </div>

            {/* Module 3: Privacy Consent */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 panel-cyan">
              <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-1.5 glow-text-cyan"><Icon name="lock" size={14} className="text-emerald-400" /> {t('health.privacy.title', 'Privacy Control (Category-based Consent)')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[['telemetry', 'sensors', 'เซ็นเซอร์/สภาพแวดล้อม'], ['conversation', 'ai-agent', 'บทสนทนาประจำวัน'], ['export', 'upload', 'ส่งออกรายงาน']].map(([key, icon, label]) => (
                  <label key={key} className="flex items-center justify-between inset px-4 py-3 cursor-pointer">
                    <span className="text-sm flex items-center gap-1.5"><Icon name={icon} size={13} /> {t('health.privacy.' + key, label)}</span>
                    <input type="checkbox" checked={consentMap[key] !== false} onChange={() => toggleConsent(key, consentMap[key] !== false)} className="w-4 h-4 accent-teal-500" />
                  </label>
                ))}
              </div>
            </div>

            {/* Module 5: Herbal Safety Profile */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 panel-glow">
              <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-1.5 glow-text"><Icon name="health" size={14} className="text-emerald-400" /> {t('health.profile.title', 'Medical Profile (สำหรับตรวจข้อห้ามสมุนไพร)')}</h2>
              <div className="text-xs text-gray-500 mb-2">{t('health.profile.hint', 'กดเลือกโรคประจำตัว / ยาประจำ — ระบบจะห้ามสมุนไพรที่ขัดแย้งโดยอัตโนมัติ')}</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CONDITION_LABELS).map(([code, label]) => (
                  <button key={code} onClick={() => toggleProfileCode('conditions', code)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${profile.conditions.includes(code) ? 'bg-red-900/40 border-red-600 text-red-300' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                    {profile.conditions.includes(code) && <Icon name="x-circle" size={11} className="inline-block mr-1 align-[-2px]" />}{t('health.condition.' + code, label)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(CONDITION_LABELS).filter(([c]) => c === 'anticoagulant').map(([code, label]) => (
                  <button key={'med-' + code} onClick={() => toggleProfileCode('medications', code)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${profile.medications.includes(code) ? 'bg-red-900/40 border-red-600 text-red-300' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                    {t('health.condition.' + code, label)}{t('health.profile.medSuffix', ' (ยา)')}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
      </div>
  );
}
