import { prisma } from '../lib/prisma';
import { callVision, VISION_MODEL, type CallVisionDeps } from './vision.service';
import { computeExpiryDate, isCategoryValid } from './inventory.service';

export { prisma };

export const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

export interface ProductLabel {
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
  unit_price_usd: number | null;
  expiry_date: string | null;
  shelf_life_days: number | null;
  notes: string | null;
  warnings: string[];
}

export const LABEL_PROMPT = [
  'You are an offline product label OCR assistant (Sovereign OS).',
  'Read the product label in the image and return ONLY valid JSON:',
  '{"name": "<product name>", "category": "<FOOD|WATER|FUEL|MATERIAL|PRECIOUS_METAL|OTHER>", "quantity": <number|null>, "unit": "<L|kg|piece|bottle|...>", "unit_price_usd": <number|null>, "expiry_date": "<YYYY-MM-DD|null>", "shelf_life_days": <number|null>, "notes": "<extra info, Thai>"}',
  'If the label is unreadable return {"name": "", "notes": "อ่านฉลากไม่ได้"}.',
  'No text outside the JSON.',
].join(' ');

// ── แปลงวันหมดอายุ (รองรับทั้งไทย/เทศ, ค.ศ./พ.ศ., 2-4 หลัก) ──
const THAI_MONTHS: Array<[RegExp, number]> = [
  [/มกราคม|ม\.ค/, 1], [/กุมภาพันธ์|ก\.พ/, 2], [/มีนาคม|มี\.ค/, 3], [/เมษายน|เม\.ย/, 4],
  [/พฤษภาคม|พ\.ค/, 5], [/มิถุนายน|มิ\.ย/, 6], [/กรกฎาคม|ก\.ค/, 7], [/สิงหาคม|ส\.ค/, 8],
  [/กันยายน|ก\.ย/, 9], [/ตุลาคม|ต\.ค/, 10], [/พฤศจิกายน|พ\.ย/, 11], [/ธันวาคม|ธ\.ค/, 12],
];

const EN_MONTHS: Array<[RegExp, number]> = [
  [/jan/i, 1], [/feb/i, 2], [/mar/i, 3], [/apr/i, 4], [/may/i, 5], [/jun/i, 6],
  [/jul/i, 7], [/aug/i, 8], [/sep/i, 9], [/oct/i, 10], [/nov/i, 11], [/dec/i, 12],
];

function toIso(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const year = y > 2500 ? y - 543 : y; // ปี พ.ศ. → ค.ศ.
  if (year < 1900 || year > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${dt.getUTCFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function endOfMonthIso(y: number, m: number): string | null {
  if (y > 2500) y -= 543;
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIso(y, m, last);
}

/** parse ข้อความวันหมดอายุ → ISO YYYY-MM-DD (null ถ้าอ่านไม่ออก) */
export function extractExpiry(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD/MM/YYYY หรือ DD/MM/YY (แบบไทย)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return toIso(y, Number(m[2]), Number(m[1]));
  }

  // เดือนอังกฤษ ขึ้นต้นด้วยเดือน: "Aug 15, 2026"
  m = s.match(/^([a-z]{3,9})\.?\s*,?\s*(\d{1,2})\b\s*,?\s*(\d{2,4})$/i);
  if (m) {
    const mnum = EN_MONTHS.find(([re]) => re.test(m![1]))?.[1];
    if (mnum) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      return toIso(y, mnum, Number(m[2]));
    }
  }

  // DD เดือนไทย/อังกฤษ YYYY (เช่น "15 ส.ค. 2569", "15 Aug 2026")
  for (const [re, month] of EN_MONTHS) {
    m = s.match(new RegExp(`(\\d{1,2})\\s*(?:${re.source}\\.?)\\s*[.,]?\\s*(\\d{2,4})`, 'i'));
    if (m) {
      let y = Number(m[2]);
      if (y < 100) y += 2000;
      return toIso(y, month, Number(m[1]));
    }
  }
  for (const [re, month] of THAI_MONTHS) {
    m = s.match(new RegExp(`(\\d{1,2})\\s*(?:${re.source}\\.?)\\s*(?:ค\\.ศ\\.|พ\\.ศ\\.)?\\s*(\\d{2,4})`));
    if (m) {
      let y = Number(m[2]);
      if (y < 100) y += 2000;
      return toIso(y, month, Number(m[1]));
    }
  }

  // เดือน/ปี (จบเดือน เช่น "08/2026", "Aug 2026", "2026-08")
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return endOfMonthIso(Number(m[2]), Number(m[1]));
  for (const [re, month] of EN_MONTHS) {
    m = s.match(new RegExp(`(?:${re.source}\\.?)\\s*,?\\s*(\\d{4})`, 'i'));
    if (m) return endOfMonthIso(Number(m[1]), month);
  }
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return endOfMonthIso(Number(m[1]), Number(m[2]));
  for (const [re, month] of THAI_MONTHS) {
    m = s.match(new RegExp(`(?:${re.source}\\.?)\\s*(?:ค\\.ศ\\.|พ\\.ศ\\.)?\\s*(\\d{2,4})`));
    if (m) {
      let y = Number(m[1]);
      if (y < 100) y += 2000;
      return endOfMonthIso(y, month);
    }
  }

  return null;
}

/** map หมวดจากฉลาก (ไทย/อังกฤษ) → หมวด Inventory */
export function mapCategory(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().trim();
  if (/(fuel|diesel|petrol|gasoline|lpg|น้ำมัน)/.test(s)) return 'FUEL';
  if (/(water|drink|น้ำดื่ม|น้ำเปล่า|น้ำกิ่ง|น้ำ)/.test(s)) return 'WATER';
  if (/(food|rice|milk|snack|nut|meat|egg|ข้าว|อาหาร|นม|ผลไม้|เนื้อ|ไข่|เครื่องปรุง)/.test(s)) return 'FOOD';
  if (/(gold|silver|ทอง)/.test(s)) return 'PRECIOUS_METAL';
  if (/(material|battery|tool|medicine|drug|medication|supplement|วัสดุ|แบตเตอรี่|ยา|เครื่องมือ|วิตามิน)/.test(s)) return 'MATERIAL';
  return 'OTHER';
}

/** extract JSON object จากข้อความตอบของโมเดล (กัน ``` fence / noise) */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text ?? '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  if (!candidate) return null;
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

function toNum(value: unknown, min: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}

/** parse คำตอบโมเดล → ProductLabel พร้อมคำเตือนแก้ไขด้วยตา */
export function parseLabelResponse(text: string): ProductLabel {
  const obj = extractJsonObject(text);
  const warnings: string[] = [];
  if (!obj) {
    return { name: '', category: 'OTHER', quantity: null, unit: 'piece', unit_price_usd: null, expiry_date: null, shelf_life_days: null, notes: null, warnings: ['ไม่สามารถอ่านฉลากได้ (โมเดลไม่คืน JSON)'] };
  }

  const name = String(obj.name ?? '').trim();
  if (!name) warnings.push('อ่านชื่อสินค้าไม่ได้ — ป้อนเอง');

  let category = String(obj.category ?? '').trim().toUpperCase();
  if (!isCategoryValid(category)) {
    warnings.push('หมวดไม่ตรงระบบ — ตั้งเป็น OTHER');
    category = 'OTHER';
  }

  const expiryRaw = obj.expiry_date != null && obj.expiry_date !== '' ? String(obj.expiry_date) : null;
  const expiry = extractExpiry(expiryRaw);
  if (expiryRaw && !expiry) warnings.push('วันหมดอายุอ่านไม่ชัดเจน — ตรวจสอบด้วยตา');

  const shelf = toNum(obj.shelf_life_days, 1);
  const qty = toNum(obj.quantity, 0);
  const price = toNum(obj.unit_price_usd, 0);
  const unit = String(obj.unit ?? 'piece').trim().slice(0, 16) || 'piece';
  const notes = String(obj.notes ?? '').trim().slice(0, 500) || null;

  return { name, category, quantity: qty, unit, unit_price_usd: price, expiry_date: expiry, shelf_life_days: shelf != null ? Math.floor(shelf) : null, notes, warnings };
}

/** วิเคราะห์ฉลากจากภาพ (OCR ผ่าน qwen3-vl) — ไม่บันทึกอะไร */
export async function analyzeProductLabel(base64: string, deps: CallVisionDeps = {}): Promise<ProductLabel> {
  const text = await callVision(base64, LABEL_PROMPT, deps);
  return parseLabelResponse(text);
}

/** บันทึกสินค้าเข้าคลัง (หลังคนยืนยันจาก preview) — คำนวณ expiry จาก shelf_life_days เหมือน /api/inventory
 *  user_id = เจ้าของ (req.user.id จาก caller) — เสบียงแยกต่อคน */
export async function createInventoryItem(label: ProductLabel, userId?: string): Promise<string> {
  let expiry: Date | null = null;
  if (label.expiry_date) {
    const parsed = new Date(`${label.expiry_date}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) expiry = parsed;
  }
  if (expiry == null && label.shelf_life_days != null) expiry = computeExpiryDate(label.shelf_life_days);
  const item = await prisma.inventoryItem.create({
    data: {
      user_id: userId || '',
      name: label.name,
      category: label.category,
      quantity: label.quantity ?? 0,
      unit: label.unit || 'piece',
      unit_price_usd: label.unit_price_usd ?? 0,
      location: null,
      expiry_date: expiry,
      shelf_life_days: label.shelf_life_days,
      notes: label.notes ?? (label.warnings.length ? `[สแกนฉลาก AI] ${label.warnings.join('; ')}` : null),
    },
  });
  return item.id;
}

export { VISION_MODEL };