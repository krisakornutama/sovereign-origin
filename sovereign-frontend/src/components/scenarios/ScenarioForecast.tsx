"use client";
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

export interface ForecastScenario {
  title: string;
  category: string;
  probability: number;
  horizonDays: number;
  reasoning: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
  mitigation: string;
}

export interface ScenarioForecastResult {
  generatedAt: string;
  focus: string;
  horizonDays: number;
  model: string;
  base: {
    threatOverall: number | null;
    categories: Record<string, number>;
    defcon: number | null;
    headlineCount: number;
  };
  scenarios: ForecastScenario[];
  summary: string | null;
  source: 'ollama' | 'fallback' | 'empty';
  offline: boolean;
}

const FOCUS_OPTIONS = [
  { value: 'general', label: 'ภาพรวมสถานการณ์' },
  { value: 'politics', label: 'การเมือง' },
  { value: 'governance', label: 'การปกครอง / นโยบาย' },
  { value: 'economy', label: 'เศรษฐกิจ / การเงิน' },
  { value: 'energy', label: 'พลังงาน' },
  { value: 'security', label: 'ความมั่นคง' },
  { value: 'climate', label: 'สภาพอากาศ' },
];

const CATEGORY_ICON: Record<string, string> = {
  politics: 'governance', governance: 'scroll', economy: 'coin', energy: 'zap',
  security: 'shield', climate: 'wind', general: 'globe', war: 'alert-triangle',
  banking: 'coin', inflation: 'trending-up',
};

const IMPACT_STYLE: Record<string, string> = {
  critical: 'text-red-300 border-red-700 bg-red-900/40',
  high: 'text-orange-300 border-orange-700 bg-orange-900/40',
  medium: 'text-amber-300 border-amber-700 bg-amber-900/40',
  low: 'text-emerald-300 border-emerald-700 bg-emerald-900/40',
};

const IMPACT_LABEL: Record<string, string> = {
  critical: 'วิกฤต', high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ',
};

function probColor(p: number): string {
  if (p >= 70) return 'bg-red-500';
  if (p >= 45) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

interface Props {
  endpoint?: string;
  defaultFocus?: string;
  title?: string;
  description?: string;
  accent?: string; // class สำหรับปุ่ม
}

export default function ScenarioForecast({
  endpoint = '/api/risk-monitor/scenarios',
  defaultFocus = 'general',
  title: titleProp,
  description: descriptionProp,
  accent = 'bg-purple-600 hover:bg-purple-500',
}: Props) {
  const [focus, setFocus] = useState(defaultFocus);
  const t = useLanguageStore((s) => s.t);
  const title = titleProp ?? t('scenarioForecast.defaultTitle', 'การคาดการณ์สถานการณ์ (Scenario Forecast)');
  const description = descriptionProp ?? t('scenarioForecast.defaultDesc', 'วิเคราะห์จากข่าวอดีต + ปัจจุบัน + Threat Index แล้วประเมินโอกาสเกิด (%) ของแต่ละสถานการณ์');
  const [horizonDays, setHorizonDays] = useState(90);
  const [result, setResult] = useState<ScenarioForecastResult | null>(null);
  const [latest, setLatest] = useState<ScenarioForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/scenarios/latest`);
      if (res.ok) setLatest(await res.json());
    } catch {
      // ไม่มีประวัติ → เงียบ
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/risk-monitor/scenarios/history?limit=6`);
      if (res.ok) setHistory(await res.json());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadLatest();
    loadHistory();
  }, [loadLatest, loadHistory]);

  const run = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus, horizonDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
      setResult(data);
      loadLatest();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scenarioForecast.analysisFailed', 'วิเคราะห์ไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  };

  const shown = result || latest;
  const cats = shown?.base?.categories || {};

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-gray-400 block">{t('scenarioForecast.focusLabel', 'หัวข้อที่ให้ความสำคัญ')}</label>
          <select
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
          >
            {FOCUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(`scenarioForecast.focus.${o.value}`, o.label)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400 block">{t('scenarioForecast.horizonLabel', 'กรอบเวลา (วัน)')}</label>
          <select
            value={horizonDays}
            onChange={(e) => setHorizonDays(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
          >
            {[7, 30, 90, 180, 365].map((h) => <option key={h} value={h}>{t('scenarioForecast.daysOption', '{n} วัน', { n: h })}</option>)}
          </select>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className={`px-4 py-2 ${accent} disabled:opacity-50 text-white rounded text-sm font-bold md:justify-self-start`}
        >
          {loading ? t('scenarioForecast.running', 'AI กำลังวิเคราะห์...') : t('scenarioForecast.runBtn', 'สร้างสถานการณ์')}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3">{error}</p>}

      {/* สรุป: ข้อมูลที่ใช้วิเคราะห์ */}
      {shown && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          <span className={`px-2 py-0.5 rounded font-bold ${shown.source === 'ollama' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/50 text-amber-300'}`}>
            {shown.source === 'ollama' ? t('scenarioForecast.sourceAi', 'วิเคราะห์โดย AI') : t('scenarioForecast.sourceFallback', 'โหมดสำรอง (AI ออฟไลน์)')}
          </span>
          <span>{t('scenarioForecast.dataInfo', 'ข้อมูล: {n} ข่าว', { n: shown.base.headlineCount })}</span>
          {shown.base.threatOverall != null && (
            <span className={shown.base.threatOverall > 75 ? 'text-red-400 font-bold' : shown.base.threatOverall > 50 ? 'text-amber-400' : 'text-emerald-400'}>
              Threat {shown.base.threatOverall}/100
            </span>
          )}
          {shown.base.defcon != null && <span>DEFCON {shown.base.defcon}</span>}
          {Object.entries(cats).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">{CATEGORY_ICON[k] ? <Icon name={CATEGORY_ICON[k]} size={12} /> : '·'} {k}: <b className="glow-text">{v}</b></span>
          ))}
          <span className="text-gray-600">· {fmtDate(shown.generatedAt)} · model {shown.model}</span>
        </div>
      )}

      {shown?.summary && (
        <div className="p-3 rounded-lg bg-gray-800/60 border border-gray-700 panel-cyan text-sm text-gray-200 leading-relaxed">
          {shown.summary}
        </div>
      )}

      {/* รายการสถานการณ์ */}
      {shown && shown.scenarios.length > 0 && (
        <div className="space-y-3">
          {shown.scenarios.map((s, i) => (
            <div key={i} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-2">
                  <span className="text-sm font-bold text-gray-500 pt-0.5">{i + 1}.</span>
                  <div>
                    <div className="font-bold text-gray-100 glow-text flex items-center gap-1.5">
                      {CATEGORY_ICON[s.category] ? <Icon name={CATEGORY_ICON[s.category]} size={13} /> : null} {s.title}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {s.category} · {t('scenarioForecast.withinDays', 'ภายใน {n} วัน', { n: s.horizonDays })}
                    </div>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${IMPACT_STYLE[s.impact] || IMPACT_STYLE.medium}`}>
                  {t('scenarioForecast.impactPrefix', 'ผลกระทบ: {impact}', { impact: t(`scenarioForecast.impact.${s.impact}`, IMPACT_LABEL[s.impact] || s.impact) })}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-700 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full ${probColor(s.probability)}`}
                    style={{ width: `${Math.min(100, s.probability)}%` }}
                  />
                </div>
                <span className={`text-xl font-bold w-16 text-right ${s.probability >= 70 ? 'text-red-400' : s.probability >= 45 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {s.probability}%
                </span>
              </div>

              {s.reasoning && <div className="text-xs text-gray-400 leading-relaxed">{t('scenarioForecast.reasonPrefix', 'เหตุผล: {reason}', { reason: s.reasoning })}</div>}
              {s.mitigation && <div className="text-xs text-cyan-300/90 leading-relaxed">{t('scenarioForecast.mitigationPrefix', 'เตรียมตัว: {mitigation}', { mitigation: s.mitigation })}</div>}
            </div>
          ))}
        </div>
      )}

      {!shown && !loading && !error && (
        <div className="text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-lg">
          {t('scenarioForecast.empty', 'ยังไม่มีการคาดการณ์ — กด "สร้างสถานการณ์" เพื่อให้ AI วิเคราะห์ข่าว + ความเสี่ยง แล้วบอกโอกาสเกิดเป็น % ต่อข้อ')}
        </div>
      )}

      {/* ผลครั้งก่อน */}
      {latest && result && (latest as any).id !== (result as any).id && (
        <div className="text-[11px] text-gray-600 pt-1 border-t border-gray-800">
          {t('scenarioForecast.previous', 'มีการคาดการณ์ครั้งก่อน {date} ({focus}, {n} วัน)', { date: fmtDate(latest.generatedAt), focus: latest.focus, n: latest.horizonDays })}
        </div>
      )}

      {/* ── ประวัติการคาดการณ์ (อดีต) ── */}
      <div className="border-t border-gray-800 pt-3">
        <button
          onClick={() => { if (!showHistory && history === null) loadHistory(); setShowHistory(!showHistory); }}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
        >
          {showHistory ? <Icon name="chevron-down" size={12} /> : <Icon name="chevron-right" size={12} />} {t('scenarioForecast.historyBtn', 'ประวัติการคาดการณ์ครั้งก่อน ({n})', { n: history?.length ?? '...' })}
        </button>
        {showHistory && (
          <div className="mt-3 space-y-3 max-h-80 overflow-y-auto pr-1">
            {history === null && <div className="text-xs text-gray-600">{t('common.loading', 'กำลังโหลด...')}</div>}
            {history !== null && history.length === 0 && (
              <div className="text-xs text-gray-600">{t('scenarioForecast.historyEmpty', 'ยังไม่มีประวัติ — สร้างการคาดการณ์ครั้งแรกเลย')}</div>
            )}
            {history?.map((h, hi) => (
              <div key={h.id || hi} className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
                  <span className="text-gray-400 font-bold">
                    {t('scenarioForecast.historyItem', '{focus} · {n} วัน · {date}', { focus: h.focus, n: h.horizonDays, date: fmtDate(h.generatedAt) })}
                  </span>
                  <span className="text-gray-600">model {h.model}</span>
                </div>
                {h.summary && <div className="text-xs text-gray-300 mt-1 line-clamp-2">{h.summary}</div>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(h.scenarios || []).slice(0, 5).map((s: any, si: number) => (
                    <span key={si} className={`text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1 ${s.probability >= 70 ? 'bg-red-900/40 text-red-300' : s.probability >= 45 ? 'bg-amber-900/40 text-amber-300' : 'bg-emerald-900/40 text-emerald-300'}`}>
                      {CATEGORY_ICON[s.category] ? <Icon name={CATEGORY_ICON[s.category]} size={10} /> : null} {s.probability}% {s.title}
                    </span>
                  ))}
                  {(!h.scenarios || h.scenarios.length === 0) && <span className="text-[10px] text-gray-600">{t('scenarioForecast.noItems', '(ไม่มีรายการ)')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
