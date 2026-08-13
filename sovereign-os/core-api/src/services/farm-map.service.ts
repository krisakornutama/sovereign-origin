// SVG แผนที่แปลงฟาร์ม — วาดจากข้อมูลจริงใน farm_plots (pure Node, ไม่พึ่ง lib)

export interface FarmMapPlot {
  id: string;
  name: string;
  crop: string | null;
  area_sqm: number | null;
  status: string;
  location: string | null;
  planted_at: Date | string | null;
  expected_harvest_at: Date | string | null;
}

// สีตามสถานะ — เขียวจัด: กำลังโต, เขียวเข้ม: เปิดใช้, เทา: เก็บเกี่ยวแล้ว/ว่าง
const STATUS_FILL: Record<string, string> = {
  active: '#10b981',
  growing: '#34d399',
  harvested: '#64748b',
  fallow: '#94a3b8',
};
const STATUS_BORDER: Record<string, string> = {
  active: '#047857',
  growing: '#0f766e',
  harvested: '#475569',
  fallow: '#64748b',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'ใช้งาน',
  growing: 'กำลังโต',
  harvested: 'เก็บแล้ว',
  fallow: 'ว่าง',
};

/** escape ข้อความก่อนยัดเข้า XML (กัน SVG injection จากชื่อแปลง) */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** เหลือเวลาจนถึงวันเก็บเกี่ยว (วัน) — 0 เมื่อผ่านแล้ว */
export function daysToHarvest(expected: Date | string | null | undefined, now: number): number | null {
  if (!expected) return null;
  const target = new Date(expected).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - now) / 86400000));
}

function plotGlyph(p: FarmMapPlot, x: number, y: number, w: number, h: number, now: number): string {
  const fill = STATUS_FILL[p.status] ?? '#6b7280';
  const stroke = STATUS_BORDER[p.status] ?? '#4b5563';
  const label = STATUS_LABEL[p.status] ?? p.status;
  const lines: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" opacity="0.92" stroke="${stroke}" stroke-width="2"/>`,
    `<text x="${x + 14}" y="${y + 32}" font-size="17" font-weight="bold" fill="#06281f" font-family="sans-serif">${escapeXml(p.name)}</text>`,
    `<text x="${x + 14}" y="${y + 56}" font-size="13" fill="#064e3b" font-family="sans-serif">${escapeXml(p.crop || '—')} · ${label}</text>`,
  ];
  let ly = y + 80;
  if (p.location) {
    lines.push(`<text x="${x + 14}" y="${ly}" font-size="12" fill="#065f46" font-family="sans-serif">📍 ${escapeXml(p.location)}</text>`);
    ly += 20;
  }
  if (p.area_sqm != null) {
    lines.push(`<text x="${x + 14}" y="${ly}" font-size="12" fill="#065f46" font-family="sans-serif">📐 ${escapeXml(String(p.area_sqm))} ตร.ม.</text>`);
    ly += 20;
  }
  const days = daysToHarvest(p.expected_harvest_at, now);
  if (days != null) {
    const color = days === 0 ? '#7f1d1d' : days <= 7 ? '#92400e' : '#064e3b';
    lines.push(`<text x="${x + 14}" y="${ly}" font-size="12" font-weight="bold" fill="${color}" font-family="sans-serif">${days === 0 ? '⏰ พร้อมเก็บแล้ว' : `🌾 เก็บเกี่ยวใน ${days} วัน`}</text>`);
  }
  return lines.join('\n    ');
}

const LEGEND = [
  ['#10b981', 'ใช้งาน'],
  ['#34d399', 'กำลังโต'],
  ['#64748b', 'เก็บแล้ว'],
  ['#94a3b8', 'ว่าง'],
];

/**
 * วาดแผนที่แปลง — เรียงเป็นตาราง cols ช่อง/แถว (ไม่มีพิกัดใน DB → แผนผังอัตโนมัติ)
 * ป้อน now ได้เพื่อให้เทสต์ deterministic
 */
export function buildFarmMapSvg(plots: FarmMapPlot[], opts: { cols?: number; now?: number } = {}): string {
  const cols = Math.min(Math.max(1, opts.cols ?? 3), 6);
  const now = opts.now ?? Date.now();
  const cellW = 320;
  const cellH = 140;
  const pad = 24;
  const headerH = 90;
  const gap = 14;

  const rows = plots.length === 0 ? 1 : Math.ceil(plots.length / cols);
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const height = pad + headerH + rows * cellH + (rows - 1) * gap + pad;

  let body = '';
  plots.forEach((p, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = pad + c * (cellW + gap);
    const y = pad + headerH + r * (cellH + gap);
    body += `\n    ${plotGlyph(p, x, y, cellW, cellH, now)}`;
  });

  const legendX = width - pad - 330;
  const legend = LEGEND.map(
    ([color, label], i) =>
      `<g transform="translate(${i * 82}, 0)"><rect x="0" y="0" width="14" height="14" rx="3" fill="${color}"/><text x="20" y="12" font-size="12" fill="#d1d5db" font-family="sans-serif">${label}</text></g>`
  ).join('\n    ');
  const content = plots.length === 0
    ? `<text x="${width / 2}" y="${pad + headerH + 60}" text-anchor="middle" font-size="15" fill="#9ca3af" font-family="sans-serif">ยังไม่มีแปลง — สร้างแปลงแรกในตารางด้านล่าง</text>`
    : body;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">
  <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#111827"/>
  <text x="${pad}" y="40" font-size="20" font-weight="bold" fill="#34d399">🗺️ แผนที่แปลงฟาร์ม</text>
  <text x="${pad}" y="64" font-size="12" fill="#9ca3af">${plots.length} แปลง · ข้อมูลจาก farm_plots (อัปเดตอัตโนมัติ)</text>
  <g transform="translate(${legendX}, 28)">
    <text x="0" y="-8" font-size="11" fill="#6b7280" font-family="sans-serif">สถานะ:</text>
    ${legend}
  </g>
  ${content}
</svg>`;
}