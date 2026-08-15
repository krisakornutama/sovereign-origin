import { PrismaClient } from '@prisma/client';
import { securityStream } from './security-stream.service';

// ── Relay Anti-Chatter Guard (Phase 6 — ภัยที่ 4: Hardware Chatter) ──
// จำลอง RC Filter/Delay Circuit ด้วยซอฟต์แวร์ — ชั้นแรกก่อนฮาร์ดแวร์จริง:
//  - 1 คำสั่งต่อ relay ต่อ >= 3 วินาที (เทียบเท่า "สับได้ไม่เกิน 1 ครั้ง/3 วิ")
//  - สะสม rapid attempts: 10 ครั้งใน 60 วิ → ล็อก relay (LOCKED) 10 นาที
//    (เหมือนฟิวส์ตัดไฟ) — ปลดได้ด้วย SUPERADMIN เท่านั้น (POST /api/relay/unlock/:relayId)
//  - ตรวจจับ chatter จากอุปกรณ์: MQTT relay state มากกว่า 8 ครั้งใน 3 วิ
//    (ชิป/เฟิร์มแวร์รวน — เช่น Buffer Overflow ใน Wi-Fi stack) → RELAY_CHATTER ระดับ critical
// เมื่อจับได้ → securityEvent + SSE push ให้ทุกหน้าเห็นก่อนแผงไฟจะไหม้

export const RELAY_MIN_INTERVAL_MS = 3000;
export const RELAY_LOCK_THRESHOLD = 10;
export const RELAY_LOCK_WINDOW_MS = 60_000;
export const RELAY_LOCK_DURATION_MS = 10 * 60_000;
export const MQTT_CHATTER_THRESHOLD = 8;
export const MQTT_CHATTER_WINDOW_MS = 3000;

export const prisma = new PrismaClient();

class RelayGuardService {
  private lastCommandAt = new Map<string, number>();
  private recentAttempts = new Map<string, number[]>();
  private lockedUntil = new Map<string, number>();
  private deviceChatter: Record<string, number[]> = {};
  private locksRaised = new Set<string>();

  /** ตรวจก่อนส่งคำสั่ง — คืน { allowed, reason?, locked, unlockAt? } */
  check(relayId: string): { allowed: boolean; reason?: string; locked: boolean; unlockAt?: number } {
    const now = Date.now();
    const lockUntil = this.lockedUntil.get(relayId) ?? 0;
    if (lockUntil > now) {
      return { allowed: false, reason: `relay ถูกล็อกด้วย anti-chatter (ปลดได้ ${new Date(lockUntil).toLocaleTimeString('th-TH')})`, locked: true, unlockAt: lockUntil };
    }

    const last = this.lastCommandAt.get(relayId) ?? 0;
    if (now - last < RELAY_MIN_INTERVAL_MS) {
      const attempts = this.recentAttempts.get(relayId) ?? [];
      attempts.push(now);
      this.recentAttempts.set(relayId, attempts.filter((t) => now - t <= RELAY_LOCK_WINDOW_MS));
      if (attempts.length >= RELAY_LOCK_THRESHOLD) {
        this.lockedUntil.set(relayId, now + RELAY_LOCK_DURATION_MS);
        this.raise(relayId, 'rapid_commands', `ส่งคำสั่งถี่เกิน ${RELAY_LOCK_THRESHOLD} ครั้งใน ${RELAY_LOCK_WINDOW_MS / 1000} วิ — ล็อกอัตโนมัติ 10 นาที (ฟิวส์ตัด)`, 'critical');
        return { allowed: false, reason: 'relay ถูกล็อก: chatter guard (ฟิวส์ตัด)', locked: true, unlockAt: now + RELAY_LOCK_DURATION_MS };
      }
      return { allowed: false, reason: `anti-chatter: ต้องเว้น >= ${RELAY_MIN_INTERVAL_MS / 1000} วิระหว่างคำสั่ง`, locked: false };
    }
    this.lastCommandAt.set(relayId, now);
    const attempts = this.recentAttempts.get(relayId) ?? [];
    this.recentAttempts.set(relayId, attempts.filter((t) => now - t <= RELAY_LOCK_WINDOW_MS));
    return { allowed: true, locked: false };
  }

  /** อุปกรณ์ส่ง relay state บ่อยผิดปกติ (ชิปรวน/relay chatter) — เรียกจาก MQTT worker */
  async onDeviceState(nodeId: string, relayId: string): Promise<boolean> {
    const now = Date.now();
    const key = `${nodeId}/${relayId}`;
    const stamps = (this.deviceChatter[key] ?? []).filter((t) => now - t <= MQTT_CHATTER_WINDOW_MS);
    stamps.push(now);
    this.deviceChatter[key] = stamps;
    if (stamps.length >= MQTT_CHATTER_THRESHOLD) {
      this.deviceChatter[key] = [];
      await this.raise(
        relayId,
        'device_chatter',
        `ชิป/เฟิร์มแวร์ ${key} สับ relay ${stamps.length} ครั้งใน ${MQTT_CHATTER_WINDOW_MS / 1000} วิ — Relay Chattering! ตัดไฟ/ถอดจ่ายไฟทันที (ล็อก ${RELAY_LOCK_DURATION_MS / 60000} นาที)`,
        'critical'
      );
      this.lockedUntil.set(relayId, now + RELAY_LOCK_DURATION_MS);
      return true;
    }
    return false;
  }

  unlock(relayId: string): boolean {
    const had = this.lockedUntil.has(relayId);
    this.lockedUntil.delete(relayId);
    this.recentAttempts.delete(relayId);
    return had;
  }

  status() {
    const now = Date.now();
    const locks: { relayId: string; locked: boolean; unlockAt: number | null }[] = [];
    for (const [id, until] of this.lockedUntil) {
      locks.push({ relayId: id, locked: until > now, unlockAt: until > now ? until : null });
    }
    return { locks };
  }

  private async raise(relayId: string, type: string, detail: string, severity: 'warning' | 'critical') {
    const key = `${relayId}:${type}`;
    if (this.locksRaised.has(key)) return; // ยก alert ซ้ำในรอบล็อกเดียวกัน
    this.locksRaised.add(key);
    setTimeout(() => this.locksRaised.delete(key), RELAY_LOCK_DURATION_MS).unref();
    securityStream.push('RELAY_CHATTER', { relayId, type, detail });
    try {
      await prisma.securityEvent.create({
        data: {
          event_type: 'RELAY_CHATTER',
          severity,
          description: `⚡ RELAY_CHATTER [${type}] relay=${relayId}: ${detail}`,
          raw_data: { relayId, type },
        },
      });
    } catch (err) {
      console.error('Relay-chatter event write error:', err instanceof Error ? err.message : err);
    }
    console.warn(`⚡ RELAY_CHATTER [${type}] relay=${relayId}: ${detail}`);
  }
}

export const relayGuard = new RelayGuardService();