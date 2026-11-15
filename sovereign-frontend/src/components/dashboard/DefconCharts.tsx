// components/dashboard/DefconCharts.tsx — ชุดกราฟ DEFCON/Threat ของหน้า Dashboard
//
// ย้ายจาก pages/dashboard.tsx (IDEA-011):
//   - HorizontalDefconBar / CategoryBars ย้ายมาตามเดิม (ไม่แก้พฤติกรรม)
//   - ThreatHistoryGraph เขียนใหม่: เดิมวาดคลื่นจาก Math.sin/Math.cos + spike แล้วติดป้าย
//     ช่วงปีปลอม (ดูเหมือนประวัติศาสตร์แต่ไม่มีที่มาจริง) — ตอนนี้ดึง series จริงจาก
//     GET /api/risk-monitor/history (ตาราง threat_index) และแสดงสถานะจริง:
//     อ่านไม่ได้ = บอกว่าอ่านไม่ได้ / ยังไม่มีข้อมูล = บอกตามจริง (ห้ามแต่งคลื่นแทน)
import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { api } from '../../lib/apiClient';
import { fmtLocale } from '../../lib/formatDate';

export function HorizontalDefconBar({ overall }: { overall: number | null }) {
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

export interface ThreatHistoryRow {
  timestamp: string | Date;
  overall: number;
}

export function ThreatHistoryGraph() {
  const [rows, setRows] = useState<ThreatHistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getArray<ThreatHistoryRow>('/api/risk-monitor/history', { limit: 90 })
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = (rows ?? [])
    .map((r) => ({ t: new Date(r.timestamp).getTime(), v: Number(r.overall) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (failed) {
    return (
      <div className="h-[62px] flex items-center justify-center">
        <span className="text-[9px] tracking-widest font-mono text-amber-300">อ่านประวัติ threat index ไม่ได้ (API ตอบผิดปกติ)</span>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="h-[62px] flex items-center justify-center">
        <span className="text-[9px] tracking-widest font-mono text-gray-500 animate-pulse">กำลังโหลดประวัติ…</span>
      </div>
    );
  }
  if (series.length === 0) {
    return (
      <div className="h-[62px] flex items-center justify-center">
        <span className="text-[9px] tracking-widest font-mono text-gray-500">ยังไม่มีข้อมูล threat index — รอบันทึกแรกจาก risk worker</span>
      </div>
    );
  }

  const points = series.slice(-120);
  const W = 320; const H = 62; const pad = 4;
  // มาตราส่วนคงที่ 0—100 (สเกลเดียวกับ DEFCON) — เส้นปรอง = เกณฑ์ D3/D2/D1 จริง
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2);
  const step = (W - pad * 2) / Math.max(1, points.length - 1);
  let path = '';
  let area = '';
  points.forEach((p, i) => {
    const x = pad + i * step;
    const yy = y(p.v);
    if (i === 0) { path += `M ${x} ${yy}`; area += `M ${x} ${H - pad} L ${x} ${yy}`; }
    else { path += ` L ${x} ${yy}`; area += ` L ${x} ${yy}`; }
  });
  area += ` L ${pad + (points.length - 1) * step} ${H - pad} Z`;
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString(fmtLocale(), { day: '2-digit', month: 'short' });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[62px]">
      <defs>
        <linearGradient id="threatFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[50, 75, 90].map((v) => (<line key={v} x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="0.7" strokeDasharray="2 3" />))}
      <path d={area} fill="url(#threatFill)" />
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeLinejoin="round" />
      {points.map((p, i) => (i % 7 === 0 || i === points.length - 1) ? <circle key={i} cx={pad + i * step} cy={y(p.v)} r="1.6" fill="#f59e0b" opacity={0.9} /> : null)}
      <text x={pad} y={H - 2} fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">{fmt(points[0].t)}</text>
      <text x={W / 2} y={H - 2} textAnchor="middle" fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">{fmt(points[Math.floor((points.length - 1) / 2)].t)}</text>
      <text x={W - pad} y={H - 2} textAnchor="end" fill="#475569" fontSize="6.5" fontFamily="JetBrains Mono">{fmt(points[points.length - 1].t)}</text>
    </svg>
  );
}

export function CategoryBars({ categories }: { categories: Record<string, number> }) {
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
