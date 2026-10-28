#!/usr/bin/env node
// tools/test/d5-installer.test.mjs
// ── D5 "ชุดติดตั้งใหม่ — ไฟล์เดียว กดเดียว" ─────────────────────────────────────
// ทำไมต้องมี: 28/10/69 เครื่องลูกจริงกดติดตั้งทุกปุ่มแล้ว HUB ไม่เห็นสัญญาณเลย เพราะ
//   (1) pack ฝัง HUB_URL เป็น LAN IP ที่ยิงไม่ถึงโดยไม่ตรวจสายก่อน และ
//   (2) doctor รอบปกติ "ไม่ส่งสัญญาณ" แต่ไม่เคยบอกผู้ใช้ว่า "รอบนี้ HUB จะไม่รู้อะไรเลย"
// กติกาที่ล็อกไว้ (ห้ามพัง):
//   · dry-run ของ pack ห้ามแตะเน็ต (เทสต์ด้วย fetchImpl ที่ throw ถ้าถูกเรียก)
//   · pack ที่ HUB ยิงไม่ถึง = ห้ามเขียนชุดติดตั้ง (exit 1) — กันออกชุดพังเงียบ ๆ
//   · ข้อความทั้งหมดห้ามมี token (อ่านกติกาเดิมของ doctor.test.mjs)
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');
const doctor = await import('../agent-pack/doctor.mjs');
const pack = await import('../agent-pack/pack.mjs');

const made = [];
function tmpDir(name) {
  const dir = path.join(TMP_ROOT, `d5-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  made.push(dir);
  return dir;
}
after(() => {
  for (const d of made) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ }
  }
});

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);

// ── doctor harness (ตามรูปแบบ doctor.test.mjs) ────────────────────────────────
const okFetch = (calls) => async (url, init) => {
  calls?.push({ url, init });
  return { status: 200, ok: true };
};
const okExec = async () => ({ code: 0, stdout: 'Docker version 27.0.0, build abc', stderr: '' });
const bigDisk = () => ({ bsize: 4096, blocks: 100, bfree: (50 * 1024 ** 3) / 4096, bavail: (50 * 1024 ** 3) / 4096 });

function readyBundle({ join = true } = {}) {
  const dir = tmpDir('bundle');
  fs.writeFileSync(path.join(dir, 'setup-machine.mjs'), '// fake\n');
  if (join) {
    fs.writeFileSync(
      path.join(dir, 'join.json'),
      JSON.stringify({ hubUrl: 'http://192.168.1.50:3000', machineToken: TOKEN, machineName: 'PC-ทดสอบ' }),
    );
  }
  return dir;
}
const base = (over = {}) => ({
  fetchImpl: okFetch(),
  exec: okExec,
  platform: 'win32',
  arch: 'x64',
  hostname: 'PC-ทดสอบ',
  nodeVersion: '24.15.0',
  statfsSync: bigDisk,
  writeReport: false,
  env: {},
  ...over,
});

// ── pack harness (ตามรูปแบบ agent-pack.test.mjs) ─────────────────────────────
const okHubFetch = async () => ({ status: 200, ok: true });
const neverFetch = async () => { throw new Error('ต้องไม่แตะเน็ตในโหมดนี้'); };
function fakeIssuer(dir, payload) {
  const file = path.join(dir, 'issue-fake.mjs');
  fs.writeFileSync(file, `process.stdout.write(JSON.stringify(${JSON.stringify(payload)}) + '\\n');\n`, 'utf8');
  return file;
}
function packBase(dir, over = {}) {
  return {
    root: ROOT,
    outDir: path.join(dir, 'bundle'),
    name: 'คอมเครื่องที่ 2',
    hubUrl: 'http://192.168.1.102:3000',
    fetchImpl: okHubFetch,
    updateDataDir: path.join(dir, 'agent-updates'),
    ...over,
  };
}

describe('D5: doctor ต้องบอกให้ชัดว่า "รอบนี้ส่งสัญญาณถึง HUB หรือไม่"', () => {
  test('รอบปกติ (อ่านอย่างเดียว) ต้องพิมพ์ว่าไม่ได้ส่งสัญญาณ + บอกทางออก --post', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.match(r.report, /ไม่ได้ส่งสัญญาณถึง HUB/, 'ต้องเตือนชัดว่า HUB ไม่รู้อะไรจากรอบนี้');
    assert.match(r.report, /--post/, 'ต้องบอกคำสั่งพิสูจน์การเชื่อมต่อ');
  });

  test('รอบที่ส่งสัญญาณสำเร็จ (--post) ห้ามขึ้นข้อความ "ไม่ได้ส่งสัญญาณ" ซ้ำอีก', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ postInstall: true }) });
    assert.doesNotMatch(r.report, /ไม่ได้ส่งสัญญาณถึง HUB/);
  });

  test('profile เครื่องแม่ (hub) ไม่ต้องมีข้อความสัญญาณเครื่องลูก', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ profile: 'hub', root: dir, composeFile: path.join(dir, 'docker-compose.yml'), templateFile: path.join(dir, 't.env') }) });
    assert.doesNotMatch(r.report, /ไม่ได้ส่งสัญญาณถึง HUB/);
  });
});

describe('D5: pack ต้องตรวจสายถึง HUB ก่อนฝัง URL ลงชุดติดตั้ง', () => {
  test('HUB ยิงไม่ถึง → หยุดแพ็ก exit 1 + ไม่เขียน join.json + บอกวิธีแก้ --hub-url', async () => {
    const dir = tmpDir('pack-unreachable');
    const out = await pack.runPack(packBase(dir, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }));
    assert.equal(out.exitCode, 1, `ต้องล้มเมื่อยิงไม่ถึง HUB: ${out.report}`);
    assert.equal(out.code, 'hub_unreachable', `code ต้องชี้สาเหตุ: got ${out.code}`);
    assert.match(out.report, /--hub-url/, 'ต้องบอกวิธีแก้ (ระบุ --hub-url ที่ยิงถึงจริง)');
    assert.equal(fs.existsSync(path.join(dir, 'bundle', 'join.json')), false, 'ห้ามเขียนชุดเมื่อสายไม่ผ่าน');
  });

  test('HUB ตอบ 403 (เช่น WAF บล็อก) → ล้มเช่นกัน + โชว์สถานะที่ตอบกลับ', async () => {
    const dir = tmpDir('pack-403');
    const out = await pack.runPack(packBase(dir, { fetchImpl: async () => ({ status: 403, ok: false }) }));
    assert.equal(out.exitCode, 1, out.report);
    assert.match(out.report, /403/, 'ต้องโชว์สถานะจริงที่ HUB ตอบกลับ');
  });

  test('HUB_URL เป็น IP LAN ส่วนตัว → แพ็กได้แต่ต้องเตือนเรื่อง DHCP ทั้งในรายงานและ START-HERE', async () => {
    const dir = tmpDir('pack-lan');
    const issue = fakeIssuer(dir, { id: 'm-1', name: 'คอมเครื่องที่ 2', token: 'tok-issued-1' });
    const out = await pack.runPack(packBase(dir, { dryRun: false, issueCommand: { cmd: process.execPath, args: [issue] } }));
    assert.equal(out.exitCode, 0, out.report);
    assert.match(out.report, /DHCP|IP เปลี่ยน/, 'รายงานต้องเตือนว่า LAN IP เปลี่ยนได้');
    const startHere = fs.readFileSync(path.join(dir, 'bundle', 'START-HERE.txt'), 'utf8');
    assert.match(startHere, /DHCP|IP เปลี่ยน/, 'START-HERE ต้องเตือนเรื่อง LAN IP เปลี่ยนได้');
  });

  test('HUB_URL เป็นโดเมนสาธารณะ (ไม่ใช่ IP ส่วนตัว) → ไม่ต้องเตือน DHCP', async () => {
    const dir = tmpDir('pack-domain');
    const issue = fakeIssuer(dir, { id: 'm-2', name: 'คอมเครื่องที่ 2', token: 'tok-issued-2' });
    const out = await pack.runPack(
      packBase(dir, {
        dryRun: false,
        hubUrl: 'https://hub.example.com',
        issueCommand: { cmd: process.execPath, args: [issue] },
      }),
    );
    assert.equal(out.exitCode, 0, out.report);
    assert.doesNotMatch(out.report, /DHCP/);
    const startHere = fs.readFileSync(path.join(dir, 'bundle', 'START-HERE.txt'), 'utf8');
    assert.doesNotMatch(startHere, /DHCP/);
  });

  test('dry-run ห้ามแตะเน็ต (fetchImpl ที่ throw ต้องไม่ถูกเรียก)', async () => {
    const dir = tmpDir('pack-dry');
    const out = await pack.runPack(packBase(dir, { dryRun: true, fetchImpl: neverFetch }));
    assert.equal(out.exitCode, 0, out.report);
    assert.match(out.report, /dry-run/);
  });

  test('START-HERE ต้องเล่าเรื่องเดียว: ดับเบิลคลิก INSTALL.cmd + ถ้าไม่เห็นออนไลน์ให้ --post แล้วส่ง SUPPORT.txt', async () => {
    const dir = tmpDir('pack-starthere');
    const issue = fakeIssuer(dir, { id: 'm-3', name: 'คอมเครื่องที่ 2', token: 'tok-issued-3' });
    const out = await pack.runPack(packBase(dir, { dryRun: false, issueCommand: { cmd: process.execPath, args: [issue] } }));
    assert.equal(out.exitCode, 0, out.report);
    const startHere = fs.readFileSync(path.join(dir, 'bundle', 'START-HERE.txt'), 'utf8');
    assert.match(startHere, /INSTALL\.cmd/, 'ต้องชี้ปุ่มเดียว');
    assert.match(startHere, /SUPPORT\.txt/, 'ต้องบอกไฟล์ที่จะส่งกลับเมื่อมีปัญหา');
    assert.match(startHere, /--post/, 'ต้องบอกคำสั่งพิสูจน์การเชื่อมต่อ');
  });
});
