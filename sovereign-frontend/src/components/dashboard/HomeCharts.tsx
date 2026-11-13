// components/dashboard/HomeCharts.tsx — กราฟตกแต่งหน้า Dashboard ที่ย้ายมาจาก pages/dashboard.tsx
// (IDEA-011: ย้ายเพื่อลดขนาดหน้า — GaugeCircle/RadarPentagon/SankeyAlluvial/PerfGauges
//  ยังทำงานเหมือนเดิมทุกอย่าง การแก้ข้อมูลปลอมใน PerfGauges อยู่ในงานแยกของคิว)

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

export function RadarPentagon({ metrics }: { metrics: Record<string, number> }) {
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

export function SankeyAlluvial({ wealth, inventory, farm }: { wealth: any; inventory: any; farm: any }) {
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

export function PerfGauges({ metrics, deviceStatus }: { metrics: Record<string, number>; deviceStatus: any }) {
  const ds = deviceStatus ?? { total:0, online:0, offline:0 };
  const gauges = [
    { label: 'CPU', val: 38 + ((metrics.temperature ?? 30) % 20), color: '#22d3ee' },
    { label: 'MEM', val: 56 + ((metrics.humidity ?? 50) % 16), color: '#a78bfa' },
    { label: 'NET', val: ds.total ? (ds.online / Math.max(1, ds.total)) * 100 : 72, color: '#34d399' },
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
