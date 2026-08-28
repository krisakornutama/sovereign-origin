// src/services/skill-queue.service.ts
//
// Skill Queue — คิวทักษะ/งานที่ผู้ใช้เพิ่มเอง รันทีละรายการด้วย coding agent
// แต่ละรายการเลือกโมเดล + ระดับเหตุผล + ระดับอัตโนมัติ (ทำตามสั่ง → คิดเอง/ทำเอง)
import { prisma } from './coding-agent.service';
import { createCodingJob, executeCodingJob, processCodingQueue } from './coding-agent.service';

export interface SkillInput {
  title: string;
  content: string;
  autonomy?: string; // manual | semi | auto
  model?: string;
  reasoningEffort?: string;
}

export async function listSkills(): Promise<any[]> {
  return prisma.skillQueueItem.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
}

export async function addSkill(input: SkillInput): Promise<{ id: string }> {
  const title = String(input?.title || '').trim().slice(0, 120);
  const content = String(input?.content || '').trim().slice(0, 5000);
  if (!title || !content) throw new Error('title และ content จำเป็นต้องมี');
  const autonomy = ['manual', 'semi', 'auto'].includes(String(input.autonomy || '')) ? String(input.autonomy) : 'manual';
  const item = await prisma.skillQueueItem.create({
    data: {
      title,
      content,
      status: 'queued',
      autonomy,
      model: String(input.model || '').trim() || null,
      reasoning_effort: String(input.reasoningEffort || '').trim() || null,
    },
  });
  return { id: item.id };
}

export async function deleteSkill(id: string): Promise<void> {
  await prisma.skillQueueItem.delete({ where: { id } });
}

/** รันทักษะเดียว: สร้าง coding job → รันเลย → อัปเดตผลกลับมา */
export async function runSkill(id: string): Promise<void> {
  const skill = await prisma.skillQueueItem.findUnique({ where: { id } });
  if (!skill) throw new Error('ไม่พบทักษะนี้');
  if (skill.status === 'running') throw new Error('ทักษะนี้กำลังรันอยู่');
  await prisma.skillQueueItem.update({ where: { id }, data: { status: 'running', started_at: new Date() } });
  try {
    const { id: jobId } = await createCodingJob(skill.content, {
      model: skill.model || undefined,
      reasoningEffort: skill.reasoning_effort || undefined,
      autonomy: skill.autonomy,
    });
    await prisma.skillQueueItem.update({ where: { id }, data: { job_id: jobId } });
    const job = await prisma.codingJob.findUnique({ where: { id: jobId } });
    if (job) {
      const claimed = await prisma.codingJob.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running' },
      });
      if (claimed.count > 0) await executeCodingJob(job);
    }
    const updated = await prisma.codingJob.findUnique({ where: { id: jobId } });
    const done = updated && updated.status === 'done';
    await prisma.skillQueueItem.update({
      where: { id },
      data: {
        status: done ? 'done' : 'error',
        result: done ? String(updated.title) + ' — สร้างงานเสร็จ (ดูใน Coding Agent)' : null,
        error: !done ? String(updated?.error || 'งานล้มเหลว').slice(0, 500) : null,
        completed_at: new Date(),
      },
    });
  } catch (err: any) {
    await prisma.skillQueueItem.update({
      where: { id },
      data: { status: 'error', error: String(err?.message || err).slice(0, 500), completed_at: new Date() },
    });
  }
}

/** รันคิว: งานที่ยัง queued เรียงตามลำดับ (รับประกันทีละรายการ) */
export async function runSkillQueue(): Promise<{ ran: number }> {
  const queued = await prisma.skillQueueItem.findMany({
    where: { status: 'queued' },
    orderBy: { created_at: 'asc' },
  });
  let ran = 0;
  for (const skill of queued) {
    await runSkill(skill.id);
    ran += 1;
    // kick coding queue เพื่อให้งานที่เหลือ (ถ้ามี) รันต่อแบบเบื้องหลัง
    void processCodingQueue().catch(() => undefined);
  }
  return { ran };
}