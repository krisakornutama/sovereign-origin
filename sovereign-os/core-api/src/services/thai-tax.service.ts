// src/services/thai-tax.service.ts
//
// ภาษีไทยสำหรับธุรกิจในระบบ — คำนวณล้วน ๆ (ไม่ใช่คำแนะนำภาษี; ตัวเลขอ้างอิงประมวลรัษฎากร
// ณ ก.ย. 2026: VAT 7% ยกเว้นลดอัตราถึง 30 ก.ย. 2027 (มติ ครม. ต่ออายุอีก 1 ปี),
// ภาษีเงินได้นิติบุคคล SME 0/15/20% (ทุนจดทะเบียน ≤ 5 ล้าน และรายได้รวม ≤ 30 ล้าน),
// ภาษีเงินได้บุคคลธรรมดา 8 ขั้น 0–35%, อัตราหัก ณ ที่จ่ายตาม ท.ป.4-ป.6)
//
// หลักการ: ตัวเลขทุกตัวมีที่มาเดียวในไฟล์นี้ (RATES) — ห้ามเขียนเปอร์เซ็นต์ที่อื่น
// ทุกฟังก์ชันเป็น pure function (ไม่แตะ prisma) → เทสได้ตรง ๆ ทุกกรณี
// การเงินเป็นบาท 2 ตำแหน่ง (round ตอนท้ายเสมอ ไม่ปัดกลางทาง)

// ────────────────────────────────────────────────────────────────────────────
// RATES — ที่มาเดียวของตัวเลขภาษีทั้งระบบ
// ────────────────────────────────────────────────────────────────────────────

export const RATES = {
  // VAT — อัตราลดพิเศษ 7% (รวม local tax) ต่ออายุถึง 30 ก.ย. 2027; ปกติ 10% ตามประมวลรัษฎากร ม.78/1
  VAT: {
    REDUCED: 0.07,
    REDUCED_UNTIL: '2027-09-30',
    STANDARD: 0.10,
  },
  // ภ.ง.ด.50 — นิติบุคคล SME: ทุนจดทะเบียน ≤ 5 ล้าน และรายได้รวมในรอบบัญชี ≤ 30 ล้าน (แบบ 2)
  // อัตราก้าวหน้า 0% / 15% / 20% (มาตรา 65 ทวิ)
  SME_CIT: {
    CAPITAL_CAP: 5_000_000,
    REVENUE_CAP: 30_000_000,
    BRACKETS: [
      { upTo: 300_000, rate: 0 },
      { upTo: 3_000_000, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ] as Array<{ upTo: number; rate: number }>,
  },
  // นิติบุคคลทั่วไป — อัตรากลาง 20% (มาตรา 65(2))
  CIT_STANDARD: 0.20,
  // ภ.ง.ด.90/91 — บุคคลธรรมดา 8 ขั้น (มาตรา 48(2), ปรับปรุงริเริ่มรายได้ต่ำ)
  PIT: {
    PERSONAL_ALLOWANCE: 60_000, // ค่าใช้จ่ายส่วนตัว (ครอบครัว/ประกันสังคม/เงินบริจาคไม่คำนวน — ประมาณการหยาบ)
    BRACKETS: [
      { upTo: 150_000, rate: 0 },
      { upTo: 300_000, rate: 0.05 },
      { upTo: 500_000, rate: 0.10 },
      { upTo: 750_000, rate: 0.15 },
      { upTo: 1_000_000, rate: 0.20 },
      { upTo: 2_000_000, rate: 0.25 },
      { upTo: 5_000_000, rate: 0.30 },
      { upTo: Infinity, rate: 0.35 },
    ] as Array<{ upTo: number; rate: number }>,
  },
} as const;
// หมายเหตุ หัก ณ ที่จ่าย (WHT): ระบบ "เก็บยอดที่ถูกหักจริง" เท่านั้น (business_payments.whtAmount /
// business_ledger_entries.whtAmount) — อัตราตาม ท.ป.4/ท.ป.6 (เช่า 5%, ค่าจ้างทั่วไป 3%, ขนส่ง 1%) กรอกตอนออกบิล/จ่ายเงิน

// ────────────────────────────────────────────────────────────────────────────
// helpers — ปัดเงินบาท 2 ตำแหน่ง, แปลง "ราคารวม VAT" → "ราคาสินค้า + VAT"
// ────────────────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** ms สุดท้ายของเดือน YYYY-MM — ใช้เป็นจุด anchor ของงวด VAT ที่เลือกย้อนหลัง */
export function endOfMonth(month: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('month must be YYYY-MM');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - 1);
}

/** ยอดรวมในใบเสร็จ (รวม VAT) → { base, vat } — ทางร้านตั้งราคารวม VAT เสมอ จึงต้องแยกย้อนหลัง */
export function splitVatFromGross(gross: number, vatRate: number): { base: number; vat: number } {
  if (!Number.isFinite(gross) || gross < 0) return { base: 0, vat: 0 };
  const base = vatRate > 0 ? gross / (1 + vatRate) : gross;
  return { base: round2(base), vat: round2(gross - base) };
}

// ────────────────────────────────────────────────────────────────────────────
// 1) VAT รายเดือน — ภ.พ.30 (ภาษีขาย − ภาษีซื้อ ติดลบได้ = งวดนี้ยังไม่ต้องจ่าย/ขอคืนได้)
// ────────────────────────────────────────────────────────────────────────────

export interface VatMonthlyInput {
  vatRate: number; // อัตรา VAT ที่ร้านใช้ (0 = ไม่ VAT-registered)
  /** ยอดขาย "รวม VAT" แบ่งตามอัตราของแต่ละรายการ — เช่น { "0.07": 10700, "0": 5000 } */
  salesGrossByRate: Record<string, number>;
}

/** ภาษีขายฝั่งขายของ ภ.พ.30 — ส่วนภาษีซื้อ (inputVat) มาจาก ledger ฝั่ง caller ประกอบเอง */
export interface VatMonthlyResult {
  vatRate: number;
  salesBase: number;
  outputVat: number; // ภาษีขาย
  salesWithoutVat: number; // ยอดขายที่ไม่มี VAT (สินค้ายกเว้น/ไม่อยู่ระบบ VAT)
}

export function computeVatMonthly(input: VatMonthlyInput): VatMonthlyResult {
  let salesBase = 0;
  let outputVat = 0;
  let salesWithoutVat = 0;
  for (const [rateStr, gross] of Object.entries(input.salesGrossByRate ?? {})) {
    const g = Number(gross) || 0;
    const r = Number(rateStr) || 0;
    if (r <= 0) {
      salesWithoutVat += g;
      continue;
    }
    const { base, vat } = splitVatFromGross(g, r);
    salesBase += base;
    outputVat += vat;
  }
  return {
    vatRate: input.vatRate,
    salesBase: round2(salesBase),
    outputVat: round2(outputVat),
    salesWithoutVat: round2(salesWithoutVat),
  };
}

/** อัตรา VAT ที่ควรใช้ ณ วันที่กำหนด (วันนี้ถ้าไม่ส่งมา) — 7% จนถึง 30 ก.ย. 2027, หลังจากนั้น 10% */
export function currentVatRate(onDate: Date = new Date()): number {
  const d = onDate.toISOString().slice(0, 10);
  return d <= RATES.VAT.REDUCED_UNTIL ? RATES.VAT.REDUCED : RATES.VAT.STANDARD;
}

// ────────────────────────────────────────────────────────────────────────────
// 2) ภาษีเงินได้นิติบุคคล — ภ.ง.ด.50 (SME 0/15/20% หรืออัตรากลาง 20%)
// ────────────────────────────────────────────────────────────────────────────

export interface CitInput {
  /** กำไรสุทธิก่อนภาษี (บาท) */
  netProfit: number;
  capitalRegistered: number; // ทุนจดทะเบียน (บาท)
  totalRevenue: number; // รายได้รวมทั้งรอบบัญชี (บาท)
  whtCredits: number; // ภาษีหัก ณ ที่จ่ายที่ถูกหักไว้แล้ว (เครดิต)
}

export interface CitResult {
  isSme: boolean;
  netProfit: number;
  grossTax: number;
  whtCredits: number;
  taxDue: number; // ต้องจ่ายเพิ่มตอนยื่น ภ.ง.ด.50 (ติดลบ = เครดิตเกิน, ไม่ให้ติดลบในคำตอบหลัก)
  breakdown: Array<{ from: number; to: number; rate: number; base: number; tax: number }>;
}

export function isSme(capitalRegistered: number, totalRevenue: number): boolean {
  return capitalRegistered <= RATES.SME_CIT.CAPITAL_CAP && totalRevenue <= RATES.SME_CIT.REVENUE_CAP;
}

export function computeCit(input: CitInput): CitResult {
  const profit = Math.max(0, Number(input.netProfit) || 0);
  const sme = isSme(input.capitalRegistered, input.totalRevenue);
  const breakdown: CitResult['breakdown'] = [];
  let grossTax = 0;
  if (sme) {
    let prev = 0;
    for (const b of RATES.SME_CIT.BRACKETS) {
      if (profit <= prev) break;
      const base = Math.min(profit, b.upTo) - prev;
      const tax = round2(base * b.rate);
      breakdown.push({ from: prev, to: Math.min(profit, b.upTo), rate: b.rate, base: round2(base), tax });
      grossTax += tax;
      prev = b.upTo;
    }
  } else {
    const tax = round2(profit * RATES.CIT_STANDARD);
    breakdown.push({ from: 0, to: profit, rate: RATES.CIT_STANDARD, base: round2(profit), tax });
    grossTax = tax;
  }
  const whtCredits = Math.max(0, Number(input.whtCredits) || 0);
  const taxDue = Math.max(0, round2(grossTax - whtCredits));
  return {
    isSme: sme,
    netProfit: round2(profit),
    grossTax: round2(grossTax),
    whtCredits: round2(whtCredits),
    taxDue,
    breakdown,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3) ภาษีเงินได้บุคคลธรรมดา — ภ.ง.ด.90/91 (ประมาณการสำหรับเจ้าของธุรกิจ)
//    หมายเหตุ: คำนวณหยาบจากกำไรธุรกิจ − ค่าใช้จ่ายส่วนตัว 60,000 เท่านั้น
//    (ลดหย่อนครอบครัว/ประกัน/กองทุนยังไม่รองรับ — ให้คนตกลงเองตอนยื่นจริง)
// ────────────────────────────────────────────────────────────────────────────

export interface PitInput {
  /** รายได้รวมทั้งปี (บาท) */
  totalIncome: number;
  /** ภาษีหัก ณ ที่จ่ายที่ถูกหักไว้ (เครดิต ภ.ง.ด.2/3) */
  whtCredits?: number;
}

export interface PitResult {
  totalIncome: number;
  taxable: number;
  grossTax: number;
  whtCredits: number;
  taxDue: number;
  breakdown: Array<{ from: number; to: number; rate: number; base: number; tax: number }>;
}

export function computePit(input: PitInput): PitResult {
  const income = Math.max(0, Number(input.totalIncome) || 0);
  const taxable = Math.max(0, income - RATES.PIT.PERSONAL_ALLOWANCE);
  let grossTax = 0;
  const breakdown: PitResult['breakdown'] = [];
  let prev = 0;
  for (const b of RATES.PIT.BRACKETS) {
    if (taxable <= prev) break;
    const base = Math.min(taxable, b.upTo) - prev;
    const tax = round2(base * b.rate);
    breakdown.push({ from: prev, to: Math.min(taxable, b.upTo), rate: b.rate, base: round2(base), tax });
    grossTax += tax;
    prev = b.upTo;
  }
  const whtCredits = Math.max(0, Number(input.whtCredits) || 0);
  return {
    totalIncome: round2(income),
    taxable: round2(taxable),
    grossTax: round2(grossTax),
    whtCredits: round2(whtCredits),
    taxDue: Math.max(0, round2(grossTax - whtCredits)),
    breakdown,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 4) ปฏิทินยื่น-จ่าย — กำหนดสำคัญของธุรกิจ (กติกาเดียวกันทุกปี; e-filing เลื่อนได้อีก 8 วิ)
// ────────────────────────────────────────────────────────────────────────────

export interface TaxDeadline {
  key: string; // PP30 | PND3 | PND50 | PND51 | PND90
  label: string; // ภาษาไทย — แสดงบน UI ได้เลย
  due: string; // ISO date
  periodLabel: string; // รอบที่ยื่น (ม.ค. 2569 ฯลฯ)
}

function thMonthYear(d: Date): string {
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

/** วันสุดท้ายของเดือนถัดไปแบบเว้นวันที่ 15 (ภ.พ.30 ยื่นภายในวันที่ 15 ของเดือนถัดไป) */
function midNextMonth(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 15));
}

/** วันที่ 7 ของเดือนถัดไป (ภ.ง.ด.3 ยื่นภายในวันที่ 7 ของเดือนถัดไป — e-filing +8 วิ) */
function seventhNextMonth(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 7));
}

/** ภ.ง.ด.50 — ยื่นภายใน 150 วันนับจากวันปิดรอบบัญชี */
function plusDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function taxCalendar(now: Date = new Date(), fiscalYearEnd?: string): TaxDeadline[] {
  const out: TaxDeadline[] = [];
  const today = now.toISOString().slice(0, 10);

  // ภ.พ.30 — VAT งวดเดือนก่อน: ยื่นภายในวันที่ 15 ของเดือนนี้ (ถ้าผ่านแล้ว = งวดเดือนนี้ ต้นเดือนหน้า)
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const vatDue = midNextMonth(prevMonth);
  const vatPeriod = vatDue.toISOString().slice(0, 10) > today ? prevMonth : now;
  out.push({
    key: 'PP30',
    label: 'ภ.พ.30 — VAT รายเดือน (ยื่นภายในวันที่ 15 ของเดือนถัดไป)',
    due: midNextMonth(vatPeriod).toISOString().slice(0, 10),
    periodLabel: thMonthYear(vatPeriod),
  });

  // ภ.ง.ด.3 — หัก ณ ที่จ่ายงวดเดือนก่อน: ยื่นภายในวันที่ 7 ของเดือนนี้ (e-filing +8 วิ)
  const whtPeriod = seventhNextMonth(prevMonth).toISOString().slice(0, 10) > today ? prevMonth : now;
  out.push({
    key: 'PND3',
    label: 'ภ.ง.ด.3 — หัก ณ ที่จ่าย (ยื่นภายในวันที่ 7 ของเดือนถัดไป / e-filing +8 วัน)',
    due: seventhNextMonth(whtPeriod).toISOString().slice(0, 10),
    periodLabel: thMonthYear(whtPeriod),
  });

  // ภ.ง.ด.50 — รายปี: 150 วันหลังปิดรอบบัญชี (default 31 ธ.ค.)
  const fyEnd = fiscalYearEnd ? new Date(`${fiscalYearEnd}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  out.push({
    key: 'PND50',
    label: 'ภ.ง.ด.50 — ภาษีเงินได้นิติบุคคลรายปี (ยื่นภายใน 150 วันหลังปิดรอบบัญชี)',
    due: plusDays(fyEnd, 150).toISOString().slice(0, 10),
    periodLabel: thMonthYear(fyEnd),
  });

  // ภ.ง.ด.51 — ครึ่งปี: ภายใน 2 เดือนหลังปิดครึ่งรอบบัญชี (default 30 มิ.ย. → 31 ส.ค.)
  const h1End = new Date(Date.UTC(now.getUTCFullYear(), 5, 30));
  out.push({
    key: 'PND51',
    label: 'ภ.ง.ด.51 — ภาษีนิติบุคคลครึ่งปี (ยื่นภายใน 2 เดือนหลังปิดครึ่งรอบบัญชี)',
    due: new Date(Date.UTC(h1End.getUTCFullYear(), h1End.getUTCMonth() + 3, 0)).toISOString().slice(0, 10), // วันสุดท้ายของเดือนที่ 2
    periodLabel: thMonthYear(h1End),
  });

  // ภ.ง.ด.90 — บุคคลธรรมดา: ยื่นภายใน 31 มี.ค. ของปีถัดไป
  out.push({
    key: 'PND90',
    label: 'ภ.ง.ด.90/91 — ภาษีเงินได้บุคคลธรรมดา (ยื่นภายใน 31 มี.ค. ของปีถัดไป)',
    due: `${now.getUTCFullYear() + 1}-03-31`,
    periodLabel: thMonthYear(new Date(Date.UTC(now.getUTCFullYear(), 11, 31))),
  });

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 5) ประกอบทุกอย่างจากข้อมูลจริงของธุรกิจ — ฝั่ง route เรียกแล้วส่งต่อ UI
// ────────────────────────────────────────────────────────────────────────────

export interface BusinessTaxOverviewInput {
  vatRate: number;
  /** [{ amount: "รวม VAT", vatRate: อัตราของรายการ, paidAt: Date }] — จาก payments ของออเดอร์ที่เก็บเงินแล้ว */
  salesPayments: Array<{ amount: number; vatRate: number; paidAt: Date }>;
  /** [{ amount, vatAmount, whtAmount, type: INCOME|EXPENSE, category, createdAt }] — จาก ledger */
  ledger: Array<{ type: string; category: string; amount: number; vatAmount: number; whtAmount: number; createdAt: Date }>;
  capitalRegistered?: number;
  fiscalYearEnd?: string;
  /** งวด VAT ที่จะแสดง (YYYY-MM) — เลือกย้อนหลังได้; ส่วนปี/CIT/PIT/ปฏิทินยังยึดวันนี้ */
  month?: string;
  /** inject ได้เพื่อเทส deterministic (default = วันนี้) */
  now?: Date;
}

export function businessTaxOverview(input: BusinessTaxOverviewInput): Record<string, unknown> {
  const now = input.now ?? new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const inThisYear = (d: Date) => d >= yearStart && d <= now;

  // VAT งวดเดือนนี้ + เดือนก่อน (จาก payments — ยอด "รวม VAT" แยกเป็น base + VAT ด้วยอัตราของแต่ละรายการ)
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  const grossByRate = (month: string) => {
    const acc: Record<string, number> = {};
    for (const p of input.salesPayments) {
      if (monthKey(p.paidAt) === month) acc[String(p.vatRate)] = (acc[String(p.vatRate)] ?? 0) + (p.amount || 0);
    }
    return acc;
  };

  // ภาษีซื้อของเดือนนี้ = VAT จากรายจ่ายใน ledger ที่บันทึก vatAmount ไว้
  const monthLedger = (month: string) => input.ledger.filter((l) => monthKey(l.createdAt) === month);
  const inputVat = (month: string) => round2(monthLedger(month).filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + (l.vatAmount || 0), 0));

  // เลือกงวดย้อนหลัง: anchor ของภาษีขาย/ซื้อ = ปลายเดือนที่เลือก (ค่าเริ่ม = วันนี้)
  const vatAnchor = input.month ? endOfMonth(input.month) : now;
  const thisMonth = monthKey(vatAnchor);
  const prevMonth = monthKey(new Date(Date.UTC(vatAnchor.getUTCFullYear(), vatAnchor.getUTCMonth() - 1, 1)));

  const vatThis = computeVatMonthly({ vatRate: input.vatRate, salesGrossByRate: grossByRate(thisMonth) });
  const vatPrev = computeVatMonthly({ vatRate: input.vatRate, salesGrossByRate: grossByRate(prevMonth) });
  const inputVatThis = inputVat(thisMonth);

  // รายได้/รายจ่าย/กำไร รายปี (จาก ledger — ปีนี้)
  const yearRows = input.ledger.filter((l) => inThisYear(l.createdAt));
  const income = round2(yearRows.filter((l) => l.type === 'INCOME').reduce((s, l) => s + l.amount, 0));
  const expense = round2(yearRows.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + l.amount, 0));
  const incomeVat = round2(yearRows.filter((l) => l.type === 'INCOME').reduce((s, l) => s + (l.vatAmount || 0), 0));
  const expenseVat = round2(yearRows.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + (l.vatAmount || 0), 0));
  const whtIncome = round2(yearRows.filter((l) => l.type === 'INCOME').reduce((s, l) => s + (l.whtAmount || 0), 0));
  const whtExpense = round2(yearRows.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + (l.whtAmount || 0), 0));

  // ฐานกำไรก่อนภาษี = กำไร ledger − VAT ที่เบิกจ่ายไปแล้ว (VAT ไม่ใช่รายได้/รายจ่ายของกิจการ)
  const netProfitBeforeTax = round2(income - incomeVat - (expense - expenseVat));

  const capital = input.capitalRegistered ?? 0;
  const cit = computeCit({ netProfit: netProfitBeforeTax, capitalRegistered: capital, totalRevenue: income, whtCredits: whtIncome });

  const pit = computePit({ totalIncome: netProfitBeforeTax, whtCredits: 0 });

  return {
    asOf: now.toISOString(),
    vatRate: input.vatRate,
    currentVatRate: currentVatRate(now),
    vat: {
      thisMonth: { ...vatThis, inputVat: inputVatThis, netVat: round2(vatThis.outputVat - inputVatThis) },
      lastMonth: vatPrev,
    },
    year: {
      income,
      incomeVat,
      expense,
      expenseVat,
      wht: { received: whtIncome, paid: whtExpense },
      netProfitBeforeTax,
    },
    cit,
    pit,
    calendar: taxCalendar(now, input.fiscalYearEnd),
  };
}
