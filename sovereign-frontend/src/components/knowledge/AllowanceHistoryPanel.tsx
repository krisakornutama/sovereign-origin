"use client";
// ── ประวัติค่าขนมทุกคน + จ่ายย้อนหลัง — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { AllowanceHistoryKid, WEEKDAY_LABELS, fmtDate, isPaidThisWeek } from './knowledge-types';

interface AllowanceHistoryPanelProps {
  loadAllowanceHistory: () => void;
  historyLoading: boolean;
  allowanceHistory: AllowanceHistoryKid[] | null;
  payAllowanceNowUI: (kidId: string, kidName: string) => void;
}

export default function AllowanceHistoryPanel({ loadAllowanceHistory, historyLoading, allowanceHistory, payAllowanceNowUI }: AllowanceHistoryPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-cyan p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-1.5"><Icon name="coin" size={14} className="text-gray-400" />{t('knowledge.allowance.title', 'ประวัติค่าขนมรายสัปดาห์')}</h3>
        <button onClick={loadAllowanceHistory} className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded inline-flex items-center gap-1"><Icon name="refresh" size={11} />{t('common.refresh', 'รีเฟรช')}</button>
      </div>
      {historyLoading && !allowanceHistory ? (
        <div className="text-xs text-gray-400 py-4 text-center">{t('common.loading', 'กำลังโหลด...')}</div>
      ) : !allowanceHistory || allowanceHistory.length === 0 ? (
        <div className="text-xs text-gray-500 py-3 text-center">{t('knowledge.allowance.noKids', 'ยังไม่มีโปรไฟล์เด็ก')}</div>
      ) : (
        <div className="space-y-3">
          {allowanceHistory.map((k) => {
            const day = k.allowance_day != null ? t(`knowledge.weekday.${k.allowance_day}`, WEEKDAY_LABELS[k.allowance_day]) : null;
            return (
              <div key={k.id} className="inset p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-bold text-gray-200">
                    {k.emoji || '🧒'} {k.name}
                    <span className="text-[10px] text-gray-500 font-normal ml-2">
                      {k.allowance_amount != null ? t('knowledge.allowance.pays', 'จ่ายทุกวัน{day} {amount}฿/สัปดาห์', { day, amount: k.allowance_amount }) : t('knowledge.allowance.notSet', 'ยังไม่ได้ตั้งค่าขนม')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {k.allowance_amount != null && (
                      <button
                        onClick={() => payAllowanceNowUI(k.id, k.name)}
                        disabled={isPaidThisWeek(k.allowance_day, k.allowance_last_paid)}
                        title={isPaidThisWeek(k.allowance_day, k.allowance_last_paid) ? t('knowledge.allowance.paidTitle', 'จ่ายครบสัปดาห์นี้แล้ว') : t('knowledge.allowance.manualTitle', 'worker พลาด → จ่ายด้วยมือ')}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t('knowledge.allowance.payBack', 'จ่ายย้อนหลัง')}
                      </button>
                    )}
                  </div>
                </div>
                {k.txs.length === 0 ? (
                  <div className="text-[11px] text-gray-600">{t('knowledge.allowance.neverPaid', 'ยังไม่เคยจ่ายค่าขนม — worker จะจ่ายอัตโนมัติวัน{day} หรือกด "จ่ายย้อนหลัง"', { day })}</div>
                ) : (
                  <div className="log-stream space-y-1 max-h-32 overflow-y-auto pr-1">
                    {k.txs.slice(0, 10).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                        <span className="truncate text-gray-400">{tx.note}</span>
                        <span className="shrink-0 text-emerald-400 font-bold">+{tx.amount}฿</span>
                        <span className="shrink-0 text-gray-600">{fmtDate(tx.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
</div>
  );
}
