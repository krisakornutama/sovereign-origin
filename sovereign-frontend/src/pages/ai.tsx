"use client";
// P2 — Decision Support AI: ถาม "ควรทำอะไรดี" + สถานการณ์จำลอง (what-if)
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import ScenarioForecast from '../components/scenarios/ScenarioForecast';

interface SituationContext {
  generatedAt: string;
  battery: { soc: number | null; avgPowerKw: number | null; hoursRemaining: number | null; status: string };
  water: { levelCm: number | null; rateCmPerHour: number | null; daysLeft: number | null; trend: string };
  farm: {
    plots: number; active: number; growing: number; harvested: number; fallow: number;
    activeAreaSqm: number | null;
    upcomingHarvests: Array<{ name: string | null; crop: string | null; daysLeft: number | null }>;
  };
  inventory: {
    items: number; waterQty: number; foodQty: number; expiring: number; expired: number; lowStock: number;
    expiringSoon: Array<{ name: string; category: string; daysLeft: number | null }>;
  };
  wealth: {
    totalUsd: number | null; portfolioUsd: number | null; inventoryUsd: number | null;
    runwayMonths: number | null; monthlyBurnUsd: number | null; missingPrices: string[];
  };
  risk: { threatOverall: number | null; threatSummary: string | null; defcon: number | null };
  truncated: boolean;
}

interface WhatIfComputed {
  scenario: string; days: number;
  battery: { currentHoursLeft: number | null; hoursAfter: number | null; willDie: boolean | null };
  water: { currentDaysLeft: number | null; levelAfterCm: number | null; daysLeftAfter: number | null; willRunOut: boolean | null };
  food: { daysLeft: number | null };
  impact: 'critical' | 'warning' | 'ok' | 'unknown';
  impactNote: string;
}

const QUICK_QUESTIONS = [
  { key: 'saveFirst', label: 'เราควรประหยัดอะไรก่อน', q: 'จากสถานการณ์ปัจจุบัน เราควรประหยัดอะไรก่อนเป็นอันดับแรก?' },
  { key: 'waterRisk', label: 'น้ำเสี่ยงไหม', q: 'น้ำจะพอใช้ไหม ควรสำรองเพิ่มไหม?' },
  { key: 'batterySafe', label: 'แบตเตอรี่ปลอดภัยไหม', q: 'แบตเตอรี่เหลือพอใช้ต่อไปไหม ควรลดการใช้งานอะไร?' },
];

const IMPACT_STYLE: Record<string, string> = {
  critical: 'bg-rose-900/40 border-rose-600 text-rose-300',
  warning: 'bg-amber-900/40 border-amber-600 text-amber-300',
  ok: 'bg-emerald-900/40 border-emerald-600 text-emerald-300',
  unknown: 'bg-gray-800 border-gray-600 text-gray-400',
};

const IMPACT_LABEL: Record<string, string> = {
  critical: 'วิกฤต — ต้องเตรียมตัวทันที',
  warning: 'เตือน — วางแผนล่วงหน้า',
  ok: 'ปลอดภัย',
  unknown: 'ข้อมูลไม่พอ',
};

export default function AiPage() {
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [question, setQuestion] = useState('');
  const [advice, setAdvice] = useState<string | null>(null);
  const [context, setContext] = useState<SituationContext | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);

  const [scenario, setScenario] = useState('no_rain');
  const [days, setDays] = useState(14);
  const [whatIf, setWhatIf] = useState<{ params: { scenario: string; days: number }; computed: WhatIfComputed; advice: string } | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);
  const whatIfRef = useRef<HTMLDivElement>(null);

  const sendAdvisor = async (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || advisorLoading) return;
    setAdvisorLoading(true);
    setAdvisorError(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/advisor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `API error ${res.status}`);
      }
      const data = await res.json();
      setAdvice(data.advice);
      setContext(data.context);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (err) {
      setAdvisorError(err instanceof Error ? err.message : t('ai.errorGeneric', 'เกิดข้อผิดพลาด'));
    } finally {
      setAdvisorLoading(false);
    }
  };

  const runWhatIf = async () => {
    if (whatIfLoading) return;
    setWhatIfLoading(true);
    setWhatIfError(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/advisor/what-if`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, days: Number(days) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `API error ${res.status}`);
      }
      const data = await res.json();
      setWhatIf({ params: data.params, computed: data.computed, advice: data.advice });
      setContext(data.context);
      setTimeout(() => whatIfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (err) {
      setWhatIfError(err instanceof Error ? err.message : t('ai.errorGeneric', 'เกิดข้อผิดพลาด'));
    } finally {
      setWhatIfLoading(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target instanceof HTMLTextAreaElement && !e.shiftKey) {
        e.preventDefault();
        sendAdvisor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isHydrated || !isAuthenticated || !token) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  const battery = context?.battery;
  const water = context?.water;
  const farm = context?.farm;
  const inv = context?.inventory;
  const wealth = context?.wealth;
  const risk = context?.risk;
  const c = whatIf?.computed;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={t('ai.eyebrow', 'ความปลอดภัย')}
          title="AI Command Center" icon={<Icon name="ai" size={18} />}
          subtitle={t('ai.subtitle', 'Decision Support — วิเคราะห์จากข้อมูลจริงในบ้าน')} actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('ai.backDashboard', '← กลับ Dashboard')}</Link>}
        />

        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">
          {/* ── Advisor ── */}
          <section className="card panel-glow p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('ai.advisorTitle', 'ขอคำแนะนำจากข้อมูลจริง')}</h2>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('ai.advisorPlaceholder', 'ถาม เช่น: ควรเก็บเกี่ยวก่อนฝนตกไหม? / เราควรประหยัดอะไรก่อน? (Enter = ส่ง)')}
              rows={3}
              className="input w-full resize-none"
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((qq) => (
                <button
                  key={qq.label}
                  onClick={() => {
                    setQuestion(qq.q);
                    sendAdvisor(qq.q);
                  }}
                  disabled={advisorLoading}
                  className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-full transition disabled:opacity-50"
                >
                  {t('ai.quick.' + qq.key, qq.label)}
                </button>
              ))}
            </div>
            <button
              onClick={() => sendAdvisor()}
              disabled={advisorLoading || !question.trim()}
              className="btn-primary"
            >
              {advisorLoading ? t('ai.thinking', 'AI กำลังคิด...') : t('ai.askAdvice', 'ขอคำแนะนำ')}
            </button>
            {advisorError && <p className="card p-3 text-sm text-rose-400">{advisorError}</p>}

            {advice && (
              <div ref={resultRef} className="space-y-3">
                <div className="card panel-glow p-4 whitespace-pre-line text-sm leading-relaxed text-emerald-200">
                  {advice}
                </div>
              </div>
            )}
          </section>

          {/* ── What-if ── */}
          <section className="card panel-glow p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('ai.whatIfTitle', 'สถานการณ์จำลอง (What-if)')}</h2>
            <p className="text-xs text-gray-500">{t('ai.whatIfDesc', 'จำลองผลกระทบแบบคำนวณจริงจากข้อมูลปัจจุบัน แล้วให้ AI สรุปว่า "ควรเตรียมตัวอย่างไร"')}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">{t('ai.scenarioLabel', 'สถานการณ์')}</label>
                <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="input w-full">
                  <option value="no_rain">{t('ai.scenarioNoRain', 'ฝนไม่ตกเลย (น้ำไม่เติม)')}</option>
                  <option value="no_power">{t('ai.scenarioNoPower', 'ไม่มีไฟชาร์จ (แบตถ่านอย่างเดียว)')}</option>
                  <option value="cost_increase">{t('ai.scenarioCostIncrease', 'ค่าใช้จ่ายเพิ่มขึ้น')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">
                  {scenario === 'cost_increase' ? t('ai.costPercentLabel', 'เปอร์เซ็นต์ค่าใช้จ่ายที่เพิ่ม (%)') : t('ai.durationLabel', 'ระยะเวลา (วัน)')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="input w-full"
                />
              </div>
              <button
                onClick={runWhatIf}
                disabled={whatIfLoading || !(days >= 1) || days > 365}
                className="btn-primary md:justify-self-start"
              >
                {whatIfLoading ? t('ai.simulating', 'กำลังจำลอง...') : t('ai.simulate', 'จำลอง')}
              </button>
            </div>
            {whatIfError && <p className="card p-3 text-sm text-rose-400">{whatIfError}</p>}

            {c && whatIf && (
              <div ref={whatIfRef} className="space-y-3">
                <div className={`p-3 rounded border text-sm font-bold ${IMPACT_STYLE[c.impact] || IMPACT_STYLE.unknown}`}>
                  {t('ai.impact.' + c.impact, IMPACT_LABEL[c.impact] || '—')}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="inset px-3 py-2">
                    <div className="text-xs text-gray-500">{t('ai.batteryLeft', 'แบตเหลือ')}</div>
                    <div className="text-lg font-bold text-cyan-300 glow-text-cyan">
                      {c.battery.currentHoursLeft != null ? t('ai.hoursShort', '{n} ชม.', { n: c.battery.currentHoursLeft.toFixed(1) }) : '—'}
                    </div>
                    {whatIf.params.scenario === 'no_power' && c.battery.hoursAfter != null && (
                      <div className="text-xs text-gray-400">{t('ai.afterDays', 'หลัง {n} วัน: ', { n: whatIf.params.days })}<b className="text-red-400">{t('ai.hoursShort', '{n} ชม.', { n: c.battery.hoursAfter.toFixed(1) })}</b>{c.battery.willDie ? t('ai.willRunOut', ' (จะหมด!)') : ''}</div>
                    )}
                  </div>
                  <div className="inset px-3 py-2">
                    <div className="text-xs text-gray-500">{t('ai.waterLeft', 'น้ำเหลือใช้')}</div>
                    <div className="text-lg font-bold text-blue-300 glow-text-cyan">
                      {c.water.currentDaysLeft != null ? t('ai.daysShort', '{n} วัน', { n: c.water.currentDaysLeft.toFixed(1) }) : '—'}
                    </div>
                    {whatIf.params.scenario === 'no_rain' && c.water.daysLeftAfter != null && (
                      <div className="text-xs text-gray-400">{t('ai.afterDays', 'หลัง {n} วัน: ', { n: whatIf.params.days })}<b className="text-red-400">{t('ai.daysShort', '{n} วัน', { n: c.water.daysLeftAfter.toFixed(1) })}</b>{c.water.willRunOut ? t('ai.willRunOut', ' (จะหมด!)') : ''}</div>
                    )}
                  </div>
                  <div className="inset px-3 py-2">
                    <div className="text-xs text-gray-500">{t('ai.suppliesMoney', 'เสบียง/เงิน')}</div>
                    <div className="text-lg font-bold text-emerald-300 glow-text">
                      {c.food.daysLeft != null ? t('ai.daysShort', '{n} วัน', { n: c.food.daysLeft.toFixed(0) }) : '—'}
                    </div>
                  </div>
                  <div className="inset px-3 py-2">
                    <div className="text-xs text-gray-500">{t('ai.impactResult', 'ผลจำลอง')}</div>
                    <div className="text-sm text-gray-300 leading-tight pt-1">{c.impactNote}</div>
                  </div>
                </div>
                <div className="card panel-glow p-4 whitespace-pre-line text-sm leading-relaxed text-cyan-200">
                  {whatIf.advice}
                </div>
              </div>
            )}
          </section>

          {/* ── Scenario Forecast — สถานการณ์ที่เป็นไปได้ (บูรณาการกับ Risk Monitor) ── */}
          <section className="card panel-cyan p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
              {t('ai.forecastTitle', 'การคาดการณ์สถานการณ์ (Scenario Forecast)')}
              <Link href="/risk-monitor" scroll={false} className="ml-2 text-xs text-sky-400 hover:underline">{t('ai.viewRiskMonitor', '→ ดูที่ Risk Monitor')}</Link>
            </h2>
            <p className="text-xs text-gray-500">
              {t('ai.forecastDesc', 'สร้างสถานการณ์ที่เป็นไปได้จากข้อมูลอดีต (ข่าวเก่า + คำพยากรณ์ครั้งก่อน) และปัจจุบัน (ข่าวล่าสุด + Threat Index + DEFCON) แล้วประเมินเทียบกับสถานการณ์โลกปัจจุบัน — ออกมาเป็นข้อ ๆ พร้อมโอกาสเกิด %')}
            </p>
            <ScenarioForecast
              endpoint="/api/risk-monitor/scenarios"
              defaultFocus="general"
              accent="bg-purple-600 hover:bg-purple-500"
            />
          </section>

          {/* ── ข้อมูลที่ AI ใช้ ── */}
          {context && (
            <section className="card panel-cyan p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
                {t('ai.contextTitle', 'ข้อมูลจริงที่ AI ใช้')}
                {context.truncated && <span className="text-xs text-gray-500 ml-2">{t('ai.truncatedNote', '(บางส่วนถูกตัดให้กระชับ)')}</span>}
                <span className="text-xs text-gray-500 ml-2">{t('ai.updatedAt', 'updated {time}', { time: new Date(context.generatedAt).toLocaleTimeString(fmtLocale()) })}</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.battery', 'แบตเตอรี่')}</div>
                  <div className="text-lg font-bold text-cyan-300 glow-text-cyan">{battery?.soc != null ? `${battery.soc}%` : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {battery?.hoursRemaining != null ? t('ai.batteryRemaining', 'เหลือ ~{h} ชม. ({status})', { h: battery.hoursRemaining.toFixed(1), status: battery.status === 'discharging' ? t('ai.statusDischarging', 'ใช้ไฟ') : battery.status === 'charging' ? t('ai.statusCharging', 'ชาร์จ') : t('ai.statusBalanced', 'สมดุล') }) : battery?.status === 'charging' ? t('ai.chargingNow', 'ชาร์จอยู่') : t('common.noData', 'ไม่มีข้อมูล')}
                  </div>
                </div>
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.water', 'น้ำ')}</div>
                  <div className="text-lg font-bold text-blue-300 glow-text-cyan">{water?.levelCm != null ? t('ai.cmShort', '{n} ซม.', { n: water.levelCm }) : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {water?.daysLeft != null ? t('ai.waterRemaining', 'เหลือ ~{n} วัน', { n: water.daysLeft.toFixed(1) }) : water?.trend === 'unknown' ? t('common.noData', 'ไม่มีข้อมูล') : t('ai.waterFilling', 'ไม่ลด (เติมอยู่)')}
                  </div>
                </div>
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.farm', 'แปลงฟาร์ม')}</div>
                  <div className="text-lg font-bold text-emerald-300 glow-text">{farm ? t('ai.plotCount', '{n} แปลง', { n: farm.active }) : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {farm
                      ? farm.upcomingHarvests.length ? t('ai.earliestHarvest', 'เก็บเกี่ยวเร็วสุด: {n} วัน', { n: farm.upcomingHarvests[0].daysLeft ?? '?' }) : t('ai.noHarvest', 'ยังไม่มีนัดเก็บเกี่ยว')
                      : ''}
                  </div>
                </div>
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.supplies', 'เสบียง')}</div>
                  <div className="text-lg font-bold text-amber-300 glow-text">{t('common.items', '{n} รายการ', { n: inv?.items ?? '—' })}</div>
                  <div className="text-xs text-gray-400">
                    {inv ? t('ai.expiringNear', 'หมดอายุใกล้ {n1} · ใกล้หมด {n2}', { n1: inv.expiring + inv.expired, n2: inv.lowStock }) : ''}
                  </div>
                </div>
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.wealth', 'ทรัพย์สิน')}</div>
                  <div className="text-lg font-bold text-emerald-300 glow-text">
                    {wealth?.totalUsd != null ? `$${wealth.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {wealth?.runwayMonths != null ? t('ai.runwayMonths', 'เงินอยู่ได้ ~{n} เดือน', { n: wealth.runwayMonths.toFixed(1) }) : wealth?.missingPrices?.length ? t('ai.missingPrices', 'ราคาหาย {n} ตัว', { n: wealth.missingPrices.length }) : ''}
                  </div>
                </div>
                <div className="inset px-3 py-2">
                  <div className="text-xs text-gray-500">{t('ai.risk', 'ความเสี่ยง')}</div>
                  <div className="text-lg font-bold text-rose-300 glow-text-red">
                    {risk?.threatOverall != null ? `${risk.threatOverall.toFixed(0)}/100` : '—'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {risk?.defcon != null ? `DEFCON ${risk.defcon}` : ''}
                  </div>
                </div>
              </div>
              {(farm?.upcomingHarvests?.length || 0) > 1 || (inv?.expiringSoon?.length || 0) > 0 ? (
                <div className="text-xs text-gray-500 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(inv?.expiringSoon?.length || 0) > 0 && (
                    <div>
                      <b className="text-gray-400">{t('ai.expiringSoon', 'หมดอายุเร็ว: ')}</b>
                      {inv!.expiringSoon.map((e) => `${e.name} (${e.daysLeft}d)`).join(', ')}
                    </div>
                  )}
                  {(farm?.upcomingHarvests?.length || 0) > 1 && (
                    <div>
                      <b className="text-gray-400">{t('ai.harvestSchedule', 'นัดเก็บเกี่ยว: ')}</b>
                      {farm!.upcomingHarvests.map((h) => `${h.name ?? t('ai.plotFallback', 'แปลง')}${h.crop ? ` (${h.crop})` : ''} ${h.daysLeft}d`).join(', ')}
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}