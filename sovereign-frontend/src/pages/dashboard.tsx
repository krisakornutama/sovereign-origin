"use client";
import { useEffect, useState } from 'react';
import { roleIsSuperadmin } from '../lib/roles';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useSocket } from '../hooks/useSocket';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { API_RECONNECTED_EVENT } from '../hooks/useApiConnection';
import QuickDeck from '../components/ui/QuickDeck';
import { AiChatPanel, VoiceCommand } from '../components/dashboard/lazy-widgets';
import GlobalMap from '../components/dashboard/GlobalMap';
import AlertsPanel from '../components/dashboard/AlertsPanel';
import DefconWidget from '../components/dashboard/DefconWidget';
import WealthWidget from '../components/dashboard/WealthWidget';
import { HorizontalDefconBar, ThreatHistoryGraph, CategoryBars } from '../components/dashboard/DefconCharts';
import { RadarPentagon, SankeyAlluvial, PerfGauges } from '../components/dashboard/HomeCharts';
import { SensorCategory, TREND_RANGES, TrendRange } from '../components/dashboard/SensorWidgets';
import { WidgetShell } from '../components/dashboard/DashboardChrome';
import { Header } from '../components/dashboard/HeaderBar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import StatCard from '../components/ui/StatCard';
import SectionCard from '../components/ui/SectionCard';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonGrid } from '../components/ui/SkeletonCard';
import { authFetch } from '../lib/apiFetch';
import { latestLocalResult } from '../lib/mbtiData';
import { api } from '../lib/apiClient';
import { useFeatureStore } from '../stores/useFeatureStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import Sidebar from '../components/layout/Sidebar';
import { useRiskStore } from '../stores/useRiskStore';
import { useWealthStore } from '../stores/useWealthStore';
import { useCircadianAtmo } from '../lib/useCircadian';

const categoryMap: Record<string, { name: string; metrics: string[] }> = {
  energy: { name: 'พลังงาน', metrics: ['battery_soc', 'power_kw', 'voltage', 'current'] },
  water: { name: 'น้ำ', metrics: ['water_level_cm', 'flow_rate', 'tank_level', 'rainfall'] },
  environment: {
    name: 'สิ่งแวดล้อม',
    metrics: ['temperature', 'humidity', 'soil_moisture', 'ec_value', 'ph', 'solar_radiation', 'wind_speed', 'pressure'],
  },
  security: { name: 'ความปลอดภัย', metrics: ['smoke', 'flame', 'gas_leak', 'door_state', 'pir_motion', 'relay_state'] },
};

function getCategoryForMetric(metric: string): string | undefined {
  for (const [catKey, cat] of Object.entries(categoryMap)) {
    if (cat.metrics.includes(metric)) return catKey;
  }
  return undefined;
}


const LAYOUT_KEY = 'sovereign-dashboard-layout-v1';
type WidgetKey = 'alerts' | 'status' | 'stats' | 'actions' | 'defcon' | 'wealth' | 'map' | 'sensors' | 'inventory' | 'farm' | 'kids';
const WIDGET_DEFS: Record<WidgetKey, { label: string }> = {
  alerts: { label: 'การแจ้งเตือน' },
  status: { label: 'สถานะอุปกรณ์' },
  stats: { label: 'สรุปค่าเซ็นเซอร์' },
  actions: { label: 'ปุ่มลัด' },
  defcon: { label: 'DEFCON / Threat Index' },
  wealth: { label: 'พอร์ต + Survival Runway' },
  map: { label: 'Global Map' },
  sensors: { label: 'เซ็นเซอร์ + AI' },
  inventory: { label: 'เสบียง (Inventory)' },
  farm: { label: 'แปลงเกษตร (Farm)' },
  kids: { label: 'ลูกๆ (AI สอนลูก)' },
};
const DEFAULT_ORDER: WidgetKey[] = ['alerts', 'defcon', 'wealth', 'inventory', 'farm', 'kids', 'status', 'stats', 'actions', 'map', 'sensors'];

// dense 12-col spans
const DENSE_SPAN: Record<WidgetKey, string> = {
  defcon: 'col-span-12 xl:col-span-7',
  wealth: 'col-span-12 xl:col-span-5',
  map: 'col-span-12 xl:col-span-5',
  sensors: 'col-span-12 xl:col-span-7',
  status: 'col-span-12 xl:col-span-4',
  stats: 'col-span-12',
  alerts: 'col-span-12 xl:col-span-4',
  inventory: 'col-span-12 md:col-span-6 xl:col-span-3',
  farm: 'col-span-12 md:col-span-6 xl:col-span-3',
  kids: 'col-span-12 xl:col-span-6',
  actions: 'col-span-12',
};

function loadLayout(): { order: WidgetKey[]; hidden: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { order: DEFAULT_ORDER, hidden: {} };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.order)) {
      const known = parsed.order.filter((k: string) => WIDGET_DEFS[k as WidgetKey]);
      const INSERT_AFTER: Array<{ key: WidgetKey; after: string }> = [
        { key: 'defcon', after: 'actions' },
        { key: 'wealth', after: 'defcon' },
        { key: 'inventory', after: 'wealth' },
        { key: 'farm', after: 'inventory' },
        { key: 'kids', after: 'farm' },
      ];
      for (const { key, after } of INSERT_AFTER) {
        if (!known.includes(key)) {
          const idx = known.indexOf(after);
          if (idx >= 0) known.splice(idx + 1, 0, key);
          else known.unshift(key);
        }
      }
      return { order: known, hidden: parsed.hidden && typeof parsed.hidden === 'object' ? parsed.hidden : {} };
    }
    return { order: DEFAULT_ORDER, hidden: {} };
  } catch {
    return { order: DEFAULT_ORDER, hidden: {} };
  }
}

export default function Dashboard() {
  const circadianAtmo = useCircadianAtmo();
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  useSocket();
  const { queuedCount, isOnline, syncNow } = useOfflineSync();
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [deviceStatus, setDeviceStatus] = useState({ total: 0, online: 0, offline: 0, devices: [] as any[] });
  const [trendRange, setTrendRange] = useState<TrendRange>('24h');
  const [inventoryStatus, setInventoryStatus] = useState<{ items: number; water: number; food: number; expiring: number; expired: number; lowStock: number } | null>(null);
  const [farmOverview, setFarmOverview] = useState<{ plots: number; growing: number; harvested: number; upcomingHarvests: Array<{ id: string; name: string; crop: string | null; expected_harvest_at: string | null; daysLeft: number }> } | null>(null);
  const [kidsSummary, setKidsSummary] = useState<Array<{
    id: string;
    name: string;
    age: number | null;
    emoji: string | null;
    allowance_day: number | null;
    allowance_amount: number | null;
    savings_goal: number | null;
    piggy: number;
    portfolio_value: number;
    xp: number;
    level: number;
    money_mode: string;
    stats: { attempts: number; avg: number | null; best: number | null };
    lastQuiz: { lesson_title: string; score: number; total: number; pct: number; completed_at: string } | null;
    wallet: number;
    pendingChores: number;
    unpaidBills: number;
  }> | null>(null);

  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
  useEffect(() => {
    if (isHydrated && isAuthenticated && user && !roleIsSuperadmin(user.role)) loadFeatures();
  }, [isHydrated, isAuthenticated, user, loadFeatures]);

  // ── Hydration-safe layout: server เรนเดอร์ DEFAULT_ORDER เสมอ ──
  // (เดิม: useState(() => window ? loadLayout() : default) → ผู้ใช้ที่เคยจัดเรียงแดชบอร์ด
  //  ได้ order ต่างจาก server ตั้งแต่ render แรก → "Expected server HTML to contain
  //  a matching <rect> in <svg>" — เพราะ WealthWidget/Sankey ไปอยู่คนละตำแหน่ง)
  // แก้: init เท่ากันทั้งสองฝั่ง แล้วโหลดของที่เคยจัดไว้หลัง hydration (flash แวบเดียวรับได้)
  const [order, setOrder] = useState<WidgetKey[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // D4: การ์ดชวนทำ MBTI — แสดงเฉพาะคนที่ยังไม่มีผลใน localStorage (client-only รอ hydrate)
  const [mbtiInvite, setMbtiInvite] = useState(false);
  useEffect(() => { setMbtiInvite(latestLocalResult() === null); }, []);

  useEffect(() => {
    const saved = loadLayout();
    setOrder(saved.order);
    setHidden(saved.hidden);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order, hidden }));
    } catch {}
  }, [order, hidden]);

  const threat = useRiskStore((s) => s.threat);
  const defconLevel = useRiskStore((s) => s.defconLevel);
  const wealthSummary = useWealthStore((s) => s.summary);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    const fetchData = () => {
      // เรียก /api/automation/check เฉพาะที่ AlertsPanel (จุดเดียว ทุก 60 วิ) — ที่นี่โหลด stats เพื่อแสดงผลเท่านั้น
      api.getObject<any>('/api/dashboard/stats').then((data:any)=>{ if(data){ setMetrics(data.metrics||{}); } }).catch(()=>{});
      api.getObject<any>('/api/devices/status').then((data:any)=> { if(data && typeof data.online==='number') setDeviceStatus(data); }).catch(()=>{});
      api.getObject<any>('/api/inventory/status').then((data:any)=> data && setInventoryStatus(data.totals)).catch(()=> setInventoryStatus(null));
      api.getObject<any>('/api/farm/plots/overview').then((data:any)=> data && setFarmOverview(data.totals && data.upcomingHarvests ? { ...data.totals, upcomingHarvests: data.upcomingHarvests } : null)).catch(()=> setFarmOverview(null));
      api.getObject<any>('/api/knowledge/teach/dashboard').then((data:any)=> data && setKidsSummary(data.kids||[])).catch(()=> setKidsSummary(null));
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    const onReconnected = () => fetchData();
    window.addEventListener(API_RECONNECTED_EVENT, onReconnected);
    return () => {
      clearInterval(interval);
      window.removeEventListener(API_RECONNECTED_EVENT, onReconnected);
    };
  }, [isHydrated, isAuthenticated, token]);

  if (!isHydrated) {
    // C6: skeleton แดชบอร์ดแทนข้อความเฉย ๆ — ให้รู้สึกว่าโครงหน้ามาแล้ว ข้อมูลกำลังตามมา
    return (
      <div className="min-h-screen bg-gray-950 p-4 lg:p-6 max-w-7xl mx-auto">
        <SkeletonGrid count={6} className="!grid-cols-1 md:!grid-cols-2 xl:!grid-cols-3" />
        <p className="sr-only">{t('dashboard.aiChat.skeletonPage', 'กำลังโหลดแดชบอร์ด...')}</p>
      </div>
    );
  }
  if (!isAuthenticated || !user) {
    return <div className="text-white">{t('dashboard.unauthorized', 'Unauthorized')}</div>;
  }

  const grouped: Record<string, [string, number][]> = {};
  const uncategorized: [string, number][] = [];
  for (const [metric, value] of Object.entries(metrics)) {
    const cat = getCategoryForMetric(metric);
    if (cat) {
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push([metric, value]);
    } else uncategorized.push([metric, value]);
  }

  const overall = threat?.overall ?? null;
  const defconLabel = defconLevel === 1 ? 'DEFCON 1 · CRITICAL' : defconLevel === 2 ? 'DEFCON 2 · SEVERE' : defconLevel === 3 ? 'DEFCON 3 · ELEVATED' : 'DEFCON 5 · NORMAL';
  const defconColor = defconLevel === 1 ? 'text-rose-400 border-rose-500/40 bg-rose-950/30' : defconLevel === 2 ? 'text-orange-400 border-orange-500/40 bg-orange-950/30' : defconLevel === 3 ? 'text-amber-400 border-amber-500/40 bg-amber-950/30' : 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20';
  // keep legacy renderWidget for hidden-compat but we render dense versions below
  const FEATURE_BY_WIDGET: Partial<Record<WidgetKey, string>> = {
    alerts: '/automation',
    defcon: '/risk-monitor',
    wealth: '/treasury',
    inventory: '/inventory',
    farm: '/farm',
    kids: '/knowledge',
  };
  const isVisibleForUser = (k: WidgetKey) => {
    if (k === 'map') return roleIsSuperadmin(user.role);
    const feat = FEATURE_BY_WIDGET[k];
    if (feat && !roleIsSuperadmin(user.role) && !hasFeature(feat)) return false;
    return true;
  };
  const visibleOrder = order.filter((k) => isVisibleForUser(k) && (editMode || !hidden[k]));

  // C5 มือถือ: ลำดับที่เหมาะกับจอเล็ก (ตัวเลข/เตือนบน กราฟิกหนักลงล่าง) —
  // ใช้เฉพาะเมื่อผู้ใช้ยังไม่เคยจัดเรียงเอง (order ยังเป็นค่า default) ไม่งั้นเคารพของที่จัดไว้
  // บน xl กลับเป็นลำดับเดิม 100% (order-classes คืนตำแหน่งเดิมเมื่อ CSS Grid มี 12 คอลัมน์ให้)
  const usingDefaultOrder = order.length === DEFAULT_ORDER.length && order.every((k, i) => k === DEFAULT_ORDER[i]);
  const MOBILE_ORDER: WidgetKey[] = ['alerts', 'defcon', 'wealth', 'inventory', 'status', 'actions', 'stats', 'map', 'sensors', 'farm', 'kids'];
  const MOBILE_RANK: Record<string, number> = {};
  MOBILE_ORDER.forEach((k, i) => { MOBILE_RANK[k] = i; });
  const MOBILE_XL_ORDER: Record<string, string> = {
    alerts: 'xl:order-4',
    defcon: 'xl:order-1',
    wealth: 'xl:order-2',
    inventory: 'xl:order-3',
    status: 'xl:order-6',
    actions: 'xl:order-7',
    stats: 'xl:order-8',
    map: 'xl:order-9',
    sensors: 'xl:order-10',
    farm: 'xl:order-5',
    kids: 'xl:order-11',
  };
  // (ขณะ edit mode งดจัดใหม่ — index ของ drag-and-drop ผูกกับ visibleOrder ตรง ๆ
  //  และบนจอใหญ่ order-classes ทำให้ผลเหมือนเดิมเป๊ะอยู่แล้ว)
  const mobileFirst = usingDefaultOrder && !editMode;

  const renderDense = (key: WidgetKey) => {
    switch (key) {
      case 'defcon': {
        return (
          <div className="card panel-glow p-3 h-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center"><Icon name="shield" size={11} className="text-amber-400" /></span>
                DEFCON / THREAT INDEX
                <span className="text-[9px] font-normal text-gray-500 tracking-wide">· {defconLabel}</span>
              </h3>
              <Link href="/risk-monitor" scroll={false} className="text-[10px] text-sky-400 hover:underline">{t('dashboard.defcon.detailsLink', 'รายละเอียด →')}</Link>
            </div>

            <div className={`rounded-lg border px-2.5 py-2 flex items-center justify-between ${defconColor}`}>
              <span className="text-xs font-bold tracking-widest mono">{defconLabel}</span>
              <span className="mono text-[11px] font-bold">Threat {overall != null ? `${overall}/100` : '—'}</span>
            </div>

            <div className="mt-2.5">
              <HorizontalDefconBar overall={overall} />
            </div>

            <div className="mt-2 bg-gray-800/30 border border-gray-700/40 rounded-lg p-1">
              <div className="flex items-center justify-between px-1.5 pt-0.5">
                <span className="text-[9px] tracking-widest font-mono text-gray-500">HISTORY · THREAT INDEX</span>
                <span className="text-[8px] mono text-amber-300 border border-amber-500/30 px-1 rounded bg-amber-950/30">NOW {overall ?? '—'}</span>
              </div>
<ThreatHistoryGraph />
            </div>

            <div className="mt-2.5">
              <div className="eyebrow-cyan !text-[9px] mb-1.5">Threat Category Module</div>
              <CategoryBars categories={threat?.categories || {}} />
            </div>

            {threat?.summary && <div className="text-[10px] leading-relaxed text-gray-500 mt-2 line-clamp-2 border-t border-gray-800 pt-2">{threat.summary}</div>}
            {overall == null && <div className="text-[10px] text-gray-500 mt-2">{t('dashboard.defcon.emptyBefore', 'ยังไม่มีข้อมูล — เปิด ')} <code className="text-gray-400">RISK_MONITOR_ENABLED=true</code></div>}

            {/* keep original widget hidden for data sync but not visually */}
            <div className="hidden"><DefconWidget /></div>
          </div>
        );
      }
      case 'wealth': {
        const s = wealthSummary;
        return (
          <div className="card panel-cyan p-3 h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center"><Icon name="coin" size={11} className="text-emerald-400" /></span>
                SURVIVAL & RUNWAY
                <span className="hidden sm:inline text-[9px] font-normal text-gray-500">· TREASURY</span>
              </h3>
              <Link href="/treasury" scroll={false} className="text-[10px] text-sky-400 hover:underline">→</Link>
            </div>

            {s ? (
              <>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <div className="bg-gray-800/50 border border-gray-700/60 rounded-lg px-2 py-1.5">
                    <div className="text-[8px] tracking-widest font-mono text-gray-500">PORTFOLIO</div>
                    <div className="mono text-xs font-bold text-emerald-400">${(s.portfolioUsd ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-800/50 border border-gray-700/60 rounded-lg px-2 py-1.5">
                    <div className="text-[8px] tracking-widest font-mono text-gray-500">PHYSICAL</div>
                    <div className="mono text-xs font-bold text-amber-400">${(s.inventoryUsd ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-800/50 border border-emerald-700/40 rounded-lg px-2 py-1.5">
                    <div className="text-[8px] tracking-widest font-mono text-gray-500">RUNWAY</div>
                    <div className={`mono text-xs font-bold ${s.runway?.months != null && s.runway.months < 6 ? 'text-amber-400' : 'text-sky-400'}`}>{s.runway?.months != null ? `${s.runway.months.toFixed(1)}M` : '—'}</div>
                  </div>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-1">
                  <SankeyAlluvial wealth={s} inventory={inventoryStatus} farm={farmOverview} />
                </div>
                <div className="mt-1.5 text-[9px] font-mono text-gray-600 flex justify-between">
                  <span>Cash ${(s.cashUsd ?? 0).toLocaleString()} · Burn ${(s.runway?.monthlyBurnUsd ?? 0).toLocaleString()}/mo</span>
                  <span className="text-emerald-400/70">GRAND ${(s.grandTotalUsd ?? 0).toLocaleString()}</span>
                </div>
                {s.missingPrices.length > 0 && (
                  <div className="text-[9px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1 mt-2">{t('dashboard.wealth.missingPrices', 'ยังไม่มีราคา: {prices}', { prices: s.missingPrices.join(', ') })}</div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-1"><SankeyAlluvial wealth={null} inventory={inventoryStatus} farm={farmOverview} /></div>
                <div className="text-[10px] text-gray-500">{t('dashboard.wealth.emptyBefore', 'ยังไม่มีข้อมูล — เปิด')} <code>PORTFOLIO_ENABLED=true</code></div>
              </div>
            )}
            <div className="hidden"><WealthWidget /></div>
          </div>
        );
      }
      case 'map': {
        return (
          <div className="card panel-cyan p-3 h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="globe" size={12} className="text-cyan-400" /> NODE MAP · HEATMAP</h3>
              <span className="text-[9px] font-mono tracking-widest text-gray-500">{deviceStatus?.total ?? 0} NODES · {deviceStatus?.online ?? 0} ONLINE</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-gray-700/60 bg-[#0b1220] relative h-[240px]">
              <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(520px 220px at 20% 28%, rgba(239,68,68,0.22), transparent 55%), radial-gradient(420px 220px at 70% 60%, rgba(245,158,11,0.20), transparent 60%), radial-gradient(380px 180px at 85% 20%, rgba(52,211,153,0.10), transparent 60%)' }} />
              <GlobalMap />
              <div className="absolute bottom-1 left-1 right-1 flex justify-between text-[8px] font-mono tracking-widest text-gray-500 px-1">
                <span>LAT -90 → 90</span><span className="text-cyan-400/70">LIVE TELEMETRY</span><span>LNG -180 → 180</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              <div className="bg-rose-950/20 border border-rose-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-rose-400">CRITICAL</div><div className="mono text-[11px] font-bold text-rose-300">{deviceStatus?.offline ?? 0}</div></div>
              <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-amber-400">ELEVATED</div><div className="mono text-[11px] font-bold text-amber-300">{Math.max(0, (deviceStatus?.total ?? 0) - (deviceStatus?.online ?? 0) - (deviceStatus?.offline ?? 0))}</div></div>
              <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-emerald-400">STABLE</div><div className="mono text-[11px] font-bold text-emerald-300">{deviceStatus?.online ?? 0}</div></div>
            </div>
          </div>
        );
      }
      case 'status': {
        return (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="cpu" size={12} className="text-emerald-400" /> PERFORMANCE STACK</h3>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">8 GAUGES</span>
            </div>
            <PerfGauges metrics={metrics} deviceStatus={deviceStatus} />
            <div className="grid grid-cols-3 gap-1.5 mt-2 text-[10px]">
              <StatCard label={t('dashboard.status.totalDevices', 'อุปกรณ์ทั้งหมด')} value={deviceStatus?.total ?? 0} icon={<Icon name="grid" size={10} />} />
              <StatCard label={t('dashboard.status.online', 'ออนไลน์')} value={<span className="text-emerald-400">{deviceStatus?.online ?? 0}</span>} icon={<Icon name="check" size={10} className="text-emerald-400" />} />
              <StatCard label={t('dashboard.status.offline', 'ออฟไลน์')} value={<span className="text-rose-400">{deviceStatus?.offline ?? 0}</span>} icon={<Icon name="alert-triangle" size={10} className="text-rose-400" />} />
            </div>
          </div>
        );
      }
      case 'stats': {
        const tiles = [
          { label: 'แบตเตอรี่', value: metrics.battery_soc, unit: '%', icon: 'battery' as const, tone: metrics.battery_soc != null && metrics.battery_soc < 20 ? 'text-rose-400' : 'text-emerald-400' },
          { label: 'ระดับน้ำ', value: metrics.water_level_cm, unit: '%', icon: 'droplet' as const, tone: 'text-sky-400' },
          { label: 'อุณหภูมิ', value: metrics.temperature, unit: '°C', icon: 'thermometer' as const, tone: metrics.temperature != null && metrics.temperature > 40 ? 'text-rose-400' : 'text-amber-400' },
          { label: 'ฝน', value: metrics.rain_detect, isBoolean: true, trueLabel: 'ตก', falseLabel: 'ไม่ตก', icon: 'droplet' as const, tone: 'text-indigo-400' },
        ];
        return (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="gauge" size={12} className="text-cyan-400" /> SENSOR STACK · 4</h3>
              <span className="text-[9px] font-mono text-gray-500">{Object.keys(metrics).length} signals</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {tiles.map((stat, idx) => (
                <StatCard
                  key={idx}
                  label={stat.label}
                  value={(stat as any).isBoolean ? <span className={(stat as any).tone}>{stat.value === 1 ? (stat as any).trueLabel : (stat as any).falseLabel}</span> : <span className={stat.tone} title={stat.value != null ? undefined : t('dashboard.sensors.noData', 'ยังไม่มีข้อมูลเซ็นเซอร์ตัวนี้')}>{stat.value != null ? stat.value.toFixed(1) + stat.unit : '—'}</span>}
                  icon={<Icon name={stat.icon} size={12} className="text-gray-500" />}
                />
              ))}
            </div>
          </div>
        );
      }
      case 'sensors': {
        return (
          <div className="card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="sensors" size={12} className="text-emerald-400" /> SENSORS & AI · TELEMETRY</h3>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-gray-500 mr-1 font-mono">TREND:</span>
                {TREND_RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setTrendRange(r.key)}
                    className={trendRange === r.key ? 'px-2 py-1 rounded bg-emerald-600 text-white font-medium text-[10px]' : 'px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700 text-[10px]'}
                  >
                    {t(`dashboard.trend.${r.key}`, r.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 lg:col-span-8 space-y-3">
                {Object.entries(grouped).map(([catKey, sensors]) => (
                  <SensorCategory key={catKey} title={t(`dashboard.category.${catKey}`, categoryMap[catKey]?.name ?? catKey)} sensors={sensors} trendRange={trendRange} />
                ))}
                {uncategorized.length > 0 && <SensorCategory title={t('dashboard.sensors.others', 'อื่นๆ')} sensors={uncategorized} trendRange={trendRange} />}
                {Object.keys(metrics).length === 0 && <div className="text-gray-500 text-sm">{t('dashboard.sensors.waiting', 'กำลังรอข้อมูลเซ็นเซอร์...')}</div>}
              </div>
              <div className="col-span-12 lg:col-span-4 space-y-3">
                <div className="bg-gray-800/30 border border-gray-700/40 rounded-xl p-3">
                  <div className="text-[9px] tracking-widest font-mono text-cyan-400/80 mb-2">RADAR · SENSOR FUSION (5 AXIS)</div>
                  <RadarPentagon metrics={metrics} />
                </div>
                <div className="bg-gray-800/30 border border-emerald-700/20 rounded-xl p-3">
                  <div className="text-[9px] tracking-widest font-mono text-emerald-400/80 mb-2 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> AI THOUGHT STREAM · DeepSeek-R1</div>
                  <div className="space-y-1.5 font-mono text-[10px] leading-relaxed text-gray-400">
                    <div className="text-emerald-300">[08:14:22] fusing telemetry · bat {metrics.battery_soc != null ? metrics.battery_soc.toFixed(0) : '—'}% · tmp {metrics.temperature != null ? metrics.temperature.toFixed(1) : '—'}°C</div>
                    <div>→ risk delta {overall != null ? `${overall}` : '—'}/100 · defcon {defconLevel || 5} · nodes {deviceStatus?.online ?? 0}/{deviceStatus?.total ?? 0}</div>
                    <div className="text-gray-500">→ inventory {inventoryStatus ? `${inventoryStatus.items} items, ${inventoryStatus.lowStock} low` : '—'} · farm {farmOverview ? `${farmOverview.growing} growing` : '—'}</div>
                    <div className="text-cyan-400/70">▌ reasoning: {threat?.summary ? threat.summary.slice(0, 92) : 'waiting for threat intel ...'}</div>
                  </div>
                </div>
                <div className="bg-gray-900/50 border border-gray-700/40 rounded-xl p-2">
                  <div className="text-[9px] tracking-widest font-mono text-gray-500 mb-2">SOVEREIGN HUB CHAT</div>
                  <div className="h-[380px] rounded-lg border border-gray-800 overflow-hidden"><AiChatPanel compact /></div>
                </div>
                <div className="mt-3">
                  <VoiceCommand />
                </div>
              </div>
            </div>
          </div>
        );
      }
      case 'alerts': {
        return (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="alerts" size={12} className="text-amber-400" /> SECURITY LOGS</h3>
              <span className="text-[9px] font-mono tracking-widest text-gray-600">LIVE</span>
            </div>
            <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
              <AlertsPanel />
              <div className="log-stream space-y-1 text-[10px]">
                <div className="flex gap-2 text-gray-500"><span className="text-emerald-400">[08:14:03]</span> telemetry heartbeat · node {deviceStatus?.devices?.[0]?.node ?? '—'} online</div>
                <div className="flex gap-2 text-gray-500"><span className="text-cyan-400">[08:13:51]</span> automation check · {Object.keys(metrics).length} metrics evaluated</div>
                <div className="flex gap-2 text-gray-500"><span className="text-amber-400">[08:13:42]</span> threat sync · overall {overall ?? '—'} · defcon {defconLevel || 5}</div>
                <div className="flex gap-2 text-gray-500"><span className="text-gray-400">[08:12:59]</span> inventory audit · {inventoryStatus ? `${inventoryStatus.expiring} expiring` : 'pending'}</div>
              </div>
            </div>
          </div>
        );
      }
      case 'inventory': {
        return (
          <SectionCard title={t('dashboard.inventory.title', 'เสบียง & สต็อก')} icon={<Icon name="inventory" size={12} />} action={<Link href="/inventory" scroll={false} className="flex items-center gap-1 text-[10px] text-sky-400 hover:underline">เปิดหน้า Inventory <Icon name="arrow-right" size={10} /></Link>}>
            {inventoryStatus ? (
              <div className="grid grid-cols-2 gap-2">
                <StatCard label={t('dashboard.inventory.totalItems', 'รายการทั้งหมด')} value={inventoryStatus.items} />
                <StatCard label={t('dashboard.inventory.water', 'น้ำ')} value={<span className="text-sky-400">{inventoryStatus.water}</span>} />
                <StatCard label={t('dashboard.inventory.food', 'อาหาร')} value={<span className="text-emerald-400">{inventoryStatus.food}</span>} />
                <StatCard label={t('dashboard.inventory.expiring', 'ใกล้หมดอายุ')} value={<span className="text-amber-400">{inventoryStatus.expiring}</span>} />
                <StatCard label={t('dashboard.inventory.expired', 'หมดอายุแล้ว')} value={<span className="text-rose-400">{inventoryStatus.expired}</span>} />
                <StatCard label={t('common.lowStock', 'สต็อกต่ำ')} value={inventoryStatus.lowStock} />
              </div>
            ) : (
              <EmptyState title={t('dashboard.inventory.disabled', 'โมดูล inventory ปิดอยู่ หรือไม่มีข้อมูล')} description={t('dashboard.inventory.enableHint', 'เปิด ENABLED_MODULES=inventory ใน infra/.env')} />
            )}
          </SectionCard>
        );
      }
      case 'farm': {
        return (
          <SectionCard title={t('dashboard.farm.title', 'แปลงเกษตร')} icon={<Icon name="farm" size={12} />} action={<Link href="/farm" scroll={false} className="flex items-center gap-1 text-[10px] text-sky-400 hover:underline">เปิดหน้า Farm <Icon name="arrow-right" size={10} /></Link>}>
            {farmOverview ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label={t('dashboard.farm.totalPlots', 'แปลงทั้งหมด')} value={farmOverview.plots} />
                  <StatCard label={t('dashboard.farm.growing', 'กำลังโต')} value={<span className="text-emerald-400">{farmOverview.growing}</span>} />
                  <StatCard label={t('dashboard.farm.harvested', 'เก็บเกี่ยวแล้ว')} value={<span className="text-amber-400">{farmOverview.harvested}</span>} />
                </div>
                {farmOverview.upcomingHarvests.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] tracking-widest font-mono text-gray-500">{t('dashboard.farm.upcoming', 'ใกล้เก็บเกี่ยว (30 วัน):')}</div>
                    {farmOverview.upcomingHarvests.map((p) => (
                      <div key={p.id} className="text-xs bg-gray-800/30 border border-gray-700/40 rounded-lg px-2.5 py-1 flex justify-between">
                        <span className="text-gray-300 text-[11px]">{p.name}{p.crop ? ` (${p.crop})` : ''}</span>
                        <span className={p.daysLeft < 7 ? 'text-rose-400 mono text-[11px]' : 'text-amber-300 mono text-[11px]'}>
                          {p.daysLeft > 0 ? t('common.daysLeft', 'อีก {n} วัน', { n: p.daysLeft }) : t('dashboard.farm.today', 'วันนี้!')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <EmptyState title={t('dashboard.farm.disabled', 'โมดูล farm ปิดอยู่ หรือไม่มีข้อมูล')} description={t('dashboard.farm.enableHint', 'เปิด ENABLED_MODULES=farm ใน infra/.env')} />
            )}
          </SectionCard>
        );
      }
      case 'kids': {
        return (
          <section className="card p-3">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-[11px] font-bold tracking-widest text-gray-200 flex items-center gap-1.5"><Icon name="knowledge" size={12} className="text-violet-400" /> ลูกๆ — การเรียนรู้</h2>
              <Link href="/knowledge" scroll={false} className="flex items-center gap-1 text-[10px] text-sky-400 hover:underline">{t('dashboard.kids.openKnowledge', 'เปิดคลังความรู้')} <Icon name="arrow-right" size={10} /></Link>
            </div>
            {kidsSummary === null ? (
              <div className="text-gray-500 text-xs py-6 text-center">{t('dashboard.kids.moduleDisabled', 'โมดูล AI สอนลูกปิดอยู่ หรือยังไม่มีโปรไฟล์เด็ก')}</div>
            ) : kidsSummary.length === 0 ? (
              <div className="text-gray-500 text-xs py-6 text-center">{t('dashboard.kids.noProfiles', 'ยังไม่มีโปรไฟล์เด็ก — ไปที่คลังความรู้ → AI สอนลูก → เพิ่ม แล้วสร้างบทเรียนแรกให้ลูก')}</div>
            ) : (
              <>
                {kidsSummary.some((k) => k.pendingChores > 0 || k.unpaidBills > 0) && (
                  <div className="mb-3 p-2 rounded-lg bg-amber-950/30 border border-amber-800/50 text-[10px] text-amber-200 leading-relaxed">
                    {t('dashboard.kids.pendingSummary', 'มีงานค้าง:')}
                    {kidsSummary.filter((k) => k.pendingChores > 0).map((k) => t('dashboard.kids.choresCount', '{name} งานค้าง {n}', { name: `${k.emoji || ''}${k.name}`, n: k.pendingChores })).join(' · ')}
                    {kidsSummary.some((k) => k.pendingChores > 0) && kidsSummary.some((k) => k.unpaidBills > 0) ? ' · ' : ''}
                    {kidsSummary.filter((k) => k.unpaidBills > 0).map((k) => t('dashboard.kids.billsCount', '{name} บิลค้าง {n} ใบ', { name: `${k.emoji || ''}${k.name}`, n: k.unpaidBills })).join(' · ')}
                    <Link href="/knowledge" scroll={false} className="text-sky-400 hover:underline ml-1">→ ดูหน้าบ้าน</Link>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {kidsSummary.map((k) => {
                    const WEEKDAYS = [t('dashboard.kids.weekdays.sunday', 'อาทิตย์'), t('dashboard.kids.weekdays.monday', 'จันทร์'), t('dashboard.kids.weekdays.tuesday', 'อังคาร'), t('dashboard.kids.weekdays.wednesday', 'พุธ'), t('dashboard.kids.weekdays.thursday', 'พฤหัสบดี'), t('dashboard.kids.weekdays.friday', 'ศุกร์'), t('dashboard.kids.weekdays.saturday', 'เสาร์')];
                    return (
                      <div key={k.id} className={`bg-gray-800/30 border rounded-xl p-2.5 ${k.pendingChores > 0 || k.unpaidBills > 0 ? 'border-amber-800/60' : 'border-gray-700/40'}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-100">{k.emoji || ''} {k.name}{k.age != null ? <span className="text-[10px] text-gray-500 ml-1">{t('dashboard.kids.age', '{n} ปี', { n: k.age })}</span> : null}</div>
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300">{t('dashboard.kids.level', 'ระดับ {level}', { level: k.level })}</span>
                            <span className={`mono text-xs font-semibold ${k.wallet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{k.wallet.toLocaleString()}฿</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-1.5 text-[10px] font-mono">
                          <span className="text-gray-500"><b className="text-gray-200">{k.stats.attempts}</b> บทเรียน</span>
                          <span className="text-gray-500">เฉลี่ย <b className="text-gray-200">{k.stats.avg ?? 0}%</b></span>
                          <span className="text-gray-500">ดีสุด <b className="text-amber-300">{k.stats.best ?? 0}%</b></span>
                        </div>
                        {k.lastQuiz ? (
                          <div className="mt-1.5 text-[9px] text-gray-500 border-t border-gray-700/50 pt-1.5 leading-relaxed">
                            ล่าสุด: <span className="text-gray-400">{k.lastQuiz.lesson_title}</span> — <b className={k.lastQuiz.pct >= 70 ? 'text-emerald-400' : k.lastQuiz.pct >= 50 ? 'text-amber-300' : 'text-rose-400'}>{k.lastQuiz.score}/{k.lastQuiz.total}</b>
                            <span className="block text-gray-600">{new Date(k.lastQuiz.completed_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ) : (
                          <div className="mt-1.5 text-[9px] text-gray-600 border-t border-gray-700/50 pt-1.5">{t('dashboard.kids.noQuizYet', 'ยังไม่เคยทำแบบทดสอบ')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        );
      }
      case 'actions': {
        // ทางลัดหลักย้ายไป QuickDeck (อยู่บนสุดแล้ว) — เหลือเฉพาะปุ่มเครื่องมือที่ไม่ต้องเปิดบ่อย
        return (
          <div className="flex flex-wrap gap-2 py-1">
            <button onClick={() => window.location.reload()} className="btn-secondary text-xs px-3 py-1.5">
              {t('common.refresh', 'รีเฟรชข้อมูล')}
            </button>
            <Link href="/risk-monitor" scroll={false} className="btn-secondary text-xs px-3 py-1.5">
              {t('dashboard.actions.risk', 'เฝ้าระวังความเสี่ยง')}
            </Link>
            <Link href="/system-health" scroll={false} className="btn-secondary text-xs px-3 py-1.5">
              {t('dashboard.actions.health', 'สุขภาพระบบ')}
            </Link>
          </div>
        );
      }
      default: return null;
    }
  };

  return (
    <div className={`${circadianAtmo} min-h-screen bg-gray-950 text-gray-100`}>
<Header queuedCount={queuedCount} isOnline={isOnline} syncNow={syncNow} />
      <main className="flex">
        <Sidebar />
        <div className="flex-1 min-w-0 p-3 lg:p-4 overflow-y-auto">
          {/* Command bar — dense replacement for PageHeader */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-px bg-gradient-to-r from-emerald-500/60 to-transparent" />
                <span className="eyebrow !text-[9px] tracking-[0.22em]">SOVEREIGN OS · COMMAND CENTER</span>
              </div>
              <h1 className="text-[18px] md:text-[20px] font-bold tracking-tight flex items-center gap-2 leading-none">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.14)]"><Icon name="dashboard" size={14} /></span>
                <span className="glow-text">Dashboard</span>
                <span className="hidden sm:inline text-[10px] font-normal tracking-widest text-gray-500 ml-1">· DENSE · {deviceStatus?.online ?? 0}/{deviceStatus?.total ?? 0} ONLINE · THREAT {overall ?? '—'}</span>
              </h1>
              <p className="text-[11px] text-gray-500 mt-1 hidden md:block">สถานะบ้านทั้งระบบ — จัดเรียงแดชบอร์ด หรือ Ctrl/Cmd+K เพื่อค้นหาหน้า</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-gray-500 bg-gray-800/40 border border-gray-700/40 px-2 py-1 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                <span className="text-gray-600">|</span> {Object.keys(metrics).length} signals
              </span>
              <button
                onClick={() => setEditMode(!editMode)}
                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${editMode ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
              >
                {editMode ? t('dashboard.toolbar.done', 'เสร็จแล้ว') : t('dashboard.toolbar.arrange', 'จัดเรียงแดชบอร์ด')}
              </button>
              {editMode && (
                <button onClick={() => { setOrder(DEFAULT_ORDER); setHidden({}); }} className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 text-xs">
                  {t('dashboard.toolbar.resetLayout', 'รีเซ็ตเลย์เอาต์')}
                </button>
              )}
            </div>
          </div>
          {editMode && <div className="text-[10px] font-mono text-gray-500 mb-2">ลากบล็อกเพื่อสลับตำแหน่ง · กดซ่อนเพื่อซ่อน — {visibleOrder.length}/{order.length} แสดง</div>}

          {/* ทางลัดงานประจำ — อยู่บนสุดเสมอ ไม่ขึ้นกับเลย์เอาต์ที่ผู้ใช้จัด */}
          <QuickDeck />

          {/* Dense 12-col command grid */}
          <div className="grid grid-cols-12 gap-2.5 auto-rows-min">
            {/* D4: การ์ดชวนทำ MBTI (เฉพาะคนที่ยังไม่มีผล — ตรงข้ามกับชิปโทนหลวงพี่ในแชท) */}
          {mbtiInvite && (
            <div data-testid="mbti-invite-card" className="col-span-12 card panel-glow p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">🧠</span>
                <div>
                  <div className="text-sm font-bold text-gray-100">{t('dashboard.mbtiCard.title', 'รู้จักตัวเองให้ลึกขึ้น')}</div>
                  <div className="text-xs text-gray-500">{t('dashboard.mbtiCard.desc', 'ทำแบบทดสอบบุคลิกภาพ 16 ประเภท (5–7 นาที) แล้ว AI จะปรับโทนการดูแลให้เข้ากับคุณ')}</div>
                </div>
              </div>
              <Link href="/mbti" scroll={false} className="btn-primary text-xs px-4 py-2">{t('dashboard.mbtiCard.cta', 'เริ่มแบบทดสอบ →')}</Link>
            </div>
          )}

          {/* Top ticker strip — dense mono */}
            <div className="col-span-12 bg-gray-900/60 border border-gray-800 rounded-xl px-2.5 py-1.5 flex flex-wrap gap-2 items-center text-[10px] font-mono backdrop-blur">
              <span className="flex items-center gap-1.5 text-gray-400"><Icon name="cpu" size={11} className="text-emerald-400" /> {deviceStatus?.total ?? 0} DEVICES</span>
              <span className="w-px h-3 bg-gray-700" />
              <span className="text-emerald-400">● {deviceStatus?.online ?? 0} ONLINE</span>
              <span className="text-rose-400">● {deviceStatus?.offline ?? 0} OFFLINE</span>
              <span className="w-px h-3 bg-gray-700" />
              <span className="text-gray-400">BAT {metrics.battery_soc != null ? metrics.battery_soc.toFixed(0) + '%' : '—'}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400">TMP {metrics.temperature != null ? metrics.temperature.toFixed(1) + '°C' : '—'}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400">HUM {metrics.humidity != null ? metrics.humidity.toFixed(0) + '%' : '—'}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded border text-[9px] tracking-widest ${defconLevel <= 3 && defconLevel > 0 ? 'bg-amber-950/40 border-amber-800/60 text-amber-300' : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'}`}>{defconLabel}</span>
                <span className="text-amber-300">THREAT {overall ?? '—'}/100</span>
              </span>
            </div>

            {(mobileFirst
              ? [...visibleOrder].sort((a, b) => (MOBILE_RANK[a] ?? 99) - (MOBILE_RANK[b] ?? 99))
              : visibleOrder
            ).map((key, i) => (
              <WidgetShell
                key={key}
                className={`${DENSE_SPAN[key] ?? 'col-span-12'} ${mobileFirst ? MOBILE_XL_ORDER[key] ?? '' : ''}`}
                title={t(`dashboard.widget.${key}`, WIDGET_DEFS[key].label)}
                editMode={editMode}
                hidden={!!hidden[key]}
                onHide={() => setHidden((prev) => ({ ...prev, [key]: !prev[key] }))}
                dragHandle={editMode}
                onDragStart={() => setDragIdx(i)}
                onDragOver={() => {}}
                onDrop={() => {
                  if (dragIdx === null || dragIdx === i) { setDragIdx(null); return; }
                  setOrder((prev) => {
                    const vis = prev.filter((k) => isVisibleForUser(k) && (editMode || !hidden[k]));
                    const nextVis = [...vis];
                    const [moved] = nextVis.splice(dragIdx, 1);
                    nextVis.splice(i, 0, moved);
                    const result: WidgetKey[] = [];
                    let vi = 0;
                    for (const k of prev) {
                      if (isVisibleForUser(k) && (editMode || !hidden[k])) {
                        result.push(nextVis[vi]);
                        vi++;
                      } else {
                        result.push(k);
                      }
                    }
                    return result;
                  });
                  setDragIdx(null);
                }}
              >
                {renderDense(key)}
              </WidgetShell>
            ))}
          </div>

          {/* water reflection + bottom glow */}
          <div className="mt-4 h-14 rounded-xl border border-gray-800/60 bg-gradient-to-t from-emerald-500/[0.04] via-cyan-500/[0.02] to-transparent backdrop-blur flex items-center justify-center">
            <span className="text-[9px] tracking-[0.22em] font-mono text-gray-600">SOVEREIGN OS · gunmetal + emerald/cyan neon · dense telemetry · {new Date().toLocaleDateString(fmtLocale())}</span>
          </div>
          <div className="h-6 bg-gradient-to-b from-gray-950 to-transparent opacity-40 blur-[1px] -mt-2 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(52,211,153,0.06), transparent 70%)' }} />
        </div>
      </main>
    </div>
  );
}
