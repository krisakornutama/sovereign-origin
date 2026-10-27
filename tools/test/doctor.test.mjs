#!/usr/bin/env node
// tools/test/doctor.test.mjs
// ── เทสต์ "INSTALL-CHECK" (doctor) ───────────────────────────────────────────────
// ทำไมต้องมี: เจ้าของบอก 27/10/69 ว่า "ไม่รู้ความต้องการของลูกค้า" ⇒ สิ่งที่ต้องจริงแน่ ๆ
// คือ "คนอื่นติดตั้งเองได้ และส่งใบตรวจกลับมาให้เราเห็นปัญหาที่เขามองไม่เห็น"
//
// กติกาที่ล็อกไว้ (ห้ามพัง):
//   · token / รหัสเชิญ / ค่าใน .env ห้ามหลุดลง SUPPORT.txt (ไฟล์นี้ถูกส่งต่อให้คนอื่น)
//   · ปัญหาที่ทำให้ติดตั้งไม่จบ = exit 1 · ปัญหาที่ติดตั้งได้แต่ควรรู้ = warn (exit 0)
//   · ตรวจ "อ่านอย่างเดียว" — heartbeat ต้องไม่ถูกยิงถ้าไม่ได้สั่ง --heartbeat
//   · อ่าน install-plan.json ที่มี BOM ได้ (Notepad/PowerShell 5.1 เติมให้ — เคยทำเครื่องลูกพังมาแล้ว)
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');
const doctor = await import('../agent-pack/doctor.mjs');
const pack = await import('../agent-pack/pack.mjs');
const installMod = await import('../install/install.mjs');

const made = [];
function tmpDir(name) {
  const dir = path.join(TMP_ROOT, `doctor-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  made.push(dir);
  return dir;
}

/** ชุดติดตั้งปลอมที่ "พร้อมติดตั้ง" — ใช้เป็นฐานของทุกเคส */
function readyBundle({ join = true, enrollCode = '', plan = '{"modules":["core"]}', envText = '' } = {}) {
  const dir = tmpDir('bundle');
  fs.writeFileSync(path.join(dir, 'setup-machine.mjs'), '// fake\n');
  if (join) {
    fs.writeFileSync(
      path.join(dir, 'join.json'),
      JSON.stringify({ hubUrl: 'http://192.168.1.50:3000', machineToken: TOKEN, machineName: 'PC-ทดสอบ' }),
    );
  }
  if (enrollCode) fs.writeFileSync(path.join(dir, 'enroll-code.txt'), `HUB_URL=http://192.168.1.50:3000\nMACHINE_ENROLL_CODE=${enrollCode}\n`);
  if (plan !== null) fs.writeFileSync(path.join(dir, 'install-plan.json'), plan);
  if (envText) fs.writeFileSync(path.join(dir, '.env'), envText);
  return dir;
}

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32); // 64 hex = รูปแบบ machine token จริง
const ENROLL = `enr_${'c'.repeat(48)}`;

const okFetch = (calls) => async (url, init) => {
  calls?.push({ url, init });
  return { status: 200, ok: true };
};
const okExec = async () => ({ code: 0, stdout: 'Docker version 27.0.0, build abc', stderr: '' });
const bigDisk = () => ({ bsize: 4096, blocks: 100, bfree: (50 * 1024 ** 3) / 4096, bavail: (50 * 1024 ** 3) / 4096 });

const base = (over = {}) => ({
  fetchImpl: okFetch(),
  exec: okExec,
  platform: 'win32',
  arch: 'x64',
  hostname: 'PC-ทดสอบ',
  nodeVersion: '24.15.0',
  statfsSync: bigDisk,
  writeReport: false,
  env: {}, // แยกจาก environment ของเครื่องที่รันเทสต์ (HUB_URL/MACHINE_ENROLL_CODE ต้องไม่รั่วเข้ามา)
  ...over,
});

after(() => {
  for (const d of made) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ไม่เป็นไร — temp */
    }
  }
});

describe('redact: ความลับห้ามออกจากเครื่อง', () => {
  test('machine token (64 hex) / รหัสเชิญ / ค่าใน .env ถูกปิด', () => {
    const text = `token=${TOKEN} code=${ENROLL} MACHINE_TOKEN=${TOKEN} JWT_SECRET=abc123 PORT=3001`;
    const out = doctor.redact(text);
    assert.doesNotMatch(out, new RegExp(TOKEN), 'ห้ามมี machine token ในข้อความ');
    assert.doesNotMatch(out, /enr_c{48}/, 'ห้ามมีรหัสเชิญเต็ม');
    assert.doesNotMatch(out, /JWT_SECRET=abc123/, 'ห้ามมีค่า secret');
    assert.match(out, /PORT=3001/, 'ค่าที่ไม่ลับต้องคงไว้ให้ debug ได้');
  });

  test('token ที่โผล่มาเดี่ยว ๆ (ไม่มีชื่อกำกับ) ก็ต้องถูกปิด', () => {
    // เคสจริงที่อันตราย: error message ของ HTTP library พิมพ์ header ทั้งก้อนออกมา
    const out = doctor.redact(`failed: header x-machine-token: ${TOKEN} rejected`);
    assert.doesNotMatch(out, new RegExp(TOKEN), 'token เดี่ยวต้องถูกปิด — ไม่งั้น SUPPORT.txt รั่ว');
    const bare = doctor.redact(ENROLL);
    assert.doesNotMatch(bare, /enr_c{48}/);
  });

  test('URL/พาธปกติไม่ถูกทำให้เสีย', () => {
    const out = doctor.redact('http://192.168.1.50:3000/api/health D:\\Sovereign\\agent-runner');
    assert.match(out, /192\.168\.1\.50:3000\/api\/health/);
    assert.match(out, /D:\\Sovereign/);
  });
});

describe('เครื่องพร้อมติดตั้ง = ผ่านหมด exit 0', () => {
  test('join.json + HUB ตอบ + Node 24 + ดิสก์เหลือ = ok ทุกข้อ', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base() });
    const bad = r.checks.filter((c) => c.status !== 'ok').map((c) => `${c.id}:${c.status}:${c.detail}`);
    assert.deepEqual(bad, [], `ต้องผ่านทุกข้อ — ที่ไม่ผ่าน: ${bad.join(' | ')}`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.ok, true);
    assert.match(r.report, /สรุป: ผ่าน \d+ · เตือน 0 · ไม่ผ่าน 0/);
    assert.match(r.report, /พร้อมติดตั้ง/);
  });

  test('ชุดสากล (รหัสเชิญ) นับเป็นวิธีลงทะเบียนที่ใช้ได้', async () => {
    const dir = readyBundle({ join: false, enrollCode: ENROLL });
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.find((c) => c.id === 'join').status, 'ok');
    assert.equal(r.exitCode, 0);
  });
});

describe('ปัญหาที่ทำให้ติดตั้งไม่จบ = exit 1 พร้อมวิธีแก้', () => {
  test('Node ต่ำกว่า 20', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ nodeVersion: '18.20.4' }) });
    const c = r.checks.find((x) => x.id === 'node');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /20\+/);
    assert.equal(r.exitCode, 1);
  });

  test('ไม่พบไฟล์ setup-machine.mjs (ก๊อปมาไม่ครบ)', async () => {
    const dir = tmpDir('empty');
    fs.writeFileSync(path.join(dir, 'join.json'), JSON.stringify({ hubUrl: 'http://h:3000', machineToken: TOKEN }));
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.find((x) => x.id === 'bundle').status, 'fail');
    assert.equal(r.exitCode, 1);
  });

  test('ไม่มี join.json และไม่มีรหัสเชิญ = บอกให้แพ็กใหม่', async () => {
    const dir = readyBundle({ join: false });
    const r = await doctor.runDoctor({ dir, ...base() });
    const c = r.checks.find((x) => x.id === 'join');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /แพ็กชุดใหม่|รหัสเชิญ/);
    assert.equal(r.exitCode, 1);
  });

  test('HUB ไม่ตอบ (เน็ต/ไฟร์วอลล์คนละวง) = fail พร้อม hint ภาษาไทย', async () => {
    const dir = readyBundle();
    const boom = async () => {
      throw new Error('connect ECONNREFUSED 192.168.1.50:3000');
    };
    const r = await doctor.runDoctor({ dir, ...base({ fetchImpl: boom }) });
    const c = r.checks.find((x) => x.id === 'hub');
    assert.equal(c.status, 'fail');
    assert.match(c.detail, /ECONNREFUSED/);
    assert.match(c.hint, /ไฟร์วอลล์/);
    assert.equal(r.exitCode, 1);
  });

  test('HUB ตอบ 500 = ไม่ถือว่าผ่าน', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ fetchImpl: async () => ({ status: 500, ok: false }) }) });
    assert.equal(r.checks.find((x) => x.id === 'hub').status, 'fail');
  });

  test('ดิสก์เหลือ < 1 GB = fail', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ statfsSync: () => ({ bsize: 4096, bavail: 1000, bfree: 1000 }) }) });
    assert.equal(r.checks.find((x) => x.id === 'disk').status, 'fail');
    assert.equal(r.exitCode, 1);
  });
});

describe('เรื่องที่ติดตั้งได้แต่ต้องรู้ = warn (ไม่บล็อก)', () => {
  test('ดิสก์ 1–6 GB = เตือนเรื่องชุดเต็ม', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({
      dir,
      ...base({ statfsSync: () => ({ bsize: 4096, bavail: (3 * 1024 ** 3) / 4096, bfree: (3 * 1024 ** 3) / 4096 }) }),
    });
    assert.equal(r.checks.find((x) => x.id === 'disk').status, 'warn');
    assert.equal(r.exitCode, 0, 'warn ต้องไม่ทำให้ exit 1');
  });

  test('ไม่มี install-plan.json = ติดตั้งเฉพาะ core (warn)', async () => {
    const dir = readyBundle({ plan: null });
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.find((x) => x.id === 'plan').status, 'warn');
    assert.equal(r.exitCode, 0);
  });

  test('install-plan.json มี BOM = อ่านได้ (ไม่ใช่ไฟล์เสีย)', async () => {
    const dir = readyBundle({ plan: '\uFEFF' + JSON.stringify({ modules: ['core', 'farm'] }) });
    const r = await doctor.runDoctor({ dir, ...base() });
    const c = r.checks.find((x) => x.id === 'plan');
    assert.equal(c.status, 'ok');
    assert.match(c.detail, /farm/);
  });

  test('install-plan.json เสีย = warn ไม่ใช่ fail (ติดตั้งต่อได้)', async () => {
    const dir = readyBundle({ plan: '{ not json' });
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.find((x) => x.id === 'plan').status, 'warn');
    assert.equal(r.exitCode, 0);
  });

  test('ไม่มี Docker = warn (เครื่องลูกที่ทำแค่ runner ไม่ต้องมี)', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ exec: async () => ({ code: 1, stdout: '', stderr: 'not found' }) }) });
    assert.equal(r.checks.find((x) => x.id === 'docker').status, 'warn');
    assert.equal(r.exitCode, 0);
  });

  test('มี .env เดิม = เตือนว่าจะถูกอัปเดต', async () => {
    const dir = readyBundle();
    fs.writeFileSync(path.join(dir, '.env'), `MACHINE_TOKEN=${TOKEN}\nHUB_URL=http://192.168.1.50:3000\n`);
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.find((x) => x.id === 'existing').status, 'warn');
    assert.equal(r.exitCode, 0);
  });
});

describe('อ่านอย่างเดียว: ไม่ยิง heartbeat ถ้าไม่ได้สั่ง', () => {
  test('ปกติ = ไม่มีคำขอไป /heartbeat เลย', async () => {
    const calls = [];
    const dir = readyBundle();
    await doctor.runDoctor({ dir, ...base({ fetchImpl: okFetch(calls) }) });
    assert.equal(calls.filter((c) => c.url.includes('/heartbeat')).length, 0);
    assert.equal(calls.filter((c) => c.url.endsWith('/api/health')).length, 1, 'ต้องยิง health ครั้งเดียว');
  });

  test('--heartbeat + token ถูก = ok และส่ง header x-machine-token', async () => {
    const calls = [];
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ fetchImpl: okFetch(calls), heartbeat: true }) });
    const hb = calls.find((c) => c.url.includes('/heartbeat'));
    assert.ok(hb, 'ต้องยิง heartbeat เมื่อสั่ง');
    assert.equal(hb.init.headers['x-machine-token'], TOKEN);
    assert.equal(r.checks.find((x) => x.id === 'token').status, 'ok');
  });

  test('--heartbeat + 401 = fail พร้อมบอกให้แพ็กใหม่', async () => {
    const dir = readyBundle();
    const fetch401 = async (url) => ({ status: url.includes('/heartbeat') ? 401 : 200, ok: !url.includes('/heartbeat') });
    const r = await doctor.runDoctor({ dir, ...base({ fetchImpl: fetch401, heartbeat: true }) });
    const c = r.checks.find((x) => x.id === 'token');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /แพ็กชุดใหม่/);
    assert.equal(r.exitCode, 1);
  });
});

describe('SUPPORT.txt: ไฟล์ที่ส่งต่อได้โดยไม่มีความลับ', () => {
  test('เขียนไฟล์จริงและไม่มี token/รหัสเชิญ', async () => {
    const dir = readyBundle({ plan: '\uFEFF' + JSON.stringify({ modules: ['core'] }) });
    const r = await doctor.runDoctor({ dir, ...base({ writeReport: true }) });
    assert.ok(r.reportPath.endsWith('SUPPORT.txt'));
    const text = fs.readFileSync(r.reportPath, 'utf8');
    assert.match(text, /Sovereign OS/);
    assert.doesNotMatch(text, new RegExp(TOKEN));
    assert.doesNotMatch(text, /enr_c{48}/);
    // ต้องมีข้อมูลพอให้วินิจฉัย: เวลา/แพลตฟอร์ม/โฟลเดอร์
    assert.match(text, /PC-ทดสอบ/);
    assert.match(text, /win32/);
  });

  test('เขียนไม่ได้ = ไม่ throw และยังคืนผลตรวจ', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base({ writeReport: true }) });
    assert.equal(r.reportPath.endsWith('SUPPORT.txt'), true);
    // จำลองดิสก์อ่านอย่างเดียว: เขียนทับพาธที่เป็นโฟลเดอร์
    const blocker = tmpDir('blocked');
    fs.mkdirSync(path.join(blocker, 'SUPPORT.txt'));
    fs.writeFileSync(path.join(blocker, 'setup-machine.mjs'), '//fake');
    const r2 = await doctor.runDoctor({ dir: blocker, ...base({ writeReport: true }) });
    assert.equal(r2.reportPath, '', 'เขียนไม่ได้ต้องคืนค่าว่าง ไม่ใช่ throw');
    assert.equal(r2.exitCode, 1, 'ยังต้องรายงานผลตรวจตามจริง');
  });
});

describe('เครื่องแม่ (profile=hub): ตรวจชุดเดียวกับ INSTALL-CHECK', () => {
  /** รากโปรเจ็กจำลองของเครื่องแม่ — มี compose + template เท่านั้น */
  function hubRoot() {
    const dir = tmpDir('hub');
    fs.mkdirSync(path.join(dir, 'sovereign-os', 'infra'), { recursive: true });
    const compose = path.join(dir, 'sovereign-os', 'infra', 'docker-compose.yml');
    fs.writeFileSync(compose, 'services: {}\n');
    const template = path.join(dir, 'sovereign.env.template');
    fs.writeFileSync(template, 'PORT=3001\n');
    return { dir, compose, template };
  }
  const hubArgs = ({ dir, compose, template }, over = {}) => ({
    dir,
    root: dir,
    profile: 'hub',
    composeFile: compose,
    templateFile: template,
    ...base(),
    ...over,
  });

  test('compose + template + Docker ครบ = ผ่านหมด และไม่ถามเรื่อง join/แผนติดตั้ง', async () => {
    const root = hubRoot();
    const r = await doctor.runDoctor(hubArgs(root));
    const bad = r.checks.filter((c) => c.status !== 'ok').map((c) => `${c.id}:${c.status}:${c.detail}`);
    assert.deepEqual(bad, [], `ต้องผ่านทุกข้อ — ที่ไม่ผ่าน: ${bad.join(' | ')}`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.checks.some((c) => c.id === 'join'), false, 'เครื่องแม่ไม่ต้องมี join.json');
    assert.equal(r.checks.some((c) => c.id === 'plan'), false, 'เครื่องแม่ไม่ใช้ install-plan.json');
    assert.match(r.report, /เครื่องแม่/);
  });

  test('ไม่มี Docker = fail (เครื่องแม่ขาดไม่ได้ ต่างจากเครื่องลูกที่แค่ warn)', async () => {
    const root = hubRoot();
    const r = await doctor.runDoctor(
      hubArgs(root, { exec: async () => ({ code: 1, stdout: '', stderr: 'docker: not found' }) }),
    );
    const c = r.checks.find((x) => x.id === 'docker');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /Docker Desktop/);
    assert.equal(r.exitCode, 1);
  });

  test('compose หายไป = fail พร้อมบอกให้รันจากรากโปรเจ็ก', async () => {
    const root = hubRoot();
    const r = await doctor.runDoctor(hubArgs(root, { composeFile: path.join(root.dir, 'ไม่มีจริง.yml') }));
    const c = r.checks.find((x) => x.id === 'bundle');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /รากโปรเจ็ก/);
    assert.equal(r.exitCode, 1);
  });

  test('มี sovereign-os/infra/.env เดิม = warn ว่าจะใช้ค่าเดิม (ไม่ทับ)', async () => {
    const root = hubRoot();
    fs.writeFileSync(path.join(root.dir, 'sovereign-os', 'infra', '.env'), 'POSTGRES_PASSWORD=old\n');
    const r = await doctor.runDoctor(hubArgs(root));
    const c = r.checks.find((x) => x.id === 'existing');
    assert.equal(c.status, 'warn');
    assert.match(c.hint, /--force/);
    assert.equal(r.exitCode, 0);
  });

  test('dry-run: ไม่ exec · ไม่ยิงเน็ต · ไม่เขียนไฟล์แม้แต่ไฟล์เดียว', async () => {
    const root = hubRoot();
    const execCalls = [];
    const fetchCalls = [];
    const before = fs.readdirSync(root.dir).sort();
    const r = await doctor.runDoctor(
      hubArgs(root, {
        allowCommands: false,
        exec: async (...a) => {
          execCalls.push(a);
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        fetchImpl: async (...a) => {
          fetchCalls.push(a);
          return { status: 200, ok: true };
        },
      }),
    );
    assert.deepEqual(execCalls, [], 'dry-run ต้องไม่รันคำสั่งเลย');
    assert.deepEqual(fetchCalls, [], 'dry-run ต้องไม่ยิงเน็ตเลย');
    assert.deepEqual(fs.readdirSync(root.dir).sort(), before, 'dry-run ต้องไม่เขียนไฟล์');
    assert.equal(r.checks.find((x) => x.id === 'docker').status, 'skip');
    assert.match(r.report, /\[skip\]/);
  });

  test('เครื่องลูก + dry-run: ไม่ยิง heartbeat แม้สั่ง --heartbeat', async () => {
    const dir = readyBundle();
    const calls = [];
    const r = await doctor.runDoctor({
      dir,
      ...base({ allowCommands: false, heartbeat: true, fetchImpl: okFetch(calls) }),
    });
    assert.deepEqual(calls, []);
    assert.equal(r.checks.find((x) => x.id === 'token'), undefined, 'โหมด dry-run ต้องไม่สร้างข้อ token เลย');
  });
});

describe('หลังติดตั้ง (--post): ของที่ต้องยังอยู่', () => {
  const heartbeatOk = (machine) => async (url) =>
    url.includes('/heartbeat')
      ? { status: 200, ok: true, json: async () => ({ machine }) }
      : { status: 200, ok: true };

  const postExec = ({ task = 0, pid = '4321' } = {}) => async (cmd) => {
    if (cmd === 'schtasks') return { code: task, stdout: task === 0 ? 'TaskName: Sovereign Agent Runner' : '', stderr: task === 0 ? '' : 'ERROR: not found' };
    if (cmd === 'powershell') return { code: 0, stdout: pid, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  test('task + process + heartbeat ครบ = ok ทุกข้อ (exit 0)', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({
      dir,
      ...base({
        postInstall: true,
        exec: postExec(),
        fetchImpl: heartbeatOk({ name: 'PC-ทดสอบ', last_heartbeat: new Date().toISOString() }),
      }),
    });
    assert.equal(r.checks.find((x) => x.id === 'task').status, 'ok');
    assert.match(r.checks.find((x) => x.id === 'runner').detail, /4321/);
    const token = r.checks.find((x) => x.id === 'token');
    assert.equal(token.status, 'ok');
    assert.match(token.detail, /PC-ทดสอบ/);
    assert.match(token.detail, /วินาทีที่แล้ว/);
    assert.equal(r.exitCode, 0);
  });

  test('ไม่มี autostart task = fail (รีบูตแล้วเครื่องหลุดจาก HUB)', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({
      dir,
      ...base({
        postInstall: true,
        exec: postExec({ task: 1 }),
        fetchImpl: heartbeatOk({ name: 'PC', last_heartbeat: new Date().toISOString() }),
      }),
    });
    const c = r.checks.find((x) => x.id === 'task');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /INSTALL\.cmd/);
    assert.equal(r.exitCode, 1);
  });

  test('task มีแต่ process ตาย = fail พร้อมบอกให้เปิด RUN-RUNNER', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({
      dir,
      ...base({
        postInstall: true,
        exec: postExec({ pid: '' }),
        fetchImpl: heartbeatOk({ name: 'PC', last_heartbeat: new Date().toISOString() }),
      }),
    });
    const c = r.checks.find((x) => x.id === 'runner');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /RUN-RUNNER/);
  });

  test('heartbeat 401 = fail (token ถูกยกเลิก)', async () => {
    const dir = readyBundle();
    const fetchImpl = async (url) => ({ status: url.includes('/heartbeat') ? 401 : 200, ok: false });
    const r = await doctor.runDoctor({ dir, ...base({ postInstall: true, exec: postExec(), fetchImpl }) });
    const c = r.checks.find((x) => x.id === 'token');
    assert.equal(c.status, 'fail');
    assert.match(c.hint, /แพ็กชุดใหม่/);
    assert.equal(r.exitCode, 1);
  });

  test('ไม่ใช่ Windows = ข้าม task/process แต่ยังตรวจที่เหลือ', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({
      dir,
      ...base({
        postInstall: true,
        platform: 'linux',
        exec: postExec(),
        fetchImpl: heartbeatOk({ name: 'PC', last_heartbeat: new Date().toISOString() }),
      }),
    });
    assert.equal(r.checks.find((x) => x.id === 'task').status, 'skip');
    assert.equal(r.checks.find((x) => x.id === 'runner').status, 'skip');
    assert.equal(r.exitCode, 0);
  });

  test('ปกติ (ไม่สั่ง --post) ยังไม่ตรวจ task/process เลย', async () => {
    const dir = readyBundle();
    const r = await doctor.runDoctor({ dir, ...base() });
    assert.equal(r.checks.some((x) => x.id === 'task'), false);
    assert.equal(r.checks.some((x) => x.id === 'runner'), false);
  });
});

describe('ต่อสายกับ HUB installer (D3): preflight ใช้ชุดตรวจเดียวกัน', () => {
  /** รากโปรเจ็กจำลองแบบเดียวกับที่ install.mjs ต้องการ (compose) */
  function rootSkeleton() {
    const dir = tmpDir('hub-root');
    fs.mkdirSync(path.join(dir, 'sovereign-os', 'infra'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sovereign-os', 'infra', 'docker-compose.yml'), 'services:\n  db:\n    image: x\n');
    return dir;
  }

  test('dry-run ของ installer ยังบริสุทธิ์ (doctor ไม่รันคำสั่ง/ไม่เขียนไฟล์) + มีขั้น doctor', async () => {
    const root = rootSkeleton();
    const execCalls = [];
    const before = fs.readdirSync(root).sort();
    const out = await installMod.runInstall({
      root,
      dryRun: true,
      noFrontend: true,
      withRunner: false,
      exec: async (...a) => {
        execCalls.push(a);
        return { code: 0, stdout: '', stderr: '' };
      },
      fetchImpl: async () => ({ status: 200, ok: true }),
      sleep: async () => {},
      platform: 'linux',
    });
    assert.deepEqual(execCalls, [], `dry-run ต้องไม่รันคำสั่ง: ${JSON.stringify(execCalls)}`);
    assert.deepEqual(fs.readdirSync(root).sort(), before, 'dry-run ต้องไม่เขียนไฟล์');
    const step = out.steps.find((s) => s.name === 'doctor');
    assert.ok(step, `ต้องมีขั้น doctor: ${JSON.stringify(out.steps.map((s) => s.name))}`);
    assert.notEqual(step.status, 'fail');
  });

  test('Docker ใช้ไม่ได้บนเครื่องแม่ = หยุดที่ preflight ก่อนเขียน env', async () => {
    const root = rootSkeleton();
    const out = await installMod.runInstall({
      root,
      noFrontend: true,
      withRunner: false,
      exec: async (cmd, args = []) =>
        cmd === 'docker' && args[0] === '--version'
          ? { code: 1, stdout: '', stderr: 'docker: not found' }
          : { code: 0, stdout: '', stderr: '' },
      fetchImpl: async () => ({ status: 200, ok: true }),
      sleep: async () => {},
      platform: 'linux',
    });
    assert.equal(out.exitCode, 1);
    assert.ok(out.failed.includes('preflight'), `ต้องรายงาน preflight: ${JSON.stringify(out.failed)}`);
    assert.match(out.report, /ตรวจเครื่องไม่ผ่าน/);
    assert.equal(fs.existsSync(path.join(root, 'sovereign-os', 'infra', '.env')), false, 'ห้ามเขียน env เมื่อ preflight ไม่ผ่าน');
  });
});

describe('ตัวเรียกบน Windows (.cmd) ปลอดภัยกับทุก codepage', () => {
  const file = path.join(ROOT, 'tools', 'agent-pack', 'INSTALL-CHECK.cmd');

  test('มีไฟล์ + ขึ้นบรรทัดแรกด้วย chcp 65001 (ก่อนข้อความใด ๆ)', () => {
    const text = fs.readFileSync(file, 'utf8');
    const first = text.split('\r\n')[0].toLowerCase();
    assert.match(first, /chcp 65001/);
  });

  test('ASCII ล้วน + CRLF + มี pause (กันหน้าต่างปิดก่อนอ่าน)', () => {
    const buf = fs.readFileSync(file);
    const bad = [...buf].filter((b) => b > 127);
    assert.equal(bad.length, 0, `ต้อง ASCII ล้วน — พบ ${bad.length} ไบต์`);
    const text = buf.toString('utf8');
    assert.equal((text.match(/(?<!\r)\n/g) || []).length, 0, 'ต้องเป็น CRLF ทั้งไฟล์');
    assert.match(text, /\r\npause\r\n/);
  });

  test('มีทางออกครบทุกกรณี (no_node / no_script / failed / ok มาบรรจบที่ :end)', () => {
    const text = fs.readFileSync(file, 'utf8');
    for (const label of [':no_node', ':no_script', ':failed', ':check', ':end']) {
      assert.ok(text.includes(label), `ขาด ${label}`);
    }
    // ทุก goto ต้องมีป้ายรองรับ (ไม่มี goto ลอย)
    const targets = [...text.matchAll(/goto (\w+)/g)].map((m) => `:${m[1]}`);
    for (const t of targets) assert.ok(text.includes(t), `goto ${t} ไม่มีอยู่จริง`);
  });
});

describe('ต่อสายเข้าชุดติดตั้ง: ทั้งชุด OTA และชุดเต็มต้องมี doctor', () => {
  test('bundleFiles มี doctor.mjs + INSTALL-CHECK.cmd', () => {
    const files = pack.bundleFiles(ROOT);
    assert.ok(files.includes('doctor.mjs'));
    assert.ok(files.includes('INSTALL-CHECK.cmd'));
  });

  test('bundleSource ชี้ไฟล์ทั้งสองไปที่ tools/agent-pack', () => {
    for (const rel of ['doctor.mjs', 'INSTALL-CHECK.cmd']) {
      const src = pack.bundleSource(ROOT, rel);
      assert.equal(src, path.join(ROOT, 'tools', 'agent-pack', rel));
      assert.ok(fs.existsSync(src), `${rel} ต้องมีอยู่จริง (ไม่งั้นชุดติดตั้งพังตอนแพ็ก)`);
    }
  });
});
