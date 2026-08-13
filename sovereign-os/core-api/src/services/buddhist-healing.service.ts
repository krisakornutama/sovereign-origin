// src/services/buddhist-healing.service.ts
//
// Sovereign Buddhist Healing Module — ธรรมะบำบัดใจ + สมุนไพรคู่ยา + ติดตามผลการเยียวยา
// หลักการ: สมุนไพร/แพทย์ดูแลกาย, สติปัฏฐานดูแลใจ, อริยสัจเข้าใจเหตุ, อนัตตาปล่อยวาง
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.DHAMMA_MODEL || process.env.OLLAMA_MODEL || 'qwen3:8b';

// ── ฐานข้อมูลสมุนไพรไทย (คู่กับยาแผนปัจจุบัน) ──
export interface HerbInteraction {
  med: string;
  severity: 'high' | 'medium' | 'info';
  note: string;
}
export interface HerbProfile {
  name: string;
  uses: string[];
  warnings: string[];
  interactions: HerbInteraction[];
}

export const HERB_DB: HerbProfile[] = [
  {
    name: 'ฟ้าทะลายโจร',
    uses: ['ลดไข้', 'ต้านอักเสบ', 'บรรเทาอาการหวัด'],
    warnings: ['ห้ามใช้กับยาละลายลิ่มเลือด (Warfarin)', 'ไม่ควรใช้ติดต่อกันเกิน 7 วัน', 'สตรีมีครรภ์ควรหลีกเลี่ยง'],
    interactions: [
      { med: 'Warfarin', severity: 'high', note: 'ฟ้าทะลายโจรเสริมฤทธิ์ต้านการแข็งตัวของเลือด → เสี่ยงเลือดออก' },
      { med: 'ยากดภูมิคุ้มกัน', severity: 'medium', note: 'อาจรบกวนการทำงานของยากดภูมิ' },
    ],
  },
  {
    name: 'ขมิ้นชัน',
    uses: ['ลดการอักเสบ', 'ปกป้องตับ', 'ช่วยระบบย่อยอาหาร'],
    warnings: ['ปรึกษาแพทย์ก่อนใช้ร่วมกับเคมีบำบัด', 'ระวังในผู้ที่มีนิ่วในถุงน้ำดี'],
    interactions: [
      { med: 'เคมีบำบัด (เช่น Doxorubicin)', severity: 'high', note: 'ขมิ้นชันอาจรบกวนผลการรักษา — ต้องปรึกษาแพทย์ก่อนใช้' },
      { med: 'ยาละลายลิ่มเลือด', severity: 'medium', note: 'ขมิ้นชันมีฤทธิ์ต้านการแข็งตัวของเลือดเล็กน้อย' },
    ],
  },
  {
    name: 'มะขามป้อม',
    uses: ['วิตามินซีสูง', 'กระตุ้นภูมิคุ้มกัน', 'ต้านอนุมูลอิสระ'],
    warnings: ['ปลอดภัยในปริมาณปกติ'],
    interactions: [],
  },
  {
    name: 'เห็ดหลินจือ',
    uses: ['กระตุ้น NK Cells', 'ปรับภูมิคุ้มกัน', 'ช่วยการนอนหลับ'],
    warnings: ['อาจมีผลต่อการแข็งตัวของเลือด', 'ผู้ที่เตรียมผ่าตัดควรหยุดก่อน 2 สัปดาห์'],
    interactions: [
      { med: 'ยาละลายลิ่มเลือด', severity: 'high', note: 'หลินจืออาจเสริมฤทธิ์กันเลือดแข็งตัวช้า → เสี่ยงเลือดออก' },
      { med: 'ยากดภูมิคุ้มกัน', severity: 'medium', note: 'หลินจือกระตุ้นภูมิคุ้มกัน อาจขัดกับยากดภูมิ' },
    ],
  },
];

/** ตรวจสมุนไพรกับยาที่ผู้ใช้ทาน — คืนรายการที่ขัดกัน + คำเตือน */
export function checkHerbWithMeds(herbName: string, medsInput: string[]): { safe: boolean; conflicts: HerbInteraction[]; note: string; herb: HerbProfile | null } {
  // ชื่อว่าง/เว้นวรรค → ถือว่าไม่พบ (กัน h.name.includes('') ที่ match กับทุกสมุนไพร)
  const name = String(herbName ?? '').trim();
  const herb = name ? HERB_DB.find((h) => h.name === name || h.name.includes(name)) ?? null : null;
  if (!herb) {
    return { safe: true, conflicts: [], note: 'ไม่พบข้อมูลสมุนไพรนี้ในฐาน — ควรปรึกษาแพทย์ก่อนใช้', herb: null };
  }
  // ตัดช่องว่าง/รายการว่าง (เช่น "A," หรือ "," → ไม่ให้ชน false positive กับทุก interaction)
  const meds = (Array.isArray(medsInput) ? medsInput : []).map((m) => String(m ?? '').trim()).filter(Boolean);
  const conflicts = herb.interactions.filter((i) =>
    meds.some((m) => i.med.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(i.med.split(' ')[0].toLowerCase()))
  );
  return {
    safe: conflicts.length === 0,
    conflicts,
    note: conflicts.length === 0
      ? `✅ ${herb.name} ไม่พบข้อขัดแย้งกับยาที่ระบุ — แต่ยังควรใช้เป็นยาเสริม ไม่ใช่ยาหลัก`
      : `⚠️ ${herb.name} ขัดกับยาที่ทานอยู่ — ปรึกษาแพทย์ก่อนใช้เสมอ`,
    herb,
  };
}

// ── Healing Tracker — คำนวณความคืบหน้า (ก่อน vs หลัง) ──

export interface HealingLogRow {
  metric: string;
  value: number;
  logged_at: Date | string;
}

// เมตริกที่ "ลดลง = ดีขึ้น" (เช่น ความเครียด) — ส่วนที่เหลือเพิ่มขึ้น = ดีขึ้น
const LOWER_IS_BETTER = new Set(['stress', 'pain', 'anxiety', 'heart_rate']);

export function computeHealingProgress(logs: HealingLogRow[]): Array<{ metric: string; before: number; after: number; delta: number; improving: boolean; samples: number }> {
  const byMetric = new Map<string, Array<{ value: number; t: number }>>();
  for (const l of logs) {
    const arr = byMetric.get(l.metric) || [];
    arr.push({ value: Number(l.value), t: new Date(l.logged_at).getTime() });
    byMetric.set(l.metric, arr);
  }
  const out: Array<{ metric: string; before: number; after: number; delta: number; improving: boolean; samples: number }> = [];
  for (const [metric, points] of byMetric) {
    points.sort((a, b) => a.t - b.t);
    if (points.length === 0) continue;
    const before = points[0].value;
    const after = points[points.length - 1].value;
    const delta = Math.round((after - before) * 100) / 100;
    const improving = LOWER_IS_BETTER.has(metric) ? delta < 0 : delta > 0;
    out.push({ metric, before, after, delta, improving, samples: points.length });
  }
  return out;
}

// ── AI Dhamma Companion — ใช้พุทธวจนะที่ค้นได้ตอบปลอบใจ ──

export interface TeachingRef {
  title: string;
  content: string;
  application?: string | null;
}

export function buildDhammaPrompt(userMessage: string, teaching: TeachingRef | null): string {
  const ref = teaching
    ? `หลักธรรมที่เกี่ยวข้อง:\n- ${teaching.title}\n- ${teaching.content}\n- การประยุกต์: ${teaching.application || '—'}`
    : 'หลักธรรมที่เกี่ยวข้อง: (ไม่มีหลักธรรมตรง — ใช้หลักอนิจจัง/ทุกขัง/อนัตตา ปลอบโยนอย่างอ่อนโยน)';
  return (
    'คุณคือพระอาจารย์ผู้ปลอบโยนจิตใจ (AI Dhamma Companion) พูดภาษาไทย ใจเย็น อ่อนโยน ให้กำลังใจ ใช้พุทธวจนะประกอบ\n' +
    'หลักการ: สมุนไพร/แพทย์รักษากาย — เรารักษาใจ อย่าแนะนำให้เลิกยาเด็ดขาด\n' +
    `${ref}\n\n` +
    `ผู้ใช้พูดว่า: "${String(userMessage).slice(0, 500)}"\n\n` +
    'ตอบสั้น 3-5 ประโยค อบอุ่น มีคำแนะนำการปฏิบัติ (เช่น หายใจเข้าออก รู้ลมหายใจ, เห็นเวทนาเป็นแค่คลื่นที่มาแล้วไป)'
  );
}

export function parseDhammaReply(raw: string): string {
  let t = String(raw ?? '').trim();
  const fenced = t.match(/```(?:text|markdown)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  return t.slice(0, 3000);
}

/** บทสนทนา: ค้นหลักธรรมที่ตรง → ส่งให้ Ollama ปลอบใจ */
export async function dhammaCompanion(userMessage: string): Promise<{ reply: string; teaching: TeachingRef | null }> {
  const teachings = await prisma.buddhistTeaching.findMany({ take: 100 });
  // เลือกหลักธรรมที่เกี่ยวข้อง (จับคู่คำสำคัญ)
  const text = String(userMessage).toLowerCase();
  const match = (keywords: string[]) => keywords.some((k) => text.includes(k));
  const teaching =
    teachings.find((t) => match((t.category_tags as string[] | null) || [])) ||
    teachings.find((t) => match([t.category])) ||
    teachings[0] ||
    null;
  const prompt = buildDhammaPrompt(userMessage, teaching);
  const resp = await axios.post(`${OLLAMA_URL}/api/generate`, { model: MODEL, prompt, stream: false }, { timeout: 180000 });
  return { reply: parseDhammaReply(resp.data?.response ?? ''), teaching };
}

/** เริ่ม/จบสมาธิ — บันทึก session */
export async function logMeditationSession(input: { type?: string; duration_min: number; note?: string }): Promise<{ id: string }> {
  const item = await prisma.meditationSession.create({
    data: {
      type: String(input.type || 'หายใจ').slice(0, 60),
      duration_min: Math.max(1, Math.floor(Number(input.duration_min) || 5)),
      note: input.note ? String(input.note).trim().slice(0, 300) : null,
    },
  });
  return { id: item.id };
}

export async function logHealingMetric(input: { metric: string; value: number; note?: string }): Promise<{ id: string }> {
  const item = await prisma.healingLog.create({
    data: {
      metric: String(input.metric).trim().slice(0, 40),
      value: Number(input.value) || 0,
      note: input.note ? String(input.note).trim().slice(0, 300) : null,
    },
  });
  return { id: item.id };
}
