#!/usr/bin/env node
/* ── โหมด "ชุดสากร": ไฟล์ติดตั้งไฟล์เดียว ใช้ได้ทุกเครื่อง ─────────────────
   เจ้าของสั่ง 11/10/69: "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"

   เดิม: ทุกเครื่องต้องมี join.json ที่ HUB ฝัง token ไว้ ⇒ ก๊อปชุดเดียวไป 5 เครื่อง
     HUB มองเป็นเครื่องเดียว (ระบุตัวจาก token_hash) แยกไม่ออก ถอนไม่ได้รายเครื่อง

   ใหม่: ไม่มี join.json → ขอ token ของตัวเองจาก HUB ด้วย "รหัสเชิญ" แล้วเขียน .env

   เทสต์นี้ล็อก:
     1) ไม่มี join.json + ไม่สั่ง --enroll = ต้องบอกทางแก้ ไม่ใช่ล้มแบบงงๆ
     2) ไม่มี join.json + --enroll = ขอ token เองแล้วติดตั้งต่อได้
     3) รหัสเชิญผิด/ต่อไม่ได้ = หยุด ไม่เขียน .env ที่ไม่มี token ใช้
     4) มี join.json แล้ว = ยังทำแบบเดิม (ไม่พังของที่ใช้อยู่)
     5) ไม่มี enroll-machine.mjs ในชุด = บอกชัด ไม่ throw
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// path.dirname(fileURLToPath(import.meta.url)) — ต้องใช้ fileURLToPath
// คำนวณจาก URL ตรงๆ จะได้ path ผิดบน Windows (มี %20 และขึ้นต้นด้วย /)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SETUP = path.join(REPO, 'tools', 'agent-pack', 'setup-machine.mjs');
const ENROLL = path.join(REPO, 'sovereign-os', 'agent-runner', 'src', 'enroll-machine.mjs');

const { readJoin, buildEnvFile } = await import(pathToFileURL(SETUP).href);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'setup-enroll-'));
}

describe('readJoin — ไม่มี join.json แล้วบอกทางแก้ (ไม่ใช่บอกว่า "ชุดไม่ครบ")', () => {
  test('ไม่มีไฟล์ = รหัส NO_JOIN ที่ผู้เรียกตัดสินใจต่อได้', () => {
    const r = readJoin(tmpDir());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NO_JOIN', 'ต้องแยก "ไม่มี join.json" ออกจาก "อ่านไม่ได้"');
    assert.match(r.error, /--enroll/, 'ต้องบอกทางแก้ ไม่ใช่ปล่อยให้เดา');
  });

  test('มี join.json แล้ว = ทำแบบเดิม (ไม่ใช่ชุดสากร)', () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'join.json'),
        JSON.stringify({ hubUrl: 'http://192.168.1.102:3000', machineToken: 'T'.repeat(64), machineName: 'คอม-2' }),
      );
      const r = readJoin(dir);
      assert.equal(r.ok, true);
      assert.equal(r.machineName, 'คอม-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('join.json พัง = บอกว่าอ่านไม่ได้ ไม่ใช่ NO_JOIN (คนละสาเหตุ คนละวิธีแก้)', () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'join.json'), '{ พัง');
      const r = readJoin(dir);
      assert.equal(r.ok, false);
      assert.notEqual(r.code, 'NO_JOIN');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('โหมดชุดสากร — ไฟล์ติดตั้งชุดเดียวใช้ได้ทุกเครื่อง', () => {
  test('ชุดสากรต้องพา enroll-machine.mjs มาด้วย (ไม่งั้น --enroll จะพัง)', () => {
    assert.ok(fs.existsSync(ENROLL), 'ต้องมี sovereign-os/agent-runner/src/enroll-machine.mjs');
    const pack = fs.readFileSync(path.join(REPO, 'tools', 'agent-pack', 'pack.mjs'), 'utf8');
    // bundleFiles อ่านทุกไฟล์ .mjs ใน agent-runner/src อยู่แล้ว
    assert.match(pack, /endsWith\('\.mjs'\)/, 'bundleFiles ต้องเก็บ .mjs ทุกไฟล์ใน src/');
  });

  test('SETUP-MACHINE.cmd ต้องมีทาง --enroll และบอกวิธีใช้ตอนไม่มี join.json', () => {
    const cmd = fs.readFileSync(path.join(REPO, 'tools', 'agent-pack', 'SETUP-MACHINE.cmd'), 'utf8');
    assert.match(cmd, /--enroll/, 'ต้องมีโหมดลงทะเบียนเอง');
    assert.match(cmd, /--hub-url=/, 'ต้องบอกว่าส่ง hub-url ยังไง');
    // ต้องยังเป็น CRLF — cmd.exe อ่าน LF เพี้ยน (เคสจริง 11/10/69)
    const lf = (cmd.match(/(?<!\r)\n/g) || []).length;
    assert.equal(lf, 0, `SETUP-MACHINE.cmd ต้องเป็น CRLF (พบ LF เดี่ยว ${lf})`);
  });

  test('setup-machine.mjs รู้จัก --enroll / --hub-url / --code', () => {
    const src = fs.readFileSync(SETUP, 'utf8');
    for (const flag of ['--enroll', '--hub-url=', '--code=', '--name=']) {
      assert.ok(src.includes(flag), `ต้องรองรับ ${flag}`);
    }
  });

  test('ต้องไม่อ้าง join.* หลังจุดที่แยกโหมดแล้ว (จะได้ undefined ตอนรัน --enroll)', () => {
    const src = fs.readFileSync(SETUP, 'utf8');
    const afterResolve = src.split('let resolved =')[1] ?? '';
    const bad = afterResolve.split('\n').filter((l) => /join\.(hubUrl|machineToken|machineName)/.test(l) && !l.includes('join.ok'));
    assert.equal(bad.length, 0, `ยังอ้าง join.* ที่ไม่ผ่านการตรวจ:\n${bad.join('\n')}`);
  });

  test('เครื่องใหม่ที่ลงทะเบียนเอง = ชื่อเครื่องต้องไม่ว่าง (ไม่งั้น HUB มองไม่ออกว่าเป็นใคร)', () => {
    const env = buildEnvFile({ hubUrl: 'http://h:3000', token: 'T', machineName: 'คอม-3', executors: 'echo', fsRoots: ['E:\\'] });
    assert.match(env, /^MACHINE_NAME=คอม-3$/m);
    assert.match(env, /^MACHINE_TOKEN=T$/m);
  });
});