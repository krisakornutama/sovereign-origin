"use client";
import { useState } from 'react';
import type { FarmPlot } from '../../types';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';

// ── เฟส 3: แนะนำการปลูก + คาดการณ์ผลผลิต (heuristic ตอบได้เสมอ — AI เป็นตัวเสริม) ──
// ที่มาตัวเลขแสดงชัดเจนทุกครั้ง: ประวัติจริงแปลง / ประวัติแปลงอื่น / ค่าประมาณ
// แหล่งคำตอบแสดงชัดเจน: heuristic หรือ ollama (ไม่หลอกผู้ใช้)

const BASIS_LABEL_KEY: Record<string, string> = {
  history: 'farm.advisor.basisHistory',
  'global-history': 'farm.advisor.basisGlobal',
  estimate: 'farm.advisor.basisEstimate',
};

interface AdvisorRec {
  crop: string;
  cropLabel: string;
  score: number;
  expectedKg: number;
  perSqmKg: number;
  basis: string;
  boosted: boolean;
  reasons: string[];
}

export default function PlotAdvisor({ plot, cropLabelOf }: { plot: FarmPlot; cropLabelOf: (crop: string) => string }) {
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [withAi, setWithAi] = useState(false);
  const [err, setErr] = useState('');

  const run = async (ai: boolean) => {
    setLoading(true); setErr(''); setWithAi(ai);
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${plot.id}/advisor?top=3${ai ? '&ai=1' : ''}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('farm.advisor.failed', 'คำนวณไม่สำเร็จ'));
      setData(d);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (s: number) => (s >= 85 ? 'text-emerald-400' : s >= 60 ? 'text-lime-300' : 'text-amber-400');

  return (
    <div className="border-t border-lime-800/50 pt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-lime-300">{t('farm.advisor.title', 'แนะนำการปลูก + คาดการณ์ผลผลิต')}</span>
        <button onClick={() => run(false)} disabled={loading}
          className="shrink-0 px-2 py-1 bg-lime-700/60 hover:bg-lime-700 border border-lime-600/50 rounded text-[11px] font-bold disabled:opacity-50">
          {loading && !withAi ? t('farm.advisor.calculating', 'กำลังคำนวณ...') : t('farm.advisor.run', 'คำนวณ')}
        </button>
        <button onClick={() => run(true)} disabled={loading} title={t('farm.advisor.aiHint', 'ให้ AI เรียบเรียงเพิ่ม (ถ้า Ollama พร้อม)')}
          className="shrink-0 px-2 py-1 bg-cyan-800/60 hover:bg-cyan-800 border border-cyan-600/50 rounded text-[11px] font-bold disabled:opacity-50">
          {loading && withAi ? t('farm.advisor.aiWorking', 'ถาม AI...') : t('farm.advisor.runAi', '+ AI')}
        </button>
      </div>

      {err && <div className="text-[11px] text-red-400">{err}</div>}

      {data && (
        <div className="bg-gray-950/60 border border-lime-900 rounded-lg p-2 space-y-1.5 panel-cyan">
          {/* คาดการณ์พืชที่ปลูกอยู่ */}
          {data.forecast && (
            <div className="text-[11px] text-gray-300">
              🌾 {t('farm.advisor.forecast', 'คาดการณ์ {crop}: ~{kg} กก. ({perSqm} กก./ตร.ม.)')
                .replace('{crop}', cropLabelOf(data.forecast.crop))
                .replace('{kg}', String(data.forecast.expectedKg))
                .replace('{perSqm}', String(data.forecast.perSqmKg))}
              {' '}· <span className="text-gray-500">{t(BASIS_LABEL_KEY[data.forecast.basis] ?? 'farm.advisor.basisEstimate', 'ค่าประมาณ')}</span>
            </div>
          )}

          {/* คำแนะนำอันดับ */}
          <div className="space-y-1">
            {data.recommendations?.map((rec: AdvisorRec) => (
              <div key={rec.crop} className="text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className={`font-bold ${scoreColor(rec.score)}`}>{rec.score}</span>
                  <span className="font-bold text-gray-200">{cropLabelOf(rec.crop)}</span>
                  <span className="text-gray-400">~{rec.expectedKg} {t('farm.advisor.kg', 'กก.')}</span>
                  <span className="text-gray-600">({t(BASIS_LABEL_KEY[rec.basis] ?? 'farm.advisor.basisEstimate', 'ค่าประมาณ')})</span>
                  {rec.boosted && <span title={t('farm.advisor.boostedHint', 'เคยเก็บเกี่ยวพืชนี้ในแปลงนี้จริง')}>🌱</span>}
                </div>
                {rec.reasons?.[0] && <div className="text-gray-500 pl-6">{rec.reasons[0]}</div>}
              </div>
            ))}
          </div>

          {/* ความเห็น AI (เฉพาะเมื่อ AI ตอบจริง) */}
          {data.aiText && (
            <div className="border-t border-cyan-900/60 pt-1.5 text-[11px] text-cyan-200 whitespace-pre-line">{data.aiText}</div>
          )}

          {/* แหล่งที่มา — แสดงตามจริงเสมอ */}
          <div className="text-[10px] text-gray-600 border-t border-gray-800 pt-1">
            {data.source === 'ollama'
              ? t('farm.advisor.sourceOllama', 'ที่มา: heuristic จากข้อมูลจริง + เรียบเรียงโดย AI (Ollama)')
              : withAi
                ? t('farm.advisor.sourceFallback', 'ที่มา: heuristic จากข้อมูลจริง (AI ไม่พร้อม — ตอบด้วยตัวเลขจริงทั้งหมด)')
                : t('farm.advisor.sourceHeuristic', 'ที่มา: heuristic จากค่าดินล่าสุด + ประวัติเก็บเกี่ยวจริง')}
          </div>
        </div>
      )}

      {!data && !loading && !err && (
        <div className="text-[11px] text-gray-500">{t('farm.advisor.hint', 'กดคำนวณเพื่อดูพืชที่เหมาะกับแปลงนี้ + ผลผลิตคาดการณ์ (ตอบจากข้อมูลจริงเสมอ ไม่ต้องรอ AI)')}</div>
      )}
    </div>
  );
}
