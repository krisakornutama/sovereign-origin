// src/services/scenario-forecast.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Scenario Forecast — การคาดการณ์สถานการณ์ที่เป็นไปได้ (พร้อมโอกาสเกิด %)
//
// หลักการ: เอา "อดีต" (ข่าวเก่า + คำพยากรณ์ครั้งก่อน) กับ "ปัจจุบัน" (ข่าวล่าสุด +
// Threat Index + DEFCON) มาประเมินเทียบกับสถานการณ์โลกปัจจุบัน แล้วให้ Ollama
// สรุปรายการสถานการณ์ที่อาจเกิดขึ้นเป็นข้อ ๆ พร้อม % โอกาสเกิด ภายในกรอบเวลา
//
// ใช้ร่วมกันได้ทั้ง:
//   • AI Command Center (หน้า /ai) — สร้างสถานการณ์จากอดีต+ปัจจุบัน
//   • Risk Monitor (หน้า /risk-monitor) — เชื่อม Threat Index/DEFCON เข้าไป
//   • Predictive AI (หน้า /predictive) — มุ่งเน้นการเมือง/การปกครอง/สถานการณ์
//
// ถ้า Ollama ไม่ออนไลน์ → fallback แบบ deterministic จากค่า Threat Index
// (ไม่ตาย ไม่ปลอมข้อมูล — แสดงสถานะให้ UI ทราบ)
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import { prisma } from '../lib/prisma';

export { prisma };

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
const MODEL = process.env.RISK_MODEL || process.env.AI_MODEL || 'gemma3:4b';

export type ForecastFocus = 'general' | 'politics' | 'governance' | 'economy' | 'energy' | 'security' | 'climate';
export const FORECAST_FOCUSES: ForecastFocus[] = ['general', 'politics', 'governance', 'economy', 'energy', 'security', 'climate'];

export interface ForecastScenario {
  title: string;          // ชื่อสถานการณ์ (ภาษาไทย)
  category: ForecastFocus | string; // หมวด
  probability: number;    // โอกาสเกิด 0-100
  horizonDays: number;    // ภายในกี่วัน
  reasoning: string;      // เหตุผลสั้น ๆ
  impact: 'critical' | 'high' | 'medium' | 'low';
  mitigation: string;     // เตรียมตัวอย่างไร
}

export interface ScenarioForecastResult {
  generatedAt: string;
  focus: ForecastFocus;
  horizonDays: number;
  model: string;
  base: {
    threatOverall: number | null;
    categories: Record<string, number>;
    defcon: number | null;
    headlineCount: number;
    headlines: Array<{ title: string; category: string | null; published: string }>;
  };
  scenarios: ForecastScenario[];
  summary: string | null;
  source: 'ollama' | 'fallback' | 'empty';
  offline: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** ดึง JSON block แรกจากข้อความ (กัน Ollama พ่น markdown/prose ล้อมรอบ) */
function extractJson(raw: string): unknown {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** ตรวจว่ามีตัวอักษรภาษาไทยอย่างน้อย 2 ตัวหรือไม่ */
function containsThai(text: string): boolean {
  const thai = text.match(/[\u0E00-\u0E7F]/g);
  return !!thai && thai.length >= 2;
}

const FOCUS_LABEL: Record<ForecastFocus, string> = {
  general: 'ภาพรวมสถานการณ์โลก',
  politics: 'การเมือง',
  governance: 'การปกครอง / นโยบาย',
  economy: 'เศรษฐกิจ / การเงิน',
  energy: 'พลังงาน',
  security: 'ความมั่นคง / สงคราม',
  climate: 'สภาพอากาศ / ภัยธรรมชาติ',
};

const CATEGORY_ICON: Record<string, string> = {
  politics: '🏛️',
  governance: '📜',
  economy: '💰',
  energy: '⚡',
  security: '🛡️',
  climate: '🌪️',
  general: '🌍',
  war: '💥',
  banking: '🏦',
  inflation: '📈',
};

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

interface HeadlineRow {
  title: string;
  category: string | null;
  published: Date;
}

/** ดึงข่าว: ล่าสุด (ปัจจุบัน) + เก่า (อดีต) เพื่อให้ AI เปรียบเทียบได้ */
async function loadHeadlines(): Promise<{ recent: HeadlineRow[]; past: HeadlineRow[] }> {
  try {
    const rows = await prisma.riskHeadline.findMany({
      orderBy: { published: 'desc' },
      take: 60,
      select: { title: true, category: true, published: true },
    });
    // "ปัจจุบัน" = 24 ชม. ล่าสุด, "อดีต" = ก่อนหน้านั้น (ยกเว้นซ้ำกัน)
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return {
      recent: rows.filter((r) => new Date(r.published).getTime() >= cutoff).slice(0, 15),
      past: rows.filter((r) => new Date(r.published).getTime() < cutoff).slice(0, 15),
    };
  } catch (err) {
    console.error('🌍 Forecast: load headlines failed:', err instanceof Error ? err.message : err);
    return { recent: [], past: [] };
  }
}

async function loadThreatContext(): Promise<{ overall: number | null; categories: Record<string, number>; defcon: number | null }> {
  try {
    const latest = await prisma.threatIndex.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { overall: true, categories: true },
    });
    const categories =
      latest && typeof latest.categories === 'object'
        ? (latest.categories as Record<string, number>)
        : {};
    let defcon: number | null = null;
    if (latest) {
      const overall = Number(latest.overall);
      defcon = overall > 90 ? 1 : overall > 75 ? 2 : overall > 50 ? 3 : 5;
    }
    return { overall: latest ? Number(latest.overall) : null, categories, defcon };
  } catch (err) {
    console.error('🌍 Forecast: load threat context failed:', err instanceof Error ? err.message : err);
    return { overall: null, categories: {}, defcon: null };
  }
}

/** คำพยากรณ์ครั้งก่อน (อดีต) — ให้ AI เห็นว่ารอบที่แล้วคาดการณ์อะไรไว้ */
async function loadPreviousForecasts(limit = 3): Promise<Array<{ focus: string; generatedAt: Date; scenarios: ForecastScenario[]; summary: string | null }>> {
  try {
    const rows = await prisma.scenarioForecast.findMany({
      orderBy: { generatedAt: 'desc' },
      take: limit,
      select: { focus: true, generatedAt: true, scenarios: true, summary: true },
    });
    return rows.map((r) => ({
      focus: r.focus,
      generatedAt: r.generatedAt,
      scenarios: ((r.scenarios as unknown) as ForecastScenario[]) || [],
      summary: r.summary,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompt(params: {
  focus: ForecastFocus;
  horizonDays: number;
  recent: HeadlineRow[];
  past: HeadlineRow[];
  threat: { overall: number | null; categories: Record<string, number>; defcon: number | null };
  previous: Array<{ focus: string; generatedAt: Date; scenarios: ForecastScenario[]; summary: string | null }>;
}): string {
  const fmtList = (rows: HeadlineRow[]) =>
    rows.map((h, i) => `${i + 1}. ${h.title}${h.category ? ` [${h.category}]` : ''}`).join('\n');
  const prevTxt =
    params.previous.length === 0
      ? '(ยังไม่มีการคาดการณ์ครั้งก่อน)'
      : params.previous
          .map(
            (p) =>
              `— ${new Date(p.generatedAt).toISOString().slice(0, 10)} (${p.focus}): ${
                p.scenarios.length
                  ? p.scenarios
                      .slice(0, 5)
                      .map((s) => `${s.title} (${s.probability}%)`)
                      .join(', ')
                  : 'ไม่มี'
              }`
          )
          .join('\n');

  return `You are the geopolitical and societal scenario analyst of an off-grid sovereign household system.
Your job: turn PAST + PRESENT information into a ranked list of POSSIBLE future scenarios, evaluated against the CURRENT world situation.
CRITICAL INSTRUCTION: Your entire answer must be written in Thai (ภาษาไทย). English allowed only for proper nouns.
Do NOT be alarmist — be calibrated, evidence-based, and practical.

Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "summary": "<สรุปภาพรวม 1-2 ประโยค เป็นภาษาไทย>",
  "scenarios": [
    {
      "title": "<ชื่อสถานการณ์>",
      "category": "<politics|governance|economy|energy|security|climate>",
      "probability": <0-100 จำนวนเต็ม>,
      "horizonDays": <ภายในกี่วัน>,
      "reasoning": "<เหตุผลสั้น ๆ อ้างอิงข่าว/ข้อมูล 1-2 ประโยค>",
      "impact": "<critical|high|medium|low>",
      "mitigation": "<ครอบครัว/บ้านนี้ควรเตรียมตัวอย่างไร สั้น ๆ>"
    }
  ]
}
Rules:
- 5-10 scenarios, ordered by probability descending.
- Probabilities must sum to a plausible distribution — they are INDEPENDENT event probabilities, keep them realistic (0-100).
- ${FOCUS_LABEL[params.focus]} is the main focus — include at least 4 scenarios on that focus, plus 1-2 adjacent ones.
- horizonDays must be ≤ ${params.horizonDays} days.
- Base every reasoning on the headlines and threat data given below. NEVER invent facts not present in the data.

━━━ ข้อมูล ━━━

## สถานการณ์ปัจจุบัน (ข่าวล่าสุด 24 ชม.)
${fmtList(params.recent) || '(ไม่มีข่าวใหม่ — ใช้ข่าวเก่าและข้อมูลความเสี่ยง)'}

## สถานการณ์ในอดีต (ข่าวเก่ากว่า 24 ชม. — ใช้เป็นบทเรียน/แนวโน้ม)
${fmtList(params.past) || '(ไม่มีข่าวเก่าในฐาน)'}

## ความเสี่ยงปัจจุบัน (Threat Index จากระบบ)
Overall: ${params.threat.overall ?? 'ไม่มีข้อมูล'} / 100
Categories: ${JSON.stringify(params.threat.categories)}
DEFCON level: ${params.threat.defcon ?? 'ไม่มีข้อมูล'}

## คำพยากรณ์ครั้งก่อน (อดีต — ใช้เปรียบเทียบแนวโน้ม)
${prevTxt}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser — แปลงคำตอบ Ollama → scenarios
// ─────────────────────────────────────────────────────────────────────────────

const VALID_IMPACTS = ['critical', 'high', 'medium', 'low'];
const VALID_CATEGORIES = ['politics', 'governance', 'economy', 'energy', 'security', 'climate', 'war', 'banking', 'inflation', 'general'];

export function parseForecastResponse(raw: string, focus: ForecastFocus, horizonDays: number): { summary: string | null; scenarios: ForecastScenario[] } | null {
  const data = extractJson(raw);
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const rawScenarios = Array.isArray(obj.scenarios) ? obj.scenarios : [];

  const scenarios: ForecastScenario[] = [];
  for (const s of rawScenarios.slice(0, 12)) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    const probability = clamp(Number(o.probability));
    let horizon = Math.floor(Number(o.horizonDays));
    if (!Number.isFinite(horizon) || horizon <= 0) horizon = horizonDays;
    horizon = Math.min(horizon, horizonDays);
    const categoryRaw = typeof o.category === 'string' ? o.category.toLowerCase() : focus;
    const category = VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : focus;
    const impactRaw = typeof o.impact === 'string' ? o.impact.toLowerCase() : 'medium';
    scenarios.push({
      title,
      category,
      probability,
      horizonDays: horizon,
      reasoning: typeof o.reasoning === 'string' ? o.reasoning.trim() : '',
      impact: (VALID_IMPACTS.includes(impactRaw) ? impactRaw : 'medium') as ForecastScenario['impact'],
      mitigation: typeof o.mitigation === 'string' ? o.mitigation.trim() : '',
    });
  }

  if (scenarios.length === 0) return null;
  scenarios.sort((a, b) => b.probability - a.probability);
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : null,
    scenarios,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback — Ollama ออฟไลน์: สร้างจาก Threat Index แบบ deterministic (ไม่ปลอม)
// ─────────────────────────────────────────────────────────────────────────────

function buildFallback(params: {
  focus: ForecastFocus;
  horizonDays: number;
  threat: { overall: number | null; categories: Record<string, number> };
}): ScenarioForecastResult['scenarios'] {
  const t = params.threat;
  const out: ForecastScenario[] = [];
  const push = (category: string, title: string, probability: number, reasoning: string, impact: ForecastScenario['impact'], mitigation: string) => {
    out.push({
      title,
      category,
      probability: clamp(probability),
      horizonDays: params.horizonDays,
      reasoning,
      impact,
      mitigation,
    });
  };

  // ใช้ค่า Threat Index จริง (ไม่มี → 50/30 พื้นฐานแบบกลาง ๆ)
  const overall = t.overall ?? 50;
  const cat = (k: string) => t.categories?.[k] ?? (t.overall != null ? Math.round((t.overall * 2) / 3) : 40);

  if (params.focus === 'politics' || params.focus === 'general') {
    push('politics', 'ความตึงเครียดทางการเมืองระหว่างประเทศเพิ่มขึ้น', cat('war') * 0.6, `จากระดับความเสี่ยงสงคราม ${cat('war')} และข่าวความขัดแย้งล่าสุด`, 'medium', 'ติดตามข่าว 2-3 แหล่ง เช็กแนวทางอพยพ/ติดต่อญาติ');
    push('politics', 'นโยบายแทรกแซงการค้า/มาตรการกีดกันเพิ่มขึ้น', cat('inflation') * 0.7, 'จากแนวโน้มเงินเฟ้อและมาตรการกีดกันการค้า', 'medium', 'กระจายแหล่งซื้อของจำเป็น สำรองเสบียงพื้นฐาน');
  }
  if (params.focus === 'governance' || params.focus === 'general') {
    push('governance', 'กฎระเบียบ/ข้อจำกัดใหม่กระทบการเงินส่วนบุคคล', Math.min(80, cat('banking') * 0.8 + 10), 'จากวิกฤตธนาคาร/การเงินที่ยังเปราะ', 'low', 'รักษาเงินสดสำรอง + กระจายสินทรัพย์หลายรูปแบบ');
    push('governance', 'การเลือกตั้ง/การเปลี่ยนรัฐบาลในประเทศสำคัญ ๆ เปลี่ยนทิศนโยบาย', Math.min(70, overall * 0.5 + 20), 'จากกำหนดการเลือกตั้งและความไม่แน่นอนเชิงนโยบาย', 'medium', 'ติดตามกำหนดการสำคัญ ห้ามตัดสินใจลงทุนก้อนใหญ่ระยะสั้น');
  }
  if (params.focus === 'economy' || params.focus === 'general') {
    push('economy', 'เงินเฟ้อ/ค่าครองชีพสูงขึ้นต่อเนื่อง', cat('inflation'), `ค่าเงินเฟ้อปัจจุบันสูงที่ ${cat('inflation')}/100`, 'high', 'ตรึงค่าใช้จ่ายรายเดือน ใช้ของใกล้หมดอายุก่อน ซื้อของจำเป็นล่วงหน้า');
    push('economy', 'ความผันผวนของตลาดการเงิน/สินทรัพย์ดิจิทัล', Math.min(80, cat('banking') * 0.9), 'จากความเปราะของระบบธนาคาร', 'medium', 'ไม่ย้ายพอร์ตบ่อย ตั้งจุดตัดขาดทุนอัตโนมัติ');
  }
  if (params.focus === 'energy' || params.focus === 'general') {
    push('energy', 'ราคาพลังงาน/ไฟฟ้าขยับขึ้น', cat('energy'), `ความเสี่ยงพลังงาน ${cat('energy')}/100`, 'high', 'สำรองแบตเตอรี่เต็ม ใช้พลังงานอย่างมีประสิทธิภาพ ตรวจสำรองเชื้อเพลิง');
  }
  if (params.focus === 'security' || params.focus === 'general') {
    push('security', 'ภัยคุกคามทางไซเบอร์/ฟิชชิ่งเพิ่มขึ้น', Math.min(85, cat('war') * 0.7 + 15), 'จากระดับความขัดแย้งโลกที่สูงขึ้น', 'high', 'อัปเดตระบบรักษาความปลอดภัย ระวังอีเมล/ลิงก์แปลกปลอม');
    push('security', 'ความขัดแย้ง/ทหารในภูมิภาคยกระดับ', cat('war'), `ความเสี่ยงสงคราม ${cat('war')}/100`, 'critical', 'เตรียมชุดยังชีพ + แผนติดต่อฉุกเฉิน + เอกสารสำคัญไว้ในที่ปลอดภัย');
  }
  if (params.focus === 'climate' || params.focus === 'general') {
    push('climate', 'ภัยธรรมชาติ (น้ำท่วม/แล้ง/พายุ) ถี่ขึ้น', Math.min(75, overall * 0.6 + 20), 'จากแนวโน้มสภาพอากาศแปรปรวน', 'high', 'เช็กระดับน้ำ สำรองน้ำดื่ม เตรียมไฟฉาย/วิทยุ');
  }

  // fallback เสมอมีขั้นต่ำ 3 ข้อ
  while (out.length < 3) {
    push('general', 'สถานการณ์โลกยังผันผวน — เฝ้าระวังอย่างต่อเนื่อง', 55, 'จากข้อมูลจำกัด ระบบแนะนำเฝ้าระวัง', 'medium', 'ติดตามข่าวและดึงข้อมูลวิเคราะห์เป็นประจำ');
  }
  return out.slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main — generate scenarios
// ─────────────────────────────────────────────────────────────────────────────

async function isOllamaOnline(): Promise<boolean> {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function generateScenarios(params: {
  focus?: ForecastFocus;
  horizonDays?: number;
} = {}): Promise<ScenarioForecastResult> {
  const focus: ForecastFocus = params.focus && FORECAST_FOCUSES.includes(params.focus) ? params.focus : 'general';
  const horizonDays = Math.min(Math.max(Math.floor(params.horizonDays || 90), 7), 365);

  const [headlines, threat, previous] = await Promise.all([
    loadHeadlines(),
    loadThreatContext(),
    loadPreviousForecasts(3),
  ]);

  const base = {
    threatOverall: threat.overall,
    categories: threat.categories,
    defcon: threat.defcon,
    headlineCount: headlines.recent.length + headlines.past.length,
    headlines: [...headlines.recent, ...headlines.past].map((h) => ({
      title: h.title,
      category: h.category,
      published: new Date(h.published).toISOString(),
    })),
  };

  const result: ScenarioForecastResult = {
    generatedAt: new Date().toISOString(),
    focus,
    horizonDays,
    model: MODEL,
    base,
    scenarios: [],
    summary: null,
    source: 'empty',
    offline: false,
  };

  // ถ้าไม่มีข่าวเลย + ไม่มี threat → ยังให้ fallback ใช้ได้ (บอก UI ว่า data น้อย)
  if (headlines.recent.length === 0 && headlines.past.length === 0 && threat.overall == null) {
    result.scenarios = buildFallback({ focus, horizonDays, threat });
    result.summary = '⚠️ ยังไม่มีข้อมูลข่าวหรือ Threat Index ในระบบ — แสดงการคาดการณ์แบบคร่าว ๆ จากข้อมูลพื้นฐาน โปรดเปิด Risk Monitor แล้วกด "ดึงข่าว + วิเคราะห์" ก่อน';
    result.source = 'fallback';
    result.offline = true;
    await persistForecast(result);
    return result;
  }

  // Ollama ออฟไลน์ → fallback
  if (!(await isOllamaOnline())) {
    result.scenarios = buildFallback({ focus, horizonDays, threat });
    result.summary = '⚠️ Ollama ออฟไลน์ — แสดงการคาดการณ์แบบคร่าว ๆ จาก Threat Index (ไม่ใช้ AI) เปิด Ollama แล้วลองใหม่เพื่อผลวิเคราะห์เต็ม';
    result.source = 'fallback';
    result.offline = true;
    await persistForecast(result);
    return result;
  }

  try {
    const prompt = buildPrompt({ focus, horizonDays, recent: headlines.recent, past: headlines.past, threat, previous });
    const res = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model: MODEL, prompt, stream: false, options: { temperature: 0.2 }, keep_alive: OLLAMA_KEEP_ALIVE },
      { timeout: 180000 }
    );
    const parsed = parseForecastResponse(res.data?.response || '', focus, horizonDays);
    if (parsed && parsed.scenarios.length > 0) {
      result.scenarios = parsed.scenarios;
      result.summary = parsed.summary;
      result.source = 'ollama';
      await persistForecast(result);
      return result;
    }
  } catch (err) {
    console.error('🌍 Forecast: Ollama failed:', err instanceof Error ? err.message : err);
  }

  // Ollama ตอบแต่ parse ไม่ได้ → fallback
  result.scenarios = buildFallback({ focus, horizonDays, threat });
  result.summary = result.summary || '⚠️ AI ตอบไม่เป็นรูปแบบที่อ่านได้ — แสดงการคาดการณ์คร่าว ๆ จาก Threat Index แทน';
  result.source = 'fallback';
  result.offline = false;
  await persistForecast(result);
  return result;
}

/** บันทึกผลการคาดการณ์ลงฐาน (ประวัติ = "อดีต" สำหรับรอบถัดไป) */
async function persistForecast(result: ScenarioForecastResult): Promise<void> {
  try {
    await prisma.scenarioForecast.create({
      data: {
        focus: result.focus,
        horizonDays: result.horizonDays,
        model: result.model,
        base: result.base as object,
        scenarios: result.scenarios as object,
        summary: result.summary,
        generatedAt: new Date(result.generatedAt),
      },
    });
  } catch (err) {
    console.error('🌍 Forecast: persist failed:', err instanceof Error ? err.message : err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// History / latest
// ─────────────────────────────────────────────────────────────────────────────

export async function forecastHistory(limit = 20): Promise<Array<Record<string, unknown>>> {
  const rows = await prisma.scenarioForecast.findMany({
    orderBy: { generatedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    focus: r.focus,
    horizonDays: r.horizonDays,
    model: r.model,
    summary: r.summary,
    generatedAt: r.generatedAt,
    base: r.base,
    scenarios: r.scenarios,
  }));
}

export async function latestForecast(): Promise<Record<string, unknown> | null> {
  const row = await prisma.scenarioForecast.findFirst({ orderBy: { generatedAt: 'desc' } });
  if (!row) return null;
  return {
    id: row.id,
    focus: row.focus,
    horizonDays: row.horizonDays,
    model: row.model,
    summary: row.summary,
    generatedAt: row.generatedAt,
    base: row.base,
    scenarios: row.scenarios,
  };
}

export const CATEGORY_ICONS = CATEGORY_ICON;
