import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import net from 'net';
import {
  parseNutVars,
  snapshotToTelemetry,
  fetchNutVars,
  UpsMonitorWorker,
  type UpsSnapshot,
  type UpsConfig,
  type UpsMonitorDeps,
} from '../src/services/ups-monitor.service';

const DEFAULT_CFG: UpsConfig = {
  host: 'localhost',
  port: 3493,
  upsName: 'ups',
  nodeId: '11111111-1111-1111-1111-111111111111',
  checkIntervalMs: 30000,
  lowBatteryThreshold: 20,
  lowBatteryCooldownMs: 600000,
};

function makeCfg(overrides: Partial<UpsConfig> = {}): UpsConfig {
  return { ...DEFAULT_CFG, ...overrides };
}

function makeWorker(overrides: Partial<UpsMonitorDeps> = {}, cfg: UpsConfig = DEFAULT_CFG) {
  const calls: string[] = [];
  const inserted: Array<{ metric: string; value: number }> = [];
  const telemetryEmits: Array<Record<string, number>> = [];
  const lowBatteryEmits: UpsSnapshot[] = [];
  const deps: UpsMonitorDeps & {
    calls: string[];
    inserted: Array<{ metric: string; value: number }>;
    telemetryEmits: Array<Record<string, number>>;
    lowBatteryEmits: UpsSnapshot[];
    snapshot: UpsSnapshot;
    setSnapshot: (s: UpsSnapshot) => void;
  } = {
    calls,
    inserted,
    telemetryEmits,
    lowBatteryEmits,
    snapshot: { batteryCharge: null, batteryRuntimeSec: null, batteryVoltage: null, powerWatts: null },
    async fetchVars() {
      calls.push('fetch');
      return this.snapshot;
    },
    async insertTelemetry(metric, value) {
      calls.push(`insert:${metric}`);
      inserted.push({ metric, value });
    },
    emitTelemetryUpdate(data) {
      calls.push('emit:telemetry');
      telemetryEmits.push(data);
    },
    emitLowBattery(snapshot) {
      calls.push('emit:lowbattery');
      lowBatteryEmits.push(snapshot);
    },
    setSnapshot(s) {
      this.snapshot = s;
    },
    ...overrides,
  };
  const worker = new UpsMonitorWorker(deps, cfg);
  return { deps, worker };
}

// ─────────────────────────── parseNutVars ───────────────────────────

const NUT_SAMPLE = [
  'BEGIN LIST VAR ups',
  'VAR ups battery.charge "100"',
  'VAR ups battery.runtime "2400"',
  'VAR ups battery.voltage "27.1"',
  'VAR ups ups.power "45"',
  'VAR ups ups.status "OL"',
  'END LIST VAR ups',
];

test('parseNutVars parses standard NUT LIST VAR output', () => {
  const snap = parseNutVars(NUT_SAMPLE);
  assert.strictEqual(snap.batteryCharge, 100);
  assert.strictEqual(snap.batteryRuntimeSec, 2400);
  assert.strictEqual(snap.batteryVoltage, 27.1);
  assert.strictEqual(snap.powerWatts, 45);
});

test('parseNutVars ignores non-VAR lines and unknown vars', () => {
  const snap = parseNutVars([
    'BEGIN LIST VAR ups',
    'VAR ups ups.status "OB"',
    'VAR ups ups.mfr "APC"',
    'junk line without VAR prefix',
    'END LIST VAR ups',
  ]);
  assert.strictEqual(snap.batteryCharge, null);
  assert.strictEqual(snap.powerWatts, null);
});

test('parseNutVars handles empty or non-numeric values as null', () => {
  const snap = parseNutVars([
    'VAR ups battery.charge ""',
    'VAR ups ups.power "OB"',
    'VAR ups battery.voltage "12.5"',
  ]);
  assert.strictEqual(snap.batteryCharge, null);
  assert.strictEqual(snap.powerWatts, null);
  assert.strictEqual(snap.batteryVoltage, 12.5);
});

// ─────────────────────────── snapshotToTelemetry ───────────────────────────

test('snapshotToTelemetry maps charge to battery_soc, watts to kW and voltage to voltage', () => {
  const rows = snapshotToTelemetry({ batteryCharge: 80, batteryRuntimeSec: 1800, batteryVoltage: 27, powerWatts: 450 });
  assert.deepStrictEqual(rows, [
    { metric: 'battery_soc', value: 80 },
    { metric: 'power_kw', value: 0.45 },
    { metric: 'voltage', value: 27 },
  ]);
});

test('snapshotToTelemetry omits missing metrics', () => {
  const rows = snapshotToTelemetry({ batteryCharge: null, batteryRuntimeSec: null, batteryVoltage: null, powerWatts: 120 });
  assert.deepStrictEqual(rows, [{ metric: 'power_kw', value: 0.12 }]);
});

// ─────────────────────────── fetchNutVars (integration over real TCP) ───────────────────────────

test('fetchNutVars reads vars from a real NUT server over TCP', async () => {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (data: string) => {
      if (data.includes('LIST VAR ups')) {
        socket.write(
          'BEGIN LIST VAR ups\n' +
          'VAR ups battery.charge "88"\n' +
          'VAR ups battery.runtime "3600"\n' +
          'VAR ups ups.power "120"\n' +
          'END LIST VAR ups\n'
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as net.AddressInfo;
  try {
    const snap = await fetchNutVars('127.0.0.1', addr.port, 'ups', 3000);
    assert.strictEqual(snap.batteryCharge, 88);
    assert.strictEqual(snap.batteryRuntimeSec, 3600);
    assert.strictEqual(snap.powerWatts, 120);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('fetchNutVars rejects when the NUT server never responds', async () => {
  const server = net.createServer((socket) => {
    // ต้อง consume data ที่ client ส่งมา (ไม่งั้น FIN+data ค้าง buffer → server.close ค้างบน Windows)
    // แต่ไม่ตอบกลับ — ทดสอบ timeout
    socket.on('data', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as net.AddressInfo;
  try {
    await assert.rejects(
      () => fetchNutVars('127.0.0.1', addr.port, 'ups', 200),
      /timed out/i
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ─────────────────────────── config validation ───────────────────────────

test('worker rejects invalid config at construction', () => {
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ host: '' })));
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ port: 0 })));
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ port: 70000 })));
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ checkIntervalMs: 0 })));
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ lowBatteryThreshold: -1 })));
  assert.throws(() => new UpsMonitorWorker(makeWorker().deps, makeCfg({ lowBatteryThreshold: 101 })));
});

// ─────────────────────────── worker behavior ───────────────────────────

test('worker fetches, inserts metrics and emits a telemetry update', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batteryCharge: 80, batteryRuntimeSec: 1800, batteryVoltage: 27, powerWatts: 450 });
  const result = await worker.checkOnce();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.inserted.length, 3);
  assert.deepStrictEqual(deps.inserted, [
    { metric: 'battery_soc', value: 80 },
    { metric: 'power_kw', value: 0.45 },
    { metric: 'voltage', value: 27 },
  ]);
  assert.strictEqual(deps.telemetryEmits.length, 1);
  assert.deepStrictEqual(deps.telemetryEmits[0], { battery_soc: 80, power_kw: 0.45, voltage: 27 });
  assert.strictEqual(deps.lowBatteryEmits.length, 0);
});

test('worker does not emit a telemetry update when nothing could be read', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batteryCharge: null, batteryRuntimeSec: null, batteryVoltage: null, powerWatts: null });
  const result = await worker.checkOnce();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.inserted.length, 0);
  assert.strictEqual(deps.telemetryEmits.length, 0);
});

test('worker emits low battery alert once within the cooldown window', async () => {
  let now = 1_000_000;
  const { deps, worker } = makeWorker({ now: () => now });
  deps.setSnapshot({ batteryCharge: 10, batteryRuntimeSec: 300, batteryVoltage: 24, powerWatts: 200 });
  await worker.checkOnce();
  await worker.checkOnce();
  await worker.checkOnce();
  assert.strictEqual(deps.lowBatteryEmits.length, 1);
  assert.strictEqual(deps.lowBatteryEmits[0].batteryCharge, 10);
});

test('worker re-alerts low battery after the cooldown passes', async () => {
  let now = 1_000_000;
  const { deps, worker } = makeWorker({ now: () => now });
  deps.setSnapshot({ batteryCharge: 10, batteryRuntimeSec: 300, batteryVoltage: 24, powerWatts: 200 });
  await worker.checkOnce();
  now += DEFAULT_CFG.lowBatteryCooldownMs + 1;
  await worker.checkOnce();
  assert.strictEqual(deps.lowBatteryEmits.length, 2);
});

test('worker does not alert when charge is above the threshold', async () => {
  const { deps, worker } = makeWorker();
  deps.setSnapshot({ batteryCharge: 50, batteryRuntimeSec: 6000, batteryVoltage: 27, powerWatts: 100 });
  await worker.checkOnce();
  assert.strictEqual(deps.lowBatteryEmits.length, 0);
});

test('worker handles fetch failure gracefully — no insert, no alert, no throw', async () => {
  const { deps, worker } = makeWorker({
    async fetchVars() {
      throw new Error('connection refused');
    },
  });
  const result = await worker.checkOnce();
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /connection refused/);
  assert.strictEqual(result.inserted.length, 0);
  assert.strictEqual(deps.telemetryEmits.length, 0);
  assert.strictEqual(deps.lowBatteryEmits.length, 0);
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
  deps.setSnapshot({ batteryCharge: 80, batteryRuntimeSec: 1800, batteryVoltage: 27, powerWatts: 450 });
  await worker.start();
  assert.strictEqual(deps.inserted.length, 3, 'immediate check should run on start');
  assert.strictEqual(fakeTimers.length, 1);
  assert.strictEqual(fakeTimers[0].ms, 30000);
  // จำลอง tick ถัดไป — ข้อมูลเดิม → insert ซ้ำได้ตามรอบ
  fakeTimers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(deps.inserted.length, 6);
  worker.stop();
  assert.deepStrictEqual(callsToClear, [42]);
});
