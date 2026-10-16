import { prisma } from '../lib/prisma';
import { encryptField, decryptField } from './field-crypto.service';

// F2 (28/9/69): bot token เก็บเข้ารหัสเสมอ (enc:v1:...) — อ่านแล้วถอดกลับ · ค่าเก่า (plaintext) อ่านได้จนกว่าจะตั้งใหม่

// ── Telegram credential resolver: DB (ตั้งผ่าน UI) → env (.env) ──
// ให้ผู้ใช้กรอก bot token / chat ID ในหน้า Settings โดยไม่ต้องแก้ .env บนเครื่อง
// กฎความสำคัญ: ค่าที่ตั้งใน DB (system_settings) ชนะ env — เหมือน override


const TELEGRAM_TOKEN_KEY = 'telegram.botToken';
const TELEGRAM_CHAT_ID_KEY = 'telegram.chatId';
/**
 * ห้องเฉพาะธุรกิจ (16/10/69)
 *
 * เจ้าของบอก: "ตัวเดียวกับส่งข้อมูลเรื่องบ้าง แต่อันนี้แยกเฉพาะห้อง เพราะเกี่ยวกับธุรกิจโดยตรง"
 *   → ใช้บอทตัวเดียวกัน (ไม่ต้องสร้างบอทใหม่/ไม่ต้องหาชื่อ @ใหม่) แต่ส่งไปห้องคนละห้อง
 *   เก็บแยกจาก chatId ของระบบ เพื่อให้ล้าง/แก้ทีละชุดได้โดยไม่กระทบการแจ้งเตือนเดิม
 */
const TELEGRAM_BIZ_CHAT_ID_KEY = 'telegram.bizChatId';

// อ่าน env สดตอนเรียกใช้ (ไม่ capture ตอน module load) — การล้าง/แก้ env หลัง import ต้องมีผล (และ test จำลอง "ไม่มี token" ได้)
const envToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
const envChatId = () => process.env.TELEGRAM_CHAT_ID || '';
const envBizChatId = () => process.env.TELEGRAM_BIZ_CHAT_ID || '';

/**
 * chat_id ของ Telegram ต้องเป็นจำนวนเต็ม: ผู้ใช้/กลุ่ม = บวก, supergroup/ช่อง = ติดลบ
 * @returns ข้อความอธิบายถ้าไม่ถูกต้อง (ว่าง = ถูกต้อง)
 */
export function validateTelegramChatId(raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return 'ยังไม่ได้ใส่หมายเลขห้อง';
  if (!/^-?\d+$/.test(v)) return 'ต้องเป็นตัวเลขล้วน (คัดลอกจากแอปห้องได้เลย)';
  if (v.replace('-', '').length > 20) return 'หมายเลขห้องยาวผิดปกติ';
  return '';
}

// cache ระยะสั้น (5 วิ) — เซฟ DB ไม่ให้โดนอ่านทุก alert ที่ส่ง แต่ UI อัปเดตแล้วเห็นผลไว
let cache: { token?: string; chatId?: string; bizChatId?: string } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

async function loadFromDb(): Promise<{ token?: string; chatId?: string; bizChatId?: string }> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [TELEGRAM_TOKEN_KEY, TELEGRAM_CHAT_ID_KEY, TELEGRAM_BIZ_CHAT_ID_KEY] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    cache = {
      token: decryptField(map.get(TELEGRAM_TOKEN_KEY)),
      chatId: map.get(TELEGRAM_CHAT_ID_KEY) || '', // chatId ไม่ใช่ secret — เก็บตรง
      bizChatId: map.get(TELEGRAM_BIZ_CHAT_ID_KEY) || '',
    };
    cacheTime = now;
  } catch (err) {
    console.error('Telegram credentials DB read failed:', err instanceof Error ? err.message : err);
    cache = {};
    cacheTime = now;
  }
  return cache;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
  source: 'env' | 'db' | 'none';
}

/** credential ที่ใช้งานจริงตอนนี้ (db override ชนะ env) */
export async function getTelegramCredentials(): Promise<TelegramCredentials> {
  const db = await loadFromDb();
  const token = db.token && db.token.trim() ? db.token.trim() : envToken();
  const chatId = db.chatId && db.chatId.trim() ? db.chatId.trim() : envChatId();
  if (!token || !chatId) return { botToken: token, chatId, source: 'none' };
  const source: TelegramCredentials['source'] = db.token && db.token.trim() ? 'db' : 'env';
  return { botToken: token, chatId, source };
}

/** มี credentials ครบ (token + chatId) พร้อมส่งจริงไหม — cron/งานเบื้องหลังใช้ตัดสิน "ปิดเงียบแบบมี flag" */
export async function hasTelegramCredentials(): Promise<boolean> {
  const c = await getTelegramCredentials();
  return Boolean(c.botToken && c.chatId);
}

/** ตั้งค่า/แก้ Telegram credentials ผ่าน UI (upsert ลง DB) */
export async function setTelegramCredentials(
  botToken: string,
  chatId: string
): Promise<void> {
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: TELEGRAM_TOKEN_KEY },
      create: { key: TELEGRAM_TOKEN_KEY, value: encryptField(botToken) },
      update: { value: encryptField(botToken) },
    }),
    prisma.systemSetting.upsert({
      where: { key: TELEGRAM_CHAT_ID_KEY },
      create: { key: TELEGRAM_CHAT_ID_KEY, value: chatId },
      update: { value: chatId },
    }),
  ]);
  // ⚠ ห้ามเขียน cache แบบบางฟิลด์ — ดู invalidateCache (เคยพังตอนรันจริง 17/10/69)
  invalidateCache();
}

/** ลบ override คืนกลับไปใช้ value จาก .env */
export async function clearTelegramCredentials(): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { key: { in: [TELEGRAM_TOKEN_KEY, TELEGRAM_CHAT_ID_KEY] } },
  });
  invalidateCache();
}

/** ล้าง cache — เทสต์ใช้กันค่าค้างจากเคสก่อนหน้า */
export function __resetTelegramCredentialCache(): void {
  invalidateCache();
}

/** แสดง token แบบ mask เฉพาะ 4 ตัวท้าย (ไม่คืน token เต็มกลับไป UI) */
export function maskBotToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••';
  return token.slice(0, 4) + '…' + token.slice(-4);
}

// ── ห้องเฉพาะธุรกิจ (16/10/69) ────────────────────────────────────────────

/** ห้องที่ตั้งไว้สำหรับแจ้งเตือนธุรกิจ (ว่าง = ยังไม่ได้ตั้ง) */
export async function getBusinessChatId(): Promise<string> {
  const db = await loadFromDb();
  const v = db.bizChatId && db.bizChatId.trim() ? db.bizChatId.trim() : envBizChatId();
  return v;
}

/** พร้อมส่งแจ้งเตือนธุรกิจไหม — ต้องมีทั้งบอทและห้อง */
export async function hasBusinessNotify(): Promise<boolean> {
  const c = await getTelegramCredentials();
  return Boolean(c.botToken && (await getBusinessChatId()));
}

/**
 * ตั้งห้องเฉพาะธุรกิจ (ไม่แตะห้องของระบบ)
 * @throws ถ้าหมายเลขห้องผิดรูปแบบ — ผู้เรียกต้องตรวจ validateTelegramChatId ก่อน
 */
export async function setBusinessChatId(chatId: string): Promise<void> {
  const id = chatId.trim();
  const bad = validateTelegramChatId(id);
  if (bad) throw new Error(bad);
  await prisma.systemSetting.upsert({
    where: { key: TELEGRAM_BIZ_CHAT_ID_KEY },
    create: { key: TELEGRAM_BIZ_CHAT_ID_KEY, value: id },
    update: { value: id },
  });
  invalidateCache();
}

/** ล้างเฉพาะห้องธุรกิจ — ห้องของระบบยังใช้ได้ตามเดิม */
export async function clearBusinessChatId(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: TELEGRAM_BIZ_CHAT_ID_KEY } });
  invalidateCache();
}

/**
 * ทิ้ง cache ทั้งก้อนให้โหลดใหม่ทั้งหมด — **ห้ามอัปเดตบางฟิลด์**
 *
 * ⚠ เจอตอนรันจริง 17/10/69: เขียน `cache = { ...(cache ?? {}), bizChatId: id }`
 *   ตอนที่ cache ยังเป็น null (ยังไม่เคยอ่าน) จะได้ object ที่มีแค่ bizChatId
 *   → การอ่านครั้งถัดไปได้ token = ว่าง → ส่งไม่ออก ("no_bot_token")
 *   ทั้งที่ token อยู่ในฐานข้อมูลถูกต้อง เพราะตอนนั้นยังไม่ได้อ่านเข้า cache
 */
function invalidateCache(): void {
  cache = null;
  cacheTime = 0;
}

/** mask หมายเลขห้องตอนส่งกลับ UI — เหลือ 3 ตัวท้ายพอให้เจ้าของรู้ว่าตั้งถูกห้อง */
export function maskChatId(chatId: string): string {
  const v = (chatId ?? '').trim();
  if (!v) return '';
  if (v.length <= 6) return '••••';
  return '••••' + v.slice(-3);
}