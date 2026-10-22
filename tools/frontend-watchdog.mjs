#!/usr/bin/env node
// tools/frontend-watchdog.mjs — เฝ้า :3000 ให้บูตกลับเองเสมอ (I0a 28/9/69)
// ที่มา: verify.mjs/nightly-gate.mjs อ้างหา "frontend-watchdog.mjs" มาตลอดแต่ไฟล์ไม่เคยมีบนดิสก์
// (ไฟล์ผี) — เคสจริง 28/9: :3000 ล่มทั้งเช้า ไม่มีใครปลุก → Synthetic/Digest พังตามลูกโซ่
//
// กติกา (ยึดธรรมเนียม verify.mjs dev-restore):
//   1) :3000 ตอบ 200          → จบ (เขียน log เบา ๆ ทุกการรัน)
//   2) ไม่มีใครฟังพอร์ต        → บูต prod: npm run start -- -p 3000 (detached, hidden)
//   3) มี server แต่ไม่ตอบ     → kill PID เจ้าของพอร์ต (serve build แปลก/hang) → บูตใหม่
//   4) จับชนิด server ไม่ได้    → ห้าม kill (fail-safe เดียวกับ verify.mjs) — แจ้งแล้วข้าม
// kill-switch: ไฟล์ data/frontend-watchdog.disabled = หยุดแทรกแซงทันที
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRuntimeMode, modeHasWeb } from './runtime-layers.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const FRONTEND = join(MAIN_ROOT, 'sovereign-frontend');
const KILL_SWITCH = join(MAIN_ROOT, 'sovereign-os/core-api/data/frontend-watchdog.disabled');
const LOG = join(MAIN_ROOT, 'logs', 'frontend-watchdog.jsonl');
const PORT = 3000;

const log = (e) => { try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n'); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpCode() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 6000 }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

function listenerPid() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    return Number(out.trim()) || 0;
  } catch { return 0; }
}

function serverKind(pid) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){ $pp=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; "$($p.CommandLine)|||$($pp.CommandLine)" }`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    const norm = String(out).toLowerCase().replace(/["']/g, ' ');
    if (/\bnext\s+dev\b|\brun\s+dev\b/.test(norm)) return 'dev';
    if (/\bnext\s+start\b|\brun\s+start\b|start-server/.test(norm)) return 'prod';
    return 'unknown';
  } catch { return 'unknown'; }
}

/**
 * เปิดเซิร์ฟเวอร์หน้าเว็บแบบไม่มีหน้าต่าง
 *
 * ⚠ เคสจริง 12/10/69: เคยเขียน `detached: true` คู่กับ `windowsHide: true`
 *   แล้วหน้าต่าง console ยังเด้งทุกครั้งที่ watchdog เปิดเซิร์ฟเวอร์ใหม่
 *   ⇒ สาเหตุ: detached บน Windows แปลว่า "สร้าง console ใหม่ให้ลูก"
 *     ซึ่งขัดกับ windowsHide (ซึ่งแปลว่า "อย่าสร้างหน้าต่าง")
 *     ผลคือได้ console ที่ซ่อนไม่ได้ = หน้าต่างเด้ง
 *   ⇒ ต้องเอา detached ออก แล้วใช้ stdio ignore + unref แทน
 *     (ยังเป็น process ที่ทำงานเบื้องหลังได้ ไม่ต้องรอให้จบ)
 */
function bootProd() {
  spawn('cmd', ['/c', 'npm', 'run', 'start', '--', '-p', String(PORT)], {
    cwd: FRONTEND, windowsHide: true, stdio: 'ignore',
  }).unref();
}

async function waitUp(maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) { if ((await httpCode()) === 200) return true; await sleep(4000); }
  return false;
}

const t0 = Date.now();
if (fs.existsSync(KILL_SWITCH)) { console.log('kill-switch มีอยู่ — ข้าม'); process.exit(0); }

// เคารพ runtime-layer: โหมดที่ไม่มี web (เช่นอนาคต sleep/core-only) ห้ามบูต :3000 กลับ
// (ถ้าไม่เช็คตรงนี้ การ stop frontend ของผู้ใช้จะถูกปลุกทุก 1 นาที)
const activeMode = (() => { try { return readRuntimeMode({ root: MAIN_ROOT }).mode; } catch { return 'unknown'; } })();
if (!modeHasWeb(activeMode)) {
  log({ action: 'skip-mode', mode: activeMode, ms: Date.now() - t0 });
  console.log(`mode=${activeMode} ไม่มี web — ข้าม`);
  process.exit(0);
}

let code = await httpCode();
if (code === 200) {
  log({ action: 'healthy', code, ms: Date.now() - t0 });
  console.log(`:3000 ปกติ (${code})`);
  process.exit(0);
}

const pid = listenerPid();
let action, ok;
if (!pid) {
  action = 'boot';
  console.log(':3000 ไม่มีใครฟัง — บูต prod ใหม่…');
  bootProd();
} else {
  const kind = serverKind(pid);
  if (kind === 'unknown') {
    action = 'skip-unknown';
    log({ action, code, pid, ms: Date.now() - t0 });
    console.error(`:3000 มี server (PID ${pid}) ตอบ ${code} แต่จับชนิดไม่ได้ — fail-safe ห้าม kill (ตรวจมือ)`);
    process.exit(1);
  }
  action = 'reboot-hung';
  console.log(`:3000 มี ${kind} server (PID ${pid}) ตอบ ${code} — kill แล้วบูตใหม่…`);
  try { execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, shell: true, stdio: 'ignore', timeout: 20_000 }); } catch {}
  await sleep(3000);
  bootProd();
}
ok = await waitUp(90_000);
log({ action, ok, code: await httpCode(), ms: Date.now() - t0 });
console.log(ok ? `✅ :3000 กลับมา (${action} · ${Math.round((Date.now() - t0) / 1000)} วิ)` : `❌ :3000 ยังไม่ตอบหลัง ${action} — Machine Watch จะแจ้งต่อ`);
process.exit(ok ? 0 : 1);
