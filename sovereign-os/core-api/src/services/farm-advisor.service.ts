// src/services/farm-advisor.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// เฟส 3 — แนะนำการปลูก + คาดการณ์ผลผลิต ต่อแปลง
// กฎเหล็ก: heuristic deterministic ต้องตอบได้เสมอ (ไม่มีเงื่อนไขไหนพึ่ง LLM ล้วน ๆ)
// Ollama เป็นตัวเพิ่มคุณภาพเมื่อพร้อมเท่านั้น — timeout + fallback กลับ heuristic เสมอ
// แหล่งที่มาชัดเจนทุกคำตอบ: source: 'heuristic' | 'ollama' — ไม่หลอกผู้ใช้
// ─────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { CROP_IDEALS, analyzeSoil } from './farm-soil.service';
import { OLLAMA_URL, MODEL, OLLAMA_KEEP_ALIVE } from './advisor.service';
import { getModelForTask } from './ai-router.service';

export const FARM_ADVISOR_TIMEOUT_MS = parseInt(process.env.FARM_ADVISOR_TIMEOUT_MS || '20000', 10) || 20000;

/** ผลผลิตพื้นฐานต่อตารางเมตร (กก./ตร.ม.) — ค่าประมาณเกษตรไทย ใช้เมื่อยังไม่มีประวัติเก็บเกี่ยวจริง */
export const YIELD_BASELINE: Record<string, number> = {
  ทุเรียน: 0.35, ข้าว: 0.65, มะเขือเทศ: 3.0, ผักสลัด: 2.5, กล้วย: 4.0, อ้อย: 7.0, มะนาว: 1.5, พริก: 1.5,
  ฟ้าทะลายโจร: 0.4, ขมิ้นชัน: 0.8, กระเจี๊ยบแดง: 0.4, ขิง: 0.8, บัวบก: 0.5, มะขามป้อม: 0.3,
  ดอกคำฝอย: 0.4, กระเพรา: 0.6, ตะไคร้: 1.2, ว่านหางจระเข้: 1.0,
};
const DEFAULT_BASELINE = 1.0;

export interface AdvisorRecommendation {
  crop: string;
  score: number; // 0-100 จาก analyzeSoil (ความเหมาะสมของดิน) — ไม่มีค่าดิน = 50 กลาง
  expectedKg: number; // คาดการณ์ผลผลิตทั้งแปลง
  perSqmKg: number; // กก./ตร.ม. ที่ใช้คำนวณ
  basis: 'history' | 'global-history' | 'estimate'; // ที่มาของ perSqmKg
  boosted: boolean; // เคยเก็บเกี่ยวพืชนี้ในแปลงนี้ได้ผลจริง (+5 คะแนน)
  reasons: string[];
}

export interface HarvestHistory {
  lots: number;
  totalKg: number;
  perSqmKg: number | null;
  crops: string[];
}

export interface PlotAdvisorResult {
  plotId: string;
  plotName: string;
  currentCrop: string | null;
  areaSqm: number | null;
  hasSoilData: boolean;
  harvestHistory: HarvestHistory;
  recommendations: AdvisorRecommendation[];
  forecast: {
    crop: string;
    perSqmKg: number;
    expectedKg: number;
    basis: AdvisorRecommendation['basis'];
  } | null; // คาดการณ์พืชที่ปลูกอยู่ (หรือพืชที่แนะนำอันดับ 1 ถ้ายังไม่ปลูก)
  source: 'heuristic';
  generatedAt: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ประวัติเก็บเกี่ยวของแปลง (จาก ProductLot ที่ผูก plotId) + ตาราง area ของทุกแปลง */
async function loadHistory(plotId: string) {
  const [lots, allPlots] = await Promise.all([
    prisma.productLot.findMany({ where: { plotId } }),
    prisma.farmPlot.findMany({ select: { id: true, area_sqm: true } }),
  ]);
  const areaById = new Map(allPlots.map((p: any) => [p.id, p.area_sqm ?? null]));
  return { lots, areaById };
}

/** กก./ตร.ม. เฉลี่ยของพืช จากล็อตทั้งระบบที่รู้พื้นที่แปลง (global-history) */
function globalPerSqm(crop: string, allLots: any[], areaById: Map<string, number | null>): number | null {
  const rates: number[] = [];
  for (const lot of allLots) {
    if (lot.crop !== crop || lot.quantityKg == null) continue;
    const area = areaById.get(lot.plotId);
    if (!area || area <= 0) continue;
    rates.push(lot.quantityKg / area);
  }
  if (rates.length === 0) return null;
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

/** คะแนนความเหมาะสมของดินต่อพืช — ใช้ analyzeSoil เดิม (deterministic) */
function soilScore(latest: any, crop: string): number | null {
  if (!latest) return null;
  return analyzeSoil(latest, crop).score;
}

/** แนะนำการปลูก + คาดการณ์ผลผลิตของแปลง — heuristic ล้วน ตอบได้เสมอ */
export async function computePlotAdvisor(plotId: string, topN = 3): Promise<PlotAdvisorResult> {
  const plot: any = await prisma.farmPlot.findUnique({ where: { id: plotId } });
  if (!plot) throw new Error('Plot not found');
  const [latest, { lots, areaById }, allLots] = await Promise.all([
    prisma.farmSoilReading.findFirst({ where: { plot_id: plotId }, orderBy: { recorded_at: 'desc' } }),
    loadHistory(plotId),
    prisma.productLot.findMany(),
  ]);

  // ประวัติของแปลงนี้ — รวมกก./ตร.ม. ต่อพืช (พื้นที่แปลงตัวเอง)
  const perSqmByCrop = new Map<string, number>();
  for (const lot of lots) {
    if (!lot.crop || lot.quantityKg == null) continue;
    const area = plot.area_sqm;
    if (!area || area <= 0) continue;
    const k = lot.crop;
    perSqmByCrop.set(k, ((perSqmByCrop.get(k) ?? 0) + lot.quantityKg) / 1); // สะสมด้านล่าง
  }
  // คำนวณเฉลี่ยจริงต่อพืช (รวมกก. / พื้นที่) — แปลงเดียว พื้นที่เดียว เฉลี่ย = รวม/พื้นที่
  const totalKgByCrop = new Map<string, number>();
  for (const lot of lots) {
    if (!lot.crop || lot.quantityKg == null) continue;
    totalKgByCrop.set(lot.crop, (totalKgByCrop.get(lot.crop) ?? 0) + lot.quantityKg);
  }
  perSqmByCrop.clear();
  for (const [crop, kg] of totalKgByCrop) {
    if (plot.area_sqm && plot.area_sqm > 0) perSqmByCrop.set(crop, kg / plot.area_sqm);
  }

  const historyCrops = [...totalKgByCrop.keys()];
  const area = plot.area_sqm && plot.area_sqm > 0 ? plot.area_sqm : null;

  const crops = Object.keys(CROP_IDEALS);
  const recommendations: AdvisorRecommendation[] = crops.map((crop) => {
    const score0 = soilScore(latest, crop);
    const hasSoil = score0 != null;
    const boosted = totalKgByCrop.has(crop);
    const score = Math.min(100, (score0 ?? 50) + (boosted ? 5 : 0));

    // กก./ตร.ม.: ประวัติแปลงนี้ → ประวัติทั้งระบบ → ค่าประมาณ
    let perSqm = perSqmByCrop.get(crop) ?? null;
    let basis: AdvisorRecommendation['basis'] = 'history';
    if (perSqm == null) {
      const g = globalPerSqm(crop, allLots, areaById);
      if (g != null) {
        perSqm = g;
        basis = 'global-history';
      }
    }
    if (perSqm == null) {
      perSqm = YIELD_BASELINE[crop] ?? DEFAULT_BASELINE;
      basis = 'estimate';
    }
    const expectedKg = area != null ? r2(perSqm * area) : r2(perSqm); // ไม่รู้พื้นที่ = รายพื้นที่ 1 ตร.ม. (แสดง per-sqm แทน)

    const reasons: string[] = [];
    if (!hasSoil) reasons.push('ยังไม่มีค่าดินล่าสุด — คะแนนเริ่มกลาง (50) บันทึกค่าดินเพื่อจัดอันดับแม่นขึ้น');
    else if (score0! >= 85) reasons.push(`ดินเหมาะกับ${crop}มาก (คะแนนดิน ${score0}/100)`);
    else if (score0! >= 60) reasons.push(`ดินรองรับได้ (คะแนนดิน ${score0}/100) — ดูจุดปรับในผลวิเคราะห์ดิน`);
    else reasons.push(`ดินยังไม่เหมาะ (คะแนนดิน ${score0}/100) — ควรปรับดินตามแผนบำรุงก่อนปลูก`);
    if (boosted) reasons.push(`เคยเก็บเกี่ยว${crop}ในแปลงนี้จริง ${r2(totalKgByCrop.get(crop)!)} กก. (+5 คะแนนความมั่นใจ)`);
    reasons.push(
      basis === 'history' ? `คาดผลผลิตจากประวัติจริงของแปลง (${r2(perSqm)} กก./ตร.ม.)`
      : basis === 'global-history' ? `คาดผลผลิตจากประวัติแปลงอื่นที่ปลูก${crop} (${r2(perSqm)} กก./ตร.ม.)`
      : `คาดผลผลิตจากค่าประมาณเกษตรไทย (${r2(perSqm)} กก./ตร.ม.)`
    );

    return { crop, score, expectedKg, perSqmKg: r2(perSqm), basis, boosted, reasons };
  });

  // จัดอันดับ: พืชที่มีหลักฐานจริง (ประวัติแปลงตัวเอง → แปลงอื่น) มาก่อนพืชคาดเดาล้วน
  // จากนั้นเรียงคะแนนดิน, พืชที่เคยปลูกได้ผล, และผลผลิตคาดการณ์
  const evidenceRank = (r: AdvisorRecommendation) => (r.basis === 'history' ? 0 : r.basis === 'global-history' ? 1 : 2);
  recommendations.sort(
    (a, b) =>
      evidenceRank(a) - evidenceRank(b) ||
      b.score - a.score ||
      Number(b.boosted) - Number(a.boosted) ||
      b.expectedKg - a.expectedKg
  );

  // คาดการณ์พืชที่ปลูกอยู่ — ถ้าไม่มี ใช้พืชอันดับ 1
  const forecastCrop = plot.crop ?? recommendations[0]?.crop ?? null;
  const forecastRec = forecastCrop ? recommendations.find((r) => r.crop === forecastCrop) ?? null : null;

  const totalKg = [...totalKgByCrop.values()].reduce((s, k) => s + k, 0);
  const result: PlotAdvisorResult = {
    plotId: plot.id,
    plotName: plot.name,
    currentCrop: plot.crop ?? null,
    areaSqm: plot.area_sqm ?? null,
    hasSoilData: !!latest,
    harvestHistory: {
      lots: lots.length,
      totalKg: r2(totalKg),
      perSqmKg: area ? r2(totalKg / area) : null,
      crops: historyCrops,
    },
    recommendations: recommendations.slice(0, Math.max(1, Math.min(topN, crops.length))),
    forecast: forecastRec
      ? { crop: forecastRec.crop, perSqmKg: forecastRec.perSqmKg, expectedKg: forecastRec.expectedKg, basis: forecastRec.basis }
      : null,
    source: 'heuristic',
    generatedAt: new Date().toISOString(),
  };
  return result;
}

// ── Ollama (ตัวเสริม) — ล้ม/ช้า = fallback heuristic เสมอ ──

async function callFarmOllama(prompt: string): Promise<string> {
  const response = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    { model: await getModelForTask('GENERAL_ASSISTANT', MODEL), prompt, stream: false, options: { temperature: 0.3 }, keep_alive: OLLAMA_KEEP_ALIVE },
    { timeout: FARM_ADVISOR_TIMEOUT_MS }
  );
  const text = response.data?.response?.trim();
  if (!text) throw new Error('empty ollama response');
  return text;
}

export type FarmLlmFn = (prompt: string) => Promise<string>;

/** เรียก Ollama พร้อม timeout — พัง/ช้า = คืน null (ผู้เรียก fallback heuristic) */
export async function tryFarmLlm(prompt: string, llm: FarmLlmFn = callFarmOllama): Promise<string | null> {
  try {
    const text = await llm(prompt);
    return text || null;
  } catch (err) {
    console.error('Farm advisor AI error:', (err as Error).message);
    return null;
  }
}

/** เรียบเรียงผล heuristic เป็นข้อความไทย — ใช้เป็น fallback เมื่อ AI ไม่พร้อม */
export function formatAdvisorText(rec: PlotAdvisorResult): string {
  const lines: string[] = [];
  lines.push(`แปลง ${rec.plotName}${rec.currentCrop ? ` (ปลูกอยู่: ${rec.currentCrop})` : ''}`);
  if (rec.forecast) {
    lines.push(`คาดการณ์ผลผลิต ${rec.forecast.crop}: ~${rec.forecast.expectedKg} กก. (${rec.forecast.perSqmKg} กก./ตร.ม. — ${rec.forecast.basis === 'history' ? 'จากประวัติจริง' : rec.forecast.basis === 'global-history' ? 'จากประวัติแปลงอื่น' : 'ค่าประมาณ'})`);
  }
  lines.push('แนะนำปลูก:');
  for (const r of rec.recommendations) {
    lines.push(`${r.score >= 85 ? '✅' : r.score >= 60 ? '☑️' : '⚠️'} ${r.crop} — คะแนน ${r.score}/100, คาด ~${r.expectedKg} กก. · ${r.reasons[0]}`);
  }
  lines.push(`(ที่มา: heuristic จากค่าดินล่าสุด${rec.hasSoilData ? '' : ' — ยังไม่มีค่าดิน'} + ประวัติเก็บเกี่ยว ${rec.harvestHistory.lots} ล็อต)`);
  return lines.join('\n');
}

/** ถาม AI เสริม — heuristic ตอบได้เสมอ, AI พร้อม = แนบข้อความ AI + source: 'ollama' */
export async function askFarmAdvisor(
  plotId: string,
  opts: { question?: string; topN?: number; llm?: FarmLlmFn } = {}
): Promise<{ heuristic: PlotAdvisorResult; heuristicText: string; aiText: string | null; source: 'heuristic' | 'ollama' }> {
  const heuristic = await computePlotAdvisor(plotId, opts.topN ?? 3);
  const heuristicText = formatAdvisorText(heuristic);
  const prompt = [
    'คุณคือที่ปรึกษาเกษตร (Sovereign OS) ตอบภาษาไทย กระชับ ตรงประเด็น ไม่เกริ่น',
    'ข้อมูลวิเคราะห์จากระบบ (heuristic — ใช้เป็นความจริงตั้งต้น ห้ามแต่งตัวเลขใหม่):',
    JSON.stringify(heuristic),
    opts.question ? `คำถามเพิ่มเติมของผู้ใช้: ${opts.question}` : 'ช่วยเรียบเรียงคำแนะนำ + เหตุผลเชิงเกษตรสั้น ๆ (3-6 บรรทัด)',
  ].join('\n');
  const aiText = await tryFarmLlm(prompt, opts.llm);
  return { heuristic, heuristicText, aiText, source: aiText ? 'ollama' : 'heuristic' };
}
