"use client";
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWealthStore } from '../../stores/useWealthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';

function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function runwayColor(months: number | null): string {
  if (months == null) return 'text-gray-400';
  if (months < 3) return 'text-rose-400';
  if (months < 6) return 'text-amber-400';
  return 'text-emerald-400';
}

export default function WealthWidget() {
  const { token, isAuthenticated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const summary = useWealthStore((s) => s.summary);
  const seed = useWealthStore((s) => s.seed);

  // Seed ข้อมูลเริ่มต้นจาก REST (ตอนโหลดหน้า) — หลังจากนั้น socket จะอัปเดตให้ real-time
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    let cancelled = false;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/summary`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data || data.error) return;
        seed(data);
      })
      .catch(() => {
        /* backend ปิด portfolio หรือไม่มีข้อมูล — แสดงสถานะว่าง */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token, seed]);

  return (
    <div className="card panel-cyan p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text">
          <Icon name="coin" size={14} /> {t('dashboard.wealth.title', 'พอร์ต + Survival Runway')}
        </h3>
        <Link href="/treasury" scroll={false} className="text-xs text-sky-400 hover:underline">{t('dashboard.wealth.detailsLink', 'รายละเอียด →')}</Link>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="inset panel-cyan px-2.5 py-2">
              <div className="text-[10px] text-gray-500 flex items-center gap-1"><Icon name="trending-up" size={10} /> {t('dashboard.wealth.portfolio', 'พอร์ตการลงทุน')}</div>
              <div className="text-lg font-bold text-emerald-400 glow-text">{usd(summary.portfolioUsd)}</div>
            </div>
            <div className="inset panel-cyan px-2.5 py-2">
              <div className="text-[10px] text-gray-500">{t('dashboard.wealth.physicalSupplies', 'เสบียงกายภาพ')}</div>
              <div className="text-lg font-bold text-amber-400 glow-text">{usd(summary.inventoryUsd)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between inset panel-cyan px-2.5 py-2 mb-2">
            <span className="text-[10px] text-gray-500 flex items-center gap-1"><Icon name="coin" size={10} /> {t('dashboard.wealth.totalLiquidity', 'สภาพคล่องรวม (พอร์ต + เงินสด)')}</span>
            <span className="text-sm font-bold text-sky-400 glow-text">{usd(summary.grandTotalUsd)}</span>
          </div>

          <div className="flex items-center justify-between inset panel-cyan px-2.5 py-2">
            <span className="text-[10px] text-gray-500">{t('dashboard.wealth.runway', 'Survival Runway')}</span>
            <span className={`text-base font-bold ${runwayColor(summary.runway?.months ?? null)} glow-text`}>
              {summary.runway?.months != null ? t('dashboard.wealth.runwayMonths', '{n} เดือน', { n: summary.runway.months.toFixed(1) }) : '—'}
            </span>
          </div>
          {summary.runway && summary.runway.months != null && (
            <div className="text-[10px] text-gray-500 mt-1.5">
              {t('dashboard.wealth.burnDetail', 'ค่าใช้จ่าย {burn}/เดือน (ไฟ {energy}) · เงินสด {cash}', { burn: usd(summary.runway.monthlyBurnUsd), energy: usd(summary.runway.energyCostUsd), cash: usd(summary.cashUsd) })}
            </div>
          )}

          {summary.missingPrices.length > 0 && (
            <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2 py-1.5 mt-2 flex items-center gap-1">
              <Icon name="alert-triangle" size={10} /> {t('dashboard.wealth.missingPrices', 'ยังไม่มีราคา: {prices}', { prices: summary.missingPrices.join(', ') })}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-500">
          {t('dashboard.wealth.emptyBefore', 'ยังไม่มีข้อมูล — เปิด ')}<code className="text-gray-400">PORTFOLIO_ENABLED=true</code>{t('dashboard.wealth.emptyAfter', ' ใน .env แล้วกด')}
          <Link href="/treasury" scroll={false} className="text-sky-400 hover:underline">{t('dashboard.wealth.fetchPrices', ' ดึงราคา')}</Link>
        </div>
      )}
    </div>
  );
}
