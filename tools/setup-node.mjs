// tools/setup-node.mjs — ติดตั้งเครื่องลูกแบบ "โนดเต็ม" แบบกดครั้งเดียว
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────
// เดิมการเพิ่มเครื่องใหม่ = ก๊อปชุดติดตั้ง (desktop\) แล้วดับเบิลคลิก INSTALL-DESKTOP.cmd
//   แต่ไฟล์นั้น "แค่ก๊อปไฟล์" — ไม่ได้ติดตั้ง Node/Docker ไม่ได้สร้างฐานข้อมูล
//   เคสจริง 11/10/69: เจ้าของก๊อปไปเครื่องใหม่ แอปค้างที่ "กำลังเริ่ม" ตลอด
//   เพราะไม่มีทั้ง Node และ Docker
//
// ── เจ้าของสั่ง 11/10/69 ──────────────────────────────────────────────
//   "อีกเครื่องนึงมีพื้นที่อีก 40GB" → ต้องเป็นเครื่องที่เก็บข้อมูลของตัวเองได้
//   ⇒ เครื่องลูกต้องเป็นระบบเต็ม (มีฐานข้อมูลของตัวเอง) ไม่ใช่แค่ตัวรับคำสั่ง
//
// ── หลักการที่ฝังไว้ ─────────────────────────────────────────────────
// • ตรวจพื้นที่ว่างก่อนเสมอ และบอกตัวเลขจริง — เครื่องนี้เกิดเรื่องดิสก์เต็มจริงแล้ว
// • ติดตั้ง Docker Desktop ผ่าน winget (ถ้ามี) — ไม่งั้นบอกให้ติดตั้งเอง
// • จำกัดขนาด log ของ Docker ไว้ก่อน ไม่งั้นบันทึกจะบวมจนดิสก์เต็ม (เคยเจอ)
// • ลงทะเบียนกับ HUB หลังระบบขึ้น ไม่ใช่ก่อน (ไม่งั้นเครื่อง ghost ที่ไม่มีงาน)
// • ทุกขั้นบันทึกลง log + คืนค่า exit code ชัดเจน (ไม่เดาเงียบๆ ว่าสำเร็จ)
//
// ใช้: node tools/setup-node.mjs [--hub-url=.. --code=.. --name=.. --dir=.. --dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── งบพื้นที่ (วัดจากเครื่องจริง 11/10/69 ไม่ใช่เดา) ──────────────────────
//   docker images ที่ระบบใช้  ~5.2 GB (timescaledb 2.4 · core-api 2.3 · emqx 0.46)
//   ฐานข้อมูลเริ่มต้น      ~0.1 GB (จริงตอนนี้ 60 MB)
//   Node.js                ~0.35 GB
//   ชุดแอปที่ก๊อปไป        ~0.83 GB
//   เผื่อ WAL/log/งาน      ~4 GB
export const SPACE_BUDGET = {
  imagesGb: 5.2,
  databaseGb: 0.5,
  nodeGb: 0.4,
  appGb: 0.9,
  headroomGb: 4,
};
export const MIN_FREE_GB = 12;

export function totalRequiredGb(budget = SPACE_BUDGET) {
  return Object.values(budget).reduce((a, b) => a + b, 0);
}

/**
 * ตัดสินว่าพื้นที่พอไหม — คืนคำตัดสิน + เหตุผลที่อ่านรู้เรื่อง
 * @param {number} freeGb พื้นที่ว่างจริง
 */
export function checkSpace(freeGb, budget = SPACE_BUDGET) {
  const need = totalRequiredGb(budget);
  const free = Number(freeGb);
  if (!Number.isFinite(free) || free < 0) {
    return { ok: false, need, free: freeGb, reason: 'อ่านพื้นที่ว่างไม่ได้ — ข้ามขั้นตรวจไม่ได้ อย่าเดา' };
  }
  if (free < MIN_FREE_GB) {
    return {
      ok: false,
      need,
      free,
      reason: `พื้นที่ว่าง ${free.toFixed(1)} GB — น้อยกว่าเกณฑ์ขั้นต่ำ ${MIN_FREE_GB} GB (ต้องมีของเดิมอยู่ด้วย)`,
    };
  }
  if (free < need) {
    return {
      ok: false,
      need,
      free,
      reason: `พื้นที่ว่าง ${free.toFixed(1)} GB < ที่ต้องใช้ ${need.toFixed(1)} GB — ล้างของเก่าออกก่อน`,
    };
  }
  return { ok: true, need, free, reason: `พื้นที่พอ (ว่าง ${free.toFixed(1)} GB / ต้อง ${need.toFixed(1)} GB)` };
}

/** ตั้งค่า Docker ไม่ให้ log บวมจนดิสก์เต็ม (เขียนก่อนรัน compose) */
export const DOCKER_DAEMON_CONFIG = {
  'log-driver': 'json-file',
  'log-opts': { 'max-size': '10m', 'max-file': '3' },
};

/** รวม config เดิมของเครื่องนั้นเข้าด้วย (อย่าทับของเดิมทิ้ง) */
export function mergeDaemonConfig(existing, add = DOCKER_DAEMON_CONFIG) {
  return { ...(existing ?? {}), ...add, 'log-opts': { ...(existing?.['log-opts'] ?? {}), ...add['log-opts'] } };
}

/** ตัวสั่งงานที่ต้องมีบนเครื่องลูก */
export const REQUIRED_TOOLS = [
  { id: 'node', label: 'Node.js 20+', winget: 'OpenJS.NodeJS.LTS', probe: 'node --version' },
  { id: 'docker', label: 'Docker Desktop', winget: 'Docker.DockerDesktop', probe: 'docker info' },
];

// ── ตัวรันคำสั่ง (ฉีดได้ในเทสต์) ────────────────────────────────────────

export function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

// ── ขั้นตอน ─────────────────────────────────────────────────────────────

/**
 * ตรวจว่ามีเครื่องมือครบไหม (probe แยกทีละตัว — ตัวหนึ่งขาดไม่ควรทำให้อีกตัวหาย)
 * @returns {Promise<Array<{id,label,ok,installed?,needed}>>}
 */
export async function checkTools(tools = REQUIRED_TOOLS, exec = defaultExec) {
  const out = [];
  for (const t of tools) {
    const [bin, ...rest] = String(t.probe).split(' ');
    const r = await exec(bin, rest);
    out.push({ ...t, ok: r.code === 0, installed: r.code === 0 ? (r.stdout || '').trim().split('\n')[0] : '' });
  }
  return out;
}

/** ติดตั้งผ่าน winget ถ้ามี (ไม่มี winget = บอกให้ติดตั้งเอง ไม่เดา) */
export async function installTool(tool, exec = defaultExec) {
  if (!tool.winget) return { ok: false, reason: `ไม่รู้วิธีติดตั้ง ${tool.label} — ให้ติดตั้งเองแล้วรันซ้ำ` };
  const hasWinget = await exec('where', ['winget']);
  if (hasWinget.code !== 0) {
    return { ok: false, reason: `ไม่พบ winget — ติดตั้ง ${tool.label} เองแล้วรันซ้ำ` };
  }
  const r = await exec('winget', [
    'install', '--id', tool.winget, '-e',
    '--accept-source-agreements', '--accept-package-agreements',
  ]);
  return { ok: r.code === 0, reason: r.code === 0 ? 'ติดตั้งแล้ว' : `winget ล้ม (exit ${r.code}) — ${r.stdout.trim().slice(-200)}` };
}

/** เขียน daemon.json ของ Docker Desktop (จำกัดขนาด log) */
export function writeDockerDaemonConfig(configPath, existingText, add = DOCKER_DAEMON_CONFIG) {
  let existing = {};
  if (existingText && String(existingText).trim()) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      // ไฟล์เสีย = ไม่ทับทิ้ง เพราะอาจมีคีย์อื่นที่ตั้งไว้
      throw new Error(`อ่าน ${configPath} ไม่ได้ (JSON เพี้ยน) — ไม่ทับทับของเดิม กรุณาตรวจเอง`);
    }
  }
  const merged = mergeDaemonConfig(existing, add);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return { configPath, config: merged };
}

export { ROOT };