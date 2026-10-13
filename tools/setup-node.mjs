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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ไฟล์ที่ตัวติดตั้งเรียกใช้ "ตอนรันจริง" — ต้องมีในชุดที่แตกทุกครั้ง
 *
 * ประกาศไว้ที่เดียวให้เทสต์ตรวจกับของจริงได้ ไม่งั้นโค้ดกับชุดจะหลุดจากกันเงียบๆ
 *   เคสจริง 12/10/69: โค้ดเช็ค `sovereign-os/agent-runner/setup-machine.mjs`
 *     ซึ่งไม่เคยมีอยู่จริง (อยู่ที่ tools/agent-pack) → เครื่องจริงดึง Docker
 *     หลาย GB มาเสร็จ แล้วล้มทีหลัง = เสียเวลาคนทั้งวัน
 */
export const RUNTIME_FILES = {
  setupFirstTime: 'setup-first-time.bat',
  startSystem: 'start-sovereign.bat',
  enrollScript: 'tools/agent-pack/setup-machine.mjs',
  pruneWalPs1: 'tools/prune-wal.ps1',
  pruneWalCmd: 'tools/hidden-tasks/sovereign-prune-wal.cmd',
};

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

/**
 * ตัวรันคำสั่ง — ส่งผลลัพธ์ออกทาง onOutput ขณะทำงาน
 *
 * ⚠ เคสจริง 12/10/69: เดิมใช้ execFile ซึ่งผูก stdout/stderr เป็น pipe
 *   คนใช้จะเห็นแค่บรรทัดเดียว แล้วหน้าต่างเงียบไป 40 นาที
 *   (npm ci 5 นาที · next build 3 นาที · docker pull ~5.2 GB 30-40 นาที)
 *   คนคิดว่าค้าง แล้วกดปิด — งานทั้งหมดเสียเปล่า
 *   ⇒ ต้องสตรีมขึ้นจอทีละบรรทัดตอนรันจริง
 *
 * คง return shape เดิม {code, stdout, stderr} ไว้ เทสต์เดิมจึงไม่พัง
 * จำกัดบัฟเฟอร์ที่เก็บไว้ที่ท้ายสุด 64 KB — docker pull ผลิต log หลักพันบรรทัด
 * ถ้าเก็บทั้งหมดจะกินหน่วยความจำเครื่องเป้าหมายจนพัง
 */
const CAPTURE_TAIL_BYTES = 64 * 1024;

/** หลังฆ่า process ให้เวลาอีกนิดก่อนฝืนจบ (กันกรณี kill ไม่ตก) */
const KILL_GRACE_MS = 5000;

/**
 * ถอด byte เป็นข้อความให้ถูก encoding
 *
 * ⚠ เคสจริง 12/10/69: `wsl --status` ตอบเป็น **UTF-16LE** (มี null byte คั่นทุกตัวอักษร)
 *   ถ้าอ่านเป็น UTF-8 จะได้ "D e f a u l t ..." และเทียบคำไม่มีวันตรง
 *   ทำให้วินิจฉัย virtualization ผิดเงียบๆ
 *
 * เคสจริงอีกอัน: PowerShell ที่ถูก spawn โดยไม่มี console จะเขียนอักษรไทยออกมาเป็น "?"
 *   แก้ที่ต้นทาง (บังคับ UTF-8) ไม่ได้ทุกโปรแกรม ⇒ ฝั่งเราต้องรับมือให้ได้
 */
export function decodeOutput(buf) {
  if (!buf || buf.length === 0) return '';
  // BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().slice(2).toString('utf16le');
  // ไม่มี BOM แต่มี null byte เป็นช่วง ๆ = UTF-16LE (wsl, หลายตัวบน Windows)
  if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) return buf.toString('utf16le');
  return buf.toString('utf8');
}

/** เก็บ byte ท้ายสุดไว้ N ไบต์ (ตัดจากหน้า) — ใช้กันบัฟเฟอร์บวม */
function appendCapped(buf, chunk) {
  buf.parts.push(chunk);
  buf.bytes += chunk.length;
  while (buf.parts.length > 1 && buf.bytes > CAPTURE_TAIL_BYTES) {
    buf.bytes -= buf.parts.shift().length;
  }
}

/**
 * ตัวรันคำสั่ง
 *
 * ปัญหาที่แก้ (เจอจากการรันจริง ไม่ใช่จากการอ่านโค้ด):
 *  1. เดิมใช้ execFile ผูก stdout/stderr เป็น pipe แล้วทิ้ง
 *     ⇒ npm ci 5 นาที · next build 3 นาที · docker pull 5.2 GB 30-40 นาที
 *       หน้าต่างเงียบสนิท คนคิดว่าค้างแล้วกดปิด = เสียเวลาทั้งวัน
 *  2. รอเฉพาะ 'close' = ต้องรอ stdio ปิดด้วย
 *     ⇒ ถ้าลูกหลาน (docker compose) ถือ stdio ไว้ 'close' จะไม่มีวันมา = ค้างตลอดการติดตั้ง
 *     ต้องรอ 'exit' เป็นหลัก แล้วค่อยเก็บ stdout ที่เหลือ
 *  3. timeout ของ spawn ฆ่าแต่ไม่รับประกันว่า process ตาย
 *     ⇒ ต้องมีนาฬิกาของตัวเอง + ตัดสินว่าหมดเวลา แล้วรายงานว่าหมดเวลา (ไม่ใช่ล้มเงียบๆ)
 */
export function defaultExec(cmd, args, opts = {}) {
  const { onOutput, timeout, ...rest } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...rest });
    } catch (err) {
      resolve({ code: 1, stdout: '', stderr: String(err?.message ?? err) });
      return;
    }
    const outBuf = { parts: [], bytes: 0 };
    const errBuf = { parts: [], bytes: 0 };
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    const done = (code) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      let exitCode = code;
      const stdout = decodeOutput(Buffer.concat(outBuf.parts));
      let stderr = decodeOutput(Buffer.concat(errBuf.parts));
      if (timedOut) {
        // บอกตรงๆ ว่าหมดเวลา ไม่ใช่ให้ไปเดาเองว่าทำไมช้า
        stderr += `\n[หมดเวลา ${Math.round(timeout / 1000)} วิ — ถูกหยุดแล้ว]`;
        // ใช้รหัสมาตรฐานของ timeout เสมอ ไม่ใช่รหัสจริงของ process ที่ถูกฆ่า
        //   (บน Windows การ kill ให้รหัสมั่ว เช่น 1 หรือ null → ผู้เรียกตัดสินใจผิด)
        exitCode = 124;
      }
      resolve({ code: exitCode, stdout, stderr, timedOut });
    };

    const pump = (buf, d) => {
      appendCapped(buf, d);
      if (onOutput) onOutput(decodeOutput(d).replace(/\u0000/g, ''));
    };
    child.stdout?.on('data', (d) => pump(outBuf, d));
    child.stderr?.on('data', (d) => pump(errBuf, d));

    if (timeout && timeout > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* ตายไปแล้ว */ }
        // ฆ่าแล้วยังไม่ exit = อย่ารอต่อ ไม่งั้นค้าง (ปัญหาข้อ 3)
        killTimer = setTimeout(() => done(124), KILL_GRACE_MS);
      }, timeout);
    }

    child.on('error', (err) => {
      appendCapped(errBuf, Buffer.from(String(err?.message ?? err)));
      done(1);
    });
    // 'exit' มาก่อน 'close' เสมอ และมาทันทีเมื่อ process ตาย
    //   การรอ 'close' อย่างเดียวคือทางที่ทำให้ทั้งตัวติดตั้งค้าง
    child.on('exit', (code) => done(typeof code === 'number' ? code : 1));
  });
}

/** โค้ดที่ให้ PowerShell เขียนผลลัพธ์เป็น UTF-8 เสมอ */
export const PS_UTF8_PREFIX = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ';

// ── ขั้นตอน ─────────────────────────────────────────────────────────────

/**
 * ตรวจว่ามีเครื่องมือครบไหม (probe แยกทีละตัว — ตัวหนึ่งขาดไม่ควรทำให้อีกตัวหาย)
 * @returns {Promise<Array<{id,label,ok,installed?,needed}>>}
 */
export async function checkTools(tools = REQUIRED_TOOLS, exec = defaultExec) {
  const out = [];
  for (const t of tools) {
    const [bin, ...rest] = String(t.probe).split(' ');
    // เครื่องมือที่ต้องการแค่ "มี/ไม่มี" = ไม่ต้องโชว์ผลลัพธ์ (docker info ยาวเป็นสิบบรรทัด)
    const r = await exec(bin, rest, { windowsHide: true, onOutput: null });
    out.push({ ...t, ok: r.code === 0, installed: r.code === 0 ? (r.stdout || '').trim().split('\n')[0] : '' });
  }
  return out;
}

/** ติดตั้งผ่าน winget ถ้ามี (ไม่มี winget = บอกให้ติดตั้งเอง ไม่เดา) */
export async function installTool(tool, exec = defaultExec, log = (m) => {}) {
  if (!tool.winget) return { ok: false, reason: `ไม่รู้วิธีติดตั้ง ${tool.label} — ให้ติดตั้งเองแล้วรันซ้ำ` };
  const hasWinget = await exec('where', ['winget']);
  if (hasWinget.code !== 0) {
    return { ok: false, reason: `ไม่พบ winget — ติดตั้ง ${tool.label} เองแล้วรันซ้ำ` };
  }
  // ⚠ Docker Desktop ต้องใช้สิทธิ์ admin (winget จะเรียก UAC)
  //   ถ้าไม่มีสิทธิ์ = winget ล้ม exit 1 บอก "The installer will request to run as administrator"
  //   (เคสจริง 12/10/69: คนต้องกด Yes ใน UAC ถึงจะติดตั้งได้)
  if (tool.id === 'docker') {
    log('  · ตรวจสอบสิทธิ์ admin: Docker Desktop ต้องใช้สิทธิ์ผู้ดูแล — UAC จะขึ้นให้กด Yes');
  }
  const r = await exec('winget', [
    'install', '--id', tool.winget, '-e',
    '--accept-source-agreements', '--accept-package-agreements',
  ]);
  // แสดง stderr ด้วย เพราะ winget บางครั้ง error อยู่ใน stderr
  const errMsg = r.code === 0 ? 'ติดตั้งแล้ว' : `winget ล้ม (exit ${r.code}) — ${(r.stderr || r.stdout || '').trim().slice(-300)}`;
  return { ok: r.code === 0, reason: errMsg };
}

/**
 * เปิด Docker Desktop แล้วรอจน engine ตอบ
 *
 * ⚠ เคสจริง 12/10/69: winget ติดตั้ง Docker Desktop เสร็จก็จบ แต่โปรแกรมยังไม่ถูกเปิด
 *   ⇒ `docker info` ล้มทันที ⇒ ตัวติดตั้งบอก "ยังขาด Docker Desktop" ทั้งที่เพิ่งติดตั้งเสร็จ
 *   คนต้องเดาว่าไปเปิดเองแล้วรันซ้ำ = เสียเวลาไม่รู้เรื่อง
 *
 * Docker Desktop รุ่นใหม่ (4.3x+) มี `docker desktop start` · รุ่นเก่าไม่มี → เปิด exe ตรง
 */
export async function startDockerDesktop({
  exec = defaultExec,
  log = console.log,
  waitMs = 10 * 60 * 1000,
  pollMs = 5 * 1000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const probe = async () => (await exec('docker', ['info'], { windowsHide: true, onOutput: null })).code === 0;

  if (await probe()) return { ok: true, reason: 'ทำงานอยู่แล้ว' };

  const viaCli = await exec('docker', ['desktop', 'start'], { windowsHide: true, timeout: 120 * 1000 });
  if (viaCli.code !== 0) {
    // รุ่นเก่าไม่มีคำสั่งนี้ = เปิดตัวโปรแกรมตรง ๆ
    const exe = path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Docker', 'Docker', 'Docker Desktop.exe',
    );
    if (fs.existsSync(exe)) {
      // ห้าม detached: true — ขัดกับ windowsHide แล้ว Docker Desktop เด้งหน้าต่าง (12/10/69)
    try { spawn(exe, [], { windowsHide: true, stdio: 'ignore' }).unref(); } catch { /* เปิดไม่ได้ = รอต่อแล้วบอก */ }
    }
  }

  log('        (รอ Docker Desktop ตอบ — ครั้งแรกเปิดช้า 1-3 นาที)');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await probe()) return { ok: true, reason: 'Docker Desktop ตอบแล้ว' };
    await sleep(pollMs);
  }
  return {
    ok: false,
    reason: 'รอ 10 นาทีแล้ว Docker ยังไม่ตอบ — เปิด Docker Desktop ด้วยมือแล้วรอให้ไอคอนเป็นเขียว แล้วรันซ้ำ',
  };
}

/**
 * หาสาเหตุจริงที่ Docker Desktop ติดตั้งไม่ได้
 *
 * ⚠ เคสจริง 12/10/69: winget ล้ม exit 1 บอกแค่ "Installer failed"
 *   คนไม่มีทางรู้ว่าเพราะอะไร ต้องเดา → ต้องมีคนไปหาต่อให้
 *   สาเหตุที่เจอบ่อยที่สุด: WSL2 ไม่ได้เปิด (Docker Desktop บังคับใช้)
 *
 * @returns {Promise<string[]>} บรรทัดที่อ่านเป็นภาษาคน
 */
export async function diagnoseDockerInstall({ exec = defaultExec, home = os.homedir() } = {}) {
  const lines = [];

  // WSL2 — Docker Desktop บังคับใช้ (ถ้าไม่มี = ติดตั้งไม่ได้แน่นอน)
  //   ครอบด้วย PowerShell เพื่อบังคับ UTF-8 ไม่งั้น wsl ตอบเป็น UTF-16LE
  //   (เคสจริง 12/10/69: อ่านเป็น UTF-8 ได้ "D e f a u l t" เทียบคำไม่มีวันตรง)
  const wsl = await exec('powershell.exe', [
    '-NoProfile', '-Command', `${PS_UTF8_PREFIX}wsl --status`,
  ], { onOutput: null, timeout: 60 * 1000 });
  if (wsl.code !== 0) {
    lines.push('WSL2 ไม่ได้เปิดใช้งาน — Docker Desktop ต้องใช้ตัวนี้');
    lines.push('  แก้:  wsl --install --no-distribution   แล้วรีสตาร์ทเครื่อง');
  } else {
    lines.push('WSL2: พร้อม');
  }

  // เปิด virtualization ไว้ไหม (VirtualMachinePlatform ต้องได้ด้วย)
  const virt = await exec('powershell.exe', [
    '-NoProfile', '-Command',
    `${PS_UTF8_PREFIX}(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty VirtualizationFirmwareEnabled)`,
  ], { onOutput: null, timeout: 60 * 1000 });
  const virtOn = String(virt.stdout ?? '').toLowerCase().includes('true');
  if (!virtOn) {
    lines.push('Virtualization ปิดอยู่ใน BIOS/UEFI — เปิด Intel VT-x หรือ AMD-V แล้วรีสตาร์ท');
  } else {
    lines.push('Virtualization: เปิดแล้ว');
  }

  // ที่ที่มีคำตอบจริง: Docker เขียน installer.error.json ไว้ตอนติดตั้งล้ม
  //   (เคสจริง 12/10/69: ไม่มีไฟล์นี้เมื่อรันครั้งแรก ต้องรอให้ตัวติดตั้งล้มก่อน
  //    รอบถัดไปจึงจะมีไฟล์นี้ให้อ่าน — เลยต้องดู install-log.txt ด้วย)
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const dockerDir = path.join(localAppData, 'Docker');

  const errJson = path.join(dockerDir, 'installer.error.json');
  try {
    if (fs.existsSync(errJson)) {
      const txt = fs.readFileSync(errJson, 'utf8').replace(/\0/g, '').trim();
      // ไฟล์นี้จะมีอยู่เสมอแม้ติดตั้งสำเร็จ แต่จะว่างเปล่า
      //   (เคสจริง 12/10/69: รายงาน "Docker installer error:" ว่างเปล่า = งงกว่าไม่บอก)
      if (txt && txt !== '{}') {
        lines.push(`Docker installer error: ${txt.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
  } catch { /* ไม่มี/อ่านไม่ได้ = ไปดู log ต่อ */ }

  const logPath = path.join(dockerDir, 'install-log.txt');
  try {
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'latin1');
      const bad = raw.split(/\r?\n/)
        .map((s) => s.replace(/\0/g, '').trim())
        .filter((s) => s && !/^CommandLine:/i.test(s) && !/\.exe"/i.test(s))
        .filter((s) => /(^|[\s:=])(error|failed|failure|exception|denied)\b/i.test(s)
          || /\b0x[0-9a-f]{6,}\b/i.test(s))
        .slice(-4);
      if (bad.length) lines.push(`Docker install log: ${bad.join(' | ').slice(0, 400)}`);
    }
  } catch {
    /* อ่าน log ไม่ได้ = ไม่ใช่เรื่องคอขาดบาดตาย แค่ไม่มีข้อมูลเพิ่ม */
  }

  return lines;
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

// ── จุดเรียกจริง ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const val = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const has = (k) => argv.includes(`--${k}`);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'setup-node.log');
  const lines = [];
  const log = (m = '') => {
    lines.push(m);
    console.log(m);
    try {
      fs.appendFileSync(logFile, m + '\n', 'utf8');
    } catch {
      /* เขียน log ไม่ได้ = ยังทำงานต่อได้ อย่าทำให้ติดตั้งล้มเพราะ log */
    }
  };
  log(`[${new Date().toISOString()}] เริ่มติดตั้งเครื่องลูกแบบโนดเต็ม`);
  const out = await runSetup({
    log,
    name: val('name'),
    hubUrl: val('hub-url'),
    code: val('code'),
    kitDir: ROOT,
    dryRun: has('dry-run'),
  });
  log(`[${new Date().toISOString()}] จบ (exit ${out.exitCode})`);
  process.exitCode = out.exitCode;
}


/**
 * รันทีละขั้น — คืนรายงานที่อ่านรู้เรื่อง
 * ทุกขั้นบันทึกลง log ของตัวเอง และหยุดทันทีที่ขั้นแรกที่ล้ม
 * (ขั้นถัดไปขึ้นกับขั้นก่อนหน้าเสมอ เช่นยังไม่มี Docker ก็ยัง start ไม่ได้)
 */
export async function runSetup(opts = {}) {
  const baseExec = opts.exec ?? defaultExec;
  const log = opts.log ?? console.log;
  // ทุกคำสั่งที่ยาวต้อง "หายใจ" ออกทางจอขณะรัน มิฉะนั้นคนเห็นหน้าค้าง
  //   แล้วกดปิด = เสียเวลาทั้งวัน (เคสจริง 12/10/69)
  const sink = opts.onOutput ?? ((text) => log(String(text).replace(/\s+$/, '')));
  const exec = (cmd, args, o = {}) =>
    baseExec(cmd, args, { ...o, onOutput: 'onOutput' in o ? o.onOutput : sink });
  const home = opts.homedir ?? os.homedir();
  const kitDir = opts.kitDir ?? ROOT;
  // dry-run = รายงานว่าจะทำอะไร แต่ไม่แตะอะไรเลย
  // (เคสจริง 11/10/69: ประกาศไว้แต่ไม่ได้ทำงาน → รันแล้วไปเขียน daemon.json
  //  ของเครื่องจริง อันตรายกว่าที่คิด)
  const dryRun = opts.dryRun === true;
  const steps = [];

  const step = (name, status, detail = '') => {
    steps.push({ name, status, detail });
    const mark = status === 'ok' ? '✔' : status === 'fail' ? '✘' : status === 'warn' ? '!' : '·';
    log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  /** ถ้าเป็น dry-run = ไม่ทำ แต่รายงานว่าจะทำ */
  const wouldDo = (name, detail) => {
    if (!dryRun) return false;
    step(name, 'warn', `[dry-run] จะ${detail}`);
    return true;
  };
  const finish = (ok, exitCode) => {
    log('');
    if (dryRun) {
      log('  ℹ️  DRY RUN — ไม่ได้แก้อะไรทั้งสิ้น (ลบ --dry-run เพื่อติดตั้งจริง)');
    } else {
      log(ok
        ? '  ✅ ติดตั้งเสร็จ — เครื่องนี้พร้อมรับคำสั่งจาก HUB'
        : '  ❌ ยังไม่เสร็จ — อ่านข้อความด้านบน (ทุกอย่างอยู่ใน logs/setup-node.log)');
    }
    return { ok, exitCode, steps, dryRun };
  };

  log('══════════════════════════════════════════════════');
  log('  Sovereign OS — ติดตั้งเครื่องลูกแบบโนดเต็ม');
  log('══════════════════════════════════════════════════');
  log(`  ชุดติดตั้ง: ${kitDir}`);
  log(`  เครื่องนี้: ${opts.name || os.hostname()}`);
  if (dryRun) log('  ⚠ DRY RUN — จะตรวจอย่างเดียว ไม่แก้อะไร');
  log('');

  // 1) พื้นที่ — ตรวจก่อนทุกอย่าง เพราะถ้าไม่พอ อย่าเพิ่งไป pull อะไร
  const freeGb = opts.freeGb ?? freeSpaceGb(kitDir);
  const space = checkSpace(freeGb);
  if (!space.ok) {
    step('พื้นที่ว่าง', 'fail', space.reason);
    return finish(false, 1);
  }
  step('พื้นที่ว่าง', 'ok', space.reason);

  // 2) เครื่องมือ — ตรวจทีละตัว ตัวไหนขาดค่อยติดตั้งเฉพาะตัวนั้น
  let tools = await checkTools(REQUIRED_TOOLS, exec);
  const missing = tools.filter((t) => !t.ok);
  if (missing.length) {
    step('ตรวจเครื่องมือ', 'warn', `ขาด ${missing.map((t) => t.label).join(', ')}`);
    if (!wouldDo('ติดตั้งเครื่องมือ', `ติดตั้ง ${missing.map((t) => t.label).join(', ')} ผ่าน winget`)) {
      for (const t of missing) {
        // ⚠ ตรวจสอบ Docker prerequisites ก่อนลง winget (กัน winget ล้มเงียบๆ)
        if (t.id === 'docker') {
          step('ตรวจสอบ Docker prerequisites', 'warn', 'กำลังตรวจสอบ WSL2 / Virtualization...');
          for (const d of await diagnoseDockerInstall({ exec })) step('  ·', 'warn', d);
        }
        const r = await installTool(t, exec, step);
        step(`ติดตั้ง ${t.label}`, r.ok ? 'ok' : 'fail', r.reason);
        // winget ติดตั้ง Docker Desktop เสร็จ = ยังไม่ได้ "เปิด" เครื่อง
        //   docker info จะล้มทันทีที่ยังไม่ได้ start ⇒ ต้องเปิดและรอให้เสร็จเอง
        //   ไม่งั้นคนต้องเดาว่าไปกดเปิด Docker เอง (เคสจริง 12/10/69)
        if (r.ok && t.id === 'docker') {
          const boot = await startDockerDesktop({ exec, log });
          step('เปิด Docker', boot.ok ? 'ok' : 'fail', boot.reason);
        }
        // ติดตั้งไม่สำเร็จ = หาสาเหตุจริงให้ ไม่ใช่ปล่อยให้คนเดา
        //   "Installer failed with exit code: 1" บอกอะไรไม่ได้เลย (เคสจริง 12/10/69)
        if (!r.ok && t.id === 'docker') {
          for (const d of await diagnoseDockerInstall({ exec })) step('  ·', 'warn', d);
        }
      }
      tools = await checkTools(REQUIRED_TOOLS, exec);
    }
  }
  const stillMissing = tools.filter((t) => !t.ok);
  if (stillMissing.length) {
    step('เครื่องมือ', 'fail', stillMissing.some((t) => t.id === 'docker')
      ? 'Docker Desktop ยังไม่ตอบ — เปิด Docker Desktop ด้วยมือ แล้วรอจนไอคอนเป็นเขียว แล้วรันซ้ำ'
      : `ยังขาด ${stillMissing.map((t) => t.label).join(', ')} — ติดตั้งเองแล้วรันซ้ำ`);
    return finish(false, 2);
  }
  step('เครื่องมือ', 'ok', tools.map((t) => `${t.label} ${t.installed || 'พร้อม'}`).join(' · '));

  // 3) จำกัดขนาด log ของ Docker — ต้องทำก่อน compose ไม่งั้นบันทึกเริ่มบวม
  const daemonPath = path.join(home, '.docker', 'daemon.json');
  if (wouldDo('จำกัดขนาด log', `เขียน ${daemonPath}`)) {
    // รายงานเฉพาะข้อมูลเดิม ไม่แก้ไฟล์
  } else {
    try {
      const prev = fs.existsSync(daemonPath) ? fs.readFileSync(daemonPath, 'utf8') : '';
      const r = writeDockerDaemonConfig(daemonPath, prev);
      step('จำกัดขนาด log', 'ok', `${r.config['log-opts']['max-size']} × ${r.config['log-opts']['max-file']} (ต้องรีสตาร์ท Docker เพื่อมีผล)`);
    } catch (err) {
      step('จำกัดขนาด log', 'warn', String(err?.message ?? err));
    }
  }

  // 4) Docker ตอบแล้วจริงไหม (compose จะล้มถ้ายังไม่พร้อม)
  const docker = await exec('docker', ['info']);
  if (docker.code !== 0) {
    step('Docker', 'fail', 'ยังไม่ตอบ — เปิด Docker Desktop แล้วรันซ้ำ');
    return finish(false, 3);
  }
  step('Docker', 'ok', 'ตอบปกติ');

  // 5) ตั้งค่าครั้งแรก (สร้าง infra/.env จากตัวอย่าง) — ข้ามถ้าทำแล้ว
  const infraEnv = path.join(kitDir, 'sovereign-os', 'infra', '.env');
  if (fs.existsSync(infraEnv)) {
    step('ตั้งค่าครั้งแรก', 'ok', 'มี .env อยู่แล้ว — ไม่ทับ');
  } else if (wouldDo('ตั้งค่าครั้งแรก', 'รัน setup-first-time.bat')) {
    /* ไม่รันจริงในโหมดตรวจ */
  } else {
    const firstTime = await runBatch(path.join(kitDir, RUNTIME_FILES.setupFirstTime), exec);
    if (!firstTime.ok) {
      step('ตั้งค่าครั้งแรก', 'fail', firstTime.reason);
      return finish(false, 4);
    }
    step('ตั้งค่าครั้งแรก', 'ok', 'สร้าง .env แล้ว');
  }

  // 6) ติดตั้ง dependency บนเครื่องนี้ — ชุดที่ดาวน์โหลดมาไม่ได้พา node_modules มา
  //    (483 MB ฝั่ง frontend · ถ้าใส่ในชุดจะใหญ่กว่านี้มาก · และ npm ci บนเครื่องเป้าหมาย
  //    เร็วกว่าดาวน์โหลด+แตก) — start-sovereign.bat จะเรียก `npm run build` ซึ่งต้องมี node_modules
  const depsTargets = [
    path.join(kitDir, 'sovereign-frontend'),
    path.join(kitDir, 'sovereign-os', 'core-api'),
  ].filter((d) => fs.existsSync(path.join(d, 'package.json')));

  for (const dir of depsTargets) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(nm)) {
      step(`dependency ${path.basename(dir)}`, 'ok', 'มี node_modules อยู่แล้ว — ข้าม');
      continue;
    }
    if (wouldDo(`dependency ${path.basename(dir)}`, 'npm ci')) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // ไม่มี lockfile = npm ci ใช้ไม่ได้ (ต้องไป install) — บอกชัดแทนที่จะล้มเงียบๆ
    const lock = fs.existsSync(path.join(dir, 'package-lock.json'));
    const cmd = lock ? 'ci' : 'install';
    step(`dependency ${path.basename(dir)}`, 'warn', `กำลัง npm ${cmd} (3-6 นาที · ยังไม่ค้าง) · รุ่น ${pkg.version ?? '?'}`);
    const t0 = Date.now();
    const r = await exec('npm', [cmd, '--no-audit', '--no-fund'], { windowsHide: true, cwd: dir, timeout: 20 * 60 * 1000 });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (r.code !== 0 || !fs.existsSync(nm)) {
      step(`dependency ${path.basename(dir)}`, 'fail', `npm ${cmd} ล้ม (exit ${r.code}) — ต้องมีอินเทอเน็ต`);
      return finish(false, 45);
    }
    step(`dependency ${path.basename(dir)}`, 'ok', `ติดตั้งแล้ว (${secs} วิ)`);
  }

  // 7) เริ่มระบบ (ฐานข้อมูล + API + เว็บ)
  if (wouldDo('เริ่มระบบ', 'รัน start-sovereign.bat (ดึง Docker ~5 GB — 30-45 นาที ไม่ต้องกลัวค้าง)')) {
    return finish(true, 0); // dry-run จบตรงนี้ ไม่ต้องไปข้างล่าง
  }
  const tStart = Date.now();
  const started = await runBatch(path.join(kitDir, RUNTIME_FILES.startSystem), exec);
  if (!started.ok) {
    step('เริ่มระบบ', 'fail', started.reason);
    return finish(false, 5);
  }
  step('เริ่มระบบ', 'ok', `ฐานข้อมูล + API + เว็บ ทำงานแล้ว (${Math.round((Date.now() - tStart) / 60000)} นาที)`);

  // 8) ลงทะเบียนกับ HUB — หลังระบบขึ้น ไม่งั้นเครื่อง ghost ที่ไม่มีงาน
  // ⚠ setup-machine.mjs อยู่ใน tools/agent-pack ไม่ใช่ agent-runner
  //   (เคสจริง 12/10/69: ตรวจพาธเดิมตอนรันครั้งแรก → ไม่พบไฟล์ = เครื่องจริงติดตั้งไม่เสร็จ
  //    หลังดึง Docker หลาย GB มาแล้ว = เสียเวลาคนทั้งวัน) เทสต์ kit-files จับกรณีนี้
  const runnerDir = path.join(kitDir, 'sovereign-os', 'agent-runner');
  const setupMachine = path.join(kitDir, RUNTIME_FILES.enrollScript);
  if (!fs.existsSync(setupMachine)) {
    step('ลงทะเบียน HUB', 'fail', 'ไม่พบ tools/agent-pack/setup-machine.mjs — ชุดติดตั้งไม่ครบ');
    return finish(false, 6);
  }
  if (wouldDo('ลงทะเบียน HUB', `POST /enroll ที่ ${opts.hubUrl || 'HUB'} ด้วยรหัสเชิญ`)) {
    return finish(true, 0);
  }
  const enrollArgs = [
    setupMachine,
    '--enroll',
    ...(opts.hubUrl ? [`--hub-url=${opts.hubUrl}`] : []),
    ...(opts.code ? [`--code=${opts.code}`] : []),
    ...(opts.name ? [`--name=${opts.name}`] : []),
    '--dir=' + runnerDir,
  ];
  const enroll = await exec(process.execPath, enrollArgs);
  if (enroll.code !== 0) {
    step('ลงทะเบียน HUB', 'fail', (enroll.stdout || enroll.stderr || '').trim().split('\n').slice(-2).join(' '));
    return finish(false, 7);
  }
  step('ลงทะเบียน HUB', 'ok', (enroll.stdout || '').trim().split('\n').filter(Boolean).pop() ?? 'สำเร็จ');

  // 9) กันดิสก์เต็ม — ติดตั้งงานตัด WAL อัตโนมัติ
  if (!wouldDo('กันดิสก์เต็ม', 'ตั้งงานตัด WAL ทุกคืน 04:30')) {
    const guard = await installWalGuard({ kitDir, exec });
    step('กันดิสก์เต็ม', guard.ok ? 'ok' : 'warn', guard.reason);
  }

  return finish(true, 0);
}

/** รันไฟล์ .bat (ต้องผ่าน cmd.exe — Windows ไม่รัน .bat โดยตรง) */
export async function runBatch(batPath, exec = defaultExec, timeoutMs = 60 * 60 * 1000) {
  if (!fs.existsSync(batPath)) return { ok: false, reason: `ไม่พบ ${path.basename(batPath)}` };
  // ครั้งแรกดึง Docker หลาย GB = นาทีจนถึงชั่วโมง ตั้งเวลาให้พอสมเหตุสมผล
  const r = await exec('cmd.exe', ['/c', batPath], { windowsHide: true, timeout: timeoutMs });
  return {
    ok: r.code === 0,
    reason: r.code === 0
      ? 'สำเร็จ'
      : r.timedOut
        ? `หมดเวลา ${Math.round(timeoutMs / 60000)} นาที — ดู ${path.basename(batPath)}`
        : `exit ${r.code} — ดู ${path.basename(batPath)} หรือ start-sovereign.log`,
  };
}

/** ติดตั้งงานตัด WAL อัตโนมัติ (ตัวเดียวกับที่ทำไว้ที่เครื่อง HUB) */
export async function installWalGuard({ kitDir, exec = defaultExec }) {
  const ps1 = path.join(kitDir, RUNTIME_FILES.pruneWalPs1);
  const cmd = path.join(kitDir, RUNTIME_FILES.pruneWalCmd);
  if (!fs.existsSync(ps1) || !fs.existsSync(cmd)) {
    return { ok: false, reason: 'ชุดติดตั้งไม่มีตัวตัด WAL — ติดตั้งเองภายหลังได้' };
  }
  const r = await exec('schtasks', [
    '/Create', '/F',
    '/TN', 'Sovereign Prune WAL',
    '/TR', `"${cmd}"`,
    '/SC', 'DAILY',
    '/ST', '04:30',
  ]);
  if (r.code !== 0) {
    return { ok: false, reason: `ตั้งงานไม่สำเร็จ (exit ${r.code}) — รันด้วยสิทธิ์ผู้ดูแลระบบ` };
  }
  return { ok: true, reason: 'ตัด WAL เก่าทุกคืน 04:30' };
}

/** พื้นที่ว่างของไดรฟ์ที่เก็บ path (GB) */
export function freeSpaceGb(target) {
  try {
    // เดินขึ้นไปจนเจอรากไดรฟ์
    let dir = path.resolve(target);
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const stat = fs.statfsSync?.(dir);
    if (stat) return stat.bavail * stat.bsize / 1024 ** 3;
  } catch {
    /* ไม่ได้ = คืน NaN ให้ checkSpace ตัดสินเอง (fail-closed) */
  }
  return Number.NaN;
}