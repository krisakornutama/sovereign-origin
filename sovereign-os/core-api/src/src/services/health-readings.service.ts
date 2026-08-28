import { linearFit, detectAnomalies, type AnomalyPoint } from './predictive.service';

export type ReadingType = 'WEIGHT' | 'BP' | 'SUGAR' | 'TEMP';

export const READING_TYPES: ReadingType[] = ['WEIGHT', 'BP', 'SUGAR', 'TEMP'];

export interface ReadingRow {
  value: number;
  systolic: number | null;
  diastolic: number | null;
  measured_at: Date | string;
  note?: string | null;
}

export interface ReferenceCheck {
  level: 'ok' | 'warning' | 'critical' | 'low';
  label: string;
  note: string;
}

export interface ReadingAnalysis {
  type: ReadingType;
  count: number;
  latest: {
    value: number;
    systolic: number | null;
    diastolic: number | null;
    measured_at: string;
    note: string | null;
  } | null;
  trend: 'up' | 'down' | 'flat';
  slopePerDay: number | null;
  changePct: number | null;
  anomalies: AnomalyPoint[];
  reference: ReferenceCheck | null;
}

// ── ขอบเขตค่าที่เป็นไปได้ (กันข้อมูลเพี้ยน) ──
const BOUNDS: Record<ReadingType, { min: number; max: number }> = {
  WEIGHT: { min: 2, max: 400 },        // kg
  BP: { min: 40, max: 300 },           // systolic
  SUGAR: { min: 10, max: 800 },        // mg/dL
  TEMP: { min: 30, max: 45 },          // °C
};

/** ตรวจความถูกต้องของค่าก่อนบันทึก — คืนข้อผิดพลาดหรือ null */
export function validateReading(
  type: ReadingType,
  value: unknown,
  systolic?: unknown,
  diastolic?: unknown
): string | null {
  if (!READING_TYPES.includes(type)) return `type must be one of: ${READING_TYPES.join(', ')}`;
  const num = Number(value);
  const b = BOUNDS[type];
  if (!Number.isFinite(num) || num < b.min || num > b.max) {
    return `value out of range (${b.min}-${b.max}) for ${type}`;
  }
  if (type === 'BP') {
    const sys = Number(systolic);
    const dia = Number(diastolic);
    if (!Number.isFinite(sys) || !Number.isFinite(dia)) return 'BP requires systolic and diastolic';
    if (sys < 40 || sys > 300) return 'systolic out of range (40-300)';
    if (dia < 30 || dia > 200) return 'diastolic out of range (30-200)';
    if (dia >= sys) return 'diastolic must be lower than systolic';
  }
  return null;
}

/** เกณฑ์อ้างอิงคร่าว ๆ (ไม่ใช่วินิจฉัย) สำหรับเตือนค่าที่พ้นช่วง */
export function checkReference(type: ReadingType, value: number, systolic?: number | null, diastolic?: number | null): ReferenceCheck {
  switch (type) {
    case 'BP': {
      const sys = systolic ?? value;
      const dia = diastolic ?? 0;
      if (sys >= 180 || dia >= 120) return { level: 'critical', label: 'สูงวิกฤต', note: `ความดันสูงมาก (${sys}/${dia}) — ปรึกษาแพทย์ทันที` };
      if (sys >= 140 || dia >= 90) return { level: 'warning', label: 'สูง', note: `ความดันสูง (${sys}/${dia}) — สังเกตอาการ/พักผ่อน` };
      if (sys < 90 || dia < 60) return { level: 'low', label: 'ต่ำ', note: `ความดันต่ำ (${sys}/${dia}) — ระวังหน้ามืด` };
      return { level: 'ok', label: 'ปกติ', note: `ความดัน ${sys}/${dia}` };
    }
    case 'SUGAR':
      if (value >= 250) return { level: 'critical', label: 'สูงวิกฤต', note: 'น้ำตาลสูงมาก — ปรึกษาแพทย์' };
      if (value >= 180) return { level: 'warning', label: 'สูง', note: 'น้ำตาลสูง — สังเกตอาการ' };
      if (value < 54) return { level: 'critical', label: 'ต่ำวิกฤต', note: 'น้ำตาลต่ำมาก — รับประทานน้ำตาลเร็ว' };
      if (value < 70) return { level: 'low', label: 'ต่ำ', note: 'น้ำตาลต่ำ — ป้องกันภาวะน้ำตาลต่ำ' };
      return { level: 'ok', label: 'ปกติ', note: `น้ำตาล ${value} mg/dL` };
    case 'TEMP':
      if (value >= 39) return { level: 'critical', label: 'ไข้สูง', note: 'ไข้สูงมาก — ปรึกษาแพทย์' };
      if (value >= 37.5) return { level: 'warning', label: 'มีไข้', note: 'มีไข้ — พักผ่อน/ดื่มน้ำ' };
      if (value <= 35) return { level: 'low', label: 'ต่ำ', note: 'อุณหภูมิต่ำ — ดูแลความอบอุ่น' };
      return { level: 'ok', label: 'ปกติ', note: `อุณหภูมิ ${value}°C` };
    case 'WEIGHT':
      return { level: 'ok', label: 'ปกติ', note: `น้ำหนัก ${value} kg` };
  }
}

/** วิเคราะห์แนวโน้ม + ผิดปกติ (reuse rollingZScore/detectAnomalies จาก P4) */
export function analyzeReadings(
  rows: ReadingRow[],
  type: ReadingType,
  opts: { window?: number; zThreshold?: number; maxAnomalies?: number } = {}
): ReadingAnalysis {
  const { window, zThreshold = 2.5, maxAnomalies = 10 } = opts;
  const sorted = [...rows]
    .filter((r) => Number.isFinite(Number(r.value)))
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
    .slice(-90);

  const points = sorted.map((r) => ({ t: new Date(r.measured_at).getTime(), y: Number(r.value) }));
  const anomalies = detectAnomalies(points, { window: window ?? Math.min(10, Math.max(2, Math.floor(points.length * 0.4))), zThreshold, max: maxAnomalies });

  const fit = linearFit(points);
  const meanY = points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : 0;
  const slopePerDay = fit ? fit.slope * 86400000 : null;
  const eps = 0.0015 * Math.max(1, Math.abs(meanY));
  const trend: 'up' | 'down' | 'flat' = fit && slopePerDay != null
    ? (slopePerDay > eps ? 'up' : slopePerDay < -eps ? 'down' : 'flat')
    : 'flat';

  let changePct: number | null = null;
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.y) > 1e-9) changePct = ((last.y - first.y) / Math.abs(first.y)) * 100;
  }

  const latestRow = sorted[sorted.length - 1] ?? null;
  const latest = latestRow
    ? {
        value: Number(latestRow.value),
        systolic: latestRow.systolic,
        diastolic: latestRow.diastolic,
        measured_at: new Date(latestRow.measured_at).toISOString(),
        note: latestRow.note ?? null,
      }
    : null;

  return {
    type,
    count: sorted.length,
    latest,
    trend,
    slopePerDay,
    changePct,
    anomalies,
    reference: latest ? checkReference(type, latest.value, latest.systolic, latest.diastolic) : null,
  };
}