import './setup-env';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { runDefconAction, type DefconActionDeps } from '../src/services/defcon-actions.service';

function makeDeps(over: Partial<DefconActionDeps> = {}): {
  deps: DefconActionDeps;
  executed: { id: string; state: string; reason: string }[];
  mqtt: { id: string; state: string }[];
  execs: string[];
  counts: { backups: number; meshReps: number };
  logs: string[];
} {
  const executed: { id: string; state: string; reason: string }[] = [];
  const mqtt: { id: string; state: string }[] = [];
  const execs: string[] = [];
  const logs: string[] = [];
  const counts = { backups: 0, meshReps: 0 };
  const deps: DefconActionDeps = {
    dryRun: true,
    executeActuator: async (id, state, reason) => {
      executed.push({ id, state, reason });
      return { ok: true };
    },
    backup: async () => {
      counts.backups++;
    },
    meshReplicate: async () => {
      counts.meshReps++;
    },
    sendTelegramMsg: async () => {},
    mqttRelay: (id, state) => mqtt.push({ id, state }),
    execCmd: async (cmd) => {
      execs.push(cmd);
    },
    log: (d) => logs.push(d),
    ...over,
  };
  return { deps, executed, mqtt, execs, counts, logs };
}

describe('DEFCON Dry-Run: มาตรการไป sandbox ไม่ใช่ของจริง', () => {
  test('relays_off (dry) → ปิด load-1 + patrol-light ผ่าน executeActuator ไม่แตะ MQTT', async () => {
    const m = makeDeps();
    await runDefconAction(2, { id: 'relays_off' }, m.deps);
    assert.deepEqual(m.executed.map((e) => e.id), ['load-1', 'patrol-light']);
    assert.equal(m.executed[0].state, 'off');
    assert.equal(m.mqtt.length, 0);
    assert.ok(m.logs.some((l) => l.includes('[DRY-RUN]')));
  });

  test('wan_disconnect (dry) → ปิด wan-link ใน sandbox ไม่รัน exec คำสั่ง', async () => {
    const m = makeDeps();
    await runDefconAction(1, { id: 'wan_disconnect' }, m.deps);
    assert.equal(m.executed.length, 1);
    assert.equal(m.executed[0].id, 'wan-link');
    assert.equal(m.executed[0].state, 'off');
    assert.equal(m.execs.length, 0);
  });

  test('charge_battery (dry) → load-1 on; security_on (dry) → patrol-light on', async () => {
    const m = makeDeps();
    await runDefconAction(3, { id: 'charge_battery' }, m.deps);
    assert.equal(m.executed[0].id, 'load-1');
    assert.equal(m.executed[0].state, 'on');
    const m2 = makeDeps();
    await runDefconAction(1, { id: 'security_on' }, m2.deps);
    assert.equal(m2.executed[0].id, 'patrol-light');
    assert.equal(m2.executed[0].state, 'on');
  });

  test('envelope บล็อก → executeActuator คืน rule แต่ไม่พัง (log บอก blocked)', async () => {
    const m = makeDeps({
      executeActuator: async () => ({ ok: false, rule: 'BATTERY_FLOOR' }),
    });
    await runDefconAction(1, { id: 'security_on' }, m.deps);
    assert.ok(m.logs.some((l) => l.includes('blocked: BATTERY_FLOOR')));
  });

  test('backup_cold_storage → backup จริง + mesh replicate (ปลอดภัยทั้งสองโหมด)', async () => {
    const m = makeDeps();
    await runDefconAction(2, { id: 'backup_cold_storage' }, m.deps);
    assert.equal(m.counts.backups, 1);
    assert.equal(m.counts.meshReps, 1);
  });

  test('REAL mode (dryRun=false) → MQTT จริง + exec เหมือนเดิม', async () => {
    const m = makeDeps({ dryRun: false });
    process.env.DEFCON_WAN_DISCONNECT_CMD = 'echo cut';
    try {
      await runDefconAction(2, { id: 'relays_off' }, m.deps);
      assert.ok(m.mqtt.some((p) => p.state === '0'));
      assert.equal(m.executed.length, 0);
      const m2 = makeDeps({ dryRun: false });
      await runDefconAction(1, { id: 'wan_disconnect' }, m2.deps);
      assert.equal(m2.execs[0], 'echo cut');
    } finally {
      delete process.env.DEFCON_WAN_DISCONNECT_CMD;
    }
  });
});