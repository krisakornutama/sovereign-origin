"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import ScenarioForecast from '../components/scenarios/ScenarioForecast';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

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
  war: { label: 'สงคราม', icon: 'alert-triangle' },
  banking: { label: 'วิกฤตธนาคาร', icon: 'coin' },
  energy: { label: 'พลังงานขาดแคลน', icon: 'zap' },
  inflation: { label: 'เงินเฟ้อ', icon: 'trending-up' },
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
    case 1: return { label: 'DEFCON 1 — CRITICAL', color: 'text-rose-400' };
    case 2: return { label: 'DEFCON 2 — SEVERE', color: 'text-orange-400' };
    case 3: return { label: 'DEFCON 3 — ELEVATED', color: 'text-amber-400' };
    default: return { label: 'DEFCON 5 — NORMAL', color: 'text-emerald-400' };
  }
}

export default function RiskMonitorPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
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
        setError(t('riskMonitor.loadFailed', 'โหลดข้อมูล risk ไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
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
      setError(t('riskMonitor.refreshFailed', 'รีเฟรชข่าว + วิเคราะห์ไม่สำเร็จ — ตรวจ Ollama และอินเทอร์เน็ต'));
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
      setError(t('riskMonitor.stressFailed', 'Stress test ล้มเหลว — ตรวจ Ollama'));
    } finally {
      setStressing(false);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('riskMonitor.unauthorized', 'Unauthorized')}</div>;

  const dl = defconLabel(defcon?.currentLevel ?? 0);
  const categories = threat?.categories || {};

  return (
    <div className="atmo-guard min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('riskMonitor.eyebrow', 'ความปลอดภัย')}
          title={t('riskMonitor.title', 'Risk Monitor + DEFCON Engine')} icon={<Icon name="risk" size={18} />} actions={<div className="flex items-center gap-3">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="btn-secondary"
          >
            {refreshing ? t('riskMonitor.analyzing', 'กำลังวิเคราะห์…') : (<><Icon name="refresh" size={14} /> {t('riskMonitor.fetchAnalyze', 'ดึงข่าว + วิเคราะห์')}</>)}
          </button>
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('riskMonitor.backDashboard', '← กลับ Dashboard')}</Link>
        </div>}
        />
      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
        {error && <div className="text-sm text-red-400 inset px-4 py-3">{error}</div>}
        {loading ? (
          <div className="text-gray-500">{t('riskMonitor.loading', 'กำลังโหลด…')}</div>
        ) : (
          <>
            {/* Threat index + DEFCON */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card panel-glow p-5 lg:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('riskMonitor.threatIndex', 'Threat Index (จาก Ollama)')}</h2>
                  {threat && <span className="text-xs text-gray-500">{new Date(threat.timestamp).toLocaleString(fmtLocale())} · {threat.model}</span>}
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
                      <div className="text-4xl font-bold glow-text">{threat ? threat.overall : '—'}</div>
                      <div className="text-xs text-gray-500">/ 100</div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {(Object.keys(CATEGORY_LABELS)).map((key) => (
                      <div key={key}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-gray-400 flex items-center gap-1"><Icon name={CATEGORY_LABELS[key].icon} size={12} /> {t(`riskMonitor.cat.${key}`, CATEGORY_LABELS[key].label)}</span>
                          <span className={categories[key] > 75 ? 'text-rose-400 font-bold' : categories[key] > 50 ? 'text-amber-400' : 'text-gray-300'}>
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
                    {!threat && <div className="text-xs text-gray-500">{t('riskMonitor.noData', 'ยังไม่มีข้อมูล — กด "ดึงข่าว + วิเคราะห์" เพื่อเริ่ม (ต้องเปิด RISK_MONITOR_ENABLED และมี Ollama)')}</div>}
                  </div>
                </div>
              </div>

              <div className="card panel-glow p-5">
                <h2 className="text-sm font-semibold text-gray-200 glow-text mb-2">{t('riskMonitor.defconStatus', 'DEFCON Status')}</h2>
                <div className={`text-2xl font-bold ${dl.color}`}>{t(`riskMonitor.defcon.${defcon?.currentLevel ?? 5}`, dl.label)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {t('riskMonitor.latestThreat', 'Threat Index ล่าสุด: {value} / 100', { value: defcon?.latestOverall ?? '—' })}
                </div>
                <div className="mt-4 space-y-1 text-xs text-gray-400">
                  <div>{t('riskMonitor.rule1', '• > 50 → DEFCON 3: ชาร์จแบต + แจ้งเตือน')}</div>
                  <div>{t('riskMonitor.rule2', '• > 75 → DEFCON 2: Backup + ปิด relay')}</div>
                  <div>{t('riskMonitor.rule3', '• > 90 → DEFCON 1: ตัด WAN + ระบบรักษาความปลอดภัย')}</div>
                </div>
                {defcon && defcon.events.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-500 mb-1">{t('riskMonitor.recentHistory', 'ประวัติล่าสุด:')}</div>
                    {defcon.events.slice(0, 5).map((e, i) => (
                      <div key={i} className="text-[11px] text-gray-400 py-0.5 border-t border-gray-800">
                        {new Date(e.timestamp).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {' '}· {t('riskMonitor.defconEvent', 'DEFCON {level}: {action}', { level: e.level, action: t(`riskMonitor.action.${e.action}`, ACTION_LABELS[e.action] || e.action) })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stress test */}
            <div className="card panel-cyan p-5">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-2">{t('riskMonitor.stressTest', 'Stress Test Simulator')}</h2>
              <div className="flex gap-2">
                <input
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder={t('riskMonitor.stressPlaceholder', 'เช่น น้ำมันพุ่งขึ้น 80% พอร์ตและค่าใช้จ่ายบ้านจะได้รับผลกระทบอย่างไร?')}
                  className="input flex-1"
                />
                <button
                  onClick={runStressTest}
                  disabled={stressing || !scenario.trim()}
                  className="btn-primary"
                >
                  {stressing ? t('riskMonitor.simulating', 'กำลังจำลอง…') : (<><Icon name="play" size={14} /> {t('riskMonitor.simulate', 'จำลอง')}</>)}
                </button>
              </div>
              {stressResult && (
                <div className="inset panel-cyan mt-3 p-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-purple-400 glow-text-cyan">{stressResult.overall}</span>
                    <span className="text-xs text-gray-400">{t('riskMonitor.simulatedThreat', 'Threat Index จำลอง')}</span>
                  </div>
                  {stressResult.summary && <div className="text-xs text-gray-300 mt-2">{stressResult.summary}</div>}
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    {Object.entries(stressResult.categories).map(([k, v]) => (
                      <span key={k}>{CATEGORY_LABELS[k]?.icon ? <Icon name={CATEGORY_LABELS[k]?.icon} size={12} /> : null} {t(`riskMonitor.cat.${k}`, CATEGORY_LABELS[k]?.label || k)}: <b className={v > 75 ? 'text-rose-400' : 'text-gray-200'}>{v}</b></span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Scenario Forecast — บูรณาการกับ AI Command Center */}
            <div className="card panel-cyan p-5">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-2">
                {t('riskMonitor.scenarioForecast', 'การคาดการณ์สถานการณ์ (Scenario Forecast)')}
                <Link href="/ai" scroll={false} className="ml-2 text-xs text-sky-400 hover:underline">{t('riskMonitor.goAi', '→ ไป AI Command Center')}</Link>
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                {t('riskMonitor.forecastDesc', 'ใช้ Threat Index + DEFCON + ข่าว (อดีตและปัจจุบัน) ที่หน้านี้วิเคราะห์ไว้ มาสร้างสถานการณ์ที่เป็นไปได้พร้อมโอกาสเกิด % — ประวัติทุกครั้งเก็บไว้ให้เทียบแนวโน้มได้')}
              </p>
              <ScenarioForecast
                endpoint="/api/risk-monitor/scenarios"
                defaultFocus="general"
                accent="bg-blue-600 hover:bg-blue-500"
              />
            </div>

            {/* Headlines */}
            <div className="card panel-cyan p-5">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-3">{t('riskMonitor.news', 'ข่าวล่าสุด (RSS)')}</h2>
              <div className="space-y-2">
                {headlines.map((h) => (
                  <a
                    key={h.id}
                    href={h.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inset block p-3 hover:border-gray-500 transition-colors"
                  >
                    <div className="text-sm font-bold">{h.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {h.source} · {new Date(h.published).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {h.category && <> · {CATEGORY_LABELS[h.category]?.icon ? <Icon name={CATEGORY_LABELS[h.category]?.icon} size={12} /> : null} {t(`riskMonitor.cat.${h.category}`, CATEGORY_LABELS[h.category]?.label || h.category)}</>}
                    </div>
                    {h.summary && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{h.summary}</div>}
                  </a>
                ))}
                {headlines.length === 0 && (
                  <div className="text-gray-500 text-sm">{t('riskMonitor.noNews', 'ยังไม่มีข่าว — กด "ดึงข่าว + วิเคราะห์" เพื่อดึงจาก RSS feeds')}</div>
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
