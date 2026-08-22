"use client";
// ── สรุปความคืบหน้าของลูกทุกคน + กราฟคะแนนตามเวลา — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { KidProfile, KidProgressRow, KidStats } from './knowledge-types';
import { ScoreTrendChart, kidColor } from './charts';

interface ProgressPanelProps {
  progressLoading: boolean;
  kids: KidProfile[];
  kidStats: Record<string, KidStats>;
  allProgress: Record<string, KidProgressRow[]>;
}

export default function ProgressPanel({ progressLoading, kids, kidStats, allProgress }: ProgressPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-cyan p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-1.5"><Icon name="trending-up" size={14} className="text-gray-400" />{t('knowledge.progress.title', 'ความคืบหน้าของลูกทุกคน')}</h3>
        <span className="text-[10px] text-gray-500">{t('knowledge.progress.subtitle', 'คะแนนแบบทดสอบ (%) ตามเวลา')}</span>
      </div>

      {progressLoading ? (
        <div className="text-xs text-gray-400 py-6 text-center">{t('knowledge.progress.loading', 'กำลังโหลดคะแนนของทุกคน...')}</div>
      ) : (
        <>
          {/* สรุปต่อคน */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {kids.map((k) => {
              const st = kidStats[k.id];
              const rows = allProgress[k.id] || [];
              return (
                <div key={k.id} className="inset p-2.5">
                  <div className="text-xs font-bold text-gray-200">{k.emoji || '🧒'} {k.name}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {t('knowledge.progress.kidStats', 'เรียนจบ {n} บทเรียน · เฉลี่ย {avg}% · ดีที่สุด {best}%', { n: rows.length, avg: st?.avg ?? 0, best: st?.best ?? 0 })}
                  </div>
                  {rows.length > 0 && (
                    <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, st?.avg ?? 0)}%`, background: kidColor(k.name) }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* กราฟคะแนนตามเวลา */}
          <ScoreTrendChart
            series={kids
              .map((k) => ({
                name: k.name,
                color: kidColor(k.name),
                points: (allProgress[k.id] || []).map((p) => ({
                  time: new Date(p.completed_at).getTime(),
                  pct: p.total > 0 ? Math.round((p.score / p.total) * 100) : 0,
                  label: p.lesson_title,
                })),
              }))
              .filter((s) => s.points.length > 0)}
          />
          {Object.values(allProgress).every((r) => r.length === 0) && (
            <div className="text-xs text-gray-500 py-4 text-center">{t('knowledge.progress.empty', 'ยังไม่มีคะแนนแบบทดสอบ — สร้างบทเรียนแล้วให้ลูกทำ quiz เพื่อเห็นกราฟความก้าวหน้า')}</div>
          )}
        </>
      )}
    </div>
  );
}
