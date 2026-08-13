"use client";
// P4 — Predictive AI: คาดการณ์แบตเตอรี่ + จุดผิดปกติของเซ็นเซอร์ (z-score)
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Sparkline from '../components/ui/Sparkline';
import ScenarioForecast from '../components/scenarios/ScenarioForecast';

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
  { value: 'battery_soc', label: '🔋 battery_soc (แบต)' },
  { value: 'water_level_cm', label: '💧 water_level_cm (น้ำ)' },
  { value: 'power_kw', label: '⚡ power_kw (กำลังไฟ)' },
  { value: 'temperature', label: '🌡️ temperature (อุณหภูมิ)' },
  { value: 'humidity', label: '💨 humidity (ความชื้น)' },
  { value: 'soil_moisture', label: '🪴 soil_moisture' },
  { value: 'voltage', label: '🔌 voltage' },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function PredictivePage() {
  const { isAuthenticated, isHydrated, token } = useAuthStore();
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
      setBattery(await res.json());
    } catch {
      // offline
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/predictive/summary`);
      if (!res.ok) return;
      setSummary(await res.json());
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
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
      <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex items-center justify-center">
        <div className="text-sm text-gray-500">กำลังโหลด...</div>
      </div>
    );
  }

  const f = battery?.forecast;
  const secondsLeft = f?.hoursToEmpty != null ? f.hoursToEmpty * 3600 : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="อุปกรณ์ &amp; พลังงาน"
          title="🔮 Predictive AI"
          subtitle="พยากรณ์แบตเตอรี่ + ตรวจจับความผิดปกติ (z-score)" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>

        <main className="max-w-5xl mx-auto p-6 space-y-6 w-full">
          {/* ── Battery forecast ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">⚡ คาดการณ์แบตเตอรี่ (regression 7 วัน)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500">⏳ จะหมดใน</div>
                <div className="text-xl font-bold text-cyan-300">
                  {f?.hoursToEmpty != null
                    ? `${(f.hoursToEmpty / 24) >= 1 ? `${(f.hoursToEmpty / 24).toFixed(1)} วัน` : `${f.hoursToEmpty.toFixed(1)} ชม.`}`
                    : f?.direction === 'charging' || f?.direction === 'flat'
                      ? 'ชาร์จ/คงที่ — ปลอดภัย'
                      : 'ข้อมูลไม่พอ/เป็น NaN'}
                </div>
                {f?.direction === 'discharging' && (
                  <div className="text-xs text-gray-400">
                    ลด ~{(f.slopePerHour * 24).toFixed(1)}{'\u0025'}/วัน · มั่นใจ {(f.r2 * 100).toFixed(0)}% · {f.samples} จุด
                  </div>
                )}
              </div>
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 col-span-2">
                <div className="text-xs text-gray-500 mb-1">แนวโน้ม SOC 72 ชม. ล่าสุด</div>
                {battery?.series.length ? (
                  <Sparkline data={battery.series} color={f?.direction === 'discharging' ? '#f59e0b' : '#10b981'} />
                ) : (
                  <div className="text-xs text-gray-600">ไม่มีข้อมูล</div>
                )}
              </div>
            </div>
          </section>

          {/* ── คาดการณ์สังคม / การเมือง / สถานการณ์ปัจจุบัน ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">
              🌍 คาดการณ์สังคม & การเมือง (จากสถานการณ์ปัจจุบัน)
              <a href="/risk-monitor" className="ml-2 text-xs text-blue-400 hover:underline">→ ดูข้อมูลความเสี่ยงที่ Risk Monitor</a>
            </h2>
            <p className="text-xs text-gray-500">
              Predictive AI ไม่ได้ดูแค่แบตเตอรี่กับเซ็นเซอร์ — ยังพยากรณ์การเมือง การปกครอง เศรษฐกิจ และสถานการณ์ปัจจุบัน
              จากข่าวอดีต + ปัจจุบัน + Threat Index ออกมาเป็นข้อ ๆ พร้อมโอกาสเกิด %
            </p>
            <ScenarioForecast
              endpoint="/api/predictive/world"
              defaultFocus="politics"
              title="🏛️ การคาดการณ์สังคม & การเมือง"
              description="พยากรณ์การเมือง การปกครอง และสถานการณ์ปัจจุบัน พร้อมโอกาสเกิด %"
              accent="bg-cyan-600 hover:bg-cyan-500"
            />
          </section>

          {/* ── Anomaly summary ── */}
          {summary && (
            <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
              <h2 className="text-lg font-bold">🚨 จุดผิดปกติ 24 ชม. (worker 15 นาที)</h2>
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
                        ? 'bg-red-900/30 border-red-700 text-red-300 hover:bg-red-900/50'
                        : 'bg-gray-800 border-gray-600 text-gray-500 hover:bg-gray-700'
                    }`}
                  >
                    {m}: {c > 0 ? `⚠ ${c}` : '✓'}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-gray-600">
                ตรวจล่าสุด: {summary.lastWorkerRun ? fmtDate(summary.lastWorkerRun) : 'ยังไม่เคยรัน'}
              </div>
            </section>
          )}

          {/* ── Anomaly explorer ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">🔍 ค้นหาความผิดปกติ</h2>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                  {METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">ช่วงเวลา (ชม.)</label>
                <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                  {[6, 12, 24, 48, 72, 168].map((h) => (
                    <option key={h} value={h}>{h} ชม.</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => loadAnomalies(metric, hours)}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-sm font-bold"
              >
                {loading ? '⏳ กำลังวิเคราะห์...' : '🔎 วิเคราะห์'}
              </button>
            </div>
            {error && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3">{error}</p>}
            {anomalies && (
              <div>
                {anomalies.length === 0 ? (
                  <p className="text-sm text-gray-500 bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                    ✓ ไม่พบจุดผิดปกติ ({metric} · {hours} ชม. · |z| ≥ 3)
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-xs border-b border-gray-700">
                        <th className="py-2 pr-3">เวลา</th>
                        <th className="py-2 pr-3">ค่า</th>
                        <th className="py-2 pr-3">z-score</th>
                        <th className="py-2">ระดับ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((a, i) => (
                        <tr key={i} className="border-b border-gray-800">
                          <td className="py-2 pr-3 text-gray-300">{fmtDate(a.time)}</td>
                          <td className="py-2 pr-3 text-gray-200">{a.value}</td>
                          <td className="py-2 pr-3">
                            <span className={a.z >= 5 ? 'text-red-400 font-bold' : 'text-amber-400'}>{a.z.toFixed(2)}</span>
                          </td>
                          <td className="py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.severity === 'critical' ? 'bg-red-900/40 text-red-300' : 'bg-amber-900/40 text-amber-300'}`}>
                              {a.severity === 'critical' ? '🔴 critical' : '🟡 warning'}
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