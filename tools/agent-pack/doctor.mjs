// tools/agent-pack/doctor.mjs
//
// ── "INSTALL-CHECK": ตรวจเครื่องก่อน/หลังติดตั้ง แล้วออกใบรายงานที่ส่งต่อได้ ────────────
// ที่มา (27/10/69): เจ้าของบอก "ผมไม่รู้ความต้องการของลูกค้า ผมรู้แค่ว่าอยากพัฒนา"
// ⇒ สิ่งที่ต้องมีไม่ว่าลูกค้าจะต้องการอะไร คือ "คนที่ไม่ใช่เราติดตั้งเองได้ และบอกเราได้ว่าติดตรงไหน"
//
// หลักการ:
//   · อ่านอย่างเดียว (ไม่เขียน .env / ไม่ตั้ง task / ไม่ heartbeat เว้นแต่สั่ง --heartbeat)
//   · ไม่พิมพ์ความลับลงรายงานเลย (token/รหัสเชิญถูก redact ก่อนเขียนไฟล์)
//   · ทุกข้อที่ "ไม่ผ่าน" ต้องมี hint เป็นภาษาคน + วิธีแก้
//   · exit code: 0 = พร้อมติดตั้ง · 1 = มีข้อที่ไม่ผ่าน (ci/สคริปต์ตัดสินใจได้)
//
// ใช้บนเครื่องปลายทาง:  ดับเบิลคลิก INSTALL-CHECK.cmd   (หรือ node tools\agent-pack\doctor.mjs)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBundleRoot, readEnrollmentFile, readJoin, resolveRunnerDir } from './setup-machine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Node 20+ คือขั้นต่ำของ runner (fetch/structuredClone ที่ใช้ในโค้ด) */
export const MIN_NODE_MAJOR = 20;
export const MIN_FREE_BYTES_FAIL = 1 * 1024 ** 3; // ต่ำกว่านี้ = ติดตั้งไม่จบ
export const MIN_FREE_BYTES_WARN = 6 * 1024 ** 3; // ต่ำกว่านี้ = เตือน (ชุดเต็ม ~3.6 GB)
export const REPORT_NAME = 'SUPPORT.txt';

/** ป้ายสถานะให้อ่านง่ายในไฟล์รายงาน */
const MARK = { ok: '[ok]  ', warn: '[warn]', fail: '[FAIL]' };

/**
 * ปิดความลับก่อนออกจากเครื่อง — token ของเครื่องคือ 64 hex, รหัสเชิญคือ enr_+hex
 * และค่าใน .env ทุกตัวที่ชื่อมีคำว่า TOKEN/SECRET/PASSWORD/KEY
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/\benr_[a-f0-9]{16,}\b/gi, 'enr_***')
    .replace(/\b[a-f0-9]{64}\b/gi, '***token***')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*)\S+/gi, '$1***');
}

/** อ่าน JSON ที่อาจมี BOM (Notepad/PowerShell 5.1 เติมให้) — คืน ok=false แทนการ throw */
export function readJsonLoose(file) {
  try {
    if (!fs.existsSync(file)) return { ok: false, missing: true };
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, missing: false, error: String(err?.message ?? err) };
  }
}

/** ตรวจว่าพาธนี้เขียนได้จริง (ACL ของ Windows ไม่สะท้อนใน fs.access) */
export function canWrite(dir) {
  const probe = path.join(dir, `.write-probe-${process.pid}.tmp`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function freeBytes(dir, statfsSync) {
  try {
    const s = statfsSync(dir);
    const free = Number(s.bavail ?? s.bfree ?? 0) * Number(s.bsize ?? 0);
    return Number.isFinite(free) && free > 0 ? free : null;
  } catch {
    return null;
  }
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function defaultExec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** แปลงผลตรวจเป็นข้อความรายงาน (pure — เทสต์ได้โดยไม่ต้องมีเครื่องจริง) */
export function renderReport({ checks, meta }) {
  const lines = [];
  lines.push('══════════════════════════════════════════════════════');
  lines.push('  Sovereign OS — ใบตรวจเครื่อง (doctor)');
  lines.push('══════════════════════════════════════════════════════');
  lines.push(`  เวลา      : ${meta.time}`);
  lines.push(`  เครื่อง   : ${meta.hostname} (${meta.platform}/${meta.arch})`);
  lines.push(`  โฟลเดอร์ : ${meta.bundleRoot}`);
  lines.push(`  Node.js   : v${meta.nodeVersion}`);
  lines.push('');
  for (const c of checks) {
    lines.push(`${MARK[c.status] || '[?]   '} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    if (c.hint) lines.push(`         ↳ ${c.hint}`);
  }
  const count = (s) => checks.filter((c) => c.status === s).length;
  lines.push('');
  lines.push(`  สรุป: ผ่าน ${count('ok')} · เตือน ${count('warn')} · ไม่ผ่าน ${count('fail')}`);
  if (count('fail') > 0) {
    lines.push('  ➜ แก้ข้อ [FAIL] ข้างบนก่อน แล้วรัน INSTALL-CHECK.cmd อีกครั้ง');
  } else if (count('warn') > 0) {
    lines.push('  ➜ ติดตั้งได้ แต่ควรอ่านข้อ [warn] (อาจต้องแก้ภายหลัง)');
  } else {
    lines.push('  ➜ พร้อมติดตั้ง — ดับเบิลคลิก INSTALL.cmd ได้เลย');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * รันการตรวจทั้งหมด — คืน { ok, exitCode, checks, report, reportPath }
 * ทุก dependency ที่แตะโลกภายนอกฉีดได้ (fetch/exec/statfs/nodeVersion) เพื่อเทสต์บน CI
 */
export async function runDoctor({
  dir = HERE,
  fetchImpl = fetch,
  exec = defaultExec,
  platform = process.platform,
  arch = process.arch,
  hostname = os.hostname(),
  nodeVersion = process.versions.node,
  statfsSync = fs.statfsSync,
  timeoutMs = 5000,
  heartbeat = false,
  writeReport = true,
  now = () => new Date(),
  env = process.env,
} = {}) {
  const checks = [];
  const add = (id, status, label, detail = '', hint = '') => checks.push({ id, status, label, detail, hint });

  const bundleRoot = findBundleRoot(dir);
  const runnerDir = resolveRunnerDir(dir, bundleRoot);

  // 1) Node.js — ขั้นต่ำที่โค้ด runner ใช้จริง
  const major = Number(String(nodeVersion).split('.')[0]);
  add(
    'node',
    major >= MIN_NODE_MAJOR ? 'ok' : 'fail',
    'Node.js',
    `v${nodeVersion}`,
    major >= MIN_NODE_MAJOR ? '' : `ต้องใช้ Node.js ${MIN_NODE_MAJOR}+ — ดาวน์โหลด LTS ที่ nodejs.org แล้วเปิดไฟล์นี้ใหม่`,
  );

  // 2) ไฟล์ติดตั้งครบไหม (หาได้ทั้งชุดแบนและชุดเต็มที่มี tools\agent-pack)
  const setupFlat = path.join(bundleRoot, 'setup-machine.mjs');
  const setupNested = path.join(bundleRoot, 'tools', 'agent-pack', 'setup-machine.mjs');
  const hasSetup = fs.existsSync(setupFlat) || fs.existsSync(setupNested) || fs.existsSync(path.join(dir, 'setup-machine.mjs'));
  add(
    'bundle',
    hasSetup ? 'ok' : 'fail',
    'ไฟล์ติดตั้ง (setup-machine.mjs)',
    hasSetup ? `พบใน ${bundleRoot}` : `ไม่พบใน ${bundleRoot}`,
    hasSetup ? '' : 'ก๊อปโฟลเดอร์ชุดติดตั้งมาทั้งโฟลเดอร์ (อย่าลากมาแค่ไฟล์เดียว)',
  );

  // 3) แผนติดตั้ง (ไม่มี = ติดตั้งเฉพาะ core ซึ่งใช้ได้)
  const planFile = path.join(bundleRoot, 'install-plan.json');
  const plan = readJsonLoose(planFile);
  if (plan.missing) {
    add('plan', 'warn', 'แผนติดตั้ง (install-plan.json)', 'ไม่มีไฟล์', 'จะติดตั้งเฉพาะ core — ถ้าต้องการโมดูลอื่น ให้แพ็กชุดใหม่จากเครื่องแม่');
  } else if (!plan.ok) {
    add('plan', 'warn', 'แผนติดตั้ง (install-plan.json)', 'อ่านไม่ได้', `ไฟล์เสีย/มีอักขระแปลก: ${redact(plan.error)} — แพ็กชุดใหม่`);
  } else {
    const mods = Array.isArray(plan.data?.modules) ? plan.data.modules : [];
    add('plan', 'ok', 'แผนติดตั้ง (install-plan.json)', mods.length ? `โมดูล: ${mods.join(', ')}` : 'เฉพาะ core');
  }

  // 4) เขียนไฟล์ในโฟลเดอร์ได้ไหม (ตัวติดตั้งต้องเขียน .env/launcher)
  const writable = canWrite(bundleRoot);
  add(
    'writable',
    writable ? 'ok' : 'fail',
    'สิทธิ์เขียนโฟลเดอร์',
    writable ? 'เขียนได้' : 'เขียนไม่ได้',
    writable ? '' : 'ย้ายชุดติดตั้งไปที่เช่น C:\\Sovereign หรือรันด้วยบัญชีที่มีสิทธิ์ (หลีกเลี่ยง C:\\Program Files)',
  );

  // 5) พื้นที่ดิสก์
  const free = freeBytes(bundleRoot, statfsSync);
  if (free === null) {
    add('disk', 'warn', 'พื้นที่ดิสก์', 'ตรวจไม่ได้', 'ดูเองว่าเหลือ ≥ 6 GB ก่อนติดตั้งชุดเต็ม');
  } else if (free < MIN_FREE_BYTES_FAIL) {
    add('disk', 'fail', 'พื้นที่ดิสก์', `เหลือ ${formatBytes(free)}`, 'ต้องเหลืออย่างน้อย 1 GB — ย้าย/ลบไฟล์เก่าก่อน');
  } else if (free < MIN_FREE_BYTES_WARN) {
    add('disk', 'warn', 'พื้นที่ดิสก์', `เหลือ ${formatBytes(free)}`, 'ชุดเต็มใช้ที่ ~4 GB — ควรเหลือ ≥ 6 GB');
  } else {
    add('disk', 'ok', 'พื้นที่ดิสก์', `เหลือ ${formatBytes(free)}`);
  }

  // 6) วิธีลงทะเบียนกับเครื่องแม่ (join.json หรือ enroll-code.txt)
  const join = readJoin(bundleRoot);
  const enroll = readEnrollmentFile(bundleRoot);
  const hubFromEnv = String(env.HUB_URL ?? '').trim().replace(/\/$/, '');
  const hubUrl = join.ok ? join.hubUrl : String(enroll.hubUrl || hubFromEnv || '').replace(/\/$/, '');
  const canEnroll = Boolean(enroll.code || env.MACHINE_ENROLL_CODE);
  if (join.ok) {
    add('join', 'ok', 'วิธีลงทะเบียน', `join.json (เครื่อง "${join.machineName}")`);
  } else if (hubUrl && canEnroll) {
    add('join', 'ok', 'วิธีลงทะเบียน', 'ชุดสากล (รหัสเชิญ + HUB_URL)');
  } else if (canEnroll) {
    add('join', 'warn', 'วิธีลงทะเบียน', 'มีรหัสเชิญแต่ไม่รู้ HUB_URL', 'ต้องมี HUB_URL ใน enroll-code.txt หรือใส่มาเป็น --hub-url=...');
  } else {
    add(
      'join',
      'fail',
      'วิธีลงทะเบียน',
      'ไม่มี join.json และไม่มีรหัสเชิญ',
      'แพ็กชุดใหม่จากเครื่องแม่ (ได้ join.json) หรือใช้ชุดสากล + รหัสเชิญจากหน้า /fleet',
    );
  }

  // 7) ต่อ HUB ได้ไหม (ปัญหาอันดับ 1 ของการติดตั้ง: firewall/เน็ตคนละวง)
  if (!hubUrl) {
    add('hub', 'warn', 'ติดต่อเครื่องแม่ (HUB)', 'ยังไม่มี HUB_URL ให้ตรวจ', 'จะตรวจได้หลังระบุ HUB_URL');
  } else {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${hubUrl}/api/health`, { method: 'GET', signal: ac.signal });
      const status = Number(res?.status ?? 0);
      if (status > 0 && status < 400) add('hub', 'ok', 'ติดต่อเครื่องแม่ (HUB)', `${hubUrl} → HTTP ${status}`);
      else add('hub', 'fail', 'ติดต่อเครื่องแม่ (HUB)', `${hubUrl} → HTTP ${status}`, 'HUB ตอบแต่ไม่ปกติ — ตรวจหน้า /system-health บนเครื่องแม่');
    } catch (err) {
      add(
        'hub',
        'fail',
        'ติดต่อเครื่องแม่ (HUB)',
        `${hubUrl} → ${redact(err?.name === 'AbortError' ? `timeout ${timeoutMs} ms` : err?.message ?? err)}`,
        'เครื่องนี้กับเครื่องแม่อยู่วงเดียวกันหรือไม่ · ไฟร์วอลล์ของเครื่องแม่เปิดพอร์ต 3000 ไหม · HUB เปิดอยู่ไหม',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // 8) Docker — ไม่บังคับสำหรับเครื่องลูกที่ทำแค่ runner แต่จำเป็นถ้าจะรันทั้ง stack
  try {
    const r = await exec('docker', ['--version']);
    const first = String(r?.stdout || r?.stderr || '').split(/\r?\n/)[0].trim();
    if (r?.code === 0) add('docker', 'ok', 'Docker', first || 'พร้อมใช้');
    else add('docker', 'warn', 'Docker', 'ไม่พบ/ยังไม่รัน', 'ติดตั้ง Docker Desktop ถ้าเครื่องนี้จะรันฐานข้อมูล+เว็บเอง');
  } catch (err) {
    add('docker', 'warn', 'Docker', `ตรวจไม่ได้ (${redact(err?.message ?? err)})`, 'ไม่จำเป็นถ้าเครื่องนี้ทำแค่ runner');
  }

  // 9) ของเดิมบนเครื่อง (ติดตั้งซ้ำ)
  const envFile = path.join(runnerDir, '.env');
  if (fs.existsSync(envFile)) {
    add('existing', 'warn', 'มีติดตั้งเดิมอยู่', path.join(runnerDir, '.env'), 'ตัวติดตั้งจะอัปเดตค่าในไฟล์นี้ (ไม่ลบของเดิม) — ถ้าไม่แน่ใจให้สำรองไว้ก่อน');
  } else {
    add('existing', 'ok', 'ยังไม่เคยติดตั้งบนเครื่องนี้');
  }

  // 10) ทางเลือก: พิสูจน์ token กับ HUB (เขียน heartbeat 1 ครั้ง — ต้องสั่งเอง)
  if (heartbeat) {
    if (!join.ok || !hubUrl) {
      add('token', 'warn', 'ทดสอบ token กับ HUB', 'ข้าม', 'ต้องมี join.json (ชุดสากลจะได้ token ตอนติดตั้ง)');
    } else {
      try {
        const res = await fetchImpl(`${hubUrl}/api/agent-machines/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-machine-token': join.machineToken },
          body: JSON.stringify({ version: `doctor/${nodeVersion}` }),
        });
        const status = Number(res?.status ?? 0);
        if (status >= 200 && status < 300) add('token', 'ok', 'ทดสอบ token กับ HUB', `HTTP ${status}`);
        else add('token', 'fail', 'ทดสอบ token กับ HUB', `HTTP ${status}`, status === 401 ? 'token ถูกยกเลิก/หมดอายุ — แพ็กชุดใหม่จากเครื่องแม่' : 'ดู log ของ core-api บนเครื่องแม่');
      } catch (err) {
        add('token', 'fail', 'ทดสอบ token กับ HUB', redact(err?.message ?? err), 'ตรวจเน็ต/ไฟร์วอลล์ก่อน');
      }
    }
  }

  const meta = {
    time: now().toISOString(),
    hostname,
    platform,
    arch,
    bundleRoot,
    nodeVersion,
    runnerDir,
  };
  const report = renderReport({ checks, meta });
  const failed = checks.some((c) => c.status === 'fail');

  let reportPath = '';
  if (writeReport) {
    try {
      reportPath = path.join(bundleRoot, REPORT_NAME);
      // เขียนแบบ redact เสมอ — ไฟล์นี้ถูกส่งต่อให้คนอื่นดู
      fs.writeFileSync(reportPath, `${redact(report)}\n`, 'utf8');
    } catch {
      reportPath = '';
    }
  }

  return { ok: !failed, exitCode: failed ? 1 : 0, checks, report, reportPath, meta };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const dirArg = (argv.find((a) => a.startsWith('--dir=')) ?? '').slice(6);
  const out = await runDoctor({
    dir: dirArg || HERE,
    heartbeat: argv.includes('--heartbeat'),
    writeReport: !argv.includes('--no-report'),
  });
  console.log(out.report);
  if (out.reportPath) console.log(`  บันทึกรายงาน: ${out.reportPath}`);
  process.exitCode = out.exitCode;
}
