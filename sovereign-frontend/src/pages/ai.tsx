"use client";
// P2 — Decision Support AI: ถาม "ควรทำอะไรดี" + สถานการณ์จำลอง (what-if)
import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
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
  { label: '🔥 เราควรประหยัดอะไรก่อน', q: 'จากสถานการณ์ปัจจุบัน เราควรประหยัดอะไรก่อนเป็นอันดับแรก?' },
  { label: '💧 น้ำเสี่ยงไหม', q: 'น้ำจะพอใช้ไหม ควรสำรองเพิ่มไหม?' },
  { label: '⚡ แบตเตอรี่ปลอดภัยไหม', q: 'แบตเตอรี่เหลือพอใช้ต่อไปไหม ควรลดการใช้งานอะไร?' },
];

const IMPACT_STYLE: Record<string, string> = {
  critical: 'bg-red-900/40 border-red-600 text-red-300',
  warning: 'bg-amber-900/40 border-amber-600 text-amber-300',
  ok: 'bg-emerald-900/40 border-emerald-600 text-emerald-300',
  unknown: 'bg-gray-800 border-gray-600 text-gray-400',
};

const IMPACT_LABEL: Record<string, string> = {
  critical: '⚠️ วิกฤต — ต้องเตรียมตัวทันที',
  warning: '🟡 เตือน — วางแผนล่วงหน้า',
  ok: '🟢 ปลอดภัย',
  unknown: '⚪ ข้อมูลไม่พอ',
};

export default function AiPage() {
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
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
      setAdvisorError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
      setWhatIfError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
      <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex items-center justify-center">
        <div className="text-sm text-gray-500">กำลังโหลด...</div>
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
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="🧠 AI Command Center"
          subtitle="Decision Support — วิเคราะห์จากข้อมูลจริงในบ้าน" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>

        <main className="max-w-5xl mx-auto p-6 space-y-6 w-full">
          {/* ── Advisor ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">🎯 ขอคำแนะนำจากข้อมูลจริง</h2>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="ถาม เช่น: ควรเก็บเกี่ยวก่อนฝนตกไหม? / เราควรประหยัดอะไรก่อน? (Enter = ส่ง)"
              rows={3}
              className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
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
                  {qq.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => sendAdvisor()}
              disabled={advisorLoading || !question.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold"
            >
              {advisorLoading ? '🤔 AI กำลังคิด...' : '🚀 ขอคำแนะนำ'}
            </button>
            {advisorError && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3">{advisorError}</p>}

            {advice && (
              <div ref={resultRef} className="space-y-3">
                <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-800 text-emerald-200 whitespace-pre-line text-sm leading-relaxed">
                  {advice}
                </div>
              </div>
            )}
          </section>

          {/* ── What-if ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">🔄 สถานการณ์จำลอง (What-if)</h2>
            <p className="text-xs text-gray-500">จำลองผลกระทบแบบคำนวณจริงจากข้อมูลปัจจุบัน แล้วให้ AI สรุปว่า "ควรเตรียมตัวอย่างไร"</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">สถานการณ์</label>
                <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                  <option value="no_rain">🌵 ฝนไม่ตกเลย (น้ำไม่เติม)</option>
                  <option value="no_power">🔌 ไม่มีไฟชาร์จ (แบตถ่านอย่างเดียว)</option>
                  <option value="cost_increase">💸 ค่าใช้จ่ายเพิ่มขึ้น</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 block">
                  {scenario === 'cost_increase' ? 'เปอร์เซ็นต์ค่าใช้จ่ายที่เพิ่ม (%)' : 'ระยะเวลา (วัน)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={runWhatIf}
                disabled={whatIfLoading || !(days >= 1) || days > 365}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-sm font-bold md:justify-self-start"
              >
                {whatIfLoading ? '⏳ กำลังจำลอง...' : '▶️ จำลอง'}
              </button>
            </div>
            {whatIfError && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3">{whatIfError}</p>}

            {c && whatIf && (
              <div ref={whatIfRef} className="space-y-3">
                <div className={`p-3 rounded border text-sm font-bold ${IMPACT_STYLE[c.impact] || IMPACT_STYLE.unknown}`}>
                  {IMPACT_LABEL[c.impact] || '—'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500">⚡ แบตเหลือ</div>
                    <div className="text-lg font-bold text-cyan-300">
                      {c.battery.currentHoursLeft != null ? `${c.battery.currentHoursLeft.toFixed(1)} ชม.` : '—'}
                    </div>
                    {whatIf.params.scenario === 'no_power' && c.battery.hoursAfter != null && (
                      <div className="text-xs text-gray-400">หลัง {whatIf.params.days} วัน: <b className="text-red-400">{c.battery.hoursAfter.toFixed(1)} ชม.</b>{c.battery.willDie ? ' (จะหมด!)' : ''}</div>
                    )}
                  </div>
                  <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500">💧 น้ำเหลือใช้</div>
                    <div className="text-lg font-bold text-blue-300">
                      {c.water.currentDaysLeft != null ? `${c.water.currentDaysLeft.toFixed(1)} วัน` : '—'}
                    </div>
                    {whatIf.params.scenario === 'no_rain' && c.water.daysLeftAfter != null && (
                      <div className="text-xs text-gray-400">หลัง {whatIf.params.days} วัน: <b className="text-red-400">{c.water.daysLeftAfter.toFixed(1)} วัน</b>{c.water.willRunOut ? ' (จะหมด!)' : ''}</div>
                    )}
                  </div>
                  <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500">📦 เสบียง/เงิน</div>
                    <div className="text-lg font-bold text-emerald-300">
                      {c.food.daysLeft != null ? `${c.food.daysLeft.toFixed(0)} วัน` : '—'}
                    </div>
                  </div>
                  <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500">💡 ผลจำลอง</div>
                    <div className="text-sm text-gray-300 leading-tight pt-1">{c.impactNote}</div>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-cyan-900/15 border border-cyan-800 text-cyan-200 whitespace-pre-line text-sm leading-relaxed">
                  {whatIf.advice}
                </div>
              </div>
            )}
          </section>

          {/* ── Scenario Forecast — สถานการณ์ที่เป็นไปได้ (บูรณาการกับ Risk Monitor) ── */}
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">
              🌍 การคาดการณ์สถานการณ์ (Scenario Forecast)
              <a href="/risk-monitor" className="ml-2 text-xs text-blue-400 hover:underline">→ ดูที่ Risk Monitor</a>
            </h2>
            <p className="text-xs text-gray-500">
              สร้างสถานการณ์ที่เป็นไปได้จากข้อมูลอดีต (ข่าวเก่า + คำพยากรณ์ครั้งก่อน) และปัจจุบัน (ข่าวล่าสุด + Threat Index + DEFCON)
              แล้วประเมินเทียบกับสถานการณ์โลกปัจจุบัน — ออกมาเป็นข้อ ๆ พร้อมโอกาสเกิด %
            </p>
            <ScenarioForecast
              endpoint="/api/risk-monitor/scenarios"
              defaultFocus="general"
              accent="bg-purple-600 hover:bg-purple-500"
            />
          </section>

          {/* ── ข้อมูลที่ AI ใช้ ── */}
          {context && (
            <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
              <h2 className="text-lg font-bold">
                🗂️ ข้อมูลจริงที่ AI ใช้
                {context.truncated && <span className="text-xs text-gray-500 ml-2">(บางส่วนถูกตัดให้กระชับ)</span>}
                <span className="text-xs text-gray-500 ml-2">updated {new Date(context.generatedAt).toLocaleTimeString('th-TH')}</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">⚡ แบตเตอรี่</div>
                  <div className="text-lg font-bold text-cyan-300">{battery?.soc != null ? `${battery.soc}%` : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {battery?.hoursRemaining != null ? `เหลือ ~${battery.hoursRemaining.toFixed(1)} ชม. (${battery.status === 'discharging' ? 'ใช้ไฟ' : battery.status === 'charging' ? 'ชาร์จ' : 'สมดุล'})` : battery?.status === 'charging' ? 'ชาร์จอยู่' : 'ไม่มีข้อมูล'}
                  </div>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">💧 น้ำ</div>
                  <div className="text-lg font-bold text-blue-300">{water?.levelCm != null ? `${water.levelCm} ซม.` : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {water?.daysLeft != null ? `เหลือ ~${water.daysLeft.toFixed(1)} วัน` : water?.trend === 'unknown' ? 'ไม่มีข้อมูล' : 'ไม่ลด (เติมอยู่)'}
                  </div>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">🌱 แปลงฟาร์ม</div>
                  <div className="text-lg font-bold text-green-300">{farm ? `${farm.active} แปลง` : '—'}</div>
                  <div className="text-xs text-gray-400">
                    {farm
                      ? `${farm.upcomingHarvests.length ? `เก็บเกี่ยวเร็วสุด: ${farm.upcomingHarvests[0].daysLeft ?? '?'} วัน` : 'ยังไม่มีนัดเก็บเกี่ยว'}`
                      : ''}
                  </div>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">📦 เสบียง</div>
                  <div className="text-lg font-bold text-amber-300">{inv?.items ?? '—'} รายการ</div>
                  <div className="text-xs text-gray-400">
                    {inv ? `หมดอายุใกล้ ${inv.expiring + inv.expired} · ใกล้หมด ${inv.lowStock}` : ''}
                  </div>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">💰 ทรัพย์สิน</div>
                  <div className="text-lg font-bold text-emerald-300">
                    {wealth?.totalUsd != null ? `$${wealth.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {wealth?.runwayMonths != null ? `เงินอยู่ได้ ~${wealth.runwayMonths.toFixed(1)} เดือน` : wealth?.missingPrices?.length ? `ราคาหาย ${wealth.missingPrices.length} ตัว` : ''}
                  </div>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">📰 ความเสี่ยง</div>
                  <div className="text-lg font-bold text-rose-300">
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
                      <b className="text-gray-400">หมดอายุเร็ว: </b>
                      {inv!.expiringSoon.map((e) => `${e.name} (${e.daysLeft}d)`).join(', ')}
                    </div>
                  )}
                  {(farm?.upcomingHarvests?.length || 0) > 1 && (
                    <div>
                      <b className="text-gray-400">นัดเก็บเกี่ยว: </b>
                      {farm!.upcomingHarvests.map((h) => `${h.name ?? 'แปลง'}${h.crop ? ` (${h.crop})` : ''} ${h.daysLeft}d`).join(', ')}
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