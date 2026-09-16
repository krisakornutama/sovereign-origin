#!/usr/bin/env node
/* เทสต์สัญญาของ hook publish → IndexNow (รันได้ไม่ต้องต่อเน็ต ไม่แตะ GitHub จริง)

   สัญญาที่ต้องพิสูจน์ (มาจากงานจริง: รอบแรกสคริปต์ยิงก่อน deploy เสร็จ):
     1. ไม่ยิงก่อน production เสิร์ฟเนื้อหาชุดที่ push จริง  → แล้วยิง "หลัง" เท่านั้น
     2. ตัวยิงพัง (หายไป / exit ไม่ใช่ 0) ต้องไม่ทำให้ publish ล้ม — และ publish ต้องขึ้นจริง
     3. ตัวยิงเองต้อง fail-safe: ส่งไม่สำเร็จ = exit 0 (ยกเว้น --strict)

   วิธี: จำลอง production ด้วย static server ท้องถิ่น (เนื้อหาพลิกได้กลางเทสต์),
   endpoint IndexNow ด้วย collector ที่นับ POST, และ publish repo ด้วย bare git ท้องถิ่น

   ใช้: node --test tools/test/   (หรือ npm run test:tools) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = '0123456789abcdef0123456789abcdef';

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
  });
});

const listen = (handler) => new Promise((resolve) => {
  const srv = http.createServer(handler);
  srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
});

const close = (srv) => new Promise((r) => srv.close(r));

/* ── sandbox: monorepo ปลอมที่มี tools/ + publish repo (portfolio/) + bare origin ── */
function sandbox({ withKey = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-contract-'));
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(TOOLS, 'publish-portfolio.mjs'), path.join(dir, 'tools', 'publish-portfolio.mjs'));
  fs.copyFileSync(path.join(TOOLS, 'indexnow-notify.mjs'), path.join(dir, 'tools', 'indexnow-notify.mjs'));

  const site = path.join(dir, 'portfolio');
  fs.mkdirSync(path.join(site, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>v1</body></html>\n');
  fs.writeFileSync(path.join(site, 'me.html'), '<!doctype html><html><body>me v1</body></html>\n');
  fs.writeFileSync(path.join(site, 'og.png'), 'png-bytes');
  fs.writeFileSync(path.join(site, 'README.md'), 'old readme\n');
  if (withKey) fs.writeFileSync(path.join(site, `${KEY}.txt`), KEY);

  const bare = path.join(dir, 'origin.git');
  const git = (cwd, ...a) => run('git', ['-C', cwd, ...a]);
  return { dir, site, bare, git };
}

async function initRepos(sb) {
  await run('git', ['init', '--bare', sb.bare]);
  await sb.git(sb.site, 'init');
  await sb.git(sb.site, 'config', 'user.name', 'Sandbox');
  await sb.git(sb.site, 'config', 'user.email', 'sandbox@example.test');
  await sb.git(sb.site, 'add', '-A');
  await sb.git(sb.site, 'commit', '-m', 'site v1');
  await sb.git(sb.site, 'remote', 'add', 'origin', sb.bare);
  await sb.git(sb.site, 'branch', '-M', 'main');
  await sb.git(sb.site, 'push', '-q', 'origin', 'main');
  // monorepo (ให้ publish อ่าน identity + sha ได้)
  await run('git', ['-C', sb.dir, 'init']);
  await run('git', ['-C', sb.dir, 'config', 'user.name', 'Sandbox Mono']);
  await run('git', ['-C', sb.dir, 'config', 'user.email', 'mono@example.test']);
  await run('git', ['-C', sb.dir, 'add', '-A']);
  await run('git', ['-C', sb.dir, 'commit', '-m', 'mono v1']);
}

/* ── 1. ต้องไม่ยิงก่อน production เปลี่ยน ── */
test('hook waits for production to serve the pushed content, then pings once', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const local = fs.readFileSync(path.join(sb.site, 'README.md'), 'utf8');

  /* production จำลอง: เสิร์ฟเนื้อหา "เก่า" ก่อน แล้วค่อยพลิกเป็นชุดที่ push */
  let served = 'OLD CONTENT — deploy ยังไม่เสร็จ\n';
  const prod = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(served);
  });
  const pings = [];
  const collector = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      pings.push({ at: Date.now(), url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });
  t.after(async () => { await close(prod.srv); await close(collector.srv); });

  const env = {
    ...process.env,
    INDEXNOW_BASE: `http://127.0.0.1:${prod.port}`,
    INDEXNOW_ENDPOINT: `http://127.0.0.1:${collector.port}/indexnow/`,
    INDEXNOW_HOST: 'example.test',
    INDEXNOW_POLL_MS: '120',
    INDEXNOW_POLLS: '60',
  };
  const child = run('node', [path.join(sb.dir, 'tools', 'indexnow-notify.mjs'), '--wait', '--verify-file=README.md'], { cwd: sb.dir, env });

  await new Promise((r) => setTimeout(r, 900)); // รอหลายรอบ poll ตอน production ยังเก่า
  assert.equal(pings.length, 0, 'ห้ามยิงก่อน production เสิร์ฟเนื้อหาที่ push');

  const flippedAt = Date.now();
  served = local; // deploy เสร็จ
  const res = await child;
  assert.equal(res.code, 0, `notifier ต้อง exit 0 (ได้ ${res.code})`);
  assert.equal(pings.length, 1, 'ต้องยิงครั้งเดียว หลัง production ตรงแล้ว');
  assert.ok(pings[0].at >= flippedAt, 'การยิงต้องเกิดหลังเนื้อหาบน production เปลี่ยน');
  assert.match(res.stdout, /production ตรงแล้ว/);
  assert.match(res.stdout, /HTTP 200/);

  const payload = JSON.parse(pings[0].body);
  assert.equal(payload.host, 'example.test');
  assert.equal(payload.key, KEY);
  assert.equal(payload.keyLocation, `http://127.0.0.1:${prod.port}/${KEY}.txt`);
  assert.deepEqual(payload.urlList.sort(), [`http://127.0.0.1:${prod.port}/`, `http://127.0.0.1:${prod.port}/me.html`, `http://127.0.0.1:${prod.port}/og.png`].sort());
});

/* ── 2. ตัวยิงพัง = publish ต้องไม่ล้ม และของต้องขึ้นจริง ── */
test('publish still ships when the notifier cannot run (module missing)', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed by publish\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=hook contract: missing notifier'], {
    cwd: sb.dir,
    env: { ...process.env, SOVEREIGN_NOTIFIER: path.join(sb.dir, 'tools', 'does-not-exist.mjs') },
  });
  assert.equal(r.code, 0, 'publish ต้อง exit 0 แม้ตัวยิงรันไม่ได้');
  assert.match(r.stdout, /เรียกตัวยิงไม่สำเร็จ/, 'ต้องเตือนให้รู้ว่ายิงไม่ได้');

  const log = await sb.git(sb.bare, 'log', '--format=%s', 'main');
  assert.match(log.stdout, /hook contract: missing notifier/, 'commit ต้องขึ้นถึง origin จริง');
  t.diagnostic('publish exit 0 + commit landed on origin');
});

test('publish still ships when the notifier itself exits non-zero', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const failing = path.join(sb.dir, 'tools', 'stub-failing-notifier.mjs');
  fs.writeFileSync(failing, "console.log('stub notifier: pretending the API refused'); process.exit(3);\n");
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed by publish 2\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=hook contract: failing notifier'], {
    cwd: sb.dir,
    env: { ...process.env, SOVEREIGN_NOTIFIER: failing },
  });
  assert.equal(r.code, 0, 'publish ต้อง exit 0 แม้ตัวยิงคืน exit 3');
  assert.match(r.stdout, /stub notifier: pretending the API refused/, 'ตัวยิงต้องถูกเรียกจริง');
  assert.match(r.stdout, /เรียกตัวยิงไม่สำเร็จ/);

  const log = await sb.git(sb.bare, 'log', '--format=%s', 'main');
  assert.match(log.stdout, /hook contract: failing notifier/);
});

test('a healthy notifier is invoked by publish for real', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const marker = path.join(sb.dir, 'notifier-was-called.txt');
  const stub = path.join(sb.dir, 'tools', 'stub-good-notifier.mjs');
  fs.writeFileSync(stub, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '));\n`);
  fs.writeFileSync(path.join(sb.site, 'README.md'), 'changed by publish 3\n');

  const r = await run('node', [path.join(sb.dir, 'tools', 'publish-portfolio.mjs'), '--message=hook contract: healthy notifier'], {
    cwd: sb.dir,
    env: { ...process.env, SOVEREIGN_NOTIFIER: stub },
  });
  assert.equal(r.code, 0, `publish ต้องผ่าน\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  assert.ok(fs.existsSync(marker), 'publish ต้องเรียกระบบยิงอัตโนมัติหลัง push');
  const args = fs.readFileSync(marker, 'utf8');
  assert.match(args, /--wait/);
  assert.match(args, /--expect-sha=/);
  assert.match(args, /--verify-file=README.md/, 'ต้องส่งไฟล์ที่เปลี่ยนไปให้ตัวยิงตรวจ production');
});

/* ── 3. ตัวยิงเอง fail-safe ── */
test('notifier is fail-safe by itself (bad endpoint, missing key) unless --strict', async (t) => {
  const sb = sandbox();
  await initRepos(sb);
  const broken = await listen((req, res) => { res.writeHead(500); res.end('nope'); });
  t.after(() => close(broken.srv));

  const env = { ...process.env, INDEXNOW_BASE: `http://127.0.0.1:${broken.port}`, INDEXNOW_ENDPOINT: `http://127.0.0.1:${broken.port}/indexnow/`, INDEXNOW_POLL_MS: '100' };
  const notifier = path.join(sb.dir, 'tools', 'indexnow-notify.mjs');

  const soft = await run('node', [notifier], { cwd: sb.dir, env });
  assert.equal(soft.code, 0, 'ดีฟอลต์ = ไม่ทำ publish ล้ม');
  assert.match(soft.stderr, /✗ indexnow: HTTP 500/);

  const strict = await run('node', [notifier, '--strict'], { cwd: sb.dir, env });
  assert.equal(strict.code, 1, '--strict = ให้ exit 1 เมื่อส่งไม่สำเร็จ');

  const noKey = sandbox({ withKey: false });
  await initRepos(noKey);
  const missing = await run('node', [path.join(noKey.dir, 'tools', 'indexnow-notify.mjs')], { cwd: noKey.dir, env: { ...process.env, INDEXNOW_BASE: `http://127.0.0.1:${broken.port}` } });
  assert.equal(missing.code, 0);
  assert.match(missing.stderr, /ไฟล์คีย์ IndexNow/);
});
