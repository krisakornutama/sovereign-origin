// src/services/ups-shutdown.service.ts
// UPS Graceful Shutdown — ชุด 🟡 ข้อ 2
// เมื่อ battery.charge <= UPS_SHUTDOWN_BATTERY_PCT หรือ battery.runtime <= UPS_SHUTDOWN_RUNTIME_SEC:
//   CHECKPOINT (WAL ลง disk) → drain telemetry buffer → emergency bundle → audit+SSE → POWER_SHUTDOWN_CMD
// UPS_DRY_RUN=true = รัน flow ครบแต่ไม่สั่งปิดเครื่องจริง (ทดสอบได้ปลอดภัย)

import type { UpsSnapshot } from './ups-monitor.service';

export interface UpsShutdownConfig {
  batteryPct: number;
  runtimeSec: number;
  command: string;
  dryRun: boolean;
  checkIntervalMs: number;
}

export type ShutdownPhase = 'idle' | 'shutting_down';

export type ShutdownStep =
  | 'checkpoint'
  | 'drain_telemetry'
  | 'emergency_backup'
  | 'audit_initiated'
  | 'exec_shutdown';

export interface UpsShutdownDeps {
  readUps: () => Promise<UpsSnapshot>;
  checkpointDb: () => Promise<void>;
  drainTelemetry: () => Promise<void>;
  emergencyBackup: () => Promise<void>;
  audit: (payload: { text: string; raw: Record<string, unknown> }) => Promise<void>;
  runShutdown: (command: string) => Promise<void>;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

export const SHUTDOWN_SEQUENCE: ShutdownStep[] = [
  'checkpoint',
  'drain_telemetry',
  'emergency_backup',
  'audit_initiated',
  'exec_shutdown',
];

/** pure: ตรวจว่า UPS ถึงขีดต้องปิดเครื่องหรือยัง */
export function evaluateUpsShutdown(
  snapshot: UpsSnapshot,
  cfg: Pick<UpsShutdownConfig, 'batteryPct' | 'runtimeSec'>
): { trigger: boolean; reason?: string } {
  if (snapshot.batteryCharge != null && snapshot.batteryCharge <= cfg.batteryPct) {
    return { trigger: true, reason: `battery.charge=${snapshot.batteryCharge}% <= ${cfg.batteryPct}%` };
  }
  if (snapshot.batteryRuntimeSec != null && snapshot.batteryRuntimeSec <= cfg.runtimeSec) {
    return { trigger: true, reason: `battery.runtime=${snapshot.batteryRuntimeSec}s <= ${cfg.runtimeSec}s` };
  }
  return { trigger: false };
}

export class UpsShutdownService {
  private phase: ShutdownPhase = 'idle';
  private lastTriggerAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private deps: UpsShutdownDeps,
    private cfg: UpsShutdownConfig
  ) {
    if (!Number.isFinite(cfg.batteryPct) || cfg.batteryPct < 0 || cfg.batteryPct > 100) {
      throw new Error('UPS_SHUTDOWN_BATTERY_PCT must be between 0 and 100');
    }
    if (!Number.isFinite(cfg.runtimeSec) || cfg.runtimeSec <= 0) {
      throw new Error('UPS_SHUTDOWN_RUNTIME_SEC must be > 0');
    }
  }

  getPhase(): ShutdownPhase {
    return this.phase;
  }

  /** รัน flow ล่าสุด: ตรวจ trigger → ถ้าเข้าเงื่อนไข รัน sequence */
  async checkOnce(): Promise<{ triggered: boolean; reason?: string }> {
    const now = (this.deps.now ?? Date.now)();
    if (this.phase === 'shutting_down') return { triggered: false, reason: 'shutdown in progress' };

    let snapshot: UpsSnapshot;
    try {
      snapshot = await this.deps.readUps();
    } catch (err) {
      console.error('UPS shutdown: cannot read UPS:', err instanceof Error ? err.message : err);
      return { triggered: false, reason: 'read_failed' };
    }

    const verdict = evaluateUpsShutdown(snapshot, this.cfg);
    if (!verdict.trigger) return { triggered: false };

    if (now - this.lastTriggerAt < this.cfg.checkIntervalMs) {
      return { triggered: false, reason: `cooldown (${this.cfg.checkIntervalMs}ms)` };
    }
    this.lastTriggerAt = now;

    await this.runSequence(verdict.reason!);
    return { triggered: true, reason: verdict.reason };
  }

  /** ลำดับตามพิมพ์เขียว: checkpoint → drain → backup → audit → shutdown (dry-run ข้าม step สุดท้าย) */
  private async runSequence(reason: string): Promise<void> {
    this.phase = 'shutting_down';
    try {
      await this.deps.checkpointDb();
      await this.deps.drainTelemetry();
      await this.deps.emergencyBackup();
      await this.deps.audit({
        text: `UPS shutdown initiated (${reason}) — ${this.cfg.dryRun ? 'DRY-RUN (ไม่ปิดจริง)' : 'กำลังปิดระบบ'}`,
        raw: { reason, dryRun: this.cfg.dryRun, command: this.cfg.command, sequence: SHUTDOWN_SEQUENCE },
      });
      if (this.cfg.dryRun) {
        console.log(`🔌 [UPS] DRY-RUN: sequence ครบถ้วน (${SHUTDOWN_SEQUENCE.join(' → ')}) — ไม่สั่ง shutdown จริง`);
        this.phase = 'idle'; // dry-run กลับ idle ให้ทดสอบซ้ำได้
        return;
      }
      console.log(`🔌 [UPS] Graceful shutdown: ${this.cfg.command}`);
      await this.deps.runShutdown(this.cfg.command);
    } catch (err) {
      console.error('UPS shutdown sequence error:', err instanceof Error ? err.message : err);
      this.phase = 'idle'; // ปลดล็อกให้ลองใหม่รอบถัดไป (แต่ cooldown กันซ้ำ)
    }
  }

  start(): void {
    if (this.timer) return;
    const interval = this.deps.setInterval ?? setInterval;
    this.timer = interval(() => {
      this.checkOnce().catch((err) => console.error('UPS shutdown check error:', err));
    }, this.cfg.checkIntervalMs);
    console.log(
      `🔌 UPS Graceful Shutdown armed (charge<=${this.cfg.batteryPct}% OR runtime<=${this.cfg.runtimeSec}s, dry-run=${this.cfg.dryRun}, cmd=${this.cfg.command})`
    );
    this.checkOnce().catch(() => {});
  }

  stop(): void {
    if (this.timer) {
      const clear = this.deps.clearInterval ?? clearInterval;
      clear(this.timer);
      this.timer = null;
    }
  }
}