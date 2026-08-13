"use client";
import { useEffect, useRef, useState } from 'react';
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
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';

const categoryMap: Record<string, { name: string; icon: string; metrics: string[] }> = {
  energy: {
    name: '⚡ พลังงาน',
    icon: '⚡',
    metrics: ['battery_soc', 'power_kw', 'voltage', 'current'],
  },
  water: {
    name: '💧 น้ำ',
    icon: '💧',
    metrics: ['water_level_cm', 'flow_rate', 'tank_level', 'rainfall'],
  },
  environment: {
    name: '🌿 สิ่งแวดล้อม',
    icon: '🌿',
    metrics: [
      'temperature', 'humidity', 'soil_moisture',
      'ec_value', 'ph', 'solar_radiation', 'wind_speed', 'pressure',
    ],
  },
  security: {
    name: '🛡️ ความปลอดภัย',
    icon: '🛡️',
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
  alerts: { label: '🚨 การแจ้งเตือน' },
  status: { label: '📡 สถานะอุปกรณ์' },
  stats: { label: '📊 สรุปค่าเซ็นเซอร์' },
  actions: { label: '⚡ ปุ่มลัด' },
  defcon: { label: '🛡️ DEFCON / Threat Index' },
  wealth: { label: '💰 พอร์ต + Survival Runway' },
  map: { label: '🌍 Global Map' },
  sensors: { label: '📡 เซ็นเซอร์ + AI' },
  inventory: { label: '📦 เสบียง (Inventory)' },
  farm: { label: '🌱 แปลงเกษตร (Farm)' },
  kids: { label: '🧑🎓 ลูกๆ (AI สอนลูก)' },
};
const DEFAULT_ORDER: WidgetKey[] = ['alerts', 'defcon', 'wealth', 'inventory', 'farm', 'kids', 'status', 'stats', 'actions', 'map', 'sensors'];

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
  title, editMode, hidden, onHide, dragHandle, onDragStart, onDragOver, onDrop, children,
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
}) {
  return (
    <div
      draggable={dragHandle}
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(); }}
      onDrop={onDrop}
    >
      {editMode && (
        <div className="flex items-center justify-between mb-2 px-1 text-xs">
          <span className="text-gray-400 font-bold">⠿ {title}</span>
          <button
            onClick={onHide}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-600 hover:bg-gray-700 text-gray-300"
          >
            {hidden ? '👁️ แสดง' : '🙈 ซ่อน'}
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
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white">Unauthorized</div>;
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <div className="text-sm text-gray-400">📡 อุปกรณ์ทั้งหมด</div>
              <div className="text-3xl font-bold text-white">{deviceStatus.total}</div>
            </div>
            <div className="bg-green-900/30 rounded-xl p-4 border border-green-700">
              <div className="text-sm text-gray-400">🟢 ออนไลน์</div>
              <div className="text-3xl font-bold text-green-400">{deviceStatus.online}</div>
            </div>
            <div className="bg-red-900/30 rounded-xl p-4 border border-red-700">
              <div className="text-sm text-gray-400">🔴 ออฟไลน์</div>
              <div className="text-3xl font-bold text-red-400">{deviceStatus.offline}</div>
            </div>
          </div>
        );
      case 'stats':
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: '🔋 แบตเตอรี่', value: metrics.battery_soc, unit: '%', color: 'bg-gradient-to-br from-green-600 to-emerald-800' },
              { label: '💧 ระดับน้ำ', value: metrics.water_level_cm, unit: '%', color: 'bg-gradient-to-br from-blue-600 to-cyan-800' },
              { label: '🌡️ อุณหภูมิ', value: metrics.temperature, unit: '°C', color: 'bg-gradient-to-br from-orange-600 to-red-800' },
              { label: '🌧️ ฝน', value: metrics.rain_detect, isBoolean: true, trueLabel: 'ตก', falseLabel: 'ไม่ตก', color: 'bg-gradient-to-br from-indigo-600 to-purple-800' },
            ].map((stat, idx) => (
              <div key={idx} className={`${stat.color} rounded-xl p-4 backdrop-blur-sm bg-opacity-90 shadow-lg border border-white/10`}>
                <div className="text-xs opacity-75 mb-1">{stat.label}</div>
                {stat.isBoolean ? (
                  <div className="text-2xl font-bold">{stat.value === 1 ? stat.trueLabel : stat.falseLabel}</div>
                ) : (
                  <div className="text-2xl font-bold">{stat.value != null ? stat.value.toFixed(1) + stat.unit : 'N/A'}</div>
                )}
              </div>
            ))}
          </div>
        );
      case 'actions':
        return (
          <div className="flex flex-wrap gap-3">
            <a href="/sensors" className="px-5 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold transition-all shadow-lg active:scale-95">📡 จัดการอุปกรณ์และเซ็นเซอร์</a>
            <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-all active:scale-95">🔄 รีเฟรชข้อมูล</button>
          </div>
        );
      case 'defcon':
        return <DefconWidget />;
      case 'wealth':
        return <WealthWidget />;
      case 'inventory':
        return (
          <section className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl text-green-400">📦 เสบียง & สต็อก</h2>
              <a href="/inventory" className="text-xs text-blue-400 hover:underline">เปิดหน้า Inventory →</a>
            </div>
            {inventoryStatus ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                  <div className="text-xs text-gray-400">รายการทั้งหมด</div>
                  <div className="text-2xl font-bold">{inventoryStatus.items}</div>
                </div>
                <div className="bg-blue-900/30 rounded-lg p-3 border border-blue-700">
                  <div className="text-xs text-gray-400">💧 น้ำ</div>
                  <div className="text-2xl font-bold text-blue-300">{inventoryStatus.water}</div>
                </div>
                <div className="bg-emerald-900/30 rounded-lg p-3 border border-emerald-700">
                  <div className="text-xs text-gray-400">🍚 อาหาร</div>
                  <div className="text-2xl font-bold text-emerald-300">{inventoryStatus.food}</div>
                </div>
                <div className="bg-amber-900/30 rounded-lg p-3 border border-amber-700">
                  <div className="text-xs text-gray-400">⚠️ ใกล้หมดอายุ</div>
                  <div className="text-2xl font-bold text-amber-300">{inventoryStatus.expiring}</div>
                </div>
                <div className="bg-red-900/30 rounded-lg p-3 border border-red-700">
                  <div className="text-xs text-gray-400">🚫 หมดอายุแล้ว</div>
                  <div className="text-2xl font-bold text-red-400">{inventoryStatus.expired}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                  <div className="text-xs text-gray-400">📉 สต็อกต่ำ</div>
                  <div className="text-2xl font-bold">{inventoryStatus.lowStock}</div>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm py-4">โมดูล inventory ปิดอยู่ หรือไม่มีข้อมูล</div>
            )}
          </section>
        );
      case 'kids':
        return (
          <section className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl text-green-400">🧑🎓 ลูกๆ — การเรียนรู้</h2>
              <a href="/knowledge" className="text-xs text-blue-400 hover:underline">เปิดคลังความรู้ →</a>
            </div>
            {kidsSummary === null ? (
              <div className="text-gray-500 text-sm py-4">โมดูล AI สอนลูกปิดอยู่ หรือยังไม่มีโปรไฟล์เด็ก</div>
            ) : kidsSummary.length === 0 ? (
              <div className="text-gray-500 text-sm py-4">ยังไม่มีโปรไฟล์เด็ก — ไปที่คลังความรู้ → AI สอนลูก → ➕ เพิ่ม แล้วสร้างบทเรียนแรกให้ลูก</div>
            ) : (
              <>
                {/* แจ้งเตือน: งานบ้านค้าง / บิลค้าง / ค่าขนมถึงกำหนด */}
                {kidsSummary.some((k) => k.pendingChores > 0 || k.unpaidBills > 0) && (
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-900/30 border border-amber-700 text-[11px] text-amber-200 leading-relaxed">
                    ⚠️ มีงานค้าง:
                    {kidsSummary.filter((k) => k.pendingChores > 0).map((k) => `${k.emoji || '🧒'}${k.name} งานค้าง ${k.pendingChores}`).join(' · ')}
                    {kidsSummary.some((k) => k.pendingChores > 0) && kidsSummary.some((k) => k.unpaidBills > 0) ? ' · ' : ''}
                    {kidsSummary.filter((k) => k.unpaidBills > 0).map((k) => `${k.emoji || '🧒'}${k.name} บิลค้าง ${k.unpaidBills} ใบ`).join(' · ')}
                    <a href="/knowledge" className="text-blue-400 hover:underline ml-1">→ ดูหน้าบ้าน</a>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kidsSummary.map((k) => {
                    const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
                    return (
                      <div key={k.id} className={`bg-gray-800/50 rounded-lg p-3 border ${k.pendingChores > 0 || k.unpaidBills > 0 ? 'border-amber-700/70' : 'border-gray-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-bold text-gray-100">{k.emoji || '🧒'} {k.name}{k.age != null ? <span className="text-[10px] text-gray-500 ml-1">{k.age} ปี</span> : null}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/60 text-amber-300">⭐ ระดับ {k.level}</span>
                            {k.money_mode === 'real' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/60 text-emerald-300" title="เงินจริง — พ่อแม่มอบหมายให้ลูกบริหาร">💵 จริง</span>
                            )}
                            <span className={`text-xs font-bold ${k.wallet >= 0 ? 'text-green-400' : 'text-red-400'}`}>{k.wallet.toLocaleString()}฿</span>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-2 text-xs">
                          <div className="text-gray-400">📖 <b className="text-gray-200">{k.stats.attempts}</b> บทเรียน</div>
                          <div className="text-gray-400">เฉลี่ย <b className="text-gray-200">{k.stats.avg ?? 0}%</b></div>
                          <div className="text-gray-400">ดีสุด <b className="text-amber-300">{k.stats.best ?? 0}%</b></div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                          {k.pendingChores > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/60 text-amber-300">🧹 งานค้าง {k.pendingChores}</span>
                          )}
                          {k.unpaidBills > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-red-900/40 border border-red-700/60 text-red-300">🧾 บิลค้าง {k.unpaidBills}</span>
                          )}
                          {k.allowance_amount != null && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-400">💰 ขนมวัน{WEEKDAYS[k.allowance_day ?? 0]} {k.allowance_amount}฿</span>
                          )}
                          {k.piggy > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/60 text-amber-300">🐷 ถัง {k.piggy.toLocaleString()}฿{k.savings_goal != null && k.savings_goal > 0 ? `/${k.savings_goal}` : ''}</span>
                          )}
                          {k.portfolio_value > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/60 text-emerald-300">📈 พอร์ต {k.portfolio_value.toLocaleString()}฿</span>
                          )}
                        </div>
                        {k.lastQuiz ? (
                          <div className="mt-2 text-[10px] text-gray-500 border-t border-gray-800 pt-1.5 leading-relaxed">
                            🕐 ล่าสุด: <span className="text-gray-400">{k.lastQuiz.lesson_title}</span> — <b className={k.lastQuiz.pct >= 70 ? 'text-green-400' : k.lastQuiz.pct >= 50 ? 'text-amber-300' : 'text-red-400'}>{k.lastQuiz.score}/{k.lastQuiz.total}</b>
                            <span className="block text-gray-600">{new Date(k.lastQuiz.completed_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ) : (
                          <div className="mt-2 text-[10px] text-gray-600 border-t border-gray-800 pt-1.5">ยังไม่เคยทำแบบทดสอบ</div>
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
          <section className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl text-green-400">🌱 แปลงเกษตร</h2>
              <a href="/farm" className="text-xs text-blue-400 hover:underline">เปิดหน้า Farm →</a>
            </div>
            {farmOverview ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                    <div className="text-xs text-gray-400">แปลงทั้งหมด</div>
                    <div className="text-2xl font-bold">{farmOverview.plots}</div>
                  </div>
                  <div className="bg-emerald-900/30 rounded-lg p-3 border border-emerald-700">
                    <div className="text-xs text-gray-400">🌱 กำลังโต</div>
                    <div className="text-2xl font-bold text-emerald-300">{farmOverview.growing}</div>
                  </div>
                  <div className="bg-amber-900/30 rounded-lg p-3 border border-amber-700">
                    <div className="text-xs text-gray-400">🌾 เก็บเกี่ยวแล้ว</div>
                    <div className="text-2xl font-bold text-amber-300">{farmOverview.harvested}</div>
                  </div>
                </div>
                {farmOverview.upcomingHarvests.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-xs text-gray-400">🗓️ ใกล้เก็บเกี่ยว (30 วัน):</div>
                    {farmOverview.upcomingHarvests.map((p) => (
                      <div key={p.id} className="text-sm bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 flex justify-between">
                        <span>{p.name}{p.crop ? ` (${p.crop})` : ''}</span>
                        <span className={p.daysLeft < 7 ? 'text-red-400' : 'text-amber-300'}>
                          {p.daysLeft > 0 ? `อีก ${p.daysLeft} วัน` : 'วันนี้!'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-500 text-sm py-4">โมดูล farm ปิดอยู่ หรือไม่มีข้อมูล</div>
            )}
          </section>
        );
      case 'map':
        return (
          <section className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
            <h2 className="text-xl text-green-400 mb-3">🌍 Global Node Status Map</h2>
            <div className="h-96 w-full rounded-lg overflow-hidden border border-gray-600"><GlobalMap /></div>
          </section>
        );
      case 'sensors':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-8">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-300">📡 Sensor Command</h2>
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-gray-500 mr-1">Trend:</span>
                  {TREND_RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setTrendRange(r.key)}
                      className={
                        trendRange === r.key
                          ? 'px-2.5 py-1 rounded bg-green-600 text-white font-bold'
                          : 'px-2.5 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700'
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {Object.entries(grouped).map(([catKey, sensors]) => (
                <SensorCategory key={catKey} title={categoryMap[catKey]?.name ?? catKey} sensors={sensors} trendRange={trendRange} />
              ))}
              {uncategorized.length > 0 && <SensorCategory title="📡 อื่นๆ" sensors={uncategorized} trendRange={trendRange} />}
              {Object.keys(metrics).length === 0 && <div className="text-gray-500 text-sm">⏳ กำลังรอข้อมูลเซ็นเซอร์...</div>}
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
  const isVisibleForUser = (k: WidgetKey) => k !== 'map' || user.role === 'SUPERADMIN';
  const visibleOrder = order.filter((k) => isVisibleForUser(k) && (editMode || !hidden[k]));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100 font-mono">
      <Header queuedCount={queuedCount} isOnline={isOnline} syncNow={syncNow} />
      <main className="flex">
        <Sidebar />
        <div className="flex-1 p-4 lg:p-6 space-y-6 overflow-y-auto">
          <PageHeader
            eyebrow="ภาพรวม"
            title="🏰 Dashboard"
            subtitle="สถานะบ้านทั้งระบบ — กด 🎛️ จัดเรียงแดชบอร์ด หรือ Ctrl/Cmd+K เพื่อค้นหาหน้า"
          />
          {/* Toolbar: จัดเรียงแดชบอร์ด */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-3 py-1.5 rounded border transition-colors ${editMode ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}
            >
              {editMode ? '✅ เสร็จแล้ว' : '🎛️ จัดเรียงแดชบอร์ด'}
            </button>
            {editMode && (
              <>
                <span className="text-gray-500">ลากบล็อกเพื่อสลับตำแหน่ง · กด 🙈 เพื่อซ่อน</span>
                <button
                  onClick={() => { setOrder(DEFAULT_ORDER); setHidden({}); }}
                  className="px-3 py-1.5 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  ↺ รีเซ็ตเลย์เอาต์
                </button>
              </>
            )}
          </div>

          {visibleOrder.map((key, i) => (
            <WidgetShell
              key={key}
              title={WIDGET_DEFS[key].label}
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
      </main>
    </div>
  );
}

function SensorCategory({ title, sensors, trendRange }: { title: string; sensors: [string, number][]; trendRange: TrendRange }) {
  return (
    <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-5 backdrop-blur-sm shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-200">{title}</h3>
        <a href={`/sensors?tab=data&filter=${encodeURIComponent(sensors[0]?.[0] ?? '')}`} className="text-xs text-blue-400 hover:underline">จัดการ</a>
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
    battery_soc: '🔋 แบตเตอรี่', water_level_cm: '💧 ระดับน้ำ', power_kw: '⚡ กำลังไฟฟ้า',
    temperature: '🌡️ อุณหภูมิ', humidity: '💦 ความชื้นอากาศ', soil_moisture: '🌱 ความชื้นดิน',
    ec_value: '🧪 ค่า EC', ph: '🧫 pH', solar_radiation: '☀️ แสงอาทิตย์',
    voltage: '🔌 แรงดันไฟฟ้า', current: '🔋 กระแสไฟฟ้า', wind_speed: '💨 ความเร็วลม',
    rainfall: '🌧️ ปริมาณน้ำฝน', ultrasonic_distance: '📏 ระยะทาง', pir_motion: '🚶 PIR Motion',
    rain_detect: '🌧️ ตรวจจับฝน', co2_level: '🫁 CO2', pm25: '😷 PM2.5', smoke: '🔥 ควันไฟ',
    flame: '🧯 เปลวไฟ', pressure: '🔽 ความกดอากาศ', altitude: '🏔️ ความสูง', weight: '⚖️ น้ำหนัก',
    flow_rate: '💦 อัตราการไหล', tank_level: '🛢️ ระดับของเหลว', vibration: '📳 แรงสั่นสะเทือน',
    sound_level: '🔊 เสียง', light_intensity: '💡 ความเข้มแสง', door_state: '🚪 ประตู',
    gas_leak: '💨 แก๊สรั่ว', relay_state: '🔘 Relay',
  };
  return labels[metric] || `📡 ${metric}`;
}

function SensorCard({ label, value, metric, trendRange }: { label: string; value: number; metric: string; trendRange: TrendRange }) {
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
    <div className="bg-gray-800/70 border border-gray-600 rounded-xl p-4 hover:border-gray-400 transition-all hover:scale-[1.02] shadow-md">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value != null ? value.toFixed(1) + unit : 'N/A'}</div>
      {isPercentage && (
        <div className="w-full bg-gray-700 h-1.5 rounded-full mt-2 overflow-hidden">
          <div className="h-1.5 rounded-full bg-gradient-to-r from-green-400 to-green-600" style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
      {/* mini trend 24 ชม. — คลิกไปดูกราฟเต็มใน History */}
      <a
        href={`/history?metric=${encodeURIComponent(metric)}&range=${trendRange}`}
        className="block mt-2 group"
        title={`ดูกราฟเต็ม ${trendRange === '24h' ? '24 ชม.' : trendRange === '7d' ? '7 วัน' : '30 วัน'} ในหน้า History`}
      >
        <TrendSparkline points={trend} color={trendColor(metric)} />
        <div className="text-[10px] text-gray-600 group-hover:text-gray-400 mt-0.5">24h trend →</div>
      </a>
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
  return (
    <header className="bg-gray-900/90 border-b border-gray-700 px-6 py-3 flex justify-between items-center backdrop-blur-sm sticky top-0 z-20">
      <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-300">🏰 SOVEREIGN OS <span className="text-xs text-gray-500 ml-2">Command Center</span></h1>
      <div className="flex items-center gap-3 text-sm">
        {!isOnline && (
          <span className="px-2 py-1 rounded bg-yellow-900/50 border border-yellow-700 text-yellow-300 text-xs">📵 ออฟไลน์</span>
        )}
        {queuedCount > 0 && (
          <button
            onClick={() => syncNow()}
            title={`กดเพื่อ sync ${queuedCount} รายการทันที`}
            className="px-2 py-1 rounded bg-blue-900/50 border border-blue-700 text-blue-300 text-xs hover:bg-blue-800 transition-colors"
          >
            📥 {queuedCount} รอ sync
          </button>
        )}
        <span className="text-gray-400">{user?.role} | {user?.username || user?.id}</span>
        <button
          onClick={() => {
            // logout เอง — ล้าง session แล้วไปหน้า login ตรง ๆ ไม่ต้องรอ 401
            logout();
            window.location.href = '/';
          }}
          className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-red-400 transition-colors"
        >
          LOGOUT
        </button>
      </div>
    </header>
  );
}

