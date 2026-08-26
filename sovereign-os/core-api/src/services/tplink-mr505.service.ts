// src/services/tplink-mr505.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// TP-Link Archer MR505 Admin API Adapter — ถอดจาก firmware v202401291507
// Login: challenge(seq,salt) → XOR 2 ชั้น → GET/POST ?code=7&asyn=0&id=token
// Read : POST ?code=2&asyn=1&id=token  body "id <DATA_ID>|1,0,0\r\n"
// Data IDs: LTE_NET_STATUS=141 · LTE_SERVING_CELL=151 · LTE_DATA(usage) · WLAN_STA_LIST=111
// รหัส admin เก็บใน SystemSetting 'router.adminPassword' — ห้าม hardcode
// ⚠️ ระวัง lockout: รหัสผิด 4 ครั้ง = lock 7200 วินาที — cron ต้องไม่ยิงถ้า password ว่าง
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';

const KEY1 = 'RDpbLfCPsJZ7fiv';
const SEED2 = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';

export const ROUTER_HOST = process.env.ROUTER_HOST || '192.168.1.1';
const PASSWORD_KEY = 'router.adminPassword';

// ── XOR encrypt — เหมือน $.su.encrypt ใน tpEncrypt.new.js ──
export function suEncrypt(t: string, r: string, e: string): string {
  r = r || KEY1;
  e = e || SEED2;
  const lenT = t.length, lenR = r.length, lenE = e.length;
  const use = Math.min(lenT, lenR);
  let out = '';
  for (let y = 0; y < use; y++) {
    let p = 187, c = 187;
    if (lenR <= y) c = r.charCodeAt(y);
    else if (lenT <= y) p = t.charCodeAt(y);
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
  return session;
}

/** อ่าน model ตาม data ID — คืน key-value หรือ null */
export async function readModel(dataId: number, session: RouterSession): Promise<Record<string, string> | null> {
  const url = `/?code=2&asyn=1&id=${encodeURIComponent(session.token)}`;
  const r = await httpPost(url, `id ${dataId}|1,0,0\r\n`);
  if (r.status !== 200 || r.text.startsWith('<!DOCTYPE')) return null; // session ตาย → ให้ login ใหม่รอบหน้า
  return parseModelResponse(r.text);
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
    const parsed = parseModelResponse(r.text);
    // รวม IP/MAC/hostname จาก list fields (รูปแบบขึ้นกับ firmware — เก็บดิบไว้ก่อน)
    out.clients = Object.entries(parsed).map(([k, v]) => `${k}=${v}`.slice(0, 60));
  }
  return out;
}

export function invalidateSession(): void { session = null; }
