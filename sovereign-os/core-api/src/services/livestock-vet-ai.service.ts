// ═════════════════════════════════════════════════════════════
// Local Vet AI — ปศุสัตว์: คำนวณดัชนีวิกฤต + ตัดสินใจอัตโนมัติ
// (Pure functions — ไม่แตะ DB เอง route/telegram เป็นคนสั่ง action)
//
// สูตรหลัก (จาก Sovereign Livestock Engine):
//   THI  = (1.8×T + 32) − (0.55 − 0.55×RH) × (1.8×T − 26)
//   FCR  = FeedConsumedKg / WeightGainKg
//   HD%  = EggCount / ActiveHens × 100
//   Dtot = (Wavg × N × Dosetarget) / Cdrug        → ลิตรน้ำยา
//   Spike rate > 0.5%/วัน หรือ ≥3×ค่าเฉลี่ย 3 วัน → QUARANTINE
// ═════════════════════════════════════════════════════════════

export type VetSeverity = 'info' | 'warn' | 'critical';

export interface VetAction {
  severity: VetSeverity;
  action: string; // EVAP_FAN_ON | TELEGRAM_CRITICAL | QUARANTINE | LOCK_WITHDRAWAL | UNLOCK | ...
  message: string;
}

export interface VetDailyLog {
  logDate: Date | string;
  mortalityCount: number;
  culledCount?: number;
  feedConsumedKg: number;
  waterConsumedL?: number | null;
  eggCount?: number | null;
  avgWeightGram?: number | null;
}

/** THI Stress Index — THI = (1.8×T+32) − (0.55−0.55×RH)×(1.8×T−26) */
export function computeTHI(tempC: number, rhPct: number): number {
  const rh = Math.max(0, Math.min(100, rhPct)) / 100;
  return (1.8 * tempC + 32) - (0.55 - 0.55 * rh) * (1.8 * tempC - 26);
}

export function thiStatus(thi: number): { level: VetSeverity; label: string; actions: VetAction[] } {
  if (thi > 84) {
    return {
      level: 'critical',
      label: 'CRITICAL',
      actions: [
        { severity: 'critical', action: 'EVAP_FAN_ON', message: `THI=${thi.toFixed(1)} > 84 — เปิดพัดลม Evap/พ่นหมอก + แจ้งเตือนด่วน` },
      ],
    };
  }
  if (thi > 74) {
    return {
      level: 'warn',
      label: 'HEAT_WARNING',
      actions: [
        { severity: 'warn', action: 'EVAP_FAN_ON', message: `THI=${thi.toFixed(1)} > 74 — สั่งเปิดพัดลม Evap/พ่นหมอก` },
      ],
    };
  }
  return { level: 'info', label: 'COMFORT', actions: [] };
}

// ── THI Hysteresis & Anti-Flapping (Safety) ──
// กันพัดลม/สเปรย์ "ตัด-ต่อ" เองถี่ๆ ตอน THI ก้ำกึ่งอยู่ตรง threshold:
//   เปิดเมื่อ THI ≥ THI_FAN_ON (มี dead-band ลงมาปิดที่ THI_FAN_OFF)
//   ปิดเมื่อ THI ≤ THI_FAN_OFF และเปิดต่อเนื่องครบ FAN_MIN_ON_MS แล้วเท่านั้น
//   เปิดใหม่หลังปิดต้องเว้น FAN_MIN_OFF_MS (ยกเว้น critical — ความปลอดภัยมาก่อน)
export const THI_FAN_ON = 74;
export const THI_FAN_OFF = 70; // dead-band 4 จุด — ไม่ออสซิลเลชันที่ 73-75
export const FAN_MIN_ON_MS = 300_000; // เปิดแล้วต้องเปิดต่ออย่างน้อย 5 นาที
export const FAN_MIN_OFF_MS = 300_000; // ปิดแล้วพักอย่างน้อย 5 นาที (Cooldown ต่อคำสั่ง)

export interface FanDecision {
  turnOn: boolean;
  turnOff: boolean;
  reason: string;
}

export function shouldRunFan(
  thi: number,
  fanOn: boolean,
  lastToggleAtMs: number,
  nowMs = Date.now()
): FanDecision {
  const elapsed = nowMs - lastToggleAtMs;
  // วิกฤต — ความปลอดภัยมาก่อนกติกาทั้งหมด
  if (thi > 84) {
    return { turnOn: !fanOn, turnOff: false, reason: `THI=${thi.toFixed(1)} > 84 — วิกฤต เปิดทันที (ยกเว้นกฎ cooldown)` };
  }
  if (fanOn) {
    if (thi < THI_FAN_OFF) {
      if (elapsed >= FAN_MIN_ON_MS) {
        return { turnOn: false, turnOff: true, reason: `THI=${thi.toFixed(1)} < ${THI_FAN_OFF} และเปิดครบ ${FAN_MIN_ON_MS / 60000} นาที — ปิดพัดลม` };
      }
      return { turnOn: false, turnOff: false, reason: `THI=${thi.toFixed(1)} < ${THI_FAN_OFF} แต่เปิดยังไม่ครบ 5 นาที — พักไว้ก่อน (Anti-Flapping)` };
    }
    return { turnOn: false, turnOff: false, reason: `THI=${thi.toFixed(1)} ยังอยู่ช่วงพัก (${THI_FAN_OFF}..${THI_FAN_ON}) — เปิดต่อ` };
  }
  if (thi >= THI_FAN_ON) {
    if (elapsed >= FAN_MIN_OFF_MS) {
      return { turnOn: true, turnOff: false, reason: `THI=${thi.toFixed(1)} ≥ ${THI_FAN_ON} — เปิดพัดลม Evap/สเปรย์` };
    }
    return { turnOn: false, turnOff: false, reason: `เพิ่งปิดไปเมื่อ ${Math.round(elapsed / 1000)}s — ตาม Cooldown 5 นาที (${thi.toFixed(1)} ยัง < 84 ไม่ใช่ฉุกเฉิน)` };
  }
  return { turnOn: false, turnOff: false, reason: `THI=${thi.toFixed(1)} < ${THI_FAN_ON} — ไม่ต้องเปิด` };
}

// ── Dosage Sanity Checker (Guardrail กัน AI hallucination) ──
// แคตตาล็อกยาขนาดสูงสุด (มก./กก. ต่อน้ำหนักตัว) — ค่าจริงจากคู่มือปศุสัตว์ พบสัตวแพทย์ปรับละเอียด
export const DRUG_DOSAGE_CAPS: Record<string, { maxMgPerKg: number; withdrawalDays: number }> = {
  amoxicillin: { maxMgPerKg: 20, withdrawalDays: 7 },
  'amoxicillin trihydrate': { maxMgPerKg: 20, withdrawalDays: 7 },
  oxytetracycline: { maxMgPerKg: 20, withdrawalDays: 14 },
  doxycycline: { maxMgPerKg: 10, withdrawalDays: 21 },
  enrofloxacin: { maxMgPerKg: 10, withdrawalDays: 14 },
  tylosin: { maxMgPerKg: 20, withdrawalDays: 7 },
  tiamulin: { maxMgPerKg: 15, withdrawalDays: 7 },
  florfenicol: { maxMgPerKg: 20, withdrawalDays: 30 },
  sulfadimethoxine: { maxMgPerKg: 50, withdrawalDays: 14 },
  colistin: { maxMgPerKg: 10, withdrawalDays: 7 },
  ivermectin: { maxMgPerKg: 0.5, withdrawalDays: 21 },
  albendazole: { maxMgPerKg: 10, withdrawalDays: 14 },
  levamisole: { maxMgPerKg: 8, withdrawalDays: 14 },
  trimethoprim: { maxMgPerKg: 30, withdrawalDays: 7 },
  lincomycin: { maxMgPerKg: 10, withdrawalDays: 5 },
};
export const DEFAULT_MAX_DOSE_MG_KG = 100; // ยาไม่อยู่ในแคตตาล็อก = hard cap กันเกินจริงทุกรูปแบบ
export const MAX_WITHDRAWAL_DAYS = 90;

export interface DosageVerdict {
  ok: boolean;
  reason: string;
  known: boolean;
  maxMgPerKg: number;
  maxWithdrawalDays: number;
}

/** hard-cap ปริมาณยา — dose > cap → ปฏิเสธ (route คืน 400 + เหตุผล) */
export function validateDosage(params: {
  drugName: string;
  doseMgPerKg: number;
  withdrawalDays?: number;
}): DosageVerdict {
  const name = String(params.drugName || '').trim().toLowerCase();
  const cap = DRUG_DOSAGE_CAPS[name];
  const maxMgPerKg = cap?.maxMgPerKg ?? DEFAULT_MAX_DOSE_MG_KG;
  const maxWithdrawalDays = MAX_WITHDRAWAL_DAYS;
  const dose = Number(params.doseMgPerKg);
  if (!Number.isFinite(dose) || dose < 0) {
    return { ok: false, reason: `dosageMgKg ต้องเป็นตัวเลข ≥ 0 (ได้ ${params.doseMgPerKg})`, known: !!cap, maxMgPerKg, maxWithdrawalDays };
  }
  if (dose > maxMgPerKg) {
    return {
      ok: false,
      reason: `⛔ DOSAGE CAP: ${name || '(ยาที่ไม่รู้จัก)'} สูงสุด ${maxMgPerKg} มก./กก. — ได้รับ ${dose} มก./กก. (กรณีสัตวแพทย์สั่งจริง ให้เพิ่มยอดเป็นโดสรวมและยืนยันผ่าน Telegram ให้ผู้ดูแล)`,
      known: !!cap,
      maxMgPerKg,
      maxWithdrawalDays,
    };
  }
  const days = Number(params.withdrawalDays ?? 0);
  if (!Number.isFinite(days) || days < 0 || days > maxWithdrawalDays) {
    return {
      ok: false,
      reason: `withdrawalDays ต้องอยู่ในช่วง 0..${maxWithdrawalDays} วัน (ได้ ${params.withdrawalDays})`,
      known: !!cap,
      maxMgPerKg,
      maxWithdrawalDays,
    };
  }
  return {
    ok: true,
    reason: cap
      ? `ขนาด ${dose} มก./กก. ≤ cap ${maxMgPerKg} มก./กก. ของ ${name} ✓`
      : `ขนาด ${dose} มก./กก. ≤ default cap ${maxMgPerKg} มก./กก. (ยาไม่อยู่ในแคตตาล็อก) ✓`,
    known: !!cap,
    maxMgPerKg,
    maxWithdrawalDays,
  };
}

/** มูลค่าความเสียหายจากการสูญเสีย — totalMortality × ต้นทุนต่อตัว (เทียบงบชุดเลี้ยง) */
export function computeMortalityImpact(params: {
  totalMortality: number;
  unitCostPerAnimal: number;
  batchCost?: number;
}): { loss: number; batchCost: number; lossVsBatchPct: number } {
  const unitCost = Math.max(0, Number(params.unitCostPerAnimal) || 0);
  const mortality = Math.max(0, Number(params.totalMortality) || 0);
  const loss = +(mortality * unitCost).toFixed(2);
  const batchCost = Math.max(0, Number(params.batchCost) || 0);
  const lossVsBatchPct = batchCost > 0 ? +((loss / batchCost) * 100).toFixed(1) : 0;
  return { loss, batchCost, lossVsBatchPct };
}

/** สถานะกักกัน: เหลืออีกกี่วัน + ปลดอัตโนมัติเมื่อพ้นกำหนด */
export function quarantineStatus(endAt: Date | string | null | undefined, nowMs = Date.now()): {
  active: boolean;
  daysLeft: number;
} {
  if (!endAt) return { active: false, daysLeft: 0 };
  const end = new Date(endAt).getTime();
  const daysLeft = Math.ceil((end - nowMs) / DAY_MS);
  return { active: daysLeft > 0, daysLeft: Math.max(0, daysLeft) };
}

// ── Multimodal Vision Ingestion (ปศุสัตว์) — prompt + parser ──
// รูปอาการป่วย (ผื่นผิวหนัง/อุจจาระ/รอยโรค) → Qwen2-VL → JSON:
//   { summary, severity, symptoms: [{ area, finding, severity, likelihood }], recommendation }
export const LIVESTOCK_VISION_PROMPT = [
  'You are a livestock veterinary diagnostic assistant (Sovereign OS).',
  'Analyze the attached image of an ill animal (skin lesions, feces, lesions, discharge).',
  'Return ONLY valid JSON with this exact shape:',
  '{"summary": "<2-3 sentence Thai summary of the symptoms>", "severity": "info|warn|critical", "symptoms": [{"area": "<body part>", "finding": "<what is visible>", "severity": "info|warn|critical", "likelihood": 0.0-1.0}], "recommendation": "<Thai recommendation for the farmer>"}',
  'No text outside the JSON.',
].join(' ');

export interface LivestockSymptom {
  area: string;
  finding: string;
  severity: VetSeverity;
  likelihood: number | null;
}

export interface LivestockVisionResult {
  summary: string;
  severity: VetSeverity;
  symptoms: LivestockSymptom[];
  recommendation: string;
  raw: string;
}

/** parse คำตอบจาก VL model — รับ JSON อยู่ใน fence/เปล่า/คาบคำเกิน (กัน model พูดนอกเรื่อง) */
export function parseLivestockVisionResponse(text: string): LivestockVisionResult {
  const raw = String(text ?? '').trim();
  let obj: unknown = null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  try {
    obj = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch { /* ignore */ }
    }
  }
  const sev = (v: unknown): VetSeverity => {
    const s = String(v ?? '').toLowerCase();
    return s === 'critical' ? 'critical' : s === 'warn' ? 'warn' : 'info';
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { summary: raw.slice(0, 1500), severity: 'info', symptoms: [], recommendation: '', raw };
  }
  const o = obj as Record<string, unknown>;
  const symptoms: LivestockSymptom[] = [];
  const arr = Array.isArray(o.symptoms) ? o.symptoms : [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const d = s as Record<string, unknown>;
    const lo = Number(d.likelihood ?? d.confidence ?? 0);
    symptoms.push({
      area: String(d.area ?? 'ไม่ระบุ').slice(0, 200),
      finding: String(d.finding ?? d.findings ?? '').slice(0, 500),
      severity: sev(d.severity),
      likelihood: Number.isFinite(lo) ? Math.min(1, Math.max(0, lo)) : null,
    });
  }
  return {
    summary: String(o.summary ?? '').slice(0, 2000),
    severity: sev(o.severity),
    symptoms,
    recommendation: String(o.recommendation ?? '').slice(0, 1000),
    raw,
  };
}

/** Feed Conversion Ratio — FCR = feedกก. / น้ำหนักเพิ่มกก. (จาก 2 จุดเวลา) */
export function computeFCR(params: {
  feedKg: number;
  startAvgGram?: number | null;
  endAvgGram?: number | null;
  quantity: number;
}): { fcr: number | null; weightGainKg: number | null } {
  const { feedKg, startAvgGram, endAvgGram, quantity } = params;
  if (feedKg <= 0 || !quantity || quantity <= 0) return { fcr: null, weightGainKg: null };
  const gainPromille = (endAvgGram ?? 0) - (startAvgGram ?? 0);
  if (gainPromille <= 0) return { fcr: null, weightGainKg: gainPromille * quantity / 1000 };
  const weightGainKg = (gainPromille * quantity) / 1000;
  return { fcr: +(feedKg / weightGainKg).toFixed(2), weightGainKg: +weightGainKg.toFixed(2) };
}

/** Hen-Day Production % — HD% = ไข่ / สัตว์คงเหลือ × 100 */
export function computeHD(eggCount: number, activeCount: number): number | null {
  if (!activeCount || activeCount <= 0) return null;
  return +((eggCount / activeCount) * 100).toFixed(1);
}

/** Drug Dosage AI — Dรวม(ลิตร) = (Wavgกก. × N × Doseมก./กก.) / Cยามก./ล. */
export function computeDrugTotalL(
  avgWeightKg: number,
  count: number,
  doseMgPerKg: number,
  drugConcentrationMgPerL: number
): number | null {
  if (count <= 0 || avgWeightKg <= 0 || drugConcentrationMgPerL <= 0) return null;
  return +((avgWeightKg * count * doseMgPerKg) / drugConcentrationMgPerL).toFixed(2);
}

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Mortality Spike — อัตราตายรายวัน > 0.5% หรือ ≥3×ค่าเฉลี่ย 3 วัน → QUARANTINE */
export function detectMortalitySpike(
  logs: VetDailyLog[],
  currentQuantity: number,
  nowMs = Date.now()
): { isSpike: boolean; ratePct: number; avg3dPct: number; message: string } {
  if (!logs.length || currentQuantity <= 0) {
    return { isSpike: false, ratePct: 0, avg3dPct: 0, message: '' };
  }
  const sorted = [...logs]
    .filter((l) => dayKey(new Date(l.logDate)) !== dayKey(new Date(nowMs)) || logs.length === 1)
    .sort((a, b) => new Date(a.logDate).getTime() - new Date(b.logDate).getTime());
  const last = sorted[sorted.length - 1];
  if (!last) return { isSpike: false, ratePct: 0, avg3dPct: 0, message: '' };
  const ratePct = +(((last.mortalityCount || 0) / currentQuantity) * 100).toFixed(2);
  const prev = sorted.slice(-4, -1); // 3 วันก่อนหน้า
  const avg3d =
    prev.length > 0 && currentQuantity > 0
      ? +((prev.reduce((s, l) => s + (l.mortalityCount || 0), 0) / prev.length / currentQuantity) * 100).toFixed(2)
      : 0;
  const spike = ratePct > 0.5 || (avg3d > 0 && ratePct >= avg3d * 3);
  return {
    isSpike: spike,
    ratePct,
    avg3dPct: avg3d,
    message: spike
      ? `MORTALITY SPIKE: อัตราตาย ${ratePct}%/วัน (เฉลี่ย 3 วัน ${avg3d}%) — ล็อกเล้า + แจ้งสัตวบาล`
      : '',
  };
}

/** น้ำกินลดลง >20% เทียบค่าเฉลี่ย 3 วันก่อน → ธงโรคระบาด */
export function detectWaterDrop(logs: VetDailyLog[]): { dropped: boolean; pct: number; message: string } {
  const sorted = [...logs]
    .filter((l) => l.waterConsumedL != null)
    .sort((a, b) => new Date(a.logDate).getTime() - new Date(b.logDate).getTime());
  if (sorted.length < 2) return { dropped: false, pct: 0, message: '' };
  const last = sorted[sorted.length - 1].waterConsumedL!;
  const prev = sorted.slice(0, -1).slice(-3);
  const avg = prev.reduce((s, l) => s + (l.waterConsumedL || 0), 0) / prev.length;
  if (avg <= 0) return { dropped: false, pct: 0, message: '' };
  const pct = +(((last - avg) / avg) * 100).toFixed(1);
  const dropped = pct <= -20;
  return {
    dropped,
    pct,
    message: dropped
      ? `WATER DROP: น้ำกินลดลง ${Math.abs(pct)}% เทียบ 3 วันก่อน — ตรวจโรคซ่อนแฝง`
      : '',
  };
}

/** HD% ร่วง >5% เทียบวันก่อน → วิเคราะห์โภชนาการ/แสงสว่าง */
export function detectHDDrop(
  today: number | null,
  yesterday: number | null
): { dropped: boolean; message: string } {
  if (today == null || yesterday == null || yesterday <= 0) return { dropped: false, message: '' };
  const diff = today - yesterday;
  if (diff <= -5) {
    return { dropped: true, message: `HD% ร่วง ${Math.abs(diff).toFixed(1)}% ใน 1 วัน (>5%) — ตรวจโภชนาการและแสงสว่าง` };
  }
  return { dropped: false, message: '' };
}

/** FCR สูงกว่า Standard Curve 10% ขึ้นไป → เตือน */
export function detectFcrDeviation(fcr: number | null, standardFcr: number): { dev: boolean; pct: number; message: string } {
  if (fcr == null || standardFcr <= 0) return { dev: false, pct: 0, message: '' };
  const pct = +(((fcr - standardFcr) / standardFcr) * 100).toFixed(1);
  return {
    dev: pct >= 10,
    pct,
    message: pct >= 10 ? `FCR=${fcr} สูงกว่า Standard ${pct}% — ตรวจการดูดซึมอาหาร/โรคซ่อนแฝง` : '',
  };
}

/** ระยะหยุดยา: ยังไม่พ้น → ล็อกขาย (LOCKED_WITHDRAWAL) */
export function withdrawalStatus(safeHarvestDate: Date | string, nowMs = Date.now()): {
  locked: boolean;
  daysLeft: number;
} {
  const safe = new Date(safeHarvestDate).getTime();
  const daysLeft = Math.ceil((safe - nowMs) / DAY_MS);
  return { locked: daysLeft > 0, daysLeft: Math.max(0, daysLeft) };
}

/** ประตูชีวนิรภัย: ฉีดพ่นต้อง ≥180 วินาที */
export const GATE_SANITIZE_MIN_SEC = 180;
export function gateCheck(sanitizedSec: number): { passed: boolean; message: string } {
  const passed = sanitizedSec >= GATE_SANITIZE_MIN_SEC;
  return {
    passed,
    message: passed
      ? `เข้าฟาร์มได้ — ฉีดพ่นครบ ${sanitizedSec}s`
      : `ปิดประตู! ฉีดพ่นแค่ ${sanitizedSec}s (ต้อง ≥${GATE_SANITIZE_MIN_SEC}s)`,
  };
}

/** % Hatchability = ฟักสำเร็จ / ไข่ที่กก × 100 */
export function computeHatchability(hatched: number | null, set: number | null): number | null {
  if (!set || set <= 0 || hatched == null) return null;
  return +((hatched / set) * 100).toFixed(1);
}

/** ประเมินรายวัน: เรียกเมื่อบันทึก Daily Log — คืนทุก action ที่ต้องสั่งงาน */
export function evaluateDailyLog(params: {
  logs: VetDailyLog[];
  currentQuantity: number;
  standardFcr?: number;
  nowMs?: number;
}): VetAction[] {
  const actions: VetAction[] = [];
  const { logs, currentQuantity, standardFcr = 2.0 } = params;

  const spike = detectMortalitySpike(logs, currentQuantity);
  if (spike.isSpike) {
    actions.push({ severity: 'critical', action: 'QUARANTINE', message: spike.message });
  }
  const water = detectWaterDrop(logs);
  if (water.dropped) {
    actions.push({ severity: 'warn', action: 'WATER_DROP', message: water.message });
  }
  return actions;
}