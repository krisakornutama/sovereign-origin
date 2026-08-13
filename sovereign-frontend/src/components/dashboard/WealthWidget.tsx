"use client";
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWealthStore } from '../../stores/useWealthStore';
import { authFetch } from '../../lib/apiFetch';

function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function runwayColor(months: number | null): string {
  if (months == null) return 'text-gray-400';
  if (months < 3) return 'text-red-400';
  if (months < 6) return 'text-yellow-400';
  return 'text-green-400';
}

export default function WealthWidget() {
  const { token, isAuthenticated } = useAuthStore();
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
    <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-200">💰 พอร์ต + Survival Runway</h3>
        <a href="/portfolio" className="text-xs text-blue-400 hover:underline">รายละเอียด →</a>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-2.5 py-2">
              <div className="text-[10px] text-gray-500">📈 พอร์ตการลงทุน</div>
              <div className="text-lg font-bold text-green-400">{usd(summary.portfolioUsd)}</div>
            </div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-2.5 py-2">
              <div className="text-[10px] text-gray-500">⛽ เสบียงกายภาพ</div>
              <div className="text-lg font-bold text-amber-400">{usd(summary.inventoryUsd)}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-2.5 py-2 mb-2">
            <span className="text-[10px] text-gray-500">💵 สภาพคล่องรวม (พอร์ต + เงินสด)</span>
            <span className="text-sm font-bold text-blue-400">{usd(summary.grandTotalUsd)}</span>
          </div>

          <div className="flex items-center justify-between rounded-lg px-2.5 py-2 border border-gray-700">
            <span className="text-[10px] text-gray-500">🏕️ Survival Runway</span>
            <span className={`text-base font-bold ${runwayColor(summary.runway?.months ?? null)}`}>
              {summary.runway?.months != null ? summary.runway.months.toFixed(1) + ' เดือน' : '—'}
            </span>
          </div>
          {summary.runway && summary.runway.months != null && (
            <div className="text-[10px] text-gray-500 mt-1.5">
              ค่าใช้จ่าย {usd(summary.runway.monthlyBurnUsd)}/เดือน (ไฟ {usd(summary.runway.energyCostUsd)}) · เงินสด {usd(summary.cashUsd)}
            </div>
          )}

          {summary.missingPrices.length > 0 && (
            <div className="text-[10px] text-yellow-400 bg-yellow-900/20 border border-yellow-700 rounded-lg px-2 py-1.5 mt-2">
              ⚠️ ยังไม่มีราคา: {summary.missingPrices.join(', ')}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-500">
          ยังไม่มีข้อมูล — เปิด <code className="text-gray-400">PORTFOLIO_ENABLED=true</code> ใน .env แล้วกด
          <a href="/portfolio" className="text-blue-400 hover:underline"> 🔄 ดึงราคา</a>
        </div>
      )}
    </div>
  );
}
