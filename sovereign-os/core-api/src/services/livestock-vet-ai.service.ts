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