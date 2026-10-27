// src/lib/observability.ts
//
// ── ชั้น "มองเห็นได้" (observability) แบบไม่พึ่ง dependency ใหม่ ──────────────────────
// เจ้าของสั่ง 27/10/69 (เส้นทาง A): ระบบต้องบอกได้ว่า "พังตรงไหน เมื่อไร ใครโดน"
//
// หลักคิด:
//   · ทุกคำขอมี request-id เดียวไล่ได้ทั้งเส้น (รับจาก frontend ได้ถ้าปลอดภัย)
//   · log เป็น JSON บรรทัดเดียว — ไม่มี query string / header / body (กันความลับหลุด)
//   · metrics เป็น text format ของ Prometheus, label ใช้ "route pattern" ไม่ใช่ URL จริง
//     (ถ้าใช้ URL จริง จำนวน label จะระเบิดตาม id ที่เพิ่มขึ้นเรื่อย ๆ)
//
// ไฟล์นี้เป็น pure logic ล้วน — เทสต์ได้โดยไม่ต้องมี DB/Express
import { randomUUID, timingSafeEqual } from 'node:crypto';

const REQUEST_ID_MAX = 64;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * รับ request-id จากภายนอกมาใช้ต่อ (trace ข้าม frontend → API → log)
 * แต่ถ้าหน้าตาไม่ปลอดภัย (ขึ้นบรรทัดใหม่, มีอักขระแปลก, ยาวเกิน) ให้สร้างใหม่
 * เหตุผล: log ที่มี \n ปลอมได้ทั้งบรรทัด = log injection (ปลอมว่าเป็นเหตุการณ์อื่น)
 */
export function normalizeRequestId(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= REQUEST_ID_MAX && SAFE_REQUEST_ID.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

export interface AccessLogInput {
  requestId: string;
  method: string;
  /** path ดิบจาก URL — query string จะถูกตัดทิ้งเสมอ */
  path: string;
  /** route pattern ที่ Express จับได้ เช่น /api/users/:id */
  route?: string | null;
  status: number;
  durationMs: number;
  tenant?: string | null;
  userId?: string | null;
}

export interface AccessLogRecord {
  time: string;
  requestId: string;
  method: string;
  path: string;
  route: string | null;
  status: number;
  durationMs: number;
  tenant: string | null;
  userId: string | null;
}

/**
 * สร้างบรรทัด log แบบโครงสร้างคงที่ (เครื่องมือ parse ได้)
 * ห้ามใส่ header/body/query ลงไปเด็ดขาด — token ใน query string คือรอยรั่วที่พบบ่อยที่สุด
 */
export function accessLogRecord(input: AccessLogInput): AccessLogRecord {
  return {
    time: new Date().toISOString(),
    requestId: input.requestId,
    method: String(input.method || '').toUpperCase(),
    path: stripQuery(input.path),
    route: input.route || null,
    status: Number(input.status) || 0,
    durationMs: Math.round(Number(input.durationMs) || 0),
    tenant: input.tenant || null,
    userId: input.userId || null,
  };
}

/** ตัด query string และ fragment ออก — เก็บเฉพาะ path */
export function stripQuery(path: string): string {
  const raw = String(path || '');
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** escape ตามกติกา Prometheus text format (กลับหลังไม่ได้ = กราฟพัง) */
export function prometheusEscape(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function labelsToKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}\u0000${labels[k]}`).join('\u0001');
}

function renderLabels(labels: Record<string, string>, le?: string): string {
  const keys = Object.keys(labels).sort();
  const parts = keys.map((k) => `${k}="${prometheusEscape(labels[k])}"`);
  // Prometheus วาง le ไว้ท้ายสุดเสมอ — เครื่องมือ parse/เทียบผลจะได้รูปเดียวกันทุกครั้ง
  if (le !== undefined) parts.push(`le="${prometheusEscape(le)}"`);
  if (parts.length === 0) return '';
  return `{${parts.join(',')}}`;
}

interface CounterSeries {
  labels: Record<string, string>;
  value: number;
}

interface HistogramSeries {
  labels: Record<string, string>;
  /** ขอบบนของแต่ละ bucket (เรียงจากน้อยไปมาก) */
  bounds: number[];
  /** จำนวนครั้งที่ค่าน้อยกว่าหรือเท่าขอบบนของ bucket นั้น (ยังไม่สะสม) */
  perBucket: number[];
  sum: number;
  count: number;
}

/** bucket หน่วยมิลลิวินาที — ครอบตั้งแต่ API เร็ว ๆ ไปจนถึงคำขอที่ช้าเกินรับได้ */
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * registry เล็ก ๆ ที่ผลลัพธ์ deterministic (เรียงชื่อ metric + label คงที่)
 * ถ้าไม่ deterministic ทุกครั้งที่ scrape จะได้ diff ปลอม ๆ ใน config management
 */
export class MetricsRegistry {
  private counters = new Map<string, Map<string, CounterSeries>>();
  private histograms = new Map<string, Map<string, HistogramSeries>>();

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const series = this.counters.get(name) ?? new Map<string, CounterSeries>();
    this.counters.set(name, series);
    const key = labelsToKey(labels);
    const found = series.get(key);
    if (found) found.value += by;
    else series.set(key, { labels: { ...labels }, value: by });
  }

  observe(name: string, value: number, labels: Record<string, string> = {}, bucketBounds = DEFAULT_BUCKETS): void {
    const series = this.histograms.get(name) ?? new Map<string, HistogramSeries>();
    this.histograms.set(name, series);
    const key = labelsToKey(labels);
    let found = series.get(key);
    if (!found) {
      const bounds = [...bucketBounds].sort((a, b) => a - b);
      found = { labels: { ...labels }, bounds, perBucket: bounds.map(() => 0), sum: 0, count: 0 };
      series.set(key, found);
    }
    const v = Number.isFinite(Number(value)) ? Number(value) : 0;
    found.sum += v;
    found.count += 1;
    // นับเฉพาะ bucket แรกที่ค่า "พอดี" — ตอน render ค่อยสะสมขึ้นไป (cumulative)
    // ถ้านับทุก bucket ที่ค่า <= ขอบ จะได้ค่าสะสมซ้ำ (bucket สุดท้ายมากกว่าจำนวนครั้งจริง)
    const first = found.bounds.findIndex((b) => v <= b);
    if (first >= 0) found.perBucket[first] += 1;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  render(): string {
    const lines: string[] = [];

    for (const name of [...this.counters.keys()].sort()) {
      const series = this.counters.get(name)!;
      lines.push(`# TYPE ${name} counter`);
      for (const key of [...series.keys()].sort()) {
        const s = series.get(key)!;
        lines.push(`${name}${renderLabels(s.labels)} ${fmtNumber(s.value)}`);
      }
    }

    for (const name of [...this.histograms.keys()].sort()) {
      const series = this.histograms.get(name)!;
      lines.push(`# TYPE ${name} histogram`);
      for (const key of [...series.keys()].sort()) {
        const s = series.get(key)!;
        let cumulative = 0;
        for (let i = 0; i < s.bounds.length; i++) {
          cumulative += s.perBucket[i];
          lines.push(
            `${name}_bucket${renderLabels(s.labels, fmtNumber(s.bounds[i]))} ${cumulative}`,
          );
        }
        lines.push(`${name}_bucket${renderLabels(s.labels, '+Inf')} ${s.count}`);
        lines.push(`${name}_sum${renderLabels(s.labels)} ${fmtNumber(s.sum)}`);
        lines.push(`${name}_count${renderLabels(s.labels)} ${s.count}`);
      }
    }

    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

/**
 * token gate ของ /metrics — "ปิดโดยปริญญา" (fail-closed)
 * ไม่ตั้ง METRICS_TOKEN = ปฏิเสธทุกคำขอ (ไม่ใช่เปิดโล่งให้ใครก็ได้อ่านภารกิจทั้งระบบ)
 */
export function isMetricsAuthorized(provided: unknown, expected: unknown): boolean {
  if (typeof expected !== 'string') return false;
  const want = expected.trim();
  if (want.length === 0) return false;
  if (typeof provided !== 'string') return false;
  const got = provided.trim();
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(want, 'utf8'));
}
