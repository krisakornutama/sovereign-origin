// ─────────────────────────────────────────────────────────────
// Sovereign OS — Frontend Watchdog (เฝ้า :3000, เริ่มใหม่เมื่อตาย)
//  เรียกใช้: node frontend-watchdog.mjs  (autostart.mjs spawn ให้ idempotent)
//  หมายเหตุ: ไฟล์เดิมพัง (ถูก log ของ next dev ทับจนเป็นขยะ) — เขียนใหม่ 2026-09-14
//  โหมด: มี .next/BUILD_ID (เคย next build ไว้) = next start (prod, เร็ว)
//        ไม่มี = next dev (fallback สำหรับเครื่องที่ยังไม่เคย build)
// ─────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, 'sovereign-frontend');
const NEXT_BIN = join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next');
const BUILD_ID = join(FRONTEND, '.next', 'BUILD_ID');
const PORT = 3000;
const CHECK_MS = 30_000;      // ตรวจทุก 30 วิ
const HTTP_WAIT_MS = 60_000;  // รอหลัง spawn สูงสุด 1 นาที

const log = (...a) => console.log(`[${new Date().toLocaleString('th-TH')}]`, ...a);

function healthy() {
  // เช็คด้วย HTTP จริง — พอร์ตมีคนฟังแต่ไม่ตอบ = ถือว่าตาย
  try {
    const code = execSync(
      `powershell -NoProfile -Command "(Invoke-WebRequest -Uri http://localhost:${PORT} -TimeoutSec 5 -UseBasicParsing).StatusCode"`,
      { timeout: 10_000, windowsHide: true },
    ).toString().trim();
    return code.startsWith('2') || code === '308' || code === '307';
  } catch {
    return false;
  }
}

function killPort() {
  // เคลียร์เจ้าของพอร์ตเก่าที่ค้าง (มี listener แต่ไม่ตอบ)
  try {
    const out = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTENING"`, { windowsHide: true }).toString();
    const pids = [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && p !== '0'))];
    for (const pid of pids) {
      try { execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch {}
    }
    if (pids.length) log(`💀 เคลียร์ process เก่าบน :${PORT} (${pids.join(', ')})`);
  } catch { /* ไม่มีใครฟังพอร์ต = ข้าม */ }
}

function startFrontend() {
  const useProd = existsSync(BUILD_ID);
  const out = openSync(join(ROOT, '.freebuff', 'watchdog-frontend.log'), 'a');
  const child = spawn('node.exe', useProd ? [NEXT_BIN, 'start', '-p', String(PORT)] : [NEXT_BIN, 'dev', '-p', String(PORT)], {
    cwd: FRONTEND, detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  child.unref();
  log(`▶️ frontend ${useProd ? 'start (prod)' : 'dev'} เริ่มแล้ว`);
  return child;
}

async function waitHealthy(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (healthy()) { log(`✅ :${PORT} ตอบแล้ว`); return true; }
    execSync('ping -n 3 127.0.0.1 >nul', { stdio: 'ignore', windowsHide: true });
  }
  return false;
}

let restarting = false;

async function tick() {
  if (restarting) return;
  if (healthy()) return;
  log(`⚠️ :${PORT} ไม่ตอบ — รีสตาร์ท`);
  restarting = true;
  try {
    killPort();
    startFrontend();
    if (!(await waitHealthy(HTTP_WAIT_MS))) log(`⚠️ frontend ยังไม่ตอบใน ${HTTP_WAIT_MS / 1000}s — รอบหน้าลองใหม่`);
  } finally {
    restarting = false;
  }
}

log('═══ Frontend Watchdog เริ่ม (เฝ้า :3000 — prod-build-aware) ═══');
if (!healthy()) await tick();
setInterval(tick, CHECK_MS);
