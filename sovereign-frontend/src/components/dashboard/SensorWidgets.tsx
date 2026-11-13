// components/dashboard/SensorWidgets.tsx — ชุดแสดงเซ็นเซอร์บนหน้า Dashboard (ย้ายจาก pages/dashboard.tsx)
// (IDEA-011: ย้ายเพื่อลดขนาดหน้า — พฤติกรรมเหมือนเดิมทุกอย่าง)
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { api } from '../../lib/apiClient';

export const trendCache = new Map<string, { time: number; value: number }[]>();

export const TREND_RANGES = [
  { key: '24h', label: '24 ชม' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
] as const;
export type TrendRange = (typeof TREND_RANGES)[number]['key'];

const TREND_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a78bfa', '#22d3ee', '#f472b6'];
export function trendColor(metric: string): string {
  let h = 0;
  for (let i = 0; i < metric.length; i++) h = (h * 31 + metric.charCodeAt(i)) >>> 0;
  return TREND_COLORS[h % TREND_COLORS.length];
}

export function SensorCategory({ title, sensors, trendRange }: { title: string; sensors: [string, number][]; trendRange: TrendRange }) {
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

export function formatLabel(metric: string): string {
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

export function SensorCard({ label, value, metric, trendRange }: { label: string; value: number; metric: string; trendRange: TrendRange }) {
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
      .catch(() => {
        if (cancelled) return;
        // IDEA-013: อ่านประวัติไม่ได้ = แสดง "—" (sparkline ชุดว่าง) ไม่ใช่จุดโหลดค้างตลอด
        setTrend([]);
      });
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

export function TrendSparkline({ points, color = '#10b981' }: { points: { time: number; value: number }[] | null; color?: string }) {
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

export function getColor(metric: string, value: number): string {
  if (metric === 'battery_soc' && value < 20) return 'text-red-400';
  if (metric === 'ec_value' && value > 4) return 'text-red-400';
  if (metric === 'temperature' && value > 40) return 'text-red-400';
  return 'text-white';
}
