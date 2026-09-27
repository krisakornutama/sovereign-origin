#!/usr/bin/env node
// tools/docker-watchdog.mjs — ให้ระบบฟื้นเองเมื่อ Docker daemon ดับ (SPOF ที่ดับจริง 27/9/69)
// เรียกโดย task 'Sovereign Docker Watch' ทุก 10 นาที (StartWhenAvailable — เครื่องตื่นช้าก็รันชดเชย)
// หลักการ: start-only — ไม่ kill/restart ตัวที่ยังมีชีวิต · ทุกเหตุการณ์จด log + แจ้ง Telegram แบบ soft
// kill-switch: สร้างไฟล์ data/docker-watchdog.disabled แล้ว watchdog จะไม่ปลุก Docker (เผื่อเจ้าของปิดจำกัดตอนงานหนัก)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
// ชี้ MAIN เสมอ — log/kill-switch ต้องอยู่ที่เดียวกันไม่ว่าจะรันจาก worktree หรือ MAIN
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const KILL_SWITCH = join(MAIN_ROOT, 'sovereign-os/core-api/data/docker-watchdog.disabled');
const LOG = join(MAIN_ROOT, 'logs', 'docker-watchdog.jsonl');

const CONTAINERS = ['sovereign-db', 'sovereign-core-api', 'sovereign-emqx'];
const DOCKER_EXE = join(
  process.env.LOCALAPPDATA || `C:/Users/${process.env.USERNAME || 'com'}/AppData/Local`,
  'Programs', 'DockerDesktop', 'Docker Desktop.exe'
);
const HEALTH_URL = 'http://localhost:3001/healthz';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sh(cmd, args, timeout = 20_000) {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
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

const t0 = Date.now();
let action = 'noop', ok = true, detail = '';
if (fs.existsSync(KILL_SWITCH)) { console.log('kill-switch มีอยู่ (data/docker-watchdog.disabled) — ข้ามทั้งรอบ'); process.exit(0); }

if (dockerAlive()) {
  // ด่านเบา: daemon มีชีวิต — ตัวไหน exited ค่อย start (เคสรีบูตเครื่องแล้ว restart policy พลาด)
  detail = startStoppedContainers();
  action = 'containers-checked';
} else {
  action = 'daemon-restart';
  if (!fs.existsSync(DOCKER_EXE)) {
    ok = false; detail = `ไม่พบ Docker Desktop exe (${DOCKER_EXE}) — ตรวจตำแหน่งติดตั้ง`;
  } else {
    try {
      const child = spawn(DOCKER_EXE, [], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch (e) { /* spawn fail = ตัดสินที่ daemon อย่างเดียว */ }
    let up = false; // ประสบการณ์จริง 27/9: daemon กลับมาใน 10–50 วิ — รอได้ถึง 7 นาที
    for (let i = 0; i < 42; i++) { if (dockerAlive()) { up = true; break; } await sleep(10_000); }
    if (!up) { ok = false; detail = 'สั่งเปิด Docker Desktop แล้วแต่ daemon ไม่กลับมาใน 7 นาที — machine-health จะแจ้ง critical ต่อ'; }
    else { detail = `daemon กลับมา (${Math.round((Date.now() - t0) / 1000)} วิ) · ${startStoppedContainers()}`; }
  }
}
// ยืนยันสุดท้ายด้วย healthz — พาธปลุกให้รอยาว (backend บูต ~1 นาที) · พาธปกติเช็คสั้น ๆ
const healthy = await waitBackend(action === 'daemon-restart' && ok ? 180_000 : 15_000);
const entry = { action, ok: ok && healthy, detail, healthy, ms: Date.now() - t0 };
log(entry);
console.log(JSON.stringify(entry));
if (action === 'daemon-restart' && ok && healthy) {
  notify(`🤖 Sovereign Docker Watchdog — Docker daemon ดับ แล้วระบบบูตกลับมาเอง\n${detail}\nhealthz 200 · รวม ${Math.round(entry.ms / 1000)} วิ`);
}
process.exit(entry.ok ? 0 : 1);
