// src/services/teach-kids.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// AI สอนลูก — สร้างบทเรียน + แบบทดสอบจากคลังความรู้ (RAG + Ollama)
// 1) ค้นหาข้อมูลที่เกี่ยวข้องในคลังความรู้ (semantic / keyword fallback)
// 2) ส่งให้ Ollama สร้างบทเรียนแบบ JSON ตามระดับอายุ
// 3) normalize ให้ใช้ได้จริง (ตัดคำถามเสีย, clamp answer, จำกัดขนาด)
// 4) บันทึกเป็น NOTE ในคลังความรู้ได้ (เปิดเรียนแบบอินเทอร์แอคทีฟจาก notes JSON)
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { search, type SearchResult } from './semantic-search.service';
import { sendTelegram } from '../modules/telegram/telegram.routes';

// ── แจ้งเตือนผู้ใหญ่ทาง Telegram (fire-and-forget — ไม่ทำให้รายการหลักล้มเหลว) ──
type NotifyFn = (message: string) => Promise<void>;
let notifySender: NotifyFn = async (message: string) => {
  try {
    await sendTelegram(message);
  } catch (err) {
    console.error('notify parent error:', err instanceof Error ? err.message : err);
  }
};

/** เปลี่ยนตัวส่งการแจ้งเตือน (ใช้ในเทสต์) */
export function setNotifySender(fn: NotifyFn): void {
  notifySender = fn;
}

async function notifyParent(message: string): Promise<void> {
  try {
    await notifySender(message);
  } catch (err) {
    console.error('notify parent error:', err instanceof Error ? err.message : err);
  }
}

export const prisma = new PrismaClient();

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const TEACH_MODEL = process.env.AI_MODEL || 'gemma3:4b';

// ระดับอายุ — ผู้ใหญ่เลือกตอนสร้างบทเรียน
export const AGE_RANGES = [
  { id: '3-5', label: '3-5 ปี (อนุบาล)' },
  { id: '6-8', label: '6-8 ปี (ประถมต้น)' },
  { id: '9-12', label: '9-12 ปี (ประถมปลาย)' },
  { id: '13-15', label: '13-15 ปี (มัธยมต้น)' },
  { id: '16+', label: '16 ปีขึ้นไป (มัธยมปลาย)' },
] as const;

export type AgeRangeId = (typeof AGE_RANGES)[number]['id'];

// คำแนะนำระดับวัย — สอดเข้า prompt เพื่อให้ภาษายากง่ายตรงกับเด็กแต่ละช่วงอายุ
const AGE_GUIDANCE: Record<string, string> = {
  '3-5': 'วัยอนุบาล (3-5 ปี): ประโยคสั้นมาก ไม่เกิน 2-3 วลีต่อประโยค, คำศัพท์ง่ายที่สุด, อธิบายผ่านตัวอย่างใกล้ตัว, แบบทดสอบ 2-3 ข้อ แต่ละข้อมีตัวเลือก 2-3 ตัว',
  '6-8': 'วัยประถมต้น (6-8 ปี): ภาษาง่าย อ่านออกเสียงเองได้, ประโยคสั้น, ตัวอย่างจากชีวิตประจำวัน, แบบทดสอบ 3 ข้อ แต่ละข้อมีตัวเลือก 3-4 ตัว',
  '9-12': 'วัยประถมปลาย (9-12 ปี): ภาษาเป็นทางการขึ้นเล็กน้อยแต่ยังอ่านง่าย, อธิบายหลักการและเหตุผล, แบบทดสอบ 4 ข้อ แต่ละข้อมี 4 ตัวเลือก',
  '13-15': 'วัยมัธยมต้น (13-15 ปี): ใช้คำศัพท์และแนวคิดได้เต็มที่, เชื่อมโยงกับสถานการณ์จริง, แบบทดสอบ 4-5 ข้อ แต่ละข้อมี 4 ตัวเลือก',
  '16+': 'วัยมัธยมปลาย (16 ปีขึ้นไป): อธิบายเชิงลึก วิเคราะห์ สรุปเป็นหลักการ, แบบทดสอบ 5 ข้อ แต่ละข้อมี 4 ตัวเลือก เน้นคิดวิเคราะห์',
};

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number; // index ใน options (0-based)
  explanation: string;
}

export interface LessonSection {
  heading: string;
  content: string;
}

export interface Lesson {
  title: string;
  age_range: string;
  summary: string;
  sections: LessonSection[];
  key_points: string[];
  quiz: QuizQuestion[];
  sources: string[]; // provenance — ไฟล์/รายการในคลังความรู้ที่ใช้
}

/** extract JSON object จากคำตอบของโมเดล (กัน ``` fence / prose รอบ ๆ) */
export function extractLessonJson(text: string): Record<string, unknown> | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function asStr(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

/** normalize คำตอบโมเดล → Lesson ที่ใช้ได้จริง (ตัดของเสีย, clamp, จำกัดขนาด) */
export function normalizeLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const title = asStr(o.title, 200) || 'บทเรียนจากคลังความรู้';

  const sections: LessonSection[] = [];
  if (Array.isArray(o.sections)) {
    for (const s of o.sections) {
      if (typeof s === 'string') {
        const content = s.trim();
        if (content) sections.push({ heading: '', content: content.slice(0, 4000) });
      } else if (s && typeof s === 'object') {
        const ss = s as Record<string, unknown>;
        const content = asStr(ss.content ?? ss.body ?? ss.text, 4000);
        if (content) sections.push({ heading: asStr(ss.heading ?? ss.title, 200), content });
      }
      if (sections.length >= 12) break;
    }
  }

  const keyPoints: string[] = [];
  if (Array.isArray(o.key_points)) {
    for (const k of o.key_points) {
      const kp = asStr(k, 300);
      if (kp) keyPoints.push(kp);
      if (keyPoints.length >= 20) break;
    }
  }

  const quiz: QuizQuestion[] = [];
  if (Array.isArray(o.quiz)) {
    for (const q of o.quiz) {
      if (!q || typeof q !== 'object') continue;
      const qq = q as Record<string, unknown>;
      const question = asStr(qq.question, 500);
      const options = Array.isArray(qq.options)
        ? qq.options.map((x) => asStr(x, 300)).filter(Boolean)
        : [];
      if (!question || options.length < 2) continue;
      let answer = Math.floor(Number(qq.answer));
      if (!Number.isFinite(answer) || answer < 0) answer = 0;
      if (answer >= options.length) answer = options.length - 1; // clamp เกินช่วง
      quiz.push({ question, options, answer, explanation: asStr(qq.explanation, 1000) });
      if (quiz.length >= 10) break;
    }
  }

  const sources = Array.isArray(o.sources)
    ? o.sources.map((s) => asStr(s, 300)).filter(Boolean).slice(0, 12)
    : [];

  return {
    title,
    age_range: asStr(o.age_range, 50),
    summary: asStr(o.summary, 1000),
    sections,
    key_points: keyPoints,
    quiz,
    sources,
  };
}

/** สร้าง prompt สอนลูก — ฝังข้อความจากคลังความรู้ (RAG) เพื่อไม่ให้โมเดลมโน */
export function buildTeachPrompt(topic: string, ageRange: string, excerpts: string[], opts: { quizCount?: number } = {}): string {
  const guidance = AGE_GUIDANCE[ageRange] || AGE_GUIDANCE['6-8'];
  const quizRule = opts.quizCount != null && opts.quizCount >= 1 && opts.quizCount <= 10
    ? `สร้างแบบทดสอบ ${Math.floor(opts.quizCount)} ข้อพอดี (ตัวเลือก 4 ตัว ยกเว้นวัย 3-5 ปี ให้ 2-3 ตัว)`
    : 'สร้างแบบทดสอบตามจำนวนที่กำหนดในหลักการด้านบน';
  const knowledgeBlock = excerpts.length
    ? excerpts.map((e, i) => `[ข้อมูล ${i + 1}]\n${e}`).join('\n\n')
    : '⚠️ ไม่มีข้อมูลที่เกี่ยวข้องในคลังความรู้ — สร้างบทเรียนจากความรู้ทั่วไป และใน summary ระบุชัดเจนว่าข้อมูลนี้มาจากความรู้ทั่วไปของครู ไม่ใช่จากคลังความรู้';

  return [
    `คุณคือครูผู้สอนสำหรับเด็กที่เข้าใจง่ายและแม่นยำ (Sovereign OS AI — offline)`,
    ``,
    `หัวข้อบทเรียน: "${topic}"`,
    `ระดับอายุ: ${ageRange}`,
    ``,
    `หลักการสร้างบทเรียน (${guidance})`,
    `1. ใช้ข้อมูลจากคลังความรู้ด้านล่างเป็นหลัก ห้ามแต่งข้อเท็จจริงเพิ่ม ถ้าข้อมูลไม่พอ ให้สอนเท่าที่มีและบอกใน summary ว่าครอบคลุมแค่ไหน`,
    `2. ภาษาต้องเหมาะกับวัย ใช้คำง่าย อ่านแล้วเข้าใจทันที`,
    `3. แบ่งเป็นหัวข้อย่อย (sections) ที่เรียงตามลำดับการเรียนรู้`,
    `4. สร้าง key_points 3-5 ข้อ ที่เด็กควรจำได้หลังเรียนจบ`,
    `5. ${quizRule} ตัวเลือกต้องมีคำตอบถูกแค่ข้อเดียว และข้อสอบต้องมาจากเนื้อหาในบทเรียน`,
    ``,
    `[ข้อมูลจากคลังความรู้]`,
    knowledgeBlock,
    ``,
    `[รูปแบบคำตอบ — JSON เท่านั้น ไม่มีข้อความอื่นนอกจาก JSON]`,
    `{`,
    `  "title": "ชื่อบทเรียน",`,
    `  "summary": "สรุป 1-2 ประโยคว่าบทเรียนนี้สอนอะไร",`,
    `  "sections": [{"heading": "หัวข้อย่อย", "content": "เนื้อหาในหัวข้อนั้น"}],`,
    `  "key_points": ["จุดสำคัญที่ต้องจำ"],`,
    `  "quiz": [{"question": "คำถาม", "options": ["ตัวเลือก ก", "ตัวเลือก ข", "ตัวเลือก ค", "ตัวเลือก ง"], "answer": 0, "explanation": "อธิบายว่าทำไมถึงถูก"}],`,
    `  "sources": []`,
    `}`,
    ``,
    `กฎ quiz: answer คือ index (0-based) ของตัวเลือกที่ถูก, มี options ตามที่กำหนดในระดับอายุ, explanation อธิบายสั้น ๆ ให้เด็กเข้าใจ`,
    `ตอบเป็นภาษาไทยเท่านั้น`,
  ].join('\n');
}

export interface TeachDeps {
  post?: (url: string, body: unknown, opts?: any) => Promise<{ data?: { response?: unknown } }>;
  search?: (query: string, topK?: number) => Promise<SearchResult[]>;
}

export interface GenerateOptions {
  quizCount?: number; // 1-10 — จำนวนข้อแบบทดสอบที่ผู้ใหญ่เลือก
  model?: string;     // ชื่อโมเดล Ollama เช่น qwen3:8b (default = AI_MODEL)
}

/**
 * สร้างบทเรียน + แบบทดสอบจากคลังความรู้:
 * RAG (search) → รวมข้อความที่ตรงสุด → Ollama สร้าง JSON → normalize
 * opts.model = เลือกโมเดลได้, opts.quizCount = กำหนดจำนวนข้อแบบทดสอบ
 */
export async function generateLesson(
  topic: string,
  ageRange: string,
  deps: TeachDeps = {},
  opts: GenerateOptions = {}
): Promise<{ lesson: Lesson; usedKnowledge: boolean }> {
  const searchFn = deps.search ?? search;
  let results: SearchResult[] = [];
  try {
    results = await searchFn(topic, 8);
  } catch (err) {
    console.error('Teach RAG search failed:', err instanceof Error ? err.message : err);
    results = [];
  }

  const usedKnowledge = results.length > 0;
  const excerpts = results.map((r) => r.content.trim()).filter(Boolean).slice(0, 8);
  const sourceLabels = results.map((r) => r.file).filter(Boolean).slice(0, 12);

  const prompt = buildTeachPrompt(topic, ageRange, excerpts, { quizCount: opts.quizCount });
  const model = opts.model?.trim() || TEACH_MODEL;

  const post = deps.post ?? ((url: string, body: unknown, opts?: any) => axios.post(url, body, opts));
  const resp = await post(
    `${OLLAMA_URL}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.4 },
      keep_alive: '5m',
    },
    { timeout: 180000 }
  );

  const text = String(resp?.data?.response ?? '').trim();
  if (!text) throw new Error('empty ollama response');

  const lesson = normalizeLesson(extractLessonJson(text));
  if (!lesson || (lesson.sections.length === 0 && lesson.quiz.length === 0)) {
    throw new Error('model did not return a usable lesson (invalid JSON)');
  }

  // provenance มาจาก RAG โดยตรง (ไม่เชื่อ model) — ชื่อไฟล์/รายการที่ใช้
  lesson.sources = sourceLabels;
  return { lesson, usedKnowledge };
}

/** แปลงบทเรียน → ข้อความอ่านง่าย (ใช้เป็น content ของ NOTE ในคลังความรู้) */
export function lessonToText(lesson: Lesson): string {
  const lines: string[] = [];
  lines.push(`# ${lesson.title}`);
  if (lesson.age_range) lines.push(`ระดับอายุ: ${lesson.age_range}`);
  if (lesson.summary) lines.push(lesson.summary);
  lines.push('');
  for (const s of lesson.sections) {
    if (s.heading) lines.push(`## ${s.heading}`);
    lines.push(s.content);
    lines.push('');
  }
  if (lesson.key_points.length) {
    lines.push('## สรุปจุดสำคัญ');
    for (const k of lesson.key_points) lines.push(`- ${k}`);
    lines.push('');
  }
  if (lesson.quiz.length) {
    lines.push('## แบบทดสอบ');
    lesson.quiz.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`);
      q.options.forEach((opt, j) => {
        const marker = j === q.answer ? '✔' : ' ';
        lines.push(`   ${marker} ${j + 1}. ${opt}`);
      });
      if (q.explanation) lines.push(`   เฉลย: ${q.explanation}`);
      lines.push('');
    });
  }
  if (lesson.sources.length) {
    lines.push('อ้างอิงจากคลังความรู้: ' + lesson.sources.join(' · '));
  }
  return lines.join('\n').trim();
}

/**
 * บันทึกบทเรียนเป็น NOTE ในคลังความรู้:
 * content = ข้อความอ่านง่าย (preview สวย), notes = JSON ตัวเต็ม (เปิดเรียนแบบอินเทอร์แอคทีฟ)
 */
export async function saveLesson(lesson: Lesson): Promise<{ id: string }> {
  const item = await prisma.knowledgeItem.create({
    data: {
      type: 'NOTE',
      title: `📖 ${lesson.title || 'บทเรียน AI'} (AI)`,
      content: lessonToText(lesson),
      tags: ['AI', 'บทเรียน', 'สอนลูก'],
      notes: JSON.stringify(lesson),
    },
  });
  return { id: item.id };
}

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
async function addXp(kidId: string, xp: number, source: string): Promise<void> {
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

// ────────────────────────────────────────────────
// หน้าที่ของลูก: งานบ้าน (ทำงานแลกเงิน) + บิล (ค่าไฟ/น้ำ/ห้อง) + กระเป๋าเงิน
// ────────────────────────────────────────────────

/** ตรวจว่า kid มีอยู่จริง → คืน error ถ้าไม่มี */
async function requireKid(kidId: string): Promise<void> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
}

function normMoney(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) throw new Error('amount ต้องเป็นตัวเลข');
  return n;
}

// ── งานบ้าน ──

export interface ChoreInput {
  title: string;
  reward: number; // บาทที่ได้เมื่อทำเสร็จ
  emoji?: string | null;
  repeat?: string; // none | daily — งานรายวันจะรีเซ็ตเป็นค้างใหม่ทุกเช้า
}

/** ผู้ใหญ่เพิ่มงานบ้าน (ทำงาน → ได้เงิน) */
export async function addChore(kidId: string, input: ChoreInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const reward = normMoney(input?.reward);
  if (reward <= 0) throw new Error('reward ต้องมากกว่า 0');
  const repeat = input?.repeat === 'daily' ? 'daily' : 'none';
  const item = await prisma.kidChore.create({
    data: {
      kid_id: kidId,
      title,
      reward,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      repeat,
      status: 'pending',
    },
  });
  return { id: item.id };
}

export async function deleteChore(kidId: string, choreId: string): Promise<void> {
  await prisma.kidChore.delete({ where: { id: choreId, kid_id: kidId } });
}

// ── Audit log ของลูก — ประวัติการแลกคูปอง / PIN / ทำงาน / จ่ายบิล ──

/** บันทึกประวัติการใช้งานของลูก (best-effort — ไม่ทำให้รายการหลักล้มเหลว) */
export async function logKidAction(kidId: string, action: string, detail: string, actor: 'parent' | 'kid'): Promise<void> {
  try {
    await prisma.kidAuditLog.create({
      data: {
        kid_id: kidId,
        action,
        detail: String(detail ?? '').trim().slice(0, 300),
        actor,
      },
    });
  } catch (err) {
    console.error('Kid audit log error:', err instanceof Error ? err.message : err);
  }
}

/** ประวัติล่าสุดของเด็ก (สำหรับผู้ใหญ่ตรวจย้อนหลัง) */
export async function kidAuditLog(kidId: string, limit = 40): Promise<Array<{ id: string; action: string; detail: string | null; actor: string; created_at: Date }>> {
  return prisma.kidAuditLog.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}

/** ตรวจ PIN ของลูก (ถ้ามี) — ใช้ก่อนทำงานเสร็จ / แลกคูปอง */
async function checkKidPin(kidId: string, pin?: string | null): Promise<void> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  if (kid.pin_hash) {
    let ok = false;
    if (typeof pin === 'string' && pin.length > 0) {
      try {
        ok = await bcrypt.compare(pin, kid.pin_hash);
      } catch {
        ok = false; // hash เสีย → ถือว่าผิด
      }
    }
    if (!ok) throw new Error('PIN ไม่ถูกต้อง — กรอกรหัสลับของลูกอีกครั้ง');
  }
}

/** เด็กกด "ทำเสร็จแล้ว" → ได้เงินเข้าบัญชี (กันทำซ้ำ) — ถ้าเด็กมี PIN ต้องกรอก */
export async function completeChore(kidId: string, choreId: string, pin?: string | null): Promise<{ id: string; reward: number }> {
  await requireKid(kidId);
  await checkKidPin(kidId, pin);
  const chore = await prisma.kidChore.findUnique({ where: { id: choreId } });
  if (!chore || chore.kid_id !== kidId) throw new Error('chore not found');
  if (chore.status === 'done') return { id: chore.id, reward: chore.reward }; // ทำซ้ำ → ไม่ได้เงินซ้ำ
  await prisma.kidChore.update({ where: { id: choreId }, data: { status: 'done', completed_at: new Date() } });
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: chore.reward, note: `ทำงาน: ${chore.title}`, category: 'chore' },
  });
  await logKidAction(kidId, 'chore_complete', `${chore.emoji ? chore.emoji + ' ' : ''}${chore.title} +${chore.reward}฿`, pin ? 'kid' : 'parent');
  await addXp(kidId, chore.reward, 'การทำงานบ้าน');
  // แจ้งผู้ใหญ่ทาง Telegram ทันที (best-effort)
  const balance = await walletBalance(kidId);
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId }, select: { name: true } });
  await notifyParent(`🎉 ${kid?.name ?? 'ลูก'} ทำงานเสร็จ: ${chore.emoji ? chore.emoji + ' ' : ''}${chore.title} +${chore.reward}฿\n💼 เงินในกระเป๋า: ${balance}฿`);
  return { id: chore.id, reward: chore.reward };
}

/** เปิดงานเดิมให้ทำใหม่ได้ (เช่น กวาดบ้านทุกวัน) */
export async function reopenChore(kidId: string, choreId: string): Promise<{ status: string; completed_at: Date | null }> {
  await prisma.kidChore.update({
    where: { id: choreId, kid_id: kidId },
    data: { status: 'pending', completed_at: null },
  });
  return { status: 'pending', completed_at: null };
}

// ── บิล (ค่าไฟ / ค่าน้ำ / ค่าห้อง) ──

export interface BillInput {
  title: string;
  amount: number;
  emoji?: string | null;
  period?: string; // one-time | monthly
}

export async function addBill(kidId: string, input: BillInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const amount = normMoney(input?.amount);
  if (amount <= 0) throw new Error('amount ต้องมากกว่า 0');
  const item = await prisma.kidBill.create({
    data: {
      kid_id: kidId,
      title,
      amount,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      period: input?.period === 'monthly' ? 'monthly' : 'one-time',
      status: 'unpaid',
    },
  });
  return { id: item.id };
}

export async function deleteBill(kidId: string, billId: string): Promise<void> {
  await prisma.kidBill.delete({ where: { id: billId, kid_id: kidId } });
}

/** เด็กจ่ายบิลจากกระเป๋าเงิน (หักเงิน — ติดลบได้ = บทเรียนเรื่องเงิน) */
export async function payBill(kidId: string, billId: string): Promise<{ id: string; amount: number }> {
  await requireKid(kidId);
  const bill = await prisma.kidBill.findUnique({ where: { id: billId } });
  if (!bill || bill.kid_id !== kidId) throw new Error('bill not found');
  if (bill.status === 'paid') return { id: bill.id, amount: bill.amount }; // จ่ายซ้ำ → ไม่หักซ้ำ
  await prisma.kidBill.update({ where: { id: billId }, data: { status: 'paid', paid_at: new Date() } });
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -bill.amount, note: `จ่าย${bill.title}`, category: 'bill' },
  });
  await logKidAction(kidId, 'bill_pay', `${bill.emoji ? bill.emoji + ' ' : ''}${bill.title} -${bill.amount}฿`, 'kid');
  return { id: bill.id, amount: bill.amount };
}

// ── กระเป๋าเงิน ──

/** ยอดคงเหลือ = ผลรวมธุรกรรม (ติดลบได้) */
export async function walletBalance(kidId: string): Promise<number> {
  const agg = await prisma.kidWalletTx.aggregate({
    where: { kid_id: kidId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** ผู้ใหญ่เติม/หักเงินให้ (ค่าขนม, ค่าปรับ ฯลฯ) — amount ติดลบได้ */
export async function addWalletMoney(kidId: string, amount: number, note?: string | null): Promise<{ id: string }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt === 0) throw new Error('amount ต้องไม่เป็น 0');
  const item = await prisma.kidWalletTx.create({
    data: {
      kid_id: kidId,
      amount: amt,
      note: String(note ?? '').trim().slice(0, 300) || 'เติมเงิน',
      category: 'manual',
    },
  });
  return { id: item.id };
}

export async function listWalletTxs(kidId: string, limit = 30): Promise<Array<{ id: string; amount: number; note: string; category: string; created_at: Date }>> {
  return prisma.kidWalletTx.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}

/** ข้อมูลทั้งหมดของ "หน้าบ้าน" ของเด็ก: งานบ้าน + บิล + ยอดเงิน + คูปอง + ถังแต้ม + ประวัติ */
export async function kidHome(kidId: string): Promise<{
  kid: {
    id: string; name: string; age: number | null; emoji: string | null; color: string | null;
    allowance_day: number | null; allowance_amount: number | null; allowance_last_paid: Date | null;
    savings_goal: number | null; has_pin: boolean;
    piggy_target_title: string | null; piggy_target_amount: number | null;
    xp: number; level: number; money_mode: string; invest_policy: string;
  };
  chores: Array<{ id: string; title: string; reward: number; emoji: string | null; status: string; repeat: string; completed_at: Date | null }>;
  bills: Array<{ id: string; title: string; amount: number; emoji: string | null; period: string; status: string }>;
  coupons: Array<{ id: string; title: string; cost: number; emoji: string | null; status: string; redeemed_at: Date | null }>;
  balance: number;
  piggy: number;
  piggy_month: number; // ฝากเข้ากระปุกในเดือนนี้ (เทียบเป้าหมายรายเดือน)
  piggy_eta: { balance: number; monthlyRate: number; months: number | null }; // เป้าหมายระยะยาว
  piggy_txs: Array<{ id: string; amount: number; note: string; created_at: Date }>;
  portfolio: {
    holdings: Array<{ symbol: string; name: string; emoji: string; units: number; avg_cost: number; price: number; value: number; profit: number; profitPct: number }>;
    value: number;
    totalCost: number;
    totalProfit: number;
  };
  portfolio_history: Array<{ date: string; value: number }>;
  portfolio_performance: {
    total_deposited: number; portfolio_value: number; profit: number; profit_pct: number;
    deposits_month: number; month_start_value: number | null; month_return_pct: number | null; target_pct: number;
  };
  portfolio_deposits: Array<{ id: string; amount: number; note: string; created_at: Date }>;
  certificates: Array<{ id: string; level: number; title: string; detail: string | null; created_at: Date }>;
  txs: Array<{ id: string; amount: number; note: string; category: string; created_at: Date }>;
}> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [kid, chores, bills, coupons, balance, txs, piggy, piggyMonth, piggyTxs, portfolio] = await Promise.all([
    prisma.kidProfile.findUnique({ where: { id: kidId } }),
    prisma.kidChore.findMany({ where: { kid_id: kidId, archived_at: null }, orderBy: [{ status: 'asc' }, { created_at: 'desc' }] }),
    prisma.kidBill.findMany({ where: { kid_id: kidId, archived_at: null }, orderBy: [{ status: 'asc' }, { created_at: 'desc' }] }),
    prisma.kidCoupon.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' } }),
    walletBalance(kidId),
    listWalletTxs(kidId),
    piggyBalance(kidId),
    monthlyPiggyIn(kidId, now),
    prisma.kidPiggyTx.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' }, take: 20 }),
    stockPortfolio(kidId),
  ]);
  if (!kid) throw new Error('kid not found');
  const eta = await piggyEta(kidId, kid.piggy_target_amount ?? null, now);
  return {
    kid: {
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      allowance_last_paid: kid.allowance_last_paid,
      savings_goal: kid.savings_goal,
      has_pin: !!kid.pin_hash,
      piggy_target_title: kid.piggy_target_title,
      piggy_target_amount: kid.piggy_target_amount,
      xp: kid.xp ?? 0,
      level: kidLevel(kid.xp ?? 0),
      money_mode: kid.money_mode ?? 'play',
      invest_policy: kid.invest_policy ?? '',
    },
    chores,
    bills,
    coupons,
    balance,
    piggy,
    piggy_month: piggyMonth,
    piggy_eta: eta,
    piggy_txs: piggyTxs,
    portfolio,
    portfolio_history: await portfolioHistory(kidId, 30),
    portfolio_performance: await portfolioPerformance(kidId),
    portfolio_deposits: await portfolioDeposits(kidId),
    certificates: await listCertificates(kidId),
    txs,
  };
}

/** สรุปสำหรับหน้า Dashboard — ทุกคนพร้อมสถิติ quiz + ยอดเงิน + งานค้าง/บิลค้าง */
export async function dashboardSummary(): Promise<Array<{
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  savings_goal: number | null;
  piggy: number;
  piggy_target_title: string | null;
  piggy_target_amount: number | null;
  portfolio_value: number;
  stats: KidStats;
  lastQuiz: { lesson_title: string; score: number; total: number; pct: number; completed_at: Date } | null;
  wallet: number;
  pendingChores: number;
  unpaidBills: number;
}>> {
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];

  const [progress, walletGroups, choreGroups, billGroups, piggyGroups] = await Promise.all([
    prisma.kidLessonProgress.findMany({ orderBy: { completed_at: 'desc' }, take: kids.length }),
    prisma.kidWalletTx.groupBy({ by: ['kid_id'], _sum: { amount: true } }),
    prisma.kidChore.groupBy({ by: ['kid_id'], where: { status: 'pending', archived_at: null }, _count: true }),
    prisma.kidBill.groupBy({ by: ['kid_id'], where: { status: 'unpaid', archived_at: null }, _count: true }),
    prisma.kidPiggyTx.groupBy({ by: ['kid_id'], _sum: { amount: true } }),
  ]);
  const lastByKid = new Map(progress.map((p) => [p.kid_id, p]));
  const walletByKid = new Map(walletGroups.map((g) => [g.kid_id, g._sum.amount ?? 0]));
  const choreByKid = new Map(choreGroups.map((g) => [g.kid_id, g._count ?? 0]));
  const billByKid = new Map(billGroups.map((g) => [g.kid_id, g._count ?? 0]));
  const piggyByKid = new Map(piggyGroups.map((g) => [g.kid_id, g._sum.amount ?? 0]));

  const out = [];
  for (const kid of kids) {
    const last = lastByKid.get(kid.id);
    const portfolio = await stockPortfolio(kid.id);
    out.push({
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day ?? null,
      allowance_amount: kid.allowance_amount ?? null,
      savings_goal: kid.savings_goal ?? null,
      piggy: piggyByKid.get(kid.id) ?? 0,
      piggy_target_title: kid.piggy_target_title ?? null,
      piggy_target_amount: kid.piggy_target_amount ?? null,
      portfolio_value: portfolio.value,
      xp: kid.xp ?? 0,
      level: kidLevel(kid.xp ?? 0),
      money_mode: kid.money_mode ?? 'play',
      stats: await kidStats(kid.id),
      lastQuiz: last
        ? {
            lesson_title: last.lesson_title,
            score: last.score,
            total: last.total,
            pct: last.total > 0 ? Math.round((last.score / last.total) * 100) : 0,
            completed_at: last.completed_at,
          }
        : null,
      wallet: walletByKid.get(kid.id) ?? 0,
      pendingChores: choreByKid.get(kid.id) ?? 0,
      unpaidBills: billByKid.get(kid.id) ?? 0,
    });
  }
  return out;
}

// ────────────────────────────────────────────────
// ค่าขนมรายสัปดาห์อัตโนมัติ — ผู้ใหญ่ตั้งวัน + จำนวนเงิน แล้ว worker จ่ายให้เอง
// ────────────────────────────────────────────────

export const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

interface AllowanceKid {
  id: string;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: Date | null;
}

/** กำหนดค่าขนมรายสัปดาห์: day = 0 (อาทิตย์) … 6 (เสาร์), amount = บาท */
export async function setAllowance(kidId: string, input: { day: number; amount: number }): Promise<{ day: number; amount: number }> {
  await requireKid(kidId);
  const day = Math.floor(Number(input?.day));
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('day ต้องเป็น 0-6 (0=อาทิตย์ … 6=เสาร์)');
  const amount = normMoney(input?.amount);
  if (amount <= 0) throw new Error('amount ต้องมากกว่า 0');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { allowance_day: day, allowance_amount: amount } });
  return { day, amount };
}

/**
 * ถึงกำหนดจ่ายหรือยัง? — จ่าย 1 ครั้งต่อสัปดาห์ โดยนับสัปดาห์จากวันจ่าย
 * anchor = ครั้งล่าสุดของวันจ่ายที่ผ่านมา ถ้ายังไม่เคยจ่ายในรอบนี้ → จ่าย
 */
export function allowanceDueNow(kid: AllowanceKid, now: Date): boolean {
  if (kid.allowance_day == null || kid.allowance_amount == null) return false;
  const day = kid.allowance_day;
  const diff = (now.getDay() - day + 7) % 7; // กี่วันแล้วนับจากวันจ่ายล่าสุด
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  if (!kid.allowance_last_paid) return true;
  const lastPaid = new Date(kid.allowance_last_paid);
  return lastPaid < anchor;
}

/** worker: จ่ายค่าขนมให้ทุกคนที่ถึงกำหนด (กันจ่ายซ้ำด้วย allowance_last_paid) */
export async function payWeeklyAllowances(now: Date = new Date()): Promise<{ paid: number; total: number }> {
  const kids = await prisma.kidProfile.findMany({
    where: { allowance_day: { not: null }, allowance_amount: { not: null } },
  });
  let paid = 0;
  let total = 0;
  for (const kid of kids) {
    if (!allowanceDueNow(kid, now)) continue;
    const amount = kid.allowance_amount!;
    await prisma.kidWalletTx.create({
      data: {
        kid_id: kid.id,
        amount,
        note: `ค่าขนมรายสัปดาห์ (${WEEKDAYS[kid.allowance_day!]})`,
        category: 'allowance',
      },
    });
    await prisma.kidProfile.update({ where: { id: kid.id }, data: { allowance_last_paid: now } });
    paid += 1;
    total += amount;
  }
  return { paid, total };
}

// ────────────────────────────────────────────────
// คูปองรางวัล — ผู้ใหญ่สร้างรางวัลพิเศษ ให้ลูกแลกด้วยคะแนนจากการทำงานบ้าน
// ────────────────────────────────────────────────

export interface CouponInput {
  title: string;
  cost: number; // คะแนน/บาท ที่ต้องใช้แลก
  emoji?: string | null;
}

/** ผู้ใหญ่สร้างคูปองรางวัล เช่น "เล่นเกม 30 นาที" 50 คะแนน */
export async function addCoupon(kidId: string, input: CouponInput): Promise<{ id: string }> {
  await requireKid(kidId);
  const title = String(input?.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('title is required');
  const cost = normMoney(input?.cost);
  if (cost <= 0) throw new Error('cost ต้องมากกว่า 0');
  const item = await prisma.kidCoupon.create({
    data: {
      kid_id: kidId,
      title,
      cost,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : null,
      status: 'available',
    },
  });
  return { id: item.id };
}

export async function deleteCoupon(kidId: string, couponId: string): Promise<void> {
  await prisma.kidCoupon.delete({ where: { id: couponId, kid_id: kidId } });
}

/** ลูกแลกคูปอง → หักคะแนนจากกระเป๋าเงิน + ขึ้นสถานะ redeemed (แลกได้ครั้งเดียว) — ถ้าเด็กมี PIN ต้องกรอก */
export async function redeemCoupon(kidId: string, couponId: string, pin?: string | null): Promise<{ id: string; title: string; cost: number }> {
  await checkKidPin(kidId, pin);
  const coupon = await prisma.kidCoupon.findUnique({ where: { id: couponId } });
  if (!coupon || coupon.kid_id !== kidId) throw new Error('coupon not found');
  if (coupon.status !== 'available') throw new Error('coupon already redeemed');
  const balance = await walletBalance(kidId);
  if (balance < coupon.cost) throw new Error('not enough balance');
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -coupon.cost, note: `แลกคูปอง: ${coupon.title}`, category: 'coupon' },
  });
  await prisma.kidCoupon.update({ where: { id: couponId }, data: { status: 'redeemed', redeemed_at: new Date() } });
  await logKidAction(kidId, 'coupon_redeem', `${coupon.emoji ? coupon.emoji + ' ' : ''}${coupon.title} -${coupon.cost} แต้ม`, pin ? 'kid' : 'parent');
  // แจ้งผู้ใหญ่ทาง Telegram ทันที (best-effort)
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId }, select: { name: true } });
  await notifyParent(`🎁 ${kid?.name ?? 'ลูก'} แลกคูปอง: ${coupon.emoji ? coupon.emoji + ' ' : ''}${coupon.title} (${coupon.cost} แต้ม)\n💼 เงินคงเหลือ: ${balance - coupon.cost}฿`);
  return { id: coupon.id, title: coupon.title, cost: coupon.cost };
}

// ────────────────────────────────────────────────
// รายงานรายสัปดาห์ — สำหรับส่งออก PDF (คะแนน + งานบ้าน + บิล + ยอดเงิน)
// ────────────────────────────────────────────────

/** รวบรวมข้อมูลของทุกคนใน 7 วันล่าสุด ให้ frontend สร้าง PDF ผ่านหน้าต่างพิมพ์ */
export async function weeklyReport(days = 7): Promise<Array<Record<string, unknown>>> {
  const since = new Date(Date.now() - days * 86400000);
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];

  const out = [];
  for (const kid of kids) {
    const [progress, chores, bills, txs, balance, stats] = await Promise.all([
      prisma.kidLessonProgress.findMany({
        where: { kid_id: kid.id, completed_at: { gte: since } },
        orderBy: { completed_at: 'asc' },
      }),
      prisma.kidChore.findMany({ where: { kid_id: kid.id, archived_at: null }, orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.kidBill.findMany({ where: { kid_id: kid.id, archived_at: null }, orderBy: { created_at: 'desc' }, take: 100 }),
      prisma.kidWalletTx.findMany({
        where: { kid_id: kid.id, created_at: { gte: since } },
        orderBy: { created_at: 'desc' },
        take: 100,
      }),
      walletBalance(kid.id),
      kidStats(kid.id),
    ]);
    out.push({
      id: kid.id,
      name: kid.name,
      age: kid.age,
      emoji: kid.emoji,
      color: kid.color,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      stats,
      progress,
      chores,
      bills,
      txs,
      balance,
    });
  }
  return out;
}

// ────────────────────────────────────────────────
// เก็บถาวรอัตโนมัติ — งาน/บิลที่จบแล้วเกิน 30 วัน (หน้าบ้านไม่รก)
// ────────────────────────────────────────────────

/** ทำเครื่องหมายงานที่เสร็จ / บิลที่จ่ายแล้วเกิน `days` วันเป็น archived (ซ่อนจากหน้าบ้าน) */
export async function archiveOldItems(now: Date = new Date(), days = 30): Promise<{ chores: number; bills: number }> {
  const cutoff = new Date(now.getTime() - days * 86400000);
  const [chores, bills] = await Promise.all([
    prisma.kidChore.updateMany({
      where: { status: 'done', archived_at: null, completed_at: { lt: cutoff } },
      data: { archived_at: now },
    }),
    prisma.kidBill.updateMany({
      where: { status: 'paid', archived_at: null, paid_at: { lt: cutoff } },
      data: { archived_at: now },
    }),
  ]);
  return { chores: chores.count, bills: bills.count };
}

// ────────────────────────────────────────────────
// ถังสะสมแต้ม — เปลี่ยนคะแนนจากงานบ้านเป็นเหรียญเก็บกระปุก + เป้าหมายออมรายเดือน
// ────────────────────────────────────────────────

/** ยอดในกระปุก = ผลรวมธุรกรรมถัง (ติดลบไม่ได้ — ถอนได้เท่าที่มี) */
export async function piggyBalance(kidId: string): Promise<number> {
  const agg = await prisma.kidPiggyTx.aggregate({ where: { kid_id: kidId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

/** ฝากเข้ากระปุกในเดือนนี้ (เทียบเป้าหมายรายเดือน) */
export async function monthlyPiggyIn(kidId: string, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.kidPiggyTx.aggregate({
    where: { kid_id: kidId, amount: { gt: 0 }, created_at: { gte: monthStart } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** ตั้งเป้าหมายออมรายเดือน (บาท) — 0/ว่าง = ปิด */
export async function setSavingsGoal(kidId: string, goal: number): Promise<{ goal: number | null }> {
  await requireKid(kidId);
  const g = Math.floor(Number(goal));
  if (!Number.isFinite(g) || g < 0) throw new Error('goal ต้องเป็นตัวเลข ≥ 0');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { savings_goal: g > 0 ? g : null } });
  return { goal: g > 0 ? g : null };
}

/**
 * ฝาก/ถอนเหรียญ: amount > 0 = หักจากกระเป๋าเงินเข้าถัง, amount < 0 = ถอนกลับกระเป๋า
 * บันทึกทั้ง 2 ฝั่ง (wallet tx หมวด piggy + piggy tx)
 */
export async function piggyTransfer(kidId: string, amount: number, note?: string | null): Promise<{ id: string; amount: number; balance: number }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt === 0) throw new Error('amount ต้องไม่เป็น 0');
  const label = String(note ?? '').trim().slice(0, 300) || (amt > 0 ? 'ฝากเข้าถัง' : 'ถอนจากถัง');
  if (amt > 0) {
    // ฝากเข้า — หักจากกระเป๋าเงินก่อน (ต้องพอ)
    const balance = await walletBalance(kidId);
    if (balance < amt) throw new Error('not enough balance');
    await prisma.kidWalletTx.create({
      data: { kid_id: kidId, amount: -amt, note: `ฝากเข้าถัง: ${label}`, category: 'piggy' },
    });
  } else {
    // ถอนออก — ต้องมีในกระปุกพอ
    const piggy = await piggyBalance(kidId);
    if (piggy < -amt) throw new Error('not enough in piggy');
    await prisma.kidWalletTx.create({
      data: { kid_id: kidId, amount: -amt, note: `ถอนจากถัง: ${label}`, category: 'piggy' },
    });
  }
  const item = await prisma.kidPiggyTx.create({
    data: { kid_id: kidId, amount: amt, note: label },
  });
  return { id: item.id, amount: amt, balance: (await piggyBalance(kidId)) };
}

// ────────────────────────────────────────────────
// PIN ส่วนตัวของลูก — ให้เด็กกดทำงานเสร็จ/แลกคูปองเองได้ (ไม่พึ่งผู้ใหญ่)
// ────────────────────────────────────────────────

/** ตั้ง/เปลี่ยน/ล้าง PIN ของลูก (4-6 หลัก) — เก็บเป็น bcrypt hash */
export async function setKidPin(kidId: string, pin: string): Promise<{ has_pin: boolean }> {
  await requireKid(kidId);
  const p = String(pin ?? '').trim();
  if (p !== '' && !/^\d{4,6}$/.test(p)) throw new Error('PIN ต้องเป็นตัวเลข 4-6 หลัก');
  const pin_hash = p ? await bcrypt.hash(p, 10) : null;
  await prisma.kidProfile.update({ where: { id: kidId }, data: { pin_hash } });
  await logKidAction(kidId, pin_hash ? 'pin_set' : 'pin_clear', pin_hash ? 'ตั้ง PIN ใหม่' : 'ล้าง PIN', 'parent');
  return { has_pin: !!pin_hash };
}

/** ตรวจ PIN — false เมื่อไม่มี PIN ตั้งไว้ หรือ PIN ผิด */
export async function verifyKidPin(kidId: string, pin: string): Promise<boolean> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid || !kid.pin_hash) return false;
  try {
    return await bcrypt.compare(String(pin ?? ''), kid.pin_hash);
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────
// ค่าขนม: จ่ายย้อนหลังด้วยมือ + ประวัติการจ่ายทุกคน
// ────────────────────────────────────────────────

/** จ่ายค่าขนมให้คนเดียวทันที (ถ้าถึงกำหนด) — ใช้เมื่อ worker พลาด */
export async function payAllowanceNow(kidId: string, now: Date = new Date()): Promise<{ paid: boolean; amount: number | null }> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  if (!allowanceDueNow(kid, now)) return { paid: false, amount: null };
  const amount = kid.allowance_amount!;
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount, note: `ค่าขนมรายสัปดาห์ (${WEEKDAYS[kid.allowance_day!]})`, category: 'allowance' },
  });
  await prisma.kidProfile.update({ where: { id: kidId }, data: { allowance_last_paid: now } });
  await logKidAction(kidId, 'allowance_pay', `ค่าขนมรายสัปดาห์ +${amount}฿`, 'parent');
  return { paid: true, amount };
}

/** ประวัติการจ่ายค่าขนมของทุกคน — ตั้งค่า + รายการจ่ายล่าสุด */
export async function allowanceHistory(): Promise<Array<{
  id: string;
  name: string;
  emoji: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: Date | null;
  txs: Array<{ id: string; amount: number; note: string; created_at: Date }>;
}>> {
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  if (kids.length === 0) return [];
  const out = [];
  for (const kid of kids) {
    const txs = await prisma.kidWalletTx.findMany({
      where: { kid_id: kid.id, category: 'allowance' },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
    out.push({
      id: kid.id,
      name: kid.name,
      emoji: kid.emoji,
      allowance_day: kid.allowance_day,
      allowance_amount: kid.allowance_amount,
      allowance_last_paid: kid.allowance_last_paid,
      txs,
    });
  }
  return out;
}

// ────────────────────────────────────────────────
// งานบ้านรายวัน — เช็กลิสต์ที่รีเซ็ตเป็นค้างใหม่เองทุกเช้า
// ────────────────────────────────────────────────

/** รีเซ็ตงานรายวันที่ทำเสร็จก่อนเช้านี้ → กลับเป็นค้าง (ทำได้ใหม่ทุกวัน) */
export async function resetDailyChores(now: Date = new Date()): Promise<{ reset: number }> {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const res = await prisma.kidChore.updateMany({
    where: { repeat: 'daily', status: 'done', completed_at: { lt: todayStart } },
    data: { status: 'pending', completed_at: null },
  });
  return { reset: res.count };
}

// ────────────────────────────────────────────────
// สรุปประจำวันของลูก — ส่ง Telegram ตอนเย็น (งานที่ทำ + คะแนน + ยอดเงิน)
// ────────────────────────────────────────────────

export interface DailySummaryRow {
  id: string;
  name: string;
  emoji: string | null;
  choresDone: number;
  choresReward: number;
  billsPaid: number;
  wallet: number;
  piggy: number;
}

/** รวบรวมกิจกรรม 24 ชม. ล่าสุดของทุกคน */
export async function buildDailySummary(now: Date = new Date()): Promise<{ kids: DailySummaryRow[]; generatedAt: Date }> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
  const out: DailySummaryRow[] = [];
  for (const kid of kids) {
    const [choresDone, choresAgg, billsPaid, wallet, piggy] = await Promise.all([
      prisma.kidChore.count({ where: { kid_id: kid.id, status: 'done', completed_at: { gte: since } } }),
      prisma.kidWalletTx.aggregate({
        where: { kid_id: kid.id, category: 'chore', created_at: { gte: since } },
        _sum: { amount: true },
      }),
      prisma.kidBill.count({ where: { kid_id: kid.id, status: 'paid', paid_at: { gte: since } } }),
      walletBalance(kid.id),
      piggyBalance(kid.id),
    ]);
    out.push({
      id: kid.id,
      name: kid.name,
      emoji: kid.emoji,
      choresDone,
      choresReward: choresAgg._sum.amount ?? 0,
      billsPaid,
      wallet,
      piggy,
    });
  }
  return { kids: out, generatedAt: now };
}

/** แปลงสรุป → ข้อความ Telegram (HTML) */
export function formatDailySummary(s: { kids: DailySummaryRow[]; generatedAt: Date }): string {
  const date = s.generatedAt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const blocks = s.kids.map((k) => {
    const work = k.choresDone > 0
      ? `✅ ทำงานเสร็จ <b>${k.choresDone}</b> งาน (ได้ <b>${k.choresReward}฿</b>)`
      : '😴 วันนี้ยังไม่ได้ทำงานบ้าน';
    const bill = k.billsPaid > 0 ? ` · จ่ายบิล ${k.billsPaid} ใบ` : '';
    return `\n👶 <b>${k.emoji || '🧒'} ${k.name}</b>\n${work}${bill}\n💵 เงินในกระเป๋า: <b>${k.wallet.toLocaleString()}฿</b> · 🐷 ถังสะสมแต้ม: <b>${k.piggy.toLocaleString()}฿</b>`;
  }).join('\n');
  return `📋 <b>สรุปประจำวันของลูก</b> (${date})\n${blocks}\n\n💡 สอนลูกเรื่องการออม: เก็บ 10% ของที่ได้เข้ากระปุกก่อนใช้จ่าย แล้วลองเล่น <b>หุ้นจำลองของบ้าน</b> ในคลังความรู้ → หน้าที่ของลูก`;
}

// ────────────────────────────────────────────────
// เป้าหมายระยะยาวของถังสะสมแต้ม + ระยะเวลาคาดว่าจะถึง
// ────────────────────────────────────────────────

/** ตั้งเป้าหมายระยะยาว (เช่น "ซื้อจักรยาน 500฿") — amount 0 = ล้าง */
export async function setPiggyTarget(kidId: string, input: { title: string; amount: number }): Promise<{ title: string | null; amount: number | null }> {
  await requireKid(kidId);
  const amount = Math.floor(Number(input?.amount));
  if (!Number.isFinite(amount) || amount < 0) throw new Error('amount ต้องเป็นตัวเลข ≥ 0');
  const title = String(input?.title ?? '').trim().slice(0, 100);
  if (amount > 0 && !title) throw new Error('title is required');
  await prisma.kidProfile.update({
    where: { id: kidId },
    data: {
      piggy_target_amount: amount > 0 ? amount : null,
      piggy_target_title: amount > 0 ? title : null,
    },
  });
  return { title: amount > 0 ? title : null, amount: amount > 0 ? amount : null };
}

/** คำนวณระยะเวลา (เดือน) ที่คาดว่าจะถึงเป้าหมาย จากอัตราฝาก 30 วันล่าสุด */
export async function piggyEta(kidId: string, target: number | null, now: Date = new Date()): Promise<{ balance: number; monthlyRate: number; months: number | null }> {
  const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
  const [balance, deposits] = await Promise.all([
    piggyBalance(kidId),
    prisma.kidPiggyTx.aggregate({
      where: { kid_id: kidId, amount: { gt: 0 }, created_at: { gte: thirtyAgo } },
      _sum: { amount: true },
    }),
  ]);
  const monthlyRate = deposits._sum.amount ?? 0;
  let months: number | null = null;
  if (target != null && target > balance && monthlyRate > 0) {
    months = Math.max(1, Math.ceil((target - balance) / monthlyRate));
  }
  return { balance, monthlyRate, months };
}

// ────────────────────────────────────────────────
// หุ้นจำลองของบ้าน — สอนลูกเรื่องการลงทุน (ราคาเปลี่ยนทุกวันแบบกำหนดได้)
// ────────────────────────────────────────────────

/** หุ้นของ "ที่บ้าน" — ธีมเดียวกับระบบ (น้ำ/โซลาร์/แปลงผัก) */
export const STOCK_CATALOG = [
  { symbol: 'WATER', name: 'น้ำป่า (ระบบน้ำ)', emoji: '💧', base: 50 },
  { symbol: 'SOLAR', name: 'ไร่แสง (โซลาร์)', emoji: '☀️', base: 80 },
  { symbol: 'FARM', name: 'ไร่ผัก (แปลงเกษตร)', emoji: '🥬', base: 30 },
] as const;

export type StockSymbol = (typeof STOCK_CATALOG)[number]['symbol'];

function symbolHash(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}

/** ราคาหุ้นจำลอง — deterministic ตามวัน (sin wave + trend + jitter จาก seed เดียวกัน) */
export function stockPrice(symbol: string, date: Date = new Date()): number {
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) return 0;
  const day = Math.floor(date.getTime() / 86400000);
  const wave = Math.sin((day + item.base) * 1.7) * 0.12;
  const drift = ((day % 90) - 45) * 0.002;
  const seed = Math.sin(day * 12.9898 + symbolHash(symbol)) * 43758.5453;
  const jitter = (seed - Math.floor(seed) - 0.5) * 0.06;
  return Math.max(1, Math.round(item.base * (1 + wave + drift + jitter) * 100) / 100);
}

/** ราคา/มูลค่าพอร์ตของเด็ก */
export async function stockPortfolio(kidId: string): Promise<{
  holdings: Array<{ symbol: string; name: string; emoji: string; units: number; avg_cost: number; price: number; value: number; profit: number; profitPct: number }>;
  value: number;
  totalCost: number;
  totalProfit: number;
}> {
  const rows = await prisma.kidInvestment.findMany({ where: { kid_id: kidId } });
  const holdings = rows.map((r) => {
    const item = STOCK_CATALOG.find((s) => s.symbol === r.symbol);
    const price = stockPrice(r.symbol);
    const value = Math.round(r.units * price * 100) / 100;
    const cost = r.avg_cost * r.units;
    const profit = Math.round((value - cost) * 100) / 100;
    return {
      symbol: r.symbol,
      name: item?.name ?? r.symbol,
      emoji: item?.emoji ?? '📈',
      units: r.units,
      avg_cost: r.avg_cost,
      price,
      value,
      profit,
      profitPct: cost > 0 ? Math.round((profit / cost) * 100) : 0,
    };
  });
  const value = Math.round(holdings.reduce((a, h) => a + h.value, 0) * 100) / 100;
  const totalCost = Math.round(holdings.reduce((a, h) => a + h.avg_cost * h.units, 0) * 100) / 100;
  return {
    holdings,
    value,
    totalCost,
    totalProfit: Math.round((value - totalCost) * 100) / 100,
  };
}

/** ลูกซื้อหุ้นด้วยเงินจากกระเป๋า — หักเงิน + บันทึก holding (เฉลี่ยต้นทุน) */
export async function buyStock(kidId: string, symbol: string, units: number): Promise<{ symbol: string; units: number; price: number; cost: number }> {
  await requireKid(kidId);
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) throw new Error('unknown symbol');
  const qty = Math.floor(Number(units));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('units ต้องเป็นจำนวนเต็ม > 0');
  const price = stockPrice(symbol);
  const cost = Math.round(qty * price);
  const balance = await walletBalance(kidId);
  if (balance < cost) throw new Error('not enough balance');
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: -cost, note: `ซื้อหุ้น ${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, category: 'stock' },
  });
  const existing = await prisma.kidInvestment.findUnique({ where: { kid_id_symbol: { kid_id: kidId, symbol } } });
  if (existing) {
    const newUnits = existing.units + qty;
    const newAvg = (existing.avg_cost * existing.units + cost) / newUnits;
    await prisma.kidInvestment.update({
      where: { id: existing.id },
      data: { units: newUnits, avg_cost: Math.round(newAvg * 100) / 100 },
    });
  } else {
    await prisma.kidInvestment.create({
      data: { kid_id: kidId, symbol, units: qty, avg_cost: Math.round(price * 100) / 100 },
    });
  }
  await logKidAction(kidId, 'stock_buy', `${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, 'kid');
  return { symbol, units: qty, price, cost };
}

/** ลูกขายหุ้น — ได้เงินเข้ากระเป๋า (หักหน่วยจาก holding) */
export async function sellStock(kidId: string, symbol: string, units: number): Promise<{ symbol: string; units: number; price: number; proceeds: number }> {
  const item = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!item) throw new Error('unknown symbol');
  const qty = Math.floor(Number(units));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('units ต้องเป็นจำนวนเต็ม > 0');
  const holding = await prisma.kidInvestment.findUnique({ where: { kid_id_symbol: { kid_id: kidId, symbol } } });
  if (!holding || holding.units < qty) throw new Error('not enough units');
  const price = stockPrice(symbol);
  const proceeds = Math.round(qty * price);
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: proceeds, note: `ขายหุ้น ${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, category: 'stock' },
  });
  const remaining = holding.units - qty;
  if (remaining <= 0) {
    await prisma.kidInvestment.delete({ where: { id: holding.id } });
  } else {
    await prisma.kidInvestment.update({ where: { id: holding.id }, data: { units: remaining } });
  }
  await logKidAction(kidId, 'stock_sell', `${item.emoji}${item.name} ${qty} หน่วย @ ${price}฿`, 'kid');
  return { symbol, units: remaining <= 0 ? 0 : remaining, price, proceeds };
}

// ────────────────────────────────────────────────
// พอร์ตหุ้นย้อนหลัง + เงินจริง/นโยบายลงทุน
// ────────────────────────────────────────────────

/** บันทึก snapshot มูลค่าพอร์ตของวันนี้ (วันละ 1 แถวต่อเด็ก — แก้ไขแทนการซ้ำ) */
export async function recordPortfolioSnapshot(kidId: string): Promise<void> {
  try {
    const portfolio = await stockPortfolio(kidId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const existing = await prisma.kidPortfolioSnapshot.findFirst({
      where: { kid_id: kidId, created_at: { gte: startOfDay } },
      orderBy: { created_at: 'desc' },
    });
    if (existing) {
      await prisma.kidPortfolioSnapshot.update({
        where: { id: existing.id },
        data: { value: portfolio.value },
      });
    } else {
      await prisma.kidPortfolioSnapshot.create({
        data: { kid_id: kidId, value: portfolio.value },
      });
    }
  } catch (err) {
    console.error('recordPortfolioSnapshot error:', err instanceof Error ? err.message : err);
  }
}

/** บันทึก snapshot ให้เด็กทุกคน (worker รายวัน) */
export async function snapshotAllPortfolios(): Promise<{ saved: number }> {
  const kids = await prisma.kidProfile.findMany({ select: { id: true } });
  let saved = 0;
  for (const kid of kids) {
    try {
      await recordPortfolioSnapshot(kid.id);
      saved += 1;
    } catch {
      // ข้ามเด็กที่ error
    }
  }
  return { saved };
}

/** ประวัติมูลค่าพอร์ต (รายวัน — ใหม่สุดก่อน) */
export async function portfolioHistory(kidId: string, days = 60): Promise<Array<{ date: string; value: number }>> {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.kidPortfolioSnapshot.findMany({
    where: { kid_id: kidId, created_at: { gte: since } },
    orderBy: { created_at: 'asc' },
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.created_at.toISOString().slice(0, 10), r.value); // วันหลัง ๆ ทับวันเก่า
  }
  return [...byDay.entries()].map(([date, value]) => ({ date, value }));
}

/** เปลี่ยนโหมดเงิน: 'play' = เงินจำลอง (หัดเล่น) | 'real' = เงินจริงที่พ่อแม่มอบหมายให้ลูกบริหาร */
export async function setKidMoneyMode(kidId: string, mode: string): Promise<{ money_mode: string }> {
  if (mode !== 'play' && mode !== 'real') throw new Error('money_mode ต้องเป็น play หรือ real');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { money_mode: mode } });
  await logKidAction(kidId, 'money_mode', `เปลี่ยนโหมดเงินเป็น ${mode === 'real' ? 'เงินจริง 💵' : 'เงินจำลอง 🎮'}`, 'parent');
  return { money_mode: mode };
}

/** นโยบายของผู้ใหญ่: ลูกต้องเก็บ/ลงทุนยังไง (เช่น เก็บ 20% เข้าถังและลงทุนเสมอ) */
export async function setInvestPolicy(kidId: string, text: string): Promise<{ invest_policy: string }> {
  const t = String(text ?? '').trim().slice(0, 500);
  await prisma.kidProfile.update({ where: { id: kidId }, data: { invest_policy: t } });
  if (t) await logKidAction(kidId, 'invest_policy', `ตั้งนโยบายลงทุน: ${t}`, 'parent');
  return { invest_policy: t };
}

/** เป้าหมายผลตอบแทนรายเดือน (%) ของพอร์ตเงินจริง — เทียบในรายงาน */
export async function setInvestTargetPct(kidId: string, pct: number): Promise<{ invest_target_pct: number }> {
  const p = Number(pct);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('invest_target_pct ต้องอยู่ระหว่าง 0-100');
  await prisma.kidProfile.update({ where: { id: kidId }, data: { invest_target_pct: Math.round(p * 10) / 10 } });
  await logKidAction(kidId, 'invest_target', `ตั้งเป้าหมายผลตอบแทนรายเดือน ${p}%`, 'parent');
  return { invest_target_pct: Math.round(p * 10) / 10 };
}

// ── พ่อแม่เติมเงินจริงเข้าพอร์ตหุ้น (เงินเก็บของลูกที่มอบหมายให้ลูกบริหาร) ──

/** เพิ่มเงินฝากเข้าพอร์ต: เข้าบัญชี + บันทึกยอดฝาก + audit */
export async function addPortfolioDeposit(kidId: string, amount: number, note?: string | null): Promise<{ id: string; amount: number }> {
  await requireKid(kidId);
  const amt = normMoney(amount);
  if (amt <= 0) throw new Error('amount ต้องมากกว่า 0');
  const text = String(note ?? '').trim().slice(0, 200) || 'พ่อแม่เติมเงินจริงเข้าพอร์ต';
  await prisma.kidWalletTx.create({
    data: { kid_id: kidId, amount: amt, note: `💰 ${text}`, category: 'stock_deposit' },
  });
  const item = await prisma.kidPortfolioDeposit.create({
    data: { kid_id: kidId, amount: amt, note: text },
  });
  await logKidAction(kidId, 'portfolio_deposit', `พ่อแม่เติมเงินจริงเข้าพอร์ต +${amt}฿ (${text})`, 'parent');
  return { id: item.id, amount: amt };
}

/** ประวัติยอดฝากเข้าพอร์ต (ใหม่สุดก่อน) */
export async function portfolioDeposits(kidId: string): Promise<Array<{ id: string; amount: number; note: string; created_at: Date }>> {
  return prisma.kidPortfolioDeposit.findMany({
    where: { kid_id: kidId },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * ผลตอบแทนพอร์ต: เงินฝากทั้งหมด vs มูลค่าปัจจุบัน + ผลตอบแทนรายเดือน (จาก snapshot)
 * month_return_pct ≈ (value_now - month_start - deposits_month) / (month_start + deposits_month) * 100
 */
export async function portfolioPerformance(kidId: string): Promise<{
  total_deposited: number;
  portfolio_value: number;
  profit: number;
  profit_pct: number;
  deposits_month: number;
  month_start_value: number | null;
  month_return_pct: number | null;
  target_pct: number;
}> {
  const kid = await prisma.kidProfile.findUnique({ where: { id: kidId } });
  if (!kid) throw new Error('kid not found');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [deposits, agg, portfolio, monthDepAgg, monthStartSnap] = await Promise.all([
    prisma.kidPortfolioDeposit.findMany({ where: { kid_id: kidId }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.kidPortfolioDeposit.aggregate({ where: { kid_id: kidId }, _sum: { amount: true } }),
    stockPortfolio(kidId),
    prisma.kidPortfolioDeposit.aggregate({ where: { kid_id: kidId, created_at: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.kidPortfolioSnapshot.findFirst({ where: { kid_id: kidId, created_at: { gte: monthStart } }, orderBy: { created_at: 'asc' } }),
  ]);
  const totalDeposited = agg._sum.amount ?? 0;
  const depositsMonth = monthDepAgg._sum.amount ?? 0;
  const monthStartValue = monthStartSnap?.value ?? null;
  const value = portfolio.value;
  let monthReturnPct: number | null = null;
  if (monthStartValue != null) {
    const base = monthStartValue + depositsMonth;
    if (base > 0) monthReturnPct = Math.round(((value - base) / base) * 1000) / 10;
  }
  const profit = Math.round((value - totalDeposited) * 100) / 100;
  return {
    total_deposited: totalDeposited,
    portfolio_value: value,
    profit,
    profit_pct: totalDeposited > 0 ? Math.round((profit / totalDeposited) * 1000) / 10 : 0,
    deposits_month: depositsMonth,
    month_start_value: monthStartValue,
    month_return_pct: monthReturnPct,
    target_pct: kid.invest_target_pct ?? 0,
  };
}

/** รายชื่อโมเดลจาก Ollama (/api/tags) — ให้ผู้ใหญ่เลือกโมเดลสร้างบทเรียน */
export async function listOllamaModels(deps: { post?: (url: string, opts?: any) => Promise<{ data?: { models?: Array<{ name: string }> } }> } = {}): Promise<string[]> {
  const post = deps.post ?? ((url: string, opts?: any) => axios.get(url, opts));
  try {
    const resp = await post(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    return (resp.data?.models ?? []).map((m) => String(m.name)).filter(Boolean);
  } catch (err) {
    console.error('List Ollama models error:', err instanceof Error ? err.message : err);
    return [];
  }
}
