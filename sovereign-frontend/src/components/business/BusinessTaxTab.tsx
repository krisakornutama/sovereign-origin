import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { fetchJsonObject } from '../../lib/fetchJson';
import { getApiUrl } from '../../lib/config';
import Icon from '../ui/Icon';
import TaxInvoice from './TaxInvoice';
import { STATUS_CLS, baht } from './shared';

// ── แท็บภาษี (แยกจาก BusinessWorkspace — phase 3) ──
// ── ภาษี — อ่านตัวเลขจาก GET /tax (server บังคับสิทธิ์เอง; tab เห็นเฉพาะ ACCOUNTANT ขึ้นไป) ──
export interface TaxData {
  vatRate: number;
  currentVatRate: number;
  vat: { thisMonth: { salesBase: number; outputVat: number; inputVat: number; netVat: number }; lastMonth: { outputVat: number } };
  year: { income: number; incomeVat: number; expense: number; expenseVat: number; wht: { received: number; paid: number }; netProfitBeforeTax: number };
  cit: { isSme: boolean; netProfit: number; grossTax: number; whtCredits: number; taxDue: number };
  pit: { taxable: number; grossTax: number; taxDue: number };
  calendar: Array<{ key: string; label: string; due: string; periodLabel: string }>;
}

const daysLeft = (due: string) => Math.round((new Date(`${due}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);

export function BusinessTaxTab({ bizName, base }: { bizName: string; base: string }) {
  const [data, setData] = useState<TaxData | null>(null);
  const [err, setErr] = useState('');
  // ทุนจดทะเบียนปรับการทดสอบ SME (ทุน > 5M = ไม่ SME แม้รายได้ต่ำ) — uncontrolled, apply เมื่อ blur
  const [capitalQ, setCapitalQ] = useState('');
  // เลือกงวด VAT ย้อนหลัง (YYYY-MM — ว่าง = เดือนนี้)
  const [monthQ, setMonthQ] = useState('');

  useEffect(() => {
    const q = [
      ...(capitalQ ? [`capital=${encodeURIComponent(capitalQ)}`] : []),
      ...(monthQ ? [`month=${monthQ}`] : []),
    ].join('&');
    void fetchJsonObject<TaxData>(`${base}/tax${q ? `?${q}` : ''}`)
      .then(setData)
      .catch((e: any) => setErr(e.message));
  }, [base, capitalQ, monthQ]);

  if (err) return <div className="card p-4 text-sm text-slate-400">{err}</div>;
  if (!data) return <div className="card p-4 text-sm text-slate-400">กำลังโหลดตัวเลขภาษี…</div>;
  const y = data.year;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="eyebrow pb-1">หนังสือยื่นและชำระภาษี</div>
        <select value={monthQ} onChange={(e) => setMonthQ(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="เลือกงวด VAT">
          <option value="">งวดนี้ (เดือนปัจจุบัน)</option>
          {last12Months().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <TaxFormPaper bizName={bizName} data={data} monthQ={monthQ} />
      <div className="grid md:grid-cols-3 gap-3">
        <div className="card p-3 space-y-1">
          <div className="tax-form-head text-sm font-semibold flex items-center gap-1.5"><span className="tax-box">๑</span>ภาษีนิติบุคคล ภ.ง.ด.50</div>
          <div className="text-[11px] text-slate-500">{data.cit.isSme ? 'SME — อัตราก้าวหน้า 0/15/20% (ทุน ≤5M + รายได้ ≤30M)' : 'อัตรากลาง 20% (เกินเพดาน SME)'}</div>
          <TaxRow label="กำไรสุทธิ" value={baht(data.cit.netProfit)} />
          <TaxRow label="ภาษีตามขั้น" value={baht(data.cit.grossTax)} />
          <TaxRow label="เครดิตหัก ณ ที่จ่าย" value={baht(data.cit.whtCredits)} />
          <TaxRow label="ต้องจ่ายเพิ่ม" value={baht(data.cit.taxDue)} strong />
          <label className="block text-[11px] text-slate-500 pt-1" htmlFor="tax-capital-input">ทุนจดทะเบียน (บาท) — แก้เพื่อทดสอบเพดาน SME</label>
          <input id="tax-capital-input" type="number" min={0} defaultValue="" onBlur={(e) => setCapitalQ(e.target.value)}
            placeholder="เช่น 1000000" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-right text-xs" />
        </div>
        <div className="card p-3 space-y-1">
          <div className="tax-form-head text-sm font-semibold flex items-center gap-1.5"><span className="tax-box">๒</span>ภาษีบุคคลธรรมดา ภ.ง.ด.90</div>
          <div className="text-[11px] text-slate-500">ประมาณการหยาบ — หักค่าใช้จ่าย 60,000 เท่านั้น (ลดหย่อนอื่นตกลงตอนยื่นจริง)</div>
          <TaxRow label="ฐานภาษี" value={baht(data.pit.taxable)} />
          <TaxRow label="ภาษีตามขั้น" value={baht(data.pit.grossTax)} />
          <TaxRow label="ต้องจ่ายเพิ่ม" value={baht(data.pit.taxDue)} strong />
        </div>
        <div className="card p-3 space-y-1">
          <div className="tax-form-head text-sm font-semibold flex items-center gap-1.5"><span className="tax-box">๓</span>หัก ณ ที่จ่าย (ปีนี้)</div>
          <TaxRow label="โดนลูกค้าหัก" value={baht(y.wht.received)} />
          <TaxRow label="ที่เราหักผู้รับจ้าง" value={baht(y.wht.paid)} />
          <div className="text-[11px] text-slate-500">โดนหัก = เครดิต ภ.ง.ด.50/90 · ที่เราหัก = ส่ง ภ.ง.ด.3 ภายในวันที่ 7 เดือนถัดไป (e-filing +8 วิ)</div>
        </div>
      </div>
      <div className="card p-3">
        <div className="tax-form-head text-sm font-semibold flex items-center gap-1.5 mb-2"><span className="tax-box">๔</span>ปฏิทินยื่น</div>
        <div className="space-y-1">
          {data.calendar.map((c) => {
            const left = daysLeft(c.due);
            return (
              <div key={c.key} className="flex flex-wrap items-center gap-2 text-sm border-b border-slate-800 pb-1">
                <span className="text-slate-300 flex-1">{c.label}</span>
                <span className="text-[11px] text-slate-500">{c.periodLabel}</span>
                <span className="font-mono text-xs">{c.due}</span>
                <span className={`text-[10px] px-1.5 rounded border ${left < 0 ? 'border-slate-700 text-slate-500' : left <= 14 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'border-slate-700 text-slate-400'}`}>
                  {left < 0 ? 'ผ่านแล้ว' : `อีก ${left} วัน`}
                </span>
              </div>
            );
          })}
        </div>
        <div className="text-[11px] text-slate-500 mt-2">ตัวเลขทั้งหมดประมาณการจากข้อมูลในระบบ — ไม่ใช่คำแนะนำภาษี · ภ.พ.30 ยื่นภายในวันที่ 15 ของเดือนถัดไป · ปีบัญชีอื่น (fyEnd) ติดต่อผู้ดูแลระบบ</div>
      </div>
    </div>
  );
}

/** แผ่น ภ.พ.30 — กระดาษชมพูสรรพากรวางบนคอนโซล: หัวแบบฟอร์ม + ช่องตัวเลขงวด + ตราประทับงวดที่เลือก */
export function TaxFormPaper({ bizName, data, monthQ }: { bizName: string; data: TaxData; monthQ: string }) {
  const v = data.vat.thisMonth;
  const periodLabel = new Date(monthQ ? `${monthQ}-01T00:00:00` : Date.now())
    .toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  return (
    <div className="tax-paper p-5 pl-14 md:p-7 md:pl-16">
      <div className="tax-form-head">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold tracking-wide">แบบ ภ.พ.30</div>
            <div className="text-[11px] opacity-70">หนังสือยื่นรายการภาษีมูลค่าเพิ่ม (คนใช้สอย/บริษัทย่อม)</div>
          </div>
          <div className="tax-stamp px-2.5 py-1 text-center leading-tight" aria-label={`งวดภาษี ${periodLabel}`}>
            <div className="text-[9px] font-semibold tracking-[0.2em]">งวดภาษี</div>
            <div className="text-sm font-bold">{periodLabel}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
          <span>ผู้ยื่น: <b className="font-semibold">{bizName}</b></span>
          <span className="tax-blank px-8">เลขประจำตัวผู้เสียภาษี</span>
        </div>

        <div className="mt-5 space-y-2 text-[13px]">
          <div className="tax-line flex items-baseline justify-between gap-3 pb-1">
            <span><span className="tax-box mr-1.5">๑</span>ภาษีขาย (ยอดขายฐาน {baht(v.salesBase)})</span>
            <span className="tax-amount font-semibold">{baht(v.outputVat)}</span>
          </div>
          <div className="tax-line flex items-baseline justify-between gap-3 pb-1">
            <span><span className="tax-box mr-1.5">๒</span>ภาษีซื้อ</span>
            <span className="tax-amount">{baht(v.inputVat)}</span>
          </div>
          <div className="tax-line flex items-baseline justify-between gap-3 pb-1">
            <span><span className="tax-box mr-1.5">๓</span>ภาษีขายเดือนก่อน</span>
            <span className="tax-amount">{baht(data.vat.lastMonth.outputVat)}</span>
          </div>
          <div className="tax-line flex items-baseline justify-between gap-3 pb-1">
            <span><span className="tax-box mr-1.5">๔</span>ภาษีต้องส่งสุทธิ</span>
            <span className="tax-amount font-bold" style={{ color: v.netVat >= 0 ? 'var(--tax-stamp)' : 'var(--tax-safe)' }}>
              {v.netVat >= 0 ? baht(v.netVat) : `ส่งเกิน ${baht(-v.netVat)}`}
            </span>
          </div>
        </div>

        <div className="mt-4 text-[10.5px] leading-relaxed opacity-65">
          อัตราของร้าน {pct(data.vatRate)} · อัตราลดพิเศษปัจจุบัน {pct(data.currentVatRate)} (ถึง 30 ก.ย. 2027) · ตัวเลขเป็นของงวดที่เลือก
          <div className="mt-1 text-amber-700/80">⚠ ช่อง ๑ นับเฉพาะยอดจากออเดอร์ในระบบ — รายรับมือ (ขายนอกระบบ/เพจ/มาร์เก็ตเพลส) ต้องสร้างออเดอร์รับชำระให้ครบ ไม่งั้นภาษีขายจะต่ำกว่าจริง</div>
        </div>
      </div>
    </div>
  );
}

/** แถวบัญชี — รายการมือ (ไม่มี refOrderId) แก้/ลบได้เมื่อเป็น MANAGER ขึ้นไป; รายการจากออเดอร์อ่านอย่างเดียว */
/** 12 เดือนย้อนหลังสำหรับเลือกงวด VAT (YYYY-MM + ป้ายไทย) */
function last12Months(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date();
  for (let i = 1; i <= 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: m.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

function TaxRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between text-sm"><span className="text-slate-400">{label}</span><span className={strong ? 'font-bold text-slate-200' : 'text-slate-300'}>{value}</span></div>;
}


