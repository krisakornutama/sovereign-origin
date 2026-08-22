// src/services/predictive.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// P4 — Predictive AI (pure TypeScript ไม่พึ่ง python/scipy)
//   • linearFit()            — regression เชิงเส้น (least squares) + r²
//   • batteryForecastSoc()   — คาดการณ์ว่าแบตจะหมดเมื่อไหร่ (ชั่วโมง + ความมั่นใจ)
//   • rollingZScore()        — คำนวณ z-score แบบเลื่อนบน history
//   • detectAnomalies()      — จุดผิดปกติจาก |z| ≥ threshold
//   • PredictiveWorker       — ตรวจทุก 15 นาที → emit 'alert' (server จัดการ
//                              บันทึก DB + socket + Telegram ให้เอง)
// Pure logic แยกจาก data sources เพื่อเทสต์ง่าย (pattern เดียวกับ power-guard)
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../lib/prisma';
import { automationEmitter } from './automation.service';

export { prisma };

/** metrics ที่ worker ตรวจหาความผิดปกติประจำ */
export const KEY_METRICS = ['battery_soc', 'water_level_cm', 'power_kw', 'temperature', 'humidity'] as const;
/** metrics ที่ route รับได้ (รวม KEY_METRICS + เพิ่มเติม) */
export const METRIC_ALLOWLIST = [
  ...KEY_METRICS,
  'soil_moisture', 'ec_value', 'ph', 'voltage', 'current',
] as const;

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
}

export interface BatteryForecast {
  hoursToEmpty: number | null;
  slopePerHour: number;
  r2: number;
  samples: number;
  direction: 'discharging' | 'charging' | 'flat' | 'insufficient';
}

export interface RollingPoint {
  t: number;
  y: number;
  mean: number;
  std: number;
  z: number;
  anomaly: boolean;
}

export interface AnomalyPoint {
  time: string;
  value: number;
  z: number;
  severity: 'warning' | 'critical';
}

export interface PredictiveDeps {
  loadBatteryHistory: (hours: number) => Promise<Array<{ time: string | Date; value: number }>>;
  loadMetricHistory: (metric: string, hours: number) => Promise<Array<{ time: string | Date; value: number }>>;
  emitAlert: (alert: {
    ruleId: string; metric: string; value: number; threshold: number;
    message: string; severity: 'warning' | 'critical'; timestamp: string;
  }) => void;
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic
// ─────────────────────────────────────────────────────────────────────────────

/** regression เชิงเส้นกำลังสองน้อยที่สุด — null เมื่อข้อมูลไม่พอ/ไม่มี variance */
export function linearFit(points: Array<{ t: number; y: number }>): LinearFit | null {
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.t, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.t * p.t, 0);
  const sxy = pts.reduce((a, p) => a + p.t * p.y, 0);
  const syy = pts.reduce((a, p) => a + p.y * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null; // t ไม่มี variance
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = Math.max(0, syy - intercept * sy - slope * sxy);
  const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 1;
  return { slope, intercept, r2 };
}

/**
 * คาดการณ์ว่า SOC จะถึงศูนย์เมื่อไหร่ (ชั่วโมงนับจากจุดล่าสุด)
 * slope ≥ 0 (ชาร์จ/Flat) หรือข้อมูลไม่พอ → daysToEmpty = null
 */
export function batteryForecastSoc(
  samples: Array<{ t: number; y: number }>
): BatteryForecast {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const fit = linearFit(sorted);
  if (!fit) {
    return { hoursToEmpty: null, slopePerHour: 0, r2: 0, samples: samples.filter(p => Number.isFinite(p.t) && Number.isFinite(p.y)).length, direction: 'insufficient' };
  }
  if (fit.slope >= 0) {
    return {
      hoursToEmpty: null,
      slopePerHour: fit.slope,
      r2: fit.r2,
      samples: sorted.length,
      direction: fit.slope > 0.0001 ? 'charging' : 'flat',
    };
  }
  const lastT = sorted[sorted.length - 1].t;
  const t0 = -fit.intercept / fit.slope; // จุดที่ trend ตัดศูนย์
  const hoursToEmpty = Math.max(0, t0 - lastT);
  return {
    hoursToEmpty,
    slopePerHour: fit.slope,
    r2: fit.r2,
    samples: sorted.length,
    direction: 'discharging',
  };
}

/**
 * z-score แบบเลื่อนหน้าต่าง: ที่จุด i ใช้ mean/std ของ [i-window, i-1] เทียบกับ y[i]
 * std=0 → z=0 (ข้อมูลคงที่ = ไม่ผิดปกติ) ; ข้อมูลไม่พอ → ข้าม
 */
export function rollingZScore(
  series: Array<{ t: number; y: number }>,
  window = 60,
  zThreshold = 3
): RollingPoint[] {
  const pts = series.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y));
  const out: RollingPoint[] = [];
  if (window < 2) window = 2;
  for (let i = 0; i < pts.length; i++) {
    if (i < window) continue;
    let sum = 0;
    for (let j = i - window; j < i; j++) sum += pts[j].y;
    const mean = sum / window;
    let sq = 0;
    for (let j = i - window; j < i; j++) sq += (pts[j].y - mean) ** 2;
    const std = Math.sqrt(sq / window);
    // std=0 (ข้อมูลคงที่) → ใช้ scale ตามขนาด mean ยังจับ spike ใหญ่ได้; ไม่เช่นนั้น 0
    const z =
      std > 1e-12
        ? (pts[i].y - mean) / std
        : Math.abs(pts[i].y - mean) / Math.abs(mean || 1);
    out.push({
      t: pts[i].t,
      y: pts[i].y,
      mean,
      std,
      z,
      anomaly: Math.abs(z) >= zThreshold,
    });
  }
  return out;
}

/** สกัดจุดผิดปกติ (|z| ≥ threshold) → กลับจากใหม่สุดก่อน, จำกัดจำนวน */
export function detectAnomalies(
  series: Array<{ t: number; y: number }>,
  opts: { window?: number; zThreshold?: number; max?: number } = {}
): AnomalyPoint[] {
  const { window = 60, zThreshold = 3, max = 50 } = opts;
  const rolled = rollingZScore(series, window, zThreshold);
  const anomalies = rolled
    .filter((p) => p.anomaly)
    .map((p) => ({
      time: new Date(p.t).toISOString(),
      value: p.y,
      z: p.z,
      severity: (Math.abs(p.z) >= 5 ? 'critical' : 'warning') as 'warning' | 'critical',
    }))
    .sort((a, b) => (a.time > b.time ? -1 : 1))
    .slice(0, Math.max(1, max));
  return anomalies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data sources (default) — TimescaleDB/Postgres (date_trunc กันจำนวนแถวระเบิด)
// ─────────────────────────────────────────────────────────────────────────────

export const defaultPredictiveDeps: PredictiveDeps = {
  async loadBatteryHistory(hours) {
    return prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT date_trunc('hour', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
       FROM sensor_telemetry
       WHERE metric = 'battery_soc' AND time >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1 ORDER BY 1 ASC`,
      hours
    );
  },
  async loadMetricHistory(metric, hours) {
    return prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT date_trunc('minute', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
       FROM sensor_telemetry
       WHERE metric = $1 AND time >= NOW() - ($2::int * INTERVAL '1 hour')
       GROUP BY 1 ORDER BY 1 ASC`,
      metric,
      hours
    );
  },
  emitAlert(alert) {
    automationEmitter.emit('alert', alert); // server.ts: จด DB + socket + Telegram
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Worker — ตรวจ anomaly ทุก 15 นาที (เริ่มเองใน server.ts)
// ─────────────────────────────────────────────────────────────────────────────

const ANOMALY_COOLDOWN_MS = 6 * 3600000; // กันส่งซ้ำทุก 6 ชม. ต่อ metric

export class PredictiveWorker {
  private timer: NodeJS.Timeout | null = null;
  private lastAlertAt: Record<string, number> = {};
  lastRunAt: string | null = null;
  lastCounts: Record<string, number> = {};

  constructor(private deps: PredictiveDeps) {}

  async runOnce(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const metric of KEY_METRICS) {
      const series = await safeFetch(() => this.deps.loadMetricHistory(metric, 24));
      if (!series || series.length < 12) continue;
      const anomalies = detectAnomalies(
        series.map((s) => ({ t: new Date(s.time).getTime(), y: Number(s.value) })),
        { window: 60, zThreshold: 3 }
      );
      const fresh = anomalies.filter((a) => {
        const last = this.lastAlertAt[metric] || 0;
        return Date.now() - last >= ANOMALY_COOLDOWN_MS;
      });
      if (fresh.length) {
        this.lastAlertAt[metric] = Date.now();
        const top = fresh[0];
        const severity = top.severity;
        this.deps.emitAlert({
          ruleId: `predictive_anomaly_${metric}`,
          metric,
          value: top.value,
          threshold: severity === 'critical' ? 5 : 3,
          message: `${metric} มีค่าผิดปกติ (z=${top.z.toFixed(1)}) ค่า ${top.value} — พบ ${fresh.length} จุดใน 24 ชม.`,
          severity,
          timestamp: new Date().toISOString(),
        });
      }
      counts[metric] = anomalies.length;
    }
    this.lastRunAt = new Date().toISOString();
    this.lastCounts = counts;
    return counts;
  }

  start(intervalMs = 15 * 60000): void {
    if (this.timer) return;
    const setI = this.deps.setInterval || setInterval;
    this.timer = setI(() => {
      this.runOnce().catch((err) => console.error('Predictive worker error:', err));
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    const clearI = this.deps.clearInterval || clearInterval;
    clearI(this.timer);
    this.timer = null;
  }
}

async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error('Predictive fetch error:', (err as Error).message);
    return null;
  }
}

export const predictiveWorker = new PredictiveWorker(defaultPredictiveDeps);

/** แปลงข้อมูล SOC (ชม.) → ฟอร์แมตข้อมูลสำเร็จรูปสำหรับ route */
export function batteryForecastFromHistory(
  history: Array<{ time: string | Date; value: number }>
): BatteryForecast {
  return batteryForecastSoc(
    history.map((h) => ({ t: new Date(h.time).getTime() / 3600000, y: Number(h.value) }))
  );
}