"use client";
// ── กราฟ SVG ของหน้า knowledge (ย้ายมาจาก src/pages/knowledge.tsx — verbatim) ──
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
import { fmtDate } from './knowledge-types';

// ── กราฟคะแนนตามเวลา (SVG — วาดเอง ไม่พึ่ง library) ──
export const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a78bfa', '#22d3ee', '#f472b6'];

export function kidColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}

export interface ScoreSeries {
  name: string;
  color: string;
  points: { time: number; pct: number; label: string }[];
}

export function ScoreTrendChart({ series }: { series: ScoreSeries[] }) {
  const t = useLanguageStore((s) => s.t);
  const W = 560;
  const H = 230;
  const PAD = { top: 16, right: 14, bottom: 32, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const Y_MAX = 100;

  if (series.length === 0) return null;

  const allTimes = series.flatMap((s) => s.points.map((p) => p.time));
  let tMin = Math.min(...allTimes);
  let tMax = Math.max(...allTimes);
  if (tMax === tMin) {
    tMin -= 86400000;
    tMax += 86400000;
  }
  const tSpan = tMax - tMin;
  const x = (t: number) => PAD.left + ((t - tMin) / tSpan) * innerW;
  const y = (pct: number) => PAD.top + ((Y_MAX - pct) / Y_MAX) * innerH;

  // ป้ายเวลาแกน X — แบ่งเป็น 4-5 จุด
  const xTicks = Array.from({ length: 5 }, (_, i) => tMin + (tSpan * i) / 4);
  const fmtTick = (t: number) =>
    new Date(t).toLocaleDateString(fmtLocale(), { day: '2-digit', month: '2-digit' });

  return (
    <div className="bg-gray-950/50 border border-cyan-800/50 rounded-lg p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('knowledge.progress.chartLabel', 'กราฟคะแนนแบบทดสอบตามเวลา')}>
        {/* เส้นตารางแนวนอน 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#1f2937" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#6b7280">{v}%</text>
          </g>
        ))}
        {/* แกน X */}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize="9" fill="#6b7280">
            {fmtTick(t)}
          </text>
        ))}
        {/* เส้นของแต่ละคน */}
        {series.map((s) => (
          <g key={s.name}>
            {s.points.length === 1 ? (
              <circle cx={x(s.points[0].time)} cy={y(s.points[0].pct)} r="4" fill={s.color} />
            ) : (
              <polyline
                points={s.points.map((p) => `${x(p.time)},${y(p.pct)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}
            {s.points.map((p, i) => (
              <circle key={i} cx={x(p.time)} cy={y(p.pct)} r="3" fill="#0b0f19" stroke={s.color} strokeWidth="1.5">
                <title>{`${s.name} — ${p.label}: ${p.pct}% (${fmtDate(new Date(p.time).toISOString())})`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {/* ตำนาน */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />
            {s.name} <span className="text-gray-600">({t('knowledge.progress.chartCount', '{n} ครั้ง', { n: s.points.length })})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── กราฟมูลค่าพอร์ตหุ้นย้อนหลัง (SVG วาดเอง — ไม่พึ่ง library) ──
export function PortfolioHistoryChart({ data }: { data: { date: string; value: number }[] }) {
  const t = useLanguageStore((s) => s.t);
  const W = 560;
  const H = 180;
  const PAD = { top: 16, right: 14, bottom: 30, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (data.length < 2) return null;
  const values = data.map((d) => d.value);
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  if (vMax === vMin) {
    vMin -= 1;
    vMax += 1;
  }
  const span = vMax - vMin;
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + ((vMax - v) / span) * innerH;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const first = data[0];
  const last = data[data.length - 1];
  const pct = first.value > 0 ? Math.round(((last.value - first.value) / first.value) * 100) : 0;
  const up = last.value >= first.value;
  const fmt = (d: string) => d.slice(5).replace('-', '/');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">{t('knowledge.progress.portfolioHistoryLabel', 'มูลค่าพอร์ตย้อนหลัง ({n} วัน)', { n: data.length })}</span>
        <span className={up ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
          {up ? '+' : ''}{pct}% · {last.value.toLocaleString()}฿
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* gridlines */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * innerH} y2={PAD.top + f * innerH} stroke="#1f2937" strokeWidth="1" />
        ))}
        <text x={4} y={PAD.top + 4} fill="#6b7280" fontSize="9">{vMax.toFixed(0)}฿</text>
        <text x={4} y={PAD.top + innerH / 2 + 3} fill="#6b7280" fontSize="9">{((vMax + vMin) / 2).toFixed(0)}฿</text>
        <text x={4} y={H - PAD.bottom + 4} fill="#6b7280" fontSize="9">{vMin.toFixed(0)}฿</text>
        <polyline points={pts} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r="2.5" fill={up ? '#34d399' : '#f87171'}>
            <title>{`${d.date} · ${d.value.toLocaleString()}฿`}</title>
          </circle>
        ))}
        <text x={PAD.left} y={H - 8} fill="#4b5563" fontSize="9">{fmt(first.date)}</text>
        <text x={W - PAD.right - 30} y={H - 8} fill="#4b5563" fontSize="9">{fmt(last.date)}</text>
      </svg>
    </div>
  );
}
