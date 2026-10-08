#!/usr/bin/env node
/* ── ตัวติดตั้งครั้งเดียวของ "ทั้งโปรเจ็ก" (ไม่ใช่แค่ runner) ─────────────────────
   สัญญาที่เทสต์ชุดนี้ล็อกไว้ (เขียนก่อนโค้ด ⇒ ต้องแดงก่อน):

   1) รันซ้ำต้องไม่ทำระบบเดิมพัง — โดยเฉพาะ **รหัสผ่านฐานข้อมูลเดิม**
      ถ้าตัวติดตั้งสุ่มรหัสใหม่ทับ .env เดิม = Postgres ที่มีข้อมูลอยู่เริ่มไม่ได้
      (ข้อมูลผู้ใช้ทั้งระบบหาย) ⇒ เทสต์ข้อนี้สำคัญที่สุดของไฟล์นี้
   2) placeholder `__GEN_*__` ต้องถูกแทนจนไม่เหลือ และพาธ env ทุกไฟล์ต้องถูกสร้าง
      ครบทั้งโปรเจ็ก (infra · core-api · frontend · agent-runner) ไม่ใช่แค่ส่วน runner
   3) `.env` ของ runner ต้องมีคีย์ครบตามที่ main.mjs อ่านจริง (กันเอกสาร/โค้ด drift)
      รวมช่องควบคุมระยะไกล (ENABLE_REMOTE_CONTROL / REMOTE_MAX_WIDTH / REMOTE_FS_ROOTS)
   4) HUB_URL ที่ชี้ IP ใน LAN แต่พอร์ต :3001 ต้องถูกปฏิเสธตั้งแต่ก่อนเขียนไฟล์
      (บั๊กจริง 7 ต.ค. 69: ติดตั้ง "สำเร็จ" แต่ runner ต่อ HUB ไม่ได้เลย)
   5) scheduled task ต้องไม่ล้มเงียบเมื่อพาธมีเว้นวรรค — ใช้ launcher ที่ cd จาก %~dp0
      และต้องตรวจสอบกับ schtasks ย้อนหลัง ไม่เชื่อแค่ exit code
   6) --dry-run ต้องไม่เขียนไฟล์และไม่รันคำสั่งใด ๆ เลย
   7) ขั้นใดล้มเหลว → exit ไม่ใช่ 0 + บอกขั้นถัดไปที่ต้องทำ (ไม่ใช่ "เสร็จสิ้น" หลอก ๆ)
*/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const lib = await import('../install/lib.mjs');
const install = await import('../install/install.mjs');

/** ที่พักชั่วคราวต้องอยู่บนไดรฟ์โปรเจ็กเท่านั้น (AGENTS.md ข้อ 7) */
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');
const newSandbox = () => fs.mkdtempSync(path.join(TMP_ROOT, 'install-test-'));

let sandbox;
beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = newSandbox();
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** โครงขั้นต่ำของโปรเจ็กใน sandbox — พอให้ตัวติดตั้งยืนยันได้ว่า "นี่คือรากโปรเจ็ก" */
function seedSkeleton() {
  fs.mkdirSync(path.join(sandbox, 'sovereign-os', 'infra'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'sovereign-os', 'infra', 'docker-compose.yml'), 'services:\n  timescaledb:\n    image: x\n', 'utf8');
  fs.mkdirSync(path.join(sandbox, 'sovereign-os', 'agent-runner'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'sovereign-os', 'agent-runner', 'package.json'), '{"name":"x"}', 'utf8');
}

/** ผู้อ่าน env แบบเดียวกับที่ runner ใช้จริง (main.mjs) — ใช้เทียบว่าเขียนครบ */
function envKeysReadByRunner() {
  const src = read('sovereign-os/agent-runner/src/main.mjs');
  return [...new Set([...src.matchAll(/\benv\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
}

const TEMPLATE = read('tools/install/sovereign.env.template');

// ─────────────────────────────────────────────────────────────────────────────
describe('lib: env + secret (รันซ้ำต้องไม่ทำของเดิมพัง)', () => {
  test('สร้าง secret ครบทุกคีย์ที่ template ต้องใช้ และเป็น hex', () => {
    const secrets = lib.generateSecrets();
    for (const key of lib.SECRET_KEYS) {
      assert.match(secrets[key], /^[0-9a-f]{16,}$/, `${key} ต้องเป็น hex ยาวพอ`);
    }
  });

  test('ไม่มี placeholder __GEN_ เหลือหลังแทนค่า', () => {
    const text = lib.buildInfraEnv({ templateText: TEMPLATE, secrets: lib.generateSecrets() }).text;
    assert.ok(!/__GEN_[A-Z0-9_]+__/.test(text), 'placeholder ต้องถูกแทนครบ');
    for (const key of lib.SECRET_KEYS) assert.match(text, new RegExp(`^${key}=\\S+`, 'm'));
  });

  test('★★ รันครั้งที่สอง: รหัสผ่านฐานข้อมูลเดิมต้องไม่เปลี่ยน (ไม่งั้น DB ที่มีข้อมูลเริ่มไม่ได้)', () => {
    const first = lib.buildInfraEnv({ templateText: TEMPLATE, secrets: lib.generateSecrets() }).text;
    const second = lib.buildInfraEnv({ templateText: TEMPLATE, existingText: first, secrets: lib.generateSecrets() });
    assert.equal(second.text, first, 'ไฟล์ที่ผู้ใช้ตั้งค่าไว้แล้วต้องไม่ถูกเขียนทับ');
    assert.deepEqual(second.changed, [], 'ไม่ควรมีคีย์ที่ถูกเปลี่ยน');
  });

  test('--force: สุ่มชุดใหม่จริง แต่ต้องบอกว่าอะไรถูกเปลี่ยน (ให้ผู้ใช้สำรองก่อน)', () => {
    const first = lib.buildInfraEnv({ templateText: TEMPLATE, secrets: lib.generateSecrets() }).text;
    const forced = lib.buildInfraEnv({
      templateText: TEMPLATE,
      existingText: first,
      secrets: lib.generateSecrets(),
      force: true,
    });
    assert.notEqual(forced.text, first);
    assert.ok(forced.changed.includes('POSTGRES_PASSWORD'), 'ต้องรายงานคีย์ที่ถูกเปลี่ยน');
  });

  test('ค่าที่ผู้ใช้ตั้งเอง (Telegram/UPS) ต้องรอดจากการรันซ้ำ', () => {
    const first = lib.buildInfraEnv({ templateText: TEMPLATE, secrets: lib.generateSecrets() }).text;
    const edited = lib.upsertEnv(first, [['TELEGRAM_BOT_TOKEN', 'tok-123'], ['UPS_ENABLED', 'true']]);
    const second = lib.buildInfraEnv({ templateText: TEMPLATE, existingText: edited, secrets: lib.generateSecrets() }).text;
    assert.match(second, /^TELEGRAM_BOT_TOKEN=tok-123$/m);
    assert.match(second, /^UPS_ENABLED=true$/m);
  });

  test('เดิมเป็นคีย์ว่าง (เช่น POSTGRES_PASSWORD=) → ซ่อมให้ ไม่ปล่อยผ่าน', () => {
    const broken = 'POSTGRES_USER=sovereign\nPOSTGRES_PASSWORD=\nPOSTGRES_DB=sovereign_v2\n';
    const out = lib.buildInfraEnv({ templateText: broken, existingText: broken, secrets: lib.generateSecrets() }).text;
    assert.match(out, /^POSTGRES_PASSWORD=[0-9a-f]{16,}$/m, 'คีย์ว่างต้องถูกเติม ไม่ใช่คงไว้');
  });
});

describe('lib: upsertEnv', () => {
  test('อัปเดตคีย์เดิมในที่เดิม · เพิ่มคีย์ที่ขาด · ไม่แตะคอมเมนต์', () => {
    const before = '# หัวไฟล์\nA=1\n# คอมเมนต์กลาง\nB=2\n';
    const after = lib.upsertEnv(before, [['B', '9'], ['C', '3']]);
    assert.equal(after, '# หัวไฟล์\nA=1\n# คอมเมนต์กลาง\nB=9\nC=3\n');
  });

  test('คีย์ที่ซ้ำกันอยู่แล้วต้องไม่กลายเป็นสองบรรทัด', () => {
    const after = lib.upsertEnv('A=1\nA=2\n', [['A', '3']]);
    assert.equal(after.match(/^A=/gm).length, 1, 'ต้องเหลือคีย์เดียว');
    assert.match(after, /^A=3$/m);
  });
});

describe('lib: env ของทุกชั้นในโปรเจ็ก', () => {
  test('core-api: DATABASE_URL ใช้รหัสเดียวกับ infra และชี้ localhost:5432', () => {
    const infra = lib.buildInfraEnv({ templateText: TEMPLATE, secrets: lib.generateSecrets() }).text;
    const core = lib.buildCoreApiEnv({ infraText: infra }).text;
    const pgPass = lib.parseEnv(infra).POSTGRES_PASSWORD;
    assert.match(core, new RegExp(`^DATABASE_URL=postgresql://sovereign:${pgPass}@localhost:5432/`, 'm'));
    assert.equal(lib.parseEnv(core).JWT_SECRET, lib.parseEnv(infra).JWT_SECRET, 'JWT_SECRET ต้องตรงกับ container');
  });

  test('frontend: NEXT_PUBLIC_API_URL ถูกเขียนและรันซ้ำไม่ซ้ำบรรทัด', () => {
    const first = lib.buildFrontendEnv({ apiUrl: 'http://localhost:3001' }).text;
    const second = lib.buildFrontendEnv({ apiUrl: 'http://localhost:3001', existingText: first }).text;
    assert.equal(second, first);
    assert.equal(lib.parseEnv(second).NEXT_PUBLIC_API_URL, 'http://localhost:3001');
  });

  test('runner: .env ต้องมีคีย์ครบตามที่ main.mjs อ่านจริง', () => {
    const out = lib.buildRunnerEnv({
      hubUrl: 'http://127.0.0.1:3001',
      token: 'tok',
      name: 'hub-เครื่องนี้',
      executors: 'echo,opencode',
    }).text;
    const parsed = lib.parseEnv(out);
    for (const key of envKeysReadByRunner()) {
      assert.ok(key in parsed, `main.mjs อ่าน env.${key} แต่ .env ที่ตัวติดตั้งเขียนไม่มีคีย์นี้`);
    }
    assert.equal(parsed.ENABLE_REMOTE_CONTROL, 'true', 'ช่องดูจอ/ควบคุมต้องเปิดตั้งแต่ติดตั้ง (เหตุผลที่ลง runner)');
    assert.equal(parsed.REMOTE_MAX_WIDTH, '1280');
  });

  test('runner: ค่าที่ผู้ใช้ตั้งไว้แล้ว (token/ชื่อเครื่อง) ต้องไม่ถูกทับ', () => {
    const first = lib.buildRunnerEnv({ hubUrl: 'http://127.0.0.1:3001', token: 'of-mine', name: 'เครื่อง-2' }).text;
    const second = lib.buildRunnerEnv({
      hubUrl: 'http://127.0.0.1:3001',
      token: 'จากธง',
      name: 'จากธง',
      existingText: first,
    }).text;
    assert.equal(lib.parseEnv(second).MACHINE_TOKEN, 'of-mine');
    assert.equal(lib.parseEnv(second).MACHINE_NAME, 'เครื่อง-2');
  });
});

describe('lib: HUB_URL — กันบั๊กพอร์ตที่ทำให้ "ติดตั้งสำเร็จแต่ใช้งานไม่ได้"', () => {
  test('ปฏิเสธ IP ใน LAN ที่พอร์ต 3001 (API ผูก loopback เท่านั้น)', () => {
    assert.throws(() => lib.assertHubUrl('http://192.168.1.5:3001'), /3000/);
    assert.throws(() => lib.assertHubUrl('http://10.0.0.7:3001'), /3000/);
  });

  test('ยอมรับ loopback:3001 (เครื่องเดียวกัน) และ IP ใน LAN ที่ :3000', () => {
    assert.equal(lib.assertHubUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
    assert.equal(lib.assertHubUrl('http://192.168.1.5:3000'), 'http://192.168.1.5:3000');
    assert.equal(lib.assertHubUrl('http://192.168.1.5:3000/'), 'http://192.168.1.5:3000', 'ตัด / ท้ายให้');
  });
});

describe('lib: scheduled task ที่ไม่ล้มเงียบเมื่อพาธมีเว้นวรรค', () => {
  test('launcher ใช้ %~dp0 จึงไม่ขึ้นกับพาธที่มีเว้นวรรค และอ้าง quote ครบ', () => {
    const dir = 'E:\\My work\\Project Sovereign Origin\\sovereign-os\\agent-runner';
    const out = lib.buildRunnerLauncher({ runnerDir: dir, nodeExe: process.execPath });
    assert.match(out.text, /cd \/d "%~dp0"/);
    assert.match(out.text, /main\.mjs/);
    assert.equal(out.path, path.join(dir, 'run-runner.cmd'));
  });

  test('pathHasSpace ตรวจได้จริง', () => {
    assert.equal(lib.pathHasSpace('E:\\My work\\x'), true);
    assert.equal(lib.pathHasSpace('E:\\plain\\x'), false);
  });

  test('ตรวจสอบย้อนหลัง: อ่านผล /Query แล้วบอกได้ว่า task มีจริง + คำสั่งตรง', () => {
    const query = [
      'FolderName:   \\',
      'TaskName:     \\Sovereign Agent Runner',
      'Task To Run:  E:\\My work\\Project Sovereign Origin\\sovereign-os\\agent-runner\\run-runner.cmd',
      'Status:       Ready',
    ].join('\r\n');
    const parsed = lib.parseSchtasksQuery(query);
    assert.equal(parsed.exists, true);
    assert.match(parsed.taskToRun, /run-runner\.cmd/);
    assert.equal(lib.parseSchtasksQuery('ERROR: The system cannot find the file specified.').exists, false);
  });

  test('คำสั่งลงทะเบียนต้องอ้าง launcher ของโฟลเดอร์นั้น ไม่ใช่ node ตรง ๆ (กันพาธดิบ)', () => {
    const args = lib.buildRunnerTaskCreateArgs({
      taskName: 'Sovereign Agent Runner',
      launcherPath: 'E:\\My work\\x\\run-runner.cmd',
    });
    assert.deepEqual(args.slice(0, 4), ['schtasks', '/Create', '/TN', 'Sovereign Agent Runner']);
    const tr = args[args.indexOf('/TR') + 1];
    assert.match(tr, /^".*run-runner\.cmd"$/, 'ค่า /TR ต้องถูก quote ทั้งก้อน');
    assert.ok(args.includes('/F'), 'รันซ้ำต้องทับ task เดิมได้ ไม่พัง');
  });
});

describe('lib: redact + สรุปผล', () => {
  test('redactSecrets ปิดทุกคีย์ที่ชื่อฟ้องว่าเป็นความลับ — รวมของที่ผู้ใช้ใส่เองใน .env เดิม', () => {
    const text = [
      'POSTGRES_USER=sovereign',
      'POSTGRES_PASSWORD=deadbeefdeadbeef',
      'JWT_SECRET=cafebabecafebabe',
      'TELEGRAM_BOT_TOKEN=tok-123',
      'DIME_IMAP_PASS=app password ของผู้ใช้',
      'DIME_PDF_PASSWORD=23042003',
      'DIME_IMAP_USER=someone@gmail.com',
      '',
    ].join('\n');
    const out = lib.redactSecrets(text);
    assert.ok(!out.includes('deadbeef'), 'รหัสผ่านต้องถูกปิด');
    assert.ok(!out.includes('cafebabe'), 'JWT ต้องถูกปิด');
    assert.ok(!out.includes('app password ของผู้ใช้'), 'รหัสแอปของผู้ใช้ต้องถูกปิด (เคยหลุดจริง)');
    assert.ok(!out.includes('23042003'), 'รหัสไฟล์ PDF ต้องถูกปิด');
    assert.match(out, /^POSTGRES_PASSWORD=\*\*\*$/m);
    assert.match(out, /^TELEGRAM_BOT_TOKEN=\*\*\*$/m);
    assert.match(out, /^POSTGRES_USER=sovereign$/m, 'ค่าที่ไม่ใช่ความลับต้องเห็นได้ (ผู้ใช้ต้องตรวจได้)');
  });

  test('ค่ารหัสผ่านที่ฝังใน URL (DATABASE_URL) ต้องถูกปิดด้วย — ไม่ใช่แค่คีย์ที่ชื่อฟ้อง (หลุดจริง 8 ต.ค.)', () => {
    const text = [
      'DATABASE_URL=postgresql://sovereign:topsecret99@localhost:5432/sovereign',
      'POSTGRES_USER=sovereign',
      '',
    ].join('\n');
    const out = lib.redactSecrets(text);
    assert.ok(!out.includes('topsecret99'), 'รหัสผ่านที่ฝังใน URL ต้องถูกปิด');
    assert.match(out, /postgresql:\/\/sovereign:\*\*\*@localhost:5432/);
    assert.match(out, /^POSTGRES_USER=sovereign$/m, 'ค่าที่ไม่ใช่ความลับต้องเห็นได้');
  });

  test('มีขั้นล้มเหลว → exit 1 + บอกขั้นถัดไป · ครบทุกขั้น → exit 0', () => {
    const bad = lib.summarizeSteps([
      { name: 'env', status: 'ok' },
      { name: 'stack', status: 'fail', detail: 'compose up ล้ม', nextAction: 'เปิด Docker Desktop' },
      { name: 'runner', status: 'skipped' },
    ]);
    assert.equal(bad.exitCode, 1);
    assert.deepEqual(bad.failed, ['stack']);
    assert.match(bad.nextActions.join('\n'), /เปิด Docker Desktop/);

    const good = lib.summarizeSteps([{ name: 'env', status: 'ok' }, { name: 'runner', status: 'skipped' }]);
    assert.equal(good.exitCode, 0);
    assert.deepEqual(good.nextActions, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orchestration: ขับทั้งขั้นตอนด้วยคำสั่งปลอม ⇒ พิสูจน์ลำดับ/การรันซ้ำ/การไม่ลงมือ
// ─────────────────────────────────────────────────────────────────────────────

/** exec ปลอม: บันทึกคำสั่ง แล้วตอบตามที่เทสต์กำหนด */
function fakeExec(handler = () => ({ code: 0, stdout: '', stderr: '' })) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, args = [], opts = {}) => {
      calls.push({ cmd, args, opts });
      return handler(cmd, args, opts, calls);
    },
    /** ดูว่ามีคำสั่งนี้ถูกเรียกไหม (เทียบแบบ prefix) */
    ran(fragment) {
      return calls.some((c) => [c.cmd, ...(c.args || [])].join(' ').includes(fragment));
    },
  };
}

function okExec() {
  let registered = '';
  return fakeExec((cmd, args = []) => {
    if (['node', 'docker', 'npm'].includes(cmd) && args[0] === '--version') return { code: 0, stdout: 'v24.0.0', stderr: '' };
    if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') return { code: 0, stdout: 'v2.30.0', stderr: '' };
    if (cmd === 'docker' && args[0] === 'info') return { code: 0, stdout: 'Server: ok', stderr: '' };
    if (cmd === 'schtasks' && args[0] === '/Create') {
      registered = args[args.indexOf('/TR') + 1] ?? '';
      return { code: 0, stdout: 'SUCCESS', stderr: '' };
    }
    if (cmd === 'schtasks' && args[0] === '/Query') {
      if (!registered) return { code: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
      return {
        code: 0,
        stdout: 'FolderName:   \\\\r\nTaskName:     \\Sovereign Agent Runner\r\nTask To Run:  ' + registered + '\r\nStatus:       Ready\r\n',
        stderr: '',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
}

const healthyFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: 'ok' }),
  text: async () => 'ok',
  __url: url,
});

/** HUB ปลอมสำหรับการตรวจสุขภาพ — /api/health 200, เส้นที่ต้อง auth ตอบ 401 */
function fakeFetch(overrides = {}) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET' });
    const key = Object.keys(overrides).find((k) => String(url).includes(k));
    if (key) return overrides[key](String(url), init);
    return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => 'ok' };
  };
  impl.seen = seen;
  return impl;
}

const baseFlags = (extra = {}) => ({
  root: sandbox,
  noFrontend: true,
  withRunner: false,
  skipDeps: true,
  executors: 'echo',
  ...extra,
});

test('--dry-run: ไม่เขียนไฟล์ และไม่รันคำสั่งใด ๆ เลย', async () => {
  const exec = okExec();
  const out = await install.runInstall({
    ...baseFlags({ dryRun: true }),
    exec: exec.exec,
    fetchImpl: fakeFetch(),
  });

  assert.equal(exec.calls.length, 0, `dry-run ห้ามรันคำสั่ง: ${JSON.stringify(exec.calls)}`);
  assert.deepEqual(fs.readdirSync(sandbox), [], 'dry-run ห้ามเขียนไฟล์');
  assert.ok(out.plan.some((s) => s.name === 'env'), 'ต้องเห็นแผนขั้นตอน');
  assert.match(out.report, /dry-run/, 'ต้องบอกชัดว่าไม่ได้ลงมือ');
});

test('ติดตั้งจริง (คำสั่งปลอม): เขียน env ครบทุกชั้น + ลงทะเบียน task + ตรวจสุขภาพ', async () => {
  seedSkeleton();
  const exec = okExec();
  const fetchImpl = fakeFetch();
  const out = await install.runInstall({
    ...baseFlags({ withRunner: true, machineToken: 'tok-abc', machineName: 'เครื่องนี้' }),
    exec: exec.exec,
    fetchImpl,
  });

  // env ของทุกชั้นถูกสร้าง
  for (const rel of [
    'sovereign-os/infra/.env',
    'sovereign-os/core-api/.env',
    'sovereign-os/agent-runner/.env',
    'sovereign-os/agent-runner/run-runner.cmd',
  ]) {
    assert.ok(fs.existsSync(path.join(sandbox, rel)), `ต้องสร้าง ${rel}`);
  }
  const runnerEnv = lib.parseEnv(fs.readFileSync(path.join(sandbox, 'sovereign-os/agent-runner/.env'), 'utf8'));
  assert.equal(runnerEnv.MACHINE_TOKEN, 'tok-abc');
  assert.equal(runnerEnv.ENABLE_REMOTE_CONTROL, 'true');

  assert.ok(exec.ran('compose'), 'ต้องสั่ง compose up');
  assert.ok(exec.ran('schtasks /Create'), 'ต้องลงทะเบียน scheduled task');
  assert.ok(exec.ran('schtasks /Query'), 'ต้องตรวจ task ย้อนหลัง ไม่เชื่อแค่ exit code');
  assert.ok(fetchImpl.seen.some((s) => s.url.includes('/api/health')), 'ต้องตรวจสุขภาพ API จริง');
  assert.equal(out.exitCode, 0, out.report);
});

test('รันซ้ำ: รหัสผ่านเดิมไม่เปลี่ยน และไม่สร้างไฟล์ซ้ำ', async () => {
  seedSkeleton();
  const first = await install.runInstall({ ...baseFlags(), exec: okExec().exec, fetchImpl: fakeFetch() });
  assert.equal(first.exitCode, 0);
  const infraBefore = fs.readFileSync(path.join(sandbox, 'sovereign-os/infra/.env'), 'utf8');

  const second = await install.runInstall({ ...baseFlags(), exec: okExec().exec, fetchImpl: fakeFetch() });
  assert.equal(second.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(sandbox, 'sovereign-os/infra/.env'), 'utf8'), infraBefore, 'รันซ้ำต้องไม่แตะ .env เดิม');
});

test('docker ไม่รัน → ปิดที่ขั้น stack พร้อมบอกวิธีแก้ ไม่รายงานว่าเสร็จ', async () => {
  seedSkeleton();
  const exec = fakeExec((cmd, args = []) => {
    if (cmd === 'docker' && args[0] === 'info') return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
    if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') return { code: 0, stdout: 'v2', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  const out = await install.runInstall({ ...baseFlags(), exec: exec.exec, fetchImpl: fakeFetch() });

  assert.equal(out.exitCode, 1);
  assert.ok(out.failed.includes('stack'), `ต้องรายงานว่าขั้น stack ล้ม: ${JSON.stringify(out.failed)}`);
  assert.match(out.report, /Docker Desktop/, 'ต้องบอกขั้นถัดไปที่ทำได้จริง');
  assert.ok(!exec.ran('compose up'), 'Docker ใช้ไม่ได้ = ห้ามยิง compose up');
});

test('พอร์ต :3001 ที่เป็น IP ใน LAN → หยุดก่อนเขียนไฟล์ (บั๊กเดิม)', async () => {
  seedSkeleton();
  const exec = okExec();
  const out = await install.runInstall({
    ...baseFlags({ hubUrl: 'http://192.168.1.5:3001', withRunner: true }),
    exec: exec.exec,
    fetchImpl: fakeFetch(),
  });
  assert.equal(out.exitCode, 1);
  assert.match(out.report, /3000/, 'ต้องบอกพอร์ตที่ใช้ได้จริง');
  assert.ok(
    !fs.existsSync(path.join(sandbox, 'sovereign-os/agent-runner/.env')),
    'ห้ามเขียน HUB_URL ที่รู้ว่าใช้ไม่ได้ลงไฟล์'
  );
});

test('--verify-only: ตรวจอย่างเดียว ไม่แตะ env/ไม่สั่ง compose', async () => {
  const exec = okExec();
  const out = await install.runInstall({
    ...baseFlags({ verifyOnly: true }),
    exec: exec.exec,
    fetchImpl: fakeFetch(),
  });
  assert.deepEqual(fs.readdirSync(sandbox), [], 'verify-only ห้ามเขียนไฟล์');
  assert.ok(!exec.ran('compose up'));
  assert.ok(exec.calls.length >= 0);
});

test('API ตอบไม่ปกติ → ขั้น verify ล้มพร้อมเหตุผลจริง', async () => {
  const out = await install.runInstall({
    ...baseFlags({ verifyOnly: true }),
    exec: okExec().exec,
    fetchImpl: fakeFetch({ '/api/health': () => ({ ok: false, status: 503, text: async () => 'not ready' }) }),
  });
  assert.equal(out.exitCode, 1);
  assert.ok(out.failed.includes('verify'));
  assert.match(out.report, /503|api\/health/);
});

test('env ของ runner ที่มีอยู่แล้วแต่ผู้ใช้ยังไม่ใส่ token → เตือน ไม่รายงานว่าเสร็จ', async () => {
  seedSkeleton();
  const out = await install.runInstall({
    ...baseFlags({ withRunner: true }),
    exec: okExec().exec,
    fetchImpl: fakeFetch(),
  });
  assert.equal(out.exitCode, 1, 'ไม่มี token = runner ต่อ HUB ไม่ได้ ต้องไม่บอกว่าเสร็จ');
  assert.ok(out.failed.includes('runner'));
  assert.match(out.report, /agent-queue|ลงทะเบียน/, 'ต้องบอกว่าขอ token ได้ที่ไหน');
});
