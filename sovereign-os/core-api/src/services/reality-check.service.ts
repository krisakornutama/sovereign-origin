import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

const prisma = new PrismaClient();

// ── Reality-Check & Paranoia Index (ป้องกัน Synthetic Insanity) ──
// สมาชิกบ้านสามารถยืนยัน/ปฏิเสธการแจ้งเตือนของระบบ:
//   false_positive = AI เตือนผิด (คนนี้คือครอบครัว/เหตุการณ์ปกติ)
//   false_negative = AI ไม่เตือนแต่ควรเตือน
//   context       = ข้อมูลประกอบอื่น (เช่น "นี่คือช่างที่เราจ้างมา")
// Paranoia Index = false-positive (30 วัน) / เหตุการณ์ความปลอดภัยทั้งหมด (30 วัน)
// ถ้า AI เตือนผิดเกินเกณฑ์ → แสดงคำแนะนำ "ลด sensitivity" ให้ SUPERADMIN ตัดสินใจ
// บันทึกทั้งหมดใน data/reality-corrections.json (cap 300 รายการล่าสุด)

export type CorrectionKind = 'false_positive' | 'false_negative' | 'context';

export interface RealityCorrection {
  id: string;
  kind: CorrectionKind;
  note: string;
  by: string;
  ts: number;
  source_type?: string;
  source_event_id?: string;
}

export interface RealityStats {
  corrections30d: number;
  falsePositives30d: number;
  falseNegatives30d: number;
  alerts30d: number;
  paranoiaIndex: number; // 0..1 — อัตราเตือนผิด
  calibration: 'calibrated' | 'watch' | 'unstable'; // watch >0.25, unstable >0.4
  latest: RealityCorrection[];
}

const DATA_FILE =
  process.env.REALITY_CORRECTIONS_FILE || path.resolve(process.cwd(), 'data', 'reality-corrections.json');
const CAP = 300;

function load(): RealityCorrection[] {
  const { data } = readJsonVerified<RealityCorrection[]>(DATA_FILE);
  if (data) return Array.isArray(data) ? data.filter((c) => c && c.kind && c.ts) : [];
  return [];
}

function save(entries: RealityCorrection[]) {
  saveJsonAtomic(DATA_FILE, entries);
}

export function paranoiaCalibration(fpRate: number): RealityStats['calibration'] {
  if (fpRate > 0.4) return 'unstable';
  if (fpRate > 0.25) return 'watch';
  return 'calibrated';
}

class RealityCheckService {
  private entries: RealityCorrection[] = [];

  init() {
    this.entries = load();
  }

  async addCorrection(
    kind: CorrectionKind,
    note: string,
    by: string,
    source?: { type?: string; eventId?: string }
  ): Promise<RealityStats> {
    const entry: RealityCorrection = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      note: (note || '').trim().slice(0, 500),
      by: by || 'unknown',
      ts: Date.now(),
      source_type: source?.type,
      source_event_id: source?.eventId,
    };
    this.entries.push(entry);
    if (this.entries.length > CAP) this.entries = this.entries.slice(-CAP);
    save(this.entries);
    securityStream.push('REALITY', { action: 'correct', kind: entry.kind, note: entry.note, by: entry.by, ts: entry.ts });
    return this.stats();
  }

  /** ดึงคำยืนยันล่าสุด (reality anchors) ไว้ให้ AI อ่านก่อนตอบ */
  anchors(limit = 3): RealityCorrection[] {
    return [...this.entries].reverse().slice(0, limit);
  }

  async stats(): Promise<RealityStats> {
    const since = Date.now() - 30 * 24 * 3600 * 1000;
    const recent = this.entries.filter((c) => c.ts >= since);
    const fp = recent.filter((c) => c.kind === 'false_positive').length;
    const fn = recent.filter((c) => c.kind === 'false_negative').length;
    let alerts30d = 0;
    try {
      alerts30d = await prisma.securityEvent.count({
        where: {
          event_type: { in: ['ANOMALY', 'IDS_ALERT'] },
          timestamp: { gte: new Date(since) },
        },
      });
    } catch {}
    const paranoiaIndex = alerts30d > 0 ? Math.min(1, fp / alerts30d) : 0;
    return {
      corrections30d: recent.length,
      falsePositives30d: fp,
      falseNegatives30d: fn,
      alerts30d,
      paranoiaIndex: Math.round(paranoiaIndex * 1000) / 1000,
      calibration: paranoiaCalibration(paranoiaIndex),
      latest: [...recent].reverse().slice(0, 20),
    };
  }
}

export const realityCheck = new RealityCheckService();