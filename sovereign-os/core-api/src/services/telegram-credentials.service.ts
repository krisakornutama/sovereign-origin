import { prisma } from '../lib/prisma';

// ── Telegram credential resolver: DB (ตั้งผ่าน UI) → env (.env) ──
// ให้ผู้ใช้กรอก bot token / chat ID ในหน้า Settings โดยไม่ต้องแก้ .env บนเครื่อง
// กฎความสำคัญ: ค่าที่ตั้งใน DB (system_settings) ชนะ env — เหมือน override


const TELEGRAM_TOKEN_KEY = 'telegram.botToken';
const TELEGRAM_CHAT_ID_KEY = 'telegram.chatId';

// อ่าน env สดตอนเรียกใช้ (ไม่ capture ตอน module load) — การล้าง/แก้ env หลัง import ต้องมีผล (และ test จำลอง "ไม่มี token" ได้)
const envToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
const envChatId = () => process.env.TELEGRAM_CHAT_ID || '';

// cache ระยะสั้น (5 วิ) — เซฟ DB ไม่ให้โดนอ่านทุก alert ที่ส่ง แต่ UI อัปเดตแล้วเห็นผลไว
let cache: { token?: string; chatId?: string } | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

async function loadFromDb(): Promise<{ token?: string; chatId?: string }> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [TELEGRAM_TOKEN_KEY, TELEGRAM_CHAT_ID_KEY] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    cache = { token: map.get(TELEGRAM_TOKEN_KEY), chatId: map.get(TELEGRAM_CHAT_ID_KEY) };
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
      create: { key: TELEGRAM_TOKEN_KEY, value: botToken },
      update: { value: botToken },
    }),
    prisma.systemSetting.upsert({
      where: { key: TELEGRAM_CHAT_ID_KEY },
      create: { key: TELEGRAM_CHAT_ID_KEY, value: chatId },
      update: { value: chatId },
    }),
  ]);
  cache = { token: botToken, chatId };
  cacheTime = Date.now();
}

/** ลบ override คืนกลับไปใช้ value จาก .env */
export async function clearTelegramCredentials(): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { key: { in: [TELEGRAM_TOKEN_KEY, TELEGRAM_CHAT_ID_KEY] } },
  });
  cache = {};
  cacheTime = Date.now();
}

/** แสดง token แบบ mask เฉพาะ 4 ตัวท้าย (ไม่คืน token เต็มกลับไป UI) */
export function maskBotToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••';
  return token.slice(0, 4) + '…' + token.slice(-4);
}