#!/usr/bin/env node
// ── Fleet wiring guards (CE) ─────────────────────────────────────────────────
// กันของที่พังเงียบ ๆ ในฝั่งที่ CE ยังเก็บไว้ (หน้าเครื่อง / rollout gate):
//   • ด่าน rollout ถูกถอดออกจาก manifest/asset (เครื่องที่ถูกกักยังดึงโค้ดได้)
//   • GET /api/agent-machines กลับไป spread row ทั้งก้อน (token_hash รั่ว)
//   • เทสต์ policy/enrollment ที่ commit ไว้หายไป
//
// หมายเหตุ: หน้า /fleet + /api/fleet และ fleet-scope.service เป็นของ Pro
// (ย้ายไป private repo แล้ว) — เทสต์ส่วนนั้นจึงไม่อยู่ใน CE
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const AGENT = 'sovereign-os/core-api/src/modules/agent-machines/agent-machines.routes.ts';

describe('Fleet wiring — CE', () => {
  test('ด่าน rollout ถูกใช้ทั้ง manifest และ asset (runner + desktop)', () => {
    const agent = read(AGENT);
    const calls = agent.split('gateFleetUpdate(machine, res)').length - 1;
    // update/manifest · update/file · desktop-update/manifest · desktop-update/asset
    assert.ok(calls >= 4, `ต้องเรียก gateFleetUpdate อย่างน้อย 4 จุด (พบ ${calls})`);
    assert.ok(agent.includes("reason === 'rollout_hold'"), 'ต้องแยกเหตุผล rollout_hold');
    assert.ok(agent.includes("reason === 'machine_disabled'"), 'ต้องแยกเหตุผล machine_disabled');
  });

  test('GET /api/agent-machines ไม่ spread row ทั้งก้อน (กัน token_hash รั่ว)', () => {
    const agent = read(AGENT);
    assert.ok(agent.includes('function publicMachine'), 'ต้องมี publicMachine helper');
    assert.ok(!agent.includes('return { ...m, ip:'), 'ห้าม spread row เดิม');
    assert.ok(agent.includes('...publicMachine(m)'), 'ต้องใช้ publicMachine');
  });

  test('มีเทสต์ policy/enrollment ที่ commit ไว้', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'sovereign-os/core-api/tests/fleetPolicy.test.ts')));
    assert.ok(fs.existsSync(path.join(ROOT, 'sovereign-os/core-api/tests/fleetEnrollment.test.ts')));
  });
});
