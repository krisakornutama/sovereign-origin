// src/services/feedback.service.ts
//
// PUBLIC FEEDBACK (P: Publishing) — ปุ่มฟีดแบ็กจากหน้าสาธารณะ
// หลักการ:
//  - ทุกฟีดแบ็กลงตาราง feedback_notes ก่อนเสมอ (ส่ง Telegram พลาดก็ไม่หาย)
//  - honeypot: ช่อง website ที่ซ่อนไว้ — bot กรอก = ทิ้งเงียบ ๆ (ตอบ 202 ปกติ ไม่บอกว่าโดนกัน)
//  - คัดกรองโดยเจ้าของ (useful=true/false) ผ่านหน้า admin — เฉพาะ useful=true เท่านั้นที่เข้า digest
//  - digest = สรุปรายการที่ยังไม่ sent แล้ว mark sent_at (ส่งซ้ำไม่ได้)
//  - ไม่มี SMTP ในบ้านนี้ — ยื่นถึงเจ้าของผ่าน Telegram (dispatcher เดิม) — SMTP เป็นการ์ดอนาคต
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { sendTelegramAlert } from './telegram-alert.service';

const SALT = process.env.FEEDBACK_IP_SALT || process.env.JWT_SECRET || 'sovereign-feedback-salt';

/** sha256(ip+salt) 8 ตัวแรก — จำกัดถี่ต่อ IP โดยไม่เก็บ IP เปล่า */
export function ipHashOf(ip: string): string {
  return createHash('sha256').update(`${SALT}:${ip}`).digest('hex').slice(0, 8);
}

export interface FeedbackInput {
  page?: string;
  topic?: string;
  message: string;
  senderEmail?: string;
  website?: string; // honeypot — ต้องว่างเสมอ
  userAgent?: string;
  ip?: string;
}

export type FeedbackResult =
  | { accepted: true; id: string; telegramSent: boolean }
  | { accepted: false; reason: 'honeypot' | 'invalid' };

const TOPICS = ['general', 'bug', 'feature', 'question'];

/** รับฟีดแบ็กสาธารณะ — honeypot/ของเพี้ยน = ทิ้งเงียบ (ตอบยอมรับปลอม ไม่ให้ bot รู้) */
export async function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const message = String(input.message ?? '').trim().slice(0, 2000);
  if (message.length < 3) return { accepted: false, reason: 'invalid' };
  if (String(input.website ?? '').trim() !== '') return { accepted: false, reason: 'honeypot' }; // bot

  const topic = TOPICS.includes(String(input.topic)) ? String(input.topic) : 'general';
  const page = String(input.page ?? '/demo').slice(0, 60);
  const email = String(input.senderEmail ?? '').trim().slice(0, 120) || null;

  const note = await prisma.feedbackNote.create({
    data: {
      page,
      topic,
      message,
      sender_email: email,
      user_agent: String(input.userAgent ?? '').slice(0, 200) || null,
      ip_hash: input.ip ? ipHashOf(input.ip) : null,
    },
  });

  // แจ้ง "มีฟีดแบ็กใหม่รอตัดสิน" เข้า Telegram เจ้าของ (ย่อ — ของเต็มอยู่หน้า admin)
  let telegramSent = false;
  try {
    const r = await sendTelegramAlert({
      text: `💬 ฟีดแบ็กใหม่ (${topic}) จาก ${page}\n${message.slice(0, 300)}${message.length > 300 ? '…' : ''}\n— ตัดสิน "มีประโยชน์/สแปม" ที่หน้า Admin → Feedback`,
      severity: 'info',
      eventKey: `feedback:${note.id}`,
    });
    telegramSent = Boolean(r.sent);
  } catch {
    telegramSent = false; // ไม่ throw — ฟีดแบ็กยังเซฟครบใน DB
  }

  return { accepted: true, id: note.id, telegramSent };
}

/** รายการรอตัดสิน (หน้า admin) — ใหม่สุดก่อน */
export async function listFeedback(take = 100): Promise<any[]> {
  return prisma.feedbackNote.findMany({
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(1, take), 300),
  });
}

/** ตัดสิน "มีประโยชน์/สแปม" — null = กลับไปยังไม่ตัดสิน */
export async function judgeFeedback(id: string, useful: boolean | null): Promise<any> {
  return prisma.feedbackNote.update({
    where: { id },
    data: { useful: useful === null ? null : Boolean(useful) },
  });
}

/** digest — เฉพาะ useful=true ที่ยังไม่ sent → ส่ง Telegram แล้ว mark sent_at
 *  คืนจำนวนที่ส่ง (ใช้จาก cron/มือ) */
export async function sendFeedbackDigest(): Promise<{ sent: number }> {
  const pending = await prisma.feedbackNote.findMany({
    where: { useful: true, sent_at: null },
    orderBy: { created_at: 'asc' },
    take: 20,
  });
  if (pending.length === 0) return { sent: 0 };
  const lines = pending.map((n) => {
    const at = new Date(n.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `• [${n.topic}] ${n.message.slice(0, 200)}${n.message.length > 200 ? '…' : ''}${n.sender_email ? `\n   ✉ ${n.sender_email}` : ''}\n   (${at} · ${n.page})`;
  });
  try {
    await sendTelegramAlert({
      text: `📮 ฟีดแบ็กคัดกรองแล้ว ${pending.length} รายการ\n${lines.join('\n')}`,
      severity: 'info',
      eventKey: `feedback-digest:${new Date().toISOString().slice(0, 10)}`,
    });
  } catch {
    return { sent: 0 }; // Telegram ล่ม — ยังไม่ mark รอบหน้าส่งใหม่
  }
  const now = new Date();
  for (const n of pending) {
    await prisma.feedbackNote.update({ where: { id: n.id }, data: { sent_at: now } });
  }
  return { sent: pending.length };
}

/** จำกัดถี่ต่อ IP (เรียกก่อน create ใน route) — เกิน 5 ครั้ง/ชม. = ปฏิเสธเงียบ */
export async function feedbackThrottled(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000);
  const count = await prisma.feedbackNote.count({ where: { ip_hash: ipHash, created_at: { gte: since } } });
  return count >= 5;
}
