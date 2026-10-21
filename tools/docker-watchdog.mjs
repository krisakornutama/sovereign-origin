#!/usr/bin/env node
// tools/docker-watchdog.mjs — ให้ระบบฟื้นเองเมื่อ Docker daemon ดับ (SPOF ที่ดับจริง 27/9/69)
// เรียกโดย task 'Sovereign Docker Watch' ทุก 1 นาที (StartWhenAvailable — เครื่องตื่นช้าก็รันชดเชย)
// หลักการ: start-only — ไม่ kill/restart ตัวที่ยังมีชีวิต · ทุกเหตุการณ์จด log + แจ้ง Telegram แบบ soft
// kill-switch: สร้างไฟล์ data/docker-watchdog.disabled แล้ว watchdog จะไม่ปลุก Docker (เผื่อเจ้าของปิดจำกัดตอนงานหนัก)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
// ชี้ MAIN เสมอ — log/kill-switch ต้องอยู่ที่เดียวกันไม่ว่าจะรันจาก worktree หรือ MAIN
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const KILL_SWITCH = join(MAIN_ROOT, 'sovereign-os/core-api/data/docker-watchdog.disabled');
// marker จาก vhdx-compact.ps1 — daemon ที่ตื่นรอบนี้ถูกปิดตั้งใจเพื่อ compact vhdx (ข้อความ TG จะบอกแบบนั้น + ตัวเลขพื้นที่)
const COMPACT_MARKER = join(MAIN_ROOT, '.freebuff', 'vhdx-compact.window');
const LOG = join(MAIN_ROOT, 'logs', 'docker-watchdog.jsonl');
// ความจำของ flap guard — logs/ ถูก gitignore อยู่แล้ว (ไม่ใช่ไฟล์โปรเจ็กต์)
const STATE = join(MAIN_ROOT, 'logs', 'docker-watchdog.state.json');

const CONTAINERS = ['sovereign-db', 'sovereign-core-api', 'sovereign-emqx'];
const DOCKER_EXE = join(
  process.env.LOCALAPPDATA || `C:/Users/${process.env.USERNAME || 'com'}/AppData/Local`,
  'Programs', 'DockerDesktop', 'Docker Desktop.exe'
);
const HEALTH_URL = 'http://localhost:3001/healthz';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sh(cmd, args, timeout = 20_000) {
  try { return { ok: true, out: execFileSync(cmd, args, { windowsHide: true, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, err: String(e?.status ?? e?.message ?? e) }; }
}
function dockerAlive() { return sh('docker', ['info', '--format', '{{.ServerVersion}}'], 15_000).ok; }
function log(entry) { try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* log ไม่ได้ = ข้าม */ } }

// แจ้ง Telegram แบบ best-effort (creds จาก infra/.env เท่านั้น — ระบบหลักคือ machine-health รอบถัดไป)
async function notify(text) {
  try {
    const env = Object.fromEntries(
      fs.readFileSync(join(MAIN_ROOT, 'sovereign-os/infra/.env'), 'utf8')
        .split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
    );
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }), signal: AbortSignal.timeout(8_000),
    });
  } catch { /* แจ้งไม่ถึง = ข้าม ไม่พา watchdog ตาย */ }
}

function startStoppedContainers() {
  const out = sh('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}'], 20_000);
  if (!out.ok) return 'ps-failed';
  let started = [];
  for (const line of out.out.split('\n')) {
    const [name, state] = line.trim().split('\t');
    if (CONTAINERS.includes(name) && state === 'exited') {
      sh('docker', ['start', name], 60_000);
      started.push(name);
    }
  }
  return started.length ? `started:${started.join(',')}` : 'all-running';
}

async function waitBackend(maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const code = await new Promise((resolve) => {
      const req = http.get(HEALTH_URL, { timeout: 4000 }, (res) => { resolve(res.statusCode); req.destroy(); });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    });
    if (code === 200) return true;
    await sleep(10_000);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  กัน flap + ปลุก Docker Desktop ให้รอด job ของ Task Scheduler
//  เคสจริง 19/10/69 (logs/docker-watchdog.jsonl): daemon-restart 46 ครั้งในวันเดียว
//  — 44 ครั้งใน ~1 ชม. ทุกรอบรายงาน "daemon กลับมาใน 11–75 วิ" แล้วตายอีก
//  ⇒ ตลอดชั่วโมงนั้น sovereign-db ถูก kill/start วนไม่หยุด (ระหว่าง Cold Soak)
//  สาเหตุ: Task Scheduler ห่อแต่ละรอบด้วย job object แบบ kill-on-close ⇒ โปรเซสลูก
//  ทั้งหมดของ node (รวม Docker Desktop ที่เพิ่งปลุก) ตายพร้อมรอบ · detached/windowsHide
//  ไม่ช่วยเพราะเป็นคนละกลไกกับ job ⇒ ต้องให้โปรเซสที่อยู่นอก job เป็นคนเปิด
// ═══════════════════════════════════════════════════════════════════════════
export const FLAP_WINDOW_MS = 30 * 60_000; // หน้าต่างเวลาที่นับ
export const FLAP_MAX = 3; // ปลุกเกิน 3 ครั้งใน 30 นาที = ผิดปกติ (ปกติ 1–5 ครั้ง/วัน)

/** ตัดสินใจรอบนี้ — pure (เทสต์ได้โดยไม่แตะ Docker) */
export function planRecovery({ daemonAlive, attempts = [], now = Date.now(), windowMs = FLAP_WINDOW_MS, max = FLAP_MAX }) {
  if (daemonAlive) return { action: 'containers-checked', startDaemon: false, recent: [] };
  const recent = attempts.filter((t) => Number.isFinite(t) && now - t >= 0 && now - t < windowMs);
  if (recent.length >= max) return { action: 'flap-detected', startDaemon: false, recent };
  return { action: 'daemon-restart', startDaemon: true, recent };
}

/** แจ้งเตือน flap ได้บ่อยแค่ไหน — pure */
export function shouldNotifyFlap({ lastNotifiedAt = 0, now = Date.now(), cooldownMs = 60 * 60_000 }) {
  return !lastNotifiedAt || now - lastNotifiedAt >= cooldownMs;
}

export function readState(file = STATE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      attempts: Array.isArray(s.attempts) ? s.attempts.filter((t) => Number.isFinite(t)) : [],
      lastFlapNotify: Number(s.lastFlapNotify) || 0,
    };
  } catch { return { attempts: [], lastFlapNotify: 0 }; }
}

export function writeState(state, file = STATE) {
  try {
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...state, attempts: (state.attempts || []).slice(-50) }));
  } catch { /* เขียนไม่ได้ = ข้าม (ไม่พา watchdog ตาย) */ }
}

/**
 * วิธีปลุก Docker Desktop — pure
 * explorer.exe = โปรเซสของ session ผู้ใช้ที่อยู่นอก job ของ Task Scheduler
 *   ⇒ Docker Desktop ที่มันเปิดจึงไม่ตายตามรอบ · Docker Desktop เป็น GUI ไม่มี console
 *   จึงไม่มีหน้าต่างเด้ง (ต่างจาก powershell/cmd ที่ windowsHide ซ่อนได้แค่ตัวลูกตรง ๆ)
 */
export function planDaemonStart({ exe = DOCKER_EXE, exists } = {}) {
  const present = exists ?? fs.existsSync(exe);
  if (!present) return null;
  return { file: 'explorer.exe', args: [exe], why: 'explorer-handoff' };
}

function startDaemon(exe) {
  const plan = planDaemonStart({ exe });
  if (!plan) return { ok: false, how: 'missing-exe' };
  try {
    // explorer คืน exit code 1 เสมอแม้เปิดสำเร็จ → ห้ามตัดสินจาก status ให้ดู daemon ที่ตื่นจริงเท่านั้น
    spawnSync(plan.file, plan.args, { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
    return { ok: true, how: plan.why };
  } catch {
    // ไม่มี explorer (แทบไม่เกิด) — เปิดตรงแบบเดิม · ยังอยู่ใน job ⇒ อาจตายตอนรอบจบ (ทางสุดท้าย)
    try { spawn(exe, [], { stdio: 'ignore', windowsHide: true }).unref(); return { ok: true, how: 'direct-fallback' }; }
    catch { return { ok: false, how: 'spawn-failed' }; }
  }
}

const t0 = Date.now();
async function main() {
  if (fs.existsSync(KILL_SWITCH)) { console.log('kill-switch มีอยู่ (data/docker-watchdog.disabled) — ข้ามทั้งรอบ'); return 0; }

  const state = readState();
  const decision = planRecovery({ daemonAlive: dockerAlive(), attempts: state.attempts });
  let action = decision.action, ok = true, detail = '';

  if (action === 'containers-checked') {
    // ด่านเบา: daemon มีชีวิต — ตัวไหน exited ค่อย start (เคสรีบูตเครื่องแล้ว restart policy พลาด)
    detail = startStoppedContainers();
  } else if (action === 'flap-detected') {
    // daemon ตายซ้ำ ๆ: ปลุกไปก็ตายไป และทุกครั้งที่ปลุก sovereign-db ถูก kill/start ตามไปด้วย
    ok = false;
    detail = `daemon ตายซ้ำ ${decision.recent.length} ครั้งใน ${Math.round(FLAP_WINDOW_MS / 60_000)} นาที — หยุดปลุกชั่วคราว (กัน flap)`;
    if (shouldNotifyFlap({ lastNotifiedAt: state.lastFlapNotify })) {
      state.lastFlapNotify = Date.now();
      writeState(state);
      await notify(`🛑 Sovereign Docker Watchdog — หยุดปลุก Docker ชั่วคราว\n${detail}\nเปิด Docker Desktop เอง 1 ครั้งแล้วรอ 1 นาที — watchdog จะกลับมาทำงานเอง`);
    }
  } else {
    // จดความพยายามก่อนรอ — รอบที่ค้างกลางทางต้องถูกนับด้วย ไม่งั้น flap guard ไม่ทำงาน
    state.attempts = [...decision.recent, Date.now()];
    writeState(state);
    const started = startDaemon(DOCKER_EXE);
    if (!started.ok) {
      ok = false;
      detail = `เปิด Docker Desktop ไม่สำเร็จ (${started.how}) — ตรวจตำแหน่งติดตั้ง ${DOCKER_EXE}`;
    } else {
      let up = false; // ประสบการณ์จริง 27/9: daemon กลับมาใน 10–50 วิ — รอได้ถึง 7 นาที
      for (let i = 0; i < 42; i++) { if (dockerAlive()) { up = true; break; } await sleep(10_000); }
      if (!up) { ok = false; detail = `สั่งเปิด Docker Desktop แล้วแต่ daemon ไม่กลับมาใน 7 นาที (วิธี: ${started.how}) — machine-health จะแจ้ง critical ต่อ`; }
      else { detail = `daemon กลับมา (${Math.round((Date.now() - t0) / 1000)} วิ · วิธี: ${started.how}) · ${startStoppedContainers()}`; }
    }
  }

  // ยืนยันสุดท้ายด้วย healthz — พาธปลุกให้รอยาว (backend บูต ~1 นาที) · พาธปกติเช็คสั้น ๆ
  const healthy = await waitBackend(action === 'daemon-restart' && ok ? 180_000 : 15_000);
  const entry = { action, ok: ok && healthy, detail, healthy, ms: Date.now() - t0 };
  log(entry);
  console.log(JSON.stringify(entry));
  if (action === 'daemon-restart' && ok && healthy) {
    // vhdx compact รายสัปดาห์ปิด daemon เอง — marker อายุ < 2 ชม. = ใช้ข้อความ compact + ตัวเลขพื้นที่จากสคริปต์
    let compactNote = '';
    try {
      const st = fs.statSync(COMPACT_MARKER);
      if (Date.now() - st.mtimeMs < 2 * 3_600_000) {
        compactNote = fs.readFileSync(COMPACT_MARKER, 'utf8').trim().split(/\r?\n/)[0].slice(0, 300);
      }
      fs.unlinkSync(COMPACT_MARKER);
    } catch { /* ไม่มี marker = แจ้งแบบปกติ */ }
    // await: เดิมไม่รอ ⇒ process.exit ตัด fetch ของ Telegram ทิ้งก่อนส่งจบ (ข้อความหายเงียบ)
    await notify(compactNote
      ? `🧹 Sovereign VHDX compact รายสัปดาห์ — ปิด Docker ชั่วคราวเพื่อคืนพื้นที่ แล้วบูตกลับเอง\n${compactNote}\n${detail} · healthz 200 · รวม ${Math.round(entry.ms / 1000)} วิ`
      : `🤖 Sovereign Docker Watchdog — Docker daemon ดับ แล้วระบบบูตกลับมาเอง\n${detail}\nhealthz 200 · รวม ${Math.round(entry.ms / 1000)} วิ`);
  }
  return entry.ok ? 0 : 1;
}

// รันเฉพาะเมื่อถูกเรียกเป็นสคริปต์ — การ import ในเทสต์ต้องไม่ไปแตะ Docker จริง
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(await main());
