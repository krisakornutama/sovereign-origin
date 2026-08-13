import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

const router = Router();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

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
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not set');
    return false;
  }
  try {
    const body: any = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    };
    if (buttons && buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))],
      };
    }
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, body);
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
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not set');
    return false;
  }
  try {
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
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
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form);
    return true;
  } catch (err) {
    console.error('Telegram sendPhoto failed:', err);
    return false;
  }
}

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