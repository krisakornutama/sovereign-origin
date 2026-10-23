#!/usr/bin/env node
/* ── ชุดติดตั้งเครื่องลูก: "ก็อปโฟลเดอร์เดียว → ดับเบิลคลิก → ออนไลน์เอง" ──────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (จากของจริง 9 ต.ค. 69):
   1) เคยต้องไปกด "ลงทะเบียนเครื่องใหม่" ในหน้าเว็บเอง แล้วคัดลอก token มาตั้ง .env
      ⇒ พลาดง่าย/ยุ่งยาก · ที่นี่ตัวแพ็กบน HUB ออก token ให้เองและฝังในชุดติดตั้ง
   2) รายการไฟล์ที่เอกสารบอกให้คัดลอก เคยขาดโมดูล (control/hub-control/screen/input/fsops)
      ⇒ runner crash ด้วย ERR_MODULE_NOT_FOUND · เทสต์ที่นี่คำนวณจาก import จริงของ main.mjs
   3) บรรทัด "พร้อมใช้งาน" ของชุดติดตั้งต้องไม่หลุด token ลงไฟล์ที่คนอ่าน
*/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** ที่พักชั่วคราวต้องอยู่บนไดรฟ์โปรเจ็กเท่านั้น (AGENTS.md ข้อ 7) */
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');

// Phase 3A: ให้ทุก publish ในเทสต์เซ็นด้วย key ชั่วคราว (ไม่แตะ private key จริง)
const TEST_KEY_ID = 'agent-pack-test-key';
const TEST_PAIR = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = TEST_PAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.AGENT_UPDATE_SIGNING_KEY = TEST_PAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.AGENT_UPDATE_SIGNING_KEY_ID = TEST_KEY_ID;

const pack = await import('../agent-pack/pack.mjs');
// สูตรแฮช/เวอร์ชันตัวเดียวกับที่เครื่องลูกใช้ (ตัวแพ็ก import โมดูลนี้จริง)
const { sha256Hex, computeVersionFromEntries } = await import('../../sovereign-os/agent-runner/src/selfUpdate.mjs');
const { canonicalManifestPayload } = await import('../../sovereign-os/agent-runner/src/updateTrust.mjs');
const REPO_ROOT_TEST = () => ROOT;
const setup = await import('../agent-pack/setup-machine.mjs');

let sandbox;
beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'agentpack-test-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** fetch ปลอม — จำ URL/header ไว้ให้ตรวจว่ายิงจริง */
function fakeFetch(handler) {
  const seen = [];
  const impl = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} });
    return handler(String(url), init);
  };
  impl.seen = seen;
  return impl;
}

const okJson = (status = 200, body = { status: 'ok' }) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** exec ปลอม */
function fakeExec(results = {}) {
  const calls = [];
  const exec = async (cmd, args = []) => {
    calls.push([cmd, ...args].join(' '));
    const key = Object.keys(results).find((k) => `${cmd} ${args.join(' ')}`.includes(k));
    return key ? results[key] : { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  exec.ran = (needle) => calls.some((c) => c.includes(needle));
  return exec;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('pack: หา IP ของ HUB เอง + รายการไฟล์ที่ต้องก็อป', () => {
  test('detectHubUrl เลือก IPv4 ในวง LAN และข้าม adapter จำลอง', () => {
    const ifaces = {
      'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.28.96.1' }],
      'Hyper-V Virtual': [{ family: 'IPv4', internal: false, address: '192.168.80.1' }],
      'Wi-Fi': [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '192.168.1.102' },
      ],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    };
    assert.equal(pack.detectHubUrl(ifaces), 'http://192.168.1.102:3000');
  });

  test('ไม่มี LAN ให้ใช้ → fallback 127.0.0.1 (ไม่ทำให้แพ็กพัง)', () => {
    assert.equal(pack.detectHubUrl({ Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }), 'http://127.0.0.1:3000');
  });

  // เครื่องจริง 9 ต.ค. 69: รากไดรฟ์ E: ให้สิทธิ์แค่ RX (Authenticated Users) ⇒ เขียนไม่ได้
  // การเช็คสิทธิ์แบบ fs.access บน Windows ไม่จับ ACL ของโฟลเดอร์ ⇒ ต้องเขียนจริงถึงจะรู้
test('pickWritableOutDir ต้องคืนที่ที่ "เขียนไฟล์ได้จริง" (ไม่ใช่ที่ที่ผ่านแค่การเช็คสิทธิ์)', () => {
    const picked = pack.pickWritableOutDir();
    assert.ok(picked, 'ต้องหาที่สำหรับเขียนชุดติดตั้งได้');
    const probe = path.join(picked, '.write-probe-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  });

  test('★★ ทุกโมดูลที่ main.mjs import ต้องอยู่ในชุดติดตั้ง (กันลอกไฟล์ขาดแบบเงียบ)', () => {
    const files = pack.bundleFiles(ROOT);
    const mainSrc = read('sovereign-os/agent-runner/src/main.mjs');
    const imports = [...mainSrc.matchAll(/from '\.\/([\w.-]+)'/g)].map((m) => m[1]);
    assert.ok(imports.length >= 4, `main.mjs ควร import โมดูลภายในอย่างน้อย 4 ตัว (เจอ ${imports.join(', ')})`);
    assert.ok(imports.includes('control.mjs') && imports.includes('hub-control.mjs'), 'main.mjs ต้อง import ช่องควบคุม');
    for (const mod of imports) {
      assert.ok(files.includes(`src/${mod}`), `ชุดติดตั้งขาด src/${mod} — runner จะ crash`);
    }
    for (const need of ['setup-machine.mjs', 'SETUP-MACHINE.cmd', 'package.json', '.env.example']) {
      assert.ok(files.includes(need), `ชุดติดตั้งขาด ${need}`);
    }
    assert.ok(files.includes('src/runner.mjs') && files.includes('src/screenshot.mjs'));
  });

  test('buildEnvFile เขียนคีย์ครบ รวมช่องควบคุม + ขอบเขตไฟล์ (กันเปิดทั้งไดรฟ์โดยไม่ตั้งใจ)', () => {
    const text = setup.buildEnvFile({
      hubUrl: 'http://192.168.1.102:3000',
      token: 'tok-xyz',
      machineName: 'คอมเครื่องที่ 2',
      fsRoots: ['C:\\Users\\com', 'E:\\'],
    });
    assert.match(text, /^HUB_URL=http:\/\/192\.168\.1\.102:3000$/m);
    assert.match(text, /^MACHINE_TOKEN=tok-xyz$/m);
    assert.match(text, /^MACHINE_NAME=คอมเครื่องที่ 2$/m);
    assert.match(text, /^ENABLE_REMOTE_CONTROL=true$/m);
    assert.match(text, /^REMOTE_MAX_WIDTH=1280$/m);
    assert.match(text, /^REMOTE_FS_ROOTS=C:\\Users\\com;E:\\$/m);
    assert.ok(text.includes('\r\n'), 'ไฟล์ env บน Windows ควรเป็น CRLF');
  });

  test('START-HERE ต้องไม่มี token หลุด (คนอ่านไฟล์นี้ ไม่ควรเห็นความลับ)', () => {
    const txt = pack.renderStartHere({ machineName: 'คอมเครื่องที่ 2', hubUrl: 'http://192.168.1.102:3000' });
    assert.match(txt, /SETUP-MACHINE\.cmd/);
    assert.match(txt, /192\.168\.1\.102:3000/);
    assert.doesNotMatch(txt, /tok-|MACHINE_TOKEN=/i, 'ห้ามฝัง token ลงไฟล์ที่คนอ่าน');
  });

  // เคสจริง 11/10/69: เดิมบอกแค่ "ดับเบิลคลิก SETUP-MACHINE.cmd" แต่ไฟล์อยู่ที่
  //   tools\agent-pack\SETUP-MACHINE.cmd (ลึก 2 ชั้น) → ผู้ใช้ไล่หาไม่เจอ คิดว่าชุดเสีย
  test('START-HERE ต้องบอกพาธจริงของ SETUP-MACHINE.cmd (ไม่ใช่แค่ชื่อไฟล์)', () => {
    const txt = pack.renderStartHere({ machineName: 'เครื่องที่-3', hubUrl: 'http://192.168.1.102:3000' });
    assert.match(
      txt,
      /tools\\agent-pack\\SETUP-MACHINE\.cmd/,
      'ต้องเขียนพาธเต็มที่ถูกต้อง — ไฟล์ไม่ได้อยู่ระดับบนสุด ถ้าบอกแค่ชื่อไฟล์ผู้ใช้จะหาไม่เจอ',
    );
  });
});

// ── .cmd ต้องไม่ "ปิดหน้าต่างหนี" — ของจริง 9 ต.ค. 69 ผู้ใช้ดับเบิลคลิกแล้วหน้าต่างขึ้นแวบเดียว
// หายไปโดยไม่มีข้อความอะไร ⇒ ต้องมี pause ทุกเส้นทาง + เขียน log ไว้ให้ย้อนอ่านได้
// และต้องเป็น CRLF (LF ล้วนเคยถูกใช้แล้วทำให้ cmd.exe อ่านไฟล์เพี้ยน)
describe('SETUP-MACHINE.cmd: อ่าน error ได้เสมอ', () => {
  const cmdPath = path.join(ROOT, 'tools', 'agent-pack', 'SETUP-MACHINE.cmd');
  const raw = fs.readFileSync(cmdPath);
  const text = raw.toString('utf8');

  test('เป็น CRLF ทั้งไฟล์ (ไม่มี LF เดี่ยว)', () => {
    const loneLf = text.split('\n').filter((line, i, all) => !(i === all.length - 1) && !line.endsWith('\r'));
    assert.deepEqual(loneLf, [], 'ทุกบรรทัดต้องจบด้วย CRLF');
  });

  test('มีทางออกเดียวที่ผ่าน pause — ห้าม exit /b หนีกลางทาง', () => {
    const exits = text.match(/exit\s+\/b/g) ?? [];
    assert.equal(exits.length, 1, `ต้องมี exit /b แค่จุดเดียว (เจอ ${exits.length}) — ไม่งั้นหน้าต่างปิดก่อนอ่านได้`);
    const pauseAt = text.lastIndexOf('pause');
    const exitAt = text.lastIndexOf('exit /b');
    assert.ok(pauseAt > 0 && exitAt > pauseAt, 'pause ต้องอยู่ก่อน exit เสมอ');
    assert.match(text, /:end\b/, 'มี label :end ให้ทุกเส้นทางกระโดดมาเจอ pause');
    assert.ok([...text.matchAll(/goto\s+:?(end|ok|failed|fail_msg|no_\w+)/g)].length >= 4, 'ทุกกรณีล้มต้อง goto ไปที่ pause');
  });

  test('เขียน setup-log.txt (ย้อนอ่านได้แม้หน้าต่างปิดไปแล้ว)', () => {
    assert.match(text, /setup-log\.txt/, 'ต้องบันทึก log ไว้ข้างไฟล์');
    assert.match(text, /where node/, 'ต้องบันทึกว่าเจอ node ไหม');
    assert.match(text, /join\.json/, 'ต้องตรวจ join.json ก่อนรัน');
  });

  // กับดักจริง: endlocal ล้างตัวแปร → exit /b %FINAL% ที่แยกบรรทัดจะได้รหัส 0 เงียบ ๆ
  // (mini2 = exit 0, mini3/mini4 = exit 1 — พิสูจน์บนเครื่องจริงแล้ว)
  test('ปิดท้ายด้วย endlocal & exit /b %FINAL% ในบรรทัดเดียว', () => {
    assert.match(text, /endlocal & exit \/b %FINAL%/, 'ต้องเป็นบรรทัดเดียว ไม่แยกบรรทัด');
    assert.doesNotMatch(text, /endlocal\r?\n/, 'ห้ามมี endlocal เดี่ยว ๆ');
  });

  test('รัน .cmd จริงบน Windows: ต้อง pause ได้ ไม่ปิดหน้าต่างหนี และรหัสออกตรงความจริง', { skip: process.platform !== 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cmd-run-'));
    try {
      fs.copyFileSync(cmdPath, path.join(dir, 'SETUP-MACHINE.cmd'));
      fs.copyFileSync(path.join(ROOT, 'tools', 'agent-pack', 'setup-machine.mjs'), path.join(dir, 'setup-machine.mjs'));
      // ไม่มี join.json ⇒ ต้องบอกชัดและจบด้วยรหัส 1 (ไม่ใช่ 0 เงียบ ๆ)
      const res = spawnSync('cmd', ['/c', path.join(dir, 'SETUP-MACHINE.cmd')], { cwd: dir, input: '', encoding: 'utf8' });
      assert.equal(res.status, 1, `ต้องออกด้วยรหัส 1 (ได้ ${res.status}) — output: ${res.stdout}`);
      assert.match(res.stdout, /join\.json/, 'ต้องบอกว่าขาด join.json');
      assert.ok(fs.existsSync(path.join(dir, 'setup-log.txt')), 'ต้องเขียน log ไว้ให้ย้อนอ่าน');
      assert.match(fs.readFileSync(path.join(dir, 'setup-log.txt'), 'utf8'), /โฟลเดอร์/, 'log ต้องมีข้อมูลพื้นฐาน');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('setup-machine: ติดตั้งที่เครื่องลูก', () => {
  const join = (over = {}) =>
    JSON.stringify({ hubUrl: 'http://192.168.1.102:3000', machineToken: 'tok-live-1', machineName: 'คอมเครื่องที่ 2', ...over });

  test('ติดตั้งครั้งแรก: เขียน .env + heartbeat ผ่าน → ok', async () => {
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const fetchImpl = fakeFetch(() => okJson(200, { status: 'ok' }));
    const exec = fakeExec();
    const out = await setup.runSetup({ dir: sandbox, fetchImpl, exec, platform: 'win32', home: 'C:\\Users\\com', skipTask: true });

    assert.equal(out.ok, true, out.report);
    const env = fs.readFileSync(path.join(sandbox, '.env'), 'utf8');
    assert.match(env, /^HUB_URL=http:\/\/192\.168\.1\.102:3000$/m);
    assert.match(env, /^MACHINE_TOKEN=tok-live-1$/m);
    assert.match(env, /^REMOTE_FS_ROOTS=C:\\Users\\com;/m, 'ต้องมีขอบเขตไฟล์ให้อัตโนมัติ');
    assert.ok(
      fetchImpl.seen.some((s) => s.url.includes('/api/agent-machines/heartbeat') && String(s.headers['x-machine-token']) === 'tok-live-1'),
      'ต้องพิสูจน์กับ HUB จริงว่า token ใช้ได้'
    );
  });

  test('ไม่มี join.json → บอกให้ชัดว่าชุดติดตั้งไม่ครบ (ไม่รายงานว่าสำเร็จ)', async () => {
    const out = await setup.runSetup({ dir: sandbox, fetchImpl: fakeFetch(() => okJson()), exec: fakeExec(), skipTask: true });
    assert.equal(out.ok, false);
    assert.match(out.report, /join\.json/);
  });

  test('HUB ต่อไม่ได้ → ล้มก่อนเขียนไฟล์ (ไม่ทิ้ง .env ครึ่ง ๆ กลาง ๆ)', async () => {
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const fetchImpl = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const out = await setup.runSetup({ dir: sandbox, fetchImpl, exec: fakeExec(), skipTask: true });
    assert.equal(out.ok, false);
    assert.equal(fs.existsSync(path.join(sandbox, '.env')), false, 'ยังต่อ HUB ไม่ได้ = ห้ามเขียน .env');
    assert.match(out.report, /HUB|3000/);
  });

  test('token ถูกปฏิเสธ (401) → ล้มพร้อมเหตุผลจริง ไม่บอกว่าออนไลน์', async () => {
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const fetchImpl = fakeFetch((url) => (url.includes('heartbeat') ? okJson(401, { error: 'invalid token' }) : okJson(200)));
    const out = await setup.runSetup({ dir: sandbox, fetchImpl, exec: fakeExec(), skipTask: true });
    assert.equal(out.ok, false);
    assert.match(out.report, /401|token/);
    assert.doesNotMatch(out.report, /ออนไลน์แล้ว/);
  });

  test('รันซ้ำด้วย token เดิม: ไม่เขียนทับ (idempotent)', async () => {
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const fetchImpl = fakeFetch(() => okJson(200));
    await setup.runSetup({ dir: sandbox, fetchImpl, exec: fakeExec(), skipTask: true });
    const first = fs.readFileSync(path.join(sandbox, '.env'), 'utf8');
    const out = await setup.runSetup({ dir: sandbox, fetchImpl, exec: fakeExec(), skipTask: true });
    assert.equal(out.ok, true);
    assert.equal(fs.readFileSync(path.join(sandbox, '.env'), 'utf8'), first, 'รันซ้ำต้องไม่แตะ .env เดิม');
  });

  test('token เก่าต่างจากของใหม่ → ไม่ทับโดยไม่สั่ง (กันเครื่องที่ใช้งานอยู่พัง)', async () => {
    fs.writeFileSync(path.join(sandbox, '.env'), 'HUB_URL=http://192.168.1.102:3000\nMACHINE_TOKEN=tok-เก่า\n', 'utf8');
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const out = await setup.runSetup({ dir: sandbox, fetchImpl: fakeFetch(() => okJson()), exec: fakeExec(), skipTask: true });
    assert.equal(out.ok, false);
    assert.match(fs.readFileSync(path.join(sandbox, '.env'), 'utf8'), /tok-เก่า/, 'ต้องไม่เขียนทับของเดิม');
    assert.match(out.report, /--force|มีอยู่แล้ว/);
  });

  test('Windows: พยายามตั้ง scheduled task และเตือนให้รัน as admin เมื่อไม่ผ่าน', async () => {
    fs.writeFileSync(path.join(sandbox, 'join.json'), join(), 'utf8');
    const exec = fakeExec({ 'schtasks /Create': { code: 1, stdout: '', stderr: 'Access is denied' } });
    const out = await setup.runSetup({ dir: sandbox, fetchImpl: fakeFetch(() => okJson()), exec, platform: 'win32', home: 'C:\\Users\\com' });
    assert.ok(exec.ran('schtasks /Create'), 'ต้องลองตั้ง task จริง');
    assert.equal(out.ok, true, 'enroll สำเร็จแล้ว = ยังนับว่าติดตั้งได้ (แค่ autostart ยังไม่ตั้ง)');
    assert.match(out.report, /administrator|ผู้ดูแลระบบ/i, 'ต้องบอกวิธีตั้ง autostart ให้สำเร็จ');
  });
});

describe('pack: dry-run ต้องไม่แตะอะไรเลย', () => {
  test('dry-run ไม่เรียกรันคำสั่ง ไม่เขียนไฟล์ แต่บอกแผน', async () => {
    const exec = fakeExec();
    const out = await pack.runPack({
      root: ROOT,
      outDir: path.join(sandbox, 'bundle'),
      name: 'คอมเครื่องที่ 2',
      hubUrl: 'http://192.168.1.102:3000',
      dryRun: true,
      exec,
    });
    assert.equal(exec.calls.length, 0, `dry-run ห้ามรันคำสั่ง: ${JSON.stringify(exec.calls)}`);
    assert.equal(fs.existsSync(path.join(sandbox, 'bundle', 'join.json')), false, 'dry-run ห้ามเขียนไฟล์');
    assert.ok(out.plan.length > 0);
    assert.match(out.report, /dry-run/);
  });

  // เครื่องจริง 9 ต.ค. 69: การแพ็กที่ล้มกลางทางทิ้งแถวเครื่องค้าง (ยังไม่เคยออนไลน์)
  // ⇒ แพ็กซ้ำต้องหมุน token ของแถวเดิมได้ ไม่สร้างแถวซ้ำ และไม่รายงานว่าชื่อซ้ำ
  test('แถวเครื่องค้าง (ไม่เคยออนไลน์) → ใช้แถวเดิม ไม่งั้นผู้ใช้จะติดชื่อซ้ำ', async () => {
    const fakeIssue = path.join(sandbox, 'issue-reuse.mjs');
    fs.writeFileSync(
      fakeIssue,
      "process.stdout.write(JSON.stringify({ id: 'm-old', name: 'คอมเครื่องที่ 2', token: 'tok-rotated', reused: true }) + '\\n');\n",
      'utf8'
    );
    const out = await pack.runPack({
      root: REPO_ROOT_TEST(),
      outDir: path.join(sandbox, 'bundle-reuse'),
      name: 'คอมเครื่องที่ 2',
      hubUrl: 'http://192.168.1.102:3000',
      issueCommand: { cmd: process.execPath, args: [fakeIssue] },
    });
    assert.equal(out.exitCode, 0, out.report);
    const join = JSON.parse(fs.readFileSync(path.join(sandbox, 'bundle-reuse', 'join.json'), 'utf8'));
    assert.equal(join.machineToken, 'tok-rotated');
    assert.match(out.report, /แถวเดิม|ยังไม่เคยออนไลน์/);
  });

  test('ชื่อเครื่องเคยออนไลน์แล้ว → หยุดพร้อมบอกให้ใช้ชื่ออื่นหรือ --force (ไม่ทับเงียบ ๆ)', async () => {
    const fakeIssue = path.join(sandbox, 'issue-conflict.mjs');
    fs.writeFileSync(
      fakeIssue,
      "process.stdout.write(JSON.stringify({ error: 'name_exists', id: 'm-live', lastHeartbeat: '2026-10-09T03:00:00.000Z' }) + '\\n');\n",
      'utf8'
    );
    const out = await pack.runPack({
      root: REPO_ROOT_TEST(),
      outDir: path.join(sandbox, 'bundle-conflict'),
      name: 'คอมเครื่องที่ 2',
      hubUrl: 'http://192.168.1.102:3000',
      issueCommand: { cmd: process.execPath, args: [fakeIssue] },
    });
    assert.equal(out.exitCode, 1);
    assert.match(out.report, /ชื่ออื่น|--force/);
    assert.equal(fs.existsSync(path.join(sandbox, 'bundle-conflict', 'join.json')), false, 'ห้ามเขียนชุดติดตั้งเมื่อ token ไม่ได้');
  });

  test('แพ็กจริง (ออก token ปลอม): ได้ join.json + ไฟล์ runner ครบ + ไม่มี .env ติดไป', async () => {
    // สคริปต์ออก token ปลอม — เลี่ยงการต่อ DB ในเทสต์
    const fakeIssue = path.join(sandbox, 'issue-fake.mjs');
    fs.writeFileSync(
      fakeIssue,
      "process.stdout.write('ไม่มีประโยชน์\\n' + JSON.stringify({ id: 'm-1', name: 'คอมเครื่องที่ 2', token: 'tok-issued-1' }) + '\\n');\n",
      'utf8'
    );
    const out = await pack.runPack({
      root: ROOT,
      outDir: path.join(sandbox, 'bundle'),
      name: 'คอมเครื่องที่ 2',
      hubUrl: 'http://192.168.1.102:3000',
      issueCommand: { cmd: process.execPath, args: [fakeIssue] },
    });

    assert.equal(out.exitCode, 0, out.report);
    const bundle = path.join(sandbox, 'bundle');
    const joinJson = JSON.parse(fs.readFileSync(path.join(bundle, 'join.json'), 'utf8'));
    assert.equal(joinJson.machineToken, 'tok-issued-1');
    assert.equal(joinJson.hubUrl, 'http://192.168.1.102:3000');
    for (const rel of ['src/main.mjs', 'src/control.mjs', 'src/screen.mjs', 'setup-machine.mjs', 'SETUP-MACHINE.cmd', 'package.json']) {
      assert.ok(fs.existsSync(path.join(bundle, rel)), `ชุดติดตั้งขาด ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(bundle, '.env')), false, 'ห้ามก็อป .env ของเครื่องเดิมไป');
    assert.doesNotMatch(out.report, /tok-issued-1/, 'ห้ามพิมพ์ token ออกหน้าจอ');
  });

  test('แพ็กจริง: เผยแพร่ชุดอัปเดตให้เครื่องลูกดึงเอง (manifest + ไฟล์ตรง hash)', async () => {
    const fakeIssue = path.join(sandbox, 'issue-fake.mjs');
    fs.writeFileSync(
      fakeIssue,
      "process.stdout.write(JSON.stringify({ id: 'm-2', name: 'ลูก 2', token: 'tok-2' }) + '\\n');\n",
      'utf8'
    );
    const updateDir = path.join(sandbox, 'agent-updates');
    const out = await pack.runPack({
      root: ROOT,
      outDir: path.join(sandbox, 'bundle2'),
      name: 'ลูก 2',
      hubUrl: 'http://192.168.1.102:3000',
      issueCommand: { cmd: process.execPath, args: [fakeIssue] },
      updateDataDir: updateDir,
    });
    assert.equal(out.exitCode, 0, out.report);
    assert.match(out.report, /เผยแพร่ชุดอัปเดต/, 'ต้องบอกว่าเผยแพร่ชุดอัปเดตแล้ว');

    const manifest = JSON.parse(fs.readFileSync(path.join(updateDir, 'manifest.json'), 'utf8'));
    assert.match(manifest.version, /^[0-9a-f]{12}$/);
    const paths = manifest.files.map((f) => f.path);
    for (const rel of ['src/main.mjs', 'src/selfUpdate.mjs', 'src/updateTrust.mjs', 'package.json', 'run-runner.cmd']) {
      assert.ok(paths.includes(rel), `ชุดอัปเดตขาด ${rel}`);
    }
    assert.equal(paths.includes('.env'), false, 'ห้ามเผยแพร่ .env');
    assert.equal(paths.includes('join.json'), false, 'ห้ามเผยแพร่ join.json (มี token ของเครื่อง)');

    // ไฟล์ที่เผยแพร่ต้องตรง hash ที่ประกาศ และเวอร์ชันต้องคำนวณจากไฟล์จริงได้เสมอ
    for (const f of manifest.files) {
      const body = fs.readFileSync(path.join(updateDir, 'files', f.path));
      assert.equal(sha256Hex(body), f.sha256, `hash ไม่ตรง: ${f.path}`);
      assert.equal(body.length, f.size);
    }
    const recomputed = computeVersionFromEntries(manifest.files.map((f) => ({ path: f.path, sha256: f.sha256 })));
    assert.equal(recomputed, manifest.version, 'เครื่องลูกคำนวณเวอร์ชันจาก manifest แล้วต้องตรงกับที่ HUB ประกาศ');
    assert.equal(manifest.signature.alg, 'ed25519');
    assert.equal(manifest.signature.keyId, TEST_KEY_ID);
    assert.equal(
      crypto.verify(null, canonicalManifestPayload(manifest), TEST_PAIR.publicKey, Buffer.from(manifest.signature.value, 'base64')),
      true,
      'manifest ที่แพ็กต้องมีลายเซ็น Ed25519 ที่ตรวจได้',
    );
  });

  test('ไม่มี private key = ไม่เขียน manifest ที่ยังไม่เซ็น (fail-closed)', () => {
    const oldKey = process.env.AGENT_UPDATE_SIGNING_KEY;
    delete process.env.AGENT_UPDATE_SIGNING_KEY;
    try {
      const updateDir = path.join(sandbox, 'agent-updates-no-key');
      assert.throws(
        () => pack.publishUpdateBundle({ root: ROOT, dataDir: updateDir, signingKeyPath: path.join(sandbox, 'missing-key.pem') }),
        /private key|signing|ไม่พบ/i,
      );
      assert.equal(fs.existsSync(path.join(updateDir, 'manifest.json')), false, 'ห้ามเหลือ manifest ที่ไม่ได้เซ็น');
    } finally {
      process.env.AGENT_UPDATE_SIGNING_KEY = oldKey;
    }
  });

  test('เผยแพร่ซ้ำ: ไฟล์ที่ถูกถอดออกจากชุดต้องหายไปจากที่ให้บริการ (ไม่ค้างเก่า)', () => {
    const updateDir = path.join(sandbox, 'agent-updates-2');
    const first = pack.publishUpdateBundle({ root: ROOT, dataDir: updateDir });
    const stale = path.join(updateDir, 'files', 'src', 'ของเก่า.mjs');
    fs.writeFileSync(stale, 'export const old = 1;\n');
    const second = pack.publishUpdateBundle({ root: ROOT, dataDir: updateDir });
    assert.equal(fs.existsSync(stale), false, 'ไฟล์ที่ไม่อยู่ในชุดใหม่ต้องถูกลบ');
    assert.equal(second.version, first.version, 'เนื้อไฟล์เดิม ⇒ เวอร์ชันเดิม (ไม่สร้างเวอร์ชันใหม่มั่ว)');
    assert.equal(JSON.parse(fs.readFileSync(path.join(updateDir, 'manifest.json'), 'utf8')).version, first.version);
  });

  test('ไฟล์ต้นทางหาย = หยุดก่อนเขียน manifest (ไม่เผยแพร่ชุดที่ไม่ครบ)', async () => {
    const fakeRoot = path.join(sandbox, 'root-broken');
    fs.mkdirSync(path.join(fakeRoot, 'sovereign-os', 'agent-runner', 'src'), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, 'sovereign-os', 'agent-runner', 'src', 'main.mjs'), 'export {};\n');
    const updateDir = path.join(sandbox, 'agent-updates-broken');
    assert.throws(() => pack.publishUpdateBundle({ root: fakeRoot, dataDir: updateDir }), /ไม่พบไฟล์ต้นทาง/);
    assert.equal(fs.existsSync(path.join(updateDir, 'manifest.json')), false);
  });
});

describe('run-runner.cmd: ตัวห่อที่ทำให้อัปเดต/ฟื้นตัวได้จริง', () => {
  const cmdPath = path.join(ROOT, 'tools', 'agent-pack', 'run-runner.cmd');
  const text = fs.readFileSync(cmdPath).toString('utf8');

  // กับดักจริง: ไฟล์ .cmd ที่เป็น LF ล้วน ทำให้ cmd.exe อ่านเพี้ยนแล้วจบก่อนถึงบรรทัดงาน
  test('เป็น CRLF ทั้งไฟล์', () => {
    assert.match(fs.readFileSync(cmdPath).toString('utf8'), /\r\n/);
    const loneLf = text.split('\n').filter((line, i, all) => !(i === all.length - 1) && !line.endsWith('\r'));
    assert.deepEqual(loneLf, [], 'ทุกบรรทัดต้องจบด้วย CRLF');
  });

  test('รู้จักรหัสออก 86 (ส่งงานต่อโปรเซสใหม่) — ห้ามสร้างตัวซ้อน', () => {
    assert.match(text, /if "%RC%"=="86" goto :done/, 'exit 86 = มีโปรเซสใหม่ทำอยู่แล้ว ต้องไม่เริ่มรอบใหม่');
    assert.match(text, /if "%RC%"=="0" goto :done/, 'exit 0 = หยุดตามสั่ง ต้องไม่เริ่มใหม่');
    assert.match(text, /:loop/, 'มีวงรอบสำหรับเริ่มใหม่เมื่อ crash');
    // ใช้ includes (ไม่ใช่ regex) — แบ็กสแลชในสตริงทดสอบเคยทำให้เขียนไฟล์ผิดเงียบ ๆ มาแล้ว
    assert.ok(text.includes('node src' + String.fromCharCode(92) + 'main.mjs'), 'คำสั่งรันจริงต้องเป็น node src\\main.mjs');
  });

  // กับดักเดียวกับ SETUP-MACHINE.cmd: endlocal แยกบรรทัดจะล้างค่า → รหัสออกเป็น 0 เงียบ ๆ
  test('ปิดท้ายด้วย endlocal & exit /b %RC% ในบรรทัดเดียว', () => {
    assert.match(text, /endlocal & exit \/b %RC%/, 'ต้องเป็นบรรทัดเดียว ไม่แยกบรรทัด');
    assert.doesNotMatch(text, /endlocal\r?\n/, 'ห้ามมี endlocal เดี่ยว ๆ');
  });
});
