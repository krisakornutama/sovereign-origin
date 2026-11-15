"use client";
// ── หน้าที่ของลูก — shell: header/ระดับ/นโยบาย + ประกอบการ์ดย่อย 4 ตัว (FE-006) ──
// เนื้อหาโซนที่เหลือถูกย้าย verbatim ไป components/knowledge/kid-home/ — props เดิมทุกชื่อ
import { useState, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
import Icon from '../ui/Icon';
import { KidAuditRow, KidCoupon, KidHome, KidStock } from './knowledge-types';
import { printCertificate, printWeeklyReport } from './kid-print';
import KidHomeChoresBills from './kid-home/KidHomeChoresBills';
import KidHomePiggyPin from './kid-home/KidHomePiggyPin';
import KidHomeStocks from './kid-home/KidHomeStocks';
import KidHomeHistoryCouponsWallet from './kid-home/KidHomeHistoryCouponsWallet';

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
              onClick={() => printWeeklyReport(t, { setReportLoading, setTeachError })}
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
                    <button onClick={() => printCertificate(t, setTeachError, cert, kidHome.kid)} className="shrink-0 px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-600 text-[10px] text-white">PDF</button>
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
          <KidHomeChoresBills
            kidHome={kidHome}
            choreForm={choreForm}
            setChoreForm={setChoreForm}
            choreRepeat={choreRepeat}
            setChoreRepeat={setChoreRepeat}
            addChoreUI={addChoreUI}
            completeChoreUI={completeChoreUI}
            reopenChoreUI={reopenChoreUI}
            deleteChoreUI={deleteChoreUI}
            billForm={billForm}
            setBillForm={setBillForm}
            addBillUI={addBillUI}
            payBillUI={payBillUI}
            deleteBillUI={deleteBillUI}
            allowanceForm={allowanceForm}
            setAllowanceForm={setAllowanceForm}
            setAllowanceUI={setAllowanceUI}
          />

          <KidHomePiggyPin
            kidHome={kidHome}
            piggyForm={piggyForm}
            setPiggyForm={setPiggyForm}
            piggyTransferUI={piggyTransferUI}
            goalForm={goalForm}
            setGoalForm={setGoalForm}
            setSavingsGoalUI={setSavingsGoalUI}
            targetForm={targetForm}
            setTargetForm={setTargetForm}
            setPiggyTargetUI={setPiggyTargetUI}
            pinForm={pinForm}
            setPinForm={setPinForm}
            setPinUI={setPinUI}
          />

          <KidHomeStocks
            kidHome={kidHome}
            stocks={stocks}
            stockForm={stockForm}
            setStockForm={setStockForm}
            buyStockUI={buyStockUI}
            sellStockUI={sellStockUI}
            targetPctForm={targetPctForm}
            setTargetPctForm={setTargetPctForm}
            setTargetUI={setTargetUI}
            depositForm={depositForm}
            setDepositForm={setDepositForm}
            addDepositUI={addDepositUI}
            setShowKidHome={setShowKidHome}
            setTeachTopic={setTeachTopic}
          />

          <KidHomeHistoryCouponsWallet
            kidHome={kidHome}
            audit={audit}
            auditLoading={auditLoading}
            couponForm={couponForm}
            setCouponForm={setCouponForm}
            addCouponUI={addCouponUI}
            redeemCouponUI={redeemCouponUI}
            deleteCouponUI={deleteCouponUI}
            walletAmount={walletAmount}
            setWalletAmount={setWalletAmount}
            walletNote={walletNote}
            setWalletNote={setWalletNote}
            adjustWalletUI={adjustWalletUI}
          />
        </>
      )}
    </div>
  );
}
