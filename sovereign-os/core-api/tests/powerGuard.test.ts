import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  estimateHoursRemaining,
  evaluateBatteryRisk,
  PowerGuardWorker,
  type EnergySnapshot,
  type PowerGuardConfig,
  type PowerGuardDeps,
  type PowerGuardCheckResult,
} from '../src/services/power-guard.service';

const DEFAULT_CFG: PowerGuardConfig = {
  capacityKwh: 5,
  warningMinutes: 30,
  criticalMinutes: 5,
  checkIntervalMs: 60000,
  shutdownCommand: '',
};

function makeCfg(overrides: Partial<PowerGuardConfig> = {}): PowerGuardConfig {
  return { ...DEFAULT_CFG, ...overrides };
}

function makeWorker(
  overrides: Partial<PowerGuardDeps> = {},
  cfg: PowerGuardConfig = DEFAULT_CFG
) {
  const calls: string[] = [];
  const notified: Array<{ level: string; message: string }> = [];
  const deps: PowerGuardDeps & {
    calls: string[];
    notified: Array<{ level: string; message: string }>;
    snapshot: EnergySnapshot;
    setSnapshot: (s: EnergySnapshot) => void;
  } = {
    calls,
    notified,
    snapshot: { batterySoc: null, avgPowerKw: null },
    async loadSnapshot() {
      calls.push('load');
      return this.snapshot;
    },
    async notify(level, message) {
      calls.push(`notify:${level}`);
      notified.push({ level, message });
    },
    async runShutdown(cmd) {
      calls.push(`shutdown:${cmd}`);
    },
    setSnapshot(s) {
      this.snapshot = s;
    },
    ...overrides,
  };
  const worker = new PowerGuardWorker(deps, cfg);
  return { deps, worker };
}

// ─────────────────────────── estimateHoursRemaining ───────────────────────────

test('estimateHoursRemaining returns null when battery or power data is missing', () => {
  assert.strictEqual(estimateHoursRemaining({ batterySoc: null, avgPowerKw: -0.5 }, 5), null);
  assert.strictEqual(estimateHoursRemaining({ batterySoc: 50, avgPowerKw: null }, 5), null);
  assert.strictEqual(estimateHoursRemaining({ batterySoc: null, avgPowerKw: null }, 5), null);
});

test('estimateHoursRemaining returns null when not discharging (charging or balanced)', () => {
  assert.strictEqual(estimateHoursRemaining({ batterySoc: 50, avgPowerKw: 0.5 }, 5), null);
  assert.strictEqual(estimateHoursRemaining({ batterySoc: 50, avgPowerKw: 0 }, 5), null);
  assert.strictEqual(estimateHoursRemaining({ batterySoc: 50, avgPowerKw: -0.0005 }, 5), null);
});

test('estimateHoursRemaining computes hours from SOC, capacity and power draw', () => {
  // SOC 50% ของ 5 kWh = 2.5 kWh ดึง 1 kW → 2.5 ชม.
  const hours = estimateHoursRemaining({ batterySoc: 50, avgPowerKw: -1 }, 5);
  assert.ok(hours !== null);
  assert.ok(Math.abs(hours - 2.5) < 1e-9);
});

// ─────────────────────────── evaluateBatteryRisk ───────────────────────────

test('evaluateBatteryRisk returns unknown when data is missing', () => {
  assert.deepStrictEqual(evaluateBatteryRisk({ batterySoc: null, avgPowerKw: -0.5 }, makeCfg()), {
    level: 'unknown',
    hoursRemaining: null,
  });
  assert.deepStrictEqual(evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: null }, makeCfg()), {
    level: 'unknown',
    hoursRemaining: null,
  });
});

test('evaluateBatteryRisk returns ok when charging', () => {
  assert.deepStrictEqual(evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: 0.5 }, makeCfg()), {
    level: 'ok',
    hoursRemaining: null,
  });
});

test('evaluateBatteryRisk returns ok when plenty of time remains', () => {
  // SOC 100% ของ 5 kWh ดึง 0.25 kW → 20 ชม.
  assert.deepStrictEqual(evaluateBatteryRisk({ batterySoc: 100, avgPowerKw: -0.25 }, makeCfg()), {
    level: 'ok',
    hoursRemaining: 20,
  });
});

test('evaluateBatteryRisk returns warning when remaining time is under the warning threshold', () => {
  // SOC 25% = 1.25 kWh ดึง 5 kW → 15 นาที → warning
  const risk = evaluateBatteryRisk({ batterySoc: 25, avgPowerKw: -5 }, makeCfg());
  assert.strictEqual(risk.level, 'warning');
  assert.ok(risk.hoursRemaining !== null && Math.abs(risk.hoursRemaining - 0.25) < 1e-9);
});

test('evaluateBatteryRisk returns critical when remaining time is under the critical threshold', () => {
  // SOC 5% = 0.25 kWh ดึง 5 kW → 3 นาที → critical
  const risk = evaluateBatteryRisk({ batterySoc: 5, avgPowerKw: -5 }, makeCfg());
  assert.strictEqual(risk.level, 'critical');
  assert.ok(risk.hoursRemaining !== null && Math.abs(risk.hoursRemaining - 0.05) < 1e-9);
});

test('evaluateBatteryRisk boundary: exactly warning minutes is still warning', () => {
  // SOC 50% = 2.5 kWh ดึง 5 kW → 30 นาที → warning (<=)
  const risk = evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: -5 }, makeCfg());
  assert.strictEqual(risk.level, 'warning');
});

test('evaluateBatteryRisk boundary: exactly critical minutes is still critical', () => {
  // SOC 10% = 0.5 kWh ดึง 6 kW → 5 นาที → critical (<=)
  const risk = evaluateBatteryRisk({ batterySoc: 10, avgPowerKw: -6 }, makeCfg());
  assert.strictEqual(risk.level, 'critical');
});

test('evaluateBatteryRisk respects custom thresholds', () => {
  const cfg = makeCfg({ warningMinutes: 120, criticalMinutes: 60 });
  // SOC 50% = 2.5 kWh ดึง 1 kW → 2.5 ชม. = 150 นาที → ok
  assert.strictEqual(evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: -1 }, cfg).level, 'ok');
  // ดึง 2 kW → 1.25 ชม. = 75 นาที → warning
  assert.strictEqual(evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: -2 }, cfg).level, 'warning');
  // ดึง 5 kW → 30 นาที → critical
  assert.strictEqual(evaluateBatteryRisk({ batterySoc: 50, avgPowerKw: -5 }, cfg).level, 'critical');
});

// ─────────────────────────── config validation ───────────────────────────

test('worker rejects invalid config at construction', () => {
  assert.throws(() => new PowerGuardWorker(makeWorker().deps, makeCfg({ criticalMinutes: 30, warningMinutes: 30 })));
  assert.throws(() => new PowerGuardWorker(makeWorker().deps, makeCfg({ criticalMinutes: 40, warningMinutes: 30 })));
  assert.throws(() => new PowerGuardWorker(makeWorker().deps, makeCfg({ capacityKwh: 0 })));
  assert.throws(() => new PowerGuardWorker(makeWorker().deps, makeCfg({ warningMinutes: 0 })));
  assert.throws(() => new PowerGuardWorker(makeWorker().deps, makeCfg({ criticalMinutes: -1 })));
});

// ─────────────────────────── worker behavior ───────────────────────────

test('worker notifies when entering warning', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batterySoc: 25, avgPowerKw: -5 }); // 15 นาที
  const result: PowerGuardCheckResult = await worker.checkOnce();
  assert.strictEqual(result.level, 'warning');
  assert.strictEqual(result.notified, true);
  assert.deepStrictEqual(deps.notified.map((n) => n.level), ['warning']);
  assert.match(deps.notified[0].message, /POWER/i);
  assert.ok(deps.calls.includes('load'));
});

test('worker notifies when entering critical', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // 3 นาที
  const result = await worker.checkOnce();
  assert.strictEqual(result.level, 'critical');
  assert.strictEqual(result.notified, true);
  assert.deepStrictEqual(deps.notified.map((n) => n.level), ['critical']);
});

test('worker does not re-notify on consecutive ticks at the same level', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batterySoc: 25, avgPowerKw: -5 }); // warning
  await worker.checkOnce();
  await worker.checkOnce();
  await worker.checkOnce();
  assert.deepStrictEqual(deps.notified.map((n) => n.level), ['warning']);
});

test('worker notifies again after recovering to ok and dropping again', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batterySoc: 25, avgPowerKw: -5 }); // warning
  await worker.checkOnce();
  deps.setSnapshot({ batterySoc: 100, avgPowerKw: 1 }); // charging → ok
  const recovered = await worker.checkOnce();
  assert.strictEqual(recovered.level, 'ok');
  deps.setSnapshot({ batterySoc: 25, avgPowerKw: -5 }); // warning อีกครั้ง
  const again = await worker.checkOnce();
  assert.strictEqual(again.notified, true);
  assert.deepStrictEqual(deps.notified.map((n) => n.level), ['warning', 'warning']);
});

test('worker triggers shutdown when critical and a command is configured', async () => {
  const cfg = makeCfg({ shutdownCommand: 'shutdown /s /t 60' });
  const { deps, worker } = makeWorker({}, cfg);
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // critical
  const result = await worker.checkOnce();
  assert.strictEqual(result.shutdownTriggered, true);
  assert.ok(deps.calls.includes('shutdown:shutdown /s /t 60'));
});

test('worker triggers shutdown only once per critical episode', async () => {
  const cfg = makeCfg({ shutdownCommand: 'shutdown /s /t 60' });
  const { deps, worker } = makeWorker({}, cfg);
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // critical
  await worker.checkOnce();
  await worker.checkOnce();
  await worker.checkOnce();
  const shutdownCalls = deps.calls.filter((c) => c.startsWith('shutdown:'));
  assert.strictEqual(shutdownCalls.length, 1);
});

test('worker re-arms shutdown after recovering to ok', async () => {
  const cfg = makeCfg({ shutdownCommand: 'shutdown /s /t 60' });
  const { deps, worker } = makeWorker({}, cfg);
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // critical → shutdown
  await worker.checkOnce();
  deps.setSnapshot({ batterySoc: 100, avgPowerKw: 1 }); // ok → re-arm
  await worker.checkOnce();
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // critical อีกครั้ง
  await worker.checkOnce();
  const shutdownCalls = deps.calls.filter((c) => c.startsWith('shutdown:'));
  assert.strictEqual(shutdownCalls.length, 2);
});

test('worker does not run shutdown when no command is configured', async () => {
  const { deps, worker } = makeWorker(); // shutdownCommand = ''
  deps.setSnapshot({ batterySoc: 5, avgPowerKw: -5 }); // critical
  const result = await worker.checkOnce();
  assert.strictEqual(result.notified, true);
  assert.strictEqual(result.shutdownTriggered, false);
  assert.ok(!deps.calls.some((c) => c.startsWith('shutdown:')));
});

test('worker ignores unknown data — no notify, no shutdown', async () => {
  const cfg = makeCfg({ shutdownCommand: 'shutdown /s /t 60' });
  const { deps, worker } = makeWorker({}, cfg);
  deps.setSnapshot({ batterySoc: null, avgPowerKw: null });
  const result = await worker.checkOnce();
  assert.strictEqual(result.level, 'unknown');
  assert.strictEqual(result.notified, false);
  assert.strictEqual(result.shutdownTriggered, false);
  assert.strictEqual(deps.notified.length, 0);
});

test('worker start() runs an immediate check and schedules the next one; stop() clears it', async () => {
  const callsToClear: unknown[] = [];
  const fakeTimers: Array<{ fn: () => void; ms: number }> = [];
  const { deps, worker } = makeWorker({
    setInterval: (fn: () => void, ms: number) => {
      fakeTimers.push({ fn, ms });
      return 42 as unknown as NodeJS.Timeout;
    },
    clearInterval: (t: NodeJS.Timeout) => {
      callsToClear.push(t);
    },
  });
  deps.setSnapshot({ batterySoc: 25, avgPowerKw: -5 }); // warning
  await worker.start();
  assert.strictEqual(deps.notified.length, 1, 'immediate check should run on start');
  assert.strictEqual(fakeTimers.length, 1);
  assert.strictEqual(fakeTimers[0].ms, 60000);
  // จำลอง tick ถัดไป — ยังอยู่ warning → ไม่ notify ซ้ำ
  fakeTimers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(deps.notified.length, 1);
  worker.stop();
  assert.deepStrictEqual(callsToClear, [42]);
});
