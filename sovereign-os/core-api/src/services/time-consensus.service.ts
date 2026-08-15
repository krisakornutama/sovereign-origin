import { PrismaClient } from '@prisma/client';
import { securityStream } from './security-stream.service';

export const prisma = new PrismaClient();

// ── Time-Consensus Engine (Phase 6 — ภัยที่ 2: Byzantine Time Drift & NTP Poisoning) ──
// ระบบ local-first ผูกกับ System Clock ทั้งหมด (TLS, tokens, SSE replay, cron, solar calc)
// ตัวนี้เฝ้าเวลาทุก 60 วินาที และตรวจจับ 3 อาการ:
//  1) Clock Jump   — นาฬิกากระโดด/ถอยหลัง > 2 วินาที ภายในรอบตรวจ (NTP step / spoof / BIOS เสื่อม)
//  2) DB Desync    — เวลาเครื่อง Server เบี่ยงจากฐานข้อมูล > 2 วินาที (แหล่งอ้างอิงที่ 2)
//  3) Non-Causal   — securityEvents ใหม่เกิดก่อนของเก่า > 2 วินาที (logs หมดลำดับเหตุ)
// เมื่อจับได้ → securityEvent TIME_DESYNC + SSE push → UI ทุกหน้าเห็นทันที
// หมายเหตุฮาร์ดแวร์: RTC ภายนอก (DS3231) + GPS NMEA เป็นแหล่งอ้างอิงจริง — อยู่ใน Phase-6 checklist

const DESYNC_THRESHOLD_MS = 2000;

interface TimeAnomaly {
  at: number;
  type: 'clock_jump' | 'db_desync' | 'log_order';
  detail: string;
  deltaMs: number;
}

class TimeConsensusService {
  private lastLocalMs: number | null = null;
  private lastDbMs: number | null = null;
  private lastCheckAt: number | null = null;
  private lastDbDesyncMs = 0;
  private jumps: number[] = [];
  private anomalies: TimeAnomaly[] = [];
  private checks = 0;
  private dbUnreachableStreak = 0;

  async check(): Promise<TimeAnomaly[]> {
    const now = Date.now();
    const found: TimeAnomaly[] = [];
    this.checks++;

    // ── 1) Clock jump: เทียบเวลาจริงที่ผ่านไป vs นาฬิกาที่เดินไป ──
    if (this.lastLocalMs !== null && this.lastCheckAt !== null) {
      const elapsed = now - this.lastCheckAt;
      const wallDelta = now - this.lastLocalMs;
      if (Math.abs(wallDelta - elapsed) > DESYNC_THRESHOLD_MS) {
        const deltaMs = wallDelta - elapsed;
        this.jumps.push(now);
        if (this.jumps.length > 10) this.jumps.shift();
        found.push({ at: now, type: 'clock_jump', detail: `นาฬิกากระโดด/ถอย ${deltaMs > 0 ? '+' : ''}${deltaMs} ms`, deltaMs });
      }
    }
    this.lastLocalMs = now;
    this.lastCheckAt = now;

    // ── 2) DB desync: เวลาเครื่อง vs เวลา PostgreSQL (ต่าง container/host) ──
    try {
      const rows = await prisma.$queryRawUnsafe<{ now: Date }[]>(`SELECT NOW() AS now`);
      const dbMs = new Date(rows[0].now).getTime();
      const dbDesync = dbMs - now;
      this.lastDbMs = dbMs;
      this.lastDbDesyncMs = dbDesync;
      this.dbUnreachableStreak = 0;
      if (Math.abs(dbDesync) > DESYNC_THRESHOLD_MS) {
        found.push({
          at: now,
          type: 'db_desync',
          detail: `เวลา Server ต่างจาก DB ${dbDesync > 0 ? '+' : ''}${Math.round(dbDesync)} ms (RTC/BIOS/NTP ต้องตรวจ)`,
          deltaMs: dbDesync,
        });
      }
    } catch {
      this.dbUnreachableStreak++;
      if (this.dbUnreachableStreak >= 5) {
        found.push({
          at: now,
          type: 'db_desync',
          detail: `DB ตามเวลาไม่ได้ ${this.dbUnreachableStreak} รอบติด (แหล่งอ้างอิงที่ 2 ตัดออก)`,
          deltaMs: 0,
        });
        this.dbUnreachableStreak = 0;
      }
    }

    // ── 3) Non-causal log order: เหตุการณ์ล่าสุด 25 ตัวต้องไม่ถอยหลังเกิน 2 วิ ──
    try {
      const events = await prisma.securityEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: 25,
        select: { id: true, timestamp: true, event_type: true },
      });
      for (let i = 0; i < events.length - 1; i++) {
        const older = new Date(events[i + 1].timestamp).getTime();
        const newer = new Date(events[i].timestamp).getTime();
        const regression = older - newer; // >0 = ตัวเก่าถูกบันทึกทีหลัง (ลำดับไม่ causal)
        if (regression > DESYNC_THRESHOLD_MS) {
          found.push({
            at: now,
            type: 'log_order',
            detail: `Log ผิดลำดับเวลา: ${events[i + 1].event_type} (#${events[i + 1].id.slice(0, 8)}) เกิดก่อนของเก่าแต่ timestamp ใหม่กว่า ${Math.round(regression)} ms`,
            deltaMs: regression,
          });
          break;
        }
      }
    } catch {
      // DB ล่มชั่วคราว — ไม่ถือเป็น time anomaly
    }

    for (const a of found) {
      this.anomalies.push(a);
      if (this.anomalies.length > 10) this.anomalies.shift();
      await this.raise(a);
    }
    return found;
  }

  private async raise(a: TimeAnomaly): Promise<void> {
    securityStream.push('TIME_DESYNC', a);
    try {
      await prisma.securityEvent.create({
        data: {
          event_type: 'TIME_DESYNC',
          severity: 'critical',
          description: `⏰ TIME_DESYNC [${a.type}]: ${a.detail}`,
          raw_data: { ...a, at: new Date(a.at).toISOString() },
        },
      });
    } catch (err) {
      console.error('Time-consensus event write error:', err instanceof Error ? err.message : err);
    }
    console.warn(`⏰ TIME_DESYNC [${a.type}]: ${a.detail}`);
  }

  status() {
    const lastAnomaly = this.anomalies[this.anomalies.length - 1] ?? null;
    const lastAnomalyMsAgo =
      this.anomalies.length > 0 && this.anomalies[this.anomalies.length - 1].at
        ? Date.now() - this.anomalies[this.anomalies.length - 1].at
        : null;
    return {
      ok: this.anomalies.length === 0 || lastAnomalyMsAgo! > 24 * 3600 * 1000,
      checks: this.checks,
      lastCheckAt: this.lastCheckAt,
      dbDesyncMs: Math.round(this.lastDbDesyncMs),
      lastDbMs: this.lastDbMs,
      jumps: this.jumps.length,
      lastJumpMsAgo: this.jumps.length ? Date.now() - this.jumps[this.jumps.length - 1] : null,
      anomalies: this.anomalies.map((a) => ({ ...a, at: new Date(a.at).toISOString() })),
    };
  }
}

export const timeConsensus = new TimeConsensusService();