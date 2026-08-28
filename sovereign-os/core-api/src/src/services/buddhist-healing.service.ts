// src/services/buddhist-healing.service.ts
//
// Sovereign Buddhist Healing Module — ธรรมะบำบัดใจ + สมุนไพรคู่ยา + ติดตามผลการเยียวยา
// หลักการ: สมุนไพร/แพทย์ดูแลกาย, สติปัฏฐานดูแลใจ, อริยสัจเข้าใจเหตุ, อนัตตาปล่อยวาง
import { prisma } from '../lib/prisma';
import axios from 'axios';
import { getModelForTask } from './ai-router.service';

export { prisma };

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
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
  {
    name: 'กระเจี๊ยบแดง',
    uses: ['ขับปัสสาวะ', 'ลดความดัน', 'ลดไขมันในเลือด'],
    warnings: ['ระวังในผู้ความดันต่ำ', 'สตรีมีครรภ์ควรหลีกเลี่ยง'],
    interactions: [
      { med: 'ยาลดความดัน', severity: 'medium', note: 'กระเจี๊ยบแดงเสริมฤทธิ์ลดความดัน → เสี่ยงความดันต่ำ' },
      { med: 'ยาขับปัสสาวะ', severity: 'medium', note: 'กระเจี๊ยบแดงขับปัสสาวะอ่อนๆ อาจเสริมฤทธิ์ยา' },
      { med: 'hypotension', severity: 'medium', note: 'ห้ามใช้เมื่อมีความดันโลหิตต่ำ' },
    ],
  },
  {
    name: 'ขิง',
    uses: ['ช่วยย่อย', 'ลดคลื่นไส้', 'ขับลม', 'ต้านอักเสบ'],
    warnings: ['ระวังในผู้ใช้ยาละลายลิ่มเลือด', 'สตรีมีครรภ์ใช้ปริมาณน้อย'],
    interactions: [
      { med: 'Warfarin', severity: 'high', note: 'ขิงเสริมฤทธิ์ต้านการแข็งตัวของเลือด → เสี่ยงเลือดออก' },
      { med: 'anticoagulant', severity: 'high', note: 'ขิงเข้มข้นห้ามร่วมกับยาละลายลิ่มเลือด' },
      { med: 'ยาลดน้ำตาล', severity: 'medium', note: 'ขิงอาจเสริมฤทธิ์ลดน้ำตาล' },
    ],
  },
  {
    name: 'บัวบก',
    uses: ['สมานแผล', 'บำรุงสมอง', 'ลดบวม', 'ฟื้นฟูความอ่อนเพลีย'],
    warnings: ['ปลอดภัยในปริมาณปกติ', 'สตรีมีครรภ์ควรปรึกษาแพทย์'],
    interactions: [
      { med: 'ยากดภูมิคุ้มกัน', severity: 'medium', note: 'บัวบกอาจกระตุ้นภูมิ ขัดกับยากดภูมิ' },
      { med: 'ยาระงับประสาท', severity: 'info', note: 'บัวบกอาจเสริมฤทธิ์ง่วงเล็กน้อย' },
    ],
  },
  {
    name: 'ดอกคำฝอย',
    uses: ['บำรุงเลือด', 'ช่วยนอนหลับ', 'ลดไขมัน', 'บำรุงหัวใจ'],
    warnings: ['ห้ามใช้ในสตรีมีครรภ์', 'ระวังในผู้ใช้ยาละลายลิ่มเลือด'],
    interactions: [
      { med: 'Warfarin', severity: 'high', note: 'ดอกคำฝอยเสริมฤทธิ์ต้านการแข็งตัว → เสี่ยงเลือดออก' },
      { med: 'anticoagulant', severity: 'high', note: 'ดอกคำฝอยห้ามร่วมกับยาละลายลิ่มเลือด' },
      { med: 'pregnancy', severity: 'high', note: 'สตรีมีครรภ์ห้ามใช้ดอกคำฝอย' },
    ],
  },
  {
    name: 'กระเพรา',
    uses: ['แก้ท้องอืด', 'ลดน้ำตาล', 'ต้านอักเสบ', 'ขับลม'],
    warnings: ['ระวังในผู้ใช้ยาละลายลิ่มเลือด', 'สตรีมีครรภ์ควรหลีกเลี่ยงน้ำมันกระเพราเข้มข้น'],
    interactions: [
      { med: 'Warfarin', severity: 'medium', note: 'กระเพราอาจชะลอการแข็งตัวของเลือด' },
      { med: 'ยาลดน้ำตาล', severity: 'medium', note: 'กระเพราอาจเสริมฤทธิ์ลดน้ำตาล' },
      { med: 'anticoagulant', severity: 'medium', note: 'กระเพราเข้มข้นเสริมฤทธิ์ยาละลายลิ่มเลือด' },
    ],
  },
  {
    name: 'ตะไคร้',
    uses: ['ขับลม', 'ลดไข้', 'ขับปัสสาวะอ่อนๆ', 'ไล่แมลง'],
    warnings: ['ปลอดภัยในอาหารปกติ', 'น้ำมันเข้มข้นระวังในสตรีมีครรภ์'],
    interactions: [
      { med: 'ยาขับปัสสาวะ', severity: 'info', note: 'ตะไคร้ขับปัสสาวะอ่อนๆ อาจเสริมฤทธิ์ยา' },
      { med: 'ยาระงับประสาท', severity: 'info', note: 'ตะไคร้กลิ่นสงบ อาจเสริมง่วงเล็กน้อย' },
    ],
  },
  {
    name: 'ว่านหางจระเข้',
    uses: ['สมานแผลไฟไหม้', 'ช่วยขับถ่าย', 'บำรุงผิว', 'ลดการอักเสบ'],
    warnings: ['น้ำยางมีฤทธิ์ระบายแรง ห้ามใช้ต่อเนื่อง', 'สตรีมีครรภ์ควรหลีกเลี่ยงยางว่าน'],
    interactions: [
      { med: 'ยาระบาย', severity: 'medium', note: 'ว่านหางจระเข้เสริมฤทธิ์ระบาย → เสี่ยงท้องเสีย' },
      { med: 'ยาลดน้ำตาล', severity: 'medium', note: 'ว่านหางอาจลดน้ำตาล เสริมฤทธิ์ยาเบาหวาน' },
      { med: 'ยาขับปัสสาวะ', severity: 'medium', note: 'ใช้ร่วมกับยาขับปัสสาวะเสี่ยงโพแทสเซียมต่ำ' },
    ],
  },
  {
    name: 'รางจืด',
    uses: ['ถอนพิษ', 'ลดไข้', 'ต้านอักเสบ', 'ล้างสารพิษ'],
    warnings: ['ไม่ควรใช้ติดต่อกันเกิน 7 วัน', 'ระวังหักล้างฤทธิ์ยาอื่น กินห่างยาประจำ 2 ชม.'],
    interactions: [
      { med: 'ยาทั่วไป', severity: 'high', note: 'รางจืดเร่งขับยา อาจลดประสิทธิภาพยาประจำ' },
      { med: 'เคมีบำบัด', severity: 'high', note: 'รางจืดอาจลดฤทธิ์เคมีบำบัด — ต้องปรึกษาแพทย์ก่อนใช้' },
      { med: 'anticoagulant', severity: 'medium', note: 'รางจืดอาจรบกวนเมตาบอลิซึมของยา' },
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
  const resp = await axios.post(`${OLLAMA_URL}/api/generate`, { model: await getModelForTask('GENERAL_ASSISTANT', MODEL), prompt, stream: false, keep_alive: OLLAMA_KEEP_ALIVE }, { timeout: 180000 });
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
