"use client";
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../../stores/useAuthStore';
import { useRiskStore } from '../../stores/useRiskStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  war: { label: 'สงคราม', icon: '' },
  banking: { label: 'วิกฤตธนาคาร', icon: '' },
  energy: { label: 'พลังงาน', icon: '' },
  inflation: { label: 'เงินเฟ้อ', icon: '' },
};

function defconInfo(level: number): { label: string; color: string; ring: string } {
  switch (level) {
    case 1:
      return { label: 'DEFCON 1 · CRITICAL', color: 'text-rose-400', ring: 'border-rose-800/60 bg-rose-950/40' };
    case 2:
      return { label: 'DEFCON 2 · SEVERE', color: 'text-orange-400', ring: 'border-orange-800/60 bg-orange-950/40' };
    case 3:
      return { label: 'DEFCON 3 · ELEVATED', color: 'text-amber-400', ring: 'border-amber-800/60 bg-amber-950/40' };
    default:
      return { label: 'DEFCON 5 · NORMAL', color: 'text-emerald-400', ring: 'border-emerald-800/60 bg-emerald-950/40' };
  }
}

function threatColor(overall: number | null): string {
  if (overall == null) return '#6b7280';
  if (overall > 75) return '#ef4444';
  if (overall > 50) return '#f59e0b';
  return '#10b981';
}

export default function DefconWidget() {
  const { token, isAuthenticated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const threat = useRiskStore((s) => s.threat);
  const defconLevel = useRiskStore((s) => s.defconLevel);
  const seed = useRiskStore((s) => s.seed);

  // Seed ข้อมูลเริ่มต้นจาก REST (ตอนโหลดหน้า) — หลังจากนั้น socket จะอัปเดตให้ real-time
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    let cancelled = false;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/overview`)
      .then((res) => res.json())
      .then((data: { threatIndex: any; defconLevel: number }) => {
        if (cancelled || !data.threatIndex) return;
        seed(
          {
            overall: data.threatIndex.overall,
            categories: data.threatIndex.categories || {},
            summary: data.threatIndex.summary || undefined,
          },
          data.defconLevel ?? 0
        );
      })
      .catch(() => {
        /* backend ปิด risk monitor — widget แสดงสถานะว่าง */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token, seed]);

  const info = defconInfo(defconLevel);
  const overall = threat?.overall ?? null;
  const categories = threat?.categories || {};
  const color = threatColor(overall);

  return (
    <div className="card panel-glow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text">
          <Icon name="shield" size={14} /> DEFCON / Threat Index
        </h3>
        <Link href="/risk-monitor" scroll={false} className="text-xs text-sky-400 hover:underline">{t('dashboard.defcon.detailsLink', 'รายละเอียด →')}</Link>
      </div>

      <div className={`rounded-lg border px-3 py-2 mb-3 ${info.ring}`}>
        <span className={`text-sm font-bold ${info.color} glow-text`}>{t(`dashboard.defcon.level${defconLevel === 1 || defconLevel === 2 || defconLevel === 3 ? defconLevel : 5}`, info.label)}</span>
        {overall != null && (
          <span className="text-xs text-gray-400 ml-2 glow-text">Threat Index {overall}/100</span>
        )}
      </div>

      {overall != null ? (
        <>
          {/* Gauge แนวนอน */}
          <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden mb-2 panel-cyan">
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, overall)}%`, background: color }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-3">
            <span>50 → DEFCON 3</span>
            <span>75 → DEFCON 2</span>
            <span>90 → DEFCON 1</span>
          </div>

          {/* หมวดหมู่ย่อย */}
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CATEGORY_LABELS).map(([key, meta]) => {
              const v = categories[key] ?? 0;
              const c = v > 75 ? 'text-rose-400' : v > 50 ? 'text-amber-400' : 'text-gray-300';
              return (
                <div key={key} className="inset panel-cyan px-2 py-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">{t(`dashboard.defcon.category.${key}`, meta.label)}</span>
                    <span className={c}>{v}</span>
                  </div>
                  <div className="bg-gray-700 h-1 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${Math.min(100, v)}%`, background: v > 75 ? '#ef4444' : v > 50 ? '#f59e0b' : '#10b981' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {threat?.summary && (
            <div className="text-[11px] text-gray-400 mt-2 line-clamp-2">{threat.summary}</div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-500">
          {t('dashboard.defcon.emptyBefore', 'ยังไม่มีข้อมูล — เปิด ')}<code className="text-gray-400">RISK_MONITOR_ENABLED=true</code>{t('dashboard.defcon.emptyAfter', ' + Ollama ใน .env แล้วกด')}
          <Link href="/risk-monitor" scroll={false} className="text-sky-400 hover:underline">{t('dashboard.defcon.fetchNews', ' ดึงข่าว + วิเคราะห์')}</Link>
        </div>
      )}
    </div>
  );
}
