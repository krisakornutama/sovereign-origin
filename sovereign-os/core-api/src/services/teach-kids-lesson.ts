// src/services/teach-kids-lesson.ts
// สร้างบทเรียน + แบบทดสอบจากคลังความรู้ (RAG + Ollama) + บันทึกเป็น NOTE

import axios from 'axios';
import { getModelForTask } from './ai-router.service';
import { prisma } from '../lib/prisma';
import { search, type SearchResult } from './semantic-search.service';

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
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
  const model = opts.model?.trim() || (await getModelForTask('GENERAL_ASSISTANT', TEACH_MODEL));

  const post = deps.post ?? ((url: string, body: unknown, opts?: any) => axios.post(url, body, opts));
  const resp = await post(
    `${OLLAMA_URL}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.4 },
      keep_alive: OLLAMA_KEEP_ALIVE,
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
