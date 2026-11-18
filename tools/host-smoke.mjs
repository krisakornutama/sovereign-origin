#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   host-smoke — พิสูจน์ว่า "เปิดแอปมาแล้วใช้งานได้ปกติ" (กฎ HOST-SAFE / HOST-002)

   ทำไมต้องมี: งานทุกชิ้นของโปรเจ็กต้องไม่ทำให้เครื่องหรือระบบพัง — เปิดมาแล้ว
   ต้องตอบได้ว่า API ขึ้น, DB ต่อได้, เว็บเสิร์ฟได้, container ไม่มีตัวไหนตาย
   ถ้าข้อไหนแดง = ยังไม่ปิดงาน (ตาม docs/LIVING-QUEUE.md §1 ข้อ 8)

   ปลอดภัยต่อเครื่อง (READ-ONLY 100%):
     - ยิงแค่ GET ไปที่ :3001/healthz, :3001/api/health, :3000/
     - อ่านสถานะด้วยคำสั่งอ่านเท่านั้น: `docker ps`, `schtasks /query`
     - ไม่เขียนไฟล์ ไม่แก้ registry ไม่แตะ proxy/firewall/network ของเครื่อง

   ใช้:
     node tools/host-smoke.mjs                # ตารางสรุป + exit 0/1
     node tools/host-smoke.mjs --json         # JSON สำหรับ CI
     node tools/host-smoke.mjs --api=http://127.0.0.1:3001 --web=http://127.0.0.1:3000
     node tools/host-smoke.mjs --skip=docker  # ข้ามหมวด (docker|tasks)
   ───────────────────────────────────────────────────────────────────────────── */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareBuildCommit } from './prod-build-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = {
  api: process.env.SMOKE_API || 'http://127.0.0.1:3001',
  web: process.env.SMOKE_WEB || 'http://127.0.0.1:3000',
  timeoutMs: 8000,
};

const check = (name, ok, detail, critical = true) => ({ name, ok, detail, critical });

/** GET /healthz — liveness ของ API (สัญญา: {ok:true}) */
export function judgeLiveness(res) {
  if (!res || res.status !== 200) return check('API /healthz', false, `HTTP ${res?.status ?? 'no response'}`);
  if (!res.body || res.body.ok !== true) return check('API /healthz', false, 'ตอบ 200 แต่ ok ไม่ใช่ true');
  const up = Number(res.body.uptime);
  return check('API /healthz', true, Number.isFinite(up) ? `ok · uptime ${Math.round(up)}s` : 'ok');
}

/** GET /api/health — แอป + DB (db.state ต้องไม่ใช่ unavailable) */
export function judgeAppHealth(res) {
  if (!res || res.status !== 200) return check('API /api/health', false, `HTTP ${res?.status ?? 'no response'}`);
  const body = res.body || {};
  if (body.status !== 'ok') return check('API /api/health', false, `status=${body.status ?? 'missing'}`);
  const db = body.db;
  const build = body.build?.fingerprint ? `build ${body.build.fingerprint}` : 'build ?';
  if (!db) return check('API /api/health', true, `${build} · ไม่มีข้อมูล DB ในคำตอบ`, false);
  if (db.state !== 'ok') {
    return check('API /api/health', false, `${build} · db.state=${db.state ?? 'missing'} ${db.reason || ''}`.trim());
  }
  return check('API /api/health', true, `${build} · db ok · migration ${db.migrationHead ?? '?'}`);
}

/** GET / — หน้าเว็บต้องเสิร์ฟ HTML จริง (ไม่ใช่ 500/หน้า error) */
export function judgeWeb(res) {
  if (!res || res.status !== 200) return check('Web :3000', false, `HTTP ${res?.status ?? 'no response'}`);
  const text = String(res.text || '');
  if (!/<html[\s>]/i.test(text)) return check('Web :3000', false, 'ได้ 200 แต่ไม่ใช่ HTML ของแอป');
  if (/__NEXT_ERROR|Internal Server Error/i.test(text)) return check('Web :3000', false, 'หน้าเว็บมี error ของ Next');
  return check('Web :3000', true, `200 · ${Math.round(text.length / 1024)} KB`);
}

/**
 * prod build ตรงกับ HEAD ไหม — เป็น "ข้อเตือน" (soft) ไม่ใช่ critical
 * ทำไม soft: การ push โค้ดใหม่แล้วยังไม่ deploy เป็นเรื่องปกติชั่วคราว ถ้าทำเป็น critical
 * host-smoke จะแดงตลอดช่วง time ระหว่าง "merge แล้ว" ถึง "restart เสร็จ"
 */
export function judgeProdBuild(healthBody, head) {
  const prodCommit = healthBody?.build?.commit ?? null;
  const status = compareBuildCommit(prodCommit, head);
  if (status === 'match') {
    return check('Prod build', true, `ตรงกับ HEAD (${String(prodCommit).slice(0, 12)})`, false);
  }
  if (status === 'stale') {
    return check(
      'Prod build',
      false,
      `prod รัน ${String(prodCommit).slice(0, 12)} แต่ HEAD ${String(head).slice(0, 12)} — รัน node tools/deploy-core-api.mjs`,
      false,
    );
  }
  return check('Prod build', false, 'health ไม่มี build.commit — ตรวจไม่ได้ว่า prod ตามหลังไหม', false);
}

/** `docker ps` — ต้องมี container ขึ้น และห้ามมีตัว unhealthy/restarting */
export function judgeContainers(list) {
  if (!Array.isArray(list)) return check('Docker containers', false, String(list ?? 'อ่านสถานะไม่ได้'), false);
  if (list.length === 0) return check('Docker containers', false, 'ไม่พบ container ที่รันอยู่');
  const bad = list.filter((c) => /unhealthy|restarting|exited|dead/i.test(String(c.status || '')));
  if (bad.length > 0) {
    return check('Docker containers', false, `${bad.length} ตัวมีปัญหา: ${bad.map((c) => `${c.name}=${c.status}`).join(', ')}`);
  }
  return check('Docker containers', true, `${list.length} ตัวขึ้นครบ`);
}

/** `schtasks /query` — task ของโปรเจ็กต้องไม่ค้างในสถานะพัง (เตือนเท่านั้น) */
export function judgeTasks(rows) {
  if (!Array.isArray(rows)) return check('Scheduled tasks', false, 'อ่านสถานะไม่ได้', false);
  const sovereign = rows.filter((r) => /^Sovereign /i.test(String(r.name || '').replace(/^\\+/, '')));
  if (sovereign.length === 0) return check('Scheduled tasks', true, 'ยังไม่ได้ลงทะเบียน (ไม่ใช่ error)', false);
  const bad = sovereign.filter((r) => !/^(Ready|Running)$/i.test(r.state));
  if (bad.length > 0) {
    return check('Scheduled tasks', false, `${bad.length} ตัวไม่พร้อม: ${bad.map((r) => `${r.name}=${r.state}`).join(', ')}`, false);
  }
  return check('Scheduled tasks', true, `${sovereign.length} ตัว Ready`, false);
}

/** สรุปผล — ok = ไม่มีข้อ critical ที่แดง */
export function summarize(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const failedCritical = list.filter((c) => !c.ok && c.critical);
  const failedSoft = list.filter((c) => !c.ok && !c.critical);
  return { ok: failedCritical.length === 0, checks: list, failedCritical, failedSoft };
}

// ── I/O (แยกจากตรรกะเพื่อให้เทสต์ได้) ─────────────────────────────────────────
async function getJson(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, body, text };
  } catch {
    return { status: 0, body: null, text: '' };
  }
}

async function getText(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: '' };
  }
}

function run(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

async function readHeadCommit() {
  const out = await run('git', ['-C', ROOT, 'rev-parse', 'HEAD'], 8000);
  return out ? out.trim() : '';
}

async function readContainers() {
  const out = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}']);
  if (out === null) return null; // docker ไม่มี/ไม่รัน = ข้าม ไม่ใช่ fail
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split('\t');
      return { name, status: rest.join('\t') };
    });
}

// ใช้ PowerShell เพราะ `schtasks /query` แปลชื่อสถานะตามภาษาของ Windows
// (ไทย = "พร้อม") ซึ่งเทียบกับ Ready/Running ไม่ได้ — Get-ScheduledTask คืน enum อังกฤษเสมอ
async function readTasks() {
  if (process.platform !== 'win32') return null;
  const script =
    'Get-ScheduledTask | Where-Object { $_.TaskName -like "Sovereign *" } | ' +
    'Select-Object TaskName,State | ConvertTo-Json -Compress';
  const out = await run('powershell', ['-NoProfile', '-Command', script], 20000);
  if (out === null) return null;
  const text = out.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    // ConvertTo-Json แปลง enum เป็นตัวเลข: 0=Unknown 1=Disabled 2=Queued 3=Ready 4=Running
    const STATE = { 0: 'Unknown', 1: 'Disabled', 2: 'Queued', 3: 'Ready', 4: 'Running' };
    return list.map((t) => ({
      name: t.TaskName ?? '',
      state: STATE[t.State] ?? String(t.State ?? ''),
    }));
  } catch {
    return null;
  }
}

export async function runSmoke(options = {}) {
  const { api, web, timeoutMs } = { ...DEFAULTS, ...options };
  const skip = new Set(String(options.skip || '').split(',').map((s) => s.trim()).filter(Boolean));
  const checks = [];

  checks.push(judgeLiveness(await getJson(`${api}/healthz`, timeoutMs)));
  const appHealth = await getJson(`${api}/api/health`, timeoutMs);
  checks.push(judgeAppHealth(appHealth));
  // prod รัน build รุ่นเดียวกับ checkout ไหม — ข้อเตือน (soft) เพื่อไม่ให้ขัดจังหวะ deploy ปกติ
  const head = await readHeadCommit();
  if (head) checks.push(judgeProdBuild(appHealth.body, head));
  checks.push(judgeWeb(await getText(`${web}/`, timeoutMs)));

  if (!skip.has('docker')) {
    const containers = await readContainers();
    if (containers === null) checks.push(check('Docker containers', false, 'ไม่พบ docker (ข้าม)', false));
    else checks.push(judgeContainers(containers));
  }
  if (!skip.has('tasks')) {
    const tasks = await readTasks();
    if (tasks === null) checks.push(check('Scheduled tasks', false, 'อ่านไม่ได้ (ข้าม)', false));
    else checks.push(judgeTasks(tasks));
  }

  return summarize(checks);
}

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv.slice(2)) {
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--api=')) opts.api = arg.slice(6);
    else if (arg.startsWith('--web=')) opts.web = arg.slice(6);
    else if (arg.startsWith('--skip=')) opts.skip = arg.slice(7);
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = Number(arg.slice(10)) || DEFAULTS.timeoutMs;
  }
  return opts;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseArgs(process.argv);
  const result = await runSmoke(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('HOST-SAFE smoke test — เปิดมาแล้วใช้งานได้ปกติหรือไม่\n');
    for (const c of result.checks) {
      const mark = c.ok ? '✅' : c.critical ? '❌' : '⚠️ ';
      console.log(`  ${mark} ${c.name.padEnd(20)} ${c.detail}`);
    }
    console.log('');
    if (result.ok) {
      console.log(`ผลรวม: ใช้งานได้ปกติ (${result.checks.filter((c) => c.ok).length}/${result.checks.length} ผ่าน)`);
      if (result.failedSoft.length) console.log(`  มีข้อเตือน ${result.failedSoft.length} ข้อ (ไม่บล็อก)`);
    } else {
      console.log(`ผลรวม: ❌ ยังใช้งานไม่ได้ — ${result.failedCritical.length} ข้อวิกฤต:`);
      for (const c of result.failedCritical) console.log(`   - ${c.name}: ${c.detail}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
