import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getTelegramCredentials,
  setTelegramCredentials,
  clearTelegramCredentials,
  maskBotToken,
} from '../../services/telegram-credentials.service';

const router = Router();

// ไฟล์ที่ให้ส่งผ่าน Telegram ได้ — จำกัดอยู่ในโฟลเดอร์ที่ระบบสร้างเองเท่านั้น
// (กัน path traversal: เดิมอ่านไฟล์ใดก็ได้บนเครื่องแล้ว exfil ผ่าน Telegram)
const ALLOWED_PHOTO_DIRS = [
  os.tmpdir(),
  path.resolve(process.cwd()),
].map((dir) => path.resolve(dir));

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

/** ตรวจว่า path ที่ขออยู่ในโฟลเดอร์ที่อนุญาต (ยังไม่สนใจว่าไฟล์มีจริงหรือไม่) */
function isPathInsideAllowedDirs(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ALLOWED_PHOTO_DIRS.some((dir) => {
    try {
      return resolved === dir || resolved.startsWith(dir + path.sep);
    } catch {
      return false;
    }
  });
}

/**
 * ส่งข้อความ Telegram (HTML) พร้อมปุ่ม inline keyboard ได้
 * - buttons: [{ text, data }] — data ถูกส่งกลับมาเป็น callback_query.data
 *   (ใช้ใน flow อนุมัติ/ปฏิเสธคำขอของ AI agent)
 */
async function sendTelegramMessage(
  message: string,
  buttons?: { text: string; data: string }[]
): Promise<boolean> {
  const creds = await getTelegramCredentials();
  if (!creds.botToken || !creds.chatId) {
    console.warn('Telegram credentials not set');
    return false;
  }
  try {
    const body: any = {
      chat_id: creds.chatId,
      text: message,
      parse_mode: 'HTML',
    };
    if (buttons && buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))],
      };
    }
    await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, body);
    return true;
  } catch (err) {
    console.error('Telegram send failed:', err);
    return false;
  }
}

async function sendTelegram(message: string): Promise<boolean> {
  return sendTelegramMessage(message);
}

/**
 * ส่งรูปภาพผ่าน Telegram sendPhoto
 * - photo: URL (https://...) / file_id หรือ Buffer (multipart upload)
 * - caption: ข้อความประกอบ (รองรับ HTML)
 */
async function sendTelegramPhoto(photo: string | Buffer, caption = ''): Promise<boolean> {
  const creds = await getTelegramCredentials();
  if (!creds.botToken || !creds.chatId) {
    console.warn('Telegram credentials not set');
    return false;
  }
  try {
    const form = new FormData();
    form.append('chat_id', creds.chatId);
    if (caption) form.append('caption', caption);
    if (typeof photo === 'string') {
      // URL หรือ file_id
      form.append('photo', photo);
    } else {
      // อัปโหลดไฟล์ (multipart) — ตรวจ type จาก magic bytes (PNG/JPEG)
      const isPng =
        photo.length >= 8 &&
        photo[0] === 0x89 && photo[1] === 0x50 && photo[2] === 0x4e && photo[3] === 0x47;
      const filename = isPng ? 'snapshot.png' : 'snapshot.jpg';
      const contentType = isPng ? 'image/png' : 'image/jpeg';
      form.append('photo', new Blob([photo], { type: contentType }), filename);
    }
    await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendPhoto`, form);
    return true;
  } catch (err) {
    console.error('Telegram sendPhoto failed:', err);
    return false;
  }
}

// ── Telegram credential management (ตั้ง/แก้ผ่าน UI โดยไม่ต้องแตะ .env) ──

const BOT_TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{20,}$/;

// GET /api/telegram/config — สถานะการตั้งค่า (ไม่คืน token เต็ม — mask ไว้)
router.get('/config', authenticate, async (_req, res) => {
  const creds = await getTelegramCredentials();
  res.json({
    configured: Boolean(creds.botToken && creds.chatId),
    source: creds.source,
    botTokenMasked: maskBotToken(creds.botToken),
    chatId: creds.chatId,
  });
});

// PUT /api/telegram/config { botToken?, chatId? } — บันทึก override ลง DB (SUPERADMIN)
// ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน; ฟิลด์ที่ไม่ได้ส่งคงค่าเดิมไว้
router.put('/config', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { botToken, chatId } = req.body || {};
  const nextToken = typeof botToken === 'string' ? botToken.trim() : undefined;
  const nextChatId = typeof chatId === 'string' ? chatId.trim() : undefined;

  if (nextToken !== undefined) {
    if (!BOT_TOKEN_RE.test(nextToken)) {
      return res.status(400).json({ error: 'Bot token format invalid' });
    }
  }
  if (nextChatId !== undefined && (nextChatId.length < 2 || nextChatId.length > 64)) {
    return res.status(400).json({ error: 'Chat ID length invalid' });
  }

  // merge กับค่าเดิม: ฟิลด์ที่ไม่ส่ง = คงเดิม
  const current = await getTelegramCredentials();
  const mergedToken = nextToken !== undefined ? nextToken : current.botToken;
  const mergedChatId = nextChatId !== undefined ? nextChatId : current.chatId;
  if (!mergedToken || !mergedChatId) {
    return res.status(400).json({ error: 'Both bot token and chat ID are required' });
  }

  await setTelegramCredentials(mergedToken, mergedChatId);
  res.json({
    configured: true,
    source: 'db',
    botTokenMasked: maskBotToken(mergedToken),
    chatId: mergedChatId,
  });
});

// DELETE /api/telegram/config — ลบ override กลับไปใช้ .env (SUPERADMIN)
router.delete('/config', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  await clearTelegramCredentials();
  const creds = await getTelegramCredentials();
  res.json({
    configured: Boolean(creds.botToken && creds.chatId),
    source: creds.source,
    botTokenMasked: maskBotToken(creds.botToken),
    chatId: creds.chatId,
  });
});

// GET /api/telegram/updates — ดึง chat ID อัตโนมัติจาก getUpdates (SUPERADMIN) — ช่วยกรอก Chat ID ไม่ต้องพิมพ์เอง
router.get('/updates', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const creds = await getTelegramCredentials();
  if (!creds.botToken) return res.status(400).json({ error: 'ตั้ง Bot Token ก่อน' });
  try {
    const r = await axios.get(`https://api.telegram.org/bot${creds.botToken}/getUpdates`, { timeout: 8000 });
    const chats = ((r.data?.result as any[]) || []).map((u: any) => ({
      chatId: String(u.message?.chat?.id || u.channel_post?.chat?.id || ''),
      title: u.message?.chat?.title || u.message?.chat?.username || u.message?.chat?.first_name || '',
      type: u.message?.chat?.type || u.channel_post?.chat?.type || 'unknown',
      text: (u.message?.text || u.channel_post?.text || '').slice(0, 60),
    })).filter((c: any) => c.chatId);
    // dedup
    const seen = new Set<string>();
    const uniq = chats.filter((c: any) => !seen.has(c.chatId) && seen.add(c.chatId));
    res.json({ chats: uniq.slice(0, 10) });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'getUpdates failed' });
  }
});

// POST /api/telegram/test — ส่งข้อความทดสอบด้วย credential ปัจจุบัน (SUPERADMIN)
router.post('/test', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const creds = await getTelegramCredentials();
  if (!creds.botToken || !creds.chatId) {
    return res.status(400).json({ success: false, error: 'Telegram not configured' });
  }
  const ok = await sendTelegram('✅ Sovereign Alert — test message');
  res.json({ success: ok });
});

// Manual send (for testing)
router.post('/notify', authenticate, async (req, res) => {
  const { message } = req.body;
  const ok = await sendTelegram(message);
  res.json({ success: ok });
});

// POST /api/telegram/photo – ส่งรูปภาพ
// body: { photo: "https://... หรือ file_id" } หรือ { file: "/path/to/local.png", caption? }
router.post('/photo', authenticate, async (req, res) => {
  try {
    const { photo, file, caption } = req.body || {};

    let target: string | Buffer;
    let source = '';

    if (typeof photo === 'string' && photo.trim()) {
      target = photo.trim();
      source = 'url';
    } else if (typeof file === 'string' && file.trim()) {
      // จำกัดเฉพาะไฟล์ภาพในโฟลเดอร์ที่อนุญาต (tmp / cwd) — กันอ่านไฟล์ลับทั้งเครื่อง
      if (!isPathInsideAllowedDirs(file)) {
        return res.status(403).json({ error: 'File must be inside an allowed directory' });
      }
      // realpath กัน symlink หนีออกนอกโฟลเดอร์ที่อนุญาต
      let real: string;
      try {
        real = fs.realpathSync(path.resolve(file));
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }
      if (!isPathInsideAllowedDirs(real)) {
        return res.status(403).json({ error: 'File must be inside an allowed directory' });
      }
      if (!IMAGE_EXTENSIONS.includes(path.extname(real).toLowerCase())) {
        return res.status(400).json({ error: 'Unsupported image extension' });
      }
      target = fs.readFileSync(real);
      source = real;
    } else {
      return res.status(400).json({ error: 'Provide either photo (URL/file_id) or file (local path)' });
    }

    const ok = await sendTelegramPhoto(target, caption ? String(caption) : '');
    res.json({ success: ok, source });
  } catch (err) {
    console.error('Telegram photo route error:', err);
    res.status(500).json({ error: 'Failed to send photo' });
  }
});

export { sendTelegram, sendTelegramMessage, sendTelegramPhoto }; // export เพื่อให้บริการอื่นเรียกใช้
export default router;