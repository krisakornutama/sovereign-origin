"use client";
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useRiskStore } from '../../stores/useRiskStore';
import { authFetch } from '../../lib/apiFetch';

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  war: { label: 'สงคราม', icon: '💥' },
  banking: { label: 'วิกฤตธนาคาร', icon: '🏦' },
  energy: { label: 'พลังงาน', icon: '⚡' },
  inflation: { label: 'เงินเฟ้อ', icon: '📈' },
};

function defconInfo(level: number): { label: string; color: string; ring: string } {
  switch (level) {
    case 1:
      return { label: 'DEFCON 1 · CRITICAL', color: 'text-red-400', ring: 'border-red-500 bg-red-900/30' };
    case 2:
      return { label: 'DEFCON 2 · SEVERE', color: 'text-orange-400', ring: 'border-orange-500 bg-orange-900/30' };
    case 3:
      return { label: 'DEFCON 3 · ELEVATED', color: 'text-yellow-400', ring: 'border-yellow-500 bg-yellow-900/30' };
    default:
      return { label: 'DEFCON 5 · NORMAL', color: 'text-green-400', ring: 'border-green-700 bg-green-900/20' };
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
    <div className="bg-gray-900/80 border border-gray-700 rounded-xl p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-200">🛡️ DEFCON / Threat Index</h3>
        <a href="/risk-monitor" className="text-xs text-blue-400 hover:underline">รายละเอียด →</a>
      </div>

      <div className={`rounded-lg border px-3 py-2 mb-3 ${info.ring}`}>
        <span className={`text-sm font-bold ${info.color}`}>{info.label}</span>
        {overall != null && (
          <span className="text-xs text-gray-400 ml-2">Threat Index {overall}/100</span>
        )}
      </div>

      {overall != null ? (
        <>
          {/* Gauge แนวนอน */}
          <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
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
              const c = v > 75 ? 'text-red-400' : v > 50 ? 'text-yellow-400' : 'text-gray-300';
              return (
                <div key={key} className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">{meta.icon} {meta.label}</span>
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
          ยังไม่มีข้อมูล — เปิด <code className="text-gray-400">RISK_MONITOR_ENABLED=true</code> + Ollama ใน .env แล้วกด
          <a href="/risk-monitor" className="text-blue-400 hover:underline"> 🔄 ดึงข่าว + วิเคราะห์</a>
        </div>
      )}
    </div>
  );
}
