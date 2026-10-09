// test/selfUpdate.test.mjs — เทสต์ "เครื่องลูกอัปเดตโค้ดเองจาก HUB"
//
// ของที่ต้องจับให้ได้ (แต่ละข้อเคยเป็นกับดักจริง):
//   1) เวอร์ชันต้องคำนวณเหมือนกันทั้งสองฝั่ง ⇒ ห้ามขึ้นกับลำดับไฟล์/เวลาที่เขียน
//   2) ไฟล์ที่โหลดมาแล้ว hash ไม่ตรง = ห้ามเขียนทับของเดิมแม้ไฟล์เดียว (เครื่องต้องไม่พังครึ่งทาง)
//   3) ชื่อไฟล์จาก HUB เป็นข้อมูลจากภายนอก ⇒ path traversal (`../../x`) ต้องถูกปฏิเสธ
//   4) อัปเดตแล้วรันไม่ขึ้น = ต้องย้อนกลับเวอร์ชันเดิมเองได้ และจำเวอร์ชันนั้นไว้ไม่ให้วนซ้ำ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  computeVersionFromEntries,
  localVersion,
  sha256Hex,
  decideUpdate,
  applyUpdate,
  restartSupervised,
  planBoot,
  readState,
  rollback,
  markHealthy,
  STATE_FILE,
  REJECT_FILE,
  SNAPSHOT_DIR,
  HANDOFF_EXIT_CODE,
  REJECT_COOLDOWN_MS,
  selfUpdateOnce,
} from '../src/selfUpdate.mjs';

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `runner-selfupd-${tag}-`));
}

function seedRunner(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const FILES = { 'src/main.mjs': 'export const a = 1;\n', 'package.json': '{ "name": "r" }\n' };

/** manifest แบบ HUB ส่งมา (path + sha256) */
function manifestOf(dir, paths = Object.keys(FILES)) {
  const files = paths.map((rel) => ({
    path: rel,
    sha256: sha256Hex(fs.readFileSync(path.join(dir, rel))),
    size: fs.statSync(path.join(dir, rel)).size,
  }));
  return { version: computeVersionFromEntries(files), files, generatedAt: '2026-01-01T00:00:00.000Z' };
}

test('computeVersion: ไม่ขึ้นกับลำดับไฟล์ แต่เปลี่ยนเมื่อเนื้อหาเปลี่ยน', () => {
  const a = { path: 'src/a.mjs', sha256: 'aaa' };
  const b = { path: 'src/b.mjs', sha256: 'bbb' };
  assert.equal(computeVersionFromEntries([a, b]), computeVersionFromEntries([b, a]));
  assert.notEqual(computeVersionFromEntries([a, b]), computeVersionFromEntries([a, { ...b, sha256: 'ccc' }]));
  assert.match(computeVersionFromEntries([a, b]), /^[0-9a-f]{12}$/);
});

test('localVersion: เท่ากับฝั่ง HUB เมื่อไฟล์เหมือนกัน · ต่างทันทีเมื่อไฟล์หาย', () => {
  const dir = seedRunner(tmpDir('ver'), FILES);
  const man = manifestOf(dir);
  assert.equal(localVersion(dir, man.files.map((f) => f.path)), man.version);
  fs.unlinkSync(path.join(dir, 'src/main.mjs'));
  assert.notEqual(localVersion(dir, man.files.map((f) => f.path)), man.version);
  assert.equal(localVersion(dir, ['src/ไม่มีอยู่.mjs']), localVersion(dir, ['src/ไม่มีอยู่.mjs']), 'ไฟล์หายต้องไม่โยน error');
});

test('decideUpdate: อัปเดตล่าสุด = ไม่ทำอะไร · ต่างเวอร์ชัน = อัปเดต · เวอร์ชันที่เพิ่งพัง = ข้าม', () => {
  const dir = seedRunner(tmpDir('decide'), FILES);
  const man = manifestOf(dir);
  assert.equal(decideUpdate({ localVersion: man.version, manifest: man }).action, 'up-to-date');
  assert.equal(decideUpdate({ localVersion: 'deadbeef0123', manifest: man }).action, 'update');

  const now = 1_000_000;
  assert.equal(decideUpdate({ localVersion: 'other', manifest: man, rejected: { version: man.version, at: now - 10, reason: 'บูตไม่ขึ้น' }, now }).action, 'skip-rejected');
  assert.equal(
    decideUpdate({ localVersion: 'other', manifest: man, rejected: { version: man.version, at: now - REJECT_COOLDOWN_MS - 1 }, now }).action,
    'update',
    'พ้นช่วงกันวนแล้วต้องลองใหม่ได้',
  );
  assert.equal(decideUpdate({ localVersion: 'other', manifest: null }).action, 'no-bundle');
});

test('applyUpdate: ตรวจ hash ครบก่อนเขียน · เก็บสำเนาเดิม · เขียน state ค้างไว้ให้ผู้ดูแล', async () => {
  const dir = seedRunner(tmpDir('apply'), FILES);
  const remote = seedRunner(tmpDir('remote'), { ...FILES, 'src/main.mjs': 'export const a = 2;\n' });
  const man = manifestOf(remote);

  const out = await applyUpdate({
    dir,
    version: man.version,
    files: man.files,
    fetchFile: async (rel) => fs.readFileSync(path.join(remote, rel)),
    checkFile: () => {}, // ข้ามการทดสอบไวยากรณ์ — เทสต์นี้ตรวจการสลับไฟล์
    now: 5000,
  });

  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'src/main.mjs'), 'utf8'), 'export const a = 2;\n', 'ไฟล์ใหม่ต้องเข้าแทน');
  assert.equal(localVersion(dir, man.files.map((f) => f.path)), man.version, 'หลังอัปเดตต้องตรงเวอร์ชัน HUB');
  const snap = path.join(dir, SNAPSHOT_DIR, out.fromVersion, 'src/main.mjs');
  assert.equal(fs.readFileSync(snap, 'utf8'), 'export const a = 1;\n', 'ต้องมีสำเนาเดิมไว้ย้อนกลับ');
  const state = readState(dir);
  assert.equal(state.toVersion, man.version);
  assert.equal(state.startedAt, null);
  assert.ok(state.pendingSince > 0);
  assert.equal(fs.existsSync(path.join(dir, `.update-${man.version}`)), false, 'โฟลเดอร์พักต้องถูกเก็บกวาด');
});

test('applyUpdate: hash ไม่ตรง = ไม่แตะไฟล์เดิมเลยแม้ไฟล์เดียว + ไม่ทิ้ง state', async () => {
  const dir = seedRunner(tmpDir('badhash'), FILES);
  const remote = seedRunner(tmpDir('remote2'), { ...FILES, 'src/main.mjs': 'export const a = 2;\n' });
  const man = manifestOf(remote);
  man.files = man.files.map((f) => (f.path === 'src/main.mjs' ? { ...f, sha256: 'ff'.repeat(32) } : f));

  await assert.rejects(
    () => applyUpdate({ dir, version: man.version, files: man.files, fetchFile: async (rel) => fs.readFileSync(path.join(remote, rel)), checkFile: () => {} }),
    /hash/i,
  );
  assert.equal(fs.readFileSync(path.join(dir, 'src/main.mjs'), 'utf8'), 'export const a = 1;\n');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false, 'ล้มเหลวแล้วต้องไม่ทิ้ง state ค้าง');
  assert.equal(fs.existsSync(path.join(dir, SNAPSHOT_DIR)), false);
});

test('applyUpdate: ชื่อไฟล์จาก HUB ใช้เป็นทางลัดออกนอกโฟลเดอร์ไม่ได้', async () => {
  const dir = seedRunner(tmpDir('trav'), FILES);
  await assert.rejects(
    () => applyUpdate({ dir, version: 'v1', files: [{ path: '../../evil.mjs', sha256: 'aa' }], fetchFile: async () => Buffer.from('x'), checkFile: () => {} }),
    /ชื่อไฟล์|path/i,
  );
  await assert.rejects(
    () => applyUpdate({ dir, version: 'v1', files: [{ path: 'C:/Windows/evil.mjs', sha256: 'aa' }], fetchFile: async () => Buffer.from('x'), checkFile: () => {} }),
    /ชื่อไฟล์|path/i,
  );
  assert.equal(fs.existsSync(path.join(path.dirname(dir), 'evil.mjs')), false);
});

test('ติดตั้งโดยไม่รีสตาร์ท = ห้ามทิ้ง state ค้าง (state มีไว้ระหว่าง "ส่งงานต่อ" เท่านั้น)', async () => {
  const dir = seedRunner(tmpDir('nostate'), FILES);
  const remote = seedRunner(tmpDir('remote-nostate'), { ...FILES, 'src/main.mjs': 'export const b = 9;\n' });
  const man = manifestOf(remote);
  const fetchImpl = async (url) => {
    if (String(url).includes('update/manifest')) return { ok: true, status: 200, json: async () => man };
    const rel = decodeURIComponent(String(url).split('path=')[1]);
    const buf = fs.readFileSync(path.join(remote, rel));
    return { ok: true, status: 200, arrayBuffer: async () => buf };
  };
  const out = await selfUpdateOnce({ hubUrl: 'http://hub', token: 't', dir, fetchImpl, apply: true, restart: false, checkFile: () => {} });
  assert.equal(out.status, 'updated');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false, 'ไม่มีผู้ดูแลเฝ้าอยู่ = ต้องไม่ทิ้ง state ค้าง');
  assert.equal(localVersion(dir, man.files.map((f) => f.path)), man.version);
});

test('planBoot: บูตแรกของเวอร์ชันใหม่ประกาศตัว · บูตถัดไปที่ยังไม่สุขภาพดี = ให้ผู้ดูแลตัดสิน · สุขภาพดีแล้ว = ล้าง state', () => {
  const dir = seedRunner(tmpDir('boot'), FILES);
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ pendingSince: 100, fromVersion: 'old', toVersion: 'new', startedAt: null, healthyAt: null }));

  const first = planBoot(dir, { now: 200 });
  assert.equal(first.action, 'starting');
  assert.equal(readState(dir).startedAt, 200);

  const second = planBoot(dir, { now: 300 });
  assert.equal(second.action, 'running', 'มี startedAt แล้ว = ยังไม่ตัดสินใจย้อนกลับเอง');

  markHealthy(dir, { now: 400 });
  assert.equal(readState(dir).healthyAt, 400);
  assert.equal(planBoot(dir, { now: 500 }).action, 'cleared');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false, 'สุขภาพดีแล้วต้องไม่ทิ้ง state');

  assert.equal(planBoot(dir, { now: 600 }).action, 'none');
});

test('rollback: คืนไฟล์ชุดเดิมทั้งหมด + จำเวอร์ชันที่พังไว้ (กันวน) + ล้าง state', async () => {
  const dir = seedRunner(tmpDir('roll'), FILES);
  const remote = seedRunner(tmpDir('remote3'), { ...FILES, 'src/main.mjs': 'export const a = 2;\n' });
  const man = manifestOf(remote);
  await applyUpdate({
    dir,
    version: man.version,
    files: man.files,
    fetchFile: async (rel) => fs.readFileSync(path.join(remote, rel)),
    checkFile: () => {},
    now: 10,
  });

  // จำลองว่า process ใหม่พังก่อนประกาศตัว ⇒ ผู้ดูแลย้อนกลับ
  const out = rollback(dir, { now: 20, reason: 'โปรเซสใหม่ไม่ขึ้น' });
  assert.equal(out.rolledBack, true);
  assert.equal(fs.readFileSync(path.join(dir, 'src/main.mjs'), 'utf8'), 'export const a = 1;\n', 'ต้องได้โค้ดเดิมคืน');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false);
  const rejected = JSON.parse(fs.readFileSync(path.join(dir, REJECT_FILE), 'utf8'));
  assert.equal(rejected.version, man.version);
  assert.match(rejected.reason, /ไม่ขึ้น/);
  assert.equal(localVersion(dir, man.files.map((f) => f.path)), out.fromVersion);
});

test('restartSupervised: โปรเซสใหม่ประกาศตัว = ส่งงานต่อสำเร็จ · ไม่ประกาศ = ย้อนกลับเอง', async () => {
  const dir = seedRunner(tmpDir('sup'), FILES);
  const remote = seedRunner(tmpDir('remote4'), { ...FILES, 'src/main.mjs': 'export const a = 2;\n' });
  const man = manifestOf(remote);
  await applyUpdate({
    dir,
    version: man.version,
    files: man.files,
    fetchFile: async (rel) => fs.readFileSync(path.join(remote, rel)),
    checkFile: () => {},
    now: 1,
  });

  // (ก) โปรเซสใหม่ทำงานได้ — จำลองด้วยการเขียน startedAt เหมือน main.mjs จริง
  const okSpawn = () => {
    setTimeout(() => {
      const s = readState(dir);
      fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ ...s, startedAt: Date.now() }));
    }, 10);
    return { unref() {} };
  };
  const handoff = await restartSupervised({ dir, spawnImpl: okSpawn, timeoutMs: 800, pollMs: 10, sleepImpl: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.equal(handoff.ok, true);
  assert.equal(handoff.exitCode, HANDOFF_EXIT_CODE);

  // (ข) อัปเดตรอบใหม่ แล้วโปรเซสใหม่เงียบ (พังตอน import)
  //     ⇒ ต้องย้อนกลับ "เวอร์ชันที่กำลังรันอยู่" (a = 2) ไม่ใช่โค้ดเก่ากว่าที่สุด (a = 1)
  const remote3 = seedRunner(tmpDir('remote5'), { ...FILES, 'src/main.mjs': 'export const a = 3;\n' });
  const man3 = manifestOf(remote3);
  await applyUpdate({
    dir,
    version: man3.version,
    files: man3.files,
    fetchFile: async (rel) => fs.readFileSync(path.join(remote3, rel)),
    checkFile: () => {},
    now: 900,
  });
  const silent = await restartSupervised({ dir, spawnImpl: () => ({ unref() {} }), timeoutMs: 120, pollMs: 20, sleepImpl: (ms) => new Promise((r) => setTimeout(r, ms)), now: 999 });
  assert.equal(silent.ok, false);
  assert.equal(silent.rolledBack, true);
  assert.equal(silent.version, man3.version, 'ต้องจำเวอร์ชันที่พังไว้กันวน');
  assert.equal(fs.readFileSync(path.join(dir, 'src/main.mjs'), 'utf8'), 'export const a = 2;\n', 'ต้องคืนโค้ดเวอร์ชันที่รันอยู่ (ไม่ใช่โค้ดเก่ากว่าที่สุด)');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false);
  const rejected3 = JSON.parse(fs.readFileSync(path.join(dir, REJECT_FILE), 'utf8'));
  assert.equal(rejected3.version, man3.version);
  assert.equal(decideUpdate({ localVersion: localVersion(dir, man3.files.map((f) => f.path)), manifest: man3, rejected: rejected3 }).action, 'skip-rejected');
});
