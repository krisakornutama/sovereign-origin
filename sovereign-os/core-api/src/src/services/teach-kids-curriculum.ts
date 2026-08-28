// src/services/teach-kids-curriculum.ts
// Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล) + เกียรติบัตรจบสาขา

import { prisma } from '../lib/prisma';
import { normalizeScore, addXp } from './teach-kids-profiles';
import { logKidAction, notifyParent } from './teach-kids-shared';

// ────────────────────────────────────────────────
// Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล)
// แต่ละสาขา (track) มีบทเรียนหลายระดับ — เรียนจบครบ = ได้เกียรติบัตรจบสาขาอัตโนมัติ
// ────────────────────────────────────────────────

export interface CurriculumOverview {
  tracks: Array<{
    id: string;
    code: string;
    title: string;
    description: string | null;
    emoji: string;
    color: string;
    sort_order: number;
    items: Array<{ id: string; title: string; description: string | null; stage: number; sequence: number }>;
  }>;
  kids: Array<{
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    per_track: Record<string, { done: string[]; total: number; completed: boolean }>;
    completed_tracks: string[];
  }>;
  certificates: Array<{ id: string; kid_id: string; title: string; detail: string | null; created_at: Date }>;
}

/** โหลดหลักสูตรทั้งหมด + ความคืบหน้าของทุกคนในคราวเดียว (หน้าโฮมสคูล) */
export async function curriculumOverview(): Promise<CurriculumOverview> {
  const tracks = await prisma.curriculumTrack.findMany({
    orderBy: { sort_order: 'asc' },
    include: { items: { orderBy: { sequence: 'asc' } } },
  });
  const profileRows = await prisma.kidProfile.findMany({
    select: { id: true, name: true, emoji: true, color: true },
    orderBy: { created_at: 'asc' },
  });
  const doneRows = await prisma.kidLessonProgress.findMany({
    where: { curriculum_item_id: { not: null } },
    select: { kid_id: true, curriculum_item_id: true },
  });
  const kidDone: Record<string, Set<string>> = {};
  for (const r of doneRows) {
    if (r.curriculum_item_id) {
      (kidDone[r.kid_id] ||= new Set()).add(r.curriculum_item_id);
    }
  }
  const kids = profileRows.map((k) => {
    const per_track: Record<string, { done: string[]; total: number; completed: boolean }> = {};
    for (const t of tracks) {
      const ids = t.items.map((i) => i.id);
      const done = ids.filter((id) => kidDone[k.id]?.has(id));
      per_track[t.id] = { done, total: ids.length, completed: ids.length > 0 && done.length === ids.length };
    }
    const completed_tracks = tracks.filter((t) => per_track[t.id].completed).map((t) => t.id);
    return { ...k, per_track, completed_tracks };
  });
  const certificates = await prisma.kidCertificate.findMany({
    where: { kind: 'subject' },
    orderBy: { created_at: 'desc' },
    take: 100,
  });
  return { tracks, kids, certificates };
}

/**
 * บันทึกเรียนจบ 1 บทเรียนในหลักสูตร — ได้ XP จากคะแนน
 * เรียนจบครบทุกบทของสาขา → สร้างเกียรติบัตรจบสาขาอัตโนมัติ (ครั้งเดียว)
 */
export async function recordCurriculumProgress(
  kidId: string,
  itemId: string,
  input: { score: number; total: number }
): Promise<{ id: string; certificate: { id: string; title: string } | null; completedTrack: string | null }> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  const item = await prisma.curriculumItem.findUnique({
    where: { id: itemId },
    include: { track: true },
  });
  if (!item) throw new Error('curriculum item not found');

  const { score, total } = normalizeScore(input.score, input.total);
  const rec = await prisma.kidLessonProgress.create({
    data: {
      kid_id: kidId,
      lesson_title: item.title,
      lesson_item_id: null,
      curriculum_item_id: item.id,
      score,
      total,
    },
  });
  if (score > 0) await addXp(kidId, score * 10, 'การเรียนหลักสูตร');
  await logKidAction(kidId, 'lesson_progress', `เรียนจบหลักสูตร: ${item.title} (${score}/${total})`, 'parent');

  // เช็คว่าจบทั้งสาขาหรือยัง
  const doneRows = await prisma.kidLessonProgress.findMany({
    where: { kid_id: kidId, curriculum_item_id: { not: null } },
    select: { curriculum_item_id: true },
  });
  const doneIds = doneRows.map((r) => r.curriculum_item_id);
  const trackItems = await prisma.curriculumItem.findMany({
    where: { track_id: item.track_id },
    select: { id: true },
  });
  const allDone = trackItems.length > 0 && trackItems.every((ti) => doneIds.includes(ti.id));
  if (allDone) {
    const certTitle = `เกียรติบัตรจบสาขา ${item.track.title}`;
    const existing = await prisma.kidCertificate.findFirst({
      where: { kid_id: kidId, kind: 'subject', title: certTitle },
    });
    if (!existing) {
      const cert = await prisma.kidCertificate.create({
        data: {
          kid_id: kidId,
          level: 0,
          kind: 'subject',
          title: certTitle,
          detail: `เรียนครบทุกบทเรียนของสาขา ${item.track.title} (${trackItems.length} บท)`,
        },
      });
      await logKidAction(kidId, 'track_complete', `🎓 จบสาขา ${item.track.title}`, 'parent');
      await notifyParent(`🎓 ${kid.name} จบสาขา ${item.track.title} แล้ว! (ครบ ${trackItems.length} บทเรียน)`);
      return { id: rec.id, certificate: { id: cert.id, title: cert.title }, completedTrack: item.track.title };
    }
  }
  return { id: rec.id, certificate: null, completedTrack: null };
}

/** เกียรติบัตรจบสาขาทั้งหมดของเด็ก (ถ้าไม่ระบุ = ทั้งหมด) */
export async function subjectCertificates(kidId?: string) {
  const certs = await prisma.kidCertificate.findMany({
    where: { kind: 'subject', ...(kidId ? { kid_id: kidId } : {}) },
    orderBy: { created_at: 'desc' },
  });
  return certs;
}
