// src/services/advisor.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// P2 — Decision Support AI
//   • buildSituationContext() — รวมสถานการณ์จริง (แบต/น้ำ/แปลง/เสบียง/เงิน/เสี่ยง)
//     ให้ AI ตัดสินใจ ตัดข้อมูลให้ไม่อ้วนเกิน (truncate)
//   • runWhatIf() — สถานการณ์จำลองแบบ heuristic (ฝนไม่ตก/ไฟไม่มี/ค่าใช้จ่ายขึ้น)
//   • askAdvisor() / summarizeImpact() — ถาม Ollama (ไทย) + กันพลาด offline
// Pure logic แยกจาก data sources เพื่อให้เทสต์ง่าย
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import { prisma } from '../lib/prisma';
import { computePortfolioValue, computeInventoryValue } from './wealth.service';
import { classifyDefcon } from './defcon-engine.service';
import { getModelForTask } from './ai-router.service';

export { prisma };

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
export const MODEL = process.env.AI_MODEL || 'gemma3:4b';
/** ความจุแบตเตอรี่ (kWh) — ค่าเดียวกับ energy.routes.ts */
export const CAPACITY_KWH = parseFloat(process.env.ENERGY_CAPACITY_KWH || '5');

/** ประเมิน "วิกฤต" เมื่อเหลือ ≤ 2 วัน, "เตือน" เมื่อ ≤ 7 วัน */
export const CRITICAL_DAYS = 2;
export const WARNING_DAYS = 7;
/** จำกัดขนาด context ที่ส่งให้ AI (ตัวอักษร) — เกินแล้วทิ้งส่วนย่อย */
export const MAX_CONTEXT_CHARS = 6000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SituationContext {
  generatedAt: string;
  battery: {
    soc: number | null;
    avgPowerKw: number | null;
    hoursRemaining: number | null;
    status: 'no_data' | 'discharging' | 'charging' | 'balanced';
  };
  water: {
    levelCm: number | null;
    rateCmPerHour: number | null;
    daysLeft: number | null;
    trend: 'rising' | 'falling' | 'flat' | 'unknown';
  };
  farm: {
    plots: number;
    active: number;
    growing: number;
    harvested: number;
    fallow: number;
    activeAreaSqm: number | null;
    upcomingHarvests: Array<{ name: string | null; crop: string | null; daysLeft: number | null }>;
  };
  inventory: {
    items: number;
    waterQty: number;
    foodQty: number;
    expiring: number;
    expired: number;
    lowStock: number;
    expiringSoon: Array<{ name: string; category: string; daysLeft: number | null }>;
  };
  wealth: {
    totalUsd: number | null;
    portfolioUsd: number | null;
    inventoryUsd: number | null;
    runwayMonths: number | null;
    monthlyBurnUsd: number | null;
    missingPrices: string[];
  };
  risk: {
    threatOverall: number | null;
    threatSummary: string | null;
    defcon: number | null;
  };
  truncated: boolean;
}

export type WhatIfScenario = 'no_rain' | 'no_power' | 'cost_increase';
export const WHAT_IF_SCENARIOS: WhatIfScenario[] = ['no_rain', 'no_power', 'cost_increase'];

export interface WhatIfParams {
  scenario: WhatIfScenario;
  /** วัน (no_rain/no_power) หรือ % ค่าใช้จ่ายที่เพิ่ม (cost_increase) */
  days: number;
}

export interface WhatIfResult {
  scenario: WhatIfScenario;
  days: number;
  battery: { currentHoursLeft: number | null; hoursAfter: number | null; willDie: boolean | null };
  water: { currentDaysLeft: number | null; levelAfterCm: number | null; daysLeftAfter: number | null; willRunOut: boolean | null };
  food: { daysLeft: number | null };
  impact: 'critical' | 'warning' | 'ok' | 'unknown';
  impactNote: string;
}

/** Data sources — injectable สำหรับเทสต์ (default คือ prisma + TimescaleDB) */
export interface AdvisorDataSources {
  latestTelemetry(): Promise<Record<string, number | null>>;
  powerAvg24h(): Promise<number | null>;
  waterHistory72h(): Promise<Array<{ time: string | Date; value: number }>>;
  farmPlots(): Promise<Array<{ status: string; crop: string | null; area_sqm: number | null; expected_harvest_at: Date | null; name: string | null }>>;
  inventory(): Promise<Array<{ name: string; category: string; quantity: number; unit_price_usd: number | null; minimum_stock: number | null; expiry_date: Date | null }>>;
  assets(): Promise<Array<{ symbol: string; type: string; quantity: number }>>;
  latestPrices(): Promise<Array<{ symbol: string; price_usd: number }>>;
  wealthHistory(): Promise<{ total_usd_value: number; payload: unknown } | null>;
  threatIndex(): Promise<{ overall: number; summary: string | null } | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data sources (default — ใช้ได้จริง offline)
// ─────────────────────────────────────────────────────────────────────────────

export const defaultDataSources: AdvisorDataSources = {
  async latestTelemetry() {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT ON (metric) metric, value
       FROM sensor_telemetry
       WHERE metric IN ('battery_soc', 'power_kw', 'water_level_cm')
       ORDER BY metric, time DESC`
    );
    const out: Record<string, number | null> = {};
    for (const r of rows) out[r.metric] = r.value != null ? Number(r.value) : null;
    return out;
  },
  async powerAvg24h() {
    const rows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT AVG(value) AS avg_power
       FROM sensor_telemetry
       WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
    );
    return rows[0]?.avg_power != null ? Number(rows[0].avg_power) : null;
  },
  async waterHistory72h() {
    return prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT time, value FROM sensor_telemetry
       WHERE metric = 'water_level_cm' AND time >= NOW() - INTERVAL '72 hours'
       ORDER BY time ASC`
    );
  },
  async farmPlots() {
    return prisma.farmPlot.findMany({
      select: { status: true, crop: true, area_sqm: true, expected_harvest_at: true, name: true },
    });
  },
  async inventory() {
    return prisma.inventoryItem.findMany({
      select: { name: true, category: true, quantity: true, unit_price_usd: true, minimum_stock: true, expiry_date: true },
    });
  },
  async assets() {
    return prisma.assetPosition.findMany({ select: { symbol: true, type: true, quantity: true } });
  },
  async latestPrices() {
    return prisma.$queryRawUnsafe<Array<{ symbol: string; price_usd: number }>>(
      `SELECT DISTINCT ON (symbol) symbol, price_usd
       FROM asset_prices ORDER BY symbol, time DESC`
    );
  },
  async wealthHistory() {
    return prisma.wealthHistory.findFirst({ orderBy: { timestamp: 'desc' }, take: 1 });
  },
  async threatIndex() {
    return prisma.threatIndex.findFirst({ orderBy: { timestamp: 'desc' }, select: { overall: true, summary: true } });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** อัตราการเปลี่ยนระดับน้ำ (ซม./ชม.) จาก history — ลบ = ระดับลดลง, null = ข้อมูลไม่พอ */
export function linearSlopeCmPerHour(
  samples: Array<{ time: string | Date; value: number }>
): number | null {
  if (!Array.isArray(samples) || samples.length < 3) return null;
  const pts = samples
    .map((s) => ({ t: new Date(s.time).getTime() / 3600000, v: Number(s.value) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < 3) return null;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span < 1) return null; // ต้องมีช่วง ≥ 1 ชม.
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.t, 0);
  const sy = pts.reduce((a, p) => a + p.v, 0);
  const sxx = pts.reduce((a, p) => a + p.t * p.t, 0);
  const sxy = pts.reduce((a, p) => a + p.t * p.v, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom; // ซม./ชม. (ลบ = ลดลง)
}

/** ประมาณว่าน้ำจะเหลือใช้กี่วัน — rate ≤ 0 หรือไม่มีข้อมูล → null (ไม่ขาดแคลน) */
export function estimateWaterDaysLeft(
  levelCm: number | null,
  rateCmPerHour: number | null
): number | null {
  if (levelCm == null || rateCmPerHour == null || rateCmPerHour <= 0) return null;
  if (levelCm <= 0) return 0;
  return levelCm / rateCmPerHour / 24;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context builder
// ─────────────────────────────────────────────────────────────────────────────

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86400000));
}

/**
 * รวมสถานการณ์จริงทั้งบ้าน → SituationContext
 * แต่ละส่วนกันพลาดเอง (DB ล่ม = null ไม่พังทั้งคำขอ) + ตัดข้อมูลให้ไม่อ้วนเกิน
 */
export async function buildSituationContext(
  ds: AdvisorDataSources = defaultDataSources
): Promise<SituationContext> {
  let truncated = false;

  const [telemetry, powerAvg, waterHistory, plots, items, assets, prices, wealthRow, threat] =
    await Promise.all([
      safe(ds.latestTelemetry()),
      safe(ds.powerAvg24h()),
      safe(ds.waterHistory72h()),
      safe(ds.farmPlots()),
      safe(ds.inventory()),
      safe(ds.assets()),
      safe(ds.latestPrices()),
      safe(ds.wealthHistory()),
      safe(ds.threatIndex()),
    ]);

  const telemetrySafe = telemetry || {};
  const soc = telemetrySafe.battery_soc ?? null;
  const powerKw = powerAvg ?? null;
  const waterLevel = telemetrySafe.water_level_cm ?? null;

  // แบต
  const discharging = powerKw != null && powerKw < -0.001;
  const hoursRemaining =
    soc != null && powerKw != null && discharging
      ? (soc / 100) * CAPACITY_KWH / Math.abs(powerKw)
      : null;
  const batteryStatus: SituationContext['battery']['status'] =
    soc == null && powerKw == null ? 'no_data'
      : powerKw != null && powerKw < -0.001 ? 'discharging'
      : powerKw != null && powerKw > 0.001 ? 'charging'
      : 'balanced';

  // น้ำ
  const slope = linearSlopeCmPerHour((waterHistory || []) as any);
  const waterRate = slope != null && slope < 0 ? Math.abs(slope) : null;
  const waterDaysLeft = estimateWaterDaysLeft(waterLevel, waterRate);
  const trend: SituationContext['water']['trend'] =
    slope == null ? 'unknown' : slope < -0.001 ? 'falling' : slope > 0.001 ? 'rising' : 'flat';

  // แปลง
  const plotList = plots || [];
  const plotStatuses = plotList.map((p) => p.status);
  const active = plotStatuses.filter((s) => s !== 'harvested' && s !== 'fallow').length;
  const growing = plotStatuses.filter((s) => s === 'growing').length;
  const harvested = plotStatuses.filter((s) => s === 'harvested').length;
  const fallow = plotStatuses.filter((s) => s === 'fallow').length;
  const activeArea = plotList.filter((p) => p.status !== 'harvested' && p.status !== 'fallow');
  const activeAreaSqm = activeArea.length
    ? activeArea.reduce((a, p) => a + (p.area_sqm ?? 0), 0) || null
    : null;
  const upcomingHarvests = plotList
    .filter((p) => p.expected_harvest_at && p.status !== 'harvested')
    .map((p) => ({ name: p.name, crop: p.crop, daysLeft: daysUntil(p.expected_harvest_at) }))
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  if (upcomingHarvests.length > 3) {
    upcomingHarvests.length = 3;
    truncated = true;
  }

  // เสบียง
  const itemsList = items || [];
  const today = new Date();
  const expiringSoon: SituationContext['inventory']['expiringSoon'] = [];
  let waterQty = 0;
  let foodQty = 0;
  let expiring = 0;
  let expired = 0;
  let lowStock = 0;
  for (const it of itemsList) {
    if (it.category === 'WATER') waterQty += it.quantity;
    if (it.category === 'FOOD') foodQty += it.quantity;
    const isLow = it.minimum_stock != null && it.quantity < it.minimum_stock;
    if (isLow) lowStock++;
    if (it.expiry_date) {
      const dLeft = daysUntil(it.expiry_date);
      if (dLeft === 0) expired++;
      else if (dLeft != null && dLeft <= 30) {
        expiring++;
        expiringSoon.push({ name: it.name, category: it.category, daysLeft: dLeft });
      }
    }
  }
  expiringSoon.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  if (expiringSoon.length > 5) {
    expiringSoon.length = 5;
    truncated = true;
  }

  // เงิน
  let portfolioUsd: number | null = null;
  let missingPrices: string[] = [];
  try {
    const assetList = (assets || []) as any;
    const priceList = (prices || []).map((p) => ({ symbol: p.symbol, priceUsd: Number(p.price_usd) }));
    if (assetList.length) {
      const pv = computePortfolioValue(assetList, priceList as any);
      portfolioUsd = pv.totalUsd;
      missingPrices = pv.missingPrices || [];
    }
  } catch {
    portfolioUsd = null;
  }
  const inventoryUsd = itemsList.length
    ? computeInventoryValue(
        itemsList.map((i) => ({ ...i, unitPriceUsd: i.unit_price_usd ?? 0 }) as any)
      )
    : null;
  const totalUsd = wealthRow?.total_usd_value != null ? Number(wealthRow.total_usd_value) : portfolioUsd;
  let runwayMonths: number | null = null;
  let monthlyBurnUsd: number | null = null;
  try {
    const payload = (wealthRow?.payload as any) ?? {};
    const r = payload?.runway?.months;
    const b = payload?.runway?.monthly_burn_usd ?? payload?.monthlyBurnUsd;
    runwayMonths = r != null && Number.isFinite(Number(r)) ? Number(r) : null;
    monthlyBurnUsd = b != null && Number.isFinite(Number(b)) ? Number(b) : null;
  } catch {
    runwayMonths = null;
  }
  if (missingPrices.length > 5) {
    missingPrices = missingPrices.slice(0, 5);
    truncated = true;
  }

  // เสี่ยง
  const threatOverall = threat?.overall != null ? Number(threat.overall) : null;
  const defcon = threatOverall != null ? classifyDefcon(threatOverall) : null;

  const context: SituationContext = {
    generatedAt: new Date().toISOString(),
    battery: { soc, avgPowerKw: powerKw, hoursRemaining, status: batteryStatus },
    water: { levelCm: waterLevel, rateCmPerHour: waterRate, daysLeft: waterDaysLeft, trend },
    farm: { plots: plotList.length, active, growing, harvested, fallow, activeAreaSqm, upcomingHarvests },
    inventory: { items: itemsList.length, waterQty, foodQty, expiring, expired, lowStock, expiringSoon },
    wealth: { totalUsd, portfolioUsd, inventoryUsd, runwayMonths, monthlyBurnUsd, missingPrices },
    risk: { threatOverall, threatSummary: threat?.summary ?? null, defcon },
    truncated,
  };

  // Budget ตัวอักษรสุดท้าย — เกินให้ทิ้งส่วนย่อยก่อน
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
    context.farm.upcomingHarvests = [];
    context.inventory.expiringSoon = [];
    context.wealth.missingPrices = [];
    context.truncated = true;
  }

  return context;
}

async function safe<T>(fn: Promise<T>): Promise<T | null> {
  try {
    return await fn;
  } catch (err) {
    console.error('Advisor data source error:', (err as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What-if — สถานการณ์จำลองแบบ heuristic (pure, เทสต์ได้ตรง)
// ─────────────────────────────────────────────────────────────────────────────

export function runWhatIf(ctx: SituationContext, params: WhatIfParams): WhatIfResult {
  const { scenario, days } = params;
  const n = Math.floor(days);

  // แบต
  const currentHoursLeft = ctx.battery.hoursRemaining;
  let hoursAfter: number | null = null;
  let willDie: boolean | null = null;
  if (scenario === 'no_power' && currentHoursLeft != null) {
    hoursAfter = Math.max(0, currentHoursLeft - n * 24);
    willDie = n * 24 >= currentHoursLeft;
  }

  // น้ำ
  const currentDaysLeft = ctx.water.daysLeft;
  const rate = ctx.water.rateCmPerHour;
  let levelAfterCm: number | null = null;
  let daysLeftAfter: number | null = null;
  let willRunOut: boolean | null = null;
  if (scenario === 'no_rain') {
    if (currentDaysLeft != null) {
      daysLeftAfter = Math.max(0, currentDaysLeft - n);
      willRunOut = n >= currentDaysLeft;
    }
    if (ctx.water.levelCm != null && rate != null && rate > 0) {
      levelAfterCm = Math.max(0, Math.round(ctx.water.levelCm - rate * 24 * n));
    }
  }

  // อาหาร (ประเมินจาก runway)
  const foodDaysLeft = ctx.wealth.runwayMonths != null ? ctx.wealth.runwayMonths * 30 : null;

  // ค่าใช้จ่าย
  let impactNote: string;
  let newRunwayDays: number | null = null;
  if (scenario === 'cost_increase' && ctx.wealth.monthlyBurnUsd != null && foodDaysLeft != null) {
    const burn = ctx.wealth.monthlyBurnUsd;
    const newBurn = burn * (1 + n / 100);
    newRunwayDays = (foodDaysLeft / 30) * burn / newBurn * 30;
    impactNote = `ค่าใช้จ่ายเดือนละ ~$${burn.toFixed(0)} → เพิ่ม ${n}% เป็น ~$${newBurn.toFixed(0)}/เดือน → เงินจะอยู่ได้ ~${newRunwayDays.toFixed(1)} วัน (จากเดิม ${foodDaysLeft.toFixed(0)} วัน)`;
  } else {
    const bits: string[] = [];
    if (scenario === 'no_rain') {
      bits.push(
        currentDaysLeft != null
          ? `น้ำเหลือใช้ ~${currentDaysLeft.toFixed(1)} วัน → หลัง ${n} วันไร้ฝนเหลือ ~${(daysLeftAfter ?? 0).toFixed(1)} วัน`
          : 'น้ำ: ไม่มีข้อมูลระดับน้ำพอคำนวณ'
      );
      if (levelAfterCm != null) bits.push(`ระดับน้ำจะอยู่ที่ ~${levelAfterCm} ซม.`);
    }
    if (scenario === 'no_power') {
      bits.push(
        currentHoursLeft != null
          ? `แบตเตอรี่เหลือ ~${currentHoursLeft.toFixed(1)} ชม. → ${willDie ? `จะหมดภายใน ${Math.ceil(currentHoursLeft / 24)} วันแรก` : `หลัง ${n} วันไม่มีไฟชาร์จเหลือ ~${(hoursAfter ?? 0).toFixed(1)} ชม.`}`
          : 'แบตเตอรี่: กำลังชาร์จหรือไม่มีข้อมูลเพียงพอ'
      );
    }
    if (foodDaysLeft != null) bits.push(`เสบียง/เงินน่าจะอยู่ได้ ~${foodDaysLeft.toFixed(0)} วัน`);
    impactNote = bits.length ? bits.join(' · ') : 'ข้อมูลไม่พอคำนวณผลกระทบ';
  }

  // ระดับความรุนแรง (ดูเฉพาะค่าที่คำนวณได้)
  let impact: WhatIfResult['impact'] = 'unknown';
  const batteryAfterDays = hoursAfter != null ? hoursAfter / 24 : null;
  if (willDie === true || willRunOut === true) {
    impact = 'critical';
  } else if (
    (daysLeftAfter != null && daysLeftAfter <= CRITICAL_DAYS)
    || (batteryAfterDays != null && batteryAfterDays <= CRITICAL_DAYS)
    || (newRunwayDays != null && newRunwayDays <= CRITICAL_DAYS)
  ) {
    impact = 'critical';
  } else if (
    (daysLeftAfter != null && daysLeftAfter <= WARNING_DAYS)
    || (batteryAfterDays != null && batteryAfterDays <= WARNING_DAYS)
    || (newRunwayDays != null && newRunwayDays <= WARNING_DAYS)
  ) {
    impact = 'warning';
  } else if (daysLeftAfter != null || batteryAfterDays != null || newRunwayDays != null) {
    impact = 'ok';
  }

  return {
    scenario,
    days: n,
    battery: { currentHoursLeft, hoursAfter, willDie },
    water: { currentDaysLeft, levelAfterCm, daysLeftAfter, willRunOut },
    food: { daysLeft: foodDaysLeft },
    impact,
    impactNote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama — ถาม AI (ไทย)
// ─────────────────────────────────────────────────────────────────────────────

async function callOllama(prompt: string): Promise<string> {
  const response = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    { model: await getModelForTask('GENERAL_ASSISTANT', MODEL), prompt, stream: false, options: { temperature: 0.3 }, keep_alive: OLLAMA_KEEP_ALIVE },
    { timeout: 120000 }
  );
  const text = response.data?.response?.trim();
  if (!text) throw new Error('empty ollama response');
  return text;
}

/** แปลง context เป็นข้อความสั้นสำหรับ prompt (กัน context ยาวเกิน) */
export function formatContextForPrompt(ctx: SituationContext): string {
  return JSON.stringify(ctx);
}

/**
 * ถาม "ควรทำอะไรดี" → คำแนะนำภาษาไทยจากข้อมูลจริง
 * offline/ล่ม → กลับ fallback (ไม่พัง) — ใช้ llm override เพื่อเทสต์
 */
export async function askAdvisor(
  question: string,
  ctx: SituationContext,
  llm: (prompt: string) => Promise<string> = callOllama
): Promise<string> {
  const prompt = [
    'คุณคือที่ปรึกษาประจำบ้าน (Sovereign OS) ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ไม่ต้องเกริ่น',
    'จากสถานการณ์จริงต่อไปนี้ ให้แนะนำสิ่งที่ควรทำ เรียงตามความสำคัญ และบอกเหตุผลสั้น ๆ ข้อมูลคือ:',
    formatContextForPrompt(ctx),
    `\nคำถามของผู้ใช้: ${question}`,
    'รูปแบบ: 2-5 ข้อ รายการสั้น ๆ พร้อมสัญลักษณ์ ☑️ ⚠️ ตามความเร่งด่วน',
  ].join('\n');
  try {
    return (await llm(prompt)).trim();
  } catch (err) {
    console.error('Advisor AI error:', (err as Error).message);
    return '⚠️ AI ออฟไลน์ (Ollama ไม่พร้อม) — ข้างบนคือข้อมูลจริงล่าสุด ใช้พิจารณาเองได้ครับ';
  }
}

/** ให้ AI สรุปผล what-if สั้น ๆ — ล่ม → ใช้ impactNote ที่คำนวณได้ */
export async function summarizeImpact(
  result: WhatIfResult,
  ctx: SituationContext,
  llm: (prompt: string) => Promise<string> = callOllama
): Promise<string> {
  const prompt = [
    'คุณคือที่ปรึกษาประจำบ้าน ตอบเป็นภาษาไทย กระชับ: จากสถานการณ์จำลองนี้ ควรเตรียมตัวอย่างไร?',
    'ผลจำลอง:',
    JSON.stringify({ result, context: { battery: ctx.battery, water: ctx.water, wealth: ctx.wealth } }),
  ].join('\n');
  try {
    return (await llm(prompt)).trim();
  } catch (err) {
    console.error('Advisor impact AI error:', (err as Error).message);
    return result.impactNote;
  }
}
