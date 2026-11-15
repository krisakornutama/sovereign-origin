// ── การ์ด: งานบ้าน + บิล + ค่าขนมรายสัปดาห์ (ย้ายจาก KidHomePanel.tsx verbatim — FE-006) ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { CHORE_EMOJIS, WEEKDAY_LABELS, fmtDate, KidHome } from '../knowledge-types';

interface Props {
  kidHome: KidHome;
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
}

export default function KidHomeChoresBills({
  kidHome,
  choreForm, setChoreForm, choreRepeat, setChoreRepeat, addChoreUI, completeChoreUI, reopenChoreUI, deleteChoreUI,
  billForm, setBillForm, addBillUI, payBillUI, deleteBillUI,
  allowanceForm, setAllowanceForm, setAllowanceUI,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
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
    </>
  );
}
