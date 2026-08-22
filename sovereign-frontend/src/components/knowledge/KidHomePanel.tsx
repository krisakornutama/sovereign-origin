"use client";
// ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน / ถังสะสม / หุ้นจำลอง / คูปอง / audit ──
// ย้าย JSX และ printCertificate/printWeeklyReport มาจาก src/pages/knowledge.tsx verbatim
import { useState, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { fmtLocale } from '../../lib/formatDate';
import Icon from '../ui/Icon';
import {
  AUDIT_LABELS, CHORE_EMOJIS, COUPON_EMOJIS, COUPON_PRESETS, PIGGY_PRESETS, WALLET_PRESETS, WEEKDAY_LABELS,
  KidAuditRow, KidCoupon, KidHome, KidStock, WeeklyReportKid, fmtDate,
} from './knowledge-types';
import { PortfolioHistoryChart } from './charts';
import { buildWeeklyReportHtml } from './weekly-report';

interface KidHomePanelProps {
  kidHome: KidHome | null;
  homeLoading: boolean;
  choreForm: { title: string; reward: string; emoji: string };
  setChoreForm: Dispatch<SetStateAction<{ title: string; reward: string; emoji: string }>>;
  choreRepeat: 'none' | 'daily';
  setChoreRepeat: Dispatch<SetStateAction<'none' | 'daily'>>;
  addChoreUI: () => void;
  completeChoreUI: (choreId: string) => void;
  reopenChoreUI: (choreId: string) => void;
  deleteChoreUI: (choreId: string) => void;
  billForm: { title: string; amount: string; emoji: string; period: string };
  setBillForm: Dispatch<SetStateAction<{ title: string; amount: string; emoji: string; period: string }>>;
  addBillUI: () => void;
  payBillUI: (billId: string) => void;
  deleteBillUI: (billId: string) => void;
  allowanceForm: { day: string; amount: string };
  setAllowanceForm: Dispatch<SetStateAction<{ day: string; amount: string }>>;
  setAllowanceUI: () => void;
  piggyForm: { amount: string; note: string };
  setPiggyForm: Dispatch<SetStateAction<{ amount: string; note: string }>>;
  piggyTransferUI: (sign: 1 | -1) => void;
  goalForm: { amount: string };
  setGoalForm: Dispatch<SetStateAction<{ amount: string }>>;
  setSavingsGoalUI: () => void;
  targetForm: { title: string; amount: string };
  setTargetForm: Dispatch<SetStateAction<{ title: string; amount: string }>>;
  setPiggyTargetUI: () => void;
  pinForm: string;
  setPinForm: Dispatch<SetStateAction<string>>;
  setPinUI: () => void;
  stocks: KidStock[];
  stockForm: { symbol: string; units: string };
  setStockForm: Dispatch<SetStateAction<{ symbol: string; units: string }>>;
  buyStockUI: () => void;
  sellStockUI: (symbol: string, units: number) => void;
  targetPctForm: { pct: string };
  setTargetPctForm: Dispatch<SetStateAction<{ pct: string }>>;
  setTargetUI: () => void;
  depositForm: { amount: string; note: string };
  setDepositForm: Dispatch<SetStateAction<{ amount: string; note: string }>>;
  addDepositUI: () => void;
  audit: KidAuditRow[];
  auditLoading: boolean;
  couponForm: { title: string; cost: string; emoji: string };
  setCouponForm: Dispatch<SetStateAction<{ title: string; cost: string; emoji: string }>>;
  addCouponUI: () => void;
  redeemCouponUI: (coupon: KidCoupon) => void;
  deleteCouponUI: (coupon: KidCoupon) => void;
  walletAmount: string;
  setWalletAmount: Dispatch<SetStateAction<string>>;
  walletNote: string;
  setWalletNote: Dispatch<SetStateAction<string>>;
  adjustWalletUI: (sign: 1 | -1) => void;
  policyText: string;
  setPolicyText: Dispatch<SetStateAction<string>>;
  setMoneyModeUI: (mode: 'play' | 'real') => void;
  setInvestPolicyUI: () => void;
  setTeachError: Dispatch<SetStateAction<string>>;
  setTeachTopic: Dispatch<SetStateAction<string>>;
  setShowKidHome: Dispatch<SetStateAction<boolean>>;
}

export default function KidHomePanel({
  kidHome, homeLoading,
  choreForm, setChoreForm, choreRepeat, setChoreRepeat, addChoreUI, completeChoreUI, reopenChoreUI, deleteChoreUI,
  billForm, setBillForm, addBillUI, payBillUI, deleteBillUI,
  allowanceForm, setAllowanceForm, setAllowanceUI,
  piggyForm, setPiggyForm, piggyTransferUI, goalForm, setGoalForm, setSavingsGoalUI,
  targetForm, setTargetForm, setPiggyTargetUI,
  pinForm, setPinForm, setPinUI,
  stocks, stockForm, setStockForm, buyStockUI, sellStockUI,
  targetPctForm, setTargetPctForm, setTargetUI, depositForm, setDepositForm, addDepositUI,
  audit, auditLoading,
  couponForm, setCouponForm, addCouponUI, redeemCouponUI, deleteCouponUI,
  walletAmount, setWalletAmount, walletNote, setWalletNote, adjustWalletUI,
  policyText, setPolicyText, setMoneyModeUI, setInvestPolicyUI,
  setTeachError, setTeachTopic, setShowKidHome,
}: KidHomePanelProps) {
  const t = useLanguageStore((s) => s.t);
  const [reportLoading, setReportLoading] = useState(false);

  // ── พิมพ์เกียรติบัตร PDF (หน้าต่างพิมพ์ → บันทึกเป็น PDF) ──
  const printCertificate = (cert: { level: number; title: string; detail: string | null; created_at: string }, kid: { name: string; age: number | null; emoji: string | null }) => {
    const name = `${kid.emoji || ''} ${kid.name}`.trim();
    const date = new Date(cert.created_at).toLocaleDateString(fmtLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) {
      setTeachError(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
      return;
    }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('knowledge.cert.title', 'เกียรติบัตร')} ${cert.level}</title><style>
      body { font-family: 'Sarabun', 'Tahoma', sans-serif; background: #fff8e7; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .cert { width: 720px; padding: 40px; border: 4px double #c9a227; border-radius: 12px; text-align: center; background: #fffdf5; }
      .star { font-size: 42px; }
      h1 { color: #b8860b; font-size: 34px; margin: 8px 0 4px; }
      .name { font-size: 40px; color: #1f2937; font-weight: bold; margin: 12px 0; }
      .line { font-size: 15px; color: #4b5563; line-height: 1.8; }
      .detail { font-size: 13px; color: #6b7280; margin-top: 10px; }
      .date { margin-top: 24px; font-size: 12px; color: #9ca3af; }
      @media print { body { background: #fff; } }
    </style></head><body><div class="cert">
      <div class="star">🎓</div>
      <h1>${t('knowledge.cert.title', 'เกียรติบัตร')}</h1>
      <div class="name">${name}</div>
      <div class="line">${t('knowledge.cert.body', 'ได้รับเกียรตินี้เพื่อยืนยันว่า สะสมคะแนนถึงระดับ {level}', { level: cert.level })}</div>
      <div class="line" style="font-weight:bold; color:#b8860b; font-size:20px;">${t('knowledge.cert.levelLine', '⭐ ระดับ {level} ⭐', { level: cert.level })}</div>
      <div class="detail">${cert.detail || ''}</div>
      <div class="date">${t('knowledge.cert.date', 'ออกให้ ณ วันที่ {date} · ครอบครัว Sovereign OS', { date })}</div>
    </div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  // ── รายงานรายสัปดาห์ (PDF) — ดึงข้อมูล 7 วัน + เปิดหน้าต่างพิมพ์ ──
  const printWeeklyReport = async () => {
    if (reportLoading) return;
    setReportLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/report/weekly`);
      if (!res.ok) throw new Error(t('knowledge.errors.reportFailed', 'สร้างรายงานไม่สำเร็จ'));
      const data = await res.json();
      const kids = (data.kids || []) as WeeklyReportKid[];
      if (kids.length === 0) {
        setTeachError(t('knowledge.errors.reportNoKids', 'ยังไม่มีโปรไฟล์เด็ก — เพิ่มโปรไฟล์ก่อนสร้างรายงาน'));
        return;
      }
      const html = buildWeeklyReportHtml(kids, data.generatedAt, t);
      const w = window.open('', '_blank', 'width=860,height=960');
      if (!w) {
        alert(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.reportFailed', 'สร้างรายงานไม่สำเร็จ'));
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="card panel-glow p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] text-emerald-400 font-bold">{t('knowledge.home.eyebrow', 'หน้าที่ของลูก · ฝึกทำงานแลกเงิน จ่ายค่าไฟ/น้ำ/ห้องเอง')}</div>
          {kidHome && (
            <h2 className="text-lg font-bold text-gray-100 glow-text mt-0.5">
              {kidHome.kid.emoji || '🧒'} {kidHome.kid.name}
              {kidHome.kid.age != null && <span className="text-xs text-gray-500 ml-2">{t('knowledge.home.age', '{n} ปี', { n: kidHome.kid.age })}</span>}
            </h2>
          )}
        </div>
        {kidHome && (
          <div className="text-right shrink-0 flex items-center gap-3">
            <button
              onClick={printWeeklyReport}
              disabled={reportLoading}
              title={t('knowledge.home.reportTitle', 'ส่งออกรายงาน 7 วันเป็น PDF (คะแนน + งานบ้าน + บิล + ยอดเงิน)')}
              className="px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold disabled:opacity-50 inline-flex items-center gap-1"
            >
              {reportLoading ? t('knowledge.home.generating', 'กำลังสร้าง...') : <><Icon name="file" size={12} />{t('knowledge.home.weeklyReport', 'รายงานรายสัปดาห์ (PDF)')}</>}
            </button>
            <div>
              <div className="text-[10px] text-gray-500">{t('knowledge.home.wallet', 'เงินในกระเป๋า')}</div>
              <div className={`text-2xl font-bold ${kidHome.balance >= 0 ? 'text-emerald-400' : 'text-red-400'} glow-text`}>
                {kidHome.balance.toLocaleString()} ฿
              </div>
            </div>
          </div>
        )}
      </div>

      {kidHome && (
        <>
          {/* ── ระดับ/ดาว + XP ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{'⭐'.repeat(Math.min(3, kidHome.kid.level))}</span>
                <span className="font-bold text-sm">{t('knowledge.home.level', 'ระดับ {n}', { n: kidHome.kid.level })}</span>
                <span className="text-[10px] text-gray-500">XP {kidHome.kid.xp.toLocaleString()}</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${kidHome.kid.money_mode === 'real' ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300' : 'bg-sky-500/15 border border-sky-500/40 text-sky-300'}`}>
                {kidHome.kid.money_mode === 'real' ? t('knowledge.home.moneyReal', 'เงินจริง') : t('knowledge.home.moneyPlay', 'เงินจำลอง')}
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${Math.min(100, ((kidHome.kid.xp % 100) / 100) * 100)}%` }} />
            </div>
            <div className="text-[10px] text-gray-600">{t('knowledge.home.xpHint', 'อีก {n} XP ถึงระดับ {m} — ได้ XP จากการเรียน (คะแนน×10) และทำงานบ้าน', { n: 100 - (kidHome.kid.xp % 100), m: kidHome.kid.level + 1 })}</div>
            {kidHome.certificates.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-[10px] font-bold text-gray-400">{t('knowledge.home.certificates', 'เกียรติบัตร ({n})', { n: kidHome.certificates.length })}</div>
                {kidHome.certificates.slice(0, 3).map((cert) => (
                  <div key={cert.id} className="flex items-center gap-2 text-[11px] bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                    <span className="shrink-0 text-amber-400"><Icon name="crown" size={13} /></span>
                    <span className="flex-1 truncate text-gray-300">{cert.title}</span>
                    <span className="shrink-0 text-gray-500">{new Date(cert.created_at).toLocaleDateString(fmtLocale())}</span>
                    <button onClick={() => printCertificate(cert, kidHome.kid)} className="shrink-0 px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-600 text-[10px] text-white">PDF</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── นโยบายการลงทุนของบ้าน + โหมดเงิน ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.policyTitle', 'นโยบายการออม-ลงทุนของบ้าน')}</h3>
              <div className="flex gap-1">
                <button onClick={() => setMoneyModeUI('play')} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${kidHome.kid.money_mode !== 'real' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>{t('knowledge.home.playMode', 'จำลอง')}</button>
                <button onClick={() => setMoneyModeUI('real')} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${kidHome.kid.money_mode === 'real' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>{t('knowledge.home.realMode', 'เงินจริง')}</button>
              </div>
            </div>
            {kidHome.kid.money_mode === 'real' && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 leading-relaxed">
                {t('knowledge.home.realModeDesc', 'โหมดเงินจริง — เงินในกระเป๋า/ถังคือเงินเก็บของลูกที่พ่อแม่มอบหมายให้ลูกบริหาร เพื่อให้ลูกคิดถึงอนาคตและลงทุนเอง')}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={policyText || kidHome.kid.invest_policy}
                onChange={(e) => setPolicyText(e.target.value)}
                placeholder={t('knowledge.home.policyPh', 'เช่น ลูกต้องเก็บ 20% ของรายได้เข้าถังและลงทุนเสมอ')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={setInvestPolicyUI} className="shrink-0 px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-xs">{t('common.save', 'บันทึก')}</button>
            </div>
            {kidHome.kid.invest_policy && (
              <div className="text-[10px] text-gray-400 leading-relaxed border-t border-gray-800 pt-1.5">
                {t('knowledge.home.currentPolicy', 'นโยบายปัจจุบัน: ')}<span className="text-gray-300">{kidHome.kid.invest_policy}</span>
              </div>
            )}
          </div>
        </>
      )}

      {homeLoading && !kidHome ? (
        <div className="text-xs text-gray-400 py-4 text-center">{t('common.loading', 'กำลังโหลด...')}</div>
      ) : !kidHome ? (
        <div className="text-xs text-gray-500 py-2">{t('knowledge.home.pickKid', 'เลือกโปรไฟล์เด็กแล้วกดปุ่มอีกครั้งเพื่อโหลด')}</div>
      ) : (
        <>
          {/* ── งานบ้าน (ทำงานแลกเงิน) ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.choresTitle', 'งานบ้าน — ทำงานแล้วได้เงิน')}</h3>
              <span className="text-[10px] text-gray-500">{t('knowledge.home.choresDone', 'เสร็จแล้ว {done}/{total} งาน', { done: kidHome.chores.filter((c) => c.status === 'done').length, total: kidHome.chores.length })}</span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {kidHome.chores.length === 0 && <div className="text-[11px] text-gray-600">{t('knowledge.home.choresEmpty', 'ยังไม่มีงานบ้าน — เพิ่มงานแรกด้านล่าง เช่น "กวาดบ้าน 10 บาท"')}</div>}
              {kidHome.chores.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${c.status === 'done' ? 'bg-emerald-500/15 border-emerald-500/40 text-gray-500' : 'bg-gray-800/60 border-gray-700 text-gray-200'}`}>
                  <span className="shrink-0">{c.emoji || '📋'}</span>
                  {c.repeat === 'daily' && <span className="shrink-0 text-[9px] text-cyan-400" title={t('knowledge.home.dailyTitle', 'งานรายวัน — รีเซ็ตใหม่ทุกเช้า')}>{t('knowledge.home.daily', 'รายวัน')}</span>}
                  <span className={`flex-1 truncate ${c.status === 'done' ? 'line-through' : ''}`}>{c.title}</span>
                  <span className="shrink-0 font-bold text-emerald-400">+{c.reward}฿</span>
                  {c.status === 'pending' ? (
                    <button onClick={() => completeChoreUI(c.id)} title={t('knowledge.home.completeTitle', 'ทำเสร็จ → ได้เงิน')} className="shrink-0 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[10px]">{t('knowledge.home.done', '✓ เสร็จ')}</button>
                  ) : (
                    <button onClick={() => reopenChoreUI(c.id)} title={t('knowledge.home.reopenTitle', 'เปิดงานใหม่')} className="shrink-0 px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px]">↺</button>
                  )}
                  <button onClick={() => deleteChoreUI(c.id)} title={t('common.delete', 'ลบ')} className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 pt-1">
              <input
                value={choreForm.title}
                onChange={(e) => setChoreForm({ ...choreForm, title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addChoreUI()}
                placeholder={t('knowledge.home.chorePh', 'งาน เช่น กวาดบ้าน')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={choreForm.reward}
                onChange={(e) => setChoreForm({ ...choreForm, reward: e.target.value })}
                type="number"
                min={1}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <select
                value={choreForm.emoji}
                onChange={(e) => setChoreForm({ ...choreForm, emoji: e.target.value })}
                className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
              >
                {CHORE_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <button onClick={addChoreUI} className="shrink-0 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold">{t('knowledge.home.addChore', '＋ เพิ่มงาน')}</button>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => setChoreRepeat(choreRepeat === 'daily' ? 'none' : 'daily')}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${choreRepeat === 'daily' ? 'bg-cyan-500/15 border-cyan-600 text-cyan-300' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'}`}
              >
                {t('knowledge.home.dailyToggle', 'งานรายวัน {check}', { check: choreRepeat === 'daily' ? '✓' : '' })}
              </button>
              <span className="text-[9px] text-gray-600">{t('knowledge.home.dailyHint', 'งานรายวันจะรีเซ็ตเป็นค้างใหม่ทุกเช้า — ลูกทำได้ทุกวัน')}</span>
            </div>
          </div>

          {/* ── บิล — จ่ายเองจากเงินที่หามาได้ ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.billsTitle', 'บิล — ฝึกจ่ายค่าไฟ/น้ำ/ห้องเอง')}</h3>
              <span className="text-[10px] text-gray-500">{t('knowledge.home.billsPending', 'ค้าง {n} ใบ', { n: kidHome.bills.filter((b) => b.status === 'unpaid').length })}</span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {kidHome.bills.length === 0 && <div className="text-[11px] text-gray-600">{t('knowledge.home.billsEmpty', 'ยังไม่มีบิล — เพิ่ม "ค่าไฟ 50 บาท" "ค่าน้ำ 20 บาท" ให้ลูกฝึกจัดการ')}</div>}
              {kidHome.bills.map((b) => (
                <div key={b.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${b.status === 'paid' ? 'bg-gray-800/40 border-gray-800 text-gray-500' : 'bg-amber-900/10 border-amber-800/60 text-amber-200'}`}>
                  <span className="shrink-0">{b.emoji || '🧾'}</span>
                  <span className={`flex-1 truncate ${b.status === 'paid' ? 'line-through' : ''}`}>{b.title}</span>
                  {b.period === 'monthly' && <span className="shrink-0 text-[9px] text-gray-500">{t('knowledge.home.monthly', 'รายเดือน')}</span>}
                  <span className="shrink-0 font-bold">{b.amount.toLocaleString()}฿</span>
                  {b.status === 'unpaid' ? (
                    <button
                      onClick={() => payBillUI(b.id)}
                      disabled={kidHome.balance < b.amount}
                      title={kidHome.balance < b.amount ? t('knowledge.home.noMoney', 'เงินไม่พอ — ทำงานบ้านก่อน') : t('knowledge.home.payTitle', 'จ่ายจากกระเป๋าเงิน')}
                      className="shrink-0 px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('knowledge.home.pay', 'จ่าย')}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-emerald-500">{t('knowledge.home.paid', '✓ จ่ายแล้ว')}</span>
                  )}
                  <button onClick={() => deleteBillUI(b.id)} title={t('common.delete', 'ลบ')} className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 pt-1">
              <input
                value={billForm.title}
                onChange={(e) => setBillForm({ ...billForm, title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addBillUI()}
                placeholder={t('knowledge.home.billPh', 'บิล เช่น ค่าไฟ')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={billForm.amount}
                onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })}
                type="number"
                min={1}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <select
                value={billForm.period}
                onChange={(e) => setBillForm({ ...billForm, period: e.target.value })}
                className="w-20 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
              >
                <option value="one-time">{t('knowledge.home.once', 'ครั้งเดียว')}</option>
                <option value="monthly">{t('knowledge.home.monthly', 'รายเดือน')}</option>
              </select>
              <button onClick={addBillUI} className="shrink-0 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold">{t('knowledge.home.addBill', '＋ เพิ่มบิล')}</button>
            </div>
          </div>

          {/* ── ค่าขนมรายสัปดาห์อัตโนมัติ ── */}
          <div className="inset p-3 space-y-2">
            <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.allowanceTitle', 'ค่าขนมรายสัปดาห์')}</h3>
            <div className="flex gap-1.5 items-center">
              <select
                value={allowanceForm.day}
                onChange={(e) => setAllowanceForm({ ...allowanceForm, day: e.target.value })}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              >
                {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{t('knowledge.home.everyDay', 'ทุกวัน{day}', { day: t(`knowledge.weekday.${i}`, d) })}</option>)}
              </select>
              <input
                value={allowanceForm.amount}
                onChange={(e) => setAllowanceForm({ ...allowanceForm, amount: e.target.value })}
                type="number"
                min={1}
                placeholder={t('knowledge.home.bahtPerWeek', 'บาท/สัปดาห์')}
                className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={setAllowanceUI} className="shrink-0 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold">{t('knowledge.home.set', 'ตั้งค่า')}</button>
            </div>
            {kidHome.kid.allowance_amount != null ? (
              <div className="text-[10px] text-gray-400 bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5 leading-relaxed">
                {t('knowledge.home.paysAutoA', 'ระบบจะจ่าย ')}<b className="text-emerald-400">{kidHome.kid.allowance_amount}฿</b>{t('knowledge.home.paysAutoB', ' ให้อัตโนมัติทุกวัน{day}', { day: t(`knowledge.weekday.${kidHome.kid.allowance_day ?? 0}`, WEEKDAY_LABELS[kidHome.kid.allowance_day ?? 0]) })}
                {kidHome.kid.allowance_last_paid
                  ? <> — {t('knowledge.home.lastPaid', 'จ่ายล่าสุด {date}', { date: fmtDate(kidHome.kid.allowance_last_paid) })}</>
                  : <> — {t('knowledge.home.notPaidYet', 'ยังไม่เคยจ่าย (รอถึงวันจ่าย)')}</>}
              </div>
            ) : (
              <div className="text-[10px] text-gray-600">{t('knowledge.home.allowanceHint', 'ตั้งวันจ่าย + จำนวนเงิน แล้วระบบจ่ายให้เองทุกสัปดาห์ (กันจ่ายซ้ำอัตโนมัติ)')}</div>
            )}
          </div>

          {/* ── ถังสะสมแต้ม — เปลี่ยนคะแนนเป็นเหรียญเก็บกระปุก + เป้าหมายออม ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.piggyTitle', 'ถังสะสมแต้ม')}</h3>
              <span className="text-[10px] text-gray-500">{t('knowledge.home.piggyDesc', 'เหรียญที่ลูกเก็บได้จริง (แยกจากกระเป๋าเงิน)')}</span>
            </div>
            <div className="flex items-end gap-3">
              <div>
                <div className="text-[10px] text-gray-500">{t('knowledge.home.inPiggy', 'ในกระปุก')}</div>
                <div className="text-2xl font-bold text-amber-300 glow-text">{kidHome.piggy.toLocaleString()} ฿</div>
              </div>
              {kidHome.kid.savings_goal != null && kidHome.kid.savings_goal > 0 && (
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-[10px] text-gray-500">
                    <span>{t('knowledge.home.monthProgress', 'เดือนนี้ {cur}/{goal} ฿', { cur: kidHome.piggy_month.toLocaleString(), goal: kidHome.kid.savings_goal })}</span>
                    <span>{Math.min(100, Math.round((kidHome.piggy_month / kidHome.kid.savings_goal) * 100))}%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300" style={{ width: `${Math.min(100, Math.round((kidHome.piggy_month / kidHome.kid.savings_goal) * 100))}%` }} />
                  </div>
                  {kidHome.piggy_month >= kidHome.kid.savings_goal && (
                    <div className="text-[10px] text-emerald-400 mt-0.5">{t('knowledge.home.goalReached', 'ถึงเป้าหมายแล้ว!')}</div>
                  )}
                </div>
              )}
            </div>
            {/* เป้าหมายระยะยาวของถัง */}
            {kidHome.kid.piggy_target_amount != null && kidHome.kid.piggy_target_amount > 0 ? (
              <div className="bg-gray-800/40 border border-amber-800/50 rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-amber-200">{kidHome.kid.piggy_target_title}</span>
                  <span className="text-gray-400">{kidHome.piggy.toLocaleString()}/{kidHome.kid.piggy_target_amount.toLocaleString()}฿ ({Math.min(100, Math.round((kidHome.piggy / kidHome.kid.piggy_target_amount) * 100))}%)</span>
                </div>
                <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400" style={{ width: `${Math.min(100, Math.round((kidHome.piggy / kidHome.kid.piggy_target_amount) * 100))}%` }} />
                </div>
                {kidHome.piggy >= kidHome.kid.piggy_target_amount ? (
                  <div className="text-[10px] text-emerald-400 font-bold">{t('knowledge.home.targetReached', 'ถึงเป้าหมายแล้ว! เตรียมรับรางวัลใหญ่')}</div>
                ) : (
                  <div className="text-[10px] text-gray-400">
                    {t('knowledge.home.targetLeft', 'เหลืออีก {n}฿ · ', { n: (kidHome.kid.piggy_target_amount - kidHome.piggy).toLocaleString() })}{kidHome.piggy_eta.months != null
                      ? <>{t('knowledge.home.etaA', 'คาดว่าอีก ')}<b className="text-amber-300">{t('knowledge.home.etaMonths', '{n} เดือน', { n: kidHome.piggy_eta.months })}</b>{t('knowledge.home.etaB', ' (เก็บเดือนละ {rate}฿)', { rate: kidHome.piggy_eta.monthlyRate })}</>
                      : t('knowledge.home.noRate', 'ยังไม่มีอัตราการฝาก — เริ่มฝากเหรียญบ่อยๆ นะ')}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-gray-600">{t('knowledge.home.targetHint', 'ตั้งเป้าหมายระยะยาว เช่น "ซื้อจักรยาน 500฿" เพื่อสอนลูกเรื่องการตั้งเป้าหมายและอดออม')}</div>
            )}
            <div className="flex gap-1.5 items-center">
              <input
                value={targetForm.title}
                onChange={(e) => setTargetForm((prev) => ({ ...prev, title: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && setPiggyTargetUI()}
                placeholder={t('knowledge.home.targetPh', 'เป้าหมาย เช่น ซื้อจักรยาน')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={targetForm.amount}
                onChange={(e) => setTargetForm((prev) => ({ ...prev, amount: e.target.value }))}
                type="number"
                min={0}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={setPiggyTargetUI} className="shrink-0 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[11px]">{t('knowledge.home.setTarget', 'ตั้งเป้า')}</button>
              {kidHome.kid.piggy_target_amount != null && (
                <button onClick={() => { setTargetForm({ title: '', amount: '0' }); setTimeout(setPiggyTargetUI, 0); }} className="text-[10px] text-gray-600 hover:text-gray-400 underline">{t('knowledge.home.clear', 'ล้าง')}</button>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              {PIGGY_PRESETS.map((p) => (
                <button key={p} onClick={() => setPiggyForm((prev) => ({ ...prev, amount: String(p) }))} className={`px-2 py-0.5 rounded text-[10px] border ${piggyForm.amount === String(p) ? 'bg-amber-600 border-amber-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>{p}฿</button>
              ))}
              <input
                value={piggyForm.amount}
                onChange={(e) => setPiggyForm((prev) => ({ ...prev, amount: e.target.value }))}
                type="number"
                min={1}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={piggyForm.note}
                onChange={(e) => setPiggyForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder={t('knowledge.home.piggyNotePh', 'หมายเหตุ เช่น เก็บค่าแป้ง')}
                className="flex-1 min-w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={() => piggyTransferUI(1)} disabled={kidHome.balance < (Number(piggyForm.amount) || 0)} title={kidHome.balance < (Number(piggyForm.amount) || 0) ? t('knowledge.home.piggyNoMoney', 'เงินในกระเป๋าไม่พอ') : t('knowledge.home.piggyDepositTitle', 'หักจากกระเป๋าเงินเข้าถัง')} className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">{t('knowledge.home.deposit', 'ฝาก')}</button>
              <button onClick={() => piggyTransferUI(-1)} disabled={kidHome.piggy < (Number(piggyForm.amount) || 0)} title={kidHome.piggy < (Number(piggyForm.amount) || 0) ? t('knowledge.home.piggyNoCoin', 'เหรียญในถังไม่พอ') : t('knowledge.home.piggyWithdrawTitle', 'ถอนกลับกระเป๋าเงิน')} className="px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">{t('knowledge.home.withdraw', '↩ ถอน')}</button>
            </div>
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] text-gray-500 shrink-0">{t('knowledge.home.monthGoal', 'เป้าหมายออม/เดือน:')}</span>
              <input
                value={goalForm.amount}
                onChange={(e) => setGoalForm({ amount: e.target.value })}
                type="number"
                min={0}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={setSavingsGoalUI} className="shrink-0 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[11px]">{t('knowledge.home.setGoal', 'ตั้งเป้าหมาย')}</button>
              <button onClick={() => { setGoalForm({ amount: '0' }); setTimeout(setSavingsGoalUI, 0); }} className="text-[10px] text-gray-600 hover:text-gray-400 underline">{t('knowledge.home.close', 'ปิด')}</button>
            </div>
            {kidHome.piggy_txs.length > 0 && (
              <div className="log-stream space-y-1 max-h-24 overflow-y-auto pr-1">
                <div className="text-[10px] text-gray-500">{t('knowledge.home.piggyHistory', 'ประวัติถัง:')}</div>
                {kidHome.piggy_txs.slice(0, 6).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                    <span className="truncate text-gray-400">{tx.note || (tx.amount >= 0 ? t('knowledge.home.piggyDeposited', 'ฝากเข้าถัง') : t('knowledge.home.piggyWithdrawn', 'ถอนจากถัง'))}</span>
                    <span className={`shrink-0 font-bold ${tx.amount >= 0 ? 'text-amber-300' : 'text-gray-400'}`}>{tx.amount >= 0 ? '+' : ''}{tx.amount}฿</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── PIN ส่วนตัวของลูก — ให้เด็กกดเองได้ ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.pinTitle', 'PIN ของลูก')}</h3>
              {kidHome.kid.has_pin ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">{t('knowledge.home.pinSet', 'ตั้งแล้ว — ต้องกรอกก่อนทำงานเสร็จ/แลกคูปอง')}</span>
              ) : (
                <span className="text-[10px] text-gray-500">{t('knowledge.home.pinNotSet', 'ยังไม่ได้ตั้ง — ลูกกดเองได้เลย')}</span>
              )}
            </div>
            <div className="flex gap-1.5 items-center">
              <input
                value={pinForm}
                onChange={(e) => setPinForm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setPinUI()}
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder={kidHome.kid.has_pin ? t('knowledge.home.pinNewPh', 'PIN ใหม่ (4-6 หลัก) หรือเว้นว่างเพื่อล้าง') : t('knowledge.home.pinSetPh', 'ตั้ง PIN 4-6 หลัก')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={setPinUI} className="shrink-0 px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-xs">{t('common.save', 'บันทึก')}</button>
            </div>
            <div className="text-[10px] text-gray-600 leading-relaxed">{t('knowledge.home.pinHint', 'ตั้ง PIN แล้ว ลูกจะกรอกรหัสก่อนกด "✓ เสร็จ" และ "แลก" — ฝึกให้ลูกรับผิดชอบงานและคะแนนของตัวเอง')}</div>
          </div>

          {/* ── หุ้นจำลองของบ้าน — สอนลูกเรื่องการลงทุน ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.stocksTitle', 'หุ้นจำลองของบ้าน')}</h3>
              <span className="text-[10px] text-gray-500">{t('knowledge.home.stocksDesc', 'ราคาเปลี่ยนทุกวัน (ธีมเดียวกับบ้านเรา)')}</span>
            </div>
            {stocks.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {stocks.map((s) => (
                  <div key={s.symbol} className={`rounded-lg border p-2 text-center cursor-pointer ${stockForm.symbol === s.symbol ? 'bg-emerald-500/15 border-emerald-500/60' : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'}`} onClick={() => setStockForm((prev) => ({ ...prev, symbol: s.symbol }))}>
                    <div className="text-base">{s.emoji}</div>
                    <div className="text-[10px] text-gray-400 truncate">{s.name}</div>
                    <div className="text-sm font-bold text-emerald-300">{s.price.toFixed(2)}฿</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 items-center">
              <input
                value={stockForm.units}
                onChange={(e) => setStockForm((prev) => ({ ...prev, units: e.target.value }))}
                type="number"
                min={1}
                placeholder={t('knowledge.home.unitsPh', 'หน่วย')}
                className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={buyStockUI} disabled={(kidHome?.balance ?? 0) <= 0} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold disabled:opacity-40">{t('knowledge.home.buy', 'ซื้อ')}</button>
            </div>
            {kidHome.portfolio.holdings.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                  <span className="text-gray-400">{t('knowledge.home.portfolioValue', 'มูลค่าพอร์ตรวม')}</span>
                  <span className="font-bold text-gray-100 glow-text">{kidHome.portfolio.value.toLocaleString()}฿</span>
                  <span className={kidHome.portfolio.totalProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {kidHome.portfolio.totalProfit >= 0 ? '+' : ''}{kidHome.portfolio.totalProfit.toLocaleString()}฿
                  </span>
                </div>
                {kidHome.portfolio.holdings.map((h) => (
                  <div key={h.symbol} className="flex items-center gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                    <span className="shrink-0">{h.emoji}</span>
                    <span className="flex-1 truncate text-gray-400">{t('knowledge.home.holdings', '{name} · {units} หน่วย', { name: h.name, units: h.units })}</span>
                    <span className="shrink-0 text-gray-500">{t('knowledge.home.cost', 'ต้นทุน {cost}฿', { cost: h.avg_cost })}</span>
                    <span className={`shrink-0 font-bold ${h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{h.profit >= 0 ? '+' : ''}{h.profit}฿ ({h.profitPct}%)</span>
                    <button onClick={() => sellStockUI(h.symbol, Math.min(1, h.units))} className="shrink-0 px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-800 border border-red-800 text-[10px]">{t('knowledge.home.sell', 'ขาย')}</button>
                  </div>
                ))}
              </div>
            )}
            {/* กราฟมูลค่าพอร์ตย้อนหลัง (SVG) */}
            {kidHome.portfolio_history.length > 1 && (
              <PortfolioHistoryChart data={kidHome.portfolio_history} />
            )}

            {/* ผลตอบแทน vs เงินฝาก + เป้าหมายรายเดือน */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                  <div className="text-gray-500">{t('knowledge.home.deposited', 'เงินจริงที่พ่อแม่ฝาก')}</div>
                  <div className="font-bold text-gray-100">{kidHome.portfolio_performance.total_deposited.toLocaleString()}฿</div>
                </div>
                <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                  <div className="text-gray-500">{t('knowledge.home.totalReturn', 'ผลตอบแทนรวม')}</div>
                  <div className={`font-bold ${kidHome.portfolio_performance.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {kidHome.portfolio_performance.profit >= 0 ? '+' : ''}{kidHome.portfolio_performance.profit.toLocaleString()}฿ ({kidHome.portfolio_performance.profit_pct}%)
                  </div>
                </div>
              </div>
              <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-500">{t('knowledge.home.monthReturn', 'ผลตอบแทนเดือนนี้: {pct} · เป้าหมาย {target}%', { pct: kidHome.portfolio_performance.month_return_pct != null ? `${kidHome.portfolio_performance.month_return_pct >= 0 ? '+' : ''}${kidHome.portfolio_performance.month_return_pct}%` : t('knowledge.home.noMonthData', 'ยังไม่มีข้อมูล'), target: kidHome.portfolio_performance.target_pct })}</span>
                  <span className={`font-bold ${(kidHome.portfolio_performance.month_return_pct ?? -999) >= kidHome.portfolio_performance.target_pct ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {kidHome.portfolio_performance.month_return_pct != null && kidHome.portfolio_performance.target_pct > 0 ? ((kidHome.portfolio_performance.month_return_pct ?? 0) >= kidHome.portfolio_performance.target_pct ? t('knowledge.home.onTarget', '✓ ถึงเป้า') : t('knowledge.home.offTarget', 'ยังไม่ถึง')) : ''}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${Math.min(100, kidHome.portfolio_performance.target_pct > 0 ? ((kidHome.portfolio_performance.month_return_pct ?? 0) / kidHome.portfolio_performance.target_pct) * 100 : 0)}%` }} />
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <input
                    value={targetPctForm.pct}
                    onChange={(e) => setTargetPctForm({ pct: e.target.value })}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    placeholder={t('knowledge.home.pctPerMonth', '% ต่อเดือน')}
                    className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[10px]"
                  />
                  <button onClick={setTargetUI} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[10px]">{t('knowledge.home.setTarget', 'ตั้งเป้า')}</button>
                </div>
              </div>
              {/* ฝากเงินจริงเข้าพอร์ต */}
              <div className="flex gap-1.5 items-center pt-0.5">
                <input
                  value={depositForm.amount}
                  onChange={(e) => setDepositForm((p) => ({ ...p, amount: e.target.value }))}
                  type="number"
                  min={1}
                  placeholder={t('knowledge.home.amountPh', 'จำนวน (฿)')}
                  className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[11px]"
                />
                <input
                  value={depositForm.note}
                  onChange={(e) => setDepositForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder={t('knowledge.home.depositNotePh', 'หมายเหตุ เช่น เงินออมจากค่าขนม')}
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[11px]"
                />
                <button onClick={addDepositUI} className="shrink-0 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-[11px] font-bold">{t('knowledge.home.realDeposit', 'เติมเงินจริง')}</button>
              </div>
              {kidHome.portfolio_deposits.length > 0 && (
                <div className="text-[10px] text-gray-500 space-y-0.5 max-h-16 overflow-y-auto pr-1">
                  {kidHome.portfolio_deposits.slice(0, 5).map((d) => (
                    <div key={d.id} className="flex justify-between">
                      <span className="truncate">{d.note}</span>
                      <span className="shrink-0 font-bold text-amber-300">+{d.amount}฿</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-[9px] text-gray-600 leading-relaxed">{t('knowledge.home.investHint', 'ซื้อถูก-ขายแพง เก็บเงินส่วนหนึ่งเข้าถังเสมอ — อยากรู้วิธี ไปให้ AI สอนลูก:')}</span>
              <button
                onClick={() => { setShowKidHome(false); setTeachTopic('การออมเงิน หุ้น และการลงทุนสำหรับเด็ก'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-700 text-emerald-300 hover:bg-emerald-800"
              >
                {t('knowledge.home.learnInvest', 'สอนเรื่องออม/หุ้น')}
              </button>
            </div>
          </div>

          {/* ── ประวัติการใช้งาน (audit log) ── */}
          <div className="inset p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('knowledge.home.auditTitle', 'ประวัติการใช้งานของลูก')}</h3>
              <span className="text-[10px] text-gray-500">{auditLoading ? t('common.loading', 'กำลังโหลด...') : t('knowledge.home.auditCount', '{n} รายการ', { n: audit.length })}</span>
            </div>
            {audit.length === 0 ? (
              <div className="text-[11px] text-gray-600">{t('knowledge.home.auditEmpty', 'ยังไม่มีประวัติ — กิจกรรมของลูก (ทำงานเสร็จ/จ่ายบิล/แลกคูปอง/ตั้ง PIN/ซื้อขายหุ้น) จะบันทึกที่นี่')}</div>
            ) : (
              <div className="log-stream space-y-1 max-h-40 overflow-y-auto pr-1">
                {audit.slice(0, 15).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                    <span className="shrink-0">{t(`knowledge.auditLabels.${a.action}`, AUDIT_LABELS[a.action] || a.action)}</span>
                    <span className="flex-1 truncate text-gray-400">{a.detail}</span>
                    <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded ${a.actor === 'kid' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-gray-700 text-gray-400'}`}>{a.actor === 'kid' ? t('knowledge.home.actorKid', 'ลูก') : t('knowledge.home.actorAdult', 'ผู้ใหญ่')}</span>
                    <span className="shrink-0 text-gray-600">{fmtDate(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── คูปองรางวัล — ลูกแลกด้วยคะแนนจากการทำงานบ้าน ── */}
          <div className="inset p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.couponsTitle', 'คูปองรางวัล')}</h3>
              <span className="text-[10px] text-gray-500">{t('knowledge.home.couponsDesc', 'แลกด้วยคะแนนที่หาได้จากงานบ้าน')}</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {kidHome.coupons.length === 0 && <div className="text-[11px] text-gray-600">{t('knowledge.home.couponsEmpty', 'ยังไม่มีคูปอง — สร้างรางวัลพิเศษ เช่น "เล่นเกม 30 นาที" แล้วให้ลูกทำงานสะสมคะแนนมาแลก')}</div>}
              {kidHome.coupons.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${c.status === 'redeemed' ? 'bg-gray-800/40 border-gray-800 text-gray-500' : 'bg-violet-500/15 border-violet-500/40 text-violet-200'}`}>
                  <span className="shrink-0">{c.emoji || '🎟️'}</span>
                  <span className={`flex-1 truncate ${c.status === 'redeemed' ? 'line-through' : ''}`}>{c.title}</span>
                  <span className="shrink-0 font-bold text-amber-300">{t('knowledge.home.points', '{n} แต้ม', { n: c.cost })}</span>
                  {c.status === 'available' ? (
                    <button
                      onClick={() => redeemCouponUI(c)}
                      disabled={kidHome.balance < c.cost}
                      title={kidHome.balance < c.cost ? t('knowledge.home.noPoints', 'คะแนนไม่พอ (มี {n})', { n: kidHome.balance }) : t('knowledge.home.redeemTitle', 'แลกเลย')}
                      className="shrink-0 px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('knowledge.home.redeem', 'แลก')}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-emerald-500">{t('knowledge.home.redeemed', '✓ แลกแล้ว')}</span>
                  )}
                  <button onClick={() => deleteCouponUI(c)} title={t('common.delete', 'ลบ')} className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 pt-1">
              <div className="flex gap-1.5">
                <input
                  value={couponForm.title}
                  onChange={(e) => setCouponForm({ ...couponForm, title: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addCouponUI()}
                  placeholder={t('knowledge.home.couponPh', 'รางวัล เช่น เล่นเกม 30 นาที')}
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                />
                <input
                  value={couponForm.cost}
                  onChange={(e) => setCouponForm({ ...couponForm, cost: e.target.value })}
                  type="number"
                  min={1}
                  placeholder={t('knowledge.home.pointsPh', 'แต้ม')}
                  className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                />
                <select
                  value={couponForm.emoji}
                  onChange={(e) => setCouponForm({ ...couponForm, emoji: e.target.value })}
                  className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
                >
                  {COUPON_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <button onClick={addCouponUI} className="shrink-0 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-xs font-semibold">{t('knowledge.home.addCoupon', '＋ เพิ่มคูปอง')}</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {COUPON_PRESETS.map((p, i) => (
                  <button
                    key={p}
                    onClick={() => setCouponForm((prev) => ({ ...prev, title: p }))}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500 hover:border-violet-600 hover:text-violet-300"
                  >
                    {t(`knowledge.home.couponPreset${i}`, p)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── กระเป๋าเงิน + ประวัติ ── */}
          <div className="inset p-3 space-y-2">
            <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.home.walletTitle', 'กระเป๋าเงิน')}</h3>
            <div className="flex gap-1.5 flex-wrap items-center">
              {WALLET_PRESETS.map((p) => (
                <button key={p} onClick={() => setWalletAmount(String(p))} className={`px-2 py-0.5 rounded text-[10px] border ${walletAmount === String(p) ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>{p}฿</button>
              ))}
              <input
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                type="number"
                min={1}
                placeholder={t('knowledge.home.bahtPh', 'บาท')}
                className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={walletNote}
                onChange={(e) => setWalletNote(e.target.value)}
                placeholder={t('knowledge.home.walletNotePh', 'หมายเหตุ เช่น เงินเดือนประจำสัปดาห์')}
                className="flex-1 min-w-32 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <button onClick={() => adjustWalletUI(1)} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold">{t('knowledge.home.addMoney', '＋ เติม')}</button>
              <button onClick={() => adjustWalletUI(-1)} className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-xs font-semibold">{t('knowledge.home.deductMoney', '－ หัก')}</button>
            </div>
            {kidHome.balance < 0 && (
              <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/40 rounded p-1.5">{t('knowledge.home.negative', 'ติดลบ {n}฿ — สอนลูกเรื่องการจัดสรรเงินก่อนจ่ายบิลเกินตัว', { n: Math.abs(kidHome.balance) })}</div>
            )}
            {kidHome.txs.length > 0 && (
              <div className="log-stream space-y-1 max-h-32 overflow-y-auto pr-1">
                <div className="text-[10px] text-gray-500">{t('knowledge.home.recentTxs', 'ประวัติล่าสุด:')}</div>
                {kidHome.txs.slice(0, 8).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                    <span className="truncate text-gray-400">
                      {tx.category === 'chore' ? t('knowledge.home.txChore', 'ทำงาน') : tx.category === 'bill' ? t('knowledge.home.txBill', 'จ่ายบิล') : tx.category === 'allowance' ? t('knowledge.home.txAllowance', 'ค่าขนม') : tx.category === 'coupon' ? t('knowledge.home.txCoupon', 'แลกคูปอง') : t('knowledge.home.txManual', 'ปรับยอด')}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </span>
                    <span className={`shrink-0 font-bold ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}฿
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
