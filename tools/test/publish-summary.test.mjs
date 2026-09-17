#!/usr/bin/env node
/* เทสสัญญาของ job summary ที่ publish-portfolio เขียนท้ายรอบ (หน้าสรุปรอบ run ใน GitHub Actions)
   สัญญา:
     1. publish สำเร็จ → ต้องมีบล็อกสรุปที่ระบุ publish sha + monorepo sha + จำนวนไฟล์ + ผล IndexNow
     2. ไม่มีอะไรจะ publish (no-op) → ต้องมีสรุปบอกเหตุผล และ exit 0
     3. ตัวยิง IndexNow ล้ม → สรุปต้องบอกว่ายิงล้ม แต่ publish ยังขึ้นจริง (สรุปไม่มีวันทำ publish ล้ม)
   วิธี: sandbox เดียวกับ hook-contract.test.mjs (publish repo + bare origin จำลอง)
   และชี้ GITHUB_STEP_SUMMARY ไปที่ไฟล์ชั่วคราว — นอก runner สคริปต์ต้องข้ามการเขียนเงียบ ๆ
   ใช้: node --test tools/test/   (หรือ npm run test:tools) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
  });
});

/* ── sandbox: เหมือน hook-contract — publish repo (portfolio/) + bare origin + monorepo ปลอม ── */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-summary-'));
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(TOOLS, 'publish-portfolio.mjs'), path.join(dir, 'tools', 'publish-portfolio.mjs'));
  fs.copyFileSync(path.join(TOOLS, 'indexnow-notify.mjs'), path.join(dir, 'tools', 'indexnow-notify.mjs'));

  const site = path.join(dir, 'portfolio');
  fs.mkdirSync(path.join(site, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>v1</body></html>\n');
  fs.writeFileSync(path.join(site, 'README.md'), 'old readme\n');

  const bare = path.join(dir, 'origin.git');
  return { dir, site, bare };
}

async function initRepos(sb) {
  const git = (cwd, ...a) => run('git', ['-C', cwd, ...a]);
  await run('git', ['init', '--bare', sb.bare]);
  await git(sb.site, 'init');
  await git(sb.site, 'config', 'user.name', 'Sandbox');
  await git(sb.site, 'config', 'user.email', 'sandbox@example.test');
  await git(sb.site, 'add', '-A');
  await git(sb.site, 'commit', '-m', 'site v1');
  await git(sb.site, 'remote', 'add', 'origin', sb.bare);
  await git(sb.site, 'branch', '-M', 'main');
  await git(sb.site, 'push', '-q', 'origin', 'main');
  await run('git', ['-C', sb.dir, 'init']);
  await run('git', ['-C', sb.dir, 'config', 'user.name', 'Sandbox Mono']);
  await run('git', ['-C', sb.dir, 'config', 'user.email', 'mono@example.test']);
  await run('git', ['-C', sb.dir, 'add', '-A']);
  await run('git', ['-C', sb.dir, 'commit', '-m', 'mono v1']);
}

const summaryEnv = () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'summary-out-')), 'summary.md');
  return { file: f, env: { GITHUB_STEP_SUMMARY: f } };
};

test('successful publish writes a summary with shas, file count and IndexNow result', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const { file, env } = summaryEnv();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed for summary\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=summary contract: success'], {
    cwd: sb.dir,
    env: { ...process.env, ...env },
  });
  assert.equal(r.code, 0, `publish ต้องผ่าน\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);

  const sum = fs.readFileSync(file, 'utf8');
  assert.match(sum, /## Deploy portfolio — publish/);
  assert.match(sum, /publish commit: `[0-9a-f]+`/, 'ต้องระบุ publish sha');
  assert.match(sum, /monorepo: `[0-9a-f]+`/, 'ต้องระบุ monorepo sha');
  assert.match(sum, /ไฟล์ที่ sync: 1/);
  assert.match(sum, /IndexNow:/, 'ต้องรายงานผลการยิงเสมอ (ส่วนนี้ใช้ stub → ต้องเป็นฝั่งเตือน)');
  assert.match(sum, /⚠/, 'stub notifier ไม่มีจริง → ต้องเตือนในสรุป ไม่ใช่ปิดหูปิดตา');

  /* publish sha ในสรุปต้องเป็นตัวจริงบน origin ไม่ใช่ตัวเดา */
  const log = await run('git', ['-C', sb.bare, 'log', '--format=%h', 'main']);
  const shaOnOrigin = log.stdout.trim().split('\n')[0];
  assert.ok(sum.includes(`\`${shaOnOrigin}\``), `สรุปต้องอ้าง sha ที่ขึ้น origin จริง (${shaOnOrigin})\n--- summary ---\n${sum}`);
});

test('no-op publish still summarizes why nothing shipped', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const { file, env } = summaryEnv();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  /* ไม่แก้ไฟล์ใด ๆ — publish repo ตรงกับ monorepo อยู่แล้ว */

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs')], {
    cwd: sb.dir,
    env: { ...process.env, ...env },
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ไม่มีอะไรจะ publish/);

  const sum = fs.readFileSync(file, 'utf8');
  assert.match(sum, /## Deploy portfolio — publish/);
  assert.match(sum, /ไม่มีอะไรจะ publish/, 'no-op ต้องมีสรุปอธิบายเหตุผลในหน้า run');
  assert.match(sum, /monorepo: `[0-9a-f]+`/);
  assert.doesNotMatch(sum, /publish commit:/, 'no-op ต้องไม่มี publish sha ให้เข้าใจผิด');
});

test('failing notifier: summary flags the miss but publish still lands', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const { file, env } = summaryEnv();
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  const stub = path.join(sb.dir, 'tools', 'stub-failing-notifier.mjs');
  fs.writeFileSync(stub, "process.exit(3);\n");
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed, ping will fail\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=summary contract: ping failed'], {
    cwd: sb.dir,
    env: { ...process.env, ...env, SOVEREIGN_NOTIFIER: stub },
  });
  assert.equal(r.code, 0, 'ตัวยิงล้มต้องไม่ทำ publish ล้ม');

  const sum = fs.readFileSync(file, 'utf8');
  assert.match(sum, /IndexNow: ⚠ ยิงล้ม/, 'สรุปต้องไม่ปั้นแต้มให้ตัวยิงที่ล้ม');
  const log = await run('git', ['-C', sb.bare, 'log', '--format=%s', 'main']);
  assert.match(log.stdout, /summary contract: ping failed/, 'ของต้องขึ้น origin จริง');
});
