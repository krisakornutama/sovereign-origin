#!/usr/bin/env node
// tools/verify/nightly-gate.mjs — ประตูคุณภาพรายคืน (03:20 ทุกวัน ผ่าน Task Scheduler)
//   node tools/verify/nightly-gate.mjs              → รัน gate ทั้งหมด
//   node tools/verify/nightly-gate.mjs --selftest   → ส่งข้อความทดสอบเข้า Telegram (พิสูจน์ช่องทาง)
// ขั้นตรวจ: 1) npm run verify (build+test ทั้งสองฝั่ง)  2) db-doctor (env/schema/ฐานแปลกปลอม)
// ผ่าน = เงียบ (exit 0) · พัง = เขียน log + ส่ง Telegram แล้ว exit 1
// creds: system_settings (ตั้งผ่านหน้า Settings — เหมือน core-api) → fallback infra/.env (TELEGRAM_*)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const INFRA_ENV = path.join(ROOT, 'sovereign-os', 'infra', '.env');
const LAST_LOG = path.join(ROOT, '.freebuff', 'nightly-gate-last.log');

// npm บน Windows เป็น .cmd — spawn .cmd โดยไม่ผ่าน shell โดน Node v24+ บล็อก (EINVAL)
// จึงเรียก npm-cli.js ด้วย node ตรง ๆ (ไม่ผ่าน shell เลย ปลอดกับดัก quote/DEP0190)
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmRun = (...args) => ({ cmd: 'node', args: [NPM_CLI, ...args] });

const checks = [
  { name: 'db-doctor (env/schema/ฐานแปลกปลอม)', cmd: 'node', args: ['tools/verify/db-doctor.mjs'] },
  { name: 'verify (backend build+test + frontend typecheck+build)', ...npmRun('run', 'verify') },
];

// ── Telegram ── ลำดับเดียวกับ telegram-credentials.service.ts: DB ชนะ env ──
function readTelegramCreds() {
  try {
    const q = (key) => execFileSync('docker',
      ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc',
       `SELECT value FROM system_settings WHERE key='${key}'`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    const token = q('telegram.botToken');
    const chatId = q('telegram.chatId');
    if (token && chatId) return { token, chatId, source: 'db' };
  } catch { /* db ล่ม/ตารางหาย — ลอง env ต่อ */ }
  let token = '', chatId = '';
  if (fs.existsSync(INFRA_ENV)) {
    for (const line of fs.readFileSync(INFRA_ENV, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1] === 'TELEGRAM_BOT_TOKEN') token = v; else chatId = v;
    }
  }
  return { token, chatId, source: 'env' };
}

function sendTelegram(text, creds) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: creds.chatId, text, disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${creds.token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15_000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({
        ok: res.statusCode === 200,
        error: res.statusCode === 200 ? undefined : `${res.statusCode} ${body.slice(0, 160)}`,
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

// ── gate ──
function tail(s, n) { s = String(s); return s.length > n ? '…' + s.slice(-n) : s; }

async function main() {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const results = [];
  for (const c of checks) {
    try {
      const out = execFileSync(c.cmd, c.args, {
        cwd: ROOT, encoding: 'utf8', timeout: 300_000, windowsHide: true,
        maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
      results.push({ ...c, code: 0, out });
    } catch (e) {
      results.push({ ...c, code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') });
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
  const creds = readTelegramCreds();
  const sent = creds.token && creds.chatId
    ? await sendTelegram(msg, creds)
    : { ok: false, skipped: true, error: 'ไม่มี credentials (ตั้งได้ที่หน้า Settings หรือ infra/.env)' };
  console.log(`[${stamp}] nightly gate: พัง ${failed.length}/${checks.length} — Telegram: ${
    sent.ok ? 'ส่งแล้ว' : `ไม่ได้ส่ง (${sent.error})`}`);
  process.exit(1);
}

if (process.argv[2] === '--selftest') {
  const creds = readTelegramCreds();
  if (!creds.token || !creds.chatId) {
    console.error('selftest: ไม่มี credentials — ตั้งที่หน้า Settings หรือ TELEGRAM_* ใน infra/.env');
    process.exit(1);
  }
  const r = await sendTelegram(
    `🧪 Sovereign nightly gate — ข้อความทดสอบ (${new Date().toISOString().slice(0, 16)})\nระบบแจ้งเตือนพร้อมใช้ · creds จาก: ${creds.source}`,
    creds
  );
  console.log(`selftest: source=${creds.source} sent=${r.ok}${r.error ? ' error=' + r.error : ''}`);
  process.exit(r.ok ? 0 : 1);
} else {
  await main();
}
