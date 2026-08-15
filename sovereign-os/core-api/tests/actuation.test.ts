import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ตั้ง env ก่อน import service (module-level const ผูกค่าตอนโหลดครั้งแรก)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-act-'));
process.env.ACT_STATE_FILE = path.join(TMP, 'actuation-state.json');
process.env.ACT_VERIFY_TIMEOUT_MS = '150';
process.env.ACT_VERIFY_POLL_MS = '20';
process.env.ACT_RELAY_COOLDOWN_MS = '0'; // flow test รันติดกัน — กฎ cooldown ครอบด้วย pure test แยก

describe('Actuation: Safety Envelope (กฎเหล็ก)', async () => {
  const { evaluateEnvelope, verifyStateChange, mapLeversToActuators, resolveLever } = await import('../src/services/actuation.service');

  const act = (over: Partial<any> = {}) => ({
    id: 'x', kind: 'relay', label: 'x', state: 'off', class: 'standard',
    energyImpactKw: 0.4, ...over,
  });
  const cfg = {
    batteryFloorPct: 20, batteryHoldPct: 30, heavyDrawKw: 0.5,
    tempCeilingC: 45, relayCooldownMs: 60000, criticalRelays: ['wan-link', 'water-valve'],
    occupancyGraceMs: 1800000, verifyTimeoutMs: 100, verifyPollMs: 10,
  };
  const snap = (over: Partial<any> = {}) => ({
    batterySoc: 50, powerKw: -0.5, tempC: 30, occupied: false, ...over,
  });

  test('CRITICAL_CIRCUIT: AI สั่งวงจร critical ไม่ได้ แต่ human สั่งได้', () => {
    const a = act({ id: 'wan-link', class: 'critical' });
    assert.equal(evaluateEnvelope(a, 'off', 'governor', snap(), cfg, 0).allowed, false);
    assert.equal(evaluateEnvelope(a, 'off', 'governor', snap(), cfg, 0).rule, 'CRITICAL_CIRCUIT');
    assert.equal(evaluateEnvelope(a, 'off', 'human', snap(), cfg, 0).allowed, true);
    assert.equal(evaluateEnvelope(a, 'off', 'system', snap(), cfg, 0).allowed, true, 'system (ฉุกเฉิน: DEFCON/first-responder) ต้องผ่านได้');
  });

  test('BATTERY_FLOOR: แบต <20% ห้ามเปิดของที่กินไฟ / ปิดได้', () => {
    const a = act();
    const s = snap({ batterySoc: 15 });
    assert.equal(evaluateEnvelope(a, 'on', 'governor', s, cfg, 0).allowed, false);
    assert.equal(evaluateEnvelope(a, 'on', 'governor', s, cfg, 0).rule, 'BATTERY_FLOOR');
    assert.equal(evaluateEnvelope(a, 'off', 'governor', s, cfg, 0).allowed, true);
  });

  test('BATTERY_HOLD: แบต <30% ห้ามเปิดโหลด >0.5kW แต่โหลดเบาเปิดได้', () => {
    const s = snap({ batterySoc: 25 });
    assert.equal(evaluateEnvelope(act({ energyImpactKw: 0.8 }), 'on', 'governor', s, cfg, 0).rule, 'BATTERY_HOLD');
    assert.equal(evaluateEnvelope(act({ energyImpactKw: 0.1 }), 'on', 'governor', s, cfg, 0).allowed, true);
  });

  test('TEMP_CEILING: ≥45°C ห้ามทุกอย่าง ยกเว้นปิดของที่กินไฟ (ลดโหลด)', () => {
    const s = snap({ tempC: 48 });
    assert.equal(evaluateEnvelope(act(), 'on', 'human', s, cfg, 0).allowed, false);
    assert.equal(evaluateEnvelope(act(), 'on', 'human', s, cfg, 0).rule, 'TEMP_CEILING');
    assert.equal(evaluateEnvelope(act({ energyImpactKw: 0.4 }), 'off', 'human', s, cfg, 0).allowed, true);
    assert.equal(evaluateEnvelope(act({ energyImpactKw: 0 }), 'off', 'human', s, cfg, 0).allowed, false);
  });

  test('RELAY_COOLDOWN: สั่งซ้ำภายใน 60s โดนบล็อก เกินแล้วผ่าน', () => {
    const now = Date.now();
    assert.equal(evaluateEnvelope(act(), 'on', 'human', snap(), cfg, now - 5000).rule, 'RELAY_COOLDOWN');
    assert.equal(evaluateEnvelope(act(), 'on', 'human', snap(), cfg, now - 70000).allowed, true);
    assert.equal(evaluateEnvelope(act(), 'on', 'human', snap(), cfg, 0).allowed, true);
  });

  test('OCCUPANCY: มีคนอยู่บ้าน → AI ห้ามปิดกลุ่ม shutdown แต่ human สั่งได้', () => {
    const a = act({ id: 'water-valve' });
    const s = snap({ occupied: true });
    assert.equal(evaluateEnvelope(a, 'off', 'governor', s, cfg, 0).rule, 'OCCUPANCY');
    assert.equal(evaluateEnvelope(a, 'off', 'human', s, cfg, 0).allowed, true);
    assert.equal(evaluateEnvelope(a, 'off', 'governor', snap({ occupied: false }), cfg, 0).allowed, true);
  });
});

describe('Actuation: Lever → Actuator Mapper', async () => {
  const { mapLeversToActuators, resolveLever } = await import('../src/services/actuation.service');
  const actuators = [
    { id: 'load-1', kind: 'relay', state: 'off' },
    { id: 'patrol-light', kind: 'relay', state: 'off' },
    { id: 'wan-link', kind: 'relay', state: 'on' },
    { id: 'water-valve', kind: 'relay', state: 'on' },
  ] as any;
  const map = [
    { lever: 'powerSharing', actuatorId: 'load-1', threshold: 50 },
    { lever: 'policePatrols', actuatorId: 'patrol-light', threshold: 50 },
    { lever: 'foreignAppeasement', actuatorId: 'wan-link', threshold: 60, invert: true },
    { lever: 'budget.welfare', actuatorId: 'water-valve', threshold: 30 },
  ];

  test('resolveLever: รองรับ dot-path', () => {
    assert.equal(resolveLever({ budget: { welfare: 40 } }, 'budget.welfare'), 40);
    assert.equal(resolveLever({ powerSharing: 60 }, 'powerSharing'), 60);
    assert.equal(resolveLever({}, 'not.there'), null);
  });

  test('ข้าม threshold → สั่งเฉพาะตัวที่สถานะเปลี่ยน', () => {
    const cmds = mapLeversToActuators(
      { powerSharing: 70, policePatrols: 30, foreignAppeasement: 50, budget: { welfare: 20 } },
      actuators as any, map as any
    );
    const ids = cmds.map((c) => c.actuatorId).sort();
    assert.deepEqual(ids, ['load-1', 'water-valve']); // load-1 เปิด (70≥50), water-valve ปิด (welfare 20<30), ที่เหลือสถานะตรงอยู่แล้ว
    const wv = cmds.find((c) => c.actuatorId === 'water-valve');
    assert.equal(wv?.desiredState, 'off');
  });

  test('ไม่มี lever ใน patch = ไม่สั่งอะไร', () => {
    const cmds = mapLeversToActuators({ subsidy: 10 }, actuators as any, map as any);
    assert.equal(cmds.length, 0);
  });
});

describe('Actuation: Closed-Loop Verifier', async () => {
  const { verifyStateChange } = await import('../src/services/actuation.service');

  test('สถานะตรง = ผ่าน', () => {
    assert.equal(verifyStateChange('load-1', 'on', [], 'on').ok, true);
  });
  test('สถานะไม่ตรง = fail พร้อมรายละเอียด', () => {
    const r = verifyStateChange('load-1', 'on', [], 'off');
    assert.equal(r.ok, false);
    assert.match(r.detail, /off/);
  });
  test('simFailureIds → fail เสมอ (จำลอง relay ค้าง)', () => {
    assert.equal(verifyStateChange('load-1', 'on', ['load-1'], 'on').ok, false);
  });
});

describe('Actuation: execute flow (sandbox, ไฟล์ state จริงชั่วคราว)', async () => {
  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  test('executeCommand: human เปิด load-1 ผ่าน → สถานะเปลี่ยน + history ครบ', async () => {
    const { actuationService } = await import('../src/services/actuation.service');
    const r = await actuationService.executeCommand({ actuatorId: 'load-1', desiredState: 'on', actor: 'human', reason: 'test' });
    assert.equal(r.ok, true, r.reason);
    const st = actuationService.status();
    assert.equal(st.actuators.find((a: any) => a.id === 'load-1')?.state, 'on');
    assert.equal(st.history[0].action, 'verified');
  });

  test('executeCommand: AI สั่งวงจร critical → DENIED + สถานะไม่เปลี่ยน', async () => {
    const { actuationService } = await import('../src/services/actuation.service');
    const r = await actuationService.executeCommand({ actuatorId: 'wan-link', desiredState: 'off', actor: 'governor', reason: 'test' });
    assert.equal(r.ok, false);
    assert.equal(r.rule, 'CRITICAL_CIRCUIT');
    assert.equal(actuationService.status().actuators.find((a: any) => a.id === 'wan-link')?.state, 'on');
  });

  test('simulate-failure → ACTUATION_FAILED + rollback กลับสถานะเดิม', async () => {
    const { actuationService } = await import('../src/services/actuation.service');
    actuationService.toggleSimFailure('load-1');
    const r = await actuationService.executeCommand({ actuatorId: 'load-1', desiredState: 'off', actor: 'human', reason: 'test fail' });
    assert.equal(r.ok, false);
    assert.equal(r.action, 'failed');
    const st = actuationService.status();
    assert.equal(st.actuators.find((a: any) => a.id === 'load-1')?.state, 'on', 'ต้อง rollback กลับ on');
    assert.equal(st.simFailureIds.includes('load-1'), true);
    actuationService.toggleSimFailure('load-1'); // ปิดการจำลอง
  });

  test('syncActuatorsFromLevers: levers → actuator + envelope ยังทำงาน', async () => {
    const { actuationService } = await import('../src/services/actuation.service');
    const results = await actuationService.syncActuatorsFromLevers({ powerSharing: 80, policePatrols: 70 }, 'governor');
    const st = actuationService.status();
    assert.equal(st.actuators.find((a: any) => a.id === 'load-1')?.state, 'on');
    assert.equal(st.actuators.find((a: any) => a.id === 'patrol-light')?.state, 'on');
    // governor สั่ง critical ไม่ได้ — wan-link ยัง on อยู่
    assert.equal(st.actuators.find((a: any) => a.id === 'wan-link')?.state, 'on');
    assert.ok(Array.isArray(results));
  });

  test('setMode: real ถูกล็อกโดย ACT_ALLOW_REAL', async () => {
    const { actuationService } = await import('../src/services/actuation.service');
    delete process.env.ACT_ALLOW_REAL;
    const r = actuationService.setMode('real');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /ACT_ALLOW_REAL/);
    assert.equal(actuationService.setMode('sandbox').ok, true);
  });
});