// ─────────────────────────────────────────────────────────────
//  Sovereign OS — Frontend Watchdog
//  คอยเฝ้า Next.js dev server (:3000) — ถ้ามันตายกลางคัน เริ่มให้ใหม่เอง
//  single-instance (lock file .freebuff/frontend-watchdog.pid)
//  เรียกใช้ผ่าน autostart.mjs / รันเองก็ได้ — ล็อก .freebuff/frontend-watchdog.log
// ─────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, 'sovereign-frontend');
const NEXT_BIN = join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next');
const LOCK = join(ROOT, '.freebuff', 'frontend-watchdog.pid');
const LOG = join(ROOT, '.freebuff', 'frontend-watchdog.log');

mkdirSync(dirname(LOCK), { recursive: true });

// กันรันซ้ำสองตัว — ตรวจว่า pid ใน lock ยังมีชีวิตอยู่หรือไม่
if (existsSync(LOCK)) {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    if (pid > 0) {
      process.kill(pid, 0);
      console.log(`frontend-watchdog already running (pid ${pid}) — exit`);
      process.exit(0);
    }
  } catch {
    // lock เก่า (pid ตายแล้ว) = ทิ้งแล้วเริ่มใหม่
  }
}
writeFileSync(LOCK, String(process.pid));

const log = (...a) => console.log(`[${new Date().toLocaleString('th-TH')}]`, ...a);

let child = null;
let restarts = 0;

function portOpen() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port: 3000, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(800, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function start() {
  if (child) return;
  portOpen().then((open) => {
    if (open) {
      log('ℹ️ :3000 มี server รันอยู่แล้ว — เฝ้าอย่างเดียว ไม่ spawn ซ้ำ');
      return;
    }
    const out = openSync(LOG, 'a');
    restarts++;
    log(`▶️ frontend dev เริ่ม (ครั้งที่ ${restarts})`);
    child = spawn('node.exe', [NEXT_BIN, 'dev', '-p', '3000'], {
      cwd: FRONTEND,
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
    child.on('exit', (code, signal) => {
      child = null;
      log(`💀 frontend dev จบ (code=${code} signal=${signal}) — เริ่มใหม่ใน 5s`);
      setTimeout(start, 5000);
    });
    child.on('error', (err) => {
      child = null;
      log(`❌ spawn ล้มเหลว: ${err.message} — ลองอีกครั้งใน 15s`);
      setTimeout(start, 15000);
    });
  });
}

log('═══ Frontend Watchdog เริ่ม (เฝ้า :3000) ═══');
start();

process.on('exit', () => {
  try { unlinkSync(LOCK); } catch {}
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
