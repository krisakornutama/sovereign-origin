// ── การ์ด: หุ้นจำลองของบ้าน + พอร์ต + ผลตอบแทน (ย้ายจาก KidHomePanel.tsx verbatim — FE-006) ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { KidHome, KidStock } from '../knowledge-types';
import { PortfolioHistoryChart } from '../charts';

interface Props {
  kidHome: KidHome;
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
  setShowKidHome: Dispatch<SetStateAction<boolean>>;
  setTeachTopic: Dispatch<SetStateAction<string>>;
}

export default function KidHomeStocks({
  kidHome,
  stocks, stockForm, setStockForm, buyStockUI, sellStockUI,
  targetPctForm, setTargetPctForm, setTargetUI, depositForm, setDepositForm, addDepositUI,
  setShowKidHome, setTeachTopic,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
    <>
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
    </>
  );
}
