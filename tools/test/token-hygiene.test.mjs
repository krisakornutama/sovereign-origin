#!/usr/bin/env node
/* เทสสุขอนามัยของ token (PAGES_TOKEN) ในเส้นทาง publish — รันออฟไลน์ ไม่แตะ GitHub จริง
   สัญญา:
     1. URL แบบเก่าที่ฝัง token (legacy) ถูกใช้ได้ แต่เมื่อ git ล้ม ห้ามมี token หลุดลง log
        ทั้งจาก script เอง และจาก error ของ Node ที่พิมพ์ command ทั้งแถว (Basic auth / URL)
     2. โหมด CI ใหม่: token เดินทางทาง env → ใช้ http.extraheader ไม่ฝังใน URL
        publish ต้องสำเร็จจริง และ token ต้องไม่ปรากฏใน stdout/stderr และไม่ถูกเขียนลง .git/config
   วิธี: sandbox ที่ portfolio/ ไม่มี .git → findPublishRepo ต้องหาไม่เจอ → บังคับเข้า branch
   "โหมด CI clone" จริง ๆ (ต่างจาก hook-contract ที่วิ่ง sameDir) · publish repo จำลองด้วย
   bare repo ท้องถิ่น (clone ล้มได้ตามต้องการด้วยพอร์ตตาย / push สำเร็จได้ด้วย file transport)
   ใช้: node --test tools/test/   (หรือ npm run test:tools) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'github_pat_11AAAAAAA0secretsecretsecretsecretsecret';

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
  });
});

/* sandbox ที่ portfolio/ ไม่มี .git (ไม่ init repo ใน site) — เพื่อให้ publish ต้องเดิน
   เส้นทาง "โหมด CI: clone จาก PUBLISH_REPO_URL" ที่ต้องการทดสอบ */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-hygiene-'));
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(TOOLS, 'publish-portfolio.mjs'), path.join(dir, 'tools', 'publish-portfolio.mjs'));
  fs.copyFileSync(path.join(TOOLS, 'indexnow-notify.mjs'), path.join(dir, 'tools', 'indexnow-notify.mjs'));

  const site = path.join(dir, 'portfolio');
  fs.mkdirSync(path.join(site, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>v1</body></html>\n');
  fs.writeFileSync(path.join(site, 'README.md'), 'old readme\n');

  const bare = path.join(dir, 'origin.git'); // publish repo จำลอง (clone ได้ push ได้ผ่าน file transport)
  return { dir, site, bare };
}

async function initRepos(sb) {
  await run('git', ['init', '--bare', '--initial-branch=main', sb.bare]);
  await run('git', ['-C', sb.dir, 'init']); // monorepo ปลอม (identity/sha)
  await run('git', ['-C', sb.dir, 'config', 'user.name', 'Sandbox Mono']);
  await run('git', ['-C', sb.dir, 'config', 'user.email', 'mono@example.test']);
  await run('git', ['-C', sb.dir, 'add', '-A']);
  await run('git', ['-C', sb.dir, 'commit', '-m', 'mono v1']);
}

const noSecret = (s) => !s.includes(SECRET) && !s.includes('secretsecretsecret');

/* ── 1. legacy URL (token ฝังใน URL) + clone ล้มแน่ ๆ (พอร์ตตาย) → token ห้ามโผล่ใน log ── */
test('legacy token-in-URL: failed git command must never leak the secret', async (t) => {
  const sb = sandbox();
  await initRepos(sb);

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=token hygiene: legacy leak'], {
    cwd: sb.dir,
    env: {
      ...process.env,
      SOVEREIGN_NOTIFIER: path.join(sb.dir, 'tools', 'does-not-exist.mjs'),
      PUBLISH_REPO_URL: `https://x-access-token:${SECRET}@127.0.0.1:9/krisakornutama/project-sovereign.git`,
    },
  });

  assert.notEqual(r.code, 0, 'clone ไปพอร์ตตายต้องล้ม (เคสตั้งใจ)');
  assert.ok(noSecret(r.stdout), `stdout ห้ามมี token\n---\n${r.stdout}`);
  assert.ok(noSecret(r.stderr), `stderr ห้ามมี token (รวม error ของ Node ที่พิมพ์ command ทั้งแถว)\n---\n${r.stderr}`);
  assert.match(r.stderr + r.stdout, /clone publish repo ไม่สำเร็จ/, 'ต้องมีข้อความ error ที่อ่านได้ (ผ่าน sanitizer)');
});

/* ── 2. โหมด CI ใหม่: token ทาง env (extraheader) → publish สำเร็จ · token เงียบสนิท ──
   publish repo = bare ท้องถิ่นผ่าน file transport: clone/push ไม่พึ่งเน็ต และ extraheader
   (scope https://github.com/) ไม่มีผลกับ file transport — จึงพิสูจน์ได้ว่าของขึ้นจริง
   ด้วย "ความเงียบ" ของ token ล้วน ๆ ไม่ใช่เพราะ transport เดาฉลาด */
test('CI mode with env token: publish lands via clone+push, secret never appears', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed via env-token publish\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=token hygiene: env token'], {
    cwd: sb.dir,
    env: {
      ...process.env,
      SOVEREIGN_NOTIFIER: path.join(sb.dir, 'tools', 'does-not-exist.mjs'),
      PUBLISH_REPO_URL: sb.bare, // file transport — clone จาก bare ท้องถิ่น
      PAGES_TOKEN: SECRET,
    },
  });

  assert.equal(r.code, 0, `publish ต้องผ่าน\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  assert.match(r.stdout, /CI mode: clone/, 'ต้องเดินเส้นทาง clone ของโหมด CI จริง');
  assert.ok(noSecret(r.stdout) && noSecret(r.stderr), 'token ห้ามปรากฏใน log แม้บรรทัดเดียว');

  const log = await run('git', ['-C', sb.bare, 'log', '--format=%s', 'main']);
  assert.match(log.stdout, /token hygiene: env token/, 'publish ต้องขึ้น publish repo จริง (clone → commit → push)');

  const cfg = await run('git', ['-C', path.join(sb.dir, '.publish-tmp'), 'config', '--local', '--list']);
  assert.ok(noSecret(cfg.stdout), 'token ห้ามถูกเขียนลง .git/config ของ clone ชั่วคราว');
});
