// ────────────────────────────────────────────────────────────────────────────
// verify.mjs — Quality Gate เดียวของโปรเจ็ก Sovereign Origin
// รัน: npm run verify            (build + typecheck + ทดสอบทั้ง backend/frontend)
//      npm run verify -- --db    (เพิ่มชุด real-Postgres = npm run test:db — ต้องมี Docker + container sovereign-db)
//      npm run verify:full       (เพิ่ม E2E Playwright — ต้องมี backend+DB รันอยู่)
//
// กติกา: ผ่านทุกขั้นถึงจะ commit/merge ได้ (ตาม AGENTS.md ข้อ 2)
// ────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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
  steps.push({ name: 'e2e: Playwright (headless)', cwd: FRONTEND, cmd: 'npm', args: ['run', 'e2e'] });
}

console.log('═══ Sovereign Quality Gate ═══');

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
const devIsProd = (() => {
  if (!devPidBefore) return false;
  const [own = '', parent = ''] = (processCmdlineWithParent(devPidBefore) || '').split('|||');
  // ตัด quote ออกก่อน: cmdline จริงคือ ...bin\next" start -p 3000 → "next start" หาไม่เจอ
  // (พิสูจน์เคสจริง: classify ตัวแรกพลาดตรงนี้แล้ว kill prod ทั้งที่ตั้งใจ skip)
  const norm = (s) => (s || '').toLowerCase().replace(/["']/g, ' ');
  const cmd = norm(own) + ' ' + norm(parent);
  if (/\bnext\s+dev\b/.test(cmd) || /\brun\s+dev\b/.test(cmd)) return false;   // dev ชัดเจน (ตัวเองหรือพ่อ)
  if (/\bnext\s+start\b/.test(cmd) || /\brun\s+start\b/.test(cmd) || cmd.includes('start-server')) return true; // prod
  return false; // จับใจความไม่ได้ → ถือว่าไม่ใช่ prod (เดิมพันกับพฤติกรรมเดิมที่รู้ผล)
})();
if (devPidBefore) {
  console.log(devIsProd
    ? `ℹ️  :${DEV_PORT} มี production server serve อยู่ (PID ${devPidBefore}) — verify จะไม่แตะพอร์ต/.next ตอนท้าย`
    : `ℹ️  พบ dev server บน :${DEV_PORT} (PID ${devPidBefore}) — หลัง verify จะกู้ dev ให้เอง (restart)`);
}

if (RUN_E2E && !existsSync(join(FRONTEND, 'node_modules', '@playwright', 'test'))) {
  console.error('❌ ยังไม่ได้ติดตั้ง @playwright/test — รัน: cd sovereign-frontend && npm install -D @playwright/test && npx playwright install chromium');
  process.exit(1);
}

const results = [];
const t0 = Date.now();
for (const step of steps) {
  process.stdout.write(`▶ ${step.name} ... `);
  const run = () => spawnSync(step.cmd, step.args, { cwd: step.cwd, shell: true, stdio: 'pipe', encoding: 'utf8' });
  let r = run();
  // exit 134 = build worker ตายแบบ native OOM (Zone Allocation) — พบจริงเมื่อแรม/commit charge ของเครื่อง
  // ต่ำ (prod server + docker รันคู่กัน) · ไม่ใช่บั๊กโค้ด (CI บน GitHub แรมโล่งผ่านเสมอ) → พักแล้วลองใหม่ 2 ครั้ง
  for (let retry = 1; r.status === 134 && retry <= 2; retry++) {
    console.log(`พังชั่วคราว (exit 134 — OOM) → พัก 20 วิ แล้วลองใหม่ (${retry}/2)`);
    await new Promise((res) => setTimeout(res, 20_000));
    r = run();
  }
  const ok = r.status === 0;
  results.push({ name: step.name, ok });
  console.log(ok ? 'ผ่าน' : `พัง (exit ${r.status})`);
  if (!ok) {
    // แสดง 30 บรรทัดท้ายของ output ให้เห็นสาเหตุ
    const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n');
    console.error(out.slice(-30).join('\n'));
    console.error(`\n❌ ล้มเหลวที่ขั้น: ${step.name} — แก้ให้ผ่านก่อน commit (กฎ AGENTS.md ข้อ 2)`);
    process.exit(1);
  }
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\n✅ ผ่านครบ ${results.length}/${results.length} ขั้น (${mins} นาที) — พร้อม commit`);

// ── กู้ dev server อัตโนมัติ: build ทับ .next แล้ว dev เดิมจะเสี่ยง chunk พัง ──
// ห้าม kill จากใน process นี้ (taskkill /T อาจโดน tree ของ shell แม่)
// → เขียนสคริปต์ helper แล้ว spawn แบบ detached: มันจะรอ 3 วิ (ให้ verify ปิดก่อน)
//   ค่อย kill dev เก่า + เคลียร์ .next + เปิด dev ใหม่ แล้ว "รอจนฟังพอร์ตจริง"
//   (เคสจริง: dev ใหม่ค้างไม่ bind → :3000 ตายเงียบ ๆ ทั้งระบบ — ต้อง fail loudly)
// production serve :3000 อยู่ → ข้ามทั้งหมด (ไม่ kill, ไม่แตะ .next)
if (devPidBefore && devIsProd) {
  console.log('ℹ️  ข้ามการกู้ dev — production ยัง serve :3000 อยู่ (คงสภาพไว้ตามจริง)');
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
