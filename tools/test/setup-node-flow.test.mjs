#!/usr/bin/env node
/* ── ทดสอบตัวขับ setup-node ด้วยการจำลอง ────────────────────────────────
   เหตุผล: ตัวขับจริง pull Docker หลาย GB + เขียน .env + ลงทะเบียนกับ DB
   ถ้ารันจริงตอนพัฒนา = เสียเวลาและเสี่ยงทำของเจ้าของพัง
   ⇒ ทุกขั้นต้องทดสอบด้วย exec ปลอม แล้วพิสูจน์ว่า "ล้มตรงไหน หยุดตรงไหน"

   เทสต์นี้ล็อก:
     1) พื้นที่ไม่พอ = หยุดที่ขั้นแรก ไม่ไปติดตั้งอะไรต่อ (ไม่เผาเวลา/image)
     2) ขั้นไหนล้ม = หยุดที่นั่น ขั้นถัดไปไม่ทำงาน (ลำดับสำคัญ)
     3) ครบทุกอย่าง = exit 0 พร้อมรายงาน
     4) คำสั่งที่ยิงถูกต้อง (bat ผ่าน cmd.exe, enroll มี --enroll)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSetup, RUNTIME_FILES } from '../setup-node.mjs';

/**
 * สร้างชุดติดตั้งปลอมครบโครง (bat, infra/.env, runner)
 *
 * ⚠ สร้างไฟล์จาก RUNTIME_FILES เสมอ ห้ามพิมพ์พาธเอง
 *   เคสจริง 12/10/69: fixture เดิมเขียนพาธ 'sovereign-os/agent-runner/setup-machine.mjs'
 *   ซึ่งตรงกับโค้ดที่ผิดพาธพอดี → เทสต์ผ่านทั้งที่ของจริงจะพังตอนรันบนเครื่องใหม่
 *   (setup-machine.mjs อยู่ที่ tools/agent-pack ตลอดมา)
 */
function fakeKit({ withInfraEnv = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-kit-'));
  const stub = {
    [RUNTIME_FILES.setupFirstTime]: '@echo off\r\n',
    [RUNTIME_FILES.startSystem]: '@echo off\r\n',
    [RUNTIME_FILES.enrollScript]: '// mock\n',
    [RUNTIME_FILES.pruneWalPs1]: '# mock\n',
    [RUNTIME_FILES.pruneWalCmd]: 'echo x\r\n',
  };
  for (const [rel, body] of Object.entries(stub)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  fs.mkdirSync(path.join(dir, 'sovereign-os', 'infra'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sovereign-os', 'agent-runner'), { recursive: true });
  if (withInfraEnv) fs.writeFileSync(path.join(dir, 'sovereign-os', 'infra', '.env'), 'X=1\n');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** exec ปลอม: ตอบตามเงื่อนไขที่ตั้งไว้ พร้อมบันทึกทุกคำสั่งที่ถูกยิง */
function mockExec(overrides = {}) {
  const calls = [];
  const exec = async (bin, args = [], opts = {}) => {
    calls.push({ bin, args, opts });
    for (const [match, result] of Object.entries(overrides)) {
      const [mBin, ...mArgs] = match.split('|');
      if (bin === mBin && mArgs.every((a, i) => (args[i] ?? '') === a)) {
        return typeof result === 'function' ? result(args) : result;
      }
    }
    // ⚠ wsl --status ถูกเรียกโดย diagnoseDockerInstall ก่อนตรวจ Docker
    if (bin === 'powershell.exe' && args.some((a) => a.includes('wsl --status'))) {
      return { code: 0, stdout: 'WSL2: พร้อม', stderr: '' };
    }
    // Virtualization check
    if (bin === 'powershell.exe' && args.some((a) => a.includes('VirtualizationFirmwareEnabled'))) {
      return { code: 0, stdout: 'True\r\n', stderr: '' };
    }
    if (bin === 'docker' && args[0] === 'info') return { code: 0, stdout: 'Server Version: 27', stderr: '' };
    if (bin === 'node' || bin.endsWith('node.exe')) return { code: 0, stdout: 'ok', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

describe('dry-run — ต้องไม่แตะอะไรเลย', () => {
  // เคสจริง 11/10/69: --dry-run ถูกประกาศไว้แต่ไม่ได้ทำงาน
  //   ⇒ รันครั้งแรกไปเขียน .docker/daemon.json ของเครื่องจริงทันที
  //   อันตรายกว่าที่คิด เพราะคนจะเชื่อว่าปลอดภัยแล้วกดรันต่อ

  test('dry-run = ไม่ยิงคำสั่งที่เปลี่ยนระบบเลย', async () => {
    const kit = fakeKit();
    try {
      const { exec, calls } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40, dryRun: true });
      assert.equal(r.dryRun, true);
      assert.ok(!calls.some((c) => c.bin === 'cmd.exe'), 'dry-run ห้ามรัน .bat');
      assert.ok(!calls.some((c) => c.bin === 'schtasks'), 'dry-run ห้ามตั้ง scheduled task');
      assert.ok(!calls.some((c) => c.args.includes('--enroll')), 'dry-run ห้ามลงทะเบียนกับ HUB');
    } finally {
      kit.cleanup();
    }
  });

  test('dry-run = ไม่เขียนไฟล์ docker config', async () => {
    const kit = fakeKit();
    try {
      const { exec } = mockExec();
      const daemon = path.join(kit.dir, '.docker', 'daemon.json');
      await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40, dryRun: true });
      assert.ok(!fs.existsSync(daemon), 'dry-run ห้ามสร้าง daemon.json');
    } finally {
      kit.cleanup();
    }
  });

  test('dry-run = ยังตรวจพื้นที่/เครื่องมือได้ตามปกติ (ต้องเห็นภาพรวม)', async () => {
    const kit = fakeKit();
    try {
      const { exec } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40, dryRun: true });
      const names = r.steps.map((s) => s.name);
      assert.ok(names.includes('พื้นที่ว่าง'));
      assert.ok(names.includes('เครื่องมือ'));
      // และต้องบอกว่าจะทำอะไรต่อ ไม่ใช่จบเงียบๆ
      assert.ok(r.steps.some((s) => s.detail.includes('dry-run')), 'ต้องบอกว่าจะทำอะไร');
    } finally {
      kit.cleanup();
    }
  });

  test('dry-run = พื้นที่ไม่พอก็ต้องบอก (ไม่ใช่ผ่านเพราะไม่ได้ลงมือ)', async () => {
    const kit = fakeKit();
    try {
      const { exec } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 3, dryRun: true });
      assert.equal(r.ok, false, 'พื้นที่ไม่พอ = ล้ม แม้จะเป็น dry-run — ผู้ใช้ต้องเห็นปัญหาก่อนไปกดจริง');
      assert.ok(r.steps.some((s) => s.status === 'fail'));
    } finally {
      kit.cleanup();
    }
  });
});

describe('runSetup — ลำดับขั้นตอน', () => {
  test('พื้นที่ไม่พอ = หยุดทันที ไม่ไปติดตั้งอะไรต่อเลย', async () => {
    const kit = fakeKit();
    try {
      const { exec, calls } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 5 });
      assert.equal(r.ok, false);
      assert.equal(r.steps.length, 1, 'ต้องหยุดที่ขั้นเดียว');
      assert.equal(r.steps[0].name, 'พื้นที่ว่าง');
      assert.equal(calls.length, 0, 'ต้องไม่ยิงคำสั่งใดๆ เลย (ไม่เผาเวลา/ไม่ pull image)');
    } finally {
      kit.cleanup();
    }
  });

  test('ครบทุกอย่าง = exit 0 และไล่ขั้นครบ', async () => {
    const kit = fakeKit();
    try {
      const { exec, calls } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40, hubUrl: 'http://h:3000', code: 'ABC', name: 'เครื่องทดสอบ' });
      assert.equal(r.ok, true, JSON.stringify(r.steps));
      assert.equal(r.exitCode, 0);
      const names = r.steps.map((s) => s.name);
      for (const want of ['พื้นที่ว่าง', 'เครื่องมือ', 'จำกัดขนาด log', 'Docker', 'ตั้งค่าครั้งแรก', 'เริ่มระบบ', 'ลงทะเบียน HUB', 'กันดิสก์เต็ม']) {
        assert.ok(names.includes(want), `ขั้น "${want}" ไม่ถูกทำ — ได้ ${names.join(' / ')}`);
      }
      // .bat ต้องผ่าน cmd.exe (Windows ไม่รัน .bat โดยตรง)
      assert.ok(calls.some((c) => c.bin === 'cmd.exe' && c.args[0] === '/c'), 'ต้องรัน .bat ผ่าน cmd.exe');
      // enroll ต้องมี --enroll
      const enroll = calls.find((c) => c.args.includes('--enroll'));
      assert.ok(enroll, 'ต้องเรียก setup-machine.mjs ด้วย --enroll');
      assert.ok(enroll.args.some((a) => a.startsWith('--hub-url=')), 'ต้องส่ง hub-url ไปด้วย');
    } finally {
      kit.cleanup();
    }
  });

  test('Docker ไม่ตอบ = หยุดก่อนยิง .bat ใดๆ (จับได้ตั้งแต่ขั้นตรวจเครื่องมือ)', async () => {
    const kit = fakeKit();
    try {
      const { exec, calls } = mockExec({ 'docker|info': { code: 1, stdout: '', stderr: 'no' } });
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40 });
      assert.equal(r.ok, false);
      // ขั้นตรวจเครื่องมือยิง `docker info` เป็นตัวแรก → จับได้ก่อนถึงขั้น 'Docker'
      // (ไม่มีขั้นย่อย 'Docker' แยก — เป็นตัวเดียวกัน ดูจุดที่ 4 ใน setup-node.mjs)
      assert.ok(
        r.steps.some((s) => /Docker/.test(s.name) || /docker/i.test(s.detail)),
        `ต้องบอกว่า Docker ใช้ไม่ได้ — ได้ ${JSON.stringify(r.steps)}`,
      );
      assert.ok(!calls.some((c) => c.bin === 'cmd.exe'), 'ไม่ควรยิง .bat เลย');
    } finally {
      kit.cleanup();
    }
  });

  test('เริ่มระบบล้ม = หยุด ไม่ไปลงทะเบียน HUB (ไม่ให้เครื่อง ghost)', async () => {
    // มี .env แล้ว = ข้ามขั้นตั้งค่าครั้งแรก → cmd.exe ที่ถูกยิงคือ start-sovereign
    const kit = fakeKit({ withInfraEnv: true });
    try {
      const { exec, calls } = mockExec({
        'cmd.exe|/c': { code: 3, stdout: 'db ล้ม', stderr: '' },
      });
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40 });
      assert.equal(r.ok, false);
      const names = r.steps.map((s) => s.name);
      assert.ok(names.includes('เริ่มระบบ'), `ต้องล้มที่ขั้นเริ่มระบบ — ได้ ${names.join(' / ')}`);
      assert.ok(!names.includes('ลงทะเบียน HUB'), 'ระบบไม่ขึ้น = ห้ามลงทะเบียน ไม่งั้น HUB มีเครื่อง ghost');
      assert.ok(!calls.some((c) => c.args.includes('--enroll')));
    } finally {
      kit.cleanup();
    }
  });

  test('มี infra/.env แล้ว = ไม่ทับ (ขั้นตั้งค่าครั้งแรกข้าม)', async () => {
    const kit = fakeKit({ withInfraEnv: true });
    try {
      const { exec, calls } = mockExec();
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40 });
      const s = r.steps.find((x) => x.name === 'ตั้งค่าครั้งแรก');
      assert.equal(s.status, 'ok');
      assert.match(s.detail, /ไม่ทับ/);
      assert.ok(!calls.some((c) => c.args.some((a) => a.includes('setup-first-time'))), 'ไม่ควรรัน setup-first-time ซ้ำ');
    } finally {
      kit.cleanup();
    }
  });

  test('ตั้งงานกันดิสก์ล้ม = เตือน แต่ไม่ทำให้ทั้งการติดตั้งล้ม (ตัวหลักคือระบบที่ขึ้นแล้ว)', async () => {
    const kit = fakeKit();
    try {
      const { exec } = mockExec({ 'schtasks|/Create': { code: 1, stdout: '', stderr: 'ต้องใช้สิทธิ์' } });
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40 });
      assert.equal(r.ok, true, 'ติดตั้งหลักสำเร็จ = ผ่าน');
      const s = r.steps.find((x) => x.name === 'กันดิสก์เต็ม');
      assert.equal(s.status, 'warn');
      assert.match(s.detail, /สิทธิ์/);
    } finally {
      kit.cleanup();
    }
  });

  test('เครื่องมือขาดและติดตั้งไม่ได้ = หยุดก่อนไปแตะ Docker', async () => {
    const kit = fakeKit();
    try {
      const { exec } = mockExec({
        'node|--version': { code: 1, stdout: '', stderr: '' },   // ไม่มี Node
        'docker|info': { code: 1, stdout: '', stderr: '' },     // ไม่มี Docker
        'where|winget': { code: 1, stdout: '', stderr: '' },    // ติดตั้งเองไม่ได้
      });
      const r = await runSetup({ exec, log: () => {}, kitDir: kit.dir, homedir: kit.dir, freeGb: 40 });
      assert.equal(r.ok, false);
      assert.ok(r.steps.some((s) => s.name === 'เครื่องมือ' && s.status === 'fail'), `ควรล้มที่ขั้นเครื่องมือ — ได้ ${JSON.stringify(r.steps)}`);
      assert.ok(!r.steps.some((s) => s.name === 'เริ่มระบบ'), 'ไม่มีเครื่องมือ = ห้ามไปเริ่มระบบ');
    } finally {
      kit.cleanup();
    }
  });
});