// src/services/teach-kids-profiles.ts
// โปรไฟล์เด็ก + บันทึกความคืบหน้าบทเรียน + ระดับ/ดาว (XP) + เกียรติบัตร

import { prisma } from '../lib/prisma';
import { logKidAction } from './teach-kids-shared';

// ────────────────────────────────────────────────
// โปรไฟล์เด็ก + บันทึกความคืบหน้าบทเรียน (AI สอนลูก)
// ────────────────────────────────────────────────

export interface KidInput {
  name: string;
  age?: number | null;
  emoji?: string | null;
  color?: string | null;
}

export interface KidProfile {
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

/** สร้างโปรไฟล์เด็ก — ต้องมีชื่อ */
export async function createKid(input: KidInput): Promise<{ id: string }> {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('name is required');
  const item = await prisma.kidProfile.create({
    data: {
      name: name.slice(0, 100),
      age: input?.age != null && Number.isFinite(Number(input.age)) ? Math.min(Math.max(Math.floor(Number(input.age)), 0), 18) : null,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      color: input?.color ? String(input.color).trim().slice(0, 20) : null,
    },
  });
  return { id: item.id };
}

/** แก้ไขโปรไฟล์เด็ก — ตั้งค่าเฉพาะ field ที่ส่งมา */
export async function updateKid(id: string, input: Partial<KidInput>): Promise<{ id: string }> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('name is required');
    data.name = name.slice(0, 100);
  }
  if (input.age !== undefined) {
    data.age = input.age != null && Number.isFinite(Number(input.age)) ? Math.min(Math.max(Math.floor(Number(input.age)), 0), 18) : null;
  }
  if (input.emoji !== undefined) data.emoji = input.emoji ? String(input.emoji).trim().slice(0, 8) : null;
  if (input.color !== undefined) data.color = input.color ? String(input.color).trim().slice(0, 20) : null;
  const item = await prisma.kidProfile.update({ where: { id }, data });
  return { id: item.id };
}

/** รายการโปรไฟล์เด็กทั้งหมด (ใหม่สุดก่อน) */
export async function listKids(): Promise<KidProfile[]> {
  return prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
}

export async function deleteKid(id: string): Promise<void> {
  await prisma.kidProfile.delete({ where: { id } });
}

/** จำกัดคะแนนให้อยู่ในช่วง 0..total — กันข้อมูลเสีย */
export function normalizeScore(score: unknown, total: unknown): { score: number; total: number } {
  const t = Math.floor(Number(total));
  if (!Number.isFinite(t) || t <= 0) throw new Error('total ต้องเป็นจำนวนเต็มบวก');
  let s = Math.floor(Number(score));
  if (!Number.isFinite(s)) s = 0;
  return { score: Math.min(Math.max(s, 0), t), total: t };
}

// ────────────────────────────────────────────────
// ระดับ/ดาว (XP) + เกียรติบัตรอัตโนมัติ
// ────────────────────────────────────────────────

/** ระดับจาก XP — เส้นโค้งสามเหลี่ยม: ระดับ 2 ที่ 100 XP, 3 ที่ 300, 4 ที่ 600, 5 ที่ 1000... */
export function kidLevel(xp: number): number {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  return Math.floor((Math.sqrt(1 + (8 * x) / 100) - 1) / 2) + 1;
}

/** XP ที่ต้องสะสมรวมเพื่อถึงระดับ l */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  return (100 * (l - 1) * l) / 2;
}

/**
 * เพิ่ม XP ให้เด็ก — ถ้าระดับขยับขึ้น (ข้ามหลายระดับได้) จะสร้างเกียรติบัตร + audit log
 * best-effort: ความล้มเหลวไม่ทำให้รายการหลักล้มเหลว
 */
export async function addXp(kidId: string, xp: number, source: string): Promise<void> {
  try {
    const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
    if (!kid) return;
    const before = kidLevel(kid.xp ?? 0);
    const next = kidLevel((kid.xp ?? 0) + xp);
    if (next > before) {
      await prisma.kidProfile.update({ where: { id: kidId }, data: { xp: { increment: xp } } });
      for (let lv = before + 1; lv <= next; lv++) {
        await prisma.kidCertificate.create({
          data: {
            kid_id: kidId,
            level: lv,
            title: `เกียรติบัตรระดับ ${lv} — นักเรียนเก่งแห่งบ้าน`,
            detail: `สะสมคะแนนครบ ${xpForLevel(lv)} XP จากการ${source}`, // เช่น "จากการเรียน / จากการทำงานบ้าน"
          },
        });
        await logKidAction(kidId, 'level_up', `⭐ เลื่อนเป็นระดับ ${lv} (${source})`, 'parent');
      }
    } else {
      await prisma.kidProfile.update({ where: { id: kidId }, data: { xp: { increment: xp } } });
    }
  } catch (err) {
    console.error('addXp error:', err instanceof Error ? err.message : err);
  }
}

/** เกียรติบัตรทั้งหมดของเด็ก (ใหม่สุดก่อน) */
export async function listCertificates(kidId: string): Promise<any[]> {
  return prisma.kidCertificate.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
  });
}

/** บันทึกผลแบบทดสอบของเด็ก (ต้องมีโปรไฟล์) — ได้ XP = คะแนน * 10 */
export async function recordLessonProgress(
  kidId: string,
  input: { lessonTitle: string; score: number; total: number; lessonItemId?: string | null }
): Promise<{ id: string }> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  const { score, total } = normalizeScore(input.score, input.total);
  const title = String(input.lessonTitle ?? '').trim().slice(0, 300);
  if (!title) throw new Error('lessonTitle is required');
  const item = await prisma.kidLessonProgress.create({
    data: {
      kid_id: kidId,
      lesson_title: title,
      lesson_item_id: input.lessonItemId || null,
      score,
      total,
    },
  });
  if (score > 0) await addXp(kidId, score * 10, 'การเรียน');
  return { id: item.id };
}

/** สรุปความคืบหน้าของเด็ก: จำนวนบทเรียน, เฉลี่ย, คะแนนดีที่สุด */
export interface KidStats {
  attempts: number;
  totalCorrect: number;
  totalQuestions: number;
  best: number | null; // % ของครั้งที่ดีที่สุด
  avg: number | null;  // % เฉลี่ย
}

export async function kidStats(kidId: string): Promise<KidStats> {
  const rows = await prisma.kidLessonProgress.findMany({
    where: { kid_id: kidId },
    select: { lesson_title: true, score: true, total: true },
  });
  const attempts = rows.length;
  const totalCorrect = rows.reduce((a, r) => a + r.score, 0);
  const totalQuestions = rows.reduce((a, r) => a + r.total, 0);
  if (attempts === 0 || totalQuestions === 0) {
    return { attempts, totalCorrect, totalQuestions, best: null, avg: null };
  }
  const pcts = rows.map((r) => (r.score / r.total) * 100);
  return {
    attempts,
    totalCorrect,
    totalQuestions,
    best: Math.round(Math.max(...pcts)),
    avg: Math.round((totalCorrect / totalQuestions) * 100),
  };
}
