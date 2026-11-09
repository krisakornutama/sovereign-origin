// src/services/ai-chat.service.ts
//
// ── ข้อมูลบทสนทนาของ AI (เจ้าของตาราง chat_messages) ───────────────────────
// ทำไมต้องมี: โมดูล consent ต้อง anonymize ประวัติแชทตอนผู้ใช้ลบบัญชี (PDPA)
// แต่ chat_messages เป็นของโมดูล ai → ต้องผ่าน service ของเจ้าของตาราง
// ไม่ใช่ให้ consent ยิง prisma.chatMessage เอง (arch-gate module-boundary)
import { prisma } from '../lib/prisma';

/**
 * ย้ายบทสนทนาทั้งหมดของผู้ใช้หนึ่งคนไปยังชื่อนิรนาม
 *
 * chat_messages ผูกด้วย username (actor) ไม่ใช่ user id — ตอนลบบัญชี
 * ผู้ใช้ถูกเปลี่ยนชื่อเป็น `deleted-…` จึงต้องย้าย actor ตามไปด้วย
 * เพื่อไม่ให้เหลือข้อมูลระบุตัวตนในประวัติแชท
 */
export async function anonymizeChatActor(actor: string, anonymizedName: string): Promise<number> {
  const result = await prisma.chatMessage.updateMany({
    where: { actor },
    data: { actor: anonymizedName },
  });
  return result.count;
}
