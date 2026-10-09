// tools/agent-pack/setup-machine.mjs
//
// ── ตัวติดตั้งฝั่ง "เครื่องลูก" — ถูกคัดลอกไปอยู่ในชุดติดตั้ง ─────────────────────
// ผู้ใช้ไม่ต้องพิมพ์ token/IP/.env เอง: อ่าน join.json ที่ตัวแพ็กฝังมาให้ → ตรวจสายกับ HUB
// → เขียน .env → พิสูจน์ด้วย heartbeat ว่าเครื่องออนไลน์จริง → ตั้ง autostart ให้
//
//   ดับเบิลคลิก SETUP-MACHINE.cmd        (หรือ node setup-machine.mjs [--force] [--no-task])
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TASK_NAME = 'Sovereign Agent Runner';

/** โฟลเดอร์ที่อนุญาตให้ HUB จัดการไฟล์ — ค่าเริ่มต้น: โปรไฟล์ผู้ใช้ + ไดรฟ์ที่ติดตั้ง */
export function defaultFsRoots(dir, home = os.homedir()) {
  const roots = [];
  if (home) roots.push(home);
  const drive = path.parse(path.resolve(dir)).root;
  if (drive && !roots.some((r) => r.toLowerCase() === drive.toLowerCase())) roots.push(drive);
  return roots;
}

/** เนื้อหา .env ของเครื่องลูก (CRLF เพราะเป็นไฟล์บน Windows) */
export function buildEnvFile({ hubUrl, token, machineName, executors = 'echo', fsRoots }) {
  const roots = Array.isArray(fsRoots) && fsRoots.length ? fsRoots : defaultFsRoots('.');
  return [
    '# สร้างอัตโนมัติโดย SETUP-MACHINE.cmd — แก้ไขได้ตามต้องการ (ห้าม commit)',
    `HUB_URL=${hubUrl}`,
    `MACHINE_TOKEN=${token}`,
    `MACHINE_NAME=${machineName}`,
    `ENABLED_EXECUTORS=${executors}`,
    '',
    '# ช่องควบคุมระยะไกล (ดูจอ/เมาส์/คีย์บอร์ด/ไฟล์) — สั่งได้เฉพาะ SUPERADMIN ที่ HUB',
    'ENABLE_REMOTE_CONTROL=true',
    'REMOTE_MAX_WIDTH=1280',
    `REMOTE_FS_ROOTS=${roots.join(';')}`,
    '',
    '# จับภาพหน้าจอตอนจบงาน + รอบดึงงาน',
    'CAPTURE_SCREENSHOT=true',
    'POLL_INTERVAL_MS=15000',
    '',
  ].join('\r\n');
}

export function readJoin(dir) {
  const file = path.join(dir, 'join.json');
  if (!fs.existsSync(file)) {
    return { ok: false, error: `ไม่พบ join.json ใน ${dir} — ชุดติดตั้งไม่ครบ (ควรมี join.json, setup-machine.mjs, src/)` };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, error: `join.json อ่านไม่ได้: ${String(err?.message ?? err)}` };
  }
  const hubUrl = String(parsed?.hubUrl ?? '').trim().replace(/\/$/, '');
  const machineToken = String(parsed?.machineToken ?? '').trim();
  const machineName = String(parsed?.machineName ?? '').trim() || os.hostname();
  if (!/^https?:\/\//.test(hubUrl)) return { ok: false, error: 'join.json ไม่มี hubUrl ที่ถูกต้อง' };
  if (!machineToken) return { ok: false, error: 'join.json ไม่มี machineToken' };
  return { ok: true, hubUrl, machineToken, machineName };
}

function defaultExec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function tokenFromEnvText(text) {
  const m = /^\s*MACHINE_TOKEN\s*=\s*(.*)$/m.exec(String(text ?? ''));
  return m ? m[1].trim() : '';
}

/**
 * ติดตั้งเครื่องนี้เป็นเครื่องลูก
 * @returns {{ ok: boolean, exitCode: number, steps: Array<{name:string,status:string,detail:string}>, report: string, hubUrl: string, machineName: string }}
 */
export async function runSetup({
  dir = HERE,
  fetchImpl = fetch,
  exec = defaultExec,
  platform = process.platform,
  home = os.homedir(),
  machineName = '',
  executors = 'echo',
  force = false,
  skipTask = false,
  log = console.log,
} = {}) {
  const steps = [];
  const lines = [];
  const add = (name, status, detail = '') => {
    steps.push({ name, status, detail });
    const mark = status === 'ok' ? '✔' : status === 'fail' ? '✘' : status === 'warn' ? '!' : '·';
    const line = `  ${mark} ${name}${detail ? ` — ${detail}` : ''}`;
    lines.push(line);
    log(line);
  };
  const finish = (ok, exitCode, hubUrl = '', name = '') => {
    lines.push('');
    if (ok) lines.push('  ✅ ออนไลน์แล้ว — เปิดหน้าเว็บ HUB → คิวเอเจนต์ จะเห็นเครื่องนี้');
    return { ok, exitCode, steps, report: lines.join('\n'), hubUrl, machineName: name };
  };

  lines.push('══════════════════════════════════════════════════');
  lines.push('  Sovereign OS — ติดตั้งเครื่องนี้เป็นเครื่องลูก');
  lines.push('══════════════════════════════════════════════════');

  // 1) ชุดติดตั้งครบไหม
  const join = readJoin(dir);
  if (!join.ok) {
    add('join', 'fail', join.error);
    return finish(false, 1);
  }
  const name = String(machineName || join.machineName || os.hostname()).trim() || join.machineName;
  add('join', 'ok', `เครื่อง "${name}" → HUB ${join.hubUrl}`);

  // 2) ต่อ HUB ได้ไหม (ก่อนแตะไฟล์)
  let health;
  try {
    const res = await fetchImpl(`${join.hubUrl}/api/health`, { method: 'GET' });
    health = { status: res?.status ?? 0, ok: Boolean(res?.ok || (res?.status ?? 0) < 400) };
  } catch (err) {
    health = { status: 0, ok: false, error: String(err?.message ?? err) };
  }
  if (!health.ok) {
    add('hub', 'fail', `ต่อ ${join.hubUrl}/api/health ไม่ได้ (${health.error || health.status})`);
    lines.push('  ตรวจ: HUB เปิดอยู่ไหม · เปิด firewall พอร์ต 3000 (profile private) · Wi-Fi วงเดียวกันไหม');
    lines.push(`  ทดสอบเองได้: curl -L ${join.hubUrl}/api/health`);
    return finish(false, 1, join.hubUrl, name);
  }
  add('hub', 'ok', `HUB ตอบ ${health.status} ที่ ${join.hubUrl}`);

  // 3) .env (ไม่ทับของเดิมที่ไม่ใช่ token ชุดนี้)
  const envPath = path.join(dir, '.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
  let wroteEnv = false;
  if (existing) {
    const existingToken = tokenFromEnvText(existing);
    if (existingToken === join.machineToken) {
      add('env', 'ok', 'มี .env ของเครื่องนี้อยู่แล้ว (ไม่แก้)');
    } else if (!force) {
      add('env', 'fail', 'มี .env อยู่แล้วแต่ token ไม่ตรงกับชุดติดตั้งนี้');
      lines.push('  ถ้าตั้งใจให้เครื่องนี้ใช้ token ใหม่: รันซ้ำด้วย --force (จะสำรอง .env เดิมเป็น .env.bak)');
      lines.push('  ถ้าไม่ตั้งใจ: ตรวจว่าคุณกำลังติดตั้งทับเครื่องที่ใช้งานอยู่หรือไม่');
      return finish(false, 1, join.hubUrl, name);
    } else {
      fs.writeFileSync(`${envPath}.bak`, existing, 'utf8');
      fs.writeFileSync(envPath, buildEnvFile({ hubUrl: join.hubUrl, token: join.machineToken, machineName: name, executors, fsRoots: defaultFsRoots(dir, home) }), 'utf8');
      wroteEnv = true;
      add('env', 'warn', 'เขียน .env ใหม่ (สำรองของเดิมเป็น .env.bak)');
    }
  } else {
    fs.writeFileSync(envPath, buildEnvFile({ hubUrl: join.hubUrl, token: join.machineToken, machineName: name, executors, fsRoots: defaultFsRoots(dir, home) }), 'utf8');
    wroteEnv = true;
    add('env', 'ok', `เขียน .env แล้ว (ขอบเขตไฟล์: ${defaultFsRoots(dir, home).join(' | ')})`);
  }

  // 4) พิสูจน์ว่า token ใช้ได้จริง = เครื่องออนไลน์
  let hb;
  try {
    const res = await fetchImpl(`${join.hubUrl}/api/agent-machines/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-machine-token': join.machineToken },
      body: JSON.stringify({ version: process.version }),
    });
    hb = { status: res?.status ?? 0 };
  } catch (err) {
    hb = { status: 0, error: String(err?.message ?? err) };
  }
  if (hb.status !== 200) {
    add('heartbeat', 'fail', `HUB ตอบ ${hb.status || hb.error} — ยังไม่ถือว่าออนไลน์`);
    lines.push(
      hb.status === 401
        ? '  token ถูกปฏิเสธ (401): เครื่องนี้อาจถูกลบ/ปิดในหน้า HUB หรือ join.json ถูกแก้ — แพ็กชุดติดตั้งใหม่ที่เครื่อง HUB'
        : '  ตรวจว่า route /api/agent-machines ทำงาน (deploy ล่าสุด) แล้วลองใหม่'
    );
    return finish(false, 1, join.hubUrl, name);
  }
  add('heartbeat', 'ok', 'HUB ยอมรับ token นี้ — เครื่องขึ้นออนไลน์แล้ว');

  // 5) autostart (Windows) — ไม่ผ่านก็ยังใช้ได้ แค่ต้องรันเอง
  if (skipTask) {
    add('task', 'skipped', 'ข้ามตามที่สั่ง (--no-task)');
  } else if (platform !== 'win32') {
    add('task', 'warn', `ไม่ใช่ Windows — รันเองได้: cd ${dir} && node src/main.mjs`);
  } else {
    // ตัวห่อ run-runner.cmd ทำสองอย่าง: (ก) process ตายแล้วเริ่มใหม่ให้เอง (เครื่องไม่หลุดจาก HUB)
    // (ข) รับช่วงตอน runner อัปเดตโค้ดตัวเอง (exit 86) โดยไม่สร้างตัวซ้อน
    const runnerCmd = path.join(dir, 'run-runner.cmd');
    const hasWrapper = fs.existsSync(runnerCmd);
    const tr = hasWrapper ? `cmd /c "${runnerCmd}"` : `cmd /c cd /d "${dir}" && node src\\main.mjs`;
    const res = await exec('schtasks', ['/Create', '/TN', TASK_NAME, '/TR', tr, '/SC', 'ONLOGON', '/F']);
    if (res?.code === 0) {
      add(
        'task',
        'ok',
        hasWrapper
          ? `ตั้งให้รันเองตอนล็อกอินแล้ว (${TASK_NAME}) — ผ่าน run-runner.cmd (ตายแล้วฟื้นเอง)`
          : `ตั้งให้รันเองตอนล็อกอินแล้ว (${TASK_NAME})`,
      );
      if (!hasWrapper) lines.push('  ! ไม่พบ run-runner.cmd ในโฟลเดอร์นี้ — ตัว runner จะยังรีสตาร์ทตัวเองหลังอัปเดตได้ แต่จะไม่ฟื้นเองเมื่อ crash');
    } else {
      add('task', 'warn', 'ตั้ง autostart ไม่สำเร็จ (ต้องสิทธิ์ผู้ดูแลระบบ)');
      lines.push('  วิธีตั้ง autostart: คลิกขวา SETUP-MACHINE.cmd → "Run as administrator" แล้วรันอีกครั้ง');
      lines.push(`  ระหว่างนี้รันเองได้: cd /d ${dir} && node src\\main.mjs`);
    }
  }

  if (wroteEnv) lines.push('');
  lines.push(`  HUB_URL : ${join.hubUrl}`);
  lines.push(`  ชื่อเครื่อง: ${name}`);
  lines.push(`  โฟลเดอร์ : ${dir}`);
  return finish(true, 0, join.hubUrl, name);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const out = await runSetup({
    force: argv.includes('--force'),
    skipTask: argv.includes('--no-task'),
    dir: (argv.find((a) => a.startsWith('--dir=')) ?? '').slice(6) || HERE,
  });
  process.exitCode = out.exitCode;
}
