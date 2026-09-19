// tools/verify/run-client-monitor-e2e.mjs
// ── E2E runner: ขับท่อ client-monitor จริงทั้งเส้น (ไม่แตะ prod :3000/:3001 และ DB ของ prod) ──
// ขั้นตอน: ปั่น Postgres ทดสอบ (docker --rm) → push schema → รัน harness (โหลด dist จริง)
// → ยิง beacon จริงด้วย UA จริง → assert ทุก state ที่สำคัญ → cleanup ครบ
// ใช้: node tools/verify/run-client-monitor-e2e.mjs
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PG_PORT = 32888;
const HARNESS_PORT = 3199;
const PG_NAME = 'sovereign-verify-pg';
const PG_PASSWORD = `verify_${Date.now().toString(36)}`; // สุ่มรอบการทดสอบ — ไม่เขียนลงไฟล์
const JWT_SECRET = `verify_jwt_${Date.now().toString(36)}`;
const DB_URL = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/sovereign_verify?schema=public`;
const TEST_PASSWORD = `Verify-${Date.now().toString(36)}!`;

const BASE = `http://127.0.0.1:${HARNESS_PORT}`;
const LINE_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 LINE/13.19.1';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WEIRD_UA = 'Gibberish/1.0 (###|||) weird-agent';

let step = 0;
function ok(name, detail = '') { console.log(`  ✅ [${++step}] ${name}${detail ? ` — ${detail}` : ''}`); }
function fail(name, detail = '') { console.error(`  ❌ [${++step}] FAIL: ${name}${detail ? ` — ${detail}` : ''}`); }

function assert(cond, name, detail = '') {
  if (cond) { ok(name, detail); return true; }
  fail(name, detail);
  throw new Error(`ASSERT-FAIL: ${name}`);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

const CORE = 'sovereign-os/core-api';

// ── เตรียมสภาพแวดล้อม ──
console.log('▶ [1/6] ปั่น Postgres ทดสอบ (ephemeral)');
try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }); } catch {} // กันชื่อชนจากรอบก่อน
execFileSync('docker', ['run', '--rm', '-d', '--name', PG_NAME,
  '-e', 'POSTGRES_PASSWORD=' + PG_PASSWORD,
  '-e', 'POSTGRES_DB=sovereign_verify',
  '-p', `127.0.0.1:${PG_PORT}:5432`, 'postgres:16'], { stdio: 'pipe' });
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    execFileSync('docker', ['exec', PG_NAME, 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
    ready = true; break;
  } catch { await sleep(1000); }
}
if (!ready) { fail('Postgres ทดสอบไม่พร้อมใน 30 วิ'); process.exit(1); }
ok('Postgres ทดสอบพร้อม', `port ${PG_PORT}`);

console.log('▶ [2/6] push schema (prisma db push)');
execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
  { cwd: CORE, stdio: 'pipe', env: { ...process.env, DATABASE_URL: DB_URL }, shell: process.platform === 'win32' });
ok('schema push สำเร็จ');

console.log('▶ [3/6] รัน harness (โหลด dist จริงของโค้ดใหม่)');
const harness = spawn('node', ['tools/verify/client-monitor-harness.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    HARNESS_PORT: String(HARNESS_PORT),
    HARNESS_JWT_SECRET: JWT_SECRET,
    HARNESS_DATABASE_URL: DB_URL,
    HARNESS_TEST_PASSWORD: TEST_PASSWORD,
  },
});
let harnessLog = '';
harness.stdout.on('data', (d) => { harnessLog += d.toString(); });
harness.stderr.on('data', (d) => { harnessLog += d.toString(); });

let harnessReady = false;
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetchJson(`${BASE}/api/health`);
    if (r.status === 200) { harnessReady = true; break; }
  } catch { await sleep(500); }
}
if (!harnessReady) {
  fail('harness ไม่ขึ้น', harnessLog.slice(-500));
  harness.kill();
  execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' });
  process.exit(1);
}
ok('harness พร้อม (dist จริง + stub telegram)', harnessLog.includes('HARNESS-SEEDED') ? 'seed user แล้ว' : '');

try {
  // ── ขั้น A: beacon จาก LINE WebView (threshold alert ครบ 3) ──
  console.log('▶ [4/6] ขับท่อจริง: beacon → 204 → DB → aggregate');
  const beaconBody = JSON.stringify({
    kind: 'js',
    message: 'Cannot read properties of undefined (reading id:42)',
    stack: 'TypeError\n    at shop.tsx:1:2',
    source: 'http://localhost:3000/_next/static/chunks/pages/shop-abc123.js',
    line: 7, column: 99, page: '/shop',
  });
  for (let i = 1; i <= 3; i++) {
    const r = await fetchJson(`${BASE}/api/client-monitor/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': LINE_IOS_UA },
      body: beaconBody,
    });
    assert(r.status === 204, `beacon ครั้งที่ ${i} ตอบ 204 (fire-and-forget)`, `status=${r.status}`);
    await sleep(120); // ให้ async report เขียน DB ทัน
  }

  // fetch fail จาก Chrome ปกติ (กลุ่มอื่น)
  await fetchJson(`${BASE}/api/client-monitor/error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
    body: JSON.stringify({ kind: 'fetch', message: 'fetch failed: TypeError failed to fetch http://x/y', page: '/dashboard' }),
  });
  await sleep(150);

  // ── ตรวจ SecurityEvent เข้าจริง (ผ่าน DB ของ harness — ทางอ้อมผ่าน client-health) ──
  const seedUser = await fetchJson(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
    body: JSON.stringify({ username: 'verify-admin', password: TEST_PASSWORD }),
  });
  assert(seedUser.status === 200 && seedUser.body?.token, 'login จริงผ่าน /api/auth/login ได้ token (mfa-less user)');
  const token = seedUser.body.token;

  const healthRes = await fetchJson(`${BASE}/api/system/client-health?days=7`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(healthRes.status === 200, 'GET /api/system/client-health 200 (authenticate จริง)');
  const s = healthRes.body;
  assert(s.total === 4, 'aggregate นับรวม 4 events', `total=${s.total}`);
  assert(s.byBrowser[0]?.key === 'LINE WebView', 'browser อันดับ 1 = LINE WebView (จำแนกจาก UA จริง)', JSON.stringify(s.byBrowser));
  assert(s.byPage.some((x) => x.key === '/shop') && s.byPage.some((x) => x.key === '/dashboard'), 'หน้า /shop + /dashboard ถูกนับ');
  assert(s.byKind.some((x) => x.key === 'js') && s.byKind.some((x) => x.key === 'fetch'), 'kind js+fetch ถูกเก็บ (บั๊ก normalize ที่แก้ไปได้ผลจริง)');
  assert(s.webviewCount === 3, 'webviewCount = 3 (LINE UA ตรวจพบ)', `webview=${s.webviewCount}`);
  assert(Array.isArray(s.daily) && s.daily.length === 7 && s.daily[6].count === 4, 'กราฟรายวัน 7 วัน + วันนี้นับ 4');
  assert(s.topErrors.some((e) => e.message.includes('Cannot read properties of undefined')), 'topErrors มี error จริง');

  // ── ขั้น B: threshold alert — error ที่ 3 ของกลุ่มเดียวกันต้องยิง Telegram (stub) ──
  console.log('▶ [5/6] threshold alert + rate limit + UA แปลก');
  const state = await fetchJson(`${BASE}/__verify/state`);
  assert(Array.isArray(state.body.alerts) && state.body.alerts.length === 1, 'Telegram alert ยิง 1 ครั้งพอดี (ครบ threshold 3)', `alerts=${state.body.alerts.length}`);
  assert(state.body.alerts[0].includes('LINE WebView') && state.body.alerts[0].includes('/shop'), 'ข้อความ alert ระบุ browser + หน้าที่พัง');

  // beacon ซ้ำอีก 2 (dedup ของ dispatcher ไม่ให้ยิงซ้ำใน window)
  await fetchJson(`${BASE}/api/client-monitor/error`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': LINE_IOS_UA }, body: beaconBody });
  await fetchJson(`${BASE}/api/client-monitor/error`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': LINE_IOS_UA }, body: beaconBody });
  await sleep(200);
  const state2 = await fetchJson(`${BASE}/__verify/state`);
  assert(state2.body.alerts.length === 1, 'error ซ้ำใน window ไม่ยิง alert ซ้ำ (dedup รวมกับ threshold ทำงานร่วมกันถูกต้อง)');

  // UA แปลก + payload ว่าง + ตัวอักษรประหลาด — ต้องไม่ crash และตอบ 204
  const weird = await fetchJson(`${BASE}/api/client-monitor/error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': WEIRD_UA },
    body: JSON.stringify({ kind: 'promise', message: null, stack: { evil: true }, page: '../etc/passwd' }),
  });
  assert(weird.status === 204, 'payload พิลึก/UA แปลก ไม่ crash — ยังตอบ 204');

  // ── ขั้น C: rate limit 30/min → ตัวที่ 40 ต้องโดน 429 ──
  await fetchJson(`${BASE}/__verify/reset`, { method: 'POST' }); // เคลียร์นับ + rate bucket ก่อนวัดเพดานพอดี
  let got429 = false;
  for (let i = 0; i < 35; i++) {
    const r = await fetchJson(`${BASE}/api/client-monitor/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
      body: JSON.stringify({ kind: 'resource', message: `rate probe ${i}`, page: '/' }),
    });
    if (r.status === 429) { got429 = true; break; }
  }
  assert(got429, 'rate limit ทำงาน (โดน 429 เมื่อยิงเกินเพดาน)');

  // ── ขั้น D: ลบทิ้ง → dashboard ต้องกลับมา 0 (reset ทำงาน) ──
  await sleep(600); // ให้ fire-and-forget writes ค้าง ๆ จบก่อน (กัน late write แทรกหลัง delete)
  await fetchJson(`${BASE}/__verify/reset`, { method: 'POST' });
  const after = await fetchJson(`${BASE}/api/system/client-health?days=7`, { headers: { Authorization: `Bearer ${token}` } });
  await sleep(300); // ให้ delete เองก็ flush จบ
  assert(after.body.total === 0, 'reset แล้ว dashboard กลับมา 0');
  ok('ท่อครบทุกขั้น — จบ 6/6 ขั้น');

} catch (err) {
  fail('พังระหว่างขับท่อ', err?.message || String(err));
  console.error('harness log (tail):', harnessLog.slice(-1200));
  process.exitCode = 1;
} finally {
  harness.kill();
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }); } catch {}
}

if (process.exitCode === 1) process.exit(1);
console.log('\n✅ E2E client-monitor ผ่านครบ — ท่อจริงเดินสมบูรณ์');
