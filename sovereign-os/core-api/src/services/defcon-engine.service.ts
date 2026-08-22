import { prisma } from '../lib/prisma';
import EventEmitter from 'events';

export const defconEmitter = new EventEmitter();

// ── Pure: mapping threat index → DEFCON level ──
// DEFCON 3 (Elevated)  > 50 — ชาร์จแบต + แจ้งเตือน
// DEFCON 2 (Severe)    > 75 — backup + ปิด relay ไม่จำเป็น
// DEFCON 1 (Critical)  > 90 — ตัด WAN + เปิดระบบรักษาความปลอดภัย
// หมายเหตุ: เลขน้อย = รุนแรงกว่า (1 รุนแรงสุด) — severity = 4 - level

export type DefconLevel = 0 | 1 | 2 | 3;

export function classifyDefcon(overall: number): DefconLevel {
  if (!Number.isFinite(overall) || overall <= 0) return 0;
  if (overall > 90) return 1;
  if (overall > 75) return 2;
  if (overall > 50) return 3;
  return 0;
}

/** threshold ล่างของ level (ค่าที่ทำให้ classify ได้ level นี้) */
export function classifyThreshold(level: DefconLevel): number {
  switch (level) {
    case 1: return 90;
    case 2: return 75;
    case 3: return 50;
    default: return 0;
  }
}

export interface DefconAction {
  id: string; // เช่น 'charge_battery' | 'backup_cold_storage' | 'wan_disconnect'
}

export interface DefconConfig {
  hysteresis: number; // ลดระดับต้องต่ำกว่า threshold - hysteresis (กัน flapping)
  actions: Partial<Record<DefconLevel, DefconAction[]>>;
}

export interface DefconDeps {
  runAction: (level: DefconLevel, action: DefconAction) => Promise<void>;
}

export interface DefconCheckResult {
  level: DefconLevel;
  actionsRun: DefconAction[];
}

export class DefconEngine {
  private level: DefconLevel = 0;
  private lastIndex: number | null = null;

  constructor(
    private deps: DefconDeps,
    private cfg: DefconConfig
  ) {}

  getLevel(): DefconLevel {
    return this.level;
  }

  /**
   * ประเมิน threat index ใหม่
   * - ยกระดับ (threat สูงขึ้น): ยิง action ของทุกระดับที่เพิ่งเข้า ครั้งเดียวต่อ episode (กลับ 0 แล้วค่อย re-arm)
   * - ลดระดับ: ต้องผ่าน hysteresis (threshold - N) ก่อน — ไม่ยิง action ใหม่ และไม่ยกเลิกมาตรการเดิมเองอัตโนมัติ
   */
  async check(overall: number): Promise<DefconCheckResult> {
    const target = classifyDefcon(overall);
    const actionsRun: DefconAction[] = [];
    this.lastIndex = overall;

    if (target === this.level) {
      return { level: this.level, actionsRun };
    }

    const severity = (lvl: DefconLevel) => (lvl === 0 ? 0 : 4 - lvl);

    if (severity(target) > severity(this.level)) {
      // Escalation — ยิง action ของทุกระดับที่ข้าม ไล่จากรุนแรงน้อยไปหามาก
      const order: DefconLevel[] = [3, 2, 1];
      const from = this.level === 0 ? -1 : order.indexOf(this.level);
      const to = order.indexOf(target);
      for (let i = from + 1; i <= to; i++) {
        const lvl = order[i];
        for (const action of this.cfg.actions[lvl] || []) {
          await this.deps.runAction(lvl, action);
          actionsRun.push(action);
        }
      }
      this.level = target;
      defconEmitter.emit('defcon', { level: this.level, direction: 'up', overall });
      return { level: this.level, actionsRun };
    }

    // De-escalation — ต้องผ่าน hysteresis ก่อน
    const currentFloor = classifyThreshold(this.level);
    if (overall <= currentFloor - this.cfg.hysteresis) {
      const from = this.level;
      this.level = target;
      defconEmitter.emit('defcon', { level: this.level, direction: 'down', from, overall });
      return { level: this.level, actionsRun };
    }
    return { level: this.level, actionsRun };
  }

  reset(): void {
    this.level = 0;
    this.lastIndex = null;
  }
}

// ── Instance สำหรับ wiring ใน server.ts ──

export interface DefconRuntimeConfig {
  hysteresis: number;
  runAction: (level: DefconLevel, action: DefconAction) => Promise<void>;
}

export function createDefconEngine(cfg: DefconRuntimeConfig): DefconEngine {
  return new DefconEngine(
    {
      runAction: async (level, action) => {
        await cfg.runAction(level, action);
        await logDefconEvent(level, action);
      },
    },
    { hysteresis: cfg.hysteresis, actions: defconActions() }
  );
}

export function defconActions(): Partial<Record<DefconLevel, DefconAction[]>> {
  return {
    3: [{ id: 'charge_battery' }, { id: 'telegram_stats' }],
    2: [{ id: 'backup_cold_storage' }, { id: 'relays_off' }],
    1: [{ id: 'wan_disconnect' }, { id: 'security_on' }],
  };
}

export async function logDefconEvent(level: DefconLevel, action: DefconAction, detail?: string): Promise<void> {
  try {
    await prisma.defconEvent.create({
      data: { level, action: action.id, detail: detail || null },
    });
  } catch (err) {
    console.error('🛡️ DEFCON: failed to log event:', err instanceof Error ? err.message : err);
  }
}
