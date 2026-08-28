// src/services/selfreliance.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Self-Reliance Engine — "วันรอด" (Days of Autonomy)
// ตัวเลขเดียวที่ครอบทุกศาสตร์: น้ำ/อาหาร/ไฟ/เงิน — ตัวที่สั้นที่สุด = จุดอ่อนของบ้าน
// การตั้งค่าเก็บใน SystemSetting 'selfreliance.settings' (ไม่ต้อง migrate)
// ทุกตัวเลขมาจากข้อมูลจริง: Inventory (น้ำ/อาหาร/เชื้อเพลิง) + telemetry (แบต) + BalanceSheet (เงิน)
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';

// ── การตั้งค่าบ้าน ──
export interface SelfRelianceSettings {
  people: number; // จำนวนคนในบ้าน
  waterTankL: number; // น้ำกักเก็บรวม (ลิตร)
  waterLPerPersonDay: number; // ใช้น้ำ/คน/วัน (WHO ขั้นต่ำ ~15L, สบาย 50L)
  foodKgPerPersonDay: number; // อาหารแห้ง/คน/วัน (~1.5kg หรือ 2000kcal)
  targetDays: number; // เป้าหมายวันรอด (แสดงสีเทียบ)
}

export const DEFAULT_SETTINGS: SelfRelianceSettings = {
  people: 4,
  waterTankL: 1000,
  waterLPerPersonDay: 20,
  foodKgPerPersonDay: 1.5,
  targetDays: 30,
};

const SETTINGS_KEY = 'selfreliance.settings';

export async function getSettings(): Promise<SelfRelianceSettings> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row?.value) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<SelfRelianceSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Partial<SelfRelianceSettings>): Promise<SelfRelianceSettings> {
  const merged = { ...(await getSettings()), ...s };
  // clamp กันค่ามั่ว
  merged.people = Math.min(50, Math.max(1, Math.round(merged.people) || 1));
  merged.waterTankL = Math.min(1_000_000, Math.max(0, merged.waterTankL));
  merged.waterLPerPersonDay = Math.min(500, Math.max(1, merged.waterLPerPersonDay));
  merged.foodKgPerPersonDay = Math.min(10, Math.max(0.1, merged.foodKgPerPersonDay));
  merged.targetDays = Math.min(3650, Math.max(1, Math.round(merged.targetDays) || 30));
  await prisma.systemSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(merged) },
    create: { key: SETTINGS_KEY, value: JSON.stringify(merged) },
  });
  return merged;
}

// ═════════════════════════════════════════════════════════════
// Pure compute — testable ไม่แตะ DB
// ═════════════════════════════════════════════════════════════

/** วันรอดน้ำ = ถัง(ลิตร) ÷ (คน × ลิตร/คน/วัน) */
export function computeWaterDays(tankL: number, people: number, lPerPersonDay: number): number | null {
  const use = people * lPerPersonDay;
  if (use <= 0) return null;
  return Math.round((tankL / use) * 10) / 10;
}

/** วันรอดอาหาร = อาหารรวม(kg) ÷ (คน × kg/คน/วัน) — นับเฉพาะ unit 'kg' */
export function computeFoodDays(foodKg: number, people: number, kgPerPersonDay: number): number | null {
  const use = people * kgPerPersonDay;
  if (use <= 0) return null;
  return Math.round((foodKg / use) * 10) / 10;
}

/** ชั่วโมงรอดไฟ = (soc% × capacity kWh) ÷ กำลังใช้เฉลี่ย kW — avgPower 0 = ∞ */
export function computeEnergyHours(socPct: number | null, capacityKwh: number, avgPowerKw: number | null): number | null {
  if (socPct == null || capacityKwh <= 0) return null;
  if (avgPowerKw == null || avgPowerKw <= 0) return null; // ไม่มีข้อมูลโหลด = ประเมินไม่ได้
  return Math.round(((socPct / 100) * capacityKwh) / avgPowerKw * 10) / 10;
}

export interface AutonomyItem {
  key: string;
  label: string;
  days: number | null; // null = ประเมินไม่ได้ (ข้อมูลไม่พอ)
  detail: string;
  /** ต่ำกว่า target = จุดอ่อน */
  ok: boolean | null;
}

/** หาจุดอ่อน: item ที่ days ต่ำสุด (ไม่นับ null) — ทุกตัว null = ยังประเมินไม่ได้ */
export function findWeakestLink(items: AutonomyItem[]): AutonomyItem | null {
  const valid = items.filter((i) => i.days != null);
  if (valid.length === 0) return null;
  return valid.reduce((min, i) => (i.days! < min.days! ? i : min));
}

// ═════════════════════════════════════════════════════════════
// Overview — ดึงข้อมูลจริงจากทุกโมดูลมาคำนวณ
// ═════════════════════════════════════════════════════════════

export interface AutonomyOverview {
  settings: SelfRelianceSettings;
  autonomy: AutonomyItem[];
  weakest: AutonomyItem | null;
  resources: {
    waterL: number;
    foodKg: number;
    fuelL: number;
    seedCount: number;
    medicineCount: number;
    toolCount: number;
    compostKg: number;
    compostDays: number | null;
    batterySocPct: number | null;
    avgPowerKw: number | null;
    batteryCapacityKwh: number;
    cashUsd: number | null;
    monthlyBurnUsd: number | null;
    moneyMonths: number | null;
  };
}

export async function buildAutonomyOverview(userId: string): Promise<AutonomyOverview> {
  const settings = await getSettings();

  // 1) สต็อกจาก Inventory — รวมเฉพาะ unit ที่แปลงได้ตรง
  const items = await prisma.inventoryItem.findMany({ where: { user_id: userId } });
  let waterL = 0, foodKg = 0, fuelL = 0, seedCount = 0, medicineCount = 0, toolCount = 0, compostKg = 0;
  for (const it of items) {
    const q = Number(it.quantity) || 0;
    const unit = String(it.unit || '').toLowerCase();
    if (it.category === 'WATER' && (unit === 'l' || unit === 'ลิตร' || unit === 'liter')) waterL += q;
    else if (it.category === 'FOOD' && unit === 'kg') foodKg += q;
    else if (it.category === 'FUEL' && (unit === 'l' || unit === 'ลิตร' || unit === 'liter')) fuelL += q;
    else if (it.category === 'SEED') seedCount++;
    else if (it.category === 'MEDICINE') medicineCount++;
    else if (it.category === 'TOOL') toolCount++;
    else if ((it.category === 'COMPOST' || it.category === 'FERTILIZER') && unit === 'kg') compostKg += q;
  }

  // 2) แบตเตอรี่จาก telemetry จริง (pattern เดียวกับ power-guard)
  let batterySocPct: number | null = null;
  let avgPowerKw: number | null = null;
  try {
    const socRows = await prisma.$queryRawUnsafe<Array<{ value: number }>>(
      `SELECT DISTINCT ON (metric) metric, value FROM sensor_telemetry WHERE metric = 'battery_soc' ORDER BY metric, time DESC`
    );
    if (socRows[0]) batterySocPct = Number(socRows[0].value);
    const avgRows = await prisma.$queryRawUnsafe<Array<{ avg: number }>>(
      `SELECT AVG(value) AS avg FROM sensor_telemetry WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
    );
    if (avgRows[0]?.avg != null) avgPowerKw = Number(avgRows[0].avg);
  } catch { /* Timescale ล่ม = ข้าม */ }
  const capacityKwh = parseFloat(process.env.ENERGY_CAPACITY_KWH || '5');

  // 3) เงินจาก BalanceSheet ของเจ้าของ
  let cashUsd: number | null = null, monthlyBurnUsd: number | null = null, moneyMonths: number | null = null;
  try {
    const sheet = await prisma.personalBalanceSheet.findUnique({ where: { user_id: userId } });
    if (sheet) {
      cashUsd = Number(sheet.liquid_cash_usd);
      monthlyBurnUsd = Number(sheet.monthly_burn_usd);
      if (monthlyBurnUsd > 0) moneyMonths = Math.round((cashUsd / monthlyBurnUsd) * 10) / 10;
      else if (cashUsd > 0) moneyMonths = null; // ไม่มี burn = นับ ∞ แต่แสดงไม่ได้เป็นตัวเลข
    }
  } catch { /* ข้าม */ }

  // 4) ประกอบเป็น autonomy items
  const waterDays = computeWaterDays(settings.waterTankL, settings.people, settings.waterLPerPersonDay);
  const foodDays = computeFoodDays(foodKg, settings.people, settings.foodKgPerPersonDay);
  const energyHours = computeEnergyHours(batterySocPct, capacityKwh, avgPowerKw);
  const energyDays = energyHours != null ? Math.round((energyHours / 24) * 10) / 10 : null;
  // compost: similar to food — assume 0.5kg compost per person per day needed for fields
  const compostDays = computeFoodDays(compostKg, settings.people, 0.5);
  const compostSelfSufficiency = compostDays != null && settings.targetDays > 0 ? Math.round((compostDays / settings.targetDays) * 100) : null;

  const autonomy: AutonomyItem[] = [
    {
      key: 'water', label: '💧 น้ำ', days: waterDays,
      detail: `${settings.waterTankL.toLocaleString()}L ÷ (${settings.people}คน × ${settings.waterLPerPersonDay}L) — สต็อกจริงในคลัง ${waterL.toLocaleString()}L`,
      ok: waterDays != null ? waterDays >= settings.targetDays : null,
    },
    {
      key: 'food', label: '🍚 อาหาร', days: foodDays,
      detail: `${foodKg.toLocaleString()}kg ในคลัง ÷ (${settings.people}คน × ${settings.foodKgPerPersonDay}kg)`,
      ok: foodDays != null ? foodDays >= settings.targetDays : null,
    },
    {
      key: 'energy', label: '⚡ ไฟ', days: energyDays,
      detail: batterySocPct != null
        ? `แบต ${batterySocPct.toFixed(0)}% × ${capacityKwh}kWh ÷ โหลดเฉลี่ย ${avgPowerKw != null ? avgPowerKw.toFixed(2) : '?'}kW = ${energyHours ?? '?'} ชม.`
        : 'ไม่มีข้อมูลแบตจากเซ็นเซอร์',
      ok: energyDays != null ? energyDays >= Math.max(1, settings.targetDays / 10) : null, // ไฟใช้มาตราส่วนต่าง — 1 วันก็ผ่านเกณฑ์ย่อย
    },
    {
      key: 'money', label: '💰 เงิน', days: moneyMonths != null ? Math.round(moneyMonths * 30.4) : null,
      detail: moneyMonths != null
        ? `เงินสด $${(cashUsd ?? 0).toLocaleString()} ÷ burn $${(monthlyBurnUsd ?? 0).toLocaleString()}/เดือน = ${moneyMonths} เดือน`
        : 'ยังไม่ตั้งงบดุล — ไปที่ /treasury กรอก',
      ok: moneyMonths != null ? moneyMonths >= 6 : null,
    },
    {
      key: 'fuel', label: '⛽ เชื้อเพลิง', days: null, // ขึ้นกับเครื่องใช้ — แสดงปริมาณก่อน
      detail: `สต็อก ${fuelL.toLocaleString()}L`,
      ok: fuelL >= 20 ? true : null,
    },
    {
      key: 'seed', label: '🌱 เมล็ดพันธุ์', days: null,
      detail: `${seedCount} รายการ — ปลูกได้ = อาหารไม่มีวันหมด`,
      ok: seedCount >= 3 ? true : null,
    },
    {
      key: 'medicine', label: '💊 ยา', days: null,
      detail: `${medicineCount} รายการ (ดู expiry ที่ /inventory)`,
      ok: medicineCount >= 3 ? true : null,
    },
    {
      key: 'compost', label: '♻️ ปุ๋ยหมัก', days: compostDays,
      detail: `${compostKg.toLocaleString()}kg ปุ๋ยหมักในคลัง ÷ (${settings.people}คน × 0.5kg/วัน) = ${compostDays ?? '?'} วัน${compostSelfSufficiency != null ? ` — ${compostSelfSufficiency}% ของเป้า ${settings.targetDays} วัน` : ''}`,
      ok: compostDays != null ? compostDays >= settings.targetDays : null,
    },
    {
      key: 'tool', label: '🔧 เครื่องมือ', days: null,
      detail: `${toolCount} รายการ`,
      ok: toolCount >= 3 ? true : null,
    },
  ];

  return {
    settings,
    autonomy,
    weakest: findWeakestLink(autonomy),
    resources: {
      waterL, foodKg, fuelL, seedCount, medicineCount, toolCount,
      compostKg, compostDays,
      batterySocPct, avgPowerKw, batteryCapacityKwh: capacityKwh,
      cashUsd, monthlyBurnUsd, moneyMonths,
    },
  };
}
