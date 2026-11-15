// ── การ์ด: ประวัติการใช้งาน + คูปองรางวัล + กระเป๋าเงิน (ย้ายจาก KidHomePanel.tsx verbatim — FE-006) ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { AUDIT_LABELS, COUPON_EMOJIS, COUPON_PRESETS, WALLET_PRESETS, fmtDate, KidAuditRow, KidCoupon, KidHome } from '../knowledge-types';

interface Props {
  kidHome: KidHome;
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
}

export default function KidHomeHistoryCouponsWallet({
  kidHome,
  audit, auditLoading,
  couponForm, setCouponForm, addCouponUI, redeemCouponUI, deleteCouponUI,
  walletAmount, setWalletAmount, walletNote, setWalletNote, adjustWalletUI,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
    <>
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
  );
}
