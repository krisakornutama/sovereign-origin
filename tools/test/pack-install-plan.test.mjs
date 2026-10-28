#!/usr/bin/env node
/* ── ตัวแพ็ก: "เลือกฟังก์ชั่น + ระบุเครื่องแม่" แล้วฝังลงชุดติดตั้ง ─────────────────
   เทสต์ชุดนี้ล็อกว่าแพ็กทำสามอย่างถูกต้อง:
   1) ส่ง --owner/--confirm-lan ไปถึงสคริปต์ออก token จริง (ไม่ใช่แค่พิมพ์ในจอ)
   2) เขียน install-plan.json ที่ **ไม่มี token** และมีฟังก์ชั่น/เจ้าของครบ
   3) เจ้าของที่ไม่มีสิทธิ์ = หยุดก่อนสร้างชุด (ไม่ปล่อยชุดที่คุมไม่ได้ออกไป)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');
const pack = await import('../agent-pack/pack.mjs');

function sandbox(name) {
  const dir = path.join(TMP_ROOT, `pack-plan-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** สคริปต์ออก token ปลอม — พิมพ์ JSON บรรทัดเดียวเหมือนของจริง */
function fakeIssuer(dir, payload) {
  const file = path.join(dir, 'issue.mjs');
  fs.writeFileSync(file, `process.stdout.write(${JSON.stringify(JSON.stringify(payload))} + '\\n');\n`, 'utf8');
  return file;
}

/** exec ปลอม: เรียกสคริปต์ปลอมด้วย node และเก็บ argv ที่ส่งไป */
function fakeExec(scriptFor = {}) {
  const calls = [];
  const impl = async (cmd, args = []) => {
    calls.push({ cmd, args });
    const script = args[0];
    if (script && fs.existsSync(script)) {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
    }
    const payload = scriptFor[path.basename(String(script))] ?? { id: 'm-1', name: 'x', token: 'tok-1' };
    return { code: 0, stdout: JSON.stringify(payload) + '\n', stderr: '' };
  };
  impl.calls = calls;
  return impl;
}

const basePack = (dir, over = {}) => ({
  root: ROOT,
  outDir: dir,
  name: 'เครื่องที่-4',
  hubUrl: 'http://192.168.1.101:3000',
  fullKit: false,
  dryRun: true,
  exec: fakeExec(),
  fetchImpl: async () => ({ status: 200, ok: true }), // hub_url gate ใหม่ (D5) — ครอบทุกเส้นทางแพ็กจริงในไฟล์นี้
  updateDataDir: path.join(dir, 'agent-updates'),
  ...over,
});

describe('runPack: เลือกฟังก์ชั่น + เครื่องแม่', () => {
  test('dry-run บอกเจ้าของและฟังก์ชั่นในแผน (ยังไม่เขียนไฟล์)', async () => {
    const dir = sandbox('dry');
    const out = await pack.runPack(basePack(dir, { modules: ['core', 'iot', 'kids'], owner: 'krisakorn', confirmLan: true }));
    assert.equal(out.exitCode, 0, out.report);
    const plan = out.plan.join('\n');
    assert.match(plan, /krisakorn/);
    assert.match(plan, /IoT/);
    assert.match(plan, /เลี้ยงดูลูก/);
    assert.equal(fs.existsSync(path.join(dir, 'install-plan.json')), false, 'dry-run ห้ามเขียนไฟล์');
  });

  test('แพ็กจริง: เขียน install-plan.json (ไม่มี token) + join.json แยกกัน', async () => {
    const dir = sandbox('real');
    const issue = fakeIssuer(dir, { id: 'm-9', name: 'เครื่องที่-4', token: 'tok-secret-9', owner: { id: 'u-1', username: 'krisakorn' }, lanConfirmed: true });
    const out = await pack.runPack(
      basePack(dir, {
        dryRun: false,
        issueCommand: { cmd: process.execPath, args: [issue] },
        modules: ['core', 'iot', 'kids', 'farm'],
        owner: 'krisakorn',
        confirmLan: true,
      }),
    );
    assert.equal(out.exitCode, 0, out.report);
    const planText = fs.readFileSync(path.join(dir, 'install-plan.json'), 'utf8');
    const plan = JSON.parse(planText);
    assert.deepEqual(plan.modules, ['core', 'iot', 'kids', 'farm']);
    assert.equal(plan.parent.username, 'krisakorn');
    assert.deepEqual(plan.enabledModules, ['farm']);
    assert.doesNotMatch(planText, /tok-secret-9/, 'install-plan ต้องไม่มี token');
    const join = JSON.parse(fs.readFileSync(path.join(dir, 'join.json'), 'utf8'));
    assert.equal(join.machineToken, 'tok-secret-9');
    assert.match(out.report, /krisakorn/);
  });

  test('ส่ง --owner / --confirm-lan ไปถึงสคริปต์ออก token', async () => {
    const dir = sandbox('args');
    const issue = fakeIssuer(dir, { id: 'm-9', name: 'เครื่องที่-4', token: 'tok-9' });
    const exec = fakeExec();
    await pack.runPack(
      basePack(dir, {
        dryRun: false,
        exec,
        issueCommand: { cmd: process.execPath, args: [issue] },
        modules: ['core'],
        owner: 'krisakorn',
        confirmLan: true,
      }),
    );
    const args = exec.calls[0].args;
    assert.ok(args.includes('--owner=krisakorn'), `ต้องส่ง --owner — ได้: ${args.join(' ')}`);
    assert.ok(args.includes('--confirm-lan'), 'ต้องส่ง --confirm-lan เมื่อสั่งยืนยัน');
  });

  test('ไม่สั่งยืนยัน LAN = ไม่ส่ง --confirm-lan (ให้ผู้ใช้กดยืนยันเอง)', async () => {
    const dir = sandbox('nolan');
    const issue = fakeIssuer(dir, { id: 'm-9', name: 'เครื่องที่-4', token: 'tok-9' });
    const exec = fakeExec();
    await pack.runPack(
      basePack(dir, {
        dryRun: false,
        exec,
        issueCommand: { cmd: process.execPath, args: [issue] },
        owner: 'krisakorn',
        modules: ['core'],
      }),
    );
    assert.ok(!exec.calls[0].args.includes('--confirm-lan'));
  });

  test('เจ้าของที่ไม่มีสิทธิ์ = หยุดพร้อมรหัส owner_failed (ไม่ปล่อยชุดที่คุมไม่ได้)', async () => {
    const dir = sandbox('badowner');
    const issue = fakeIssuer(dir, { error: 'owner_not_superadmin', username: 'nongtest' });
    const out = await pack.runPack(
      basePack(dir, {
        dryRun: false,
        exec: fakeExec(),
        issueCommand: { cmd: process.execPath, args: [issue] },
        modules: ['core'],
        owner: 'nongtest',
        confirmLan: true,
      }),
    );
    assert.equal(out.exitCode, 1);
    assert.equal(out.code, 'owner_failed');
    assert.equal(fs.existsSync(path.join(dir, 'join.json')), false, 'ห้ามออกชุดเมื่อเจ้าของใช้ไม่ได้');
  });

  test('ไฟล์ที่แพ็กต้องมี ตัวติดตั้งอ่านแผนได้ครบ (install-plan.mjs/modules.mjs)', () => {
    const files = pack.bundleFiles(ROOT);
    for (const need of ['install-plan.mjs', 'modules.mjs', 'setup-machine.mjs', 'SETUP-MACHINE.cmd', 'INSTALL.cmd']) {
      assert.ok(files.includes(need), `ชุดติดตั้งขาด ${need}`);
    }
  });

  test('INSTALL.cmd อยู่รากชุดติดตั้ง (ดับเบิลคลิกไฟล์เดียว ไม่ต้องไล่เข้าโฟลเดอร์)', () => {
    const src = path.resolve(ROOT, 'tools', 'agent-pack', 'INSTALL.cmd');
    assert.ok(fs.existsSync(src), 'ต้องมี INSTALL.cmd ให้ตัวแพ็กก็อปไปรากชุด');
    const buf = fs.readFileSync(src);
    const text = buf.toString('utf8');
    assert.ok(text.includes('\r\n'), 'ต้องเป็น CRLF');
    assert.match(text.split(/\r?\n/)[0], /chcp 65001/, 'บรรทัดแรกต้องตั้ง codepage ก่อนข้อความไทย');
    assert.match(text, /pause/, 'ต้อง pause ก่อนปิดหน้าต่าง');
  });
});
