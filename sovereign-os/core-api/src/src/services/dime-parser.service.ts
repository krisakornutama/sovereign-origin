// ─────────────────────────────────────────────────────────────────────────────
// Dime! Statement Parser — แยกยอดถือครองหุ้น US จากสเตตเมนต์ PDF
// (ข้อความที่ extract ออกมาจาก pdf-parse แล้ว)
//
// วงจรการอ่าน: หา section "US Stocks / Foreign Securities" → แถวข้อมูล
//   Ticker | ชื่อบริษัท | จำนวน (shares) | ต้นทุนเฉลี่ย (avg cost) | ราคา (price) | มูลค่า (market value)
// → validate: shares > 0, ตัวเลขไม่ติดลบ, total_value ≈ shares × price (ทน 1%)
// → แถวที่ validate ไม่ผ่าน: ข้าม + บันทึกเหตุผล (ไม่หยุดทั้งไฟล์)
//
// Pure functions — ไม่แตะ DB / ไม่อ่าน env / ไม่ hardcode ความลับ
// ─────────────────────────────────────────────────────────────────────────────

export interface DimeParsedAsset {
  statement_period: string; // "YYYY-MM"
  ticker: string;
  company_name: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  total_value: number;
  currency: 'USD';
  // คอลัมน์เพิ่มในตารางจริงของ Dime! (หน้า 3) — optional กันข้อมูลเก่าที่ import ไปแล้ว
  allocation_pct?: number | null; // สัดส่วนในพอร์ต (%) เช่น 51.31
  total_return_pct?: number | null; // ผลตอบแทนรวม (%) เช่น -15.81
  total_return_usd?: number | null; // ผลตอบแทนรวม ($) เช่น -227.45
}

export interface DimeSkippedRow {
  line: string;
  ticker?: string;
  reason: string;
}

// ── สรุปหน้าแรก (page 1) ของสเตตเมนต์ ──

export interface DimeSectorAllocation {
  name: string; // เช่น "Basic Materials"
  value_usd: number;
  pct: number; // สัดส่วน % ของพอร์ต
}

export interface DimeStatementSummary {
  account_no: string | null; // เช่น "47170"
  investment_account_no: string | null; // เช่น "1478800017601"
  tax_id: string | null; // เช่น "0105564162055"
  tax_invoice_no: string | null; // เช่น "80000395380"
  branch_no: string | null; // เช่น "00000"
  fx_rate: number | null; // 1 USD = ? THB
  total_balance_usd: number | null;
  total_balance_thb: number | null;
  cash_balance_usd: number | null;
  cash_balance_thb: number | null;
  total_return_pct: number | null; // เช่น -20.25
  total_return_usd: number | null; // เช่น -599.56
  sectors: DimeSectorAllocation[];
}

export function emptyStatementSummary(): DimeStatementSummary {
  return {
    account_no: null,
    investment_account_no: null,
    tax_id: null,
    tax_invoice_no: null,
    branch_no: null,
    fx_rate: null,
    total_balance_usd: null,
    total_balance_thb: null,
    cash_balance_usd: null,
    cash_balance_thb: null,
    total_return_pct: null,
    total_return_usd: null,
    sectors: [],
  };
}

export interface DimeParseResult {
  period: string | null;
  sectionFound: boolean;
  sectionText: string; // ข้อความดิบเฉพาะ section — ใช้ hash กัน duplicate
  assets: DimeParsedAsset[];
  skipped: DimeSkippedRow[];
  summary: DimeStatementSummary; // ยอดรวม/เงินสด/FX/เลขบัญชี จากหน้าแรก
}

// ── ตัวแปรเดือนไทย/อังกฤษ — ใช้หา statement period ──

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};

const THAI_MONTHS_SHORT: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function toYmd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** หา "YYYY-MM" จาก subject + ข้อความ: ไทย (เต็ม/ย่อ, ปี พ.ศ.), อังกฤษ, หรือตัวเลข */
export function detectStatementPeriod(
  text: string,
  subject: string | undefined,
  now: Date = new Date()
): string | null {
  const combined = `${subject ?? ''}\n${text}`;

  // 1) ไทยเต็ม: "สิงหาคม 2569" (ปี พ.ศ. → ค.ศ. -543)
  for (const [name, m] of Object.entries(THAI_MONTHS)) {
    const re = new RegExp(`${name}\\s*(\\d{4})`);
    const hit = combined.match(re);
    if (hit) {
      const y = Number(hit[1]);
      const year = y > 2500 ? y - 543 : y; // 2540+ = พ.ศ.
      if (year >= 2000 && year <= 2100) return toYmd(year, m);
    }
  }

  // 2) ไทยย่อ: "ส.ค. 2569" (ต้อง escape จุด)
  for (const [name, m] of Object.entries(THAI_MONTHS_SHORT)) {
    const re = new RegExp(`${name.replace(/\./g, '\\.')}\\s*(\\d{4})`);
    const hit = combined.match(re);
    if (hit) {
      const y = Number(hit[1]);
      const year = y > 2500 ? y - 543 : y;
      if (year >= 2000 && year <= 2100) return toYmd(year, m);
    }
  }

  // 3) อังกฤษ: "August 2026"
  const enHit = combined.match(/([A-Za-z]+)\s+(\d{4})/);
  if (enHit) {
    const m = EN_MONTHS[enHit[1].toLowerCase()];
    const year = Number(enHit[2]);
    if (m && year >= 2000 && year <= 2100) return toYmd(year, m);
  }

  // 4) ตัวเลข: "2026-08" / "08/2026"
  const yyyyMm = combined.match(/(\d{4})\s*[-/]\s*(\d{1,2})/);
  if (yyyyMm) {
    const y = Number(yyyyMm[1]);
    const m = Number(yyyyMm[2]);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) return toYmd(y, m);
  }
  const mmYyyy = combined.match(/(\d{1,2})\s*[-/]\s*(\d{4})/);
  if (mmYyyy) {
    const m = Number(mmYyyy[1]);
    const y = Number(mmYyyy[2]);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) return toYmd(y, m);
  }

  // 5) fallback: เดือนปัจจุบัน
  return toYmd(now.getFullYear(), now.getMonth() + 1);
}

// ── section US Stocks ──
// ของจริง (Dime!): "Common Stock" เป็นคอลัมน์, หัวตาราง "Stock Name", และไทยอาจอ่านเป็นขยะ
// (ฟอนต์ subset) → พึ่งคำอังกฤษ; "Stock Name" กันชนกับชื่อบริษัทที่มีคำว่า "Common Stock" พ่วงท้าย
const SECTION_START_RE = /(US\s*STOCKS?|FOREIGN\s+SECURIT|OFFSHORE\s+SECURIT|COMMON\s*STOCK|หุ้นสหรัฐ|หลักทรัพย์ต่างประเทศ)/i;
// หัวข้อ section อื่นที่คั่นสต๊อกสหรัฐ: ไทย/ตราสารหนี้/กองทุน/สรุป/เงินสด/หมายเหตุ...
// แถวข้อมูล (ขึ้นต้นด้วย ticker + มีตัวเลข) จะไม่ถูกตีความเป็นตัวคั่น
const SECTION_END_RE = /^(THAI\s*STOCKS?|SET\b|หุ้นไทย|BONDS?|ตราสารหนี้|FUNDS?|กองทุน|SUMMARY|สรุป|PORTFOLIO|CASH|เงินสด|NOTE|หมายเหตุ|ขอบคุณ|INVESTMENT\s*ACCOUNT|บัญชีลงทุน|ACCOUNT\s+STATEMENT|ข้อมูลบัญชี|ข้อความ|รายงาน|TOTAL\b(?!\s+RETURN)|รวม)/i;

const TICKER_RE = /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/;

export interface StockSection {
  sectionFound: boolean;
  sectionText: string;
}

/** หาบรรทัดเริ่ม section — ชอบ "Stock Name" (หัวคอลัมน์) ก่อน, กันชนกับชื่อบริษัท "…Common Stock" */
function findSectionStart(lines: string[]): number {
  let fallback = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/STOCK\s*NAME/i.test(lines[i])) return i;
    if (fallback < 0 && SECTION_START_RE.test(lines[i])) fallback = i;
  }
  return fallback;
}

/** ตัดเฉพาะ section หุ้น US ออกจากข้อความเต็ม (หยุดที่ section ถัดไป / หมดข้อความ) */
export function extractUsStocksSection(text: string): StockSection {
  const lines = text.split(/\r?\n/);
  const start = findSectionStart(lines);
  if (start < 0) return { sectionFound: false, sectionText: '' };

  const collected: string[] = [];
  const maxLines = Math.min(lines.length, start + 400); // safety valve
  for (let i = start + 1; i < maxLines; i++) {
    const line = lines[i].trim();
    if (!line) {
      collected.push(line);
      continue;
    }
    // แถวข้อมูลจริง (ticker + ตัวเลข ≥ 4) — ไม่ใช่ตัวคั่น
    const tokens = line.split(/\s+/);
    if (TICKER_RE.test(tokens[0]) && countNumeric(tokens.slice(1)) >= 4) {
      collected.push(line);
      continue;
    }
    if (SECTION_END_RE.test(line)) break;
    collected.push(line);
  }
  return { sectionFound: true, sectionText: collected.join('\n') };
}

function countNumeric(tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (toNumber(t) !== null) n++;
  return n;
}

/** แปลงข้อความเงิน ("1,211.47") → ตัวเลข (ลบ comma) */
export function parseMoney(s: string): number {
  return Number(s.replace(/,/g, '').trim());
}

/**
 * ดึงค่าคอลัมน์เพิ่มของแถวหุ้นจากข้อความดิบติดกันของ Dime!:
 * "51.31%302.86648024.754.00- 15.81%- 227.451,211.47"
 *   → allocation 51.31% | total return -15.81% | total return -$227.45
 * กติกา: % ตัวแรก = สัดส่วนพอร์ต, % ตัวที่ 2 (มีเครื่องหมาย) = ผลตอบแทน %;
 * จำนวนเงินที่มีเครื่องหมายนำหน้าตัวสุดท้าย = ผลตอบแทน $ (ขาดทุน = ติดลบ)
 */
export function extractRowMetrics(raw: string): {
  allocationPct: number | null;
  totalReturnPct: number | null;
  totalReturnUsd: number | null;
} {
  const pcts: number[] = [];
  for (const m of raw.matchAll(/([-+]?)\s*(\d+\.?\d*)%/g)) {
    const v = Number(m[2]);
    pcts.push(m[1] === '-' ? -v : v);
  }
  const signed: number[] = [];
  for (const m of raw.replace(/%/g, '').matchAll(/[-+]\s*([\d,]+\.\d{2})/g)) {
    signed.push(parseMoney(m[1]));
  }
  return {
    allocationPct: pcts.length ? Math.abs(pcts[0]) : null,
    totalReturnPct: pcts.length > 1 ? pcts[1] : null,
    totalReturnUsd: signed.length ? -signed[signed.length - 1] : null,
  };
}

/** แถวรวมท้าย section (ของจริง: "รวม100.00%- 20.25%- 599.562,361.19") — ใช้เป็น fallback */
const SECTION_TOTAL_ROW_RE = /(?:รวม)?\s*100\.00%.*?[-+]\s*\d+\.\d{2}%/;

function parseMoneyValue(s: string): number {
  return parseMoney(s.replace(/USD|THB|≈|,/gi, '').trim());
}

/** หาค่าเงินที่อยู่ใกล้ label ที่สุด (pdf.js เรียงบรรทัดสลับหน้า/หลัง label ได้ —
 *  ต้องใกล้สุด กันเจอยอดอื่นที่อยู่ใน window ก่อน เช่น Cash Balance โดน Total Balance แย่ง) */
function valueNearLabel(
  lines: string[],
  labelRe: RegExp,
  valueRe: RegExp,
  maxDist = 8
): number | null {
  const labelIdx = lines.findIndex((l) => labelRe.test(l));
  if (labelIdx < 0) return null;
  const from = Math.max(0, labelIdx - maxDist);
  const to = Math.min(lines.length, labelIdx + maxDist);
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = from; i < to; i++) {
    const m = lines[i].match(valueRe);
    if (!m || !m[1]) continue;
    const dist = Math.abs(i - labelIdx);
    if (dist < bestDist) {
      const v = parseMoneyValue(m[1]);
      if (Number.isFinite(v)) {
        best = v;
        bestDist = dist;
      }
    }
  }
  return best;
}

const USD_RE = /([\d,]+\.\d{2})\s*USD/i;
const THB_RE = /([\d,]+\.\d{2})\s*THB/i;

/** sector allocation หน้าแรก — ระหว่าง "Allocation Group by Sector" กับจุดสิ้นสุด (หน้าใหม่/section หุ้น) */
export function extractSectorAllocations(text: string): DimeSectorAllocation[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const SECTOR_LABEL_RE = /Allocation\s+Group\s+by\s+Sector|สัดส่วนการลงทุนจัดกลุ่มโดยกลุ่มอุตสาหกรรม/i;
  // ใช้ label บรรทัดสุดท้าย (ไทยตามด้วยอังกฤษ → อังกฤษอยู่ท้ายสุด ข้อมูลเริ่มต่อจากนั้น)
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTOR_LABEL_RE.test(lines[i])) startIdx = i;
  }
  if (startIdx < 0) return [];

  const out: DimeSectorAllocation[] = [];
  let current: { name: string; valueUsd: number | null } | null = null;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    // จุดจบ: ตัวเลขหน้า / หัวตารางหุ้น / footer
    if (/^\d{1,2}\s*\/|หน้าที่|Stock\s*Name|L&I/i.test(l)) break;
    if (/^≈/.test(l)) continue;
    const usd = l.match(USD_RE);
    if (usd) {
      if (current) current.valueUsd = parseMoneyValue(usd[1]);
      continue;
    }
    if (THB_RE.test(l)) continue;
    const pct = l.match(/^(\d+\.\d{2})%$/);
    if (pct) {
      if (current && current.valueUsd !== null) {
        out.push({ name: current.name, value_usd: current.valueUsd, pct: Number(pct[1]) });
      }
      current = null;
      continue;
    }
    if (/^\d/.test(l)) continue;
    // ชื่อ sector — บรรทัดไทยตามด้วยอังกฤษ → บรรทัดหลังสุดชนะ
    if (current === null) current = { name: l, valueUsd: null };
    else current.name = l;
  }
  return out;
}

/**
 * สรุปหน้าแรกของสเตตเมนต์: เลขบัญชี/Tax ID, FX, ยอดรวม/เงินสด, ผลตอบแทนรวม,
 * และ sector allocation. text จาก pdf.js เรียงบรรทัดไม่เป็นระเบียบ → หาแบบ window รอบ label
 */
export function extractStatementSummary(text: string): DimeStatementSummary {
  const summary = emptyStatementSummary();
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // ── เลขบัญชี: หา label "เลขที่บัญชีหลักทรัพย์ต่างประเทศ" แล้วไล่ย้อนหลัง
  //    ตัวเลขที่ใกล้ label สุด (2 ตัว) — กันปนกับ Tax ID/เลขใบกำกับภาษีที่อยู่สูงกว่า
  const acctLabelIdx = lines.findIndex(
    (l) => l.includes('เลขที่บัญชีหลักทรัพย์ต่างประเทศ') || /Offshore\s*Securities\s*Account\s*No/i.test(l)
  );
  if (acctLabelIdx >= 0) {
    let found = 0;
    for (let i = acctLabelIdx - 1; i >= 0 && found < 2; i--) {
      const m = lines[i].match(/^\d{5,17}$/);
      if (!m) continue;
      if (m[0].length >= 10) summary.investment_account_no ??= m[0];
      else summary.account_no ??= m[0];
      found++;
    }
  }

  // ── เลขภาษี / เลขใบกำกับ / สาขา
  summary.tax_id = text.match(/\b\d{13}\b/)?.[0] ?? null;
  summary.tax_invoice_no = text.match(/\b8\d{10}\b/)?.[0] ?? null;
  summary.branch_no = text.match(/(?:Branch\s*No\.?|เลขที่สาขา)\s*(\d+)/i)?.[1] ?? null;

  // ── อัตราแลกเปลี่ยน: "1 USD = 33.25 THB"
  const fx = text.match(/1\s*USD\s*=\s*([\d.]+)/i);
  if (fx) summary.fx_rate = Number(fx[1]);

  // ── ยอดรวม / เงินสด (ค่าเงินอาจอยู่ก่อนหรือหลัง label)
  summary.total_balance_usd = valueNearLabel(lines, /Total\s*Balance/i, USD_RE);
  summary.total_balance_thb = valueNearLabel(lines, /Total\s*Balance/i, THB_RE);
  summary.cash_balance_usd = valueNearLabel(lines, /Cash\s*Balance/i, USD_RE);
  summary.cash_balance_thb = valueNearLabel(lines, /Cash\s*Balance/i, THB_RE);

  // ── ผลตอบแทนรวม: " - 20.25% (- 599.56 USD)" ใกล้ label "Investment Return"
  const trLabelIdx = lines.findIndex((l) => /Investment\s*Return/i.test(l));
  const trRegion = trLabelIdx >= 0
    ? lines.slice(Math.max(0, trLabelIdx - 4), Math.min(lines.length, trLabelIdx + 4)).join(' ')
    : '';
  const trHit = trRegion.match(/([-+]\s*)?(\d+\.\d{2})%\s*\(\s*([-+]\s*)?([\d,]+\.\d{2})\s*USD/i);
  if (trHit) {
    summary.total_return_pct = trHit[1] ? -Math.abs(Number(trHit[2])) : Number(trHit[2]);
    summary.total_return_usd = trHit[3] ? -Math.abs(parseMoneyValue(trHit[4])) : parseMoneyValue(trHit[4]);
  } else {
    // fallback: แถวรวมท้าย section (ครอบคลุมสเตตเมนต์ที่ไม่มี label หน้าแรก)
    const totalRow = lines.find((l) => SECTION_TOTAL_ROW_RE.test(l));
    if (totalRow) {
      const metrics = extractRowMetrics(totalRow);
      summary.total_return_pct = metrics.totalReturnPct;
      summary.total_return_usd = metrics.totalReturnUsd;
      if (summary.total_balance_usd === null) {
        const nums = extractNumbers(totalRow);
        if (nums.length) summary.total_balance_usd = nums[nums.length - 1];
      }
    }
  }

  summary.sectors = extractSectorAllocations(text);
  return summary;
}

/** แปลง token เป็นตัวเลข: ลบ , ฿ $ () → ลบ, "12-" → ติดลบ, %/ตัวอักษร → null */
export function toNumber(token: string): number | null {
  let t = token.trim();
  if (!t) return null;
  if (t.endsWith('%')) return null; // คอลัมน์ % (P/L) ไม่ใช่ยอดจริง
  if (t.startsWith('(') && t.endsWith(')')) {
    const v = Number(t.slice(1, -1).replace(/,/g, ''));
    return Number.isFinite(v) ? -v : null;
  }
  t = t.replace(/,/g, '').replace(/[฿$€]/g, '').replace(/^\+/, '');
  if (t.endsWith('-')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? -v : null;
  }
  if (/[A-Za-z]/.test(t)) return null; // "1.2k", "USD" ไม่นับ
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

interface ParsedRow {
  ticker: string;
  company: string;
  numbers: number[];
  raw: string; // ข้อความตัวเลข (อาจติดกัน) — ใช้ extractNumbers + หา price จาก substring
  line: string;
}

/**
 * แยกตัวเลขออกจากข้อความที่ "ติดกัน" (ไฟล์จริงจาก Dime! มักไม่มีช่องว่าง เช่น
 * "51.31%302.86648024.754.00- 15.81%- 227.451,211.47")
 *
 * กติกา: int หรือ int.XX (ทศนิยม 2 หลักเป๊ะ) — เลือกตัด 2 หลักทันทีเมื่อมีจุด
 * เพื่อกันตัวเลขต่อกันปนเป็นก้อนเดียว; ตัวเลขที่ตามด้วย % (allocation, P/L %) ถูกตัดทิ้ง
 * (ขยะ/ตัวเลขที่รวมผิดทนได้ — validation คณิตศาสตร์คัดอีกชั้น)
 */
export function extractNumbers(line: string): number[] {
  const out: number[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (!(c >= '0' && c <= '9') && c !== '-') {
      i++;
      continue;
    }
    let j = i;
    if (line[j] === '-') j++;
    const intStart = j;
    while (j < n && ((line[j] >= '0' && line[j] <= '9') || line[j] === ',')) j++;
    if (j === intStart) {
      i++;
      continue;
    }
    if (j < n && line[j] === '.') {
      let k = j + 1;
      const dStart = k;
      while (k < n && line[k] >= '0' && line[k] <= '9') k++;
      if (k - dStart >= 2) j = dStart + 2; // ตัด 2 ทศนิยมเป๊ะ
      else j = k;                          // ทศนิยม 1 หลัก หรือ "12." → เก็บเท่าที่มี
    }
    if (j < n && line[j] === '%') {
      i = j + 1; // allocation / P/L % → ไม่ใช่ยอด ข้าม
      continue;
    }
    const v = Number(line.slice(i, j).replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
    i = j;
  }
  return out;
}

/** parse แถวสต๊อกหนึ่งแถว: ticker → ชื่อบริษัท → [..ตัวเลข..] (ตัวเลข 4 ท้าย = qty, avg, price, value) */
export function parseStockRow(line: string): ParsedRow | null {
  const tokens = line.split(/\s+/);
  if (!TICKER_RE.test(tokens[0])) return null;

  const numbered: Array<{ idx: number; v: number }> = [];
  for (let i = 1; i < tokens.length; i++) {
    const v = toNumber(tokens[i]);
    if (v !== null) numbered.push({ idx: i, v });
  }
  if (numbered.length < 4) return null;

  const companyTokens = tokens.slice(1, numbered[numbered.length - 4].idx);
  const company = companyTokens.join(' ').replace(/["'`]+/g, '').trim();

  return {
    ticker: tokens[0],
    company,
    numbers: numbered.map((x) => x.v),
    raw: tokens
      .slice(numbered[numbered.length - 4].idx)
      .join(' ')
      .trim(),
    line,
  };
}

/**
 * แถวแบบหลายบรรทัด (ของจริงจาก Dime!): ticker อยู่บรรทัดเดียว, ชื่อบริษัทบรรทัดถัดไป,
 * ตัวเลขรวมติดกันอีกบรรทัด คืน ParsedRow ถ้าเจอครบ, null ถ้าไม่ใช่
 */
export function parseStockGroup(lines: string[], i: number): { row: ParsedRow; nextIndex: number } | null {
  const ticker = lines[i].trim();
  if (!TICKER_RE.test(ticker)) return null;
  if (ticker === 'USD') return null; // คอลัมน์สกุลเงิน ไม่ใช่ ticker

  let j = i + 1;
  while (j < lines.length && !lines[j].trim()) j++;
  if (j >= lines.length) return null;

  let company = '';
  let raw = '';
  if (extractNumbers(lines[j]).length >= 4) {
    raw = lines[j].trim();
  } else {
    company = lines[j].trim();
    j++;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) return null;
    raw = lines[j].trim();
  }
  if (extractNumbers(raw).length < 4) return null;

  return { row: { ticker, company, numbers: extractNumbers(raw), raw, line: `${ticker}\n${company}\n${raw}` }, nextIndex: j + 1 };
}

/** ตรวจความสอดคล้องของตัวเลข — คืนเหตุผลถ้าไม่ผ่าน, null = ผ่าน */
export function validateStockNumbers(qty: number, avg: number, price: number, value: number): string | null {
  if (!(qty > 0)) return 'shares ต้องมากกว่า 0';
  if (!(avg >= 0)) return 'ต้นทุนเฉลี่ยติดลบ';
  if (!(price >= 0)) return 'ราคาติดลบ';
  if (!(value >= 0)) return 'มูลค่าติดลบ';
  if (price === 0 && value > 0) return 'ราคา = 0 แต่มูลค่า > 0';
  const tol = Math.max(1, value * 0.01); // ทน 1% หรือ $1 (กรณีปัดเศษ)
  if (Math.abs(value - qty * price) > tol) {
    return `total_value (${value}) ไม่ตรง shares×price (${qty} × ${price} = ${(qty * price).toFixed(4)})`;
  }
  return null;
}

/**
 * เลือกหน้าต่างตัวเลข [qty, avg, price, value] ที่ผ่าน validate —
 * ลองจาก 4 ตัวท้ายก่อน, ถ้าไม่ผ่านขยับไปข้างหน้า (กัน P/L อยู่กลางแถว)
 * คืนเหตุผลของหน้าต่างที่ใกล้สุดด้วย (สำหรับ log/skip)
 */
export function pickNumberWindow(
  numbers: number[]
): { window: [number, number, number, number] | null; reason: string | null } {
  let lastReason: string | null = null;
  for (let k = 0; k <= numbers.length - 4; k++) {
    const [qty, avg, price, value] = numbers.slice(k, k + 4);
    const reason = validateStockNumbers(qty, avg, price, value);
    if (reason === null) return { window: [qty, avg, price, value], reason: null };
    lastReason = reason;
  }
  return { window: null, reason: lastReason };
}

/**
 * Fallback เมื่อ 4 หน้าต่างเรียงกันไม่ผ่าน (ไฟล์จริงตัวเลขติดกัน + ขยะแทรก):
 * หา (qty, price) ที่ value ≈ qty × price — value เป็นตัวเลขท้ายสุด, price คือตัวที่
 * คูณแล้วตรง, avg คือตัวเลข 2 ทศนิยม (ไม่เกิน 100,000) ที่อยู่ก่อน price (ถ้าไม่มี → 0)
 */
export function pickNumberWindowMath(numbers: number[]): [number, number, number, number] | null {
  const n = numbers.length;
  for (let k = n - 1; k >= 3; k--) {
    const value = numbers[k];
    if (!(value > 0)) continue;
    const tol = Math.max(1, value * 0.01);
    for (let j = k - 1; j >= 1; j--) {
      const price = numbers[j];
      if (!(price >= 0)) continue;
      for (let i = 0; i < j; i++) {
        const qty = numbers[i];
        if (!(qty > 0)) continue;
        if (Math.abs(value - qty * price) <= tol) {
          let avg = 0;
          for (let t = j - 1; t > i; t--) {
            const v = numbers[t];
            if (v >= 0 && v < 100000 && !Number.isInteger(v)) {
              avg = v;
              break;
            }
          }
          return [qty, avg, price, value];
        }
      }
    }
  }
  return null;
}

/**
 * วิธีหลักของแถวตัวเลขติดกัน: value = ตัวเลขท้ายสุด, ลอง q ไล่จากหน้า → price = value ÷ q
 * (ปัด 2 ทศนิยม) แล้วค้น substring ของ price นั้นในข้อความดิบ — เจอ = ใช้ได้
 * avg cost = ตัวเลขท้ายสุดที่อยู่ก่อน price ในข้อความ (กันขยะที่รวมก้อนอยู่ด้วย)
 */
export function resolvePriceByRatio(raw: string, numbers: number[]): [number, number, number, number] | null {
  const value = numbers[numbers.length - 1];
  if (!(value > 0)) return null;
  for (let i = 0; i < numbers.length - 1; i++) {
    const q = numbers[i];
    if (!(q > 0) || q > 1e9) continue;
    const price = Math.round((value / q) * 100) / 100;
    if (!(price > 0)) continue;
    const ps = price.toFixed(2);
    const idx = raw.lastIndexOf(ps);
    if (idx < 0) continue;
    // avg cost = ตัวเลขท้ายสุด (ทศนิยม ≤ 2 หลักหน้า) ที่จบก่อน price ในข้อความ
    const m = raw.slice(0, idx).match(/(\d{1,2}\.\d{1,2})$/);
    const avg = m ? Number(m[1]) : 0;
    return [q, Number.isFinite(avg) && avg > 0 ? avg : 0, price, value];
  }
  return null;
}

/** ฟังก์ชันหลัก: ข้อความเต็มของสเตตเมนต์ → ผลลัพธ์ที่พร้อมนำเข้า DB */
export function parseDimeStatementText(
  text: string,
  opts: { subject?: string; now?: Date } = {}
): DimeParseResult {
  const { sectionFound, sectionText } = extractUsStocksSection(text);
  const period = detectStatementPeriod(text, opts.subject, opts.now);
  const summary = extractStatementSummary(text);

  if (!sectionFound) {
    return { period, sectionFound: false, sectionText: '', assets: [], skipped: [], summary };
  }

  const assets: DimeParsedAsset[] = [];
  const skipped: DimeSkippedRow[] = [];

  const sectionLines = sectionText.split(/\r?\n/);
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i].trim();
    if (!line) continue;

    // แถวแบบหลายบรรทัด (ticker / บริษัท / ตัวเลขติดกัน) — ลองก่อน, ชอบแบบนี้ของจริง
    const group = parseStockGroup(sectionLines, i);
    if (group) {
      const parsed = resolveRow(group.row.ticker, group.row.company, group.row.raw);
      if (parsed) assets.push(parsed);
      i = group.nextIndex - 1;
      continue;
    }

    const row = parseStockRow(line);
    if (!row) continue; // หัวคอลัมน์ / บรรทัดอื่นใน section

    const parsed = resolveRow(row.ticker, row.company, row.raw);
    if (parsed) assets.push(parsed);
  }

  function resolveRow(ticker: string, company: string, raw: string): DimeParsedAsset | null {
    const numbers = extractNumbers(raw);
    if (numbers.length < 4) return null;

    let win: [number, number, number, number] | null = null;
    let reason: string | null = null;

    const slide = pickNumberWindow(numbers);
    if (slide.window) win = slide.window;
    else {
      reason = slide.reason;
      win = resolvePriceByRatio(raw, numbers) ?? pickNumberWindowMath(numbers);
    }

    if (!win) {
      skipped.push({ line: `${ticker}\n${raw}`, ticker, reason: reason ?? 'ตัวเลขไม่ผ่าน validation' });
      return null;
    }
    const [qty, avg, price, value] = win;
    const metrics = extractRowMetrics(raw);
    return {
      statement_period: period ?? '',
      ticker,
      company_name: company.replace(/\s*Common(?: Stock)?$/i, '').trim() || ticker,
      shares: qty,
      avg_cost: avg,
      current_price: price,
      total_value: value,
      currency: 'USD',
      allocation_pct: metrics.allocationPct,
      total_return_pct: metrics.totalReturnPct,
      total_return_usd: metrics.totalReturnUsd,
    };
  }

  return { period, sectionFound: true, sectionText, assets, skipped, summary };
}
