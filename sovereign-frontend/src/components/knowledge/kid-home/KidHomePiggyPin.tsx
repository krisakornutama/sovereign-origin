// ── การ์ด: ถังสะสมแต้ม + เป้าหมายออม + PIN ของลูก (ย้ายจาก KidHomePanel.tsx verbatim — FE-006) ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { PIGGY_PRESETS, KidHome } from '../knowledge-types';

interface Props {
  kidHome: KidHome;
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
}

export default function KidHomePiggyPin({
  kidHome,
  piggyForm, setPiggyForm, piggyTransferUI, goalForm, setGoalForm, setSavingsGoalUI,
  targetForm, setTargetForm, setPiggyTargetUI,
  pinForm, setPinForm, setPinUI,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
    <>
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
    </>
  );
}
