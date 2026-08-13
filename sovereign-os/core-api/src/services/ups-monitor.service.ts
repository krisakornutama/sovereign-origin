// src/services/ups-monitor.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// อ่านค่า UPS ผ่านโปรโตคอล NUT (Network UPS Tools, TCP 3493) แล้ว push เข้า
// telemetry (sensor_telemetry) — ไม่ต้องรอ ESP32/อินเวอร์เตอร์ส่ง MQTT จากภายนอก
//
// USB HID UPS ต่อเข้ากับ NUT ผ่านไดรเวอร์ usbhid-ups → เปิดบริการ upsd (NUT
// server) → โมดูลนี้คุยกับ upsd ด้วยโปรโตคอลมาตรฐาน (LIST VAR) แบบ pure TCP
// ไม่ต้องพึ่ง native module — เทสต์ได้ทั้ง unit และ integration
// ─────────────────────────────────────────────────────────────────────────────

import net from 'net';

export interface UpsSnapshot {
  /** battery.charge (%) */
  batteryCharge: number | null;
  /** battery.runtime (วินาที) */
  batteryRuntimeSec: number | null;
  /** battery.voltage (V) */
  batteryVoltage: number | null;
  /** ups.power (W) */
  powerWatts: number | null;
}

export interface UpsConfig {
  /** NUT server (upsd) host */
  host: string;
  /** NUT server port (default 3493) */
  port: number;
  /** ชื่อ UPS ตามที่ตั้งใน NUT (ups.conf) */
  upsName: string;
  /** node_id ใน telemetry ที่จะเขียนข้อมูลลง */
  nodeId: string;
  /** ความถี่อ่านค่า (ms) */
  checkIntervalMs: number;
  /** แจ้งเตือนเมื่อ battery.charge ต่ำกว่าค่านี้ (%) */
  lowBatteryThreshold: number;
  /** กัน alert ซ้ำถี่เกินไป (ms) */
  lowBatteryCooldownMs: number;
}

export interface UpsCheckResult {
  ok: boolean;
  inserted: Array<{ metric: string; value: number }>;
  lowBatteryAlerted: boolean;
  error?: string;
}

export interface UpsMonitorDeps {
  /** อ่านค่า UPS ล่าสุด (ปกติคือ fetchNutVars ผ่าน TCP) */
  fetchVars: () => Promise<UpsSnapshot>;
  /** เขียน metric ลง telemetry (เช่น INSERT INTO sensor_telemetry …) */
  insertTelemetry: (metric: string, value: number) => Promise<void>;
  /** ป่าวประกาศข้อมูลใหม่ (เช่น systemEvents 'telemetry_update') */
  emitTelemetryUpdate: (data: Record<string, number>) => void;
  /** แจ้งเตือนแบตเตอรี่ต่ำ (เช่น systemEvents 'alert:battery_low') */
  emitLowBattery: (snapshot: UpsSnapshot) => void;
  /** injectable สำหรับเทสต์ */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

// ── Pure: parse ข้อความตอบกลับของ NUT ──
const NUT_VAR_RE = /^VAR\s+\S+\s+([A-Za-z0-9_.]+)\s+"([^"]*)"$/;

export function parseNutVars(lines: string[]): UpsSnapshot {
  const out: UpsSnapshot = {
    batteryCharge: null,
    batteryRuntimeSec: null,
    batteryVoltage: null,
    powerWatts: null,
  };
  for (const raw of lines) {
    const m = NUT_VAR_RE.exec(raw.trim());
    if (!m) continue;
    const [, name, value] = m;
    const num = Number(value);
    if (!value || Number.isNaN(num)) continue;
    switch (name) {
      case 'battery.charge':
        out.batteryCharge = num;
        break;
      case 'battery.runtime':
        out.batteryRuntimeSec = num;
        break;
      case 'battery.voltage':
        out.batteryVoltage = num;
        break;
      case 'ups.power':
        out.powerWatts = num;
        break;
      default:
        break;
    }
  }
  return out;
}

// ── Pure: map ค่า UPS → metric ที่ระบบ telemetry รู้จักอยู่แล้ว ──
export function snapshotToTelemetry(snapshot: UpsSnapshot): Array<{ metric: string; value: number }> {
  const rows: Array<{ metric: string; value: number }> = [];
  if (snapshot.batteryCharge != null) rows.push({ metric: 'battery_soc', value: snapshot.batteryCharge });
  if (snapshot.powerWatts != null) rows.push({ metric: 'power_kw', value: snapshot.powerWatts / 1000 });
  if (snapshot.batteryVoltage != null) rows.push({ metric: 'voltage', value: snapshot.batteryVoltage });
  return rows;
}

// ── NUT client: LIST VAR <ups> ผ่าน TCP ──
export function fetchNutVars(
  host: string,
  port: number,
  upsName: string,
  timeoutMs = 10000
): Promise<UpsSnapshot> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let buffer = '';
    let timer: NodeJS.Timeout;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    timer = setTimeout(
      () =>
        settle(() => {
          socket.destroy();
          reject(new Error(`NUT request to ${host}:${port} timed out after ${timeoutMs}ms`));
        }),
      timeoutMs
    );

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`LIST VAR ${upsName}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.includes('END LIST VAR')) {
        settle(() => {
          socket.end();
          resolve(parseNutVars(buffer.split('\n')));
        });
      }
    });
    socket.on('error', (err) => settle(() => reject(err)));
    socket.on('close', () => {
      if (!settled) clearTimeout(timer);
    });
  });
}

export class UpsMonitorWorker {
  private lastLowBatteryAlertAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private deps: UpsMonitorDeps,
    private cfg: UpsConfig
  ) {
    if (!cfg.host || cfg.host.trim() === '') throw new Error('UPS_HOST must be set');
    if (!Number.isInteger(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
      throw new Error('UPS_PORT must be a valid port (1-65535)');
    }
    if (!Number.isFinite(cfg.checkIntervalMs) || cfg.checkIntervalMs <= 0) {
      throw new Error('UPS_CHECK_INTERVAL_MS must be a positive number');
    }
    if (!Number.isFinite(cfg.lowBatteryThreshold) || cfg.lowBatteryThreshold < 0 || cfg.lowBatteryThreshold > 100) {
      throw new Error('UPS_LOW_BATTERY_THRESHOLD must be between 0 and 100');
    }
    if (!Number.isFinite(cfg.lowBatteryCooldownMs) || cfg.lowBatteryCooldownMs < 0) {
      throw new Error('UPS_LOW_BATTERY_COOLDOWN_MS must be >= 0');
    }
  }

  /** อ่าน UPS หนึ่งรอบ: insert telemetry + emit update + ตรวจแบตเตอรี่ต่ำ */
  async checkOnce(): Promise<UpsCheckResult> {
    let snapshot: UpsSnapshot;
    try {
      snapshot = await this.deps.fetchVars();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`UPS monitor: cannot read UPS: ${error}`);
      return { ok: false, inserted: [], lowBatteryAlerted: false, error };
    }

    const inserted: Array<{ metric: string; value: number }> = [];
    for (const t of snapshotToTelemetry(snapshot)) {
      try {
        await this.deps.insertTelemetry(t.metric, t.value);
        inserted.push(t);
      } catch (err) {
        console.error(`UPS monitor: insert ${t.metric} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (inserted.length > 0) {
      const data: Record<string, number> = {};
      for (const t of inserted) data[t.metric] = t.value;
      this.deps.emitTelemetryUpdate(data);
    }

    let lowBatteryAlerted = false;
    if (snapshot.batteryCharge != null && snapshot.batteryCharge < this.cfg.lowBatteryThreshold) {
      const now = (this.deps.now ?? Date.now)();
      if (now - this.lastLowBatteryAlertAt >= this.cfg.lowBatteryCooldownMs) {
        this.lastLowBatteryAlertAt = now;
        lowBatteryAlerted = true;
        this.deps.emitLowBattery(snapshot);
      }
    }

    return { ok: true, inserted, lowBatteryAlerted };
  }

  async start(): Promise<void> {
    const schedule = this.deps.setInterval ?? setInterval;
    this.timer = schedule(() => {
      this.checkOnce().catch((err) =>
        console.error('UPS monitor: check failed:', err instanceof Error ? err.message : err)
      );
    }, this.cfg.checkIntervalMs);
    console.log(
      `🔌 UPS monitor started (NUT ${this.cfg.host}:${this.cfg.port}/${this.cfg.upsName}, ทุก ${(this.cfg.checkIntervalMs / 1000).toFixed(0)}s, low-battery < ${this.cfg.lowBatteryThreshold}%)`
    );
    try {
      await this.checkOnce();
    } catch (err) {
      console.error('UPS monitor: initial check failed:', err instanceof Error ? err.message : err);
    }
  }

  stop(): void {
    if (this.timer) {
      const clear = this.deps.clearInterval ?? clearInterval;
      clear(this.timer);
      this.timer = null;
    }
  }
}
