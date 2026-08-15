"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import ScenarioForecast from '../components/scenarios/ScenarioForecast';

interface ThreatIndex {
  overall: number;
  categories: Record<string, number>;
  summary: string | null;
  timestamp: string;
  model: string;
}

interface Headline {
  id: string;
  source: string;
  title: string;
  link: string;
  summary: string | null;
  published: string;
  category: string | null;
}

interface DefconInfo {
  currentLevel: number;
  thresholds: { level3: number; level2: number; level1: number };
  latestOverall: number | null;
  events: { timestamp: string; level: number; action: string; detail: string | null }[];
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  war: { label: 'สงคราม', icon: '💥' },
  banking: { label: 'วิกฤตธนาคาร', icon: '🏦' },
  energy: { label: 'พลังงานขาดแคลน', icon: '⚡' },
  inflation: { label: 'เงินเฟ้อ', icon: '📈' },
};

const ACTION_LABELS: Record<string, string> = {
  charge_battery: 'ชาร์จแบตเตอรี่เต็ม 100% ล่วงหน้า',
  telegram_stats: 'แจ้งเตือนสถิติผ่าน Telegram',
  backup_cold_storage: 'Backup ลง Cold Storage',
  relays_off: 'ปิด Relay ที่ไม่จำเป็น',
  wan_disconnect: 'ตัดการเชื่อมต่อ WAN (Isolated LAN)',
  security_on: 'เปิดระบบรักษาความปลอดภัย',
};

function defconLabel(level: number): { label: string; color: string } {
  switch (level) {
    case 1: return { label: 'DEFCON 1 — CRITICAL', color: 'text-red-400' };
    case 2: return { label: 'DEFCON 2 — SEVERE', color: 'text-orange-400' };
    case 3: return { label: 'DEFCON 3 — ELEVATED', color: 'text-yellow-400' };
    default: return { label: 'DEFCON 5 — NORMAL', color: 'text-green-400' };
  }
}

export default function RiskMonitorPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [threat, setThreat] = useState<ThreatIndex | null>(null);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [defcon, setDefcon] = useState<DefconInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [scenario, setScenario] = useState('');
  const [stressResult, setStressResult] = useState<ThreatIndex | null>(null);
  const [stressing, setStressing] = useState(false);

  const load = async () => {
    const [overviewRes, defconRes] = await Promise.all([
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/overview`),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/defcon`),
    ]);
    const overview = await overviewRes.json();
    setThreat(overview.threatIndex);
    setHeadlines(overview.headlines || []);
    setDefcon(await defconRes.json());
  };

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load()
      .catch((err) => {
        console.error(err);
        setError('โหลดข้อมูล risk ไม่สำเร็จ — ตรวจว่า backend เปิดอยู่');
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, user]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/refresh`, { method: 'POST' });
      await load();
    } catch (err) {
      console.error(err);
      setError('รีเฟรชข่าว + วิเคราะห์ไม่สำเร็จ — ตรวจ Ollama และอินเทอร์เน็ต');
    } finally {
      setRefreshing(false);
    }
  };

  const runStressTest = async () => {
    if (!scenario.trim()) return;
    setStressing(true);
    setStressResult(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/stress-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: scenario.trim() }),
      });
      const data = await res.json();
      setStressResult(data.result);
    } catch (err) {
      console.error(err);
      setError('Stress test ล้มเหลว — ตรวจ Ollama');
    } finally {
      setStressing(false);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  const dl = defconLabel(defcon?.currentLevel ?? 0);
  const categories = threat?.categories || {};

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="📰 Risk Monitor + DEFCON Engine" actions={<div className="flex items-center gap-3">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm"
          >
            {refreshing ? '⏳ กำลังวิเคราะห์…' : '🔄 ดึงข่าว + วิเคราะห์'}
          </button>
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>
        </div>}
        />
      </header>
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}
        {loading ? (
          <div className="text-gray-500">⏳ กำลังโหลด…</div>
        ) : (
          <>
            {/* Threat index + DEFCON */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 lg:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-bold text-gray-200">🌍 Threat Index (จาก Ollama)</h2>
                  {threat && <span className="text-xs text-gray-500">{new Date(threat.timestamp).toLocaleString('th-TH')} · {threat.model}</span>}
                </div>
                <div className="flex items-center gap-6">
                  <div className="relative w-40 h-40">
                    <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#1f2937" strokeWidth="12" />
                      <circle
                        cx="60" cy="60" r="50" fill="none"
                        stroke={threat && threat.overall > 75 ? '#ef4444' : threat && threat.overall > 50 ? '#f59e0b' : '#10b981'}
                        strokeWidth="12"
                        strokeDasharray={`${(threat?.overall ?? 0) * 3.14} 314`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="text-4xl font-bold">{threat ? threat.overall : '—'}</div>
                      <div className="text-xs text-gray-500">/ 100</div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {(Object.keys(CATEGORY_LABELS)).map((key) => (
                      <div key={key}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-gray-400">{CATEGORY_LABELS[key].icon} {CATEGORY_LABELS[key].label}</span>
                          <span className={categories[key] > 75 ? 'text-red-400 font-bold' : categories[key] > 50 ? 'text-yellow-400' : 'text-gray-300'}>
                            {categories[key] ?? 0}
                          </span>
                        </div>
                        <div className="bg-gray-700 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, categories[key] ?? 0)}%`,
                              background: (categories[key] ?? 0) > 75 ? '#ef4444' : (categories[key] ?? 0) > 50 ? '#f59e0b' : '#10b981',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {threat?.summary && <div className="text-xs text-gray-400 pt-1">{threat.summary}</div>}
                    {!threat && <div className="text-xs text-gray-500">ยังไม่มีข้อมูล — กด "ดึงข่าว + วิเคราะห์" เพื่อเริ่ม (ต้องเปิด RISK_MONITOR_ENABLED และมี Ollama)</div>}
                  </div>
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <h2 className="font-bold text-gray-200 mb-2">🛡️ DEFCON Status</h2>
                <div className={`text-2xl font-bold ${dl.color}`}>{dl.label}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Threat Index ล่าสุด: {defcon?.latestOverall ?? '—'} / 100
                </div>
                <div className="mt-4 space-y-1 text-xs text-gray-400">
                  <div>• &gt; 50 → DEFCON 3: ชาร์จแบต + แจ้งเตือน</div>
                  <div>• &gt; 75 → DEFCON 2: Backup + ปิด relay</div>
                  <div>• &gt; 90 → DEFCON 1: ตัด WAN + ระบบรักษาความปลอดภัย</div>
                </div>
                {defcon && defcon.events.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-500 mb-1">ประวัติล่าสุด:</div>
                    {defcon.events.slice(0, 5).map((e, i) => (
                      <div key={i} className="text-[11px] text-gray-400 py-0.5 border-t border-gray-800">
                        {new Date(e.timestamp).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {' '}· DEFCON {e.level}: {ACTION_LABELS[e.action] || e.action}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stress test */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <h2 className="font-bold text-gray-200 mb-2">🧪 Stress Test Simulator</h2>
              <div className="flex gap-2">
                <input
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder="เช่น น้ำมันพุ่งขึ้น 80% พอร์ตและค่าใช้จ่ายบ้านจะได้รับผลกระทบอย่างไร?"
                  className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={runStressTest}
                  disabled={stressing || !scenario.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm"
                >
                  {stressing ? '⏳ กำลังจำลอง…' : '▶️ จำลอง'}
                </button>
              </div>
              {stressResult && (
                <div className="mt-3 bg-gray-800/60 border border-gray-700 rounded-lg p-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-purple-400">{stressResult.overall}</span>
                    <span className="text-xs text-gray-400">Threat Index จำลอง</span>
                  </div>
                  {stressResult.summary && <div className="text-xs text-gray-300 mt-2">{stressResult.summary}</div>}
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    {Object.entries(stressResult.categories).map(([k, v]) => (
                      <span key={k}>{CATEGORY_LABELS[k]?.icon} {CATEGORY_LABELS[k]?.label}: <b className={v > 75 ? 'text-red-400' : 'text-gray-200'}>{v}</b></span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Scenario Forecast — บูรณาการกับ AI Command Center */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <h2 className="font-bold text-gray-200 mb-2">
                🌍 การคาดการณ์สถานการณ์ (Scenario Forecast)
                <a href="/ai" className="ml-2 text-xs text-blue-400 hover:underline">→ ไป AI Command Center</a>
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                ใช้ Threat Index + DEFCON + ข่าว (อดีตและปัจจุบัน) ที่หน้านี้วิเคราะห์ไว้ มาสร้างสถานการณ์ที่เป็นไปได้พร้อมโอกาสเกิด % —
                ประวัติทุกครั้งเก็บไว้ให้เทียบแนวโน้มได้
              </p>
              <ScenarioForecast
                endpoint="/api/risk-monitor/scenarios"
                defaultFocus="general"
                accent="bg-blue-600 hover:bg-blue-500"
              />
            </div>

            {/* Headlines */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <h2 className="font-bold text-gray-200 mb-3">📰 ข่าวล่าสุด (RSS)</h2>
              <div className="space-y-2">
                {headlines.map((h) => (
                  <a
                    key={h.id}
                    href={h.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-800/50 border border-gray-700 rounded-lg p-3 hover:border-gray-500 transition-colors"
                  >
                    <div className="text-sm font-bold">{h.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {h.source} · {new Date(h.published).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {h.category && <> · {CATEGORY_LABELS[h.category]?.icon} {CATEGORY_LABELS[h.category]?.label}</>}
                    </div>
                    {h.summary && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{h.summary}</div>}
                  </a>
                ))}
                {headlines.length === 0 && (
                  <div className="text-gray-500 text-sm">ยังไม่มีข่าว — กด "ดึงข่าว + วิเคราะห์" เพื่อดึงจาก RSS feeds</div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
      </div>
  );
}
