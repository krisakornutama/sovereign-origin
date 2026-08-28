// src/services/power-guard.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// เฝ้าดูแบตเตอรี่ (battery_soc + power_kw) เป็นระยะ แล้ว:
//   • แจ้งเตือนล่วงหน้าเมื่อเวลาที่เหลือต่ำกว่า POWER_WARNING_MINUTES
//   • สั่ง graceful shutdown เมื่อต่ำกว่า POWER_CRITICAL_MINUTES (opt-in ผ่าน
//     POWER_SHUTDOWN_CMD — ปล่อยว่าง = แจ้งเตือนอย่างเดียว ไม่ปิดเครื่อง)
// แยก pure logic (evaluateBatteryRisk) ออกจาก side effects เพื่อให้เทสต์ง่าย
// ─────────────────────────────────────────────────────────────────────────────

export type BatteryRiskLevel = 'unknown' | 'ok' | 'warning' | 'critical';

export interface EnergySnapshot {
  /** ระดับแบตเตอรี่ (%) — null = ยังไม่มีข้อมูล */
  batterySoc: number | null;
  /** กำลังไฟเฉลี่ย (kW) — ติดลบ = ใช้ไฟ (discharge), บวก = ชาร์จ */
  avgPowerKw: number | null;
}

export interface PowerGuardConfig {
  /** ความจุแบตเตอรี่รวม (kWh) — ค่าเดียวกับ ENERGY_CAPACITY_KWH */
  capacityKwh: number;
  /** แจ้งเตือนเมื่อเหลือเวลาน้อยกว่า/เท่ากับค่านี้ (นาที) */
  warningMinutes: number;
  /** สั่ง shutdown เมื่อเหลือเวลาน้อยกว่า/เท่ากับค่านี้ (นาที) */
  criticalMinutes: number;
  /** ความถี่ตรวจ (ms) */
  checkIntervalMs: number;
  /** คำสั่งปิดระบบ (เช่น "shutdown /s /t 60") — ว่าง = ปิด auto-shutdown */
  shutdownCommand: string;
}

export interface BatteryRisk {
  level: BatteryRiskLevel;
  /** ชั่วโมงที่เหลือ — null เมื่อไม่มีข้อมูลหรือไม่ได้ discharge */
  hoursRemaining: number | null;
}

export interface PowerGuardCheckResult extends BatteryRisk {
  notified: boolean;
  shutdownTriggered: boolean;
}

export interface PowerGuardDeps {
  /** อ่านสถานะพลังงานล่าสุดจากแหล่งข้อมูล (TimescaleDB) */
  loadSnapshot: () => Promise<EnergySnapshot>;
  /** ส่งแจ้งเตือน (Telegram / Socket.IO / console) */
  notify: (level: Exclude<BatteryRiskLevel, 'ok' | 'unknown'>, message: string) => void | Promise<void>;
  /** รันคำสั่งปิดระบบ (cmd มาจาก env — server-controlled) */
  runShutdown: (command: string) => void | Promise<void>;
  /** injectable สำหรับเทสต์ timer */
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

// สถานะ "จ่ายไฟเกินเกณฑ์เล็กน้อย" — ค่าเดียวกับ energy.routes.ts (สมดุล/ชาร์จ = ไม่นับ discharge)
const DISCHARGE_EPSILON = 0.001;

/**
 * ประมาณเวลาที่แบตเตอรี่จะใช้ได้หมด (ชั่วโมง)
 * null = ข้อมูลไม่ครบ หรือกำลังชาร์จ/สมดุล (ไม่มีภัย)
 */
export function estimateHoursRemaining(
  snapshot: EnergySnapshot,
  capacityKwh: number
): number | null {
  if (snapshot.batterySoc == null || snapshot.avgPowerKw == null) return null;
  // ไม่ได้ discharge (ชาร์จ / สมดุล) → ไม่มีความเสี่ยงเรื่องแบตหมด
  if (snapshot.avgPowerKw >= -DISCHARGE_EPSILON) return null;
  const usableKwh = (snapshot.batterySoc / 100) * capacityKwh;
  return usableKwh / Math.abs(snapshot.avgPowerKw);
}

/** ตัดสินระดับความเสี่ยงจาก snapshot — pure function, เทสต์ได้ตรง ๆ */
export function evaluateBatteryRisk(
  snapshot: EnergySnapshot,
  cfg: Pick<PowerGuardConfig, 'capacityKwh' | 'warningMinutes' | 'criticalMinutes'>
): BatteryRisk {
  if (snapshot.batterySoc == null || snapshot.avgPowerKw == null) {
    return { level: 'unknown', hoursRemaining: null };
  }
  if (snapshot.avgPowerKw >= -DISCHARGE_EPSILON) {
    return { level: 'ok', hoursRemaining: null };
  }
  const hoursRemaining = estimateHoursRemaining(snapshot, cfg.capacityKwh)!;
  const minutesRemaining = hoursRemaining * 60;
  if (minutesRemaining <= cfg.criticalMinutes) {
    return { level: 'critical', hoursRemaining };
  }
  if (minutesRemaining <= cfg.warningMinutes) {
    return { level: 'warning', hoursRemaining };
  }
  return { level: 'ok', hoursRemaining };
}

function fmtHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} นาที`;
  return `${hours.toFixed(1)} ชม.`;
}

export function validatePowerConfig(cfg: PowerGuardConfig): void {
  if (!Number.isFinite(cfg.capacityKwh) || cfg.capacityKwh <= 0) {
    throw new Error('POWER_CAPACITY_KWH must be a positive number');
  }
  if (!Number.isFinite(cfg.warningMinutes) || cfg.warningMinutes <= 0) {
    throw new Error('POWER_WARNING_MINUTES must be a positive number');
  }
  if (!Number.isFinite(cfg.criticalMinutes) || cfg.criticalMinutes <= 0) {
    throw new Error('POWER_CRITICAL_MINUTES must be a positive number');
  }
  if (cfg.criticalMinutes >= cfg.warningMinutes) {
    throw new Error('POWER_CRITICAL_MINUTES must be less than POWER_WARNING_MINUTES');
  }
}

export class PowerGuardWorker {
  private lastAlertLevel: Exclude<BatteryRiskLevel, 'ok' | 'unknown'> | null = null;
  private shutdownTriggered = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private deps: PowerGuardDeps,
    private cfg: PowerGuardConfig
  ) {
    validatePowerConfig(cfg);
  }

  /** ตรวจครั้งเดียว — คืนผลเพื่อให้เทสต์/UI อ่านได้ */
  async checkOnce(): Promise<PowerGuardCheckResult> {
    let snapshot: EnergySnapshot;
    try {
      snapshot = await this.deps.loadSnapshot();
    } catch (err) {
      console.error('Power guard: cannot load energy state:', err instanceof Error ? err.message : err);
      return { level: 'unknown', hoursRemaining: null, notified: false, shutdownTriggered: false };
    }

    const risk = evaluateBatteryRisk(snapshot, this.cfg);
    const result: PowerGuardCheckResult = {
      level: risk.level,
      hoursRemaining: risk.hoursRemaining,
      notified: false,
      shutdownTriggered: false,
    };

    // ไม่มีข้อมูล → ไม่ต้องทำอะไร (รักษาสถานะเดิม ไม่ reset — กัน data flap ยิงซ้ำ)
    if (risk.level === 'unknown') return result;

    // กลับสู่ปลอดภัย → reset สถานะ เตรียมพร้อมเตือน/ปิดใหม่รอบหน้า
    if (risk.level === 'ok') {
      this.lastAlertLevel = null;
      this.shutdownTriggered = false;
      return result;
    }

    // ระดับเปลี่ยน → แจ้งเตือน (กันสแปม: ระดับเดิมไม่แจ้งซ้ำ)
    if (this.lastAlertLevel !== risk.level) {
      this.lastAlertLevel = risk.level;
      result.notified = true;
      const message = this.formatMessage(risk.level, risk.hoursRemaining!, snapshot.batterySoc!);
      await this.deps.notify(risk.level, message);
    }

    // วิกฤต + ตั้งคำสั่งไว้ + ยังไม่ได้ปิดรอบนี้ → สั่ง shutdown (ครั้งเดียวต่อ episode)
    if (risk.level === 'critical' && this.cfg.shutdownCommand && !this.shutdownTriggered) {
      this.shutdownTriggered = true;
      result.shutdownTriggered = true;
      await this.deps.runShutdown(this.cfg.shutdownCommand);
    }

    return result;
  }

  async start(): Promise<void> {
    // schedule interval ก่อน แล้วค่อยตรวจทันที (await — เทสต์ deterministic ได้)
    const schedule = this.deps.setInterval ?? setInterval;
    this.timer = schedule(() => {
      this.checkOnce().catch((err) =>
        console.error('Power guard: check failed:', err instanceof Error ? err.message : err)
      );
    }, this.cfg.checkIntervalMs);
    console.log(
      `🔋 Power guard started (ทุก ${(this.cfg.checkIntervalMs / 1000).toFixed(0)}s, warning ${this.cfg.warningMinutes}m, critical ${this.cfg.criticalMinutes}m${
        this.cfg.shutdownCommand ? ' — auto-shutdown armed' : ' — auto-shutdown disabled (POWER_SHUTDOWN_CMD ว่าง)'
      })`
    );
    try {
      await this.checkOnce();
    } catch (err) {
      console.error('Power guard: initial check failed:', err instanceof Error ? err.message : err);
    }
  }

  stop(): void {
    if (this.timer) {
      const clear = this.deps.clearInterval ?? clearInterval;
      clear(this.timer);
      this.timer = null;
    }
  }

  private formatMessage(
    level: Exclude<BatteryRiskLevel, 'ok' | 'unknown'>,
    hoursRemaining: number,
    batterySoc: number
  ): string {
    const time = fmtHours(hoursRemaining);
    if (level === 'critical') {
      return `🚨 [POWER] วิกฤต! แบตเตอรี่เหลือ ${batterySoc}% — ประมาณ ${time} กำลังสั่งปิดระบบ gracefully`;
    }
    return `⚠️ [POWER] แบตเตอรี่เหลือ ${batterySoc}% — ประมาณ ${time} เตรียมตัวปิดระบบ`;
  }
}
