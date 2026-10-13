#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// machine-alert.mjs — เฝ้าสุขภาพเครื่องรอบสั้น (Phase 4.5: แจ้งทันทีไม่ต้องรอ nightly ตี 2)
// โจทย์: ดิสก์/แรมวิกฤต หรือ docker ล่ม → Telegram ภายในนาที (ตามรอบ task 10 นาที)
//        ไม่ใช่รอรอบ verify คืนถัดไปมาพังแล้วค่อยรู้
// โครง: รัน machine-health → กรอง level=critical → dedup ต่อ area (cooldown) →
//        ส่ง Telegram + จดตาราง alert_events (ให้ /alert-history เห็น) → แจ้ง recovery เมื่อหาย
// หลักการ (เหมือน alert-store/dispatcher): soft-fail ทุกจุด — ส่งไม่ออก/DB พัง = ไม่เคยทำให้ task ล้ม
// dedup: หนึ่ง area = หนึ่ง alert ที่ active (machine:disk / machine:ram / machine:docker)
//        เห็นซ้ำใน cooldown → ยับ (log เงียบ ไม่จด DB กัน 144 แถว/วัน)
//        ข้าม cooldown แล้วยังวิกฤต → แจ้งซ้ำได้ (คนลืมได้)
//        หายจริง → แจ้ง ✅ กลับมาปกติ ครั้งเดียว แล้วเคลียร์ state
// ใช้: node tools/machine-alert.mjs [--dry] — flags หลัง -- (เช่น -- --snapshot) จะถูกส่งต่อให้ machine-health
// (ตั้งแต่ 27/9: Machine Watch ยิงด้วย --snapshot — เขียน data/ops-status.json ให้หน้า /system-health แสดงสาย task/backup สดตลอด)
// ────────────────────────────────────────────────────────────────────────────
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
// สวิตช์เปิด/ปิดของเจ้าของ — ปิดไว้เป็นค่าเริ่มต้น (12/10/69)
import { readConfig as readAlertConfig } from './machine-alert.config.mjs';

// REPO จากไฟล์ (ไฟล์อยู่ tools/ → ขึ้น 2 ชั้น) — แบบเดียวกับ nightly-verify (บั๊ก path เคยเกิดแล้ว)
function dirname1(p) {
  const i = p.lastIndexOf('\\');
  return i > 3 ? p.slice(0, i) : p;
}
const REPO = dirname1(dirname1(fileURLToPath(import.meta.url)));
const STATEDIR = join(REPO, 'logs', 'machine-alert');
const STATE = join(STATEDIR, 'state.json');
const DRY = process.argv.includes('--dry');
// ⚠ ต้องสั่ง "ส่ง" ถึงจะส่ง — เจ้าของสั่ง 12/10/69:
//   "ถ้ามันต้องรันจริง ๆ ให้รันจากการที่ผมสั่งการ ไม่ใช่รันเองอัตโนมัติ"
//   ⇒ งานตั้งเวลา (ทุก 10 นาที) ยังตรวจสุขภาพได้ แต่ไม่ส่งออกจนกว่าจะสั่ง
//   คำสั่งส่งเอง:  node tools/alerts.mjs now     (หรือ tools/machine-alert.mjs --send)
const SEND = process.argv.includes('--send');
// cooldown มาจากไฟล์ตั้งค่า (ปรับได้โดยไม่ต้องแก้โค้ด) — ตัวแปรแวดล้อยัง override ได้
const alertCfgGlobal = readAlertConfig();
const COOLDOWN_MS = Number(
  process.env.MA_COOLDOWN_MIN ?? (alertCfgGlobal.enabled ? alertCfgGlobal.cooldownMin : 0),
) * 60_000;

// ── 1) ตรวจสุขภาพเครื่อง (สคริปต์เดียวกับ nightly ใช้ — ความจริงชุดเดียว) ──
let health = null;
try {
  const r = spawnSync('node', [join(REPO, 'tools', 'machine-health.mjs'), ...process.argv.slice(1)], { windowsHide: true,
    cwd: REPO, encoding: 'utf8', timeout: 90_000,
    // ห้าม shell:true — path repo มีเว้นวรรค ("E:/My work/...") shell ตัดที่ช่องว่าง → "Cannot find module 'E:\\My'"
    // (บั๊กจริงตอนทดสอบรอบแรก — args array ไม่มี shell เข้า CreateProcess ตรง ปลอดภัยกับเว้นวรรค)
  });
  health = JSON.parse((r.stdout || '').trim());
} catch { /* ตรวจไม่ได้ — ไม่แจ้ง (กัน false alarm จากสคริปต์เองพัง) */ }
if (!health || !Array.isArray(health.problems)) {
  console.log('machine-health ตอบไม่ถูกต้อง — ข้ามรอบนี้ (soft-fail)');
  process.exit(0);
}
const criticals = health.problems.filter((p) => p.level === 'critical');

// ── 1b) snapshot สำหรับหน้า /system-health (ถ้าถูกยิงด้วย --snapshot) — soft-fail เสมอ ──
// ops-status เขียน data/ops-status.json (ผล task scheduler + nightly ที่ container/เว็บมองไม่เห็นเอง)
if (process.argv.includes('--snapshot')) {
  try {
    spawnSync('node', [join(REPO, 'tools', 'ops-status.mjs'), '--snapshot'], { windowsHide: true, cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  } catch { /* snapshot พัง = หน้าเว็บข้อมูลเก่ากว่านิดเดียว ไม่กระทบการแจ้งเตือน */ }
}
// I0a (28/9/69): frontend-watchdog — :3000 ล่ม/แขวน = ชุบกลับเองทุกรอบ Machine Watch
// (ตัวนี้ยิงเฉพาะเมื่อ --snapshot เพราะต้องอยู่เครื่อง host เท่านั้น · soft-fail ห้ามพา alert ตาย)
if (process.argv.includes('--snapshot')) {
  try {
    const r = spawnSync('node', [join(REPO, 'tools', 'frontend-watchdog.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 150_000, windowsHide: true });
    if (r.status !== 0) console.error('frontend-watchdog แจ้งปัญหา (exit', r.status + ') — รายละเอียดใน logs/frontend-watchdog.jsonl');
  } catch { /* ชุบไม่ได้รอบนี้ — รอบถัดไปลองใหม่ */ }
}
const criticalAreas = new Set(criticals.map((p) => p.area));

// ── 2) state (รอบก่อนส่งอะไรไปแล้วบ้าง) ──
mkdirSync(STATEDIR, { recursive: true });
let state = { alerts: {} };
try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch { /* ยังไม่มี */ }
if (!state.alerts) state.alerts = {};

// ── 3) Telegram creds — อ่านจาก DB + **ถอดรหัส + cache ลงไฟล์** ──
// บทเรียนจริง 25 ก.ย. 2026: docker daemon ล่ม = DB ตาย = อ่าน creds ไม่ได้ = แจ้งไม่ออกพอดีตอนที่ต้องแจ้งที่สุด
// วิธี: อ่าน DB สำเร็จเมื่อไรเขียน cache ทับเสมอ (logs/ เป็น gitignored — ไม่มี token ลง git)
//       อ่าน DB ไม่ได้ → ใช้ cache ล่าสุดแทน (Telegram API เป็น external — ไม่ต้องพึ่ง docker)
// ⚠ Creds ใน DB เก็บเป็น AES-256-GCM (enc:v1:...) — ต้องถอดรหัสก่อนใช้
//   key อยู่ data/field-crypto.key (mount จาก core-api data volume)
const CREDS_CACHE = join(STATEDIR, 'telegram-creds.json');
const CRYPTO_KEY_FILE = join(REPO, 'sovereign-os', 'core-api', 'data', 'field-crypto.key');
const PREFIX = 'enc:v1:';

let cachedCryptoKey = null;
function loadCryptoKey() {
  if (cachedCryptoKey) return cachedCryptoKey;
  try {
    const k = fs.readFileSync(CRYPTO_KEY_FILE);
    if (k.length === 32) {
      cachedCryptoKey = k;
      return cachedCryptoKey;
    }
  } catch { /* ไม่มี key = สร้างใหม่ไม่ได้ */ }
  return null;
}

function decryptField(value) {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value; // plaintext เก่า
  const key = loadCryptoKey();
  if (!key) return '';
  try {
    const [ivB64, dataB64] = value.slice(PREFIX.length).split(':');
    const raw = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function dbCreds() {
  try {
    const out = execSync(
      `docker exec sovereign-db psql -U sovereign -d sovereign -t -A -c "SELECT value FROM system_settings WHERE key='telegram.botToken'; SELECT value FROM system_settings WHERE key='telegram.chatId';"`,
      { windowsHide: true, encoding: 'utf8', timeout: 20_000 }
    ).split('\n').map((l) => l.trim()).filter(Boolean);
    const rawToken = out[0] ?? '';
    const rawChatId = out[1] ?? '';
    const creds = { token: decryptField(rawToken), chatId: decryptField(rawChatId) };
    if (creds.token && creds.chatId) {
      try { writeFileSync(CREDS_CACHE, JSON.stringify(creds) + '\n'); } catch { /* soft-fail */ }
    }
    return creds;
  } catch {
    try { return JSON.parse(readFileSync(CREDS_CACHE, 'utf8')); } catch { return { token: '', chatId: '' }; }
  }
}
async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    // รายงานสาเหตุจริงเสมอ (เคสจริง: "17GB < 19GB" มี < ทำ HTML parse พัง → 400)
    const body = await res.text().catch(() => '');
    console.log(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.ok;
}

// ── 4) จดลง alert_events (ให้ /alert-history เห็นเหมือน alert อื่น) — soft-fail ──
const esc = (s) => String(s).replace(/'/g, "''").replace(/\r?\n/g, ' | ');
function insertEventSql({ severity, eventKey, title, detail, sent, suppressed }) {
  return `docker exec sovereign-db psql -U sovereign -d sovereign -c "INSERT INTO alert_events (id, severity, event_key, title, detail, sent, suppressed, source) VALUES (gen_random_uuid()::text, '${esc(severity)}', '${esc(eventKey)}', '${esc(title)}', '${esc(detail)}', ${sent}, ${suppressed ? `'${esc(suppressed)}'` : 'NULL'}, 'machine-alert');"`;
}
// คิวรอ: event ที่จด DB ไม่ได้ (DB ตายพอดี) — เก็บ JSONL ไว้แล้ว flush รอบถัดไปเมื่อ DB กลับมา
// (บทเรียนจริง 25 ก.ย.: ตอน daemon ล่ม ทั้ง Telegram-creds และ DB ตายพร้อมกัน — ประวัติต้องไม่หาย)
const PENDING = join(STATEDIR, 'pending-events.jsonl');
function queuePending(rec) { try { appendFileSync(PENDING, JSON.stringify(rec) + '\n'); } catch { /* เคสสุดท้ายที่ยอมปล่อย */ } }
function flushPending() {
  if (DRY || !existsSync(PENDING)) return;
  let left = [];
  try {
    const lines = readFileSync(PENDING, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { execSync(insertEventSql(JSON.parse(line)), { windowsHide: true, encoding: 'utf8', timeout: 20_000, stdio: 'pipe' }); }
      catch { left.push(line); }
    }
  } catch { return; }
  try { writeFileSync(PENDING, left.length ? left.join('\n') + '\n' : ''); } catch { /* soft-fail */ }
}
function recordEvent(rec) {
  if (DRY) return;
  try {
    execSync(insertEventSql(rec), { windowsHide: true, encoding: 'utf8', timeout: 20_000, stdio: 'pipe' });
  } catch (err) {
    queuePending(rec);
    console.log('จด alert_events ไม่สำเร็จ — เข้าคิวรอ flush (soft-fail):', err instanceof Error ? err.message.split('\n')[0] : err);
  }
}

// ── 5) วินิจฉัย: ส่งอะไรบ้างรอบนี้ ──
const now = Date.now();
const toSend = [];   // { problem, repeat }
const toRecover = []; // { area, lastSent }
for (const p of criticals) {
  const key = `machine:${p.area}`;
  const last = state.alerts[key];
  if (last && now - Date.parse(last) < COOLDOWN_MS) continue; // ยับ — เพิ่งแจ้งไป
  toSend.push({ problem: p, repeat: Boolean(last) });
}
for (const key of Object.keys(state.alerts)) {
  const area = key.replace('machine:', '');
  if (!criticalAreas.has(area)) toRecover.push({ area, lastSent: state.alerts[key] });
}

// heartbeat — พิสูจน์ว่า task ยิงจริงทุกรอบ (ตรวจได้: logs/machine-alert/last-run.json) — เขียนทุกรอบก่อนจบเสมอ
try {
  writeFileSync(
    join(STATEDIR, 'last-run.json'),
    JSON.stringify({
      checkedAt: health.checkedAt,
      criticals: criticals.length,
      sent: toSend.length,
      recovered: toRecover.length,
    }, null, 2) + '\n'
  );
} catch { /* soft-fail */ }

// flush คิวเก่าก่อนเสมอ (รวมรอบเงียบ — DB ฟื้นก็ต้องไล่จดให้ครบแม้ไม่มี critical ใหม่)
flushPending();
// prewarm creds cache ทุกรอบ (docker exec เบามาก) — ตอนวิกฤตต้องมีของสดรออยู่แล้ว
const { token, chatId } = dbCreds();

if (!toSend.length && !toRecover.length) {
  console.log(`ไม่มี critical ใหม่ (warn ทิ้งไว้ให้ nightly สรุป) — จบรอบ`);
  process.exit(0);
}

const ctx = `แรมว่าง ${health.info?.ramFreeGB ?? '?'}GB · ดิสก์ E: ${health.info?.diskFreeGB ?? '?'}GB`;
// Telegram HTML ห้าม < > & ดิบในข้อความ (เคสจริง: ข้อความเกณฑ์มี "17GB < 19GB" → 400 can't parse entities)
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 6) ส่ง + จด ──
// ⚠ สวิตช์เปิด/ปิดของเจ้าของ (12/10/69): ปิดไว้เป็นค่าเริ่มต้น
//   เพราะ "ส่งข้อมูลหลาย ๆ อย่างโดยที่ยังไม่ได้จริง บางทีมันก็รก"
//   ปิดแล้วยังตรวจสุขภาพอยู่เหมือนเดิม และยังจด alert_events ไว้ครบ
//   เปิดกลับ: node tools/alerts.mjs on
const alertCfg = readAlertConfig();
// ต้องเป็นจริงทั้ง 3 ข้อ: เจ้าของสั่งส่ง + สวิตช์เปิด + มี creds
const canSend = Boolean(token && chatId) && !DRY && alertCfg.enabled && SEND;
const suppressedReason = !SEND ? 'not-requested' : !alertCfg.enabled ? 'alerts-off' : null;
if (!canSend && (toSend.length || toRecover.length) && !DRY) {
  const why = !SEND
    ? 'ยังไม่มีคำสั่งส่ง (งานอัตโนมัติไม่ส่งโดยตั้งใจ)'
    : 'สวิตช์ปิดอยู่';
  console.log(`ไม่ส่ง Telegram (${toSend.length} เรื่องรอ) — ${why} · สั่งเอง: node tools/alerts.mjs now`);
}

for (const { problem, repeat } of toSend) {
  const key = `machine:${problem.area}`;
  const title = `${repeat ? '🔴' : '🚨'} เครื่องวิกฤต: ${problem.area}`;
  const text =
    `<b>${repeat ? '🔴 ยังวิกฤตต่อ (แจ้งซ้ำตาม cooldown)' : '🚨 เครื่องมีปัญหาระดับวิกฤต'}</b>\n` +
    `🚨 ${escHtml(problem.message)}\n` +
    `<i>${escHtml(ctx)} · ${new Date().toLocaleString('th-TH')}</i>`;
  let sent = false;
  if (canSend) {
    // ลองส่ง 3 ครั้ง (ห่าง 5 วิ) — วิกฤตต้องไม่แพ้ network แวบเดียว
    for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
      try { sent = await sendTelegram(token, chatId, text); }
      catch (err) { console.log('ส่งไม่สำเร็จ (soft-fail):', err instanceof Error ? err.message : err); }
      if (!sent && attempt < 3) await new Promise((r) => setTimeout(r, 5_000));
    }
    console.log(sent ? `ส่ง Telegram แล้ว: ${title}` : `Telegram ส่งไม่สำเร็จ 3 ครั้ง — จะลองใหม่รอบถัดไป (ไม่มาร์ค state)`);
  } else {
    // บอกเหตุผลจริง — เดิมพิมพ์ "ไม่มี creds" ทั้งที่อาจเป็นเพราะสวิตช์ปิด
    //   (ทำให้ตอนแก้ปัญหาไปคนละทาง เคสจริง 12/10/69)
    const why = suppressedReason === 'alerts-off'
      ? 'สวิตช์ปิดอยู่'
      : DRY ? '[dry]' : 'ไม่มี Telegram creds';
    console.log(`${why} — จะส่ง: ${title}\n${text}`);
  }
  recordEvent({
    severity: 'critical', eventKey: key, title, detail: `${problem.message} (${ctx})`,
    sent, suppressed: sent ? null : (suppressedReason ?? (DRY ? 'dry' : (canSend ? 'send-failed' : 'no-creds'))),
  });
  // มาร์คเฉพาะเมื่อส่งถึงจริง — ส่งไม่ออก = รอบถัดไป (10 นาที) ลองใหม่ทันที ไม่ติด cooldown
  // (บั๊กจริง 25 ก.ย.: เคยมาร์คทั้งที่ส่งไม่ออก → alert หายเงียบเป็นชั่วโมง)
  // ⚠ ปิดสวิตช์อยู่ = ห้ามมาร์คเด็ดขาด มิฉะนั้นเปิดกลับมาแล้วจะไม่ส่งซ้ำเลย
  //   เพราะ "ส่งแล้ว" ทั้งที่ยังไม่เคยส่ง (เคสจริง 12/10/69 ที่เจ้าของเปิด-ปิดเอง)
  if (!DRY && sent) state.alerts[key] = new Date().toISOString();
}

for (const { area, lastSent } of toRecover) {
  const key = `machine:${area}`;
  const title = `✅ เครื่องกลับมาปกติ: ${area}`;
  const mins = Math.max(1, Math.round((now - Date.parse(lastSent)) / 60_000));
  const text = `<b>✅ วิกฤตหายแล้ว</b>\n${title} (วิกฤตอยู่ ~${mins} นาที)\n<i>${escHtml(ctx)} · ${new Date().toLocaleString('th-TH')}</i>`;
  let sent = false;
  if (canSend) {
    try { sent = await sendTelegram(token, chatId, text); } catch { /* soft-fail */ }
  }
  console.log(`${sent ? 'ส่ง' : suppressedReason === 'alerts-off' ? 'สวิตช์ปิดอยู่ — จะส่ง' : DRY ? '[dry] จะส่ง' : 'จะส่ง'} recovery: ${title}`);
  recordEvent({ severity: 'info', eventKey: key, title, detail: `หายจากวิกฤต (${mins} นาที) (${ctx})`, sent, suppressed: sent ? null : (suppressedReason ?? (DRY ? 'dry' : 'no-creds')) });
  // ปิดสวิตช์อยู่ = อย่าลบ state ไม่งั้นเปิดกลับมาจะไม่รู้ว่าเคยวิกฤตอะไร
  if (!DRY && alertCfg.enabled) delete state.alerts[key];
}

if (!DRY) writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
process.exit(0);
