// components/dashboard/HomeCharts.tsx — กราฟตกแต่งหน้า Dashboard ที่ย้ายมาจาก pages/dashboard.tsx
// (IDEA-011: ย้ายเพื่อลดขนาดหน้า — GaugeCircle/RadarPentagon/SankeyAlluvial ย้ายตามเดิม
//  IDEA-012: PerfGauges แก้ข้อมูลปลอมแล้ว — ตัด CPU/MEM ที่แต่งจากสูตร (ระบบไม่มีแหล่งข้อมูล)
//  และไม่มี fallback ตัวเลขเมื่อไม่มีข้อมูล: ข้ามช่องนั้นไป ถ้าไม่มีเลยแสดงสถานะจริง
//  IDEA-013: RadarPentagon วาดเมื่อมีข้อมูลจริงครบ 5 แกน · SankeyAlluvial สร้างจาก wealth
//  จริงเท่านั้น — ตัด fallback 42000/8000/5000/6.2/850/3 ทั้งหมด)

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
  // IDEA-013: วาดเฉพาะเมื่อมีข้อมูลจริงครบทั้ง 5 แกน — ไม่ครบ = แจ้งสถานะจริง (บอกแกนที่ขาด)
  // (เดิมวาดรูปห้าเหลี่ยมจากค่าแต่ง temp 28 / humidity 60 / battery 70 / water 45 / power 1.2)
  const defs: Array<{ label: string; val: number | null; norm: (v: number) => number }> = [
    { label: 'TEMP', val: metrics.temperature ?? null, norm: (v) => Math.max(0, Math.min(100, (v / 50) * 100)) },
    { label: 'HUM', val: metrics.humidity ?? null, norm: (v) => Math.max(0, Math.min(100, v)) },
    { label: 'BAT', val: metrics.battery_soc ?? null, norm: (v) => Math.max(0, Math.min(100, v)) },
    { label: 'WTR', val: metrics.water_level_cm ?? null, norm: (v) => Math.max(0, Math.min(100, v)) },
    { label: 'PWR', val: metrics.power_kw != null ? metrics.power_kw * 40 : null, norm: (v) => Math.max(0, Math.min(100, v)) },
  ];
  const keys = ['temp', 'humidity', 'battery', 'water', 'power'] as const;
  const labels: Record<string, string> = { temp: 'TEMP', humidity: 'HUM', battery: 'BAT', water: 'WTR', power: 'PWR' };
  const missing = defs.filter((d) => d.val == null).map((d) => d.label);
  if (missing.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ height: 140 }}>
        <span className="text-[10px] tracking-widest font-mono text-gray-500 text-center">
          {missing.length === defs.length
            ? 'ยังไม่มีข้อมูลเซ็นเซอร์ — รอข้อมูลจริงจากระบบ'
            : `ยังไม่มีข้อมูลครบ 5 แกน (ขาด: ${missing.join(', ')}) — รอข้อมูลจริง`}
        </span>
      </div>
    );
  }
  const vals = defs.map((d) => d.norm(d.val as number));
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
  // Left sources -> Center -> Right sinks — สร้างเฉพาะแหล่งที่มีค่าจริงเท่านั้น (IDEA-013)
  // (เดิมแต่งค่า fallback แข็งทุกแหล่งเมื่อ wealth ไม่มี ทำให้จุดที่เรียกด้วย wealth={null}
  //  แสดงตัวเลขปลอมตลอดเวลา — ค่าแต่งเดิมถูกลบ ดูประวัติใน git และเทสต์ tools/test/dashboard-fallback-truth.test.mjs)
  const sources: Array<{ label: string; val: number; color: string }> = [];
  if (wealth && typeof wealth.portfolioUsd === 'number') sources.push({ label: 'Portfolio', val: wealth.portfolioUsd, color: '#10b981' });
  if (wealth && typeof wealth.inventoryUsd === 'number') sources.push({ label: 'Inventory', val: wealth.inventoryUsd, color: '#22d3ee' });
  if (wealth && typeof wealth.cashUsd === 'number') sources.push({ label: 'Cash', val: wealth.cashUsd, color: '#a78bfa' });
  const runway = wealth?.runway && typeof wealth.runway.months === 'number' ? wealth.runway.months : null;
  const burn = wealth?.runway && typeof wealth.runway.monthlyBurnUsd === 'number' ? wealth.runway.monthlyBurnUsd : null;
  const growing = farm && typeof farm.growing === 'number' ? farm.growing : null;
  if (sources.length === 0) {
    return (
      <div className="h-[88px] flex items-center justify-center">
        <span className="text-[10px] tracking-widest font-mono text-gray-500">ยังไม่มีข้อมูลพอร์ต/ทรัพยากร — รอข้อมูลจริงจากระบบ</span>
      </div>
    );
  }
  const total = sources.reduce((a, b) => a + b.val, 0) || 1;
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
      <text x={rightX} y={7} textAnchor="end" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">{runway != null ? `RUNWAY ${runway.toFixed(1)}M` : 'RUNWAY —'}</text>
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
      <text x={midX} y={42} textAnchor="middle" fill="#9ca3af" fontSize="6" fontFamily="JetBrains Mono">{growing != null ? `${growing} PLOTS` : 'PLOTS —'}</text>
      <text x={midX} y={50} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">{inventory && typeof inventory.items === 'number' ? `${inventory.items} ITEMS` : '— ITEMS'}</text>
      {/* right sink */}
      <rect x={rightX - 54} y={14} width={54} height={22} rx={4} fill="rgba(245,158,11,0.14)" stroke="rgba(245,158,11,0.4)" strokeWidth="0.8" />
      <text x={rightX - 27} y={24} textAnchor="middle" fill="#f59e0b" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">SURVIVAL</text>
      <text x={rightX - 27} y={30} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">{runway != null ? (runway > 6 ? 'STABLE' : 'LOW') : '—'}</text>
      <rect x={rightX - 54} y={44} width={54} height={22} rx={4} fill="rgba(239,68,68,0.10)" stroke="rgba(239,68,68,0.35)" strokeWidth="0.8" />
      <text x={rightX - 27} y={54} textAnchor="middle" fill="#f87171" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">RESERVE</text>
      <text x={rightX - 27} y={60} textAnchor="middle" fill="#6b7889" fontSize="5.5" fontFamily="JetBrains Mono">{burn != null ? `BURN $${burn.toLocaleString()}` : 'BURN —'}</text>
    </svg>
  );
}

export function PerfGauges({ metrics, deviceStatus }: { metrics: Record<string, number>; deviceStatus: any }) {
  // IDEA-012: เฉพาะ gauge ที่มีแหล่งข้อมูลจริงเท่านั้น — ไม่มีข้อมูล = ไม่แสดง (ห้ามแต่งตัวเลขแทน)
  // NET = อัตราอุปกรณ์ออนไลน์จริงจาก /api/devices/status (total=0 คือยังไม่มีข้อมูล/ไม่มีอุปกรณ์ จึงไม่วาด)
  const gauges: Array<{ label: string; val: number; color: string }> = [];
  if (deviceStatus && typeof deviceStatus.total === 'number' && deviceStatus.total > 0) {
    gauges.push({ label: 'NET', val: (deviceStatus.online / deviceStatus.total) * 100, color: '#34d399' });
  }
  if (metrics.battery_soc != null) {
    gauges.push({ label: 'PWR', val: metrics.battery_soc, color: metrics.battery_soc < 20 ? '#ef4444' : '#10b981' });
  }
  if (metrics.humidity != null) {
    gauges.push({ label: 'HUM', val: metrics.humidity, color: '#38bdf8' });
  }
  if (metrics.temperature != null) {
    gauges.push({ label: 'TMP', val: Math.min(100, (metrics.temperature / 45) * 100), color: metrics.temperature > 40 ? '#ef4444' : '#f59e0b' });
  }
  if (metrics.water_level_cm != null) {
    gauges.push({ label: 'WTR', val: Math.min(100, metrics.water_level_cm), color: '#22d3ee' });
  }
  if (metrics.solar_radiation != null) {
    gauges.push({ label: 'SOL', val: Math.min(100, metrics.solar_radiation / 12), color: '#facc15' });
  }
  if (gauges.length === 0) {
    return (
      <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 text-center">
        <span className="text-[10px] font-mono tracking-widest text-gray-500">ยังไม่มีข้อมูลเซ็นเซอร์/สถานะอุปกรณ์ — รอข้อมูลจริงจากระบบ</span>
      </div>
    );
  }
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
