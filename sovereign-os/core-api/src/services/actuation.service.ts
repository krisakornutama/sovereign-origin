import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import { sendTelegramAlert } from './telegram-alert.service';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7: Closed-Loop Actuation Sandbox (Safety Engineering)
// Governor AI จาก "นักวางแผนในจำลอง" → "ผู้ปกครองที่มีมือเท้าจำลอง"
//
// ทุกคำสั่งลงมือต้องผ่าน 3 ชั้น:
//   1) SAFETY ENVELOPE (hard gate — AI เขียนทับไม่ได้)
//   2) LEVER→ACTUATOR MAPPER (ค่านโยบาย → คำสั่งอุปกรณ์)
//   3) CLOSED-LOOP VERIFIER (อ่านผลจริง ไม่เชื่อ log — ผิด → ACTUATION_FAILED + rollback)
//
// โหมด: sandbox (default — actuator จำลอง เขียน state file เท่านั้น)
//       real    (MQTT จริง — ต้อง SUPERADMIN + ACT_ALLOW_REAL=true)
// ─────────────────────────────────────────────────────────────────────────────

export type ActuationMode = 'sandbox' | 'real';
export type ActorKind = 'governor' | 'human' | 'system';

export interface Actuator {
  id: string;
  kind: 'relay' | 'mode';
  label: string;
  state: string; // relay: 'on'|'off' — mode: ค่าโหมด
  class: 'critical' | 'standard'; // critical = มนุษย์เท่านั้น (AI แตะไม่ได้)
  energyImpactKw: number; // กำลังไฟที่เพิ่มเมื่อ ON (kW) — ใช้กับ BATTERY_FLOOR
  verifyMetric?: string; // metric ใน sensor_telemetry ที่ใช้ยืนยันผล (โหมด real)
}

export interface LeverMapEntry {
  lever: string; // รองรับ dot-path เช่น budget.welfare
  actuatorId: string;
  threshold: number; // ค่า lever ที่ trigger
  invert?: boolean; // true = ON เมื่อ lever < threshold
  note?: string;
}

export interface PhysicalSnapshot {
  batterySoc: number | null; // %
  powerKw: number | null; // kW (ติดลบ = discharge)
  tempC: number | null; // อุณหภูมิสูงสุดล่าสุด
  occupied: boolean; // มีคนอยู่บ้าน?
}

export interface EnvelopeConfig {
  batteryFloorPct: number; // < นี้ = ห้ามทุก action ที่เพิ่มการใช้ไฟ
  batteryHoldPct: number; // < นี้ = ห้าม discharge-heavy (>0.5kW)
  heavyDrawKw: number; // เกณฑ์ discharge-heavy
  tempCeilingC: number; // ≥ นี้ = ห้ามทุกอย่าง ยกเว้นลดโหลด
  relayCooldownMs: number; // ห้าม toggle relay เดิมซ้ำภายในช่วงนี้
  criticalRelays: string[]; // วงจรที่ AI แตะไม่ได้เด็ดขาด
  occupancyGraceMs: number; // telemetry ล่าสุดภายในช่วงนี้ = มีคน
  verifyTimeoutMs: number;
  verifyPollMs: number;
}

export interface EnvelopeVerdict {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

export interface ActuationCommand {
  actuatorId: string;
  desiredState: string;
  actor: ActorKind;
  reason: string;
}

export interface CommandResult {
  ok: boolean;
  actuatorId: string;
  action: 'denied' | 'executed' | 'verified' | 'failed' | 'rollback';
  rule?: string;
  reason?: string;
}

export interface ActuationDeps {
  loadSnapshot: () => Promise<PhysicalSnapshot>;
  publishReal?: (actuatorId: string, state: string) => void | Promise<void>;
}

// ── Config (env — เปลี่ยนได้ แต่ AI เขียนทับไม่ได้) ──
const STATE_FILE = process.env.ACT_STATE_FILE || path.resolve(process.cwd(), 'data', 'actuation-state.json');
const env = (k: string, d: string) => process.env[k] || d;
const cfg: EnvelopeConfig = {
  batteryFloorPct: parseInt(env('ACT_BATTERY_FLOOR_PCT', '20'), 10),
  batteryHoldPct: parseInt(env('ACT_BATTERY_HOLD_PCT', '30'), 10),
  heavyDrawKw: parseFloat(env('ACT_HEAVY_DRAW_KW', '0.5')),
  tempCeilingC: parseFloat(env('ACT_TEMP_CEILING_C', '45')),
  relayCooldownMs: parseInt(env('ACT_RELAY_COOLDOWN_MS', '60000'), 10),
  criticalRelays: (env('ACT_CRITICAL_RELAYS', '') + ',wan-link,water-valve')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  occupancyGraceMs: parseInt(env('ACT_OCCUPANCY_GRACE_MS', '1800000'), 10),
  verifyTimeoutMs: parseInt(env('ACT_VERIFY_TIMEOUT_MS', '10000'), 10),
  verifyPollMs: parseInt(env('ACT_VERIFY_POLL_MS', '2000'), 10),
};

const DEFAULT_ACTUATORS: Actuator[] = [
  { id: 'load-1', kind: 'relay', label: 'โหลดกลาง (แบ่งปันพลังงาน)', state: 'off', class: 'standard', energyImpactKw: 0.4, verifyMetric: 'power_kw' },
  { id: 'patrol-light', kind: 'relay', label: 'ไฟลาดตระเวน', state: 'off', class: 'standard', energyImpactKw: 0.05 },
  { id: 'wan-link', kind: 'relay', label: 'ลิงก์โลกภายนอก', state: 'on', class: 'critical', energyImpactKw: 0.02 },
  { id: 'water-valve', kind: 'relay', label: 'วาล์วน้ำสวัสดิการ', state: 'on', class: 'critical', energyImpactKw: 0.1 },
];

const DEFAULT_LEVER_MAP: LeverMapEntry[] = [
  { lever: 'powerSharing', actuatorId: 'load-1', threshold: 50, note: 'แบ่งปันพลังงาน ≥50 → เปิดโหลดกลาง' },
  { lever: 'policePatrols', actuatorId: 'patrol-light', threshold: 50, note: 'ลาดตระเวน ≥50 → เปิดไฟยาม' },
  { lever: 'foreignAppeasement', actuatorId: 'wan-link', threshold: 60, note: 'ประนีประนอม ≥60 → เปิดลิงก์โลกภายนอก' },
  { lever: 'budget.welfare', actuatorId: 'water-valve', threshold: 30, note: 'งบสวัสดิการ ≥30 → เปิดวาล์วน้ำ' },
];

interface ActuationState {
  mode: ActuationMode;
  occupiedOverride: boolean | null;
  simFailureIds: string[];
  actuators: Actuator[];
  history: Array<{ at: number; actuatorId: string; action: string; actor: string; reason: string }>;
}

// ── Pure: Safety Envelope (กฎเหล็ก — ลำดับสำคัญ ตรวจตามนี้) ──

export function evaluateEnvelope(
  actuator: Actuator,
  desiredState: string,
  actor: ActorKind,
  snap: PhysicalSnapshot,
  envelope: EnvelopeConfig,
  lastCommandAt: number
): EnvelopeVerdict {
  const turningOn = desiredState === 'on';
  const increasingDraw = turningOn && actuator.energyImpactKw > 0;

  // 1) ⛔ CRITICAL_CIRCUIT — AI (governor) แตะวงจร critical ไม่ได้เด็ดขาด (มนุษย์/system เท่านั้น)
  //    system = การฉุกเฉิน (DEFCON, first-responder, kill-switch) — ต้องผ่านได้ (ใน real mode มันไปเส้นทางตรงอยู่แล้ว)
  if (actor === 'governor' && actuator.class === 'critical') {
    return { allowed: false, rule: 'CRITICAL_CIRCUIT', reason: `วงจร ${actuator.id} อยู่ในรายการ critical — มนุษย์เท่านั้นที่สั่งได้` };
  }

  // 2) 🪫 BATTERY_FLOOR — แบตต่ำกว่า floor = ห้ามทุกอย่างที่เพิ่มการใช้ไฟ
  if (snap.batterySoc != null && snap.batterySoc < envelope.batteryFloorPct && increasingDraw) {
    return { allowed: false, rule: 'BATTERY_FLOOR', reason: `แบต ${snap.batterySoc}% < ${envelope.batteryFloorPct}% — ห้ามเพิ่มการใช้ไฟ` };
  }
  // 2b) 🪫 BATTERY_HOLD — ต่ำกว่า hold = ห้าม discharge-heavy (> heavyDrawKw)
  if (snap.batterySoc != null && snap.batterySoc < envelope.batteryHoldPct && increasingDraw && actuator.energyImpactKw > envelope.heavyDrawKw) {
    return { allowed: false, rule: 'BATTERY_HOLD', reason: `แบต ${snap.batterySoc}% < ${envelope.batteryHoldPct}% — ห้ามเปิดอุปกรณ์โหลดสูง (${actuator.energyImpactKw}kW)` };
  }

  // 3) 🌡️ TEMP_CEILING — ร้อนเกิน = ห้ามทุกอย่าง ยกเว้นการลดโหลด (ปิดของที่กินไฟ)
  if (snap.tempC != null && snap.tempC >= envelope.tempCeilingC) {
    const reducesLoad = !turningOn && actuator.energyImpactKw > 0;
    if (!reducesLoad) {
      return { allowed: false, rule: 'TEMP_CEILING', reason: `อุณหภูมิ ${snap.tempC}°C ≥ ${envelope.tempCeilingC}°C — อนุญาตเฉพาะลดโหลด` };
    }
  }

  // 4) ⏱️ RELAY_COOLDOWN — ห้าม toggle relay เดิมซ้ำเร็วเกิน (กัน bounce)
  if (lastCommandAt > 0 && Date.now() - lastCommandAt < envelope.relayCooldownMs) {
    return { allowed: false, rule: 'RELAY_COOLDOWN', reason: `relay ${actuator.id} เพิ่งถูกสั่งเมื่อ ${Math.round((Date.now() - lastCommandAt) / 1000)}s ก่อน — ต้องรอ ${Math.round(envelope.relayCooldownMs / 1000)}s` };
  }

  // 5) 🏠 OCCUPANCY — มีคนอยู่บ้าน + action กลุ่ม shutdown (ปิดน้ำ/ปิดโลก) → AI ห้าม
  const SHUTDOWN_CLASS = new Set(['wan-link', 'water-valve']);
  if (snap.occupied && actor !== 'human' && desiredState === 'off' && SHUTDOWN_CLASS.has(actuator.id)) {
    return { allowed: false, rule: 'OCCUPANCY', reason: `มีคนอยู่บ้าน — AI ห้ามปิด ${actuator.id} (กลุ่ม shutdown)` };
  }

  return { allowed: true };
}

// ── Pure: Lever → Actuator Mapper ──

export function resolveLever(levers: Record<string, any>, path: string): number | null {
  const val = path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), levers as any);
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export function mapLeversToActuators(
  levers: Record<string, any>,
  actuators: Actuator[],
  map: LeverMapEntry[]
): ActuationCommand[] {
  const cmds: ActuationCommand[] = [];
  for (const entry of map) {
    const actuator = actuators.find((a) => a.id === entry.actuatorId);
    if (!actuator || actuator.kind !== 'relay') continue;
    const value = resolveLever(levers, entry.lever);
    if (value == null) continue;
    const above = value >= entry.threshold;
    const desired = entry.invert ? (above ? 'off' : 'on') : above ? 'on' : 'off';
    if (desired === actuator.state) continue; // ไม่เปลี่ยน = ไม่ต้องสั่ง
    cmds.push({
      actuatorId: actuator.id,
      desiredState: desired,
      actor: 'governor',
      reason: `${entry.lever}=${value} (${entry.note || 'map'})`,
    });
  }
  return cmds;
}

// ── Pure: Closed-Loop Verifier (อ่านผลจริง ไม่เชื่อ log) ──

export function verifyStateChange(
  actuatorId: string,
  expectedState: string,
  simFailureIds: string[],
  actualState: string | null
): { ok: boolean; detail: string } {
  if (simFailureIds.includes(actuatorId)) {
    return { ok: false, detail: 'จำลอง relay ค้าง (stuck) — สั่งแล้วไม่เปลี่ยนสถานะ' };
  }
  if (actualState === expectedState) {
    return { ok: true, detail: `ยืนยัน ${actuatorId} = ${expectedState} แล้ว` };
  }
  return { ok: false, detail: `สถานะจริง = ${actualState} (คาดว่า ${expectedState})` };
}

// ── Service ──

export class ActuationService {
  private deps: ActuationDeps;
  private lastCommandAt: Record<string, number> = {};

  constructor(deps: ActuationDeps) {
    this.deps = deps;
  }

  /** server.ts ใส่ตัวอ่าน snapshot จริง (TimescaleDB) + publisher MQTT (โหมด real) */
  setDeps(deps: ActuationDeps): void {
    this.deps = deps;
  }

  private loadState(): ActuationState {
    const { ok, data, rot } = readJsonVerified<ActuationState>(STATE_FILE);
    if (rot) console.warn('⚙️ actuation state bit-rot — ใช้ค่าเริ่มต้น (ไฟล์ถูก quarantine แล้ว)');
    if (ok && data) {
      // merge actuators ที่ยังไม่มี (ของใหม่) — เก็บ state เดิมของของเก่าไว้
      for (const def of DEFAULT_ACTUATORS) {
        if (!data.actuators.find((a) => a.id === def.id)) data.actuators.push({ ...def });
      }
      return data;
    }
    return {
      mode: 'sandbox',
      occupiedOverride: null,
      simFailureIds: [],
      actuators: DEFAULT_ACTUATORS.map((a) => ({ ...a })),
      history: [],
    };
  }

  private saveState(state: ActuationState): void {
    saveJsonAtomic(STATE_FILE, state);
  }

  private record(state: ActuationState, entry: { actuatorId: string; action: string; actor: string; reason: string }): void {
    state.history.unshift({ at: Date.now(), ...entry });
    if (state.history.length > 30) state.history.length = 30;
  }

  private async raise(event: string, data: any, severity: 'warning' | 'critical' = 'warning', telegram = false): Promise<void> {
    securityStream.push('ACTUATION', { event, ...data, at: new Date().toISOString() });
    if (severity === 'critical' || telegram) {
      try {
        await prisma.securityEvent.create({
          data: {
            event_type: `ACTUATION_${event.toUpperCase()}`,
            severity,
            description: `⚙️ [ACTUATION] ${data.text || ''}`,
            raw_data: data,
          },
        });
      } catch {
        // DB เข้าไม่ถึง = แจ้งผ่าน SSE แล้ว
      }
      sendTelegramAlert({
        text: data.text || event,
        severity: severity === 'critical' ? 'critical' : 'warn',
        eventKey: `actuation:${event}`,
      }).catch(() => {});
    }
  }

  private async loadSnapshot(): Promise<PhysicalSnapshot> {
    if (this.deps.loadSnapshot) {
      try {
        return await this.deps.loadSnapshot();
      } catch {
        // fall through ไป default
      }
    }
    try {
      const latest = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT DISTINCT ON (metric) metric, value
         FROM sensor_telemetry
         WHERE metric IN ('battery_soc', 'power_kw')
         ORDER BY metric, time DESC`
      );
      const map: Record<string, number> = {};
      for (const r of latest) map[r.metric] = Number(r.value);
      const temp = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT MAX(value) AS max_temp
         FROM sensor_telemetry
         WHERE metric IN ('temperature', 'temp', 'temp_c')
           AND time >= NOW() - INTERVAL '10 minutes'`
      );
      const graceMin = Math.max(1, Math.round(cfg.occupancyGraceMs / 60000));
      const occ = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT value FROM sensor_telemetry
         WHERE metric IN ('presence', 'motion', 'occupancy')
           AND time >= NOW() - INTERVAL '${graceMin} minutes'
         ORDER BY time DESC LIMIT 1`
      );
      const occVal = occ.length ? Number(occ[0].value) : null;
      return {
        batterySoc: map.battery_soc != null ? Number(map.battery_soc) : null,
        powerKw: map.power_kw != null ? Number(map.power_kw) : null,
        tempC: temp[0]?.max_temp != null ? Number(temp[0].max_temp) : null,
        occupied: occVal != null ? occVal > 0 : false,
      };
    } catch (err) {
      console.error('Actuation: cannot load snapshot:', err instanceof Error ? err.message : err);
      return { batterySoc: null, powerKw: null, tempC: null, occupied: false };
    }
  }

  async executeCommand(cmd: ActuationCommand): Promise<CommandResult> {
    const state = this.loadState();
    const actuator = state.actuators.find((a) => a.id === cmd.actuatorId);
    if (!actuator) return { ok: false, actuatorId: cmd.actuatorId, action: 'denied', reason: `ไม่รู้จัก actuator ${cmd.actuatorId}` };
    const desiredState = actuator.kind === 'relay' ? (cmd.desiredState === 'on' ? 'on' : 'off') : String(cmd.desiredState);

    const snap = await this.loadSnapshot();
    const verdict = evaluateEnvelope(actuator, desiredState, cmd.actor, snap, cfg, this.lastCommandAt[cmd.actuatorId] || 0);
    if (!verdict.allowed) {
      this.record(state, { actuatorId: cmd.actuatorId, action: 'denied', actor: cmd.actor, reason: `${verdict.rule}: ${verdict.reason}` });
      this.saveState(state);
      this.raise('deny', { actuatorId: cmd.actuatorId, desired: desiredState, actor: cmd.actor, rule: verdict.rule, text: `⛔ ${verdict.rule} — ${verdict.reason}` });
      return { ok: false, actuatorId: cmd.actuatorId, action: 'denied', rule: verdict.rule, reason: verdict.reason };
    }

    const before = actuator.state;
    actuator.state = desiredState;
    this.lastCommandAt[cmd.actuatorId] = Date.now();
    this.record(state, { actuatorId: cmd.actuatorId, action: 'executed', actor: cmd.actor, reason: cmd.reason });
    this.saveState(state); // สั่งแล้ว = บันทึกผลทันที (sandbox: state file คือ "อุปกรณ์ตอบสนอง")

    // โหมด real → สั่งของจริงผ่าน MQTT (sandbox = เขียน state file เท่านั้น)
    if (state.mode === 'real' && this.deps.publishReal) {
      try {
        await this.deps.publishReal(cmd.actuatorId, desiredState);
      } catch (err) {
        actuator.state = before;
        this.record(state, { actuatorId: cmd.actuatorId, action: 'failed', actor: cmd.actor, reason: `publish ล้มเหลว: ${err instanceof Error ? err.message : err}` });
        this.saveState(state);
        this.raise('failed', { actuatorId: cmd.actuatorId, actor: cmd.actor, text: `🚨 สั่ง ${cmd.actuatorId}=${desiredState} แต่ publish ล้มเหลว — rollback` }, 'critical', true);
        return { ok: false, actuatorId: cmd.actuatorId, action: 'failed', reason: 'publish failed' };
      }
    }

    // ── Closed-Loop Verifier: รออ่านผลจริง (ไม่เชื่อ log) ──
    const result = await this.verifyWithPoll(cmd.actuatorId, desiredState, state.simFailureIds);
    if (!result.ok) {
      actuator.state = before; // rollback
      if (state.mode === 'real' && this.deps.publishReal) {
        try { await this.deps.publishReal(cmd.actuatorId, before); } catch {}
      }
      this.record(state, { actuatorId: cmd.actuatorId, action: 'rollback', actor: cmd.actor, reason: result.detail });
      this.saveState(state);
      this.raise('failed', { actuatorId: cmd.actuatorId, desired: desiredState, actor: cmd.actor, text: `🚨 ACTUATION_FAILED: ${cmd.actuatorId} → ${result.detail} — rollback กลับ ${before} แล้ว` }, 'critical', true);
      return { ok: false, actuatorId: cmd.actuatorId, action: 'failed', reason: result.detail };
    }

    this.record(state, { actuatorId: cmd.actuatorId, action: 'verified', actor: cmd.actor, reason: result.detail });
    this.saveState(state);
    this.raise('verified', { actuatorId: cmd.actuatorId, desired: desiredState, actor: cmd.actor, text: `✅ ${actuator.label} = ${desiredState} (${result.detail})` });
    return { ok: true, actuatorId: cmd.actuatorId, action: 'verified', reason: result.detail };
  }

  private async verifyWithPoll(actuatorId: string, expected: string, simFailureIds: string[]): Promise<{ ok: boolean; detail: string }> {
    const deadline = Date.now() + cfg.verifyTimeoutMs;
    let last: { ok: boolean; detail: string } = { ok: false, detail: 'timeout' };
    while (Date.now() < deadline) {
      const { ok, data } = readJsonVerified<ActuationState>(STATE_FILE);
      last = verifyStateChange(actuatorId, expected, simFailureIds, ok && data ? data.actuators.find((a) => a.id === actuatorId)?.state ?? null : null);
      if (last.ok) return last;
      await new Promise((r) => setTimeout(r, cfg.verifyPollMs));
    }
    return last;
  }

  /** Governor hook: เปลี่ยน levers → sync actuator ให้ตรงกับนโยบาย (ผ่าน Safety Envelope) */
  async syncActuatorsFromLevers(levers: Record<string, any>, actor: ActorKind = 'governor'): Promise<CommandResult[]> {
    const state = this.loadState();
    const cmds = mapLeversToActuators(levers, state.actuators, DEFAULT_LEVER_MAP);
    const results: CommandResult[] = [];
    for (const cmd of cmds) {
      results.push(await this.executeCommand({ ...cmd, actor }));
    }
    return results;
  }

  status(): any {
    const state = this.loadState();
    return {
      mode: state.mode,
      occupiedOverride: state.occupiedOverride,
      simFailureIds: state.simFailureIds,
      envelope: cfg,
      actuators: state.actuators.map(({ verifyMetric, energyImpactKw, ...rest }) => rest),
      history: state.history,
    };
  }

  envelopeRules(): { rules: Array<{ id: string; desc: string; active: boolean }> } {
    return {
      rules: [
        { id: 'CRITICAL_CIRCUIT', desc: `AI แตะวงจร critical ไม่ได้ (${cfg.criticalRelays.join(', ')})`, active: true },
        { id: 'BATTERY_FLOOR', desc: `แบต < ${cfg.batteryFloorPct}% → ห้ามเพิ่มการใช้ไฟ`, active: true },
        { id: 'BATTERY_HOLD', desc: `แบต < ${cfg.batteryHoldPct}% → ห้ามเปิดโหลด > ${cfg.heavyDrawKw}kW`, active: true },
        { id: 'TEMP_CEILING', desc: `อุณหภูมิ ≥ ${cfg.tempCeilingC}°C → อนุญาตเฉพาะลดโหลด`, active: true },
        { id: 'RELAY_COOLDOWN', desc: `relay เดิมห้าม toggle ซ้ำใน ${Math.round(cfg.relayCooldownMs / 1000)}s`, active: true },
        { id: 'OCCUPANCY', desc: `มีคนอยู่บ้าน → AI ห้ามปิด wan-link/water-valve`, active: true },
      ],
    };
  }

  setMode(mode: ActuationMode): { ok: boolean; error?: string } {
    if (mode !== 'sandbox' && mode !== 'real') return { ok: false, error: 'mode ต้องเป็น sandbox|real' };
    if (mode === 'real' && process.env.ACT_ALLOW_REAL !== 'true') {
      return { ok: false, error: 'โหมด real ยังถูกล็อก — ต้องตั้ง ACT_ALLOW_REAL=true ใน .env ก่อน (Safety Lock)' };
    }
    const state = this.loadState();
    state.mode = mode;
    this.saveState(state);
    securityStream.push('ACTUATION', { event: 'mode', mode, at: new Date().toISOString() });
    console.log(`⚙️ Actuation mode → ${mode}`);
    return { ok: true };
  }

  setOccupancy(occupied: boolean | null): { ok: boolean } {
    const state = this.loadState();
    state.occupiedOverride = occupied;
    this.saveState(state);
    return { ok: true };
  }

  toggleSimFailure(actuatorId: string): { ok: boolean; simFailureIds: string[] } {
    const state = this.loadState();
    const idx = state.simFailureIds.indexOf(actuatorId);
    if (idx >= 0) state.simFailureIds.splice(idx, 1);
    else state.simFailureIds.push(actuatorId);
    this.saveState(state);
    return { ok: true, simFailureIds: state.simFailureIds };
  }
}

export const actuationService = new ActuationService({ loadSnapshot: () => Promise.resolve({ batterySoc: null, powerKw: null, tempC: null, occupied: false }) });

/** Governor hook ตัวสั้น — levers → actuator (ผ่าน Safety Envelope) */
export function syncActuatorsFromLevers(levers: Record<string, any>, actor: ActorKind = 'governor'): Promise<CommandResult[]> {
  return actuationService.syncActuatorsFromLevers(levers, actor);
}