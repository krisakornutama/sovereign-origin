import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

const prisma = new PrismaClient();

// ── Maintenance Radar (Sovereignty Tax — ภัย 4) ──
// ระบบ 40 modules = 780 จุดเชื่อมต่อ = ภาษีอธิปไตย: เวลาชีวิตที่ต้องจ่ายค่าซ่อมบำรุงตลอดไป
// วิธีรับมือ: ทำให้ทุกงานบำรุงรักษา "มองเห็น + กำหนดวันครบ + ตรวจจับได้อัตโนมัติ"
//  ไม่ใช่ความรู้สึกคลุมเครือว่า "ต้องหาเวลาดูระบบ"
// ประเมิน "ชั่วโมงภาษี/เดือน" จากงานที่ครบกำหนดจริง เพื่อให้เห็นต้นทุนเวลาชัดเจน

export interface MaintenanceTask {
  id: string;
  label: string;
  intervalDays: number;
  effortH: number; // ชั่วโมงแรงงานมนุษย์ที่ต้องใช้
  auto: boolean; // ระบบทำได้เอง (เช่น backup)
  lastDoneAt: number | null;
  lastDoneBy: string;
}

export interface MaintenanceStatus {
  tasks: (MaintenanceTask & { dueInDays: number; overdue: boolean })[];
  taxHoursThisMonth: number;
  taxHoursEstimate: number;
  driftFlags: { message: string; at: number }[];
  updatedAt: number;
}

export interface DriftFlag {
  message: string;
  at: number;
}

const DATA_FILE =
  process.env.MAINTENANCE_RADAR_FILE || path.resolve(process.cwd(), 'data', 'maintenance-radar.json');

const DEFAULT_TASKS: Omit<MaintenanceTask, 'lastDoneAt' | 'lastDoneBy'>[] = [
  { id: 'sensor-battery', label: 'เปลี่ยนแบตเตอรี่เซ็นเซอร์ (ESP32 + เซ็นเซอร์ไร้สาย)', intervalDays: 180, effortH: 1.5, auto: false },
  { id: 'sensor-calibration', label: 'Calibrate เซ็นเซอร์ (อุณหภูมิ/ความชื้น/PMS)', intervalDays: 90, effortH: 1.0, auto: false },
  { id: 'backup-verify', label: 'ตรวจ backup ล่าสุด (72 ชม. ต้องมี) + test restore', intervalDays: 7, effortH: 0.5, auto: true },
  { id: 'container-update', label: 'อัปเดต containers + ตรวจภาพ (หลัง update ต้อง backup ก่อน)', intervalDays: 30, effortH: 1.0, auto: false },
  { id: 'chaos-drill', label: 'ซ้อมวิกฤต (Chaos Drill ที่หน้า System Health)', intervalDays: 30, effortH: 0.25, auto: false },
  { id: 'mqtt-health', label: 'ตรวจ EMQX log + ความหน่วงการเชื่อมต่ออุปกรณ์', intervalDays: 14, effortH: 0.25, auto: false },
];

interface RadarData {
  lastDone: Record<string, { at: number; by: string }>;
  driftFlags: DriftFlag[];
}

function load(): RadarData {
  const { data } = readJsonVerified<RadarData>(DATA_FILE);
  if (data) {
    return {
      lastDone: data.lastDone && typeof data.lastDone === 'object' ? data.lastDone : {},
      driftFlags: Array.isArray(data.driftFlags) ? data.driftFlags.slice(-20) : [],
    };
  }
  return { lastDone: {}, driftFlags: [] };
}

function save(data: RadarData) {
  saveJsonAtomic(DATA_FILE, data);
}

class MaintenanceRadarService {
  private data: RadarData = { lastDone: {}, driftFlags: [] };

  init() {
    this.data = load();
  }

  private taskRows(): (MaintenanceTask & { dueInDays: number; overdue: boolean })[] {
    const now = Date.now();
    return DEFAULT_TASKS.map((t) => {
      const last = this.data.lastDone[t.id];
      const lastAt = last?.at ?? now - t.intervalDays * 86400000; // ยังไม่เคยทำ → ถือว่าครบกำหนดตั้งแต่แรก
      const dueAt = lastAt + t.intervalDays * 86400000;
      const dueInDays = Math.ceil((dueAt - now) / 86400000);
      return {
        ...t,
        lastDoneAt: last?.at ?? null,
        lastDoneBy: last?.by ?? '',
        dueInDays,
        overdue: dueInDays <= 0,
      };
    });
  }

  status(): MaintenanceStatus {
    const rows = this.taskRows();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const taxHoursThisMonth = rows
      .filter((r) => r.dueInDays <= 30 && (r.lastDoneAt ?? 0) >= monthStart)
      .reduce((a, r) => a + r.effortH, 0);
    const taxHoursEstimate = rows
      .filter((r) => r.dueInDays <= 30)
      .reduce((a, r) => a + (r.auto ? r.effortH * 0.1 : r.effortH), 0);
    return {
      tasks: rows,
      taxHoursThisMonth: Math.round(taxHoursThisMonth * 10) / 10,
      taxHoursEstimate: Math.round(taxHoursEstimate * 10) / 10,
      driftFlags: [...this.data.driftFlags].reverse(),
      updatedAt: Date.now(),
    };
  }

  markDone(id: string, by: string): MaintenanceStatus {
    this.data.lastDone[id] = { at: Date.now(), by: by || 'unknown' };
    save(this.data);
    return this.status();
  }

  /** ตรวจจับ sensor drift: เทียบค่าอุณหภูมิ/ความชื้นระหว่าง nodes — ต่างกันเกินเกณฑ์ = สงสัยดริฟต์ */
  async driftCheck(): Promise<DriftFlag[]> {
    const flags: DriftFlag[] = [];
    try {
      const rows: { node_id: string; metric: string; value: number }[] = await prisma.$queryRaw`
        SELECT DISTINCT ON (node_id, metric) node_id, metric, value
        FROM sensor_telemetry
        WHERE metric IN ('temperature', 'humidity') AND time > now() - interval '10 minutes'
        ORDER BY node_id, metric, time DESC`;
      const byMetric = new Map<string, { node: string; value: number }[]>();
      for (const r of rows) {
        const arr = byMetric.get(r.metric) ?? [];
        arr.push({ node: String(r.node_id).slice(0, 8), value: r.value });
        byMetric.set(r.metric, arr);
      }
      for (const [metric, list] of byMetric) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) => a.value - b.value);
        const spread = sorted[sorted.length - 1].value - sorted[0].value;
        const threshold = metric === 'temperature' ? 2.5 : 8;
        if (spread > threshold) {
          flags.push({
            message: `⚠️ สงสัย ${metric} drift: ${sorted[0].node}=${sorted[0].value} vs ${sorted[sorted.length - 1].node}=${sorted[sorted.length - 1].value} (ต่าง ${Math.round(spread * 10) / 10}) — ถึงเวลา calibrate เซ็นเซอร์`,
            at: Date.now(),
          });
        }
      }
    } catch {
      // DB ไม่พร้อม → ข้าม
    }
    if (flags.length) {
      this.data.driftFlags = [...this.data.driftFlags, ...flags].slice(-20);
      save(this.data);
    }
    return flags;
  }
}

export const maintenanceRadar = new MaintenanceRadarService();