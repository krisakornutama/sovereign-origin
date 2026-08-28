import zlib from 'zlib';
import { prisma } from '../lib/prisma';

export { prisma };

// ─────────────────────────────────────────────
// Minimal PNG encoder (RGB, 8-bit) — ไม่พึ่ง library ภายนอก
// (zlib เป็น built-in ของ Node ใช้ compress IDAT ได้)
// ─────────────────────────────────────────────
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** encode RGB buffer → PNG */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // raw scanlines: filter byte 0 + RGB per pixel
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ─────────────────────────────────────────────
// Canvas helper — วาด pixel ลง RGB buffer
// ─────────────────────────────────────────────
interface Canvas {
  W: number;
  H: number;
  rgb: Buffer;
  setPx(x: number, y: number, r: number, g: number, b: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: [number, number, number]): void;
}

function createCanvas(W: number, H: number, bg: [number, number, number] = [15, 23, 42]): Canvas {
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = bg[0];
    rgb[i + 1] = bg[1];
    rgb[i + 2] = bg[2];
  }
  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const o = (y * W + x) * 3;
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  };
  return {
    W, H, rgb,
    setPx,
    fillRect(x, y, w, h, color) {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPx(x + dx, y + dy, color[0], color[1], color[2]);
    },
  };
}

function drawLine(cv: Canvas, x1: number, y1: number, x2: number, y2: number, color: [number, number, number], thickness = 2) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  const rad = Math.floor(thickness / 2);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x1 + ((x2 - x1) * s) / steps);
    const y = Math.round(y1 + ((y2 - y1) * s) / steps);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        cv.setPx(x + dx, y + dy, color[0], color[1], color[2]);
      }
    }
  }
}

// ─────────────────────────────────────────────
// Bitmap font 5×7 (ASCII subset) — เก็บเป็น row strings ตรวจง่าย
// ─────────────────────────────────────────────
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00100', '01100', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '°': ['01110', '10001', '10001', '01110', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** วาดข้อความ (scale 1 = อักษร 5×7) → คืนความกว้างที่ใช้จริง */
function drawText(cv: Canvas, x: number, y: number, text: string, color: [number, number, number], scale = 1): number {
  let cx = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw] || FONT[' '];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        if (glyph[row][col] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              cv.setPx(cx + col * scale + dx, y + row * scale + dy, color[0], color[1], color[2]);
            }
          }
        }
      }
    }
    cx += 6 * scale; // 5px + 1px ระยะห่าง
  }
  return cx - x;
}

// ─────────────────────────────────────────────
// กราฟเส้นเดี่ยว (สำหรับ alert critical)
// ─────────────────────────────────────────────
export function drawTrendPng(points: { time: number; value: number }[], width = 640, height = 240): Buffer {
  const cv = createCanvas(width, height);
  if (points.length < 2) return encodePng(cv.W, cv.H, cv.rgb); // ข้อมูลไม่พอวาดเส้น → คืนภาพว่าง

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 24;

  const px = (i: number) => Math.round(10 + (i / (points.length - 1)) * (cv.W - 20));
  const py = (v: number) => Math.round(padY + (1 - (v - min) / range) * (cv.H - 2 * padY));

  // grid แนวนอน 4 เส้น (#374151)
  for (let g = 0; g <= 4; g++) {
    const y = Math.round(padY + (g / 4) * (cv.H - 2 * padY));
    for (let x = 0; x < cv.W; x++) cv.setPx(x, y, 55, 65, 81);
  }

  // เส้นข้อมูล (#10b981) หนา 3px
  const lineColor: [number, number, number] = [16, 185, 129];
  for (let i = 0; i < points.length - 1; i++) {
    drawLine(cv, px(i), py(points[i].value), px(i + 1), py(points[i + 1].value), lineColor, 3);
  }

  // จุดสุดท้าย (วงกลมใหญ่)
  const lx = px(points.length - 1);
  const ly = py(points[points.length - 1].value);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy <= 9) cv.setPx(lx + dx, ly + dy, 52, 211, 153);
    }
  }

  return encodePng(cv.W, cv.H, cv.rgb);
}

// ─────────────────────────────────────────────
// กราฟหลาย metric (multi-series) — ใช้ในรายงาน
// แต่ละ series normalizes ด้วย min/max ของตัวเอง
// (เทียบรูปร่างแนวโน้มข้าม metric ได้; ค่าจริงอยู่ใน legend)
// ─────────────────────────────────────────────
export interface TrendSeries {
  label: string;
  points: { time: number; value: number }[];
}

const SERIES_COLORS: [number, number, number][] = [
  [16, 185, 129],  // emerald
  [59, 130, 246],  // blue
  [245, 158, 11],  // amber
  [236, 72, 153],  // pink
  [139, 92, 246],  // violet
  [14, 165, 233],  // sky
];

function round1(n: number): number {
  return Number(n.toFixed(1));
}

export function drawMultiTrendPng(series: TrendSeries[], width = 640, height = 320): Buffer {
  const cv = createCanvas(width, height);
  if (series.length === 0) return encodePng(cv.W, cv.H, cv.rgb);

  const textColor: [number, number, number] = [229, 231, 235];
  const gridColor: [number, number, number] = [55, 65, 81];

  // ── legend (ล่าง) ──
  const items = series.map((s, i) => {
    const last = s.points[s.points.length - 1].value;
    return { color: SERIES_COLORS[i % SERIES_COLORS.length], label: `${s.label} ${round1(last)}` };
  });
  const itemWidth = (label: string) => 12 + label.length * 6; // สี่เหลี่ยม + ช่องว่าง + ข้อความ
  const totalLegendWidth = items.reduce((a, it) => a + itemWidth(it.label) + 10, 0);
  const perRow = totalLegendWidth > cv.W - 24 ? Math.ceil(items.length / 2) : items.length;
  const rows = Math.ceil(items.length / perRow);
  const legendTop = cv.H - rows * 12 - 8;

  // ── ขอบเขตกราฟ ──
  const xLeft = 10;
  const xRight = cv.W - 10;
  const yTop = 10;
  const yBottom = legendTop - 10;

  // grid แนวนอน 4 เส้น
  for (let g = 0; g <= 4; g++) {
    const y = Math.round(yTop + (g / 4) * (yBottom - yTop));
    for (let x = 0; x < cv.W; x++) cv.setPx(x, y, gridColor[0], gridColor[1], gridColor[2]);
  }

  // ── วาดแต่ละ series (normalized ด้วย min/max ตัวเอง) ──
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    if (s.points.length < 2) continue;
    const vals = s.points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const px = (idx: number) => Math.round(xLeft + (idx / (s.points.length - 1)) * (xRight - xLeft));
    const py = (v: number) => Math.round(yBottom - ((v - min) / range) * (yBottom - yTop));

    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    for (let j = 0; j < s.points.length - 1; j++) {
      drawLine(cv, px(j), py(s.points[j].value), px(j + 1), py(s.points[j + 1].value), color, 2);
    }
    // จุดสุดท้าย
    const lx = px(s.points.length - 1);
    const ly = py(s.points[s.points.length - 1].value);
    cv.fillRect(lx - 2, ly - 2, 5, 5, color);
  }

  // ── วาด legend ──
  for (let i = 0; i < items.length; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    let x = 10;
    for (let k = 0; k < col; k++) x += itemWidth(items[k].label) + 10;
    const y = legendTop + row * 12 + 2;
    cv.fillRect(x, y, 8, 8, items[i].color);
    drawText(cv, x + 12, y - 1, items[i].label, textColor, 1);
  }

  return encodePng(cv.W, cv.H, cv.rgb);
}

// ─────────────────────────────────────────────
// สร้าง snapshot จากข้อมูลจริง — ดึงแนวโน้มย้อนหลังตามช่วงเวลาที่กำหนด
// ─────────────────────────────────────────────
export async function buildTrendPng(metric: string, hours = 24, bucketMinutes = 10): Promise<Buffer | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT time_bucket('${bucketMinutes} minutes', time) AS bucket, AVG(value) AS avg_value
       FROM sensor_telemetry
       WHERE metric = $1 AND time >= NOW() - INTERVAL '${hours} hours'
       GROUP BY bucket ORDER BY bucket ASC`,
      metric
    );
    const points = rows
      .filter((r) => r.avg_value != null)
      .map((r) => ({ time: new Date(r.bucket).getTime(), value: Number(r.avg_value) }));
    if (points.length < 2) return null;
    return drawTrendPng(points);
  } catch (err) {
    console.error('Chart snapshot error:', err);
    return null;
  }
}

/** สร้างกราฟรวมหลาย metric ในภาพเดียว (สำหรับรายงาน) */
export async function buildReportPng(metrics: string[], hours = 24, bucketMinutes = 10): Promise<Buffer | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT metric, time_bucket('${bucketMinutes} minutes', time) AS bucket, AVG(value) AS avg_value
       FROM sensor_telemetry
       WHERE metric = ANY($1::text[]) AND time >= NOW() - INTERVAL '${hours} hours'
       GROUP BY metric, bucket ORDER BY metric, bucket ASC`,
      metrics
    );
    const byMetric: Record<string, { time: number; value: number }[]> = {};
    for (const r of rows) {
      if (r.avg_value == null || !r.metric) continue;
      (byMetric[r.metric] ||= []).push({ time: new Date(r.bucket).getTime(), value: Number(r.avg_value) });
    }
    const series: TrendSeries[] = [];
    for (const m of metrics) {
      const pts = byMetric[m];
      if (!pts || pts.length < 2) continue;
      series.push({ label: m, points: pts });
    }
    if (series.length === 0) return null;
    return drawMultiTrendPng(series);
  } catch (err) {
    console.error('Report chart error:', err);
    return null;
  }
}

/** snapshot สำหรับ alert ระดับ critical (ย้อนหลัง 12 ชม. bucket 10 นาที) */
export function buildSnapshotForAlert(alert: { metric: string }): Promise<Buffer | null> {
  return buildTrendPng(alert.metric, 12, 10);
}
