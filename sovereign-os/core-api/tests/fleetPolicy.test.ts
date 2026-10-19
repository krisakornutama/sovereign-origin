// tests/fleetPolicy.test.ts
//
// Fleet Control Plane — pure policy tests
// เน้นพฤติกรรมที่พลาดแล้วเจ็บ:
//   • rollout ต้อง deterministic (เครื่องเดิมได้กลุ่มเดิม)
//   • compliance ต้องแยก offline / unverified / held / update ให้ถูก
//   • patch ที่พิมพ์ผิดต้องถูกปฏิเสธ ไม่ใช่เงียบๆ ใช้ค่าเดิม
//   • ไฟล์ policy ต้องอ่านกลับได้ และไม่พังเมื่อเจอค่าขยะ
import './setup-env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyMachineOverride,
  applyPolicyPatch,
  channelForMachine,
  decideUpdateGate,
  defaultFleetPolicy,
  evaluateMachineCompliance,
  fleetPolicyForClient,
  isRolloutEligible,
  normalizeFleetPolicy,
  readFleetPolicy,
  rolloutBucket,
  validateMachineOverride,
  validatePolicyPatch,
  writeFleetPolicy,
  type FleetPolicy,
} from '../src/services/fleet-policy.service';
import { fleetFile } from '../src/services/fleet-store.service';

let root = '';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-fleet-policy-'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('fleet policy — validation', () => {
  it('default = stable 100 / beta 25 / canary 5 และไม่ให้ override ใคร', () => {
    const policy = defaultFleetPolicy(new Date(0));
    assert.equal(policy.defaultChannel, 'stable');
    assert.equal(policy.channels.stable.rolloutPercent, 100);
    assert.equal(policy.channels.beta.rolloutPercent, 25);
    assert.equal(policy.channels.canary.rolloutPercent, 5);
    assert.deepEqual(policy.machines, {});
  });

  it('ปฏิเสธ field แปลกปลอมและเปอร์เซ็นต์ผิด', () => {
    assert.equal(validatePolicyPatch({ nope: true }).ok, false);
    assert.equal(validatePolicyPatch({}).ok, false);
    assert.equal(validatePolicyPatch({ channels: { stable: { rolloutPercent: 101 } } }).ok, false);
    assert.equal(validatePolicyPatch({ channels: { stable: { rolloutPercent: 12.5 } } }).ok, false);
    assert.equal(validatePolicyPatch({ channels: { production: { rolloutPercent: 10 } } }).ok, false);
    assert.equal(validatePolicyPatch({ notes: '   ' }).ok, false);
    assert.equal(validatePolicyPatch({ defaultChannel: 'nightly' }).ok, false);
  });

  it('รับ patch ที่ถูกและ merge ค่าเดิมไว้', () => {
    const checked = validatePolicyPatch({
      defaultChannel: 'beta',
      channels: { beta: { rolloutPercent: 40 } },
      requireLanVerification: false,
      notes: 'ทดสอบ',
    });
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    const before = defaultFleetPolicy(new Date(0));
    before.machines['machine-1'] = { site: 'HQ' };
    const next = applyPolicyPatch(before, checked.patch, 'user-1', new Date(1000));
    assert.equal(next.defaultChannel, 'beta');
    assert.equal(next.channels.beta.rolloutPercent, 40);
    assert.equal(next.channels.stable.rolloutPercent, 100);
    assert.equal(next.requireLanVerification, false);
    assert.equal(next.notes, 'ทดสอบ');
    assert.equal(next.machines['machine-1']?.site, 'HQ');
    assert.equal(next.updatedBy, 'user-1');
  });

  it('normalize ค่าขยะเป็นค่าเริ่มต้นแบบ fail-closed', () => {
    const policy = normalizeFleetPolicy({
      defaultChannel: 'nightly',
      channels: { stable: { rolloutPercent: 999 }, beta: { rolloutPercent: -5 } },
      requireLanVerification: 'false',
      machines: { '../etc/passwd': { site: 'x' }, 'ok-id': { channel: 'canary' } },
    });
    assert.equal(policy.defaultChannel, 'stable');
    assert.equal(policy.channels.stable.rolloutPercent, 100);
    assert.equal(policy.channels.beta.rolloutPercent, 0);
    assert.equal(policy.requireLanVerification, true);
    assert.deepEqual(Object.keys(policy.machines), ['ok-id']);
  });
});

describe('fleet policy — rollout', () => {
  it('bucket เดิมทุกครั้ง และอยู่ 0–99', () => {
    const a = rolloutBucket('11111111-1111-1111-1111-111111111111', 'stable');
    const b = rolloutBucket('11111111-1111-1111-1111-111111111111', 'stable');
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 100);
  });

  it('100% = ทุกเครื่อง, 0% = ไม่มีเครื่อง', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = `machine-${i}`;
      assert.equal(isRolloutEligible(id, 'stable', 100), true);
      assert.equal(isRolloutEligible(id, 'stable', 0), false);
    }
  });

  it('25% ได้ประมาณหนึ่งในสี่ (ไม่ใช่ 0 หรือทั้งหมด)', () => {
    let hit = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (isRolloutEligible(`machine-${i}`, 'beta', 25)) hit += 1;
    }
    assert.ok(hit > 350 && hit < 650, `expected ~500, got ${hit}`);
  });

  it('override channel ชนะ default และบอกที่มา', () => {
    const policy = defaultFleetPolicy(new Date(0));
    policy.machines['m-1'] = { channel: 'canary' };
    assert.deepEqual(channelForMachine(policy, 'm-1'), { channel: 'canary', source: 'override' });
    assert.deepEqual(channelForMachine(policy, 'm-2'), { channel: 'stable', source: 'default' });
  });

  it('gate อัปเดต: disabled ชนะ, rollout 0% = hold, 100% = ผ่าน', () => {
    const policy = defaultFleetPolicy(new Date(0));
    const disabled = decideUpdateGate({ id: 'm-1', status: 'disabled' }, policy);
    assert.equal(disabled.allowed, false);
    assert.equal(disabled.reason, 'machine_disabled');

    policy.channels.stable.rolloutPercent = 0;
    const held = decideUpdateGate({ id: 'm-1', status: 'online' }, policy);
    assert.equal(held.allowed, false);
    assert.equal(held.reason, 'rollout_hold');

    policy.channels.stable.rolloutPercent = 100;
    const ok = decideUpdateGate({ id: 'm-1', status: 'online' }, policy);
    assert.equal(ok.allowed, true);
    assert.equal(ok.reason, 'ok');
  });
});

describe('fleet policy — compliance', () => {
  const now = 1_000_000;
  const base = {
    machineId: 'm-1',
    status: 'online',
    lastHeartbeat: new Date(now - 1_000),
    version: 'v1',
    lanVerified: true,
    channel: 'stable' as const,
    rolloutPercent: 100,
    publishedVersion: 'v1',
    now,
  };

  it('ตรงเวอร์ชัน + heartbeat สด + ยืนยันแล้ว = ok', () => {
    const result = evaluateMachineCompliance(base);
    assert.equal(result.state, 'ok');
    assert.equal(result.updateAvailable, false);
  });

  it('heartbeat เก่า = offline แม้ status ใน DB ยัง online', () => {
    const result = evaluateMachineCompliance({
      ...base,
      lastHeartbeat: new Date(now - 120_000),
    });
    assert.equal(result.state, 'offline');
    assert.deepEqual(result.reasons, ['heartbeat_stale']);
  });

  it('ยังไม่ยืนยัน LAN = unverified', () => {
    const result = evaluateMachineCompliance({ ...base, lanVerified: false });
    assert.equal(result.state, 'unverified');
  });

  it('เวอร์ชันเก่าและอยู่ใน rollout = update', () => {
    const result = evaluateMachineCompliance({ ...base, version: 'v0', publishedVersion: 'v2' });
    assert.equal(result.state, 'update');
    assert.equal(result.updateAvailable, true);
    assert.equal(result.updateEligible, true);
  });

  it('เวอร์ชันเก่าแต่นอก rollout = held', () => {
    const result = evaluateMachineCompliance({
      ...base,
      version: 'v0',
      publishedVersion: 'v2',
      rolloutPercent: 0,
    });
    assert.equal(result.state, 'held');
    assert.equal(result.updateAvailable, true);
    assert.equal(result.updateEligible, false);
  });

  it('ไม่รู้เวอร์ชันแต่มี manifest = unknown-version', () => {
    const result = evaluateMachineCompliance({ ...base, version: null, publishedVersion: 'v2' });
    assert.equal(result.state, 'unknown-version');
    assert.deepEqual(result.reasons, ['version_unknown']);
  });

  it('disabled ชนะทุกอย่าง', () => {
    const result = evaluateMachineCompliance({ ...base, status: 'disabled', lanVerified: false });
    assert.equal(result.state, 'disabled');
  });
});

describe('fleet policy — machine overrides + store', () => {
  it('ตั้ง/ล้าง site/group/tags/notes ได้ และลบ override เมื่อว่าง', () => {
    const base = defaultFleetPolicy(new Date(0));
    const set = applyMachineOverride(
      base,
      'm-1',
      { channel: 'beta', site: 'HQ', group: 'Kitchen', tags: ['pos', 'pos'], notes: 'ชั้น 2' },
      'admin',
      new Date(2000),
    );
    assert.equal(set.override?.channel, 'beta');
    assert.equal(set.override?.site, 'HQ');
    assert.deepEqual(set.override?.tags, ['pos']);
    assert.equal(set.override?.updatedBy, 'admin');

    const clear = applyMachineOverride(
      set.policy,
      'm-1',
      { channel: null, site: null, group: null, tags: null, notes: null },
      'admin',
      new Date(3000),
    );
    assert.equal(clear.override, null);
    assert.equal(clear.policy.machines['m-1'], undefined);
  });

  it('ปฏิเสธ override ที่ผิดรูป', () => {
    assert.equal(validateMachineOverride({}).ok, false);
    assert.equal(validateMachineOverride({ channel: 'nightly' }).ok, false);
    assert.equal(validateMachineOverride({ tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }).ok, false);
    assert.equal(validateMachineOverride({ site: 'x'.repeat(65) }).ok, false);
    assert.equal(validateMachineOverride({ nope: 1 }).ok, false);
  });

  it('เขียน/อ่าน policy จากดิสก์ได้ และ client view ไม่มี override ทั้งก้อน', () => {
    const policy: FleetPolicy = defaultFleetPolicy(new Date(0));
    policy.machines['m-9'] = { channel: 'canary', site: 'Factory' };
    writeFleetPolicy(policy, root);
    const loaded = readFleetPolicy(root);
    assert.equal(loaded.machines['m-9']?.channel, 'canary');
    assert.equal(loaded.machines['m-9']?.site, 'Factory');
    assert.ok(fs.existsSync(fleetFile('policy.json', root)));

    const client = fleetPolicyForClient(loaded);
    assert.equal('machines' in client, false);
    assert.equal(client.machineOverrideCount, 1);
  });

  it('ไฟล์ policy เสีย = อ่านค่าเริ่มต้น ไม่ throw', () => {
    fs.writeFileSync(fleetFile('policy.json', root), '{ not json', 'utf8');
    const loaded = readFleetPolicy(root);
    assert.equal(loaded.defaultChannel, 'stable');
    assert.equal(loaded.channels.stable.rolloutPercent, 100);
  });
});
