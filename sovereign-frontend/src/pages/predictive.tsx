"use client";
// P4 — Predictive AI: คาดการณ์แบตเตอรี่ + จุดผิดปกติของเซ็นเซอร์ (z-score)
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '../lib/apiFetch';
import { asObject } from '../lib/fetchJson';
import { useAuthStore } from '../stores/useAuthStore';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Sparkline from '../components/ui/Sparkline';
import Icon from '../components/ui/Icon';
import ScenarioForecast from '../components/scenarios/ScenarioForecast';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface BatteryForecast {
  hoursToEmpty: number | null;
  slopePerHour: number;
  r2: number;
  samples: number;
  direction: 'discharging' | 'charging' | 'flat' | 'insufficient';
}

interface Anomaly {
  time: string;
  value: number;
  z: number;
  severity: 'warning' | 'critical';
}

const METRICS = [
  { value: 'battery_soc', label: 'battery_soc (แบต)' },
  { value: 'water_level_cm', label: 'water_level_cm (น้ำ)' },
  { value: 'power_kw', label: 'power_kw (กำลังไฟ)' },
  { value: 'temperature', label: 'temperature (อุณหภูมิ)' },
  { value: 'humidity', label: 'humidity (ความชื้น)' },
  { value: 'soil_moisture', label: 'soil_moisture' },
  { value: 'voltage', label: 'voltage' },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function PredictivePage() {
  const { isAuthenticated, isHydrated, token } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [battery, setBattery] = useState<{ forecast: BatteryForecast; series: number[]; source: { rangeHours: number; samples: number } } | null>(null);
  const [metric, setMetric] = useState('battery_soc');
  const [hours, setHours] = useState(24);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [summary, setSummary] = useState<{ anomaliesByMetric: Record<string, number>; lastWorkerRun: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBattery = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/predictive/battery?hours=168`);
      if (!res.ok) return;
      setBattery(asObject(await res.json()));
    } catch {
      // offline
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/predictive/summary`);
      if (!res.ok) return;
      setSummary(asObject(await res.json()));
    } catch {
      // offline
    }
  }, []);

  const loadAnomalies = useCallback(async (m: string, h: number) => {
    setLoading(true);
    setError(null);
    setAnomalies(null);
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/predictive/anomalies?metric=${encodeURIComponent(m)}&hours=${h}&window=60&threshold=3`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `API error ${res.status}`);
      }
      const data = await res.json();
      setAnomalies(data.anomalies);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('predictive.genericError', 'เกิดข้อผิดพลาด'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadBattery();
    loadSummary();
    const iv = setInterval(() => {
      loadBattery();
      loadSummary();
    }, 30000);
    return () => clearInterval(iv);
  }, [isHydrated, isAuthenticated, token, loadBattery, loadSummary]);

  if (!isHydrated || !isAuthenticated || !token) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  const f = battery?.forecast;
  const secondsLeft = f?.hoursToEmpty != null ? f.hoursToEmpty * 3600 : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('predictive.eyebrow', 'อุปกรณ์ & พลังงาน')}
          title={t('predictive.title', 'Predictive AI')} icon={<Icon name="predictive" size={18} />}
          subtitle={t('predictive.subtitle', 'พยากรณ์แบตเตอรี่ + ตรวจจับความผิดปกติ (z-score)')} actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('predictive.backDashboard', '← กลับ Dashboard')}</Link>}
        />
      </header>

        <main className="max-w-5xl mx-auto p-6 space-y-6 w-full">
          {/* ── Battery forecast ── */}
          <section className="card panel-glow p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('predictive.forecastTitle', 'คาดการณ์แบตเตอรี่ (regression 7 วัน)')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="inset panel-cyan px-3 py-2">
                <div className="text-xs text-gray-500">{t('predictive.emptyIn', 'จะหมดใน')}</div>
                <div className="text-xl font-bold text-cyan-300 glow-text-cyan">
                  {f?.hoursToEmpty != null
                    ? `${(f.hoursToEmpty / 24) >= 1 ? `${(f.hoursToEmpty / 24).toFixed(1)} ${t('predictive.days', 'วัน')}` : `${f.hoursToEmpty.toFixed(1)} ${t('predictive.hoursShort', 'ชม.')}`}`
                    : f?.direction === 'charging' || f?.direction === 'flat'
                      ? t('predictive.safeCharging', 'ชาร์จ/คงที่ — ปลอดภัย')
                      : t('predictive.insufficientData', 'ข้อมูลไม่พอ/เป็น NaN')}
                </div>
                {f?.direction === 'discharging' && (
                  <div className="text-xs text-gray-400">
                    {t('predictive.declineInfo', 'ลด ~{rate}/วัน · มั่นใจ {conf}% · {n} จุด', { rate: (f.slopePerHour * 24).toFixed(1), conf: (f.r2 * 100).toFixed(0), n: f.samples })}
                  </div>
                )}
              </div>
              <div className="inset panel-cyan px-3 py-2 col-span-2">
                <div className="text-xs text-gray-500 mb-1">{t('predictive.trendLabel', 'แนวโน้ม SOC 72 ชม. ล่าสุด')}</div>
                {battery?.series.length ? (
                  <Sparkline data={battery.series} color={f?.direction === 'discharging' ? '#f59e0b' : '#10b981'} />
                ) : (
                  <div className="text-xs text-gray-600">{t('common.noData', 'ไม่มีข้อมูล')}</div>
                )}
              </div>
            </div>
          </section>

          {/* ── คาดการณ์สังคม / การเมือง / สถานการณ์ปัจจุบัน ── */}
          <section className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
              {t('predictive.societyTitle', 'คาดการณ์สังคม & การเมือง (จากสถานการณ์ปัจจุบัน)')}
              <Link href="/risk-monitor" scroll={false} className="ml-2 text-xs text-sky-400 hover:underline">{t('predictive.riskLink', '→ ดูข้อมูลความเสี่ยงที่ Risk Monitor')}</Link>
            </h2>
            <p className="text-xs text-gray-500">
              {t('predictive.scopeDesc', 'Predictive AI ไม่ได้ดูแค่แบตเตอรี่กับเซ็นเซอร์ — ยังพยากรณ์การเมือง การปกครอง เศรษฐกิจ และสถานการณ์ปัจจุบัน จากข่าวอดีต + ปัจจุบัน + Threat Index ออกมาเป็นข้อ ๆ พร้อมโอกาสเกิด %')}
            </p>
            <ScenarioForecast
              endpoint="/api/predictive/world"
              defaultFocus="politics"
              title={t('predictive.scenarioTitle', 'การคาดการณ์สังคม & การเมือง')}
              description={t('predictive.scenarioDesc', 'พยากรณ์การเมือง การปกครอง และสถานการณ์ปัจจุบัน พร้อมโอกาสเกิด %')}
              accent="bg-cyan-600 hover:bg-cyan-500"
            />
          </section>

          {/* ── Anomaly summary ── */}
          {summary && (
            <section className="card panel-cyan p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('predictive.anomalyTitle', 'จุดผิดปกติ 24 ชม. (worker 15 นาที)')}</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.anomaliesByMetric).map(([m, c]) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMetric(m);
                      loadAnomalies(m, 24);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      c > 0
                        ? 'bg-red-950/40 border-red-800/60 text-red-300 hover:bg-red-900/50'
                        : 'bg-gray-800 border-gray-600 text-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    {m}: {c}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-gray-600">
                {t('predictive.lastCheckLabel', 'ตรวจล่าสุด: ')}{summary.lastWorkerRun ? fmtDate(summary.lastWorkerRun) : t('predictive.neverRun', 'ยังไม่เคยรัน')}
              </div>
            </section>
          )}

          {/* ── Anomaly explorer ── */}
          <section className="card panel-cyan p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('predictive.explorerTitle', 'ค้นหาความผิดปกติ')}</h2>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="label">{t('predictive.metric', 'Metric')}</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className="input">
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{t(`predictive.metrics.${m.value}`, m.label)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="label">{t('predictive.rangeLabel', 'ช่วงเวลา (ชม.)')}</label>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="input">
                  {[6, 12, 24, 48, 72, 168].map((h) => (
                    <option key={h} value={h}>{t('predictive.hoursOption', '{n} ชม.', { n: h })}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => loadAnomalies(metric, hours)}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? t('predictive.analyzing', 'กำลังวิเคราะห์...') : t('predictive.analyze', 'วิเคราะห์')}
              </button>
            </div>
            {error && <p className="text-sm text-red-400 inset p-3">{error}</p>}
            {anomalies && (
              <div>
                {anomalies.length === 0 ? (
                  <p className="text-sm text-gray-500 inset p-3">
                    {t('predictive.noAnomalies', 'ไม่พบจุดผิดปกติ ({metric} · {hours} ชม. · |z| ≥ 3)', { metric, hours })}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-xs border-b border-cyan-800/50">
                        <th className="py-2 pr-3">{t('predictive.colTime', 'เวลา')}</th>
                        <th className="py-2 pr-3">{t('common.value', 'ค่า')}</th>
                        <th className="py-2 pr-3">{t('predictive.colZscore', 'z-score')}</th>
                        <th className="py-2">{t('predictive.colLevel', 'ระดับ')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((a, i) => (
                        <tr key={i} className="border-b border-cyan-800/50">
                          <td className="py-2 pr-3 text-gray-300">{fmtDate(a.time)}</td>
                          <td className="py-2 pr-3 text-gray-200">{a.value}</td>
                          <td className="py-2 pr-3">
                            <span className={a.z >= 5 ? 'text-red-400 font-bold' : 'text-amber-400'}>{a.z.toFixed(2)}</span>
                          </td>
                          <td className="py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.severity === 'critical' ? 'bg-red-950/40 border border-red-800/60 text-red-300' : 'bg-amber-950/40 border border-amber-800/60 text-amber-300'}`}>
                              {a.severity === 'critical' ? 'critical' : 'warning'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}