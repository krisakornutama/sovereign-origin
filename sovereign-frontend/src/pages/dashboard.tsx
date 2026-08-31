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
import VoiceCommand from '../components/dashboard/VoiceCommand';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import StatCard from '../components/ui/StatCard';
import SectionCard from '../components/ui/SectionCard';
import EmptyState from '../components/ui/EmptyState';
import { authFetch } from '../lib/apiFetch';
import { api } from '../lib/apiClient';
import { useFeatureStore } from '../stores/useFeatureStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import Sidebar from '../components/layout/Sidebar';
import { useRiskStore } from '../stores/useRiskStore';
import { useWealthStore } from '../stores/useWealthStore';

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

function WidgetShell({
  title,
  editMode,
  hidden,
  onHide,
  dragHandle,
  onDragStart,
  onDragOver,
  onDrop,
  children,
  className = '',
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
      className={`${className} ${dragHandle ? 'cursor-grab active:cursor-grabbing' : ''} ${editMode ? 'ring-1 ring-emerald-500/20 rounded-2xl' : ''}`}
      draggable={dragHandle}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.();
      }}
      onDrop={onDrop}
    >
      {editMode && (
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[10px] tracking-widest text-emerald-300/60 font-mono flex items-center gap-1.5"><Icon name="drag" size={10} /> {title}</span>
          <button onClick={onHide} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 text-[10px]">
            <Icon name={hidden ? 'eye' : 'eye-off'} size={10} />
            {hidden ? t('common.show', 'แสดง') : t('common.hide', 'ซ่อน')}
          </button>
        </div>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : undefined}>{children}</div>
    </div>
  );
}

// ── inline SVG helpers for dense look ──

function GaugeCircle({ value, label, sub, color = '#10b981', size = 64 }: { value: number; label: string; sub?: string; color?: string; size?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 28;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 64 64" className="rotate-[-90deg]">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle
            cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`} style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="mono text-[11px] font-bold tracking-tight" style={{ color }}>{pct.toFixed(0)}%</span>
          <span className="text-[8px] tracking-widest text-gray-500 font-mono -mt-0.5">{label}</span>
        </div>
      </div>
      {sub && <span className="text-[9px] text-gray-500 font-mono tracking-wide">{sub}</span>}
    </div>
  );
}

function HorizontalDefconBar({ overall }: { overall: number | null }) {
  const v = overall ?? 0;
  const color = v > 75 ? '#ef4444' : v > 50 ? '#f59e0b' : '#10b981';
  return (
    <div className="relative">
      <div className="h-[9px] bg-gray-800 rounded-full overflow-hidden border border-gray-700/60 flex">
        <div className="h-full transition-all duration-700" style={{ width: `${Math.min(100, v)}%`, background: color, boxShadow: `0 0 10px ${color}66` }} />
        <div className="flex-1" />
      </div>
      <div className="flex justify-between text-[8px] font-mono tracking-widest text-gray-600 mt-1">
        <span>0</span><span>50 → D3</span><span>75 → D2</span><span>90 → D1</span><span>100</span>
      </div>
      <div className="absolute top-[3px] left-0 right-0 flex justify-between px-0 pointer-events-none">
        {[50, 75, 90].map((p) => (<span key={p} className="w-px h-[3px] bg-gray-600" style={{ marginLeft: `${p}%`, position: 'absolute', left: 0, transform: `translateX(${p}% )` }} />))}
      </div>
    </div>
  );
}

function ThreatHistoryGraph({ overall }: { overall: number | null }) {
  const points = 42;
  const base = overall ?? 35;
  const data: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    // mock historical wavy 1930-2040 with spike at 2020s
    const wave = Math.sin(t * Math.PI * 6) * 8 + Math.cos(t * Math.PI * 2.7) * 6;
    const spike = Math.exp(-Math.pow((t - 0.82) * 6, 2)) * 35;
    const lvl = 22 + wave + spike + (base - 40) * 0.3 + t * 10;
    data.push(Math.max(5, Math.min(96, lvl)));
  }
  const W = 320; const H = 62; const pad = 4;
  const step = (W - pad * 2) / (points - 1);
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2);
  let path = '';
  let area = '';
  data.forEach((v, i) => {
    const x = pad + i * step;
    const yy = y(v);
    if (i === 0) { path += `M ${x} ${yy}`; area += `M ${x} ${H - pad} L ${x} ${yy}`; }
    else { path += ` L ${x} ${yy}`; area += ` L ${x} ${yy}`; }
  });
  area += ` L ${pad + (points - 1) * step} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[62px]">
      <defs>
        <linearGradient id="threatFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((v) => (<line key={v} x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="0.7" strokeDasharray="2 3" />))}
      <path d={area} fill="url(#threatFill)" />
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeLinejoin="round" />
      {data.map((v, i) => i % 7 === 0 ? <circle key={i} cx={pad + i * step} cy={y(v)} r="1.6" fill="#f59e0b" opacity={0.9} /> : null)}
      <text x={pad} y={H - 2} fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">1930</text>
      <text x={W / 2} y={H - 2} textAnchor="middle" fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">1985</text>
      <text x={W - pad} y={H - 2} textAnchor="end" fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">2040</text>
    </svg>
  );
}

function CategoryBars({ categories }: { categories: Record<string, number> }) {
  const items: Array<{ key: string; label: string; icon: string }> = [
    { key: 'war', label: 'สงคราม', icon: 'shield' },
    { key: 'banking', label: 'ธนาคาร', icon: 'portfolio' },
    { key: 'energy', label: 'พลังงาน', icon: 'energy' },
    { key: 'inflation', label: 'เงินเฟ้อ', icon: 'coin' },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((it) => {
        const v = categories[it.key] ?? 0;
        const c = v > 75 ? '#ef4444' : v > 50 ? '#f59e0b' : '#10b981';
        return (
          <div key={it.key} className="bg-gray-800/40 border border-gray-700/50 rounded-lg px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] tracking-widest text-gray-500 font-mono flex items-center gap-1"><Icon name={it.icon} size={10} className="opacity-60" /> {it.label}</span>
              <span className="mono text-[10px] font-bold" style={{ color: c }}>{v}</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden mt-1">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, v)}%`, background: c }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RadarPentagon({ metrics }: { metrics: Record<string, number> }) {
  // 5 axes: temp, humidity, battery, water, power
  const raw: Record<string, number> = {
    temp: metrics.temperature ?? 28,
    humidity: metrics.humidity ?? 60,
    battery: metrics.battery_soc ?? 70,
    water: metrics.water_level_cm ?? 45,
    power: (metrics.power_kw ?? 1.2) * 40,
  };
  const keys = ['temp', 'humidity', 'battery', 'water', 'power'] as const;
  const labels: Record<string, string> = { temp: 'TEMP', humidity: 'HUM', battery: 'BAT', water: 'WTR', power: 'PWR' };
  // normalize 0-100
  const norm = (k: typeof keys[number], v: number) => {
    if (k === 'temp') return Math.max(0, Math.min(100, (v / 50) * 100));
    if (k === 'humidity') return Math.max(0, Math.min(100, v));
    if (k === 'battery') return Math.max(0, Math.min(100, v));
    if (k === 'water') return Math.max(0, Math.min(100, v));
    if (k === 'power') return Math.max(0, Math.min(100, v));
    return v;
  };
  const vals = keys.map((k) => norm(k, raw[k]));
  const W = 140, H = 140, cx = 70, cy = 70, R = 52;
  const angle = (i: number) => (-90 + i * 72) * Math.PI / 180;
  const pt = (i: number, r: number) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r] as const;
  const polygonPoints = (rs: number[]) => rs.map((r, i) => pt(i, (r / 100) * R).join(',')).join(' ');
  return (
    <div className="flex flex-col items-center">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((s) => (
          <polygon key={s} points={polygonPoints([s * 100, s * 100, s * 100, s * 100, s * 100])} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" />
        ))}
        {keys.map((_, i) => {
          const [x, y] = pt(i, R);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth="0.7" />;
        })}
        <polygon points={polygonPoints(vals)} fill="rgba(52,211,153,0.18)" stroke="#34d399" strokeWidth="1.4" />
        {vals.map((v, i) => {
          const [x, y] = pt(i, (v / 100) * R);
          return <circle key={i} cx={x} cy={y} r="2.2" fill="#34d399" stroke="#0b0f16" strokeWidth="0.8" />;
        })}
      </svg>
      <div className="flex gap-2 mt-1 flex-wrap justify-center">
        {keys.map((k, i) => (
          <span key={k} className="text-[7px] tracking-widest font-mono text-gray-500">{labels[k]} <b className="text-gray-300">{vals[i].toFixed(0)}</b></span>
        ))}
      </div>
    </div>
  );
}

function SankeyAlluvial({ wealth, inventory, farm }: { wealth: any; inventory: any; farm: any }) {
  // Left sources -> Center -> Right sinks
  const sources = [
    { label: 'Portfolio', val: wealth?.portfolioUsd ?? 42000, color: '#10b981' },
    { label: 'Inventory', val: wealth?.inventoryUsd ?? 8000, color: '#22d3ee' },
    { label: 'Cash', val: wealth?.cashUsd ?? 5000, color: '#a78bfa' },
  ];
  const total = sources.reduce((a, b) => a + b.val, 0) || 1;
  const runway = wealth?.runway?.months ?? 6.2;
  const growing = farm?.growing ?? 3;
  const W = 320, H = 88;
  const leftX = 8, midX = 150, rightX = 312;
  // vertical layout
  let yOff = 10;
  const hScale = 58;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[88px]">
      {/* labels */}
      <text x={leftX} y={7} fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">SOURCE</text>
      <text x={midX} y={7} textAnchor="middle" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">SOVEREIGN HUB</text>
      <text x={rightX} y={7} textAnchor="end" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">RUNWAY {runway.toFixed(1)}M</text>
      {sources.map((s, i) => {
        const h = Math.max(8, (s.val / total) * hScale);
        const y = yOff;
        yOff += h + 4;
        const midY = 22 + (h / 2) - 10;
        // bezier band to center
        const midTop = 18 + i * 14;
        const midBot = midTop + 10;
        const d = `M ${leftX + 56} ${y + 2} C ${midX - 48} ${y + 2}, ${midX - 28} ${midTop}, ${midX - 18} ${midTop} L ${midX - 18} ${midBot} C ${midX - 28} ${midBot}, ${midX - 48} ${y + h - 2}, ${leftX + 56} ${y + h - 2} Z`;
        return (
          <g key={s.label}>
            <rect x={leftX} y={y} width={56} height={h} rx={3} fill={s.color} opacity={0.92} />
            <text x={leftX + 4} y={y + h / 2 + 2.5} fill="#0b0f16" fontSize="6.5" fontWeight="700" fontFamily="JetBrains Mono">{s.label}</text>
            <path d={d} fill={s.color} opacity={0.28} />
            {/* right side outflow */}
            <path
              d={`M ${midX + 22} ${midTop + 2} C ${midX + 52} ${midTop + 2}, ${rightX - 52} ${18 + (i % 2) * 26}, ${rightX - 54} ${18 + (i % 2) * 26} L ${rightX - 54} ${22 + (i % 2) * 26} C ${rightX - 52} ${22 + (i % 2) * 26}, ${midX + 52} ${midBot - 2}, ${midX + 22} ${midBot - 2} Z`}
              fill={s.color} opacity={0.18}
            />
          </g>
        );
      })}
      {/* center hub */}
      <rect x={midX - 18} y={18} width={44} height={48} rx={6} fill="rgba(52,211,153,0.12)" stroke="rgba(52,211,153,0.35)" strokeWidth="0.9" />
      <text x={midX} y={34} textAnchor="middle" fill="#34d399" fontSize="6" fontFamily="JetBrains Mono" fontWeight="700">HUB</text>
      <text x={midX} y={42} textAnchor="middle" fill="#9ca3af" fontSize="6" fontFamily="JetBrains Mono">{growing} PLOTS</text>
      <text x={midX} y={50} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">{inventory ? `${inventory.items} ITEMS` : 'STOCK'}</text>
      {/* right sink */}
      <rect x={rightX - 54} y={14} width={54} height={22} rx={4} fill="rgba(245,158,11,0.14)" stroke="rgba(245,158,11,0.4)" strokeWidth="0.8" />
      <text x={rightX - 27} y={24} textAnchor="middle" fill="#f59e0b" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">SURVIVAL</text>
      <text x={rightX - 27} y={30} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">{runway > 6 ? 'STABLE' : 'LOW'}</text>
      <rect x={rightX - 54} y={44} width={54} height={22} rx={4} fill="rgba(239,68,68,0.10)" stroke="rgba(239,68,68,0.35)" strokeWidth="0.8" />
      <text x={rightX - 27} y={54} textAnchor="middle" fill="#f87171" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">RESERVE</text>
      <text x={rightX - 27} y={60} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">BURN ${(wealth?.runway?.monthlyBurnUsd ?? 850).toLocaleString()}</text>
    </svg>
  );
}

function PerfGauges({ metrics, deviceStatus }: { metrics: Record<string, number>; deviceStatus: any }) {
  const gauges = [
    { label: 'CPU', val: 38 + ((metrics.temperature ?? 30) % 20), color: '#22d3ee' },
    { label: 'MEM', val: 56 + ((metrics.humidity ?? 50) % 16), color: '#a78bfa' },
    { label: 'NET', val: deviceStatus.total ? (deviceStatus.online / Math.max(1, deviceStatus.total)) * 100 : 72, color: '#34d399' },
    { label: 'PWR', val: metrics.battery_soc != null ? metrics.battery_soc : 64, color: metrics.battery_soc != null && metrics.battery_soc < 20 ? '#ef4444' : '#10b981' },
    { label: 'HUM', val: metrics.humidity ?? 58, color: '#38bdf8' },
    { label: 'TMP', val: metrics.temperature ? Math.min(100, (metrics.temperature / 45) * 100) : 62, color: metrics.temperature != null && metrics.temperature > 40 ? '#ef4444' : '#f59e0b' },
    { label: 'WTR', val: metrics.water_level_cm != null ? Math.min(100, metrics.water_level_cm) : 44, color: '#22d3ee' },
    { label: 'SOL', val: metrics.solar_radiation ? Math.min(100, metrics.solar_radiation / 12) : 31, color: '#facc15' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {gauges.map((g) => (
        <div key={g.label} className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-2 flex flex-col items-center">
          <GaugeCircle value={g.val} label={g.label} color={g.color} size={54} />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
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
    if (isHydrated && isAuthenticated && user && user.role !== 'SUPERADMIN') loadFeatures();
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
      api.getObject<any>('/api/dashboard/stats').then((data:any)=>{ setMetrics(data.metrics||{}); api.post('/api/automation/check',{metrics:data.metrics||{}}).catch(()=>{}); }).catch(()=>{});
      api.getObject<any>('/api/devices/status').then((data:any)=> setDeviceStatus(data)).catch(()=>{});
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
    } else uncategorized.push([metric, value]);
  }

  const overall = threat?.overall ?? null;
  const defconLabel = defconLevel === 1 ? 'DEFCON 1 · CRITICAL' : defconLevel === 2 ? 'DEFCON 2 · SEVERE' : defconLevel === 3 ? 'DEFCON 3 · ELEVATED' : 'DEFCON 5 · NORMAL';
  const defconColor = defconLevel === 1 ? 'text-rose-400 border-rose-500/40 bg-rose-950/30' : defconLevel === 2 ? 'text-orange-400 border-orange-500/40 bg-orange-950/30' : defconLevel === 3 ? 'text-amber-400 border-amber-500/40 bg-amber-950/30' : 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20';
  const neonPct = 56;
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
    if (k === 'map') return user.role === 'SUPERADMIN';
    const feat = FEATURE_BY_WIDGET[k];
    if (feat && user.role !== 'SUPERADMIN' && !hasFeature(feat)) return false;
    return true;
  };
  const visibleOrder = order.filter((k) => isVisibleForUser(k) && (editMode || !hidden[k]));

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
              <Link href="/risk-monitor" scroll={false} className="text-[10px] text-sky-400 hover:underline">รายละเอียด →</Link>
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
                <span className="text-[9px] tracking-widest font-mono text-gray-500">HISTORICAL · STRESS INDEX 1930—2040</span>
                <span className="text-[8px] mono text-amber-300 border border-amber-500/30 px-1 rounded bg-amber-950/30">NOW {overall ?? '—'}</span>
              </div>
              <ThreatHistoryGraph overall={overall} />
            </div>

            <div className="mt-2.5">
              <div className="eyebrow-cyan !text-[9px] mb-1.5">Threat Category Module</div>
              <CategoryBars categories={threat?.categories || {}} />
            </div>

            {threat?.summary && <div className="text-[10px] leading-relaxed text-gray-500 mt-2 line-clamp-2 border-t border-gray-800 pt-2">{threat.summary}</div>}
            {overall == null && <div className="text-[10px] text-gray-500 mt-2">ยังไม่มีข้อมูล — เปิด <code className="text-gray-400">RISK_MONITOR_ENABLED=true</code></div>}

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
                  <div className="text-[9px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1 mt-2">{'ยังไม่มีราคา: ' + s.missingPrices.join(', ')}</div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-1"><SankeyAlluvial wealth={null} inventory={inventoryStatus} farm={farmOverview} /></div>
                <div className="text-[10px] text-gray-500">ยังไม่มีข้อมูล — เปิด <code>PORTFOLIO_ENABLED=true</code></div>
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
              <span className="text-[9px] font-mono tracking-widest text-gray-500">{deviceStatus.total} NODES · {deviceStatus.online} ONLINE</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-gray-700/60 bg-[#0b1220] relative h-[240px]">
              <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(520px 220px at 20% 28%, rgba(239,68,68,0.22), transparent 55%), radial-gradient(420px 220px at 70% 60%, rgba(245,158,11,0.20), transparent 60%), radial-gradient(380px 180px at 85% 20%, rgba(52,211,153,0.10), transparent 60%)' }} />
              <GlobalMap />
              <div className="absolute bottom-1 left-1 right-1 flex justify-between text-[8px] font-mono tracking-widest text-gray-500 px-1">
                <span>LAT -90 → 90</span><span className="text-cyan-400/70">LIVE TELEMETRY</span><span>LNG -180 → 180</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              <div className="bg-rose-950/20 border border-rose-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-rose-400">CRITICAL</div><div className="mono text-[11px] font-bold text-rose-300">{deviceStatus.offline}</div></div>
              <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-amber-400">ELEVATED</div><div className="mono text-[11px] font-bold text-amber-300">{Math.max(0, deviceStatus.total - deviceStatus.online - deviceStatus.offline)}</div></div>
              <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-2 py-1 text-center"><div className="text-[9px] font-mono tracking-widest text-emerald-400">STABLE</div><div className="mono text-[11px] font-bold text-emerald-300">{deviceStatus.online}</div></div>
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
              <StatCard label="อุปกรณ์ทั้งหมด" value={deviceStatus.total} icon={<Icon name="grid" size={10} />} />
              <StatCard label="ออนไลน์" value={<span className="text-emerald-400">{deviceStatus.online}</span>} icon={<Icon name="check" size={10} className="text-emerald-400" />} />
              <StatCard label="ออฟไลน์" value={<span className="text-rose-400">{deviceStatus.offline}</span>} icon={<Icon name="alert-triangle" size={10} className="text-rose-400" />} />
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
                  value={(stat as any).isBoolean ? <span className={(stat as any).tone}>{stat.value === 1 ? (stat as any).trueLabel : (stat as any).falseLabel}</span> : <span className={stat.tone}>{stat.value != null ? stat.value.toFixed(1) + stat.unit : 'N/A'}</span>}
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
                    <div>→ risk delta {overall != null ? `${overall}` : '—'}/100 · defcon {defconLevel || 5} · nodes {deviceStatus.online}/{deviceStatus.total}</div>
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
                <div className="flex gap-2 text-gray-500"><span className="text-emerald-400">[08:14:03]</span> telemetry heartbeat · node {deviceStatus.devices[0]?.node ?? '—'} online</div>
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
              <Link href="/knowledge" scroll={false} className="flex items-center gap-1 text-[10px] text-sky-400 hover:underline">เปิดคลังความรู้ <Icon name="arrow-right" size={10} /></Link>
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
                          <div className="mt-1.5 text-[9px] text-gray-600 border-t border-gray-700/50 pt-1.5">ยังไม่เคยทำแบบทดสอบ</div>
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
        return (
          <div className="flex flex-wrap gap-2 py-1">
            <Link href="/sensors" scroll={false} className="btn-primary text-xs px-3 py-1.5">จัดการอุปกรณ์และเซ็นเซอร์</Link>
            <button onClick={() => window.location.reload()} className="btn-secondary text-xs px-3 py-1.5">รีเฟรชข้อมูล</button>
            <Link href="/treasury" scroll={false} className="btn-secondary text-xs px-3 py-1.5">คลัง & พอร์ต</Link>
            <Link href="/risk-monitor" scroll={false} className="btn-secondary text-xs px-3 py-1.5">เฝ้าระวังความเสี่ยง</Link>
          </div>
        );
      }
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header queuedCount={queuedCount} isOnline={isOnline} syncNow={syncNow} neonPct={neonPct} />
      <main className="flex">
        <Sidebar />
        <div className="flex-1 min-w-0 p-3 lg:p-4 overflow-y-auto">
          {/* Command bar — dense replacement for PageHeader */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-px bg-gradient-to-r from-emerald-500/60 to-transparent" />
                <span className="eyebrow !text-[9px] tracking-[0.22em]">SOVEREIGN OS · COMMAND CENTER</span>
                <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[8px] font-bold tracking-widest text-emerald-300">NEON {neonPct}%</span>
              </div>
              <h1 className="text-[18px] md:text-[20px] font-bold tracking-tight flex items-center gap-2 leading-none">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.14)]"><Icon name="dashboard" size={14} /></span>
                <span className="glow-text">Dashboard</span>
                <span className="hidden sm:inline text-[10px] font-normal tracking-widest text-gray-500 ml-1">· DENSE · {deviceStatus.online}/{deviceStatus.total} ONLINE · THREAT {overall ?? '—'}</span>
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

          {/* Dense 12-col command grid */}
          <div className="grid grid-cols-12 gap-2.5 auto-rows-min">
            {/* Top ticker strip — dense mono */}
            <div className="col-span-12 bg-gray-900/60 border border-gray-800 rounded-xl px-2.5 py-1.5 flex flex-wrap gap-2 items-center text-[10px] font-mono backdrop-blur">
              <span className="flex items-center gap-1.5 text-gray-400"><Icon name="cpu" size={11} className="text-emerald-400" /> {deviceStatus.total} DEVICES</span>
              <span className="w-px h-3 bg-gray-700" />
              <span className="text-emerald-400">● {deviceStatus.online} ONLINE</span>
              <span className="text-rose-400">● {deviceStatus.offline} OFFLINE</span>
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

            {visibleOrder.map((key, i) => (
              <WidgetShell
                key={key}
                className={DENSE_SPAN[key] ?? 'col-span-12'}
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

function SensorCategory({ title, sensors, trendRange }: { title: string; sensors: [string, number][]; trendRange: TrendRange }) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="bg-gray-800/20 border border-gray-700/30 rounded-xl p-2.5">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-[10px] font-bold tracking-widest text-gray-300">{title}</h3>
        <Link href={`/sensors?tab=data&filter=${encodeURIComponent(sensors[0]?.[0] ?? '')}`} scroll={false} className="text-[10px] text-sky-400 hover:underline">จัดการ</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
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
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${metric}:${trendRange}`;
    const cached = trendCache.get(cacheKey);
    if (cached) { setTrend(cached); return; }
    api.getArray<any>(`/api/timescale/history`,{metric,range:trendRange} as any)
      .then((result: any[]) => {
        if (cancelled) return;
        const points = result.map((r: any) => ({ time: new Date(r.bucket).getTime(), value: r.avg_value }));
        trendCache.set(cacheKey, points);
        setTrend(points);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [metric, trendRange]);
  return (
    <div className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-2.5 hover:border-emerald-700/40 hover:shadow-[0_0_14px_rgba(52,211,153,0.08)] transition-all duration-200 group">
      <div className="text-[9px] tracking-widest font-mono text-gray-500 mb-1 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-emerald-500/60 group-hover:bg-emerald-400" />{t(`dashboard.metric.${metric}`, label)}</div>
      <div className={`mono text-[15px] font-bold ${color} tracking-tight leading-none`}>{value != null ? value.toFixed(1) + unit : t('dashboard.na', 'N/A')}</div>
      {isPercentage && (
        <div className="w-full bg-gray-800 h-1 rounded-full mt-1.5 overflow-hidden">
          <div className="h-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700" style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
      <Link href={`/history?metric=${encodeURIComponent(metric)}&range=${trendRange}`} scroll={false} className="block mt-1.5 group/link" title={trendRange === '24h' ? t('dashboard.sensors.fullChart24h', 'ดูกราฟเต็ม 24 ชม. ในหน้า History') : trendRange === '7d' ? t('dashboard.sensors.fullChart7d', 'ดูกราฟเต็ม 7 วัน ในหน้า History') : t('dashboard.sensors.fullChart30d', 'ดูกราฟเต็ม 30 วัน ในหน้า History')}>
        <TrendSparkline points={trend} color={trendColor(metric)} />
        <div className="text-[9px] font-mono tracking-widest text-gray-600 group-hover/link:text-gray-400 mt-0.5">{t('dashboard.sensors.trendHint', '24h trend →')}</div>
      </Link>
    </div>
  );
}

function TrendSparkline({ points, color = '#10b981' }: { points: { time: number; value: number }[] | null; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = 32;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
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
    const pad = 2;
    const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
    ctx.beginPath();
    points.forEach((p, i) => {
      const xi = x(i);
      if (i === 0) ctx.moveTo(xi, h - pad);
      ctx.lineTo(xi, y(p.value));
    });
    ctx.lineTo(x(points.length - 1), h - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    points.forEach((p, i) => {
      const xi = x(i);
      if (i === 0) ctx.moveTo(xi, y(p.value));
      else ctx.lineTo(xi, y(p.value));
    });
    ctx.stroke();
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(last.value), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [points, color]);
  return <canvas ref={ref} className="w-full h-8" />;
}

function getColor(metric: string, value: number): string {
  if (metric === 'battery_soc' && value < 20) return 'text-red-400';
  if (metric === 'ec_value' && value > 4) return 'text-red-400';
  if (metric === 'temperature' && value > 40) return 'text-red-400';
  return 'text-white';
}

function Header({ queuedCount, isOnline, syncNow, neonPct }: { queuedCount: number; isOnline: boolean; syncNow: () => Promise<number>; neonPct: number }) {
  const { user, logout } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  return (
    <header className="bg-gray-900/80 border-b border-gray-800 px-4 lg:px-6 py-2.5 flex justify-between items-center backdrop-blur-md sticky top-0 z-20">
      <h1 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
        <Icon name="shield" size={15} className="text-emerald-400 glow-text" />
        SOVEREIGN OS <span className="text-[11px] text-gray-500 font-normal tracking-widest">Command Center</span>
        <span className="hidden md:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] tracking-widest font-mono text-emerald-300">NEON {neonPct}%</span>
      </h1>
      <div className="flex items-center gap-2 text-sm">
        {!isOnline && <span className="px-2 py-1 rounded bg-amber-950/50 border border-amber-800/60 text-amber-300 text-xs">{t('common.onlineBadge')}</span>}
        {queuedCount > 0 && (
          <button onClick={() => syncNow()} title={t('common.pendingSync', 'กดเพื่อ sync ทันที', { n: queuedCount })} className="flex items-center gap-1 px-2 py-1 rounded bg-sky-950/50 border border-sky-800/60 text-sky-300 text-xs hover:bg-sky-900/60 transition-colors">
            <Icon name="refresh" size={11} />
            {t('common.pendingSync', '{n} รายการรอ sync', { n: queuedCount })}
          </button>
        )}
        <span className="mono text-[11px] text-gray-500 hidden sm:inline">{user?.role} | {(user?.id || user?.username || '').toString().slice(0, 8) || '—'}</span>
        <button
          onClick={() => { logout(); window.location.href = '/'; }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-300 transition-colors text-xs"
        >
          <Icon name="logout" size={12} />
          {t('common.logout')}
        </button>
      </div>
    </header>
  );
}
