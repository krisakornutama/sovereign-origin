// tests/upsShutdown.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateUpsShutdown,
  UpsShutdownService,
  SHUTDOWN_SEQUENCE,
  type UpsShutdownDeps,
  type UpsShutdownConfig,
} from '../src/services/ups-shutdown.service';
import type { UpsSnapshot } from '../src/services/ups-monitor.service';

const CFG: UpsShutdownConfig = {
  batteryPct: 15,
  runtimeSec: 180,
  command: 'shutdown -h now',
  dryRun: false,
  checkIntervalMs: 15000,
};

function makeDeps(over: Partial<UpsShutdownDeps> = {}): UpsShutdownDeps & {
  calls: string[];
  auditPayloads: Array<{ text: string; raw: Record<string, unknown> }>;
  execs: string[];
} {
  const calls: string[] = [];
  const auditPayloads: Array<{ text: string; raw: Record<string, unknown> }> = [];
  const execs: string[] = [];
  const deps: UpsShutdownDeps = {
    readUps: () => Promise.resolve({ batteryCharge: 100, batteryRuntimeSec: 600, batteryVoltage: null, powerWatts: null }),
    checkpointDb: async () => { calls.push('checkpoint'); },
    drainTelemetry: async () => { calls.push('drain_telemetry'); },
    emergencyBackup: async () => { calls.push('emergency_backup'); },
    audit: async (p) => { calls.push('audit_initiated'); auditPayloads.push(p); },
    runShutdown: async (cmd) => { calls.push('exec_shutdown'); execs.push(cmd); },
    now: () => 0,
    ...over,
  };
  return { ...deps, calls, auditPayloads, execs };
}

function snap(charge: number | null, runtime: number | null): UpsSnapshot {
  return { batteryCharge: charge, batteryRuntimeSec: runtime, batteryVoltage: null, powerWatts: null };
}

describe('evaluateUpsShutdown (pure threshold logic)', () => {
  it('triggers when battery.charge <= pct', () => {
    const r = evaluateUpsShutdown(snap(15, 999), CFG);
    assert.equal(r.trigger, true);
    assert.match(r.reason!, /15%/);
  });

  it('triggers when battery.runtime <= sec', () => {
    const r = evaluateUpsShutdown(snap(80, 180), CFG);
    assert.equal(r.trigger, true);
    assert.match(r.reason!, /180s/);
  });

  it('triggers on charge OR runtime', () => {
    const r = evaluateUpsShutdown(snap(10, 300), CFG);
    assert.equal(r.trigger, true);
  });

  it('does not trigger when above both thresholds', () => {
    const r = evaluateUpsShutdown(snap(80, 900), CFG);
    assert.equal(r.trigger, false);
  });

  it('does not trigger when both readings unknown', () => {
    const r = evaluateUpsShutdown(snap(null, null), CFG);
    assert.equal(r.trigger, false);
  });
});

describe('UpsShutdownService state machine', () => {
  it('dry-run runs full sequence in order without executing shutdown', async () => {
    const { calls, auditPayloads, execs } = makeDeps({
      readUps: () => Promise.resolve(snap(10, 60)),
    });
    const svc = new UpsShutdownService(
      { readUps: () => Promise.resolve(snap(10, 60)), checkpointDb: async () => { calls.push('checkpoint'); }, drainTelemetry: async () => { calls.push('drain_telemetry'); }, emergencyBackup: async () => { calls.push('emergency_backup'); }, audit: async (p) => { calls.push('audit_initiated'); auditPayloads.push(p); }, runShutdown: async (c) => { calls.push('exec_shutdown'); execs.push(c); } },
      { ...CFG, dryRun: true }
    );
    const res = await svc.checkOnce();
    assert.equal(res.triggered, true);
    assert.deepEqual(calls, ['checkpoint', 'drain_telemetry', 'emergency_backup', 'audit_initiated']);
    assert.equal(execs.length, 0, 'dry-run ต้องไม่สั่ง shutdown จริง');
    assert.equal(auditPayloads[0].raw.dryRun, true);
    assert.equal(svc.getPhase(), 'idle', 'dry-run กลับ idle ให้ทดสอบซ้ำได้');
  });

  it('real run executes the shutdown command after audit', async () => {
    const { calls, execs } = makeDeps({
      readUps: () => Promise.resolve(snap(8, 120)),
    });
    const svc = new UpsShutdownService(
      { readUps: () => Promise.resolve(snap(8, 120)), checkpointDb: async () => { calls.push('checkpoint'); }, drainTelemetry: async () => { calls.push('drain_telemetry'); }, emergencyBackup: async () => { calls.push('emergency_backup'); }, audit: async () => { calls.push('audit_initiated'); }, runShutdown: async (c) => { calls.push('exec_shutdown'); execs.push(c); } },
      { ...CFG, dryRun: false }
    );
    await svc.checkOnce();
    assert.deepEqual(calls, SHUTDOWN_SEQUENCE);
    assert.deepEqual(execs, ['shutdown -h now']);
    assert.equal(svc.getPhase(), 'shutting_down', 'หลังสั่ง shutdown จริง ล็อกสถานะ');
  });

  it('does not re-trigger while shutting down', async () => {
    let charge = 8;
    let checks = 0;
    const { execs } = makeDeps({
      readUps: () => { checks++; return Promise.resolve(snap(charge, 120)); },
    });
    const svc = new UpsShutdownService(
      { readUps: () => { checks++; return Promise.resolve(snap(charge, 120)); }, checkpointDb: async () => {}, drainTelemetry: async () => {}, emergencyBackup: async () => {}, audit: async () => {}, runShutdown: async (c) => { execs.push(c); } },
      { ...CFG, dryRun: false }
    );
    await svc.checkOnce();
    const second = await svc.checkOnce();
    assert.equal(second.triggered, false);
    assert.equal(execs.length, 1, 'ต้องยิง shutdown แค่ครั้งเดียว');
  });

  it('dry-run respects cooldown window', async () => {
    let now = 0;
    const { calls } = makeDeps({
      readUps: () => Promise.resolve(snap(10, 60)),
    });
    const deps = { readUps: () => Promise.resolve(snap(10, 60)), checkpointDb: async () => { calls.push('checkpoint'); }, drainTelemetry: async () => { calls.push('drain_telemetry'); }, emergencyBackup: async () => { calls.push('emergency_backup'); }, audit: async () => { calls.push('audit_initiated'); }, runShutdown: async () => { calls.push('exec_shutdown'); }, now: () => now };
    const svc = new UpsShutdownService(deps, { ...CFG, dryRun: true });
    now = 0;
    await svc.checkOnce();
    now = 5000; // ภายใน cooldown 15000ms
    const res = await svc.checkOnce();
    assert.equal(res.triggered, false);
    assert.match(res.reason!, /cooldown/);
  });

  it('does not trigger when UPS read fails', async () => {
    const deps = makeDeps({
      readUps: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const svc = new UpsShutdownService(
      { readUps: () => Promise.reject(new Error('ECONNREFUSED')), checkpointDb: async () => {}, drainTelemetry: async () => {}, emergencyBackup: async () => {}, audit: async () => {}, runShutdown: async () => {} },
      { ...CFG, dryRun: false }
    );
    const res = await svc.checkOnce();
    assert.equal(res.triggered, false);
  });

  it('releases lock and can retry after a sequence error', async () => {
    const { execs } = makeDeps({});
    let failBackup = true;
    let now = 0;
    const svc = new UpsShutdownService(
      { readUps: () => Promise.resolve(snap(5, 60)), checkpointDb: async () => {}, drainTelemetry: async () => {}, emergencyBackup: async () => { if (failBackup) throw new Error('backup boom'); }, audit: async () => {}, runShutdown: async (c) => { execs.push(c); }, now: () => now },
      { ...CFG, dryRun: false }
    );
    await svc.checkOnce();
    assert.equal(execs.length, 0, 'backup ล้ม → ไม่ยิง shutdown');
    assert.equal(svc.getPhase(), 'idle', 'ปลดล็อกให้ลองรอบถัดไป');
    failBackup = false;
    now = 20000; // พ้น cooldown (15000ms)
    await svc.checkOnce();
    assert.equal(execs.length, 1, 'รอบถัดไปสำเร็จ → shutdown');
  });

  it('validates thresholds on construction', () => {
    assert.throws(() => new UpsShutdownService(makeDeps(), { ...CFG, batteryPct: 120 }));
    assert.throws(() => new UpsShutdownService(makeDeps(), { ...CFG, runtimeSec: 0 }));
  });
});