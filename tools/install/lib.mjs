// tools/install/lib.mjs
//
// ตรรกะบริสุทธิ์ของตัวติดตั้งครั้งเดียว — แยกออกมาเพราะเป็นส่วนที่ *ผิดแล้วเจ็บหนัก*
// (เขียน .env ทับรหัสฐานข้อมูลเดิม = ข้อมูลทั้งระบบเริ่มไม่ได้) จึงต้องมีเทสต์คุม
// โดยไม่ต้องพึ่ง Docker/พอร์ต/เครื่องจริง
//
// กติกา: ไฟล์นี้ห้ามแตะดิสก์ ห้ามรันคำสั่ง ห้ามอ่าน env ของโปรเซส — รับเข้า/คืนออกเท่านั้น
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** คีย์ที่เป็นความลับที่ตัวติดตั้งสุ่มให้เอง — ใช้ทั้งตอนสร้างและตอนปิดค่าใน dry-run */
export const SECRET_KEYS = [
  'POSTGRES_PASSWORD',
  'TIMESCALE_PASSWORD',
  'EMQX_PASSWORD',
  'JWT_SECRET',
  'OTA_TOKEN',
  'SEED_ADMIN_PASSWORD',
];

/** คีย์ที่ต้องตรงกับ infra/.env เสมอ (ผู้ใช้แก้ที่ infra ที่เดียว ที่เหลือตามให้เอง) */
export const DERIVED_CORE_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'TIMESCALE_PASSWORD',
  'TIMESCALE_USER',
  'TIMESCALE_DB',
  'SEED_ADMIN_PASSWORD',
  'OTA_TOKEN',
];

const PLACEHOLDER_RE = /__GEN_[A-Z0-9_]+__/;

/** สุ่ม hex — ยาวตามจำนวน byte (ค่าเริ่มต้น 12 byte = 24 hex เท่า template เดิม) */
export function defaultRandHex(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

/**
 * สุ่ม secret ต่อคีย์ (ไม่ใช่ต่อ placeholder) เพื่อให้ EMQX/JWT/OTA แยกกันจริง
 * ยกเว้น TIMESCALE_PASSWORD ที่ต้องเท่ากับ POSTGRES_PASSWORD เพราะเป็นรหัสผู้ใช้ DB คนเดียวกัน
 */
export function generateSecrets(randHex = defaultRandHex) {
  const pg = randHex(12);
  return {
    POSTGRES_PASSWORD: pg,
    TIMESCALE_PASSWORD: pg,
    EMQX_PASSWORD: randHex(12),
    JWT_SECRET: randHex(24),
    OTA_TOKEN: randHex(16),
    SEED_ADMIN_PASSWORD: randHex(8),
  };
}

/** อ่าน KEY=value เป็น object (ค่าซ้ำ → ค่าสุดท้ายชนะ · ตัด quote ครอบออก) */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

/**
 * อัปเดตคีย์ในที่เดิม · เพิ่มคีย์ที่ขาด · ตัดคีย์ซ้ำเหลือบรรทัดเดียว
 * ไม่แตะคอมเมนต์ ไม่แตะคีย์อื่น และคงสไตล์ขึ้นบรรทัดของไฟล์เดิม (LF/CRLF)
 */
export function upsertEnv(text, pairs) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map(pairs);
  const targets = new Set(pending.keys());
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (!m || !targets.has(m[1])) {
      out.push(line);
      continue;
    }
    const key = m[1];
    if (seen.has(key)) continue; // คีย์ซ้ำ — ตัดทิ้ง กัน "ค่าเก่าชนะ" แบบเงียบ ๆ
    seen.add(key);
    out.push(`${key}=${pending.get(key)}`);
    pending.delete(key);
  }
  // คีย์ที่ยังไม่ถูกเขียน → ต่อท้าย (ก่อนบรรทัดว่างบรรทัดสุดท้ายถ้ามี)
  if (pending.size) {
    const tail = out.length && out[out.length - 1] === '' ? out.pop() : null;
    for (const [key, value] of pending) out.push(`${key}=${value}`);
    if (tail !== null) out.push(tail);
  }
  return out.join(eol);
}

/** แทน __GEN_*__ ตามชื่อคีย์บนบรรทัดนั้น — เจอ placeholder ที่ไม่มีค่า = โยน (ดีกว่าเขียนค่าปลอมลง .env) */
export function renderTemplate(templateText, secrets) {
  const lines = String(templateText).split(/\r?\n/);
  const out = lines.map((line) => {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(__GEN_[A-Z0-9_]+__)\s*$/);
    if (!m) return line;
    const value = secrets[m[1]];
    if (!value) throw new Error(`เทมเพลตมี ${m[2]} ของคีย์ ${m[1]} แต่ไม่มีค่าที่สุ่มไว้ให้`);
    return `${m[1]}=${value}`;
  });
  return out.join('\n');
}

/**
 * รวม "ค่าที่ต้องการ" กับ "ไฟล์เดิม" → ไฟล์ใหม่ + รายการคีย์ที่ถูกเติม/เปลี่ยน
 * ค่าที่ผู้ใช้ตั้งไว้แล้ว (ไม่ว่าง) ชนะเสมอ ยกเว้นคีย์ใน `always` (ใช้ตอน --force)
 */
export function composeEnv({ baseText, desired, existingText = null, always = [] }) {
  const existing = existingText ? parseEnv(existingText) : {};
  const pairs = [];
  const changed = [];
  for (const [key, value] of Object.entries(desired)) {
    const had = Object.prototype.hasOwnProperty.call(existing, key);
    const hadValue = had && existing[key] !== '';
    if (hadValue && !always.includes(key)) {
      pairs.push([key, existing[key]]);
    } else {
      pairs.push([key, value]);
      // คีย์ว่างในเทมเพลต (เช่น TELEGRAM_BOT_TOKEN=) ไม่ใช่ "การเปลี่ยน" — ต้องไม่ทำให้ไฟล์ถูกรายงานว่าแก้
      if (!had || existing[key] !== value) changed.push(key);
    }
  }
  const text = upsertEnv(existingText ?? baseText, pairs);
  return { text, changed };
}

/** infra/.env — หัวใจของการติดตั้งซ้ำ: secret เดิมต้องอยู่ครบ */
export function buildInfraEnv({ templateText, existingText = null, secrets, force = false }) {
  const rendered = renderTemplate(templateText, secrets);
  const desired = parseEnv(rendered);
  // เทมเพลตที่ผู้ใช้แก้เองอาจปล่อยคีย์ความลับเป็นค่าว่าง — ตัวติดตั้งต้องเติมให้ (ค่าว่าง = ระบบเริ่มไม่ได้)
  for (const key of SECRET_KEYS) {
    if (!desired[key] && secrets[key]) desired[key] = secrets[key];
  }
  const { text, changed } = composeEnv({
    baseText: rendered,
    desired,
    existingText,
    always: force ? SECRET_KEYS : [],
  });
  return { text, changed };
}

/** sovereign-os/core-api/.env — ค่าที่ต้องตรงกับ container บังคับให้ตาม infra เสมอ */
export function buildCoreApiEnv({ infraText, existingText = null }) {
  const infra = parseEnv(infraText);
  const user = infra.POSTGRES_USER || 'sovereign';
  const db = infra.POSTGRES_DB || 'sovereign';
  const pass = infra.POSTGRES_PASSWORD || '';
  const desired = {
    DATABASE_URL: `postgresql://${user}:${pass}@localhost:5432/${db}`,
    JWT_SECRET: infra.JWT_SECRET || '',
    PORT: '3001',
    MQTT_HOST: 'localhost',
    MQTT_PORT: '1883',
    MQTT_USER: infra.EMQX_USERNAME || '',
    MQTT_PASS: infra.EMQX_PASSWORD || '',
    TIMESCALE_HOST: 'localhost',
    TIMESCALE_PORT: '5432',
    TIMESCALE_DB: db,
    TIMESCALE_USER: user,
    TIMESCALE_PASSWORD: pass,
    TELEGRAM_BOT_TOKEN: infra.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: infra.TELEGRAM_CHAT_ID || '',
    OLLAMA_URL: 'http://127.0.0.1:11434',
    AI_MODEL: 'gemma3:4b',
    EMBED_MODEL: infra.EMBED_MODEL || 'nomic-embed-text',
    BACKUP_DIR: './backups',
    DB_CONTAINER: 'sovereign-db',
    OTA_BASE_URL: 'http://localhost:3001',
    OTA_DIR: './ota_firmwares',
    OTA_TOKEN: infra.OTA_TOKEN || '',
    ENERGY_CAPACITY_KWH: infra.ENERGY_CAPACITY_KWH || '5',
    SEED_ADMIN_PASSWORD: infra.SEED_ADMIN_PASSWORD || '',
    THREAT_DETECTION_ENABLED: 'true',
    THREAT_CHECK_INTERVAL_MS: '60000',
    THREAT_CONNECTION_THRESHOLD: '100',
    THREAT_IP_COOLDOWN_MS: '600000',
    THREAT_BASELINE_WINDOW_MS: '3600000',
    THREAT_ALLOWLIST_IPS: '',
    FIREWALL_BLOCK_CMD: '',
  };
  const base = [
    '# Sovereign OS core-api env — สร้างโดย tools/install/install.mjs',
    '# ใช้ตอนรัน core-api บนเครื่องตรง ๆ (prisma migrate / npm test) · container อ่านค่าจาก infra/.env',
    '# ค่าที่ผูกกับฐานข้อมูลถูก sync จาก infra/.env ทุกครั้งที่รันตัวติดตั้ง — อย่าแก้เอง',
    '',
  ].join('\n');
  return composeEnv({ baseText: base, desired, existingText, always: DERIVED_CORE_KEYS });
}

/** sovereign-frontend/.env.local — NEXT_PUBLIC_* ถูกฝังตอน build จึงต้องมีก่อน build */
export function buildFrontendEnv({ apiUrl, existingText = null }) {
  const desired = { NEXT_PUBLIC_API_URL: apiUrl, NEXT_PUBLIC_WS_URL: apiUrl };
  const base = [
    '# Sovereign OS dashboard env — สร้างโดย tools/install/install.mjs',
    '# NEXT_PUBLIC_* ถูกฝังตอน `npm run build` — แก้แล้วต้อง build ใหม่ (หรือตั้ง API URL ในหน้า /settings)',
    '',
    'NEXT_PUBLIC_API_URL=',
    'NEXT_PUBLIC_WS_URL=',
  ].join('\n');
  return composeEnv({ baseText: base, desired, existingText });
}

/**
 * sovereign-os/agent-runner/.env — ต้องมีครบทุกคีย์ที่ main.mjs/fsops.mjs อ่านจริง
 * (เทสต์เทียบกับโค้ดจริงอยู่ ⇒ เพิ่มคีย์ใหม่ในโค้ดแล้วลืมที่นี่ จะแดงทันที)
 */
export function buildRunnerEnv({
  hubUrl,
  token = '',
  name = '',
  executors = 'echo',
  maxWidth = 1280,
  existingText = null,
}) {
  const desired = {
    HUB_URL: hubUrl,
    MACHINE_TOKEN: token,
    MACHINE_NAME: name || 'runner',
    ENABLED_EXECUTORS: executors,
    POLL_INTERVAL_MS: '15000',
    HEARTBEAT_SEC: '30',
    CAPTURE_SCREENSHOT: 'true',
    OPENCODE_BIN: 'opencode',
    // ช่องดูจอ/ควบคุมระยะไกล — เปิดตั้งแต่ติดตั้ง เพราะเป็นเหตุผลที่เครื่องนี้ลงทะเบียนกับ HUB
    ENABLE_REMOTE_CONTROL: 'true',
    REMOTE_MAX_WIDTH: String(maxWidth),
    // ว่าง = ทั้งไดรฟ์ (ผู้ใช้เลือกไว้) · ใส่ path คั่น ; เพื่อรัดขอบเขตให้แคบลง
    REMOTE_FS_ROOTS: '',
  };
  const base = [
    '# Agent Runner env — สร้างโดย tools/install/install.mjs',
    '# MACHINE_TOKEN ได้จากหน้าเว็บ HUB → คิวเอเจนต์ → ลงทะเบียนเครื่องใหม่ (แสดงครั้งเดียว)',
    '',
  ].join('\n');
  return composeEnv({ baseText: base, desired, existingText });
}

const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

/**
 * HUB_URL ที่เครื่องอื่นใน LAN ใช้ได้จริงคือ :3000 เท่านั้น (API ผูก 127.0.0.1:3001)
 * ปล่อยผ่าน = ติดตั้ง "สำเร็จ" แต่ runner ต่อไม่ติดตลอดไป ⇒ ต้องปฏิเสธตั้งแต่ก่อนเขียนไฟล์
 */
export function assertHubUrl(raw) {
  const url = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('ต้องระบุ HUB_URL เช่น http://192.168.1.102:3000');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`HUB_URL ไม่ใช่ URL ที่ถูกต้อง: ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`HUB_URL ต้องเป็น http/https: ${url}`);
  if (!LOOPBACK_RE.test(parsed.hostname) && parsed.port === '3001') {
    throw new Error(
      `HUB_URL=${url} ใช้ไม่ได้จากเครื่องอื่น — API ผูกกับ 127.0.0.1:3001 เท่านั้น ` +
        'ให้ใช้พอร์ต 3000 ของหน้าเว็บ (rewrite /api/* ให้เอง) เช่น http://<IP-ของ-HUB>:3000'
    );
  }
  return url;
}

/** true เมื่อพาธมีเว้นวรรค — จุดที่ schtasks เคยล้มเงียบ */
export function pathHasSpace(dir) {
  return String(dir).includes(' ');
}

/**
 * launcher ในโฟลเดอร์ runner เอง — กันปัญหา schtasks ตัดพาธที่มีเว้นวรรค
 * เพราะคำสั่งใน task ไม่มีพาธโปรเจ็กเลย มีแค่พาธ launcher ที่ถูก quote แล้ว
 * และ `%~dp0` พา cd ไปที่โฟลเดอร์จริงเองตอนรัน ⇒ ไม่ต้องพึ่ง %RUNNER_DIR% ตอนสร้าง task
 */
export function buildRunnerLauncher({ runnerDir, nodeExe }) {
  const exe = String(nodeExe || 'node').replace(/"/g, '');
  const text = [
    '@echo off',
    'REM สร้างโดย tools/install/install.mjs — scheduled task เรียกไฟล์นี้',
    'REM ห้ามย้ายไฟล์นี้ออกจากโฟลเดอร์ agent-runner (ใช้ %~dp0 เป็นที่อยู่ของตัวเอง)',
    'cd /d "%~dp0"',
    `"${exe}" src\\main.mjs`,
    'REM ถ้าโปรเซสตาย ให้คงหน้าต่างไว้ดู error (task จะได้ไม่กู้ไม่หยุด)',
    'if errorlevel 1 pause',
    '',
  ].join('\r\n');
  return { path: path.join(runnerDir, 'run-runner.cmd'), text };
}

/** อาร์กิวเมนต์ schtasks — /TR ต้อง quote ทั้งก้อนเพราะพาธมีเว้นวรรคได้ */
export function buildRunnerTaskCreateArgs({ taskName, launcherPath }) {
  return [
    'schtasks',
    '/Create',
    '/TN',
    taskName,
    '/TR',
    `"${launcherPath}"`,
    '/SC',
    'ONLOGON',
    // HIGHEST: โปรเซสยศสูงเท่าผู้ใช้ — จำเป็นสำหรับฉีดเมาส์/คีย์บอร์ด (Windows UIPI)
    '/RL',
    'HIGHEST',
    '/F',
  ];
}

/** อ่านผล `schtasks /Query /TN <name> /FO LIST /V` ว่า task มีจริงและชี้ไปที่ launcher ของเรา */
export function parseSchtasksQuery(text) {
  const raw = String(text ?? '');
  if (/ERROR|ไม่พบ|cannot find/i.test(raw) && !/TaskName:/i.test(raw)) {
    return { exists: false, taskToRun: '' };
  }
  const m = raw.match(/^\s*Task\s+To\s+Run:\s*(.+)$/im);
  if (!m) return { exists: false, taskToRun: '' };
  return { exists: true, taskToRun: m[1].trim() };
}

/**
 * ชื่อคีย์ที่ถือว่าเป็นความลับ — ใช้ *ชื่อ* ไม่ใช่รายการคีย์ที่เราสุ่มเอง
 * บทเรียนจริง: dry-run ครั้งแรกพิมพ์ค่าจริงใน infra/.env ของผู้ใช้ (รหัสแอป Gmail) ลง transcript
 * เพราะปิดเฉพาะคีย์ที่เราสร้าง ⇒ ต้องปิดทุกคีย์ที่ชื่อฟ้องว่าเป็นความลับของผู้ใช้ด้วย
 */
const SECRET_NAME_RE = /(PASSWORD|PASSWD|PASS$|_PASS|SECRET|TOKEN|API_?KEY|_KEY$|CREDENTIAL)/i;

export function redactSecrets(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      // รหัสผ่านที่ "ฝังอยู่ใน URL" (เช่น DATABASE_URL=postgresql://user:pass@host)
      // ต้องปิดก่อน — ไม่งั้นคีย์นี้ไม่เข้า SECRET_NAME_RE แล้วหลุดเฉย ๆ
      const masked = line.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):([^\s/@]+)@/gi, '$1:***@');
      const m = masked.match(/^\s*([A-Za-z0-9_]+)\s*=/);
      if (!m || !SECRET_NAME_RE.test(m[1])) return masked;
      return `${m[1]}=***`;
    })
    .join('\n');
}

/** สรุปผลรายขั้น → exit code + สิ่งที่ต้องทำต่อ (ห้ามรายงานว่าเสร็จเมื่อมีขั้นล้ม) */
export function summarizeSteps(steps) {
  const failed = steps.filter((s) => s.status === 'fail');
  const nextActions = [];
  for (const s of failed) {
    const action = s.nextAction || s.detail;
    if (action) nextActions.push(`[${s.name}] ${action}`);
  }
  return { ok: failed.length === 0, failed: failed.map((s) => s.name), nextActions, exitCode: failed.length ? 1 : 0 };
}
