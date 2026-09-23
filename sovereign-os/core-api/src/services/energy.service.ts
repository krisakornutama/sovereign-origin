// src/services/energy.service.ts
// ENERGY เต็มรูป — ระบบวัดพลังงานโรงงาน/บ้านเล็ก
// 1) energy_readings เก็บค่าวัดต่อเนื่อง (ingest จาก MQTT/sensor + ใส่มือได้)
// 2) energy_thresholds เพดานการใช้ต่อช่วงเวลา (global / node / device)
// 3) เกินเพดาน → เตือน Telegram ผ่าน pipeline เดิม (sendTelegramAlert — dedup/rate-limit ให้แล้ว)
import { prisma } from '../lib/prisma';
import { sendTelegramAlert } from './telegram-alert.service';

/** เมตริกพลังงานที่ระบบรับเข้า — รายชื่ออยู่จุดเดียว */
export const ENERGY_METRICS = ['power_kw', 'energy_kwh', 'battery_soc'] as const;
export type EnergyMetric = (typeof ENERGY_METRICS)[number];

export function isEnergyMetric(metric: string): metric is EnergyMetric {
  return (ENERGY_METRICS as readonly string[]).includes(metric);
}

// ความจุแบตเตอรี่ (kWh) — ตั้งได้ผ่าน env (ค่าเดิมของโมดูล)
const CAPACITY_KWH = parseFloat(process.env.ENERGY_CAPACITY_KWH || '5');

/** บันทึกค่าวัดพลังงาน 1 แถว — ใช้จาก ingest hook และ POST /readings (ใส่มือ) */
export async function ingestReading(input: {
  node_id: string;
  device_id?: string;
  metric: string;
  value: number;
  read_at?: Date;
}): Promise<any> {
  return prisma.energyReading.create({
    data: {
      node_id: input.node_id,
      device_id: input.device_id || 'mqtt-auto',
      metric: input.metric,
      value: input.value,
      read_at: input.read_at ?? new Date(),
    },
  });
}

/** ค่าเฉลี่ยกำลังไฟ (kW) ย้อนหลัง windowMin นาที — null เมื่อไม่มีข้อมูล */
export async function avgPowerKw(opts: {
  node_id?: string;
  device_id?: string;
  windowMin: number;
}): Promise<number | null> {
  const where: any = {
    metric: 'power_kw',
    read_at: { gte: new Date(Date.now() - opts.windowMin * 60_000) },
  };
  if (opts.node_id) where.node_id = opts.node_id;
  if (opts.device_id) where.device_id = opts.device_id;
  const agg = await prisma.energyReading.aggregate({ where, _avg: { value: true } });
  return agg._avg.value ?? null;
}

export interface ThresholdBreach {
  thresholdId: string;
  scope: string;
  scopeName: string;
  metric: string;
  maxKw: number;
  windowMin: number;
  avgKw: number;
}

/** ตรวจทุกเพดานที่ active — คืนรายการที่เกิน (ไม่ยิงแจ้งเตือนเอง เพื่อให้ประกอบได้อิสระ) */
export async function checkThresholds(): Promise<ThresholdBreach[]> {
  const thresholds = await prisma.energyThreshold.findMany({ where: { isActive: true } });
  const breaches: ThresholdBreach[] = [];
  for (const t of thresholds) {
    const scopeFilter =
      t.scope === 'node' ? { node_id: t.scopeName } : t.scope === 'device' ? { device_id: t.scopeName } : {};
    const avg = await avgPowerKw({ ...scopeFilter, windowMin: t.windowMin });
    if (avg != null && avg > t.maxKw) {
      breaches.push({
        thresholdId: t.id,
        scope: t.scope,
        scopeName: t.scopeName,
        metric: t.metric,
        maxKw: t.maxKw,
        windowMin: t.windowMin,
        avgKw: Math.round(avg * 100) / 100,
      });
    }
  }
  return breaches;
}

const shortId = (id: string) => (id.length >= 8 ? id.slice(0, 8) : id);

/** ตรวจเพดาน + เตือน Telegram เฉพาะรายการที่เกิน — fire-and-forget แบบเดียวกับ pipeline เดิม */
export async function checkAndAlert(): Promise<ThresholdBreach[]> {
  const breaches = await checkThresholds();
  for (const b of breaches) {
    const whereLabel = b.scope === 'global' ? 'ทั้งระบบ' : `${b.scope} ${shortId(b.scopeName)}`;
    sendTelegramAlert({
      text:
        `⚡ พลังงานเกินเพดาน — ${whereLabel}\n` +
        `เฉลี่ย ${b.windowMin} นาทีล่าสุด: ${b.avgKw} kW (เพดาน ${b.maxKw} kW)\n` +
        `เวลา: ${new Date().toLocaleString('th-TH')}`,
      severity: 'warn',
      eventKey: `energy-threshold:${b.thresholdId}`,
    }).catch(() => {});
  }
  return breaches;
}

/** สรุปพลังงาน — อ่านจาก energy_readings ก่อน ถ้าว่าง fallback ไป sensor_telemetry (ข้อมูลเดิม) */
export async function getSummary(): Promise<Record<string, any>> {
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const [socRow, powerLatestRow, avg24] = await Promise.all([
    prisma.energyReading.findFirst({ where: { metric: 'battery_soc' }, orderBy: { read_at: 'desc' } }),
    prisma.energyReading.findFirst({ where: { metric: 'power_kw' }, orderBy: { read_at: 'desc' } }),
    prisma.energyReading.aggregate({
      where: { metric: 'power_kw', read_at: { gte: since24h } },
      _avg: { value: true },
    }),
  ]);

  let batterySoc = socRow?.value ?? null;
  let powerKwLatest = powerLatestRow?.value ?? null;
  let avgPower = avg24._avg.value ?? null;
  let source = 'energy_readings';

  // fallback — ตารางเดิม (sensor_telemetry raw) ยังมีประวัติอยู่ ใช้ต่อได้ทันทีแม้ยังไม่มีคน ingest ใหม่
  if (batterySoc == null && powerKwLatest == null && avgPower == null) {
    source = 'sensor_telemetry';
    const latestRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT ON (metric) metric, value
       FROM sensor_telemetry
       WHERE metric IN ('battery_soc', 'power_kw')
       ORDER BY metric, time DESC`
    );
    const latest: Record<string, number> = {};
    for (const r of latestRows) latest[r.metric] = Number(r.value);
    const avgRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT AVG(value) AS avg_power
       FROM sensor_telemetry
       WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
    );
    batterySoc = latest.battery_soc != null ? latest.battery_soc : null;
    powerKwLatest = latest.power_kw != null ? latest.power_kw : null;
    avgPower = avgRows[0]?.avg_power != null ? Number(avgRows[0].avg_power) : null;
  }

  let status: 'no_data' | 'discharging' | 'charging' | 'balanced' = 'no_data';
  let hoursRemaining: number | null = null;
  if (batterySoc != null && avgPower != null) {
    if (avgPower < -0.001) {
      status = 'discharging';
      hoursRemaining = (batterySoc / 100) * CAPACITY_KWH / Math.abs(avgPower);
    } else if (avgPower > 0.001) {
      status = 'charging';
    } else {
      status = 'balanced';
    }
  }
  const kwhNet24h = avgPower != null ? avgPower * 24 : null;

  return {
    battery_soc: batterySoc != null ? Math.round(batterySoc * 10) / 10 : null,
    power_kw_avg_24h: avgPower != null ? Math.round(avgPower * 100) / 100 : null,
    power_kw_latest: powerKwLatest != null ? Math.round(powerKwLatest * 100) / 100 : null,
    kwh_net_24h: kwhNet24h != null ? Math.round(kwhNet24h * 100) / 100 : null,
    hours_remaining: hoursRemaining != null ? Math.round(hoursRemaining * 10) / 10 : null,
    capacity_kwh: CAPACITY_KWH,
    status,
    source,
  };
}
