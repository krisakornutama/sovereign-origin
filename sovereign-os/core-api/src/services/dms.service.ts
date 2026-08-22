// src/services/dms.service.ts
// Series 🔴 — External Dead-Man Switch (DMS) — ฝั่ง server
// สเปก: docs/SERIES_RED_DMS_BLUEPRINT.md
// - POST /api/v1/dms/ping: HMAC-SHA256 rolling key (หมุนทุก 5 นาที) + seq monotonic + window 60s
// - บันไดวิกฤต: >MISSED_MS (ระดับ 1, SUSPECT) → >FAILOVER_MS (ระดับ 2, FAILOVER_ACTIVE + WoL ถ้าตั้ง)
// - audit เฉพาะเหตุการณ์ (ไม่ใช่ทุก ping): DMS_PING_MISSED / DMS_FAILOVER_TRIGGERED /
//   DMS_PING_RECOVERED / DMS_SIGNATURE_FAIL + securityStream.push('DMS', ...) + Telegram alert
// - persistence: data/dms-state.json (เขียน atomic + checksum — ผ่าน data-integrity.service)
// - DMS_DRY_RUN=true: คำนวณลาดเดอร์ครบ แต่ไม่ยิง WoL/Telegram จริง (log อย่างเดียว)
import path from 'path';
import dgram from 'dgram';
import crypto from 'crypto';
import { config } from '../config';
import { securityStream } from './security-stream.service';
import { sendTelegramAlert } from './telegram-alert.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import type { AlertSeverity } from './telegram-alert.service';
import { prisma } from '../lib/prisma';


// ── Rolling-key HMAC (blueprint §3) ──
// KEY(t) = SHA256(DMS_MASTER_SECRET || FLOOR(t / 300))   ← หมุนทุก 5 นาที
// SIG    = HMAC-SHA256(KEY(t), t || device_id || seq)
export const DMS_KEY_ROTATION_SEC = 300;

export function rollingKey(secret: string, t: number): Buffer {
  return crypto
    .createHash('sha256')
    .update(`${secret}${Math.floor(t / DMS_KEY_ROTATION_SEC)}`)
    .digest();
}

export function signDmsPing(secret: string, deviceId: string, ts: number, seq: number): string {
  const key = rollingKey(secret, ts);
  return crypto.createHmac('sha256', key).update(`${ts}|${deviceId}|${seq}`).digest('hex');
}

export type DmsVerifyReason =
  | 'signature_ok'
  | 'bad_timestamp'
  | 'unknown_device'
  | 'replay'
  | 'bad_signature';

export interface DmsPingInput {
  deviceId: string;
  ts: number;
  seq: number;
  sig: string;
}

export interface DmsVerifyOptions {
  allowedDevices?: string[];
  /** seq ล่าสุดของ device (undefined/null = ยังไม่เคยเห็น — ยอมรับค่าแรก) */
  lastSeq?: number | null;
  clockToleranceMs?: number;
}

/**
 * Pure verifier — เทสต์ได้ไม่พึ่ง network/DB (blueprint §7.3)
 * ลำดับ: device อนุญาต → |now − ts| ≤ tolerance (ts = unix วินาที) → seq monotonic → HMAC (±1 window)
 * `now` เป็น ms (Date.now()) — เทียบกับ `input.ts` (unix วินาที) แปลงในฟังก์ชัน
 */
export function verifyDmsPing(
  input: DmsPingInput,
  secret: string,
  now: number,
  opts: DmsVerifyOptions = {}
): { ok: boolean; reason: DmsVerifyReason } {
  const allowed = opts.allowedDevices ?? [];
  if (!secret || !allowed.includes(input.deviceId)) {
    return { ok: false, reason: 'unknown_device' };
  }
  const tolerance = opts.clockToleranceMs ?? 60000;
  // ts เป็น unix วินาที, tolerance เก็บเป็น ms → เทียบหน่วยวินาทีทั้งคู่
  if (!Number.isFinite(input.ts) || Math.abs(Math.floor(now / 1000) - input.ts) > tolerance / 1000) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (opts.lastSeq != null && input.seq <= opts.lastSeq) {
    return { ok: false, reason: 'replay' };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.sig)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const expected = Buffer.from(signDmsPing(secret, input.deviceId, input.ts, input.seq), 'hex');
  const actual = Buffer.from(input.sig, 'hex');
  // ยอมรับ key ของ window ตัวเอง + ทั้ง 2 ข้าง (กันนาฬิกา drift 1 window — blueprint §3.1/§8)
  for (const offset of [-DMS_KEY_ROTATION_SEC, 0, DMS_KEY_ROTATION_SEC]) {
    const key = rollingKey(secret, input.ts + offset);
    const candidate = crypto
      .createHmac('sha256', key)
      .update(`${input.ts}|${input.deviceId}|${input.seq}`)
      .digest();
    if (crypto.timingSafeEqual(candidate, actual)) {
      return { ok: true, reason: 'signature_ok' };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

// ── Wake-on-LAN (blueprint §7.4) ── FF×6 + MAC×16 → UDP:9 broadcast ──
export function buildWolMagicPacket(mac: string): Buffer {
  const clean = mac.replace(/[^a-fA-F0-9]/g, '');
  if (clean.length !== 12) throw new Error(`Invalid MAC address: "${mac}"`);
  const macBuf = Buffer.from(clean, 'hex');
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  return packet;
}

export function sendWolMagicPacket(mac: string, broadcast: string, port = 9): Promise<boolean> {
  return new Promise((resolve) => {
    let packet: Buffer;
    try {
      packet = buildWolMagicPacket(mac);
    } catch {
      resolve(false);
      return;
    }
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => {
      sock.close();
      resolve(false);
    });
    sock.send(packet, 0, packet.length, port, broadcast, () => {
      sock.close();
      resolve(true);
    });
  });
}

// ── State Machine (blueprint §6) ──
export type DmsLevel = 'ALIVE' | 'SUSPECT' | 'CONFIRMED' | 'FAILOVER_ACTIVE';

export interface DmsDeviceState {
  deviceId: string;
  lastSeen: number | null;
  lastSeq: number | null;
  level: DmsLevel;
  /** เมื่อยิง DMS_PING_MISSED ล่าสุด (transition เท่านั้น — กันซ้ำทุก worker tick) */
  missedWarnAt: number | null;
  /** ครั้งถัดไปที่ยิง failover action/alert ซ้ำได้ (anti-flap cooldown) */
  failoverActionAt: number | null;
  lastFailoverAlertAt: number | null;
  recoveredAt: number | null;
  lastBatteryPct: number | null;
  lastUptimeSec: number | null;
  /** กัน flood DMS_SIGNATURE_FAIL (critical event) ต่อ device */
  sigFailWarnAt: number | null;
}

export interface DmsServiceConfig {
  enabled: boolean;
  masterSecret: string;
  missedMs: number;
  failoverMs: number;
  autoFailover: boolean;
  wolMac: string;
  wolBroadcast: string;
  failoverCooldownMs: number;
  allowedDevices: string[];
  dryRun: boolean;
  clockToleranceMs: number;
}

export interface DmsServiceDeps {
  now?: () => number;
  prisma?: any;
  stateFile?: string;
  sendWol?: (mac: string, broadcast: string) => Promise<boolean>;
  sendTelegram?: (payload: { text: string; severity?: AlertSeverity; eventKey?: string }) => Promise<unknown>;
  keyRotationSec?: number;
}

export interface DmsTelemetryPayload {
  uptime?: number;
  batPct?: number;
}

function defaultStateFile(): string {
  return process.env.DMS_STATE_FILE || path.resolve(process.cwd(), 'data', 'dms-state.json');
}

function sanitizeState(raw: any): DmsDeviceState | null {
  if (!raw || typeof raw !== 'object' || typeof raw.deviceId !== 'string') return null;
  return {
    deviceId: raw.deviceId,
    lastSeen: typeof raw.lastSeen === 'number' ? raw.lastSeen : null,
    lastSeq: typeof raw.lastSeq === 'number' ? raw.lastSeq : null,
    level:
      raw.level === 'SUSPECT' || raw.level === 'CONFIRMED' || raw.level === 'FAILOVER_ACTIVE'
        ? raw.level
        : 'ALIVE',
    missedWarnAt: typeof raw.missedWarnAt === 'number' ? raw.missedWarnAt : null,
    failoverActionAt: typeof raw.failoverActionAt === 'number' ? raw.failoverActionAt : null,
    lastFailoverAlertAt: typeof raw.lastFailoverAlertAt === 'number' ? raw.lastFailoverAlertAt : null,
    recoveredAt: typeof raw.recoveredAt === 'number' ? raw.recoveredAt : null,
    lastBatteryPct: typeof raw.lastBatteryPct === 'number' ? raw.lastBatteryPct : null,
    lastUptimeSec: typeof raw.lastUptimeSec === 'number' ? raw.lastUptimeSec : null,
    sigFailWarnAt: typeof raw.sigFailWarnAt === 'number' ? raw.sigFailWarnAt : null,
  };
}

const SYS_LOG = (msg: string) => console.log(`🛡️ DMS: ${msg}`);
const SYS_WARN = (msg: string) => console.warn(`🛡️ DMS: ${msg}`);

export class DmsService {
  private devices = new Map<string, DmsDeviceState>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(
    private cfg: DmsServiceConfig,
    private deps: DmsServiceDeps = {}
  ) {
    this.now = deps.now ?? Date.now;
    if (Number.isFinite(cfg.missedMs) && Number.isFinite(cfg.failoverMs) && cfg.failoverMs <= cfg.missedMs) {
      throw new Error('DMS_FAILOVER_MS must be greater than DMS_MISSED_MS');
    }
  }

  // ── Persistence (blueprint §6: reboot DMS ไม่ลืมสถานะ) ──
  init(): void {
    const file = this.deps.stateFile ?? defaultStateFile();
    const { data } = readJsonVerified<Array<Partial<DmsDeviceState>>>(file);
    if (Array.isArray(data)) {
      for (const raw of data) {
        const st = sanitizeState(raw);
        if (st) this.devices.set(st.deviceId, st);
      }
      SYS_LOG(`loaded ${this.devices.size} device(s) from ${file}`);
    } else {
      SYS_LOG(`no persisted state at ${file} — starting fresh`);
    }
    // เตรียม state ของ device ที่ขึ้นทะเบียนไว้แต่ยังไม่เคย ping (ให้ ladder ทำงานได้ทันที)
    for (const id of this.cfg.allowedDevices) {
      if (!this.devices.has(id)) this.devices.set(id, this.freshState(id));
    }
    this.persist();
  }

  private freshState(deviceId: string): DmsDeviceState {
    return {
      deviceId,
      lastSeen: null,
      lastSeq: null,
      level: 'ALIVE',
      missedWarnAt: null,
      failoverActionAt: null,
      lastFailoverAlertAt: null,
      recoveredAt: null,
      lastBatteryPct: null,
      lastUptimeSec: null,
      sigFailWarnAt: null,
    };
  }

  private persist(): void {
    const file = this.deps.stateFile ?? defaultStateFile();
    saveJsonAtomic(file, [...this.devices.values()]);
  }

  // ── Audit + alert ──
  private async recordEvent(
    eventType: string,
    severity: 'info' | 'warning' | 'critical',
    description: string,
    raw?: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = this.deps.prisma ?? prisma;
      await db.securityEvent.create({
        data: {
          event_type: eventType,
          severity,
          description,
          raw_data: raw ?? {},
        },
      });
    } catch (err) {
      SYS_WARN(`securityEvent write failed: ${err instanceof Error ? err.message : err}`);
    }
    securityStream.push('DMS', { event_type: eventType, severity, description, ...(raw ?? {}) });
  }

  private async alert(
    text: string,
    severity: AlertSeverity,
    eventKey: string,
    raw?: Record<string, unknown>
  ): Promise<void> {
    securityStream.push('DMS', { alert: severity, eventKey, text, ...(raw ?? {}) });
    if (this.cfg.dryRun) {
      SYS_LOG(`[dry-run] Telegram alert (${severity}) suppressed: ${text}`);
      return;
    }
    const send = this.deps.sendTelegram ?? sendTelegramAlert;
    try {
      const res = await send({ text, severity, eventKey });
      SYS_LOG(`Telegram (${severity}): ${text} → ${JSON.stringify(res)}`);
    } catch (err) {
      SYS_WARN(`Telegram alert error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async wolWakeColdStandby(): Promise<boolean> {
    if (this.cfg.dryRun) {
      SYS_LOG(`[dry-run] WoL magic packet -> ${this.cfg.wolMac} @ ${this.cfg.wolBroadcast} (ไม่ยิงจริง)`);
      return true;
    }
    const send = this.deps.sendWol ?? sendWolMagicPacket;
    return send(this.cfg.wolMac, this.cfg.wolBroadcast);
  }

  // ── Handle /ping ──
  /** คืน { ok, reason } — อัปเดต ladder + audit เฉพาะเหตุการณ์จริง */
  async handlePing(
    input: DmsPingInput,
    telemetry: DmsTelemetryPayload = {}
  ): Promise<{ ok: boolean; reason: DmsVerifyReason }> {
    const now = this.now();
    const prev = this.devices.get(input.deviceId) ?? this.freshState(input.deviceId);
    const verification = verifyDmsPing(input, this.cfg.masterSecret, now, {
      allowedDevices: this.cfg.allowedDevices,
      lastSeq: prev.lastSeq,
      clockToleranceMs: this.cfg.clockToleranceMs,
    });
    if (!verification.ok) {
      // HMAC ผิด = มีคนพยายามปลอม (blueprint §3.3) — rate-limit ต่อ device 60s กัน flood
      if (verification.reason === 'bad_signature' && now - (prev.sigFailWarnAt ?? 0) >= 60000) {
        prev.sigFailWarnAt = now;
        await this.recordEvent(
          'DMS_SIGNATURE_FAIL',
          'critical',
          `❌ DMS HMAC ผิดจาก device "${input.deviceId}" (ts=${input.ts}, seq=${input.seq}) — สงสัยพยายามปลอม`,
          { device_id: input.deviceId, ts: input.ts, seq: input.seq }
        );
        await this.alert(
          `❌ DMS HMAC mismatch จาก device "${input.deviceId}" (seq=${input.seq}) — ใครบางคนกำลังปลอม ping`,
          'critical',
          `dms:signature_fail:${input.deviceId}`
        );
        this.persist();
      }
      return { ok: false, reason: verification.reason };
    }

    const wasDown = prev.level !== 'ALIVE';
    prev.lastSeen = now;
    prev.lastSeq = input.seq;
    prev.level = 'ALIVE';
    prev.missedWarnAt = null;
    prev.lastFailoverAlertAt = null;
    prev.failoverActionAt = null;
    if (typeof telemetry.batPct === 'number') prev.lastBatteryPct = telemetry.batPct;
    if (typeof telemetry.uptime === 'number') prev.lastUptimeSec = telemetry.uptime;
    prev.recoveredAt = wasDown ? now : prev.recoveredAt;
    this.devices.set(input.deviceId, prev);
    this.persist();

    if (wasDown) {
      SYS_LOG(`🟢 device "${input.deviceId}" กลับมา (lastSeen=${now})`);
      await this.recordEvent(
        'DMS_PING_RECOVERED',
        'info',
        `🟢 DMS device "${input.deviceId}" กลับมา ping แล้ว — ระบบหลักมีชีวิต`,
        { device_id: input.deviceId, seq: input.seq }
      );
      await this.alert(
        `🟢 ALL CLEAR — DMS device "${input.deviceId}" กลับมาแล้ว ระบบหลักทำงานปกติ`,
        'info',
        `dms:recovered:${input.deviceId}`
      );
    }
    return { ok: true, reason: 'signature_ok' };
  }

  // ── Ladder check (worker tick) ──
  /** ตรวจระดับของทุก device ตามเวลาที่หายไป — เรียกจาก worker ทุก checkIntervalMs */
  async checkLadder(): Promise<void> {
    const now = this.now();
    let changed = false;
    for (const device of this.devices.values()) {
      if (device.lastSeen === null) continue; // ยังไม่เคย ping จริง — ไม่มีอะไรจะวัด
      const missed = now - device.lastSeen;
      const missedMs = this.cfg.missedMs;
      const failoverMs = this.cfg.failoverMs;

      // ระดับ 1: เข้า SUSPECT ครั้งเดียว (transition) — ยังไม่ทำอะไรกับเครื่องหลัก
      if (missed >= missedMs && device.level === 'ALIVE') {
        device.level = 'SUSPECT';
        device.missedWarnAt = now;
        changed = true;
        SYS_LOG(`⚠️ device "${device.deviceId}" เงียบ ${missed}ms > ${missedMs}ms — ระดับ 1 SUSPECT`);
        await this.recordEvent(
          'DMS_PING_MISSED',
          'warning',
          `⚠️ DMS device "${device.deviceId}" ไม่ส่ง ping เกิน ${missedMs}ms (เงียบ ${missed}ms) — สงสัยระบบหลักตาย`,
          { device_id: device.deviceId, missed_ms: missed, threshold_ms: missedMs }
        );
        await this.alert(
          `⚠️ DMS สงสัยระบบหลักตาย — device "${device.deviceId}" เงียบไป ${Math.round(missed / 1000)}s (เกณฑ์ ${missedMs / 1000}s)`,
          'warn',
          `dms:missed:${device.deviceId}`
        );
      }

      // ระดับ 2: ยืนยัน SPOF — trigger ครั้งแรก + ย้ำทุก cooldown (anti-flap)
      if (missed >= failoverMs && device.level !== 'ALIVE') {
        const canAct = device.failoverActionAt === null || now >= device.failoverActionAt;
        if (canAct) {
          const isFirst = !device.lastFailoverAlertAt;
          device.level = 'FAILOVER_ACTIVE';
          device.lastFailoverAlertAt = now;
          device.failoverActionAt = now + this.cfg.failoverCooldownMs;
          changed = true;
          SYS_LOG(`🚨 device "${device.deviceId}" เงียบ ${missed}ms > ${failoverMs}ms — ระดับ 2 FAILOVER (${isFirst ? 'รอบแรก' : 'ย้ำ'})`);
          await this.recordEvent(
            'DMS_FAILOVER_TRIGGERED',
            'critical',
            `🚨 DMS device "${device.deviceId}" เงียบเกิน ${failoverMs}ms — ระบบหลักยืนยัน SPOF (${isFirst ? 'trigger ครั้งแรก' : 'ย้ำรอบ cooldown'})`,
            { device_id: device.deviceId, missed_ms: missed, threshold_ms: failoverMs }
          );
          await this.alert(
            `🚨 SPOF ยืนยัน — device "${device.deviceId}" เงียบเกิน ${failoverMs / 1000}s (${Math.round(missed / 1000)}s) ${isFirst ? '' : '(ย้ำ)'}`,
            'critical',
            `dms:failover:${device.deviceId}`
          );
          if (this.cfg.autoFailover && this.cfg.wolMac) {
            const woke = await this.wolWakeColdStandby();
            SYS_LOG(woke ? `⚡ WoL sent to ${this.cfg.wolMac}` : '⚡ WoL failed');
          } else if (this.cfg.autoFailover && !this.cfg.wolMac) {
            SYS_WARN('DMS_AUTO_FAILOVER=true แต่ยังไม่ตั้ง DMS_WOL_MAC — ข้าม WoL');
          }
        }
      }
    }
    if (changed) this.persist();
  }

  // ── Worker ──
  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkLadder().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
    SYS_LOG(`monitor worker started (tick ${intervalMs}ms, dry-run=${this.cfg.dryRun})`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): {
    enabled: boolean;
    dryRun: boolean;
    level: Record<string, DmsLevel>;
    devices: DmsDeviceState[];
  } {
    return {
      enabled: this.cfg.enabled,
      dryRun: this.cfg.dryRun,
      level: Object.fromEntries([...this.devices.entries()].map(([id, d]) => [id, d.level])),
      devices: [...this.devices.values()],
    };
  }

  isEnabled(): boolean {
    return this.cfg.enabled;
  }
}

export const dmsService = new DmsService(
  {
    enabled: config.dms.enabled,
    masterSecret: config.dms.masterSecret,
    missedMs: config.dms.missedMs,
    failoverMs: config.dms.failoverMs,
    autoFailover: config.dms.autoFailover,
    wolMac: config.dms.wolMac,
    wolBroadcast: config.dms.wolBroadcast,
    failoverCooldownMs: config.dms.failoverCooldownMs,
    allowedDevices: config.dms.allowedDevices,
    dryRun: config.dms.dryRun,
    clockToleranceMs: config.dms.clockToleranceMs,
  },
  {}
);