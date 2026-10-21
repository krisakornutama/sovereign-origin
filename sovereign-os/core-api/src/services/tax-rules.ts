/**
 * Tax Rules — ตัวโหลด/ตรวจไฟล์ override ภาษี (`data/tax-rules.json`)
 *
 * กติกาความปลอดภัยทางการเงิน:
 *   1) ค่าเริ่มต้นอยู่ในโค้ด (`RATES` ใน thai-tax.service.ts) — ไฟล์เป็น "ส่วนเพิ่ม" เท่านั้น
 *   2) ไฟล์เสีย/ผิดรูป/พิมพ์คีย์ผิด = **ไม่ใช้ไฟล์ทั้งใบ** แล้วคำนวณด้วยค่าเดิม (fail-closed)
 *   3) ขั้นบันไดต้องเรียงขึ้นและขั้นสุดท้ายต้องเปิด (upTo = null) — กันภาษีเพี้ยนเงียบ ๆ
 *   4) `effectiveFrom` ในอนาคต = ยังไม่ใช้ (เตรียมล่วงหน้าได้)
 *
 * ไฟล์ตัวอย่าง (ไม่สร้างอัตโนมัติ — เจ้าของวางเองเมื่อมีกฎหมายใหม่):
 * {
 *   "version": "2027-01",
 *   "effectiveFrom": "2027-01-01",
 *   "CIT_STANDARD": 0.2,
 *   "PIT": { "PERSONAL_ALLOWANCE": 60000, "BRACKETS": [{ "upTo": 150000, "rate": 0 }, { "upTo": null, "rate": 0.35 }] }
 * }
 */

/** ขั้นบันไดใน "ไฟล์" — null = ไม่มีเพดาน (ขั้นสุดท้าย) */
export type TaxBracketConfig = { upTo: number | null; rate: number };

/** ขั้นบันไดตอนใช้งานจริง — upTo = Infinity สำหรับขั้นสุดท้าย */
export type TaxBracket = { upTo: number; rate: number };

/** รูปที่คำนวณใช้จริง (ทุกค่าต้องเป็นตัวเลข finite ยกเว้นขั้นสุดท้ายที่ Infinity) */
export type TaxRules = {
  VAT: { REDUCED: number; REDUCED_UNTIL: string; STANDARD: number };
  SME_CIT: { CAPITAL_CAP: number; REVENUE_CAP: number; BRACKETS: TaxBracket[] };
  CIT_STANDARD: number;
  PIT: { PERSONAL_ALLOWANCE: number; BRACKETS: TaxBracket[] };
};

/** รูปที่รับจากไฟล์ (ทุกส่วนเป็น optional) */
export type TaxRulesFile = {
  version?: string;
  effectiveFrom?: string;
  VAT?: Partial<{ REDUCED: number; REDUCED_UNTIL: string; STANDARD: number }>;
  SME_CIT?: Partial<{ CAPITAL_CAP: number; REVENUE_CAP: number; BRACKETS: TaxBracketConfig[] }>;
  CIT_STANDARD?: number;
  PIT?: Partial<{ PERSONAL_ALLOWANCE: number; BRACKETS: TaxBracketConfig[] }>;
};

const TOP_KEYS = new Set(['version', 'effectiveFrom', 'VAT', 'SME_CIT', 'CIT_STANDARD', 'PIT']);
const VAT_KEYS = new Set(['REDUCED', 'REDUCED_UNTIL', 'STANDARD']);
const SME_KEYS = new Set(['CAPITAL_CAP', 'REVENUE_CAP', 'BRACKETS']);
const PIT_KEYS = new Set(['PERSONAL_ALLOWANCE', 'BRACKETS']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** อัตราภาษีต้องอยู่ 0–1 (0.07 = 7%) */
function checkRate(value: unknown, label: string, errors: string[]): number | undefined {
  if (!isFiniteNumber(value)) {
    errors.push(`${label} ต้องเป็นตัวเลข`);
    return undefined;
  }
  if (value < 0 || value > 1) {
    errors.push(`${label} ต้องอยู่ระหว่าง 0 ถึง 1 (พบ ${value})`);
    return undefined;
  }
  return value;
}

/** ขั้นบันได: เรียงขึ้น, rate 0–1, ขั้นสุดท้ายต้องเป็น null (เปิด) เท่านั้น */
function checkBrackets(value: unknown, label: string, errors: string[]): TaxBracketConfig[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} ต้องเป็น array ที่มีอย่างน้อย 1 ขั้น`);
    return undefined;
  }
  const out: TaxBracketConfig[] = [];
  let prev = 0;
  value.forEach((item, i) => {
    const at = `${label}[${i}]`;
    if (!isObject(item)) {
      errors.push(`${at} ต้องเป็น object { upTo, rate }`);
      return;
    }
    for (const k of Object.keys(item)) {
      if (k !== 'upTo' && k !== 'rate') errors.push(`${at} ไม่รู้จักคีย์ "${k}"`);
    }
    const rate = checkRate(item.rate, `${at}.rate`, errors);
    const upTo = item.upTo;
    if (upTo === null) {
      out.push({ upTo: null, rate: rate ?? 0 });
      return;
    }
    if (!isFiniteNumber(upTo) || upTo <= 0) {
      errors.push(`${at}.upTo ต้องเป็นตัวเลข > 0 หรือ null (ขั้นสุดท้าย)`);
      return;
    }
    if (upTo <= prev) errors.push(`${at}.upTo ต้องมากกว่าขั้นก่อนหน้า (${prev})`);
    prev = upTo;
    out.push({ upTo, rate: rate ?? 0 });
  });
  const last = out.at(-1);
  if (!last || last.upTo !== null) {
    errors.push(`${label} ขั้นสุดท้ายต้องเป็น { "upTo": null } (เปิดไม่จำกัด) — พบขั้นสุดท้ายเป็นเพดานจำกัด`);
  }
  if (out.some((b, i) => b.upTo === null && i !== out.length - 1)) {
    errors.push(`${label} ห้ามมี null กลางรายการ — ต้องเป็นขั้นสุดท้ายเท่านั้น`);
  }
  return out;
}

/**
 * ตรวจไฟล์ override แบบเข้ม — คืน errors ทั้งหมด (ไม่หยุดข้อแรก)
 * ไม่ throw: ผู้เรียกใช้ errors เพื่อ fallback
 */
export function validateTaxRulesFile(
  raw: unknown,
  now: Date = new Date()
): { ok: boolean; errors: string[]; value?: TaxRulesFile } {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['root ต้องเป็น JSON object'] };

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) errors.push(`ไม่รู้จักคีย์ "${key}" — ตรวจการพิมพ์ (ตัวพิมพ์ใหญ่/เล็กต้องตรง)`);
  }

  if (raw.version !== undefined && typeof raw.version !== 'string') {
    errors.push('version ต้องเป็น string');
  }

  if (raw.effectiveFrom !== undefined) {
    if (!isIsoDate(raw.effectiveFrom)) {
      errors.push('effectiveFrom ต้องเป็นวันที่รูปแบบ YYYY-MM-DD');
    } else if (Date.parse(raw.effectiveFrom) > now.getTime()) {
      errors.push(`effectiveFrom ${raw.effectiveFrom} ยังไม่ถึง — ยังไม่ใช้ไฟล์นี้`);
    }
  }

  if (raw.VAT !== undefined) {
    if (!isObject(raw.VAT)) errors.push('VAT ต้องเป็น object');
    else {
      for (const k of Object.keys(raw.VAT)) if (!VAT_KEYS.has(k)) errors.push(`VAT ไม่รู้จักคีย์ "${k}"`);
      checkRate(raw.VAT.REDUCED, 'VAT.REDUCED', errors);
      checkRate(raw.VAT.STANDARD, 'VAT.STANDARD', errors);
      if (raw.VAT.REDUCED_UNTIL !== undefined && !isIsoDate(raw.VAT.REDUCED_UNTIL)) {
        errors.push('VAT.REDUCED_UNTIL ต้องเป็นวันที่รูปแบบ YYYY-MM-DD');
      }
    }
  }

  if (raw.SME_CIT !== undefined) {
    if (!isObject(raw.SME_CIT)) errors.push('SME_CIT ต้องเป็น object');
    else {
      for (const k of Object.keys(raw.SME_CIT)) if (!SME_KEYS.has(k)) errors.push(`SME_CIT ไม่รู้จักคีย์ "${k}"`);
      for (const cap of ['CAPITAL_CAP', 'REVENUE_CAP'] as const) {
        const v = raw.SME_CIT[cap];
        if (v !== undefined && (!isFiniteNumber(v) || v < 0)) errors.push(`SME_CIT.${cap} ต้องเป็นตัวเลข ≥ 0`);
      }
      if (raw.SME_CIT.BRACKETS !== undefined) checkBrackets(raw.SME_CIT.BRACKETS, 'SME_CIT.BRACKETS', errors);
    }
  }

  if (raw.CIT_STANDARD !== undefined) checkRate(raw.CIT_STANDARD, 'CIT_STANDARD', errors);

  if (raw.PIT !== undefined) {
    if (!isObject(raw.PIT)) errors.push('PIT ต้องเป็น object');
    else {
      for (const k of Object.keys(raw.PIT)) if (!PIT_KEYS.has(k)) errors.push(`PIT ไม่รู้จักคีย์ "${k}"`);
      const allowance = raw.PIT.PERSONAL_ALLOWANCE;
      if (allowance !== undefined && (!isFiniteNumber(allowance) || allowance < 0)) {
        errors.push('PIT.PERSONAL_ALLOWANCE ต้องเป็นตัวเลข ≥ 0');
      }
      if (raw.PIT.BRACKETS !== undefined) checkBrackets(raw.PIT.BRACKETS, 'PIT.BRACKETS', errors);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: raw as TaxRulesFile };
}

/** แปลงขั้นบันไดจากไฟล์ (null) → ตอนใช้งาน (Infinity) */
export function toRuntimeBrackets(brackets: TaxBracketConfig[]): TaxBracket[] {
  return brackets.map((b) => ({ upTo: b.upTo === null ? Infinity : b.upTo, rate: b.rate }));
}

/**
 * รวมค่าเริ่มต้นกับ override — ส่วนที่ไม่ได้ระบุใช้ค่าเดิม
 * ขั้นบันไดถ้าระบุมาจะ "แทนทั้งชุด" (ไม่ผสมขั้นเก่า/ใหม่ให้สับสน)
 */
export function mergeTaxRules(base: TaxRules, file: TaxRulesFile): TaxRules {
  return {
    VAT: { ...base.VAT, ...(file.VAT ?? {}) },
    SME_CIT: {
      CAPITAL_CAP: file.SME_CIT?.CAPITAL_CAP ?? base.SME_CIT.CAPITAL_CAP,
      REVENUE_CAP: file.SME_CIT?.REVENUE_CAP ?? base.SME_CIT.REVENUE_CAP,
      BRACKETS: file.SME_CIT?.BRACKETS ? toRuntimeBrackets(file.SME_CIT.BRACKETS) : base.SME_CIT.BRACKETS,
    },
    CIT_STANDARD: file.CIT_STANDARD ?? base.CIT_STANDARD,
    PIT: {
      PERSONAL_ALLOWANCE: file.PIT?.PERSONAL_ALLOWANCE ?? base.PIT.PERSONAL_ALLOWANCE,
      BRACKETS: file.PIT?.BRACKETS ? toRuntimeBrackets(file.PIT.BRACKETS) : base.PIT.BRACKETS,
    },
  };
}
