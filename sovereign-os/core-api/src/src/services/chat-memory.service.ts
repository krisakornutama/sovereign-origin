import { prisma } from '../lib/prisma';

export { prisma };

// เก็บประวัติได้สูงสุดกี่ข้อความ (กันโตไม่มีที่สิ้นสุด)
export const MAX_HISTORY = 500;
// ใส่ context ให้ AI ได้ครั้งละกี่ข้อความล่าสุด (จำกัด token)
export const HISTORY_CONTEXT_LIMIT = 20;

export interface ChatHistoryRow {
  id: string;
  actor: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

/**
 * P1 — Conversational Memory
 * บันทึก/อ่าน/ล้างประวัติสนทนาของ AI ไว้ใน DB (ผู้ใช้เห็นได้ + ลบได้)
 */

/** อ่านประวัติล่าสุด (เรียงจากเก่าไปใหม่ เพื่อใส่ prompt ได้เลย) */
export async function listHistory(
  actor: string,
  limit = HISTORY_CONTEXT_LIMIT
): Promise<ChatHistoryRow[]> {
  if (!(limit > 0)) return [];
  const rows = await prisma.chatMessage.findMany({
    where: { actor },
    orderBy: { created_at: 'desc' },
    take: Math.min(limit, 200),
  });
  return rows.reverse() as ChatHistoryRow[];
}

/** บันทึกบทสนทนาหนึ่งคู่ (user + assistant) แล้ว prune เหลือ MAX_HISTORY */
export async function appendExchange(
  actor: string,
  userContent: string,
  assistantContent: string
): Promise<void> {
  if (!userContent?.trim() && !assistantContent?.trim()) return;
  try {
    if (userContent?.trim()) {
      await prisma.chatMessage.create({
        data: { actor, role: 'user', content: userContent.slice(0, 2000) },
      });
    }
    if (assistantContent?.trim()) {
      await prisma.chatMessage.create({
        data: { actor, role: 'assistant', content: assistantContent.slice(0, 8000) },
      });
    }
    // prune: ลบข้อความเก่าเกิน MAX_HISTORY (ให้เหลือคร่าวๆ ไม่เกิน MAX_HISTORY + 2)
    await prisma.chatMessage.deleteMany({
      where: {
        actor,
        id: {
          in: (
            await prisma.chatMessage.findMany({
              where: { actor },
              orderBy: { created_at: 'desc' },
              skip: MAX_HISTORY,
              select: { id: true },
            })
          ).map((r) => r.id),
        },
      },
    });
  } catch (err) {
    // บันทึกประวัติพลาดต้องไม่ทำให้ chat พัง
    console.error('Chat memory append error:', (err as Error).message);
  }
}

/** ล้างประวัติทั้งหมดของผู้ใช้ */
export async function clearHistory(actor: string): Promise<number> {
  const result = await prisma.chatMessage.deleteMany({ where: { actor } });
  return result.count;
}

/** ลบข้อความเดียว */
export async function deleteMessage(id: string, actor: string): Promise<boolean> {
  const result = await prisma.chatMessage.deleteMany({ where: { id, actor } });
  return result.count > 0;
}

/** แปลงประวัติเป็นข้อความสำหรับใส่ใน prompt (บริบทความจำ) */
export function formatHistoryForPrompt(rows: Pick<ChatHistoryRow, 'role' | 'content'>[]): string {
  if (rows.length === 0) return '';
  return (
    '\n# [ประวัติการสนทนาก่อนหน้า — ใช้ประกอบการตอบ ห้ามย้ำข้อมูลนี้]\n' +
    rows.map((r) => `${r.role === 'user' ? 'ผู้ใช้' : 'ผู้ช่วย'}: ${r.content}`).join('\n') +
    '\n'
  );
}