// src/services/notes.service.ts
//
// Note — ปุ่มโน้ตส่วนตัวในหน้า Coding Agent
import { prisma } from './coding-agent.service';

export async function listNotes(): Promise<any[]> {
  return prisma.note.findMany({ orderBy: { created_at: 'desc' }, take: 200 });
}

export async function addNote(content: string): Promise<{ id: string }> {
  const text = String(content || '').trim().slice(0, 5000);
  if (!text) throw new Error('content is required');
  const note = await prisma.note.create({ data: { content: text } });
  return { id: note.id };
}

export async function deleteNote(id: string): Promise<void> {
  await prisma.note.delete({ where: { id } });
}