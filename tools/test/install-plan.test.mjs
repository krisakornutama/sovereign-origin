#!/usr/bin/env node
/* ── install-plan.json: "เครื่องนี้ติดตั้งอะไร และเป็นลูกของใคร" ──────────────────
   ตัวแพ็กเขียนไว้ในชุดติดตั้ง · ตัวติดตั้งฝั่งเครื่องลูกอ่านไปใช้และโชว์ให้เห็น

   กติกาที่ล็อกด้วยเทสต์:
   1) ไฟล์นี้ **ห้ามมี token** (join.json เป็นที่เดียวที่เก็บ token)
   2) อ่านไม่ได้/เสียรูป = บอกชัด (ไม่ใช่ถือว่า "ไม่มีแผน" แล้วติดตั้งมั่ว)
   3) เขียนทับค่าใน .env แบบแก้เฉพาะบรรทัดที่เกี่ยวข้อง — ค่าอื่นของผู้ใช้ต้องอยู่ครบ
      และรันซ้ำต้องได้ผลเท่าเดิม (idempotent)
   4) ไม่มีฟังก์ชั่นที่ต้องเปิดประตู backend = ต้องไม่เขียน ENABLED_MODULES="" ทับของเดิม
      (ค่าว่างจะปิดทุกโมดูลเงียบ ๆ)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FALLBACK_OWNER_LABEL,
  applyPlanToEnvText,
  buildInstallPlan,
  envLinesForPlan,
  readInstallPlan,
  renderMachineProfile,
  stackEnvRel,
} from '../agent-pack/install-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(ROOT, '.freebuff', 'tmp', 'install-plan');

function sandbox(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const basePlan = () =>
  buildInstallPlan({
    machineName: 'เครื่องที่-4',
    hubUrl: 'http://192.168.1.101:3000',
    parent: { id: 'u-1', username: 'krisakorn' },
    modules: ['core', 'iot', 'kids', 'farm'],
    createdAt: '2026-10-25T00:00:00.000Z',
  });

describe('buildInstallPlan', () => {
  test('มีชื่อเครื่อง/HUB/เจ้าของ/ฟังก์ชั่น ครบ', () => {
    const p = basePlan();
    assert.equal(p.machineName, 'เครื่องที่-4');
    assert.equal(p.hubUrl, 'http://192.168.1.101:3000');
    assert.equal(p.parent.username, 'krisakorn');
    assert.deepEqual(p.modules, ['core', 'iot', 'kids', 'farm']);
    assert.equal(p.createdAt, '2026-10-25T00:00:00.000Z');
  });

  test('แปลงเป็นชื่อ ENABLED_MODULES ให้แล้ว (backend ใช้ค่านี้จริง)', () => {
    assert.deepEqual(basePlan().enabledModules, ['farm']);
  });

  test('ไม่มี token หลุดลงไฟล์ — แม้ผู้เรียกจะส่งมา', () => {
    const p = buildInstallPlan({
      machineName: 'm',
      hubUrl: 'http://h:3000',
      modules: ['core'],
      machineToken: 'secret-token-should-not-appear',
      token: 'another-secret',
    });
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, /secret/i);
    assert.doesNotMatch(text, /token/i);
  });

  test('ไม่มีเจ้าของ = parent null + ข้อความสำรอง (ไม่ทำให้ไฟล์เสีย)', () => {
    const p = buildInstallPlan({ machineName: 'm', hubUrl: 'http://h:3000', modules: ['core'] });
    assert.equal(p.parent, null);
    const profile = renderMachineProfile(p);
    assert.match(profile, new RegExp(FALLBACK_OWNER_LABEL));
  });
});

describe('readInstallPlan: อ่านจากโฟลเดอร์ชุดติดตั้ง', () => {
  test('ไม่มีไฟล์ = no_plan (ชุดเก่าที่ยังไม่รู้จักโมดูล)', () => {
    const dir = sandbox('none');
    const r = readInstallPlan(dir);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no_plan');
  });

  test('JSON เสีย = bad_plan พร้อมบอกไฟล์', () => {
    const dir = sandbox('broken');
    fs.writeFileSync(path.join(dir, 'install-plan.json'), '{ not json', 'utf8');
    const r = readInstallPlan(dir);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad_plan');
    assert.match(r.error, /install-plan\.json/);
  });

  test('ขาดชื่อเครื่อง = bad_plan (ไม่ใช่ติดตั้งด้วยชื่อว่าง)', () => {
    const dir = sandbox('noname');
    fs.writeFileSync(path.join(dir, 'install-plan.json'), JSON.stringify({ hubUrl: 'http://h:3000' }), 'utf8');
    const r = readInstallPlan(dir);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad_plan');
  });

  test('ไฟล์ที่ build เองอ่านกลับได้ครบ', () => {
    const dir = sandbox('roundtrip');
    fs.writeFileSync(path.join(dir, 'install-plan.json'), JSON.stringify(basePlan()), 'utf8');
    const r = readInstallPlan(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.plan.modules, ['core', 'iot', 'kids', 'farm']);
    assert.equal(r.plan.parent.username, 'krisakorn');
  });

  // ของจริงบน Windows: Notepad/Notepad++ บางรุ่น และ PowerShell 5.1 `Set-Content -Encoding UTF8`
  // เติม BOM หน้าไฟล์ ⇒ JSON.parse ล้มด้วย "Unexpected token ''" ทั้งที่คนเปิดดูเห็นว่าถูกต้อง
  // (โปรเจ็กเคยเจอ BOM พัง migration มาแล้ว — อย่าให้ซ้ำที่ไฟล์แผน)
  test('ไฟล์ที่มี BOM (Notepad/PowerShell 5.1 เขียน) ต้องอ่านได้', () => {
    const dir = sandbox('bom');
    fs.writeFileSync(path.join(dir, 'install-plan.json'), '\uFEFF' + JSON.stringify(basePlan(), null, 2), 'utf8');
    const r = readInstallPlan(dir);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.deepEqual(r.plan.modules, ['core', 'iot', 'kids', 'farm']);
  });
});

describe('envLinesForPlan + applyPlanToEnvText', () => {
  test('มี ENABLED_MODULES + PARENT_NAME + PARENT_HUB_URL', () => {
    const lines = envLinesForPlan(basePlan());
    assert.ok(lines.includes('ENABLED_MODULES=farm'));
    assert.ok(lines.includes('PARENT_NAME=krisakorn'));
    assert.ok(lines.includes('PARENT_HUB_URL=http://192.168.1.101:3000'));
  });

  test('ไม่มีฟังก์ชั่นที่เปิดประตู backend = ไม่มีบรรทัด ENABLED_MODULES เลย', () => {
    const p = buildInstallPlan({ machineName: 'm', hubUrl: 'http://h:3000', modules: ['core', 'iot'] });
    const lines = envLinesForPlan(p);
    assert.ok(!lines.some((l) => l.startsWith('ENABLED_MODULES=')), 'ค่าว่างจะปิดทุกโมดูลเงียบ ๆ');
  });

  test('เขียนทับเฉพาะบรรทัดที่เกี่ยวข้อง — ค่าอื่นอยู่ครบ', () => {
    const before = ['DATABASE_URL=postgres://x', 'ENABLED_MODULES=inventory', 'JWT_SECRET=abc', ''].join('\n');
    const after = applyPlanToEnvText(before, ['ENABLED_MODULES=farm', 'PARENT_NAME=krisakorn']);
    assert.match(after, /^DATABASE_URL=postgres:\/\/x$/m);
    assert.match(after, /^JWT_SECRET=abc$/m);
    assert.match(after, /^ENABLED_MODULES=farm$/m);
    assert.match(after, /^PARENT_NAME=krisakorn$/m);
    assert.doesNotMatch(after, /ENABLED_MODULES=inventory/);
    assert.equal(after.match(/ENABLED_MODULES=/g).length, 1, 'ต้องเหลือบรรทัดเดียว');
  });

  test('ยังไม่มีคีย์ = ต่อท้ายให้ (ไม่เขียนทับไฟล์ทั้งไฟล์)', () => {
    const before = 'A=1\nB=2';
    const after = applyPlanToEnvText(before, ['PARENT_NAME=krisakorn']);
    assert.match(after, /^A=1$/m);
    assert.match(after, /^B=2$/m);
    assert.match(after, /^PARENT_NAME=krisakorn$/m);
  });

  test('รันซ้ำ = ผลเท่าเดิม (idempotent)', () => {
    const lines = envLinesForPlan(basePlan());
    const once = applyPlanToEnvText('A=1\n', lines);
    const twice = applyPlanToEnvText(once, lines);
    assert.equal(twice, once);
  });

  test('ไฟล์ว่าง/null = สร้างเนื้อหาใหม่ได้', () => {
    const after = applyPlanToEnvText('', ['PARENT_NAME=x']);
    assert.equal(after.trim(), 'PARENT_NAME=x');
  });

  test('stackEnvRel ชี้ไปที่ infra/.env ของ stack (ไม่ใช่ .env ของ runner)', () => {
    assert.equal(stackEnvRel().replace(/\\/g, '/'), 'sovereign-os/infra/.env');
  });
});

describe('renderMachineProfile: ข้อความ "เครื่องนี้เป็นลูกของใคร"', () => {
  test('บอกเจ้าของ + HUB + ฟังก์ชั่นที่ติดตั้ง', () => {
    const t = renderMachineProfile(basePlan());
    assert.match(t, /krisakorn/);
    assert.match(t, /192\.168\.1\.101:3000/);
    assert.match(t, /IoT/);
    assert.match(t, /เลี้ยงดูลูก/);
    assert.match(t, /เครื่องที่-4/);
  });

  test('ไม่มี token ในข้อความที่โชว์', () => {
    const t = renderMachineProfile(basePlan());
    assert.doesNotMatch(t, /token/i);
  });
});
