// src/services/property-strategy.service.ts
//
// ระบบภูมิศาสตร์ที่ดิน — แผนที่จำลอง (ภาพ 2 มิติ + ไอโซเมตริก 3 มิติ) +
// วิเคราะห์จุดยุทธศาสตร์สำหรับวางกับดัก/กล้อง/เซ็นเซอร์ตรวจจับการเคลื่อนไหว

export interface PropertyZone {
  id: string;
  name: string;
  type: string; // บ้าน | สวน | รั้ว | ประตู | ที่จอดรถ | โรงเก็บ | ที่โล่ง | ทางเข้า | อื่น
  x: number; // พิกัดกริด (เมตร) จากมุมบน-ซ้าย
  y: number;
  z: number; // ความสูงจากพื้น (เมตร)
  width_m: number;
  length_m: number;
  height_m: number;
  color?: string | null;
  note?: string | null;
}

export interface StrategicPoint {
  id: string;
  name: string;
  type: string; // กล้อง | เซ็นเซอร์ตรวจจับ | กับดัก | ไฟ
  x: number;
  y: number;
  z: number;
  radius_m: number;
  reason: string | null;
  enabled: boolean;
  zone_id?: string | null;
}

export interface ScoredPoint {
  point: StrategicPoint;
  score: number; // 0-100
  reasons: string[];
}

export interface PointSuggestion {
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  reason: string;
}

// ระยะรัศมีตรวจจับของแต่ละประเภท
const DETECT_RADIUS: Record<string, number> = {
  กล้อง: 6, 'เซ็นเซอร์ตรวจจับ': 4, กับดัก: 2, ไฟ: 5,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** คะแนนจุดยุทธศาสตร์: ใกล้ขอบที่ดิน/ประตู/จุดผ่านระหว่างโซน → คะแนนสูง */
export function scoreStrategicPoints(
  zones: PropertyZone[],
  points: StrategicPoint[],
  landWidth: number,
  landLength: number
): ScoredPoint[] {
  return points.map((p) => {
    const reasons: string[] = [];
    let score = 20; // พื้นฐาน: มีจุดตรวจจับ

    // 1) ใกล้ขอบที่ดิน (รั้ว) — คน/สัตว์ต้องข้ามเข้ามาทางขอบ
    const distToBoundary = Math.min(p.x, p.y, landWidth - p.x, landLength - p.y);
    if (distToBoundary <= 3) {
      score += 35;
      reasons.push(`อยู่ติดขอบที่ดิน (${Math.max(0, Math.round(distToBoundary))} ม. จากรั้ว) — จุดผ่านเข้าออกหลัก`);
    } else if (distToBoundary <= 8) {
      score += 18;
      reasons.push('ค่อนข้างใกล้ขอบที่ดิน');
    }

    // 2) ใกล้ประตู/ทางเข้า — ช่องทางเข้าออกปกติของคน
    const entrance = zones.find((z) => z.type === 'ประตู' || z.type === 'ทางเข้า');
    if (entrance) {
      const dist = Math.hypot(p.x - (entrance.x + entrance.width_m / 2), p.y - (entrance.y + entrance.length_m / 2));
      if (dist <= 6) {
        score += 25;
        reasons.push(`ใกล้ประตู "${entrance.name}" — คนต้องผ่านจุดนี้`);
      } else if (dist <= 12) {
        score += 12;
      }
    }

    // 3) ระหว่างโซนสำคัญ — คอคอดที่คน/สัตว์ต้องเดินผ่าน
    for (const z of zones) {
      const dist = Math.hypot(p.x - (z.x + z.width_m / 2), p.y - (z.y + z.length_m / 2));
      if (dist <= 4 && (z.type === 'สวน' || z.type === 'บ้าน' || z.type === 'โรงเก็บ')) {
        score += 15;
        reasons.push(`อยู่ระหว่างพื้นที่สำคัญ "${z.name}"`);
      }
    }

    // 4) สัตว์/คนมักเดินตามแนวน้ำ/แนวรั้ว — จุดตามขอบสวนได้คะแนนเสริม
    const garden = zones.find((z) => z.type === 'สวน');
    if (garden) {
      const dist = Math.hypot(p.x - (garden.x + garden.width_m / 2), p.y - (garden.y + garden.length_m / 2));
      if (dist <= garden.width_m / 2 + 3) {
        score += 8;
        reasons.push(`คุ้มกันแนวแปลง "${garden.name}" (สัตว์ชอบเข้ามากินพืช)`);
      }
    }

    // 5) บทลงโทษ: ซ่อนอยู่กลางโซนใหญ่ (ตรวจไม่ทันทางเข้า)
    const inBigZone = zones.some((z) => p.x >= z.x && p.x <= z.x + z.width_m && p.y >= z.y && p.y <= z.y + z.length_m && z.width_m * z.length_m > 25);
    if (inBigZone) {
      score -= 12;
      reasons.push('อยู่กลางโซนใหญ่ — อาจตรวจไม่ทันคนที่เข้าทางอื่น');
    }

    score = Math.round(clamp(score, 0, 100));
    reasons.sort();
    return { point: p, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

/** แนะนำจุดยุทธศาสตร์อัตโนมัติ: ขอบที่ดิน (มุม/กึ่งกลาง), หน้าประตู, ระหว่างโซน */
export function suggestStrategicPoints(zones: PropertyZone[], landWidth: number, landLength: number): PointSuggestion[] {
  const out: PointSuggestion[] = [];
  const seen = new Set<string>();
  const add = (s: PointSuggestion) => {
    const key = `${Math.round(s.x)}-${Math.round(s.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  // ประตู/ทางเข้า — หน้าประตู 2 เมตร
  for (const z of zones) {
    if (z.type === 'ประตู' || z.type === 'ทางเข้า') {
      const cx = z.x + z.width_m / 2;
      const cy = z.y + z.length_m / 2;
      add({ name: `เฝ้าประตู ${z.name}`, type: 'กล้อง', x: Math.round(clamp(cx, 1, landWidth - 1)), y: Math.round(clamp(cy + 2, 1, landLength - 1)), z: 2, reason: `หน้าประตู "${z.name}" — จุดที่คน/ยานพาหนะต้องผ่าน` });
      add({ name: `กับดักเส้นทางเข้า`, type: 'กับดัก', x: Math.round(clamp(cx - 1.5, 1, landWidth - 1)), y: Math.round(clamp(cy + 1, 1, landLength - 1)), z: 0, reason: `ทางเข้าหลักของคน/สัตว์` });
    }
  }

  // ขอบที่ดิน: มุมทั้ง 4 + กึ่งกลางด้านที่ยาว
  const corners: Array<[number, number, string]> = [
    [1, 1, 'มุมบนซ้าย'], [landWidth - 1, 1, 'มุมบนขวา'],
    [1, landLength - 1, 'มุมล่างซ้าย'], [landWidth - 1, landLength - 1, 'มุมล่างขวา'],
  ];
  for (const [cx, cy, label] of corners) {
    add({ name: `ตรวจจับ${label}`, type: 'เซ็นเซอร์ตรวจจับ', x: cx, y: cy, z: 1, reason: `${label}ของรั้ว — จุดปีนข้าม/มุดเข้ามาง่าย` });
  }
  if (landLength > 12) {
    const midY = Math.round(landLength / 2);
    add({ name: 'กลางแนวรั้วด้านยาว', type: 'กล้อง', x: 1, y: midY, z: 2, reason: 'รั้วด้านยาว — สัตว์/คนชอบเดินเลียบแนวรั้ว' });
  }

  // ระหว่างบ้านกับสวน — เส้นทางเดินหลัก
  const house = zones.find((z) => z.type === 'บ้าน');
  const garden = zones.find((z) => z.type === 'สวน');
  if (house && garden) {
    const hx = house.x + house.width_m / 2, hy = house.y + house.length_m / 2;
    const gx = garden.x + garden.width_m / 2, gy = garden.y + garden.length_m / 2;
    const mx = Math.round((hx + gx) / 2), my = Math.round((hy + gy) / 2);
    add({ name: 'คอคอดบ้าน↔สวน', type: 'เซ็นเซอร์ตรวจจับ', x: mx, y: my, z: 1, reason: 'เส้นทางเดินหลักระหว่างบ้านกับสวน — คน/สัตว์ต้องผ่าน' });
  }
  return out;
}

// ── SVG: แผนที่ 2 มิติ + ไอโซเมตริก 3 มิติ ──

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const ZONE_COLORS: Record<string, string> = {
  บ้าน: '#f59e0b', สวน: '#10b981', รั้ว: '#94a3b8', ประตู: '#3b82f6', 'ที่จอดรถ': '#8b5cf6',
  โรงเก็บ: '#a16207', 'ที่โล่ง': '#84cc16', ทางเข้า: '#06b6d4', อื่น: '#6b7280',
};

// ไอโซเมตริก: แกน X เอียง -30°, แกน Y เอียง +30° (2:1) — คลาสสิก pixel-art isometric
function iso(x: number, y: number, z: number, scale: number): [number, number] {
  const sx = (x - y) * scale;
  const sy = (x + y) * (scale / 2) - z * scale;
  return [sx, sy];
}

/**
 * วาดแผนที่: ด้านบน = แผนผัง top-down (สเกลจริง) + ด้านล่าง = ไอโซเมตริก 3 มิติ
 * ทุกพิกัดเป็นเมตร → scale px ต่อเมตร
 */
export function buildPropertyMapSvg(
  zones: PropertyZone[],
  points: StrategicPoint[],
  landWidth: number,
  landLength: number,
  scale = 18
): string {
  const margin = 40;
  const topW = landWidth * scale;
  const topH = landLength * scale;
  // พื้นที่ไอโซเมตริก: กว้าง ~ (W+L)*scale, สูง ~ (W+L)*scale/2 + สูงสุด
  const isoW = (landWidth + landLength) * scale + margin * 2;
  const isoH = (landWidth + landLength) * scale + margin * 2 + 20;
  const cx = isoW / 2;

  const zoneRects: string[] = [];
  for (const z of zones) {
    const color = z.color || ZONE_COLORS[z.type] || '#6b7280';
    const rx = z.x * scale, ry = z.y * scale;
    zoneRects.push(
      `<g>
        <rect x="${rx}" y="${ry}" width="${z.width_m * scale}" height="${z.length_m * scale}" rx="6" fill="${color}" opacity="0.25" stroke="${color}" stroke-width="2"/>
        <text x="${rx + 8}" y="${ry + 20}" font-size="13" font-weight="bold" fill="#e5e7eb">${escapeXml(z.name)}</text>
        <text x="${rx + 8}" y="${ry + 38}" font-size="11" fill="#9ca3af">${escapeXml(z.type)} · ${z.width_m}×${z.length_m}×${z.height_m} ม.</text>
      </g>`
    );
  }
  const pointDots: string[] = [];
  for (const p of points) {
    const color = p.enabled ? (p.type === 'กับดัก' ? '#ef4444' : p.type === 'กล้อง' ? '#3b82f6' : p.type === 'ไฟ' ? '#f59e0b' : '#22d3ee') : '#6b7280';
    pointDots.push(
      `<g>
        <circle cx="${p.x * scale}" cy="${p.y * scale}" r="${p.enabled ? 6 : 4}" fill="${color}" opacity="0.9"/>
        <circle cx="${p.x * scale}" cy="${p.y * scale}" r="${Math.max(8, (p.radius_m || DETECT_RADIUS[p.type] || 4) * scale)}" fill="${color}" opacity="0.08"/>
        <text x="${p.x * scale + 10}" y="${p.y * scale + 4}" font-size="11" fill="#e5e7eb">${escapeXml(p.name)} ${p.enabled ? '' : '(ปิด)'}</text>
      </g>`
    );
  }

  // ไอโซเมตริก: วาดโซนเป็นกล่อง (พื้น + หลังคา + เส้นข้าง) แล้วจุดตรวจจับเป็นหมุด
  const isoZones: string[] = [];
  for (const z of zones) {
    const color = z.color || ZONE_COLORS[z.type] || '#6b7280';
    const zx = z.x, zy = z.y, w = z.width_m, l = z.length_m, h = z.height_m;
    const [a, b, c, d] = [
      iso(zx, zy, 0, scale), iso(zx + w, zy, 0, scale),
      iso(zx + w, zy + l, 0, scale), iso(zx, zy + l, 0, scale),
    ];
    const [t, r, bt, br] = [
      iso(zx, zy, h, scale), iso(zx + w, zy, h, scale),
      iso(zx + w, zy + l, h, scale), iso(zx, zy + l, h, scale),
    ];
    const floor = `M ${cx + a[0]} ${a[1]} L ${cx + b[0]} ${b[1]} L ${cx + c[0]} ${c[1]} L ${cx + d[0]} ${d[1]} Z`;
    const roof = `M ${cx + t[0]} ${t[1]} L ${cx + r[0]} ${r[1]} L ${cx + br[0]} ${br[1]} L ${cx + bt[0]} ${bt[1]} Z`;
    isoZones.push(
      `<g>
        <path d="${floor}" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>
        <path d="${roof}" fill="${color}" opacity="0.65" stroke="#00000055" stroke-width="1.5"/>
        <line x1="${cx + a[0]}" y1="${a[1]}" x2="${cx + t[0]}" y2="${t[1]}" stroke="${color}" stroke-width="1.5"/>
        <line x1="${cx + b[0]}" y1="${b[1]}" x2="${cx + r[0]}" y2="${r[1]}" stroke="${color}" stroke-width="1.5"/>
        <line x1="${cx + c[0]}" y1="${c[1]}" x2="${cx + br[0]}" y2="${br[1]}" stroke="${color}" stroke-width="1.5"/>
        <text x="${cx + ((t[0] + br[0]) / 2)}" y="${(t[1] + br[1]) / 2 - 6}" font-size="12" font-weight="bold" fill="#e5e7eb" text-anchor="middle">${escapeXml(z.name)}</text>
      </g>`
    );
  }
  const isoPoints: string[] = [];
  for (const p of points) {
    const [px, py] = iso(p.x, p.y, p.z, scale);
    const color = p.enabled ? (p.type === 'กับดัก' ? '#ef4444' : p.type === 'กล้อง' ? '#3b82f6' : '#22d3ee') : '#6b7280';
    isoPoints.push(
      `<g>
        <circle cx="${cx + px}" cy="${py}" r="5" fill="${color}" stroke="#00000066" stroke-width="1"/>
        <line x1="${cx + px}" y1="${py}" x2="${cx + px}" y2="${py + 12}" stroke="${color}" stroke-width="1.5"/>
        <text x="${cx + px + 8}" y="${py}" font-size="10" fill="#d1d5db">${escapeXml(p.name)}</text>
      </g>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(topW + margin * 2, isoW)} ${topH + margin * 2 + isoH + 40}" font-family="Prompt, sans-serif">
  <defs>
    <pattern id="grid" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse">
      <path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="#1f2937" stroke-width="0.5"/>
    </pattern>
  </defs>
  <rect x="${margin / 2}" y="${margin / 2}" width="${topW}" height="${topH}" fill="url(#grid)" stroke="#374151" stroke-width="2"/>
  <text x="${margin / 2}" y="${margin / 2 - 8}" font-size="13" font-weight="bold" fill="#e5e7eb">📍 แผนผัง (มองจากบน) — ${landWidth}×${landLength} ม.</text>
  ${zoneRects.join('\n  ')}
  ${pointDots.join('\n  ')}
  <text x="${margin / 2}" y="${topH + margin / 2 + 18}" font-size="13" font-weight="bold" fill="#e5e7eb">🧊 จำลอง 3 มิติ (ไอโซเมตริก) — มุมมองตามจริง</text>
  <g transform="translate(0 ${topH + margin / 2 + 30})">
    <rect x="0" y="0" width="${isoW}" height="${isoH}" fill="#0b1220" stroke="#1f2937" rx="12"/>
    ${isoZones.join('\n    ')}
    ${isoPoints.join('\n    ')}
  </g>
  <text x="${margin / 2}" y="${topH + margin / 2 + isoH + 55}" font-size="11" fill="#9ca3af">สเกล: 1 ช่อง = 1 ม. · 🔴 กับดัก · 🔵 กล้อง · 🩵 เซ็นเซอร์ตรวจจับ · 🟡 ไฟ</text>
</svg>`;
}

// ────────────────────────────────────────────────
// พิมพ์เขียวค่ายกล 3 ไร่ (Bagua Masterplan)
// ที่ดิน 4800 ตร.ม. แบ่งเป็นวงแหวนซ้อนกัน:
//   วงนอก 40% (1920) = แนวป้องกัน/ป่ากั้น   Zone 1
//   วงกลาง 50% (2400) = สระน้ำ/นา/เล้า+สมุนไพร   Zone 2-4
//   แกนกลาง 10% (480) = ศูนย์บัญชาการหยินหยาง  Zone 5
// ────────────────────────────────────────────────

export interface BaguaRing {
  id: string;
  nameTh: string;
  nameEn: string;
  area_m2: number;
  pct: number;
}

export interface BaguaZoneSpec {
  name: string;
  type: string; // PERIMETER_DEFENSE | WATER_BODY | AGRICULTURE | LIVESTOCK_GARDEN | CORE_LIVING
  color: string;
  note: string;
  x: number;
  y: number;
  z: number;
  width_m: number;
  length_m: number;
  height_m: number;
  area_m2: number;
}

export interface BaguaPointSpec {
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  radius_m: number;
  reason: string;
  zoneName: string;
}

export interface BaguaMasterplan {
  totalAreaSqM: number;
  philosophy: string;
  land: { width: number; length: number };
  rings: BaguaRing[];
  zones: BaguaZoneSpec[];
  points: BaguaPointSpec[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * คำนวณพิมพ์เขียวค่ายกล (pure — ไม่แตะ DB)
 * ปรับให้เข้ากับที่ดินกว้าง×ยาว ใดก็ได้:
 *   - วงนอก 40% = 4 แถบขอบ (แนวป้องกัน)
 *   - วงกลาง 60% = 4 แถบ (สระ/นา/สวนสมุนไพร) ปิดบริเวณเต็มพื้นที่
 *   - แกนกลาง 10% = ศูนย์บัญชาการหยินหยาง (อัตราส่วนเดียวกับที่ดิน)
 * ไม่มีช่องว่าง/ทับซ้อน — ผลรวมโซน = ขนาดที่ดินเสมอ
 */
export function generateBaguaMasterplan(width = 80, length = 60): BaguaMasterplan {
  if (width <= 0 || length <= 0) throw new Error('width/length must be > 0');
  const total = width * length;

  // วงแหวนซ้อนบนรูปสี่เหลี่ยมผืนผ้า: แกนกลาง = √0.1 ของด้าน, ขอบวงกลาง = √0.6 → พื้นที่ 10% / 60% / 40%
  const mw = width * Math.sqrt(0.6);   // ความกว้างขอบวงกลาง (จตุภาค 60%)
  const ml = length * Math.sqrt(0.6);  // ความยาวขอบวงกลาง
  const cw = width * Math.sqrt(0.1);   // ความกว้างแกนกลาง (10%)
  const cl = length * Math.sqrt(0.1);  // ความยาวแกนกลาง

  // ระยะความหนาของแต่ละแถบ
  const t = (length - ml) / 2;         // ความหนาแถบวงนอก (บน/ล่าง)
  const s = (width - mw) / 2;          // ความหนาแถบวงนอก (ซ้าย/ขวา)
  const hm = (ml - cl) / 2;            // ความสูงแถบวงกลาง (บน/ล่าง)
  const sm = (mw - cw) / 2;            // ความกว้างแถบวงกลาง (ซ้าย/ขวา)

  const mkZone = (
    name: string, type: string, color: string, note: string,
    x: number, y: number, w: number, l: number, h: number
  ): BaguaZoneSpec => ({
    name, type, color, note,
    x: round2(x), y: round2(y), z: 0,
    width_m: round2(w), length_m: round2(l), height_m: h,
    area_m2: round2(w * l),
  });

  const zones: BaguaZoneSpec[] = [
    // Zone 1 — แนวป้องกัน (วงนอก 40%: 4 แถบขอบ, ไม่ทับซ้อน)
    mkZone('ป่าแนวป้องกัน เหนือ', 'PERIMETER_DEFENSE', '#64748b',
      'Zone 1 · Perimeter Guard & Barrier Forest — รั้วไผ่ + โหนดเซ็นเซอร์ IoT คุ้มกันรอบด้าน', 0, 0, width, t, 3),
    mkZone('ป่าแนวป้องกัน ใต้', 'PERIMETER_DEFENSE', '#64748b',
      'Zone 1 · Perimeter Guard & Barrier Forest — ด้านใต้ (ทางเข้าหลักรูปตัว S)', 0, length - t, width, t, 3),
    mkZone('ป่าแนวป้องกัน ตะวันตก', 'PERIMETER_DEFENSE', '#64748b',
      'Zone 1 · Perimeter Guard & Barrier Forest — ด้านตะวันตก', 0, t, s, length - 2 * t, 3),
    mkZone('ป่าแนวป้องกัน ตะวันออก', 'PERIMETER_DEFENSE', '#64748b',
      'Zone 1 · Perimeter Guard & Barrier Forest — ด้านตะวันออก', width - s, t, s, length - 2 * t, 3),
    // Zone 2 — สระน้ำ (แถบบนวงกลาง)
    mkZone('สระน้ำสำรอง (Aqua Reserve)', 'WATER_BODY', '#0ea5e9',
      'Zone 2 · Resource Retention Pond — เลี้ยงปลา + กักน้ำสำรองดับไฟ', s, t, mw, hm, 2),
    // Zone 3 — นาแปลงหลัก (แถบซ้าย+ขวาของวงกลาง: 2 แถบรวมเป็นโซนเดียว)
    mkZone('นาแปลงหลัก + ไม้ผล (ฝั่งตะวันตก)', 'AGRICULTURE', '#84cc16',
      'Zone 3 · Sovereign Paddy & Staples — ข้าวอินทรีย์ SRI + กล้วย/มันสำปะหลัง', s, t + hm, sm, cl, 2),
    mkZone('นาแปลงหลัก + ไม้ผล (ฝั่งตะวันออก)', 'AGRICULTURE', '#84cc16',
      'Zone 3 · Sovereign Paddy & Staples — ข้าวอินทรีย์ SRI + กล้วย/มันสำปะหลัง', s + sm + cw, t + hm, sm, cl, 2),
    // Zone 4 — เล้าไก่ + สวนสมุนไพร (แถบล่างวงกลาง)
    mkZone('เล้าไก่ + สวนสมุนไพร', 'LIVESTOCK_GARDEN', '#10b981',
      'Zone 4 · Nutrition & Healing Garden — ไก่ไข่ + ยาสมุนไพร 10-20 ชนิด', s, t + ml - hm, mw, hm, 3),
    // Zone 5 — แกนกลาง 10% (อัตราส่วนเดียวกับที่ดิน)
    mkZone('ศูนย์บัญชาการหยินหยาง', 'CORE_LIVING', '#f59e0b',
      'Zone 5 · Yin-Yang Command Hub — Solar Off-Grid + Server Room + พื้นที่พักหลัก', (width - cw) / 2, (length - cl) / 2, cw, cl, 4),
  ];

  const points: BaguaPointSpec[] = [
    {
      name: 'ประตู S-Curve — PIR เซ็นเซอร์', type: 'เซ็นเซอร์ตรวจจับ',
      x: round2(width / 2), y: round2(length - 1.5), z: 2, radius_m: 4,
      reason: 'Zone 1 · S-Curve Entrance — ตรวจจับคน/สัตว์ผ่านประตูรูปตัว S (ESP8266 + PIR)',
      zoneName: 'ป่าแนวป้องกัน ใต้',
    },
    {
      name: 'ประตู S-Curve — กล้อง CCTV', type: 'กล้อง',
      x: round2(width / 2), y: round2(length - t - 1), z: 3, radius_m: 6,
      reason: 'บันทึกภาพทางเข้าหลัก — เห็นรั้วประตู + สองข้างถนน',
      zoneName: 'ป่าแนวป้องกัน ใต้',
    },
    {
      name: 'สระน้ำ — Telemetry ระดับน้ำ/pH', type: 'เซ็นเซอร์ตรวจจับ',
      x: round2(width / 2), y: round2(t + hm / 2), z: 1, radius_m: 4,
      reason: 'มอนิเตอร์น้ำจริง (ระดับ + pH) — IoT คาดการณ์ภัยแล้ง/น้ำท่วมล่วงหน้า',
      zoneName: 'สระน้ำสำรอง (Aqua Reserve)',
    },
    {
      name: 'Server Vault — UPS + DEFCON', type: 'เซ็นเซอร์ตรวจจับ',
      x: round2(width / 2), y: round2(length / 2), z: 2, radius_m: 4,
      reason: 'แบตเตอรี + เซิร์ฟเวอร์กลาง — ตรวจจับไฟดับ/อุณหภูมิเกิน → ยกระดับ DEFCON อัตโนมัติ',
      zoneName: 'ศูนย์บัญชาการหยินหยาง',
    },
  ];

  const middleArea = mw * ml - cw * cl;   // วงกลางจริง = 60%
  const coreArea = cw * cl;               // แกนกลาง = 10%
  const outerArea = total - mw * ml;      // วงนอกจริง = 40%

  return {
    totalAreaSqM: total,
    philosophy: 'วงแหวนซ้อน 3 ชั้น (ยิน-หยาง) ปรับตามขนาดที่ดินจริง: 40% แนวป้องกัน · 50% อาหารและน้ำ · 10% ศูนย์บัญชาการ — ผลรวมโซนปิดที่ดินทั้งแปลงโดยไม่มีช่องว่าง',
    land: { width: round2(width), length: round2(length) },
    rings: [
      { id: 'outer', nameTh: 'วงนอก — แนวป้องกัน', nameEn: 'Outer — Perimeter Defense', area_m2: round2(outerArea), pct: 40 },
      { id: 'middle', nameTh: 'วงกลาง — น้ำ/อาหาร', nameEn: 'Middle — Water & Food', area_m2: round2(middleArea), pct: 50 },
      { id: 'core', nameTh: 'แกนกลาง — ศูนย์บัญชาการ', nameEn: 'Core — Command Hub', area_m2: round2(coreArea), pct: 10 },
    ],
    zones,
    points,
  };
}
