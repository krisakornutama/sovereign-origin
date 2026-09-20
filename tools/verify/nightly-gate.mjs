#!/usr/bin/env node
// tools/verify/nightly-gate.mjs — ประตูคุณภาพรายคืน (03:20 ทุกวัน ผ่าน Task Scheduler)
//   node tools/verify/nightly-gate.mjs              → รัน gate ทั้งหมด
//   node tools/verify/nightly-gate.mjs --selftest   → ส่งข้อความทดสอบเข้า Telegram (พิสูจน์ช่องทาง)
// ขั้นตรวจ: db-doctor → full-system-check → verify (build ท้าย) → ui-sweep (บังคับ prod ก่อนวัด) → security-audit (สุดท้าย — กิน login rate-limit window)
// ผ่าน = เงียบ (exit 0) · พัง = เขียน log + ส่ง Telegram แล้ว exit 1
// creds: tools/verify/telegram-creds.mjs (เจ้าของเดียว — shared กับ security-anomaly)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify, readTelegramCreds } from './telegram-creds.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LAST_LOG = path.join(ROOT, '.freebuff', 'nightly-gate-last.log');

// npm บน Windows เป็น .cmd — spawn .cmd โดยไม่ผ่าน shell โดน Node v24+ บล็อก (EINVAL)
// จึงเรียก npm-cli.js ด้วย node ตรง ๆ (ไม่ผ่าน shell เลย ปลอดกับดัก quote/DEP0190)
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

const checks = [
  { name: 'db-doctor (env/schema/ฐานแปลกปลอม)', cmd: 'node', args: ['tools/verify/db-doctor.mjs'] },
  { name: 'full-system-check (mounts ปิดสนิท + lifecycle จริง)', cmd: 'node', args: ['tools/verify/full-system-check.mjs'] },
  { name: 'verify (backend build+test + frontend typecheck+build)', cmd: 'node', args: [NPM_CLI, 'run', 'verify'] },
  { name: 'ui-sweep (หน้าจอจริงผ่าน Chromium)', cmd: 'node', args: ['tools/verify/ui-sweep.mjs'] },
  // security-audit ต้องเป็นตัวสุดท้าย: brute-force test กิน per-IP login window (10/15 นาที) —
  // ถ้ารันก่อน check อื่นจะบล็อก API จาก IP เดิมใน window
  { name: 'security-audit (headers/SQLi/rate-limit/IDOR)', cmd: 'node', args: ['tools/verify/security-audit.mjs'] },
];

// ── โหมด :3000 — verify (next build) เขียน .next ทับตัวที่ prod serve อยู่ → ช่วง build watchdog อาจชุบเป็น dev
// (บทเรียนจริง 20 ก.ย. 2026 · runbook §๓) ui-sweep ต้องวัด prod จริง: มี BUILD_ID → ฆ่า listener
// แล้วรอ watchdog ชุบ prod (~1 วิ) · ไม่มี BUILD_ID = สถานะ rollback จริง ปล่อยเป็น dev ตามปกติ
async function ensureProdFrontend() {
  if (!fs.existsSync(path.join(ROOT, 'sovereign-frontend', '.next', 'BUILD_ID'))) return;
  let pid;
  try {
    pid = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
      .split(/\r?\n/).find((l) => l.includes('LISTENING') && /:3000\s/.test(l))?.trim().split(/\s+/).pop();
  } catch { /* อ่าน netstat ไม่ได้ — ข้าม kill แล้วรอตื่นข้างล่าง */ }
  if (pid && pid !== '0') {
    try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { timeout: 15_000, windowsHide: true, stdio: 'ignore' }); } catch { /* มีคนฆ่าไปก่อน */ }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try { const r = await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(4_000) }); if (r.ok) return; } catch { /* ยังไม่ตื่น */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(':3000 ยังไม่ตอบหลัง verify 90 วิ — watchdog อาจตาย (ปลุก: Start-Process node -ArgumentList \'frontend-watchdog.mjs\' -WorkingDirectory <repo root>)');
}

// ── gate ──
function tail(s, n) { s = String(s); return s.length > n ? '…' + s.slice(-n) : s; }

async function main() {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const results = [];
  for (const c of checks) {
    try {
      // ensure ต้องอยู่ใน try: ถ้า watchdog ตาย (:3000 ไม่ตื่น) ต้องกลายเป็น failed result → Telegram
      // ไม่ใช่ unhandled rejection ที่ทำให้ gate ตายเงียบทั้งกระบวนการ
      if (c.name.startsWith('ui-sweep')) await ensureProdFrontend();
      const out = execFileSync(c.cmd, c.args, {
        cwd: ROOT, encoding: 'utf8', timeout: 300_000, windowsHide: true,
        maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
      results.push({ ...c, code: 0, out });
    } catch (e) {
      const proc = String(e.stdout || '') + String(e.stderr || '');
      results.push({ ...c, code: e.status ?? 1, out: proc || String(e.message || e) });
    }
  }
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length === 0) {
    console.log(`[${stamp}] nightly gate: ผ่าน ${checks.length}/${checks.length} — เงียบตามดีไซน์ (ไม่มีข้อความ)`);
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(LAST_LOG), { recursive: true });
  fs.writeFileSync(LAST_LOG, results.map((r) => `===== ${r.name} (exit ${r.code})\n${r.out}`).join('\n\n'));
  const msg = `🚨 Sovereign nightly gate พัง (${stamp})\n\n`
    + failed.map((f) => `✖ ${f.name} (exit ${f.code})\n${tail(f.out, 700)}`).join('\n\n')
    + `\n\nlog เต็ม: .freebuff/nightly-gate-last.log`;
  const sent = await notify(msg);
  console.log(`[${stamp}] nightly gate: พัง ${failed.length}/${checks.length} — Telegram: ${sent.ok ? 'ส่งแล้ว' : `ไม่ได้ส่ง (${sent.error})`}`);
  process.exit(1);
}

if (process.argv[2] === '--selftest') {
  const creds = readTelegramCreds();
  if (!creds.token || !creds.chatId) {
    console.error('selftest: ไม่มี credentials — ตั้งที่หน้า Settings หรือ TELEGRAM_* ใน infra/.env');
    process.exit(1);
  }
  const r = await notify(
    `🧪 Sovereign nightly gate — ข้อความทดสอบ (${new Date().toISOString().slice(0, 16)})\nระบบแจ้งเตือนพร้อมใช้ · creds จาก: ${creds.source}`,
    creds
  );
  console.log(`selftest: source=${creds.source} sent=${r.ok}${r.error ? ' error=' + r.error : ''}`);
  process.exit(r.ok ? 0 : 1);
} else {
  await main();
}
