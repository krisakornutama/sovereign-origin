// tools/verify/telegram-creds.mjs — เจ้าของเดียวของการแจ้งเตือน Telegram (shared โดย nightly-gate + security-anomaly)
// ลำดับ creds เดียวกับ core-api: telegram-credentials.service.ts — system_settings (ตั้งผ่านหน้า Settings) ชนะ infra/.env
// ชื่อฐาน/ผู้ใช้อ่านจาก infra/.env ไม่ hardcode
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INFRA_ENV = path.join(ROOT, 'sovereign-os', 'infra', '.env');

// F2 (28/9/69): telegram.botToken ใน system_settings เป็น "enc:v1:..." (AES-256-GCM) แล้ว —
// ถอดฝั่ง host ตรงนี้ (GCM ยืนยัน key ถูกเอง — ลอง key ของ MAIN ก่อน แล้ว key ของสำเนาที่รันอยู่)
const FIELD_KEY_CANDIDATES = [
  'E:/My work/Project Sovereign Origin/sovereign-os/core-api/data/field-crypto.key',
  path.join(ROOT, 'sovereign-os', 'core-api', 'data', 'field-crypto.key'),
];
function fieldDecrypt(value) {
  if (!value || !value.startsWith('enc:v1:')) return value || '';
  try {
    const [ivB64, dataB64] = value.slice('enc:v1:'.length).split(':');
    const raw = Buffer.from(dataB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    for (const kf of FIELD_KEY_CANDIDATES) {
      try {
        const key = fs.readFileSync(kf);
        if (key.length !== 32) continue;
        const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(raw.subarray(raw.length - 16));
        return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
      } catch { /* key ตัวถัดไป */ }
    }
  } catch { /* โครงไฟล์เพี้ยน */ }
  return ''; // ถอดไม่ได้ = ตีเป็นไม่มี token (กันส่งขยะไป Telegram)
}

function readInfraEnv() {
  if (!fs.existsSync(INFRA_ENV)) return {}; // รันจาก worktree (ไม่มี .env) — ตกลง default ด้านล่าง
  const env = {};
  for (const line of fs.readFileSync(INFRA_ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

export function readTelegramCreds() {
  const infra = readInfraEnv();
  let token = '', chatId = '';
  try {
    const q = (key) => execFileSync('docker',
      ['exec', 'sovereign-db', 'psql', '-U', infra.POSTGRES_USER || 'sovereign', '-d', infra.POSTGRES_DB || 'sovereign', '-tAc',
       `SELECT value FROM system_settings WHERE key='${key}'`],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    token = fieldDecrypt(q('telegram.botToken'));
    chatId = q('telegram.chatId');
    if (token && chatId) return { token, chatId, source: 'db' };
  } catch (e) {
    console.error(`[creds] อ่านจาก DB ไม่สำเร็จ (${e?.message || e}) — ลอง env ต่อ`);
  }
  return { token: infra.TELEGRAM_BOT_TOKEN || '', chatId: infra.TELEGRAM_CHAT_ID || '', source: 'env' };
}

async function sendTelegram(text, creds) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${creds.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? { ok: true } : { ok: false, error: `${r.status} ${(await r.text()).slice(0, 160)}` };
  } catch (e) { return { ok: false, error: e?.message || 'network error' }; }
}

/** แจ้งเตือน — ไม่มี creds = คืน { ok:false, error } อธิบาย (ผู้เรียก report ต่อได้) */
export async function notify(text, creds = readTelegramCreds()) {
  if (!creds.token || !creds.chatId) return { ok: false, error: 'ไม่มี credentials (ตั้งได้ที่หน้า Settings หรือ TELEGRAM_* ใน infra/.env)' };
  return sendTelegram(text, creds);
}
