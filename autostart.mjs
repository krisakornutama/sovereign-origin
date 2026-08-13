// ─────────────────────────────────────────────────────────────
//  Sovereign OS — ออโตสตาร์ทตอนเข้า Windows (ซ่อน ไม่มีหน้าต่าง)
//  ทำงาน: 1) รอ Docker 2) compose up (DB/EMQX/API) 3) Frontend :3000
//         4) Launcher Server :4100  — เริ่มเฉพาะตัวที่ยังไม่รัน
//  เรียกใช้: wscript sovereign-autostart.vbs (อยู่ใน Startup folder)
//  ล็อก: autostart.log
// ─────────────────────────────────────────────────────────────
import { spawn, execSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(ROOT, 'sovereign-frontend');
const INFRA = join(ROOT, 'sovereign-os', 'infra');
const NEXT_BIN = join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next');
const LOG = join(ROOT, 'autostart.log');
const DOCKER_WAIT_MS = 180_000;   // รอ Docker Desktop ขึ้นตอน login (สูงสุด 3 นาที)
const FRONTEND_WAIT_MS = 90_000;  // รอ Next dev พร้อมตอบ (สูงสุด 1.5 นาที)

const log = (...a) => console.log(`[${new Date().toLocaleString('th-TH')}]`, ...a);

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(700, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function dockerReady() {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 8000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function waitFor(desc, pred, timeoutMs) {
  const t0 = Date.now();
  let last = false;
  while (Date.now() - t0 < timeoutMs) {
    last = pred();
    if (last) return true;
    const waited = Math.round((Date.now() - t0) / 1000);
    if (waited % 30 === 0) log(`⏳ ยังรอ ${desc}... ${waited}s`);
    execSync('ping -n 3 127.0.0.1 >nul', { stdio: 'ignore', windowsHide: true });
  }
  return last;
}

function detachSpawn(file, args, cwd, logFile) {
  // child หลุดจาก parent — อยู่รอดแม้ autostart.mjs จบ
  const out = logFile ? openSync(logFile, 'a') : 'ignore';
  const child = spawn(file, args, {
    cwd, detached: true, windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  return child;
}

async function main() {
  log('═══ Sovereign OS autostart เริ่ม ═══');

  // 1) รอ Docker Desktop (มันเปิดตอน login แต่ช้า)
  if (dockerReady()) {
    log('✅ Docker พร้อมแล้ว');
  } else if (waitFor('Docker Desktop', dockerReady, DOCKER_WAIT_MS)) {
    log('✅ Docker พร้อม (รอแล้ว)');
  } else {
    log('⚠️ Docker ยังไม่พร้อมใน ' + Math.round(DOCKER_WAIT_MS / 1000) + 's — ข้ามขั้น compose (ถ้าเปิดทีหลัง รัน start-sovereign.bat)');
  }

  // 2) Compose up — idempotent: container รันอยู่แล้ว = no-op
  if (dockerReady() && existsSync(join(INFRA, 'docker-compose.yml'))) {
    try {
      execSync('docker compose up -d timescaledb emqx core-api', {
        cwd: INFRA, stdio: 'ignore', timeout: 120_000, windowsHide: true,
      });
      log('✅ containers ขึ้นแล้ว (timescaledb/emqx/core-api)');
    } catch (e) {
      log('⚠️ compose up ไม่สำเร็จ: ' + (e?.message || e));
    }
  }

  // 3) Frontend dev server บน 3000
  if (await portOpen(3000)) {
    log('✅ Frontend รันอยู่แล้วที่ :3000');
  } else if (existsSync(NEXT_BIN)) {
    detachSpawn('node.exe', [NEXT_BIN, 'dev', '-p', '3000'], FRONTEND, join(ROOT, '.freebuff', 'autostart-frontend.log'));
    log('▶️ กำลังเริ่ม Frontend (next dev -p 3000)...');
    if (await waitFor('Frontend :3000', () => portOpen(3000), FRONTEND_WAIT_MS)) {
      log('✅ Frontend พร้อมแล้ว');
    } else {
      log('⚠️ Frontend ยังไม่ตอบใน ' + Math.round(FRONTEND_WAIT_MS / 1000) + 's — ดู .freebuff/autostart-frontend.log');
    }
  } else {
    log('⚠️ ไม่พบ next bin (' + NEXT_BIN + ') — ข้าม (รัน npm install ที่ sovereign-frontend ก่อน)');
  }

  // 4) Launcher Server บน 4100
  if (await portOpen(4100)) {
    log('✅ Launcher Server รันอยู่แล้วที่ :4100');
  } else {
    detachSpawn('node.exe', ['launcher-server.mjs'], ROOT, join(ROOT, 'launcher-server.log'));
    log('▶️ กำลังเริ่ม Launcher Server...');
    if (await waitFor('Launcher :4100', () => portOpen(4100), 20_000)) {
      log('✅ Launcher Server พร้อมแล้ว → http://localhost:4100');
    } else {
      log('⚠️ Launcher Server ยังไม่ตอบ — ดู launcher-server.log');
    }
  }

  log('═══ autostart เสร็จ — ทุกอย่างที่เป็นไปได้ถูกเปิดแล้ว ═══');
}

main().catch((e) => log('❌ autostart ล้มเหลว: ' + (e?.stack || e)));
