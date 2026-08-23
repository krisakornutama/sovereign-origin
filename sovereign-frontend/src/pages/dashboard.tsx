"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useSocket } from '../hooks/useSocket';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { API_RECONNECTED_EVENT } from '../hooks/useApiConnection';
import AiChatPanel from '../components/dashboard/AiChatPanel';
import GlobalMap from '../components/dashboard/GlobalMap';
import AlertsPanel from '../components/dashboard/AlertsPanel';
import DefconWidget from '../components/dashboard/DefconWidget';
import WealthWidget from '../components/dashboard/WealthWidget';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import StatCard from '../components/ui/StatCard';
import SectionCard from '../components/ui/SectionCard';
import EmptyState from '../components/ui/EmptyState';
import { authFetch } from '../lib/apiFetch';
import { useFeatureStore } from '../stores/useFeatureStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import Sidebar from '../components/layout/Sidebar';

const categoryMap: Record<string, { name: string; metrics: string[] }> = {
  energy: {
    name: 'พลังงาน',
    metrics: ['battery_soc', 'power_kw', 'voltage', 'current'],
  },
  water: {
    name: 'น้ำ',
    metrics: ['water_level_cm', 'flow_rate', 'tank_level', 'rainfall'],
  },
  environment: {
    name: 'สิ่งแวดล้อม',
    metrics: [
      'temperature', 'humidity', 'soil_moisture',
      'ec_value', 'ph', 'solar_radiation', 'wind_speed', 'pressure',
    ],
  },
  security: {
    name: 'ความปลอดภัย',
    metrics: [
      'smoke', 'flame', 'gas_leak', 'door_state',
      'pir_motion', 'relay_state',
    ],
  },
};

function getCategoryForMetric(metric: string): string | undefined {
  for (const [catKey, cat] of Object.entries(categoryMap)) {
    if (cat.metrics.includes(metric)) return catKey;
  }
  return undefined;
}

// cache sparkline ต่อ (metric, range) — กัน refetch ซ้ำทุกครั้งที่กลับมาหน้านี้
const trendCache = new Map<string, { time: number; value: number }[]>();

const TREND_RANGES = [
  { key: '24h', label: '24 ชม' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
] as const;
type TrendRange = (typeof TREND_RANGES)[number]['key'];

const TREND_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a78bfa', '#22d3ee', '#f472b6'];
function trendColor(metric: string): string {
  let h = 0;
  for (let i = 0; i < metric.length; i++) h = (h * 31 + metric.charCodeAt(i)) >>> 0;
  return TREND_COLORS[h % TREND_COLORS.length];
}

// ── Dashboard layout: ลากวาง widget ได้ (HTML5 drag&drop ไม่พึ่ง library) ──
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

// แผงใหญ่เต็มแถว — หน้า dashboard เป็นคอนโซล 3 คอลัมน์ (xl) ที่เหลือกว้าง 1 คอลัมน์
const WIDGET_SPAN: Partial<Record<WidgetKey, string>> = {
  map: 'xl:col-span-3',
  sensors: 'xl:col-span-3',
};

function loadLayout(): { order: WidgetKey[]; hidden: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { order: DEFAULT_ORDER, hidden: {} };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.order)) {
      const known = parsed.order.filter((k: string) => WIDGET_DEFS[k as WidgetKey]);
      // layout เก่า (ก่อนมี defcon/wealth) → แทรกวิดเจ็ตใหม่หลัง 'actions' ถ้าไม่มี
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

function WidgetShell({
  title, editMode, hidden, onHide, dragHandle, onDragStart, onDragOver, onDrop, children, className = '',
}: {
  title: string;
  editMode: boolean;
  hidden?: boolean;
  onHide?: () => void;
  dragHandle?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  children: any;
  className?: string;
}) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div
      className={className}
      draggable={dragHandle}
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(); }}
      onDrop={onDrop}
    >
      {editMode && (
        <div className="flex items-center justify-between mb-2 px-1 text-xs">
          <span className="text-gray-500 font-medium">{title}</span>
          <button
            onClick={onHide}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300"
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} size={12} />
            {hidden ? t('common.show', 'แสดง') : t('common.hide', 'ซ่อน')}
          </button>
        </div>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : undefined}>{children}</div>
    </div>
  );
}

export default function Dashboard() {
  // ✅ ใช้ token, isHydrated จาก hook โดยตรง
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

  // สิทธิ์ฟังก์ชั่นต่อคน: ซ่อน widget ที่ไม่มีสิทธิ์ (เช่น ลูกไม่เห็นพอร์ต/ฟาร์ม ถ้าพ่อไม่เปิด)
  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
  useEffect(() => {
    if (isHydrated && isAuthenticated && user && user.role !== 'SUPERADMIN') loadFeatures();
  }, [isHydrated, isAuthenticated, user, loadFeatures]);

  // layout: ลำดับ + ซ่อน/แสดง (persist ใน localStorage)
  const [order, setOrder] = useState<WidgetKey[]>(() =>
    typeof window !== 'undefined' ? loadLayout().order : DEFAULT_ORDER
  );
  const [hidden, setHidden] = useState<Record<string, boolean>>(() =>
    typeof window !== 'undefined' ? loadLayout().hidden : {}
  );
  const [editMode, setEditMode] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order, hidden }));
    } catch {
      /* localStorage ไม่พร้อมใช้งาน */
    }
  }, [order, hidden]);

  useEffect(() => {
    // ✅ รอ hydrate และมี token ก่อน fetch
    if (!isHydrated || !isAuthenticated || !token) return;

    const fetchData = () => {
      // Fetch sensor metrics
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/stats`)
        .then((res) => res.json())
        .then((data) => {
          setMetrics(data.metrics || {});
          // Automation check
          authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metrics: data.metrics || {} }),
          });
        })
        .catch(console.error);

      // Fetch device status
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices/status`)
        .then((res) => res.json())
        .then((data) => setDeviceStatus(data))
        .catch(console.error);

      // Inventory summary (feature module)
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory/status`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setInventoryStatus(data.totals))
        .catch(() => setInventoryStatus(null));

      // Farm overview (feature module)
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/overview`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setFarmOverview(data.totals && data.upcomingHarvests ? { ...data.totals, upcomingHarvests: data.upcomingHarvests } : null))
        .catch(() => setFarmOverview(null));

      // Kids progress summary (AI สอนลูก)
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/dashboard`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setKidsSummary(data.kids || []))
        .catch(() => setKidsSummary(null));
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    // API ตายแล้วกลับมา (self-healing) → โหลดข้อมูลทันที ไม่ต้องรอรอบถัดไป
    const onReconnected = () => fetchData();
    window.addEventListener(API_RECONNECTED_EVENT, onReconnected);
    return () => {
      clearInterval(interval);
      window.removeEventListener(API_RECONNECTED_EVENT, onReconnected);
    };
  }, [isHydrated, isAuthenticated, token]); // ✅ dependency ครบ

  // ✅ Loading state
  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500 text-sm">{t('common.loading', 'กำลังโหลด...')}</div>;
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
    } else {
      uncategorized.push([metric, value]);
    }
  }

  // เรนเดอร์เนื้อหาแต่ละ widget (ย้าย JSX เดิมมาอยู่ในนี้)
  const renderWidget = (key: WidgetKey): any => {
    switch (key) {
      case 'alerts':
        return <AlertsPanel />;
      case 'status':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label={t('dashboard.status.totalDevices', 'อุปกรณ์ทั้งหมด')} value={deviceStatus.total} icon={<Icon name="server" size={14} />} />
            <StatCard label={t('common.online', 'ออนไลน์')} value={<span className="text-emerald-400">{deviceStatus.online}</span>} icon={<Icon name="check" size={14} className="text-emerald-400" />} />
            <StatCard label={t('common.offline', 'ออฟไลน์')} value={<span className="text-rose-400">{deviceStatus.offline}</span>} icon={<Icon name="alert-triangle" size={14} className="text-rose-400" />} />
          </div>
        );
      case 'stats':
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: t('dashboard.stats.battery', 'แบตเตอรี่'), value: metrics.battery_soc, unit: '%', icon: 'battery' as const, tone: metrics.battery_soc != null && metrics.battery_soc < 20 ? 'text-rose-400' : 'text-emerald-400' },
              { label: t('dashboard.stats.waterLevel', 'ระดับน้ำ'), value: metrics.water_level_cm, unit: '%', icon: 'droplet' as const, tone: 'text-sky-400' },
              { label: t('dashboard.stats.temperature', 'อุณหภูมิ'), value: metrics.temperature, unit: '°C', icon: 'thermometer' as const, tone: metrics.temperature != null && metrics.temperature > 40 ? 'text-rose-400' : 'text-amber-400' },
              { label: t('dashboard.stats.rain', 'ฝน'), value: metrics.rain_detect, isBoolean: true, trueLabel: t('dashboard.stats.raining', 'ตก'), falseLabel: t('dashboard.stats.notRaining', 'ไม่ตก'), icon: 'cloud-rain' as const, tone: 'text-indigo-400' },
            ].map((stat, idx) => (
              <StatCard
                key={idx}
                label={stat.label}
                value={stat.isBoolean ? <span className={stat.tone}>{stat.value === 1 ? stat.trueLabel : stat.falseLabel}</span> : <span className={stat.tone}>{stat.value != null ? stat.value.toFixed(1) + stat.unit : t('dashboard.na', 'N/A')}</span>}
                icon={<Icon name={stat.icon} size={14} className="text-gray-500" />}
              />
            ))}
          </div>
        );
      case 'actions':
        return (
          <div className="flex flex-wrap gap-3">
            <Link href="/sensors" scroll={false} className="btn-primary">{t('dashboard.actions.manageSensors', 'จัดการอุปกรณ์และเซ็นเซอร์')}</Link>
            <button onClick={() => window.location.reload()} className="btn-secondary">{t('dashboard.actions.refreshData', 'รีเฟรชข้อมูล')}</button>
          </div>
        );
      case 'defcon':
        return <DefconWidget />;
      case 'wealth':
        return <WealthWidget />;
      case 'inventory':
        return (
          <SectionCard title={t('dashboard.inventory.title', 'เสบียง & สต็อก')} icon={<Icon name="inventory" size={14} />} action={<Link href="/inventory" scroll={false} className="flex items-center gap-1 text-xs text-sky-400 hover:underline">{t('dashboard.inventory.openPage', 'เปิดหน้า Inventory')} <Icon name="arrow-right" size={11} /></Link>}>
            {inventoryStatus ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
      case 'kids':
        return (
          <section className="card p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-gray-200">{t('dashboard.kids.title', 'ลูกๆ — การเรียนรู้')}</h2>
              <Link href="/knowledge" scroll={false} className="flex items-center gap-1 text-xs text-sky-400 hover:underline">{t('dashboard.kids.openKnowledge', 'เปิดคลังความรู้')} <Icon name="arrow-right" size={11} /></Link>
            </div>
            {kidsSummary === null ? (
              <div className="text-gray-500 text-sm py-4">{t('dashboard.kids.moduleDisabled', 'โมดูล AI สอนลูกปิดอยู่ หรือยังไม่มีโปรไฟล์เด็ก')}</div>
            ) : kidsSummary.length === 0 ? (
              <div className="text-gray-500 text-sm py-4">{t('dashboard.kids.noProfiles', 'ยังไม่มีโปรไฟล์เด็ก — ไปที่คลังความรู้ → AI สอนลูก → เพิ่ม แล้วสร้างบทเรียนแรกให้ลูก')}</div>
            ) : (
              <>
                {/* แจ้งเตือน: งานบ้านค้าง / บิลค้าง / ค่าขนมถึงกำหนด */}
                {kidsSummary.some((k) => k.pendingChores > 0 || k.unpaidBills > 0) && (
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-[11px] text-amber-200 leading-relaxed">
                    {t('dashboard.kids.pendingSummary', 'มีงานค้าง:')}
                    {kidsSummary.filter((k) => k.pendingChores > 0).map((k) => t('dashboard.kids.choresCount', '{name} งานค้าง {n}', { name: `${k.emoji || ''}${k.name}`, n: k.pendingChores })).join(' · ')}
                    {kidsSummary.some((k) => k.pendingChores > 0) && kidsSummary.some((k) => k.unpaidBills > 0) ? ' · ' : ''}
                    {kidsSummary.filter((k) => k.unpaidBills > 0).map((k) => t('dashboard.kids.billsCount', '{name} บิลค้าง {n} ใบ', { name: `${k.emoji || ''}${k.name}`, n: k.unpaidBills })).join(' · ')}
                    <Link href="/knowledge" scroll={false} className="text-sky-400 hover:underline ml-1">{t('dashboard.kids.viewHome', '→ ดูหน้าบ้าน')}</Link>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kidsSummary.map((k) => {
                    const WEEKDAYS = [t('dashboard.kids.weekdays.sunday', 'อาทิตย์'), t('dashboard.kids.weekdays.monday', 'จันทร์'), t('dashboard.kids.weekdays.tuesday', 'อังคาร'), t('dashboard.kids.weekdays.wednesday', 'พุธ'), t('dashboard.kids.weekdays.thursday', 'พฤหัสบดี'), t('dashboard.kids.weekdays.friday', 'ศุกร์'), t('dashboard.kids.weekdays.saturday', 'เสาร์')];
                    return (
                      <div key={k.id} className={`card p-3 ${k.pendingChores > 0 || k.unpaidBills > 0 ? '!border-amber-800/70' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-100">{k.emoji || ''} {k.name}{k.age != null ? <span className="text-[10px] text-gray-500 ml-1">{t('dashboard.kids.age', '{n} ปี', { n: k.age })}</span> : null}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300">{t('dashboard.kids.level', 'ระดับ {level}', { level: k.level })}</span>
                            {k.money_mode === 'real' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/60 text-emerald-300" title={t('dashboard.kids.realMoneyTitle', 'เงินจริง — พ่อแม่มอบหมายให้ลูกบริหาร')}>{t('dashboard.kids.realMoney', 'เงินจริง')}</span>
                            )}
                            <span className={`mono text-xs font-semibold ${k.wallet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{k.wallet.toLocaleString()}฿</span>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-2 text-xs">
                          <div className="text-gray-500"><b className="text-gray-200">{k.stats.attempts}</b> {t('dashboard.kids.lessons', 'บทเรียน')}</div>
                          <div className="text-gray-500">{t('dashboard.kids.avg', 'เฉลี่ย')} <b className="text-gray-200">{k.stats.avg ?? 0}%</b></div>
                          <div className="text-gray-500">{t('dashboard.kids.best', 'ดีสุด')} <b className="text-amber-300">{k.stats.best ?? 0}%</b></div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                          {k.pendingChores > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300">{t('dashboard.kids.choresBadge', 'งานค้าง {n}', { n: k.pendingChores })}</span>
                          )}
                          {k.unpaidBills > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-800/60 text-rose-300">{t('dashboard.kids.billsBadge', 'บิลค้าง {n}', { n: k.unpaidBills })}</span>
                          )}
                          {k.allowance_amount != null && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">{t('dashboard.kids.allowance', 'ขนมวัน{day} {amount}฿', { day: WEEKDAYS[k.allowance_day ?? 0], amount: k.allowance_amount })}</span>
                          )}
                          {k.piggy > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300">{t('dashboard.kids.piggy', 'ถัง {amount}฿', { amount: k.piggy.toLocaleString() })}{k.savings_goal != null && k.savings_goal > 0 ? `/${k.savings_goal}` : ''}</span>
                          )}
                          {k.portfolio_value > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/60 text-emerald-300">{t('dashboard.kids.portfolio', 'พอร์ต {amount}฿', { amount: k.portfolio_value.toLocaleString() })}</span>
                          )}
                        </div>
                        {k.lastQuiz ? (
                          <div className="mt-2 text-[10px] text-gray-500 border-t border-gray-800 pt-1.5 leading-relaxed">
                            {t('dashboard.kids.lastQuizLabel', 'ล่าสุด: ')}<span className="text-gray-400">{k.lastQuiz.lesson_title}</span> — <b className={k.lastQuiz.pct >= 70 ? 'text-emerald-400' : k.lastQuiz.pct >= 50 ? 'text-amber-300' : 'text-rose-400'}>{k.lastQuiz.score}/{k.lastQuiz.total}</b>
                            <span className="block text-gray-600">{new Date(k.lastQuiz.completed_at).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ) : (
                          <div className="mt-2 text-[10px] text-gray-600 border-t border-gray-800 pt-1.5">{t('dashboard.kids.noQuiz', 'ยังไม่เคยทำแบบทดสอบ')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        );
      case 'farm':
        return (
          <SectionCard title={t('dashboard.farm.title', 'แปลงเกษตร')} icon={<Icon name="farm" size={14} />} action={<Link href="/farm" scroll={false} className="flex items-center gap-1 text-xs text-sky-400 hover:underline">{t('dashboard.farm.openPage', 'เปิดหน้า Farm')} <Icon name="arrow-right" size={11} /></Link>}>
            {farmOverview ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label={t('dashboard.farm.totalPlots', 'แปลงทั้งหมด')} value={farmOverview.plots} />
                  <StatCard label={t('dashboard.farm.growing', 'กำลังโต')} value={<span className="text-emerald-400">{farmOverview.growing}</span>} />
                  <StatCard label={t('dashboard.farm.harvested', 'เก็บเกี่ยวแล้ว')} value={<span className="text-amber-400">{farmOverview.harvested}</span>} />
                </div>
                {farmOverview.upcomingHarvests.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs text-gray-500">{t('dashboard.farm.upcoming', 'ใกล้เก็บเกี่ยว (30 วัน):')}</div>
                    {farmOverview.upcomingHarvests.map((p) => (
                      <div key={p.id} className="text-sm bg-gray-800/40 border border-gray-800 rounded px-3 py-1.5 flex justify-between">
                        <span>{p.name}{p.crop ? ` (${p.crop})` : ''}</span>
                        <span className={p.daysLeft < 7 ? 'text-rose-400' : 'text-amber-300'}>
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
      case 'map':
        return (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">{t('dashboard.map.title', 'Global Node Status Map')}</h2>
            <div className="h-96 w-full rounded-lg overflow-hidden border border-gray-800"><GlobalMap /></div>
          </section>
        );
      case 'sensors':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-8">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-base font-semibold text-gray-100">{t('dashboard.sensors.title', 'เซ็นเซอร์')}</h2>
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-gray-500 mr-1">{t('dashboard.sensors.trendLabel', 'Trend:')}</span>
                  {TREND_RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setTrendRange(r.key)}
                      className={
                        trendRange === r.key
                          ? 'px-2.5 py-1 rounded bg-emerald-600 text-white font-medium'
                          : 'px-2.5 py-1 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700'
                      }
                    >
                      {r.label ? t(`dashboard.trend.${r.key}`, r.label) : ''}
                    </button>
                  ))}
                </div>
              </div>
              {Object.entries(grouped).map(([catKey, sensors]) => (
                <SensorCategory key={catKey} title={t(`dashboard.category.${catKey}`, categoryMap[catKey]?.name ?? catKey)} sensors={sensors} trendRange={trendRange} />
              ))}
              {uncategorized.length > 0 && <SensorCategory title={t('dashboard.sensors.others', 'อื่นๆ')} sensors={uncategorized} trendRange={trendRange} />}
              {Object.keys(metrics).length === 0 && <div className="text-gray-500 text-sm">{t('dashboard.sensors.waiting', 'กำลังรอข้อมูลเซ็นเซอร์...')}</div>}
            </div>
            <div className="lg:col-span-1">
              <div className="sticky top-4"><AiChatPanel /></div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // โหมด edit: แสดงทุก widget (รวมที่ซ่อน — ติ่มๆ) เพื่อให้กด "แสดง" ได้
  // สิทธิ์: map/defcon/wealth/inventory/farm/kids ต้องมี grant ตรง (superadmin เห็นหมด)
  const FEATURE_BY_WIDGET: Partial<Record<WidgetKey, string>> = {
    alerts: '/automation',
    defcon: '/risk-monitor',
    wealth: '/treasury',
    inventory: '/inventory',
    farm: '/farm',
    kids: '/knowledge',
  };
  const isVisibleForUser = (k: WidgetKey) => {
    if (k === 'map') return user.role === 'SUPERADMIN';
    const feat = FEATURE_BY_WIDGET[k];
    if (feat && user.role !== 'SUPERADMIN' && !hasFeature(feat)) return false;
    return true;
  };
  const visibleOrder = order.filter((k) => isVisibleForUser(k) && (editMode || !hidden[k]));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header queuedCount={queuedCount} isOnline={isOnline} syncNow={syncNow} />
      <main className="flex">
        <Sidebar />
        <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <PageHeader
            eyebrow={t('dashboard.page.eyebrow', 'ภาพรวม')}
            title={t('dashboard.page.title', 'Dashboard')}
            icon={<Icon name="dashboard" size={18} />}
            subtitle={t('dashboard.page.subtitle', 'สถานะบ้านทั้งระบบ — จัดเรียงแดชบอร์ด หรือ Ctrl/Cmd+K เพื่อค้นหาหน้า')}
          />
          {/* Toolbar: จัดเรียงแดชบอร์ด */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${editMode ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
            >
              {editMode ? t('dashboard.toolbar.done', 'เสร็จแล้ว') : t('dashboard.toolbar.arrange', 'จัดเรียงแดชบอร์ด')}
            </button>
            {editMode && (
              <>
                <span className="text-gray-500">{t('dashboard.toolbar.dragHint', 'ลากบล็อกเพื่อสลับตำแหน่ง · กดซ่อนเพื่อซ่อน')}</span>
                <button
                  onClick={() => { setOrder(DEFAULT_ORDER); setHidden({}); }}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
                >
                  {t('dashboard.toolbar.resetLayout', 'รีเซ็ตเลย์เอาต์')}
                </button>
              </>
            )}
          </div>

          {/* คอนโซลหลัก: กริด 3 คอลัมน์ — ลากวาง widget ได้ */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 content-start">
          {visibleOrder.map((key, i) => (
            <WidgetShell
              key={key}
              className={WIDGET_SPAN[key] ?? ''}
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
              {renderWidget(key)}
            </WidgetShell>
          ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function SensorCategory({ title, sensors, trendRange }: { title: string; sensors: [string, number][]; trendRange: TrendRange }) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        <Link href={`/sensors?tab=data&filter=${encodeURIComponent(sensors[0]?.[0] ?? '')}`} scroll={false} className="text-xs text-sky-400 hover:underline">{t('dashboard.sensors.manage', 'จัดการ')}</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {sensors.map(([metric, value]) => (
          <SensorCard key={metric} label={formatLabel(metric)} value={value} metric={metric} trendRange={trendRange} />
        ))}
      </div>
    </div>
  );
}

function formatLabel(metric: string): string {
  const labels: Record<string, string> = {
    battery_soc: 'แบตเตอรี่', water_level_cm: 'ระดับน้ำ', power_kw: 'กำลังไฟฟ้า',
    temperature: 'อุณหภูมิ', humidity: 'ความชื้นอากาศ', soil_moisture: 'ความชื้นดิน',
    ec_value: 'ค่า EC', ph: 'pH', solar_radiation: 'แสงอาทิตย์',
    voltage: 'แรงดันไฟฟ้า', current: 'กระแสไฟฟ้า', wind_speed: 'ความเร็วลม',
    rainfall: 'ปริมาณน้ำฝน', ultrasonic_distance: 'ระยะทาง', pir_motion: 'PIR Motion',
    rain_detect: 'ตรวจจับฝน', co2_level: 'CO2', pm25: 'PM2.5', smoke: 'ควันไฟ',
    flame: 'เปลวไฟ', pressure: 'ความกดอากาศ', altitude: 'ความสูง', weight: 'น้ำหนัก',
    flow_rate: 'อัตราการไหล', tank_level: 'ระดับของเหลว', vibration: 'แรงสั่นสะเทือน',
    sound_level: 'เสียง', light_intensity: 'ความเข้มแสง', door_state: 'ประตู',
    gas_leak: 'แก๊สรั่ว', relay_state: 'Relay',
  };
  return labels[metric] || metric;
}

function SensorCard({ label, value, metric, trendRange }: { label: string; value: number; metric: string; trendRange: TrendRange }) {
  const t = useLanguageStore((s) => s.t);
  const isPercentage = ['battery_soc', 'water_level_cm', 'humidity', 'soil_moisture'].includes(metric);
  const unit = isPercentage ? '%' : '';
  const color = getColor(metric, value);
  const [trend, setTrend] = useState<{ time: number; value: number }[] | null>(null);

  // ดึง trend ครั้งเดียวตอน mount หรือเมื่อสลับช่วงเวลา (cache ไว้ต่อ metric+range)
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${metric}:${trendRange}`;
    const cached = trendCache.get(cacheKey);
    if (cached) {
      setTrend(cached);
      return;
    }
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/timescale/history?metric=${encodeURIComponent(metric)}&range=${trendRange}`)
      .then((res) => res.json())
      .then((result: any[]) => {
        if (cancelled) return;
        const points = result.map((r: any) => ({
          time: new Date(r.bucket).getTime(),
          value: r.avg_value,
        }));
        trendCache.set(cacheKey, points);
        setTrend(points);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [metric, trendRange]);

  return (
    <div className="card p-4 hover:border-emerald-800/50 hover:shadow-[0_0_12px_rgba(52,211,153,0.08)] transition-all duration-200 group">
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-emerald-500/60 group-hover:bg-emerald-400 transition-colors" />{t(`dashboard.metric.${metric}`, label)}</div>
      <div className={`mono text-2xl font-semibold ${color} tracking-tight`}>{value != null ? value.toFixed(1) + unit : t('dashboard.na', 'N/A')}</div>
      {isPercentage && (
        <div className="w-full bg-gray-800 h-1.5 rounded-full mt-2.5 overflow-hidden">
          <div className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700" style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
      {/* mini trend 24 ชม. — คลิกไปดูกราฟเต็มใน History */}
      <Link 
        href={`/history?metric=${encodeURIComponent(metric)}&range=${trendRange}`} scroll={false}
        className="block mt-2 group"
        title={trendRange === '24h' ? t('dashboard.sensors.fullChart24h', 'ดูกราฟเต็ม 24 ชม. ในหน้า History') : trendRange === '7d' ? t('dashboard.sensors.fullChart7d', 'ดูกราฟเต็ม 7 วัน ในหน้า History') : t('dashboard.sensors.fullChart30d', 'ดูกราฟเต็ม 30 วัน ในหน้า History')}
      >
        <TrendSparkline points={trend} color={trendColor(metric)} />
        <div className="text-[10px] text-gray-600 group-hover:text-gray-400 mt-0.5">{t('dashboard.sensors.trendHint', '24h trend →')}</div>
      </Link>
    </div>
  );
}

// กราฟเส้นเล็ก 36px — วาดด้วย canvas ไม่พึ่ง library
function TrendSparkline({ points, color = '#10b981' }: { points: { time: number; value: number }[] | null; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = 36;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // null = กำลังโหลด, [] = ไม่มีข้อมูล
    if (!points || points.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(points ? '—' : '…', w / 2, h / 2 + 3);
      return;
    }

    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = 3;
    const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);

    // พื้นที่ใต้เส้น (gradient จาง)
    ctx.beginPath();
    points.forEach((p, i) => {
      const xi = x(i);
      if (i === 0) ctx.moveTo(xi, h - pad);
      ctx.lineTo(xi, y(p.value));
    });
    ctx.lineTo(x(points.length - 1), h - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '3d');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();

    // เส้น
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    points.forEach((p, i) => {
      const xi = x(i);
      if (i === 0) ctx.moveTo(xi, y(p.value));
      else ctx.lineTo(xi, y(p.value));
    });
    ctx.stroke();

    // จุดสุดท้าย
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(last.value), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [points, color]);

  return <canvas ref={ref} className="w-full h-9" />;
}

function getColor(metric: string, value: number): string {
  if (metric === 'battery_soc' && value < 20) return 'text-red-400';
  if (metric === 'ec_value' && value > 4) return 'text-red-400';
  if (metric === 'temperature' && value > 40) return 'text-red-400';
  return 'text-white';
}

function Header({ queuedCount, isOnline, syncNow }: { queuedCount: number; isOnline: boolean; syncNow: () => Promise<number> }) {
  const { user, logout } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  return (
    <header className="bg-gray-900/80 border-b border-gray-800 px-6 py-3 flex justify-between items-center backdrop-blur-md sticky top-0 z-20">
      <h1 className="text-base font-semibold text-gray-100 flex items-center gap-2">
        <Icon name="shield" size={16} className="text-emerald-400 glow-text" />
        SOVEREIGN OS
        <span className="text-[11px] text-gray-500 font-normal">Command Center</span>
      </h1>
      <div className="flex items-center gap-3 text-sm">
        {!isOnline && (
          <span className="px-2 py-1 rounded bg-amber-950/50 border border-amber-800/60 text-amber-300 text-xs">{t('common.onlineBadge')}</span>
        )}
        {queuedCount > 0 && (
          <button
            onClick={() => syncNow()}
            title={t('common.pendingSync', 'กดเพื่อ sync ทันที', { n: queuedCount })}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-950/50 border border-sky-800/60 text-sky-300 text-xs hover:bg-sky-900/60 transition-colors"
          >
            <Icon name="refresh" size={11} />
            {t('common.pendingSync', '{n} รายการรอ sync', { n: queuedCount })}
          </button>
        )}
        <span className="mono text-xs text-gray-500">{user?.role} | {user?.id || user?.username}</span>
        <button
          onClick={() => {
            // logout เอง — ล้าง session แล้วไปหน้า login ตรง ๆ ไม่ต้องรอ 401
            logout();
            window.location.href = '/';
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-800/70 text-red-300 transition-colors shadow-[0_0_12px_rgba(251,113,133,0.15)]"
        >
          <Icon name="logout" size={13} />
          {t('common.logout')}
        </button>
      </div>
    </header>
  );
}

