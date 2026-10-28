#!/usr/bin/env node
/* ── ติดตั้งที่เครื่องลูก: "ชุดทั้งโปรเจ็ก" ต้องทำงานได้จริง ─────────────────────────
   ของจริงที่เจอตอนออกแบบ (25/10/69): ชุด --full วาง setup-machine.mjs ไว้ที่
   tools\agent-pack\ แต่ join.json อยู่รากชุด และ runner อยู่ sovereign-os\agent-runner\
   ⇒ ตัวติดตั้งหา join.json ไม่เจอ และ scheduled task ชี้ไปที่ src\main.mjs ที่ไม่มีอยู่

   เทสต์ชุดนี้ล็อกว่า:
   1) หา join.json/install-plan.json จากรากชุดได้ แม้ถูกเรียกจาก tools\agent-pack
   2) เขียน .env ที่โฟลเดอร์ของ runner จริง (ที่เดียวที่ runner อ่าน)
   3) ตั้ง autostart ให้ชี้ไฟล์ที่ "มีอยู่จริง" (สร้าง launcher ให้ถ้ายังไม่มี)
   4) อ่านแผนติดตั้ง → เขียน ENABLED_MODULES/PARENT_NAME ลง infra/.env ของ stack
      โดยไม่แตะคีย์อื่น และไม่เขียนอะไรเลยถ้าไม่มีแผน
   5) โปรไฟล์เครื่อง (MACHINE-PROFILE.txt/json) ถูกเขียนที่รากชุด — เปิดดูแล้วรู้ว่าลูกของใคร
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** ที่พักชั่วคราวบนไดรฟ์โปรเจ็กเท่านั้น (AGENTS.md ข้อ 7) */
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');

const setup = await import('../agent-pack/setup-machine.mjs');
const { buildInstallPlan } = await import('../agent-pack/install-plan.mjs');

function fakeFetch(status = 200) {
  const seen = [];
  const impl = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} });
    return { status, ok: status < 400, json: async () => ({ ok: true }) };
  };
  impl.seen = seen;
  return impl;
}

function fakeExec() {
  const calls = [];
  const impl = async (bin, args) => {
    calls.push({ bin, args });
    return { code: 0, stdout: '', stderr: '' };
  };
  impl.calls = calls;
  return impl;
}

/** ชุดติดตั้งแบบ --full: join ที่ราก · ตัวติดตั้งอยู่ tools/agent-pack · runner อยู่ sovereign-os/agent-runner */
function fullKitSandbox({ plan = true, infraEnv = null } = {}) {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'setup-full-'));
  const toolsDir = path.join(root, 'tools', 'agent-pack');
  const runnerDir = path.join(root, 'sovereign-os', 'agent-runner');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(path.join(runnerDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(runnerDir, 'src', 'main.mjs'), '// runner ที่มีอยู่จริง\n', 'utf8');
  fs.writeFileSync(
    path.join(root, 'join.json'),
    JSON.stringify({ hubUrl: 'http://192.168.1.101:3000', machineToken: 'tok-full-1', machineName: 'เครื่องที่-4' }),
    'utf8',
  );
  if (plan) {
    const p = buildInstallPlan({
      machineName: 'เครื่องที่-4',
      hubUrl: 'http://192.168.1.101:3000',
      parent: { id: 'u-1', username: 'krisakorn' },
      modules: ['core', 'iot', 'kids', 'farm'],
      createdAt: '2026-10-25T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(root, 'install-plan.json'), JSON.stringify(p, null, 2), 'utf8');
  }
  if (infraEnv !== null) {
    const infra = path.join(root, 'sovereign-os', 'infra');
    fs.mkdirSync(infra, { recursive: true });
    fs.writeFileSync(path.join(infra, '.env'), infraEnv, 'utf8');
  }
  return { root, toolsDir, runnerDir };
}

describe('setup-machine ในชุด --full (join ที่ราก, ตัวติดตั้งลึก 2 ชั้น)', () => {
  test('หา join.json จากรากชุดได้ + heartbeat ผ่าน', async () => {
    const box = fullKitSandbox();
    try {
      const fetchImpl = fakeFetch();
      const out = await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl,
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      assert.equal(out.ok, true, out.report);
      assert.ok(fetchImpl.seen.some((s) => s.url.includes('/heartbeat')));
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('join.json ที่มี BOM (แก้ด้วย Notepad/PowerShell 5.1) ต้องใช้ได้', async () => {
    const box = fullKitSandbox();
    try {
      const joinPath = path.join(box.root, 'join.json');
      fs.writeFileSync(joinPath, '\uFEFF' + fs.readFileSync(joinPath, 'utf8'), 'utf8');
      const fetchImpl = fakeFetch();
      const out = await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl,
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      assert.equal(out.ok, true, out.report);
      assert.ok(fetchImpl.seen.some((s) => s.url.includes('/heartbeat')));
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('.env ถูกเขียนที่โฟลเดอร์ runner (ที่เดียวที่ runner อ่าน)', async () => {
    const box = fullKitSandbox();
    try {
      await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      const env = fs.readFileSync(path.join(box.runnerDir, '.env'), 'utf8');
      assert.match(env, /^MACHINE_TOKEN=tok-full-1$/m);
      assert.equal(fs.existsSync(path.join(box.toolsDir, '.env')), false, 'ห้ามเขียน .env ผิดที่');
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  // สเปกอัปเดต 29/10/69 (D5 "ติดตั้งจบ = runner เดินทันที" + ซ่อนหน้าต่างตอนล็อกอิน):
  // /TR ไม่ชี้ .cmd ตรง ๆ แล้ว — ชี้ RUN-START.vbs (wscript) ซึ่งเปิด RUN-RUNNER.cmd แบบไม่เด้งหน้าต่าง
  // เจตนาเดิมคงอยู่: task ต้องชี้ไฟล์ห่อที่มีอยู่จริงในโฟลเดอร์ runner ไม่ใช่ node ดิบ ๆ
  test('autostart ชี้ไฟล์ห่อที่มีอยู่จริง (task → wscript+vbs → launcher ครบทั้งสาย)', async () => {
    const box = fullKitSandbox();
    try {
      const exec = fakeExec();
      await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec,
        platform: 'win32',
        home: 'C:\\Users\\com',
        log: () => {},
      });
      const task = exec.calls.find((c) => c.bin === 'schtasks');
      assert.ok(task, 'ต้องตั้ง scheduled task');
      const tr = task.args[task.args.indexOf('/TR') + 1];
      assert.match(tr, /^wscript\.exe ".*RUN-START\.vbs"$/, `/TR ต้องชี้ vbs ตัวเปิดแบบไม่เด้งหน้าต่าง — ได้: ${tr}`);
      const vbsPath = path.join(box.runnerDir, 'RUN-START.vbs');
      assert.ok(fs.existsSync(vbsPath), 'vbs ตัวเปิดต้องถูกสร้างไว้จริง');
      const vbs = fs.readFileSync(vbsPath, 'utf8');
      assert.match(vbs, /RUN-RUNNER\.cmd/, 'vbs ต้องเปิด launcher (ตายแล้วฟื้นเอง) — สาย task → vbs → launcher ต้องไม่ขาด');
      assert.ok(fs.existsSync(path.join(box.runnerDir, 'RUN-RUNNER.cmd')), 'launcher ต้องถูกสร้างไว้จริง');
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });
});

describe('แผนติดตั้งฝั่งเครื่องลูก: บอกว่าเป็นลูกของใคร + เปิดโมดูลจริง', () => {
  test('เขียน MACHINE-PROFILE.txt/json ที่รากชุด และรายงานชื่อเครื่องแม่', async () => {
    const box = fullKitSandbox();
    try {
      const out = await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      assert.equal(out.ok, true, out.report);
      const text = fs.readFileSync(path.join(box.root, 'MACHINE-PROFILE.txt'), 'utf8');
      assert.match(text, /krisakorn/);
      assert.match(text, /192\.168\.1\.101:3000/);
      assert.match(text, /เลี้ยงดูลูก/);
      const json = JSON.parse(fs.readFileSync(path.join(box.root, 'machine-profile.json'), 'utf8'));
      assert.equal(json.parent.username, 'krisakorn');
      assert.deepEqual(json.modules, ['core', 'iot', 'kids', 'farm']);
      assert.match(out.report, /krisakorn/, 'หน้าจอต้องบอกว่าเครื่องนี้เป็นลูกของใคร');
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('มี infra/.env = เปิด ENABLED_MODULES + PARENT_NAME โดยค่าอื่นอยู่ครบ', async () => {
    const box = fullKitSandbox({ infraEnv: 'DATABASE_URL=postgres://x\nENABLED_MODULES=inventory\nJWT_SECRET=abc\n' });
    try {
      await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      const env = fs.readFileSync(path.join(box.root, 'sovereign-os', 'infra', '.env'), 'utf8');
      assert.match(env, /^DATABASE_URL=postgres:\/\/x$/m);
      assert.match(env, /^JWT_SECRET=abc$/m);
      assert.match(env, /^ENABLED_MODULES=farm$/m);
      assert.match(env, /^PARENT_NAME=krisakorn$/m);
      assert.doesNotMatch(env, /ENABLED_MODULES=inventory/);
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('ไม่มี infra/.env = ไม่สร้างมั่ว แต่บอกว่ายังไม่ได้ตั้ง stack', async () => {
    const box = fullKitSandbox();
    try {
      const out = await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      assert.equal(out.ok, true, out.report);
      assert.equal(
        fs.existsSync(path.join(box.root, 'sovereign-os', 'infra', '.env')),
        false,
        'ห้ามสร้าง infra/.env เอง (secrets ต้องมาจาก setup-first-time)',
      );
      const step = out.steps.find((s) => s.name === 'modules');
      assert.ok(step, 'ต้องมีขั้น modules ให้เห็น');
      assert.equal(step.status, 'warn');
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('ชุดเก่า (ไม่มี install-plan) = ยังติดตั้งได้ แต่บอกว่าไม่ได้เลือกฟังก์ชั่น', async () => {
    const box = fullKitSandbox({ plan: false });
    try {
      const out = await setup.runSetup({
        dir: box.toolsDir,
        fetchImpl: fakeFetch(),
        exec: fakeExec(),
        platform: 'win32',
        home: 'C:\\Users\\com',
        skipTask: true,
        log: () => {},
      });
      assert.equal(out.ok, true, out.report);
      assert.equal(fs.existsSync(path.join(box.root, 'machine-profile.json')), false);
      assert.ok(out.steps.some((s) => s.name === 'modules' && s.status === 'skipped'));
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });
});
