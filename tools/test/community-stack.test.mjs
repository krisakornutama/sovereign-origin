// tools/test/community-stack.test.mjs
//
// ── Phase 1: แพ็ก Sovereign OS เป็น Pure Software (docker compose คำสั่งเดียว) ──
// ตรวจสัญญา 3 อย่างที่พังเงียบไม่ได้:
//   1. compose มีครบ 5 service และ "ไม่มี bind mount ของซอร์ส" (ต้องรันบนเครื่องใครก็ได้)
//   2. ลำดับบูตถูก: db healthy → migrate จบสำเร็จ → api healthy → web
//   3. image ที่ใช้ build ได้จริง: Next 16 ต้องการ Node >= 20.9 (Dockerfile เดิมเป็น 18 = build ล้ม)
//   4. CSP ฝั่งเบราว์เซอร์ต้องอนุญาต API host ที่ตั้งผ่าน NEXT_PUBLIC_API_URL
//      (ไม่งั้น deploy บน Raspberry Pi แล้วเปิดจากเครื่องอื่น = หน้าเว็บเรียก API ไม่ได้)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const COMPOSE = 'deploy/community/docker-compose.yml';

// ── 1. compose ครบชุด + พอร์ตตาราง ─────────────────────────────────────────
test('community compose มี service ครบ: db, mqtt, migrate, api, web', () => {
  assert.ok(existsSync(join(ROOT, COMPOSE)), `ไม่พบ ${COMPOSE}`);
  const src = read(COMPOSE);
  for (const svc of ['db', 'mqtt', 'migrate', 'api', 'web']) {
    assert.match(src, new RegExp(`^  ${svc}:\\s*$`, 'm'), `ขาด service "${svc}"`);
  }
});

test('compose ไม่ mount ซอร์สจาก repo (ต้องรันได้บนเครื่องที่ไม่มี checkout)', () => {
  const src = read(COMPOSE);
  const volumes = src.split('\n').filter((l) => /^\s{4,6}- .*:.*/.test(l) && !l.includes('#')); 
  const bad = volumes.filter((l) => l.includes('../../') && !l.includes('dockerfile'));
  assert.deepEqual(bad, [], 'ห้าม bind mount path ของ repo — ใช้ named volume เท่านั้น');
});

test('compose ไม่เปิดพอร์ตฐานข้อมูลออกนอกเครื่อง', () => {
  const src = read(COMPOSE);
  assert.doesNotMatch(src, /5432:5432/, 'DB ต้องไม่ publish พอร์ต');
});

test('ลำดับบูต: api รอ migrate จบสำเร็จ + db healthy', () => {
  const src = read(COMPOSE);
  assert.match(src, /condition:\s*service_completed_successfully/);
  assert.match(src, /condition:\s*service_healthy/);
});

test('service ที่ต้องอยู่ยาวใช้ restart: unless-stopped (migrate เป็นงานครั้งเดียว)', () => {
  const src = read(COMPOSE);
  const blocks = src.split(/\n  (?=[a-z]+:\n)/);
  for (const name of ['db', 'mqtt', 'api', 'web']) {
    const block = blocks.find((b) => b.startsWith(`${name}:`));
    assert.ok(block, `ไม่พบ service ${name}`);
    assert.match(block, /restart:\s*unless-stopped/, `${name} ต้อง restart: unless-stopped`);
  }
});

// ── 2. ตัวแปรลับต้องประกาศใน .env.example ─────────────────────────────────
test('.env.example มีช่องความลับที่ compose บังคับ (ค่าเว้นว่าง)', () => {
  const env = read('deploy/community/.env.example');
  for (const key of ['POSTGRES_PASSWORD', 'EMQX_PASSWORD', 'JWT_SECRET', 'SEED_ADMIN_PASSWORD']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `ขาด ${key} ใน .env.example`);
  }
  assert.doesNotMatch(env, /^JWT_SECRET=.+$/m, 'ห้ามใส่ค่าจริงในตัวอย่าง');
});

// ── 3. Dockerfile ต้องใช้ Node ที่ Next 16 รองรับ ──────────────────────────
test('frontend Dockerfile ใช้ Node >= 20.9 (Next 16 ปฏิเสธ Node 18)', () => {
  const src = read('sovereign-frontend/Dockerfile.prod');
  assert.doesNotMatch(src, /^FROM node:18\b/m, 'node:18 build Next 16 ไม่ผ่าน — ต้องเป็น 20.9 ขึ้นไป');
  assert.match(src, /^FROM node:(20|22|24)/m);
});

test('frontend Dockerfile รับ NEXT_PUBLIC_API_URL ตอน build (deploy ต่างเครื่องต้องตั้งได้)', () => {
  const src = read('sovereign-frontend/Dockerfile.prod');
  assert.match(src, /ARG NEXT_PUBLIC_API_URL/);
  assert.match(src, /ENV NEXT_PUBLIC_API_URL/);
});

// ── 4. CSP อนุญาต API host ที่ตั้งจริง ─────────────────────────────────────
async function cspFor(apiUrl) {
  const req = createRequire(import.meta.url);
  const cfgPath = join(ROOT, 'sovereign-frontend/next.config.js');
  delete req.cache[cfgPath];
  const prev = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = apiUrl;
  try {
    const cfg = req(cfgPath);
    const groups = cfg.headers ? await cfg.headers() : [];
    const csp = groups[0]?.headers?.find((h) => h.key === 'Content-Security-Policy');
    return csp ? csp.value : '';
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prev;
    delete req.cache[cfgPath];
  }
}

test('CSP ค่าเริ่มต้นยังมี localhost:3001 (ไม่ถอยหลัง)', async () => {
  const csp = await cspFor(undefined);
  assert.match(csp || '', /connect-src[^;]*http:\/\/localhost:3001/);
});

test('CSP เติม API host จาก NEXT_PUBLIC_API_URL (http + ws) อัตโนมัติ', async () => {
  const csp = await cspFor('http://192.168.1.50:3001');
  assert.match(csp || '', /connect-src[^;]*http:\/\/192\.168\.1\.50:3001/, 'ต้องอนุญาต http ของ host ที่ตั้ง');
  assert.match(csp || '', /connect-src[^;]*ws:\/\/192\.168\.1\.50:3001/, 'ต้องอนุญาต ws ของ host เดียวกัน (alerts/machine control)');
});

// ── 5. compose syntax ผ่าน docker จริง (ถ้ามี docker ในเครื่อง) ──────────────
function composeEnv(extra = {}) {
  const env = {
    ...process.env,
    POSTGRES_PASSWORD: 'test-password',
    EMQX_PASSWORD: 'test-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    SEED_ADMIN_PASSWORD: 'adminpass1234',
    ...extra,
  };
  if (!('API_IMAGE' in extra)) delete env.API_IMAGE;
  if (!('WEB_IMAGE' in extra)) delete env.WEB_IMAGE;
  return env;
}

test('docker compose config ผ่าน (ถ้ามี docker)', (t) => {
  const r = spawnSync('docker', ['compose', '-f', COMPOSE, 'config', '--quiet'], {
    cwd: ROOT,
    env: composeEnv(),
    encoding: 'utf8',
    timeout: 120000,
  });
  if (r.error && r.error.code === 'ENOENT') {
    t.skip('ไม่มี docker ในเครื่องนี้');
    return;
  }
  assert.equal(r.status, 0, `compose config ล้ม: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
});

// ── 6. Prebuilt image: GHCR แทนการ build ในเครื่องได้ ──────────────────────
test('API_IMAGE/WEB_IMAGE เปลี่ยน image ที่รันจริง (migrate ใช้ image เดียวกับ api)', (t) => {
  const API = 'ghcr.io/krisakornutama/sovereign-origin/api:v1.2.0';
  const WEB = 'ghcr.io/krisakornutama/sovereign-origin/web:v1.2.0';
  const r = spawnSync('docker', ['compose', '-f', COMPOSE, 'config', '--format', 'json'], {
    cwd: ROOT,
    env: composeEnv({ API_IMAGE: API, WEB_IMAGE: WEB }),
    encoding: 'utf8',
    timeout: 120000,
  });
  if (r.error && r.error.code === 'ENOENT') {
    t.skip('ไม่มี docker ในเครื่องนี้');
    return;
  }
  assert.equal(r.status, 0, `compose config ล้ม: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  const cfg = JSON.parse(r.stdout);
  assert.equal(cfg.services.api.image, API, 'api ต้องใช้ image จาก API_IMAGE');
  assert.equal(cfg.services.migrate.image, API, 'migrate ต้องใช้ image เดียวกัน ไม่ใช่ build ซ้ำ');
  assert.equal(cfg.services.web.image, WEB, 'web ต้องใช้ image จาก WEB_IMAGE');
});

test('workflow เผยแพร่ GHCR: tag v*, api+web, linux/amd64+arm64', () => {
  const wf = read('.github/workflows/publish-images.yml');
  assert.match(wf, /tags:\s*\n\s*-\s*'v\*'/, 'ต้อง trigger จาก tag v*');
  assert.match(wf, /ghcr\.io/, 'ต้อง push ขึ้น GHCR');
  assert.match(wf, /packages:\s*write/, 'ต้องมีสิทธิ์ push package');
  // ตั้งแต่ b08ba90 build แยก job ต่อสถาปัตยกรรมบน runner จริง (ไม่ใช้ QEMU)
  // → platform อยู่ใน matrix (`platform: linux/amd64` / `platform: linux/arm64`) ไม่ได้อยู่ในบรรทัดเดียว
  assert.match(wf, /platform:\s*linux\/amd64/, 'ต้อง build amd64');
  assert.match(wf, /platform:\s*linux\/arm64/, 'ต้อง build arm64');
  assert.match(wf, /imagetools create/, 'ต้องรวมผลเป็น multi-arch manifest');
  assert.match(wf, /sovereign-os\/core-api\/Dockerfile\.prod/, 'ต้อง build API จาก Dockerfile.prod');
  assert.match(wf, /sovereign-frontend\/Dockerfile\.prod/, 'ต้อง build web จาก Dockerfile.prod');
});
