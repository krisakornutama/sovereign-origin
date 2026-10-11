// src/main.mjs — จุดเริ่ม runner บนเครื่องคอม
//
// วิธีใช้:
//   1) ผู้ใช้เปิดหน้าเว็บ HUB → ลงทะเบียนเครื่อง → ได้ token
//   2) copy .env.example เป็น .env แล้วใส่ HUB_URL + MACHINE_TOKEN
//   3) node src/main.mjs
//
// ไม่ต้องแตะ HUB เอง (runner เป็นฝั่ง client เปิดขาออกเท่านั้น)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner, uploadScreenshot, resolveCaptureScreenshot } from './runner.mjs';
import { createControlClient } from './control.mjs';
import { createControlHub } from './hub-control.mjs';
import { resolveAllowedRoots } from './fsops.mjs';
import { selfUpdateOnce, planBoot, markHealthy, HANDOFF_EXIT_CODE } from './selfUpdate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

// อ่าน .env แบบเอง (ไม่พึ่ง dotenv — runner ต้องเบา)
function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

const fileEnv = loadEnv(envPath);
const env = { ...fileEnv, ...process.env };

const config = {
  hubUrl: (env.HUB_URL || 'http://127.0.0.1:3001').replace(/\/$/, ''),
  token: env.MACHINE_TOKEN || '',
  machineName: env.MACHINE_NAME || 'runner',
  executors: (env.ENABLED_EXECUTORS || 'echo').split(',').map((s) => s.trim()).filter(Boolean),
  intervalMs: Number(env.POLL_INTERVAL_MS || 15000),
  opencodeBin: env.OPENCODE_BIN || 'opencode',
  heartbeatSec: Number(env.HEARTBEAT_SEC || 30),
  // จับภาพหน้าจอตอนจบงาน — เปิดเป็นค่าเริ่มต้น (ปิดได้ด้วย CAPTURE_SCREENSHOT=false)
  captureScreenshot: resolveCaptureScreenshot(env.CAPTURE_SCREENSHOT),
  // ช่องควบคุมระยะไกล (ดูจอ/เมาส์/คีย์บอร์ด/ไฟล์) — เปิดเป็นค่าเริ่มต้น
  // เพราะเป็นเหตุผลที่เครื่องนี้ลงทะเบียนกับ HUB ตั้งแต่แรก · ปิดได้ที่เครื่องนี้เอง
  remoteControl: resolveCaptureScreenshot(env.ENABLE_REMOTE_CONTROL),
  remoteMaxWidth: Number(env.REMOTE_MAX_WIDTH || 1280),
  // เบรกมือฝั่งเครื่อง: ว่าง = ทั้งไดรฟ์ (ตามที่เจ้าของเลือก) · ระบุได้เพื่อรัดให้แคบลง
  remoteFsRoots: resolveAllowedRoots(env),
  // อัปเดตโค้ดตัวเองจาก HUB (ปิดได้ที่เครื่องนี้ด้วย SELF_UPDATE=false)
  selfUpdate: resolveCaptureScreenshot(env.SELF_UPDATE),
  selfUpdateIntervalMs: Number(env.SELF_UPDATE_INTERVAL_SEC || 6 * 60 * 60) * 1000,
  selfUpdateStartDelayMs: Number(env.SELF_UPDATE_START_DELAY_SEC || 30) * 1000,
};

// ── เครื่องลูกอัปเดตโค้ดเอง: ธงสั่งงานจากบรรทัดคำสั่ง ──────────────────────────
//   --self-update   เช็ค+ติดตั้ง+รีสตาร์ท เดี๋ยวนี้แล้วจบ (ใช้ตอน diagnose/สั่งจาก HUB)
//   --check-update  ดูเวอร์ชันเฉย ๆ ไม่แตะไฟล์ (ใช้ตอนอยากรู้ว่าต่างกันไหม)
//   --print-version พิมพ์เวอร์ชันโค้ดที่กำลังรัน
//   --no-self-update ปิดการอัปเดตในรอบนี้ (ใช้เมื่อสงสัยว่าโค้ดใหม่ทำเครื่องพัง)
const argv = process.argv.slice(2);
const wantCheck = argv.includes('--check-update');
const wantSelfUpdate = argv.includes('--self-update');
const wantVersion = argv.includes('--print-version');
if (argv.includes('--no-self-update')) config.selfUpdate = false;
const runnerRoot = join(here, '..');

if (!config.token) {
  console.error('[runner] ขาด MACHINE_TOKEN — copy .env.example เป็น .env แล้วใส่ token ที่ได้จากหน้าเว็บ HUB');
  process.exit(1);
}

console.log(
  `[runner] เครื่อง=${config.machineName} hub=${config.hubUrl} executor=${config.executors.join(',')}` +
    ` captureScreenshot=${config.captureScreenshot}`
);

// ── ช่วงหัวของการบูต: ประกาศตัวว่า "ฉันคือเวอร์ชันที่เพิ่งอัปเดตมา" ──
// ถ้าอัปเดตแล้วโปรเซสใหม่ "ไม่ประกาศตัว" = ผู้ดูแลย้อนกลับให้เอง (ดู restartSupervised)
const boot = planBoot(runnerRoot, { log: (m) => console.log(m) });
if (boot.action === 'starting') setTimeout(() => markHealthy(runnerRoot), 10_000).unref?.();

if (wantVersion || wantCheck || wantSelfUpdate) {
  try {
    const out = await selfUpdateOnce({
      hubUrl: config.hubUrl,
      token: config.token,
      dir: runnerRoot,
      log: (m) => console.log(`[runner] ${m}`),
      apply: wantSelfUpdate,
      restart: wantSelfUpdate,
    });
    console.log(
      `[runner] ตรวจเวอร์ชัน: ${out.status}` +
        ` (เครื่องนี้ ${out.localVersion ?? '-'} · HUB ${out.remoteVersion ?? '-'})${out.reason ? ` — ${out.reason}` : ''}`
    );
    if (out.status === 'restarted' && out.handoff?.exitCode === HANDOFF_EXIT_CODE) process.exit(HANDOFF_EXIT_CODE);
    process.exit(0);
  } catch (err) {
    console.error(`[runner] ตรวจ/ติดตั้งอัปเดตไม่สำเร็จ: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// รอบอัตโนมัติ: เช็คตอนเริ่ม (หลังปล่อยให้ลูปงานทำงานก่อน) แล้ววนเป็นระยะ
// ไม่ await — การอัปเดตห้ามถ่วงการรับงาน
function startSelfUpdateLoop() {
  if (!config.selfUpdate) {
    console.log('[runner] อัปเดตโค้ดตัวเอง=ปิด (SELF_UPDATE=false หรือ --no-self-update)');
    return;
  }
  const tick = async () => {
    try {
      const out = await selfUpdateOnce({
        hubUrl: config.hubUrl,
        token: config.token,
        dir: runnerRoot,
        log: (m) => console.log(`[runner] ${m}`),
      });
      if (out.status !== 'up-to-date') {
        console.log(
          `[runner] อัปเดตโค้ด: ${out.status}` +
            ` (เครื่องนี้ ${out.localVersion ?? '-'} · HUB ${out.remoteVersion ?? '-'})${out.reason ? ` — ${out.reason}` : ''}`
        );
      }
      if (out.status === 'restarted') {
        // โปรเซสใหม่ทำงานแล้ว — รอบนี้ยกให้มัน แล้วตัวห่อ (run-runner.cmd) จะไม่เริ่มซ้ำ
        runner.stop();
        control?.stop();
        process.exit(HANDOFF_EXIT_CODE);
      }
    } catch (err) {
      console.error(`[runner] อัปเดตโค้ดเองล้มเหลว (รอบนี้ข้าม): ${err instanceof Error ? err.message : err}`);
    }
  };
  setTimeout(tick, config.selfUpdateStartDelayMs).unref?.();
  setInterval(tick, config.selfUpdateIntervalMs).unref?.();
  console.log(
    `[runner] อัปเดตโค้ดตัวเอง=เปิด (เช็คครั้งแรกใน ${Math.round(config.selfUpdateStartDelayMs / 1000)} วิ · ` +
      `ทุก ${Math.round(config.selfUpdateIntervalMs / 3600000)} ชม. · รีสตาร์ทตัวเองเมื่อมีเวอร์ชันใหม่)`
  );
}

async function api(path, body) {
  const res = await fetch(`${config.hubUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-machine-token': config.token },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

const hub = {
  heartbeat: async () => api('/api/agent-machines/heartbeat', { version: process.version }),
  pullJobs: async () => {
    const out = await api('/api/agent-machines/jobs/pull', { limit: 3 });
    // กรองซ้ำอีกชั้นในเครื่อง — HUB ก็กรอง แต่เครื่องเป็นคนรับผิดชอบสุดท้าย
    return (out.jobs || []).filter((j) => config.executors.includes(j.executor));
  },
  reportResult: async (id, payload) => api(`/api/agent-machines/jobs/${id}/result`, payload),
  // ภาพหน้าจอเป็น multipart ไม่ใช่ JSON — ใช้ uploadScreenshot โดยเฉพาะ
  uploadScreenshot: (id, buffer) =>
    uploadScreenshot({ hubUrl: config.hubUrl, token: config.token, jobId: id, buffer }),
};

const runner = createRunner({
  config,
  hub,
  runner: {
    machineName: config.machineName,
    opencodeBin: config.opencodeBin,
    captureScreenshot: config.captureScreenshot,
  },
});

// ── ช่องควบคุมระยะไกล (ดูจอ/เมาส์/คีย์บอร์ด/ไฟล์) ──
// วนคู่ขนานกับลูปงาน AI คนละลูป — งาน AI ที่ยาวเป็นชั่วโมงต้องไม่บล็อกการดูจอ
let control = null;
if (config.remoteControl) {
  // ⚠️ ต้องเป็น adapter ของ "ช่องควบคุม" เท่านั้น
  //    (เคยพลาด: ส่ง `hub` ก้อนเดียวกับงาน AI ⇒ ผลลัพธ์คำสั่งถูกยิงไปที่
  //     /api/agent-machines/jobs/<commandId>/result แทนที่จะเป็น /api/machine-control/result
  //     ⇒ ผู้ใช้เห็น "คำสั่งไม่ทำงาน" โดยไม่มี error ให้จับ)
  control = createControlClient({
    // hubUrl/token/runnerRoot ต้องส่งเข้าไปด้วย — คำสั่ง update.check/update.apply
    // ต้องรู้ว่าจะไปถามเวอร์ชันที่ไหน และอัปเดตโค้ดที่โฟลเดอร์ใด
    config: { intervalMs: 0, hubUrl: config.hubUrl, token: config.token, runnerDir: runnerRoot },
    hub: createControlHub({ hubUrl: config.hubUrl, token: config.token }),
    roots: config.remoteFsRoots,
    onError: (msg) => console.error(msg),
  });
  console.log(
    `[runner] ช่องควบคุมระยะไกล=เปิด (กว้างสุด ${config.remoteMaxWidth}px · ` +
      `ขอบเขตไฟล์: ${config.remoteFsRoots.length ? config.remoteFsRoots.join(' | ') : 'ทั้งไดรฟ์'} · ` +
      `สั่งได้เฉพาะ SUPERADMIN ที่ HUB)`,
  );
  // ไม่ await: รอบแรกค้างรอคำสั่งได้นานถึง 25 วิ — ไม่ควรถ่วงการเริ่มทำงานของลูปงาน AI
  void control.start();
} else {
  console.log('[runner] ช่องควบคุมระยะไกล=ปิด (ENABLE_REMOTE_CONTROL=false)');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[runner] ได้รับ ${sig} — หยุดวน loop`);
    runner.stop();
    control?.stop();
    process.exit(0);
  });
}

runner.start();
startSelfUpdateLoop();