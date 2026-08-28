// src/services/tplink-mr505.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// TP-Link Archer MR505 Admin API Adapter — ถอดจาก firmware v202401291507
// Login: challenge(seq,salt) → XOR 2 ชั้น → GET/POST ?code=7&asyn=0&id=token
// Read : POST ?code=2&asyn=1&id=token  body "id <DATA_ID>|1,0,0\r\n"
// Data IDs: LTE_NET_STATUS=141 · LTE_SERVING_CELL=151 · LTE_DATA(usage) · WLAN_STA_LIST=111
// รหัส admin เก็บใน SystemSetting 'router.adminPassword' — ห้าม hardcode
// ⚠️ ระวัง lockout: รหัสผิด 4 ครั้ง = lock 7200 วินาที — cron ต้องไม่ยิงถ้า password ว่าง
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const KEY1 = 'RDpbLfCPsJZ7fiv';
const SEED2 = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';

export const ROUTER_HOST = process.env.ROUTER_HOST || '192.168.1.1';
const PASSWORD_KEY = 'router.adminPassword';

// ── XOR encrypt — เหมือน $.su.encrypt ใน tpEncrypt.new.js ──
// loop ถึง MAX(len(data), len(key)) — ตัวที่เกินใช้ 187 (default) XOR กับอีกฝั่ง
export function suEncrypt(t: string, r: string, e: string): string {
  r = r || KEY1;
  e = e || SEED2;
  const lenT = t.length, lenR = r.length, lenE = e.length;
  const total = Math.max(lenT, lenR); // ← MAX! ไม่ใช่ MIN (bug เดิมทำรหัสยาว>15ตัวพัง)
  let out = '';
  for (let y = 0; y < total; y++) {
    let p = 187, c = 187;
    if (lenT <= y) c = r.charCodeAt(y);       // data หมด → ใช้ key อย่างเดียว
    else if (lenR <= y) p = t.charCodeAt(y);  // key หมด → ใช้ data อย่างเดียว
    else { p = t.charCodeAt(y); c = r.charCodeAt(y); }
    out += e.charAt((p ^ c) % lenE);
  }
  return out;
}

// ── Pure: parse challenge response → seq/salt ──
export function parseChallenge(body: string): { seq: string; salt: string; rsaKey: string } | null {
  const lines = body.split('\r\n').filter(Boolean);
  if (lines.length < 4) return null;
  return { seq: lines[2], salt: lines[3], rsaKey: lines[4] || '' };
}

// ── Pure: parse model response → key-value ──
// Response รูปแบบ: "key1 value1\r\nkey2 value2\r\n..." (ค่า URL-encoded)
export function parseModelResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\r\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const key = line.slice(0, sp);
    const val = line.slice(sp + 1);
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

async function getAdminPassword(): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: PASSWORD_KEY } });
    return row?.value || '';
  } catch { return ''; }
}

export async function setAdminPassword(password: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: PASSWORD_KEY },
    update: { value: password },
    create: { key: PASSWORD_KEY, value: password },
  });
}

// ── AES session (หลัง syncEncryptor สำเร็จ Response body จะ AES-CBC base64) ──
let aesKey: Buffer | null = null;
let aesIv: Buffer | null = null;

export function aesDecryptBase64(b64: string): string | null {
  if (!aesKey || !aesIv) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, aesIv);
    const dec = Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch { return null; }
}
export function aesEncryptToBase64(plain: string): string | null {
  if (!aesKey || !aesIv) return null;
  try {
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, aesIv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return enc.toString('base64');
  } catch { return null; }
}
export function isEncryptedBody(body: string): boolean {
  if (!body || body.includes('\r\n')) return false;
  if (body.startsWith('<!DOCTYPE') || body.includes(' ')) return false;
  const t = body.trim();
  if (t.length < 16 || t.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(t);
}
export function __setAesParamsForTest(key: Buffer, iv: Buffer) { aesKey = key; aesIv = iv; }
export function __clearAesParamsForTest() { aesKey = null; aesIv = null; }

function parseRsaPublicKey(raw: string): { modHex: string; expHex: string } | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j.nn && j.ee) return { modHex: String(j.nn), expHex: String(j.ee) };
    if (j.n && j.e) return { modHex: String(j.n), expHex: String(j.e) };
  } catch {}
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) return { modHex: parts[0], expHex: parts[1] };
  return null;
}
function rsaEncryptHex(plainHex: string, modHex: string, expHex: string): string | null {
  try {
    const n = BigInt('0x' + modHex);
    const e = BigInt('0x' + expHex);
    let m = BigInt('0x' + plainHex);
    if (m >= n) return null;
    let result = 1n; let base = m; let exp = e;
    while (exp > 0n) { if (exp & 1n) result = (result * base) % n; base = (base * base) % n; exp >>= 1n; }
    let hex = result.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const padLen = Math.ceil(modHex.length / 2) * 2 - hex.length;
    if (padLen > 0) hex = '0'.repeat(padLen) + hex;
    return hex;
  } catch { return null; }
}
function randomAesParams(): { key: Buffer; iv: Buffer } {
  return { key: crypto.randomBytes(16), iv: crypto.randomBytes(16) };
}
async function syncEncryptor(token: string, rsaRaw: string): Promise<boolean> {
  const rsa = parseRsaPublicKey(rsaRaw);
  if (!rsa) return false;
  const { key, iv } = randomAesParams();
  const keyHex = key.toString('hex');
  const ivHex = iv.toString('hex');
  const encKey = rsaEncryptHex(keyHex, rsa.modHex, rsa.expHex);
  const encIv = rsaEncryptHex(ivHex, rsa.modHex, rsa.expHex);
  if (!encKey || !encIv) return false;
  try {
    const r = await httpPost(`/?code=12&asyn=0&id=${encodeURIComponent(token)}`, `key=${encKey}&iv=${encIv}`);
    const ok = r.text.split('\r\n').filter(Boolean)[0] === '00000' || r.status === 200;
    if (ok) { aesKey = key; aesIv = iv; console.log('🔐 MR505 AES sync OK (128-CBC)'); return true; }
  } catch {}
  return false;
}

// ── Session ──
interface RouterSession { token: string; loggedInAt: number }
let session: RouterSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 นาที

async function httpPost(url: string, body: string): Promise<{ status: number; text: string }> {
  const r = await fetch(ROUTER_HOST.startsWith('http') ? ROUTER_HOST + url : `http://${ROUTER_HOST}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, text: await r.text() };
}

/** login → session token — คืน null ถ้า password ยังไม่ตั้ง / login ไม่ผ่าน */
export async function loginRouter(): Promise<RouterSession | null> {
  if (session && Date.now() - session.loggedInAt < SESSION_TTL_MS) return session;
  const password = await getAdminPassword();
  if (!password) return null; // ยังไม่ตั้ง — ไม่ยิง (กัน lockout)

  // Step 1: challenge
  const ch = await httpPost('/?code=7&asyn=1', '');
  const challenge = parseChallenge(ch.text);
  if (!challenge) return null;

  // Step 2-3: XOR 2 ชั้น
  const firstStage = suEncrypt(password, KEY1, SEED2);
  const authToken = suEncrypt(challenge.seq, firstStage, challenge.salt);

  // Step 4: login
  const login = await httpPost('/?code=7&asyn=0&id=' + encodeURIComponent(authToken), '');
  const loginLines = login.text.split('\r\n').filter(Boolean);
  const code = parseInt(loginLines[0] || '-1', 10);
  if (login.status !== 200 || code !== 0) {
    console.error(`🔑 MR505 login failed: code=${loginLines[0]} (0=OK 3=PSWERR 1=LOCK)`);
    return null;
  }

  // session token = encrypt(seq, firstStage, salt) (ตาม main.js login success)
  session = { token: authToken, loggedInAt: Date.now() };
  console.log('🔑 MR505 login OK — session 30 นาที');
  // Step 5: sync AES if router ส่ง RSA key มา (firmware ใหม่) — ไม่บังคับ ถ้าล้มเหลวก็ใช้งาน XOR-only ต่อ
  if (challenge.rsaKey) {
    try { await syncEncryptor(authToken, challenge.rsaKey); } catch {}
  }
  return session;
}

/** อ่าน model ตาม data ID — คืน key-value หรือ null (ถอด AES ถ้า body เข้ารหัส) */
export async function readModel(dataId: number, session: RouterSession): Promise<Record<string, string> | null> {
  const url = `/?code=2&asyn=1&id=${encodeURIComponent(session.token)}`;
  const r = await httpPost(url, `id ${dataId}|1,0,0\r\n`);
  if (r.status !== 200 || r.text.startsWith('<!DOCTYPE')) return null; // session ตาย → ให้ login ใหม่รอบหน้า
  let body = r.text;
  if (isEncryptedBody(body)) {
    const dec = aesDecryptBase64(body.trim());
    if (dec) body = dec;
  }
  return parseModelResponse(body);
}

// ── Public: ดึงข้อมูลซิมทั้งหมดจาก router ──
export interface RouterSimData {
  loggedIn: boolean;
  signal?: Record<string, string>;   // lteNetStatusModel (141)
  servingCell?: Record<string, string>; // lteServingCellModel (151)
  clients?: string[];                 // จาก WLAN_STA_LIST (111) — parse แบบ list
  error?: string;
}

export async function fetchRouterSimData(): Promise<RouterSimData> {
  const sess = await loginRouter();
  if (!sess) {
    const pw = await getAdminPassword();
    return { loggedIn: false, error: pw ? 'login failed (เช็ครหัส/lock)' : 'ยังไม่ตั้งรหัส admin — ใส่ผ่าน SQL: system_settings key=router.adminPassword' };
  }
  const out: RouterSimData = { loggedIn: true };

  // อ่านทีละ model (ถ้า session ตายกลางทาง → ล้าง session ให้ login รอบหน้า)
  const signal = await readModel(141, sess);
  if (!signal) { session = null; out.error = 'session expired — retry next cycle'; return out; }
  out.signal = signal;
  out.servingCell = (await readModel(151, sess)) ?? undefined;

  // WLAN STA list (111) — list format: "key index value\r\n"
  const r = await httpPost(`/?code=2&asyn=1&id=${encodeURIComponent(sess.token)}`, 'id 111|1,0,0\r\n');
  if (r.status === 200 && !r.text.startsWith('<!DOCTYPE')) {
    let body = r.text;
    if (isEncryptedBody(body)) { const dec = aesDecryptBase64(body.trim()); if (dec) body = dec; }
    const parsed = parseModelResponse(body);
    // รวม IP/MAC/hostname จาก list fields (รูปแบบขึ้นกับ firmware — เก็บดิบไว้ก่อน)
    out.clients = Object.entries(parsed).map(([k, v]) => `${k}=${v}`.slice(0, 60));
  }
  // ถ้า AES sync สำเร็จแต่ตัวเก่ายังเป็น XOR-only, อ่าน data usage เพิ่ม (ID 145/142 ตาม firmware MR505)
  if (aesKey) {
    for (const id of [145, 142]) {
      const extra = await readModel(id, sess);
      if (extra && Object.keys(extra).length) {
        out.signal = { ...(out.signal || {}), ...extra };
        break;
      }
    }
  }
  return out;
}

export function invalidateSession(): void { session = null; aesKey = null; aesIv = null; }
