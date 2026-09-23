// ────────────────────────────────────────────────────────────────────────────
// verify.mjs — Quality Gate เดียวของโปรเจ็ก Sovereign Origin
// รัน: npm run verify            (build + typecheck + ทดสอบทั้ง backend/frontend)
//      npm run verify -- --db    (เพิ่มชุด real-Postgres = npm run test:db — ต้องมี Docker + container sovereign-db)
//      npm run verify:full       (เพิ่ม E2E Playwright — ต้องมี backend+DB รันอยู่)
//
// กติกา: ผ่านทุกขั้นถึงจะ commit/merge ได้ (ตาม AGENTS.md ข้อ 2)
// Phase 0: ด่านแรกของทุกโหมด = Architecture Gate (tools/arch-gate.mjs) · โหมด --e2e เพิ่ม Prod-Truth Gate
// ────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, '..', 'sovereign-frontend');
const BACKEND = join(ROOT, '..', 'sovereign-os', 'core-api');
const RUN_E2E = process.argv.includes('--e2e');
// --db = รวมชุด real-Postgres (test:db → tools/test-db-local.mjs) เข้ามาใน gate เดียวกัน
// เงื่อนไขเครื่อง: Docker + container `sovereign-db` + sovereign-os/infra/.env (ตัวรันจัดฐาน/forwarder ให้เอง)
const RUN_DB = process.argv.includes('--db');

const steps = [
  // Phase 0 (prod-truth): เช็ด dist ก่อน build ทุกครั้ง — tsc แบบ incremental ไม่ลบไฟล์ของ source ที่ถูกลบ
  // ทำให้ dist สะสมของเก่า (เคสจริง: 406 ไฟล์จากที่ควรมี 209) และ fingerprint ของ dist ไม่มีวันตรงกับ
  // ที่ prod (container) คอมไพล์จาก src ปัจจุบัน → เกต "prod รันโค้ดชุดเดียวกับดิสก์" ต้องอาศัย dist สะอาด
  { name: 'backend: clean dist (stale-output sweep)', cwd: BACKEND, cmd: 'node', args: ['-e', 'require(\'node:fs\').rmSync(\'dist\',{recursive:true,force:true})'], shell: false },
  { name: 'backend: build (tsc)',        cwd: BACKEND,  cmd: 'npm', args: ['run', 'build'] },
  { name: 'backend: test',              cwd: BACKEND,  cmd: 'npm', args: ['test'] },
  { name: 'frontend: typecheck (tsc)',   cwd: FRONTEND, cmd: 'npm', args: ['run', 'typecheck'] },
  { name: 'frontend: build (next)',      cwd: FRONTEND, cmd: 'npm', args: ['run', 'build'] },
];
if (RUN_DB) {
  // real-DB suite: สร้างฐาน sovereign_test + TCP forwarder (แก้ปัญหา WSL relay กิน startup packet) ให้เอง
  // (ROOT ของ verify = tools/ — สคริปต์ test:db ต้องรันจากราก repo)
  steps.push({ name: 'backend: real-DB suite (test:db)', cwd: join(ROOT, '..'), cmd: 'npm', args: ['run', 'test:db'] });
  // กระจกส่อง coverage (ไม่บังคับ threshold — แค่พิมพ์ตัวเลข + หลุมใหญ่ท้ายรอบ gate)
  steps.push({ name: 'backend: coverage report (no threshold)', cwd: join(ROOT, '..'), cmd: 'npm', args: ['run', 'coverage:core'] });
}
if (RUN_E2E) {
  // Prod-Truth Gate (Phase 0): พิสูจน์ว่า prod ที่รันอยู่มาจากโค้ดชุดเดียวกับดิสก์ (fingerprint เนื้อหาไฟล์)
  // — อยู่ในกลุ่ม e2e เพราะต้องรัน "หลัง build ทั้งหมด" (e2eSteps ถูกเรียกหลังสองสาย build เสร็จ)
  //   และต้องมี backend :3001 รันอยู่ (ใช้เงื่อนไข backend-alive เดียวกันกับ Playwright — backend ไม่ขึ้น = ข้ามพร้อมกัน)
  // เคสจริงที่จุดกำเนิด: prod รัน build ของ 21 ก.ย. ทั้งที่โค้ดใหม่มาแล้ว 2 วัน — ไม่มีใครรู้จนไปเจอเอง
  steps.push({ name: 'e2e: prod-truth (disk ↔ runtime fingerprint)', cwd: ROOT, cmd: 'node', args: ['prod-truth.mjs', '--dir', join(BACKEND, 'dist')], e2e: true, shell: false });
  steps.push({ name: 'e2e: Playwright (headless)', cwd: FRONTEND, cmd: 'npm', args: ['run', 'e2e'], e2e: true });
}

console.log('═══ Sovereign Quality Gate ═══');

// Phase 0: Architecture Gate — ด่านแรกของทุกโหมด (fail fast ก่อนเสียเวลา build หลายนาที)
// ตรวจ: schema-sync (postgres↔sqlite) · file-budget (เพดาน 800 บรรทัด/ไฟล์ที่เปลี่ยน)
//       env-truth (DATABASE_URL ชี้ DB ที่ connect ได้จริง) · module-boundary (report-only)
{
  const gate = spawnSync('node', [join(ROOT, 'arch-gate.mjs')], { cwd: ROOT, shell: false, stdio: 'inherit' });
  if (gate.status !== 0) {
    console.error('\n❌ Architecture Gate ล้ม — verify ไม่ดำเนินการต่อ (แก้ตามรายงานด้านบนก่อน)');
    process.exit(1);
  }
}

// Phase 2: Frontend Gate — ขยายด่านสถาปัตยกรรมคลุมฝั่ง UI (fail fast ต่อจาก arch-gate)
// ตรวจ: import-layers (pages→lib/stores/components; ui/layout ใช้ร่วมได้) · line-budget
//       (pages ≤800 / components ≤400) · sidebar-rule (ทุกหน้ามี Sidebar) — ของเดิมผ่านผ่าน baseline
{
  const fg = spawnSync('node', [join(ROOT, 'frontend-gate.mjs')], { cwd: ROOT, shell: false, stdio: 'inherit' });
  if (fg.status !== 0) {
    console.error('\n❌ Frontend Gate ล้ม — verify ไม่ดำเนินการต่อ (แก้ตามรายงานด้านบนก่อน)');
    process.exit(1);
  }
}

// next build เขียนทับ .next ที่ dev server ใช้อยู่ → dev เสี่ยง chunk พัง
// → จับ PID ของผู้ฟัง :3000 ไว้ แล้ว "กู้ dev ให้เอง" หลัง verify จบ (auto-restart)
// ข้อควรระวัง (เคสจริง 09-11): production `next start` ก็ฟัง :3000 — kill+wipe ตัว prod
// ทั้งที่ build ไม่ได้ทำอันตรายอะไร = เว็บลงฟรี ต้องแยก prod ออกจาก dev ก่อนเสมอ
function findListenerPid(port) {
  try {
    const out = spawnSync('netstat', ['-ano'], { shell: true, encoding: 'utf8' });
    for (const line of (out.stdout || '').split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const pid = parseInt(line.trim().split(/\s+/).pop(), 10);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    }
  } catch { /* ไม่มี netstat — ข้าม */ }
  return null;
}

// command line ของ PID + พ่อของมัน (Windows-only เครื่องนี้ — ตรงกับ deployment จริง)
// ต้องดูพ่อด้วย: `next dev`/`next start` มัก spawn ลูก start-server.js เป็นคนฟังพอร์ตจริง
// —  cmdline ลูกเปล่า ๆ แยกไม่ออก แต่พ่อบอกชัด (npm run dev vs next start)
function processCmdlineWithParent(pid) {
  try {
    const out = spawnSync('powershell', ['-NoProfile', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){ $pp=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; "$(($p.CommandLine))|||$(($pp.CommandLine))" }`],
      { encoding: 'utf8', timeout: 15000 });
    return (out.stdout || '').trim();
  } catch { return ''; }
}

const DEV_PORT = 3000;
const devPidBefore = findListenerPid(DEV_PORT);
// ค่าความจริง 3 สถานะ: true=prod · false=dev ชัดเจน · null=จับใจความไม่ได้ (fail-safe)
const devIsProd = (() => {
  if (!devPidBefore) return false;
  const [own = '', parent = ''] = (processCmdlineWithParent(devPidBefore) || '').split('|||');
  // ตัด quote ออกก่อน: cmdline จริงคือ ...bin\next" start -p 3000 → "next start" หาไม่เจอ
  // (พิสูจน์เคสจริง: classify ตัวแรกพลาดตรงนี้แล้ว kill prod ทั้งที่ตั้งใจ skip)
  const norm = (s) => (s || '').toLowerCase().replace(/["']/g, ' ');
  const cmd = norm(own) + ' ' + norm(parent);
  if (/\bnext\s+dev\b/.test(cmd) || /\brun\s+dev\b/.test(cmd)) return false;   // dev ชัดเจน (ตัวเองหรือพ่อ)
  if (/\bnext\s+start\b/.test(cmd) || /\brun\s+start\b/.test(cmd) || cmd.includes('start-server')) return true; // prod
  // เคสจริง 23-09: CIM query ล่มชั่วขณะ → cmdline ว่าง → เดิมตก branch นี้แล้วถูกมองเป็น dev
  // → helper kill prod + wipe .next = เว็บลงทั้งระบบ — เปลี่ยนเป็น "ไม่รู้ = ห้ามทำลาย"
  return null;
})();
if (devPidBefore) {
  console.log(devIsProd === true
    ? `ℹ️  :${DEV_PORT} มี production server serve อยู่ (PID ${devPidBefore}) — verify จะไม่แตะพอร์ต/.next ตอนท้าย`
    : devIsProd === false
      ? `ℹ️  พบ dev server บน :${DEV_PORT} (PID ${devPidBefore}) — หลัง verify จะกู้ dev ให้เอง (restart)`
      : `⚠️  :${DEV_PORT} มี server แต่ระบุชนิดไม่ได้ (cmdline อ่านไม่ได้) — โหมด fail-safe: verify จะไม่ kill/restart อะไรทั้งสิ้น`);
}

if (RUN_E2E && !existsSync(join(FRONTEND, 'node_modules', '@playwright', 'test'))) {
  console.error('❌ ยังไม่ได้ติดตั้ง @playwright/test — รัน: cd sovereign-frontend && npm install -D @playwright/test && npx playwright install chromium');
  process.exit(1);
}

const results = [];
const t0 = Date.now();

// e2e ต้องมี backend :3001 รันอยู่ (spec ชุดหลักยิง API จริง) — ถ้าลง → ข้ามพร้อมเตือน
// แทน fail ทั้ง gate (เคสจริง: รัน verify:full บนเครื่องที่เปิดแค่ frontend = pos-flow พังทั้งชุด)
// ข้อยกเว้น: มี backend จริงรันอยู่เสมอเมื่อ ENV E2E_REQUIRE_BACKEND=1 (CI ตั้งครบ)
async function backendAlive() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 3001, path: '/api/health', timeout: 2500 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// รอ server ตอบ HTTP ได้ (status ใด ๆ ก็ได้ — frontend เปิด trailingSlash: /api/health ตอบ 308,
// home ตอบ 200/308 ก็แปลว่า next start ขึ้นและ serve แล้ว) ใช้หลัง restart prod ก่อน e2e
function waitHttpAlive(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(url, { timeout: 3000 }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => retry());
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tryOnce, 2000);
    };
    tryOnce();
  });
}

// B2: รัน 4 ขั้นเป็น 2 สายขนานกัน (backend build→test ∥ frontend typecheck→build)
// — มาตรฐานเท่าเดิมทุกขั้น (ตาม AGENTS.md ข้อ 2) แต่เวลารวม = สายที่ช้าที่สุด ไม่ใช่ผลรวม
// (เคยวัด 3.6 นาทีแบบลำดับ; เป้า < 3 นาที) · OOM retry, e2e-skip, dev-restore คงเดิมหมด
// env VERIFY_SEQUENTIAL=1 = บังคับรันลำดับแบบเดิม (debug เครื่องที่แรมน้อยจริง ๆ)
async function runStep(step) {
  process.stdout.write(`▶ ${step.name} ...\n`);
  // shell ต่อสเต็ป: shell:false เมื่อ arg มีช่องว่าง (path มี "My work") — Windows shell จะตัดคำผิด
  const run = () => spawnSync(step.cmd, step.args, { cwd: step.cwd, shell: step.shell !== false, stdio: 'pipe', encoding: 'utf8' });
  let r = run();
  // exit 134 = build worker ตายแบบ native OOM (Zone Allocation) — พบจริงเมื่อแรม/commit charge ของเครื่อง
  // ต่ำ (prod server + docker รันคู่กัน) · ไม่ใช่บั๊กโค้ด (CI บน GitHub แรมโล่งผ่านเสมอ) → พักแล้วลองใหม่ 2 ครั้ง
  for (let retry = 1; r.status === 134 && retry <= 2; retry++) {
    console.log(`   ${step.name}: พังชั่วคราว (exit 134 — OOM) → พัก 20 วิ แล้วลองใหม่ (${retry}/2)`);
    await new Promise((res) => setTimeout(res, 20_000));
    r = run();
  }
  // Flake guard: เทสชุดใหญ่ (1249 เคส) บางครั้งโหลดชนกับ build อีกสาย → fail แบบไม่มี message
  // (เคสจริง: featureGrants 23/9, treasuryApi 24/9 — รันซ้ำเดี่ยวผ่านทั้งคู่ · ตอน nightly โหลดหนักพิเศษ)
  // กติกา: ขั้น test พัง → พัก 15 วิ รันใหม่ 1 ครั้ง — เทสจริงพัง = ล้ม 2 ครั้งติด ไม่ใช่การโกงเกต
  if (r.status !== 0 && /test/.test(step.name)) {
    console.log(`   ${step.name}: พัง (exit ${r.status}) → flake guard: พัก 15 วิ รันใหม่ 1 ครั้ง (เทสจริงพังต้องล้ม 2 ครั้งติด)`);
    await new Promise((res) => setTimeout(res, 15_000));
    r = run();
  }
  return r;
}

const e2eSteps = steps.filter((s) => s.e2e);
const coreSteps = steps.filter((s) => !s.e2e);

if (process.env.VERIFY_SEQUENTIAL === '1') {
  for (const step of steps) {
    if (step.e2e) {
      const alive = process.env.E2E_REQUIRE_BACKEND === '1' || (await backendAlive());
      if (!alive) {
        results.push({ name: step.name, ok: true, skipped: true });
        console.log(`⚠️  ข้าม (backend :3001 ไม่ได้รัน — เปิด backend แล้วรันใหม่ หรือตั้ง E2E_REQUIRE_BACKEND=1 เพื่อบังคับ)`);
        continue;
      }
    }
    const r = await runStep(step);
    const ok = r.status === 0;
    results.push({ name: step.name, ok });
    console.log(ok ? `▶ ${step.name}: ผ่าน` : `▶ ${step.name}: พัง (exit ${r.status})`);
    if (!ok) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n');
      console.error(out.slice(-30).join('\n'));
      console.error(`\n❌ ล้มเหลวที่ขั้น: ${step.name} — แก้ให้ผ่านก่อน commit (กฎ AGENTS.md ข้อ 2)`);
      process.exit(1);
    }
  }
} else {
  // สาย backend กับ frontend แยกกัน — ขั้นภายในสายยังลำดับกันเหมือนเดิม (build ก่อน test ฯลฯ)
  const backendLine = coreSteps.filter((s) => s.name.startsWith('backend'));
  const frontendLine = coreSteps.filter((s) => s.name.startsWith('frontend'));
  const runLine = async (line, tag) => {
    for (const step of line) {
      const r = await runStep(step);
      const ok = r.status === 0;
      results.push({ name: step.name, ok });
      console.log(ok ? `▶ ${step.name}: ผ่าน` : `▶ ${step.name}: พัง (exit ${r.status})`);
      if (!ok) {
        const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n');
        console.error(out.slice(-30).join('\n'));
        console.error(`\n❌ ล้มเหลวที่ขั้น: ${step.name} — แก้ให้ผ่านก่อน commit (กฎ AGENTS.md ข้อ 2)`);
        process.exit(1); // สายตาย = จบทันที (อีกสายปล่อยให้ runner จัดการ kill ตอน process ตาย)
      }
    }
    console.log(`── สาย ${tag} เสร็จ ──`);
  };
  await Promise.all([runLine(backendLine, 'backend'), runLine(frontendLine, 'frontend')]);
  // Phase 0 (prod-truth): frontend build เพิ่งเขียนทับ .next ที่ prod :3000 กำลัง serve อยู่
  // → prod ยังโหลด build เก่าในหน่วยความจำ + chunk hash เปลี่ยน = 404 (เคสจริง 23-09: e2e พังทั้งชุด)
  // → restart prod ให้ serve build ใหม่ก่อน e2e (watchdog ของเครื่องกู้ให้; ไม่กู้ใน 90 วิ = เรา start เอง)
  // (devIsProd === null = fail-safe ไม่แตะ server — แจ้งเตือนให้ผู้ใช้ restart เอง)
  if (RUN_E2E && devIsProd === null && findListenerPid(DEV_PORT)) {
    console.log(`⚠️  ระบุชนิดของ server :${DEV_PORT} ไม่ได้ — ไม่ restart อัตโนมัติ ถ้า e2e พังเรื่อง chunk ให้ restart :3000 เองก่อนรันใหม่`);
  }
  if (RUN_E2E && devIsProd === true) {
    const pidNow = findListenerPid(DEV_PORT);
    if (pidNow) {
      console.log(`ℹ️  frontend build ทับ .next ของ prod :3000 (PID ${pidNow}) — restart ก่อน e2e เพื่อ serve build ใหม่`);
      spawnSync('taskkill', ['/PID', String(pidNow), '/F'], { shell: true, stdio: 'ignore' });
      let up = await waitHttpAlive(`http://localhost:${DEV_PORT}/`, 90_000);
      if (!up) {
        console.log('   watchdog ยังไม่กู้ — start เองแบบ detached');
        spawn('cmd', ['/c', 'npm run start'], { cwd: FRONTEND, detached: true, stdio: 'ignore' }).unref();
        up = await waitHttpAlive(`http://localhost:${DEV_PORT}/`, 90_000);
      }
      if (!up) {
        console.error(`❌ prod :${DEV_PORT} กลับมาไม่ได้หลัง restart — หยุดก่อน e2e (ตรวจ frontend-watchdog/manual)`);
        process.exit(1);
      }
      console.log('   prod serve build ใหม่แล้ว ✅');
    }
  }
  // e2e (ถ้ามี): รันหลังสองสายเสร็จ — ต้องรอ build จบ และ backend :3001 ต้องมีจริง
  for (const step of e2eSteps) {
    const alive = process.env.E2E_REQUIRE_BACKEND === '1' || (await backendAlive());
    if (!alive) {
      results.push({ name: step.name, ok: true, skipped: true });
      console.log(`⚠️  ข้าม (backend :3001 ไม่ได้รัน — เปิด backend แล้วรันใหม่ หรือตั้ง E2E_REQUIRE_BACKEND=1 เพื่อบังคับ)`);
      continue;
    }
    const r = await runStep(step);
    const ok = r.status === 0;
    results.push({ name: step.name, ok });
    console.log(ok ? `▶ ${step.name}: ผ่าน` : `▶ ${step.name}: พัง (exit ${r.status})`);
    if (!ok) {
      const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n');
      console.error(out.slice(-30).join('\n'));
      console.error(`\n❌ ล้มเหลวที่ขั้น: ${step.name} — แก้ให้ผ่านก่อน commit (กฎ AGENTS.md ข้อ 2)`);
      process.exit(1);
    }
  }
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\n✅ ผ่านครบ ${results.length}/${results.length} ขั้น (${mins} นาที) — พร้อม commit`);

// ── Phase 1 (system-truth): เขียนผลเกตล่าสุดลง data/system-truth.json ──
// หน้า /system-health อ่านผ่าน GET /api/health/truth — เห็นสถานะเกต + fingerprint ดิสก์ ณ รอบ verify ล่าสุด
// (prod-truth เทียบดิสก์ ↔ runtime ให้แล้ว — disk.fingerprint ที่นี่จึงเป็นค่าที่ prod-truth ยืนยันแล้ว)
// data/ เป็น mount ของ container อยู่แล้ว → backend อ่านถูกไฟล์เดียวกับที่ verify เขียน
try {
  const truthPath = join(BACKEND, 'data', 'system-truth.json');
  let prodTruth = null;
  try { prodTruth = JSON.parse(readFileSync(truthPath, 'utf8'))?.prodTruth ?? null; } catch { /* รอบแรกยังไม่มี */ }
  let diskFp = null, diskFiles = null;
  try {
    const { computeDirFingerprintSync } = await import('./fingerprint-lib.mjs');
    const disk = computeDirFingerprintSync(join(BACKEND, 'dist'));
    diskFp = disk.fingerprint; diskFiles = disk.files;
  } catch { /* dist ไม่มี = ไม่มีข้อมูลเทียบ */ }
  writeFileSync(truthPath, JSON.stringify({
    writtenAt: new Date().toISOString(),
    ok: results.every((r) => r.ok),
    steps: results.map((r) => ({ name: r.name, ok: r.ok, skipped: !!r.skipped })),
    prodTruth: { diskFingerprint: diskFp, diskFiles, diskDir: 'sovereign-os/core-api/dist' },
    _prevProdTruth: prodTruth,
  }, null, 2) + '\n', 'utf8');
  console.log(`ℹ️  เขียน system-truth → data/system-truth.json (ok=${results.every((r) => r.ok)})`);
} catch (e) {
  console.log(`ℹ️  เขียน system-truth ไม่สำเร็จ (${e.message?.slice(0, 80)}) — ไม่กระทบผลเกต`);
}

// ── กู้ dev server อัตโนมัติ: build ทับ .next แล้ว dev เดิมจะเสี่ยง chunk พัง ──
// ห้าม kill จากใน process นี้ (taskkill /T อาจโดน tree ของ shell แม่)
// → เขียนสคริปต์ helper แล้ว spawn แบบ detached: มันจะรอ 3 วิ (ให้ verify ปิดก่อน)
//   ค่อย kill dev เก่า + เคลียร์ .next + เปิด dev ใหม่ แล้ว "รอจนฟังพอร์ตจริง"
//   (เคสจริง: dev ใหม่ค้างไม่ bind → :3000 ตายเงียบ ๆ ทั้งระบบ — ต้อง fail loudly)
// production serve :3000 อยู่ → ข้ามทั้งหมด (ไม่ kill, ไม่แตะ .next)
if (devPidBefore && devIsProd !== false) {
  // prod ชัดเจน หรือ "ไม่รู้ชนิด" (fail-safe) — ทั้งคู่ห้าม kill/wipe
  console.log(devIsProd === true
    ? 'ℹ️  ข้ามการกู้ dev — production ยัง serve :3000 อยู่ (คงสภาพไว้ตามจริง)'
    : 'ℹ️  ข้ามการกู้ dev — ระบุชนิด server :3000 ไม่ได้ (fail-safe ห้ามทำลาย)');
} else if (devPidBefore) {
  const pidNow = findListenerPid(DEV_PORT);
  if (pidNow !== devPidBefore) {
    console.log('ℹ️  dev server เปลี่ยนไปเอง — ไม่ต้องกู้');
  } else {
    const helperPath = join(ROOT, 'restart-dev-helper.cmd');
    const helper = [
      '@echo off',
      'timeout /t 3 /nobreak >nul',
      `taskkill /PID ${devPidBefore} /F >nul 2>&1`,
      `cd /d "${FRONTEND}"`,
      'if exist .next rmdir /s /q .next',
      'start "sovereign-dev" /min cmd /c "npm run dev > ..\\dev-server.log 2>&1"',
      // รอ :3000 ขึ้นจริงสูงสุด 90 วิ (dev ต้อง compile) — ไม่ขึ้นใน 90 วิ = ออก non-zero + แจ้งดัง ๆ
      'powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(90); do { $r=try{(Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000/ -TimeoutSec 3).StatusCode}catch{0}; if($r -eq 200){exit 0}; Start-Sleep 3 } while((Get-Date) -lt $deadline); Write-Host (\'[verify-restore] dev server ไม่ยอมฟัง :3000 ภายใน 90 วิ — ดู log ที่ E:\\My work\\Project Sovereign Origin\\dev-server.log\'); exit 1"',
      'if errorlevel 1 exit /b 1',
    ].join('\r\n');
    writeFileSync(helperPath, helper, 'utf8');
    const child = spawn('cmd', ['/c', helperPath], { cwd: ROOT, shell: false, detached: true, stdio: 'ignore' });
    child.unref();
    console.log(`\n🔄 ตั้งเวลากู้ dev server หลัง verify จบ 3 วิ (kill PID ${devPidBefore} + เคลียร์ .next + เปิดใหม่ + รอฟังพอร์ตจริง)`);
    console.log('   ถ้ากู้ไม่ขึ้นจะมีข้อความ "[verify-restore] ... ไม่ยอมฟัง :3000" ค้างในหน้าต่าง sovereign-dev');
  }
}
