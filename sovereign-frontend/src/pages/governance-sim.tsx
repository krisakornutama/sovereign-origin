"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';

// ── GOVERNANCE SIMULATION — WAR ROOM ──
// ระบบจำลองการปกครอง + เสถียรภาพสังคม ระดับบุคคล (หลายพันคน) ตามพิมพ์เขียว 8 โมดูล
// "อำนาจที่แท้จริงไม่ได้วัดที่ขนาดกองทัพ แต่ทดสอบที่ความสามารถในการบริหารความขัดแย้ง"

type Status = 'stable' | 'unstable' | 'civil_war' | 'collapsed' | 'integrated';
type Cls = 'ruling' | 'economic' | 'middle' | 'working' | 'marginalized';
type Strategy = 'direct' | 'indirect' | 'economic';

interface View {
  id: string; name: string; seed: number; tick: number; year: number; month: number;
  status: Status; population: number; treasury: number; gdpIndex: number; inflation: number;
  gini: number; scarcity: number; asabiyyah: number;
  legitimacy: { performance: number; ideology: number; procedural: number; total: number };
  stateReach: number; corruption: number; judicialFairness: number; coerciveForce: number;
  suppressionRecord: number; unrestRisk: number; rebellionProbability: number; insurgencyStrength: number;
  mediaControl: number; propagandaGap: number; epistemicCollapse: boolean; counterNarrative: number;
  foreignProxy: number; sanctions: number; sanctuary: number; externalThreat: number;
  friction: number; collaboratorRatio: number; pacification: number; resistance: number;
  assimilationStrategy: Strategy;
  levers: {
    taxRate: number; mediaControl: number; policePatrols: number; surveillance: number;
    minorityRights: number; powerSharing: number; culturalEducation: number; subsidy: number;
    foreignAppeasement: number; coercion: number; buyOffElites: boolean; purge: boolean;
    budget: { military: number; bureaucracy: number; welfare: number; infrastructure: number; patronage: number };
    assimilationStrategy: Strategy;
  };
  factions: Array<{ cls: Cls; label: string; count: number; satisfaction: number; radicalization: number; mobilization: number; identityAlignment: number }>;
  territories: Array<{ id: string; label: string; population: number; tension: number; satisfaction: number; insurgency: number }>;
  persons: { count: number; insurgents: number; sample: Array<{ name: string; cls: Cls; identity: string; territory: string; satisfaction: number; radicalization: number; mobilization: number; insurgency: boolean }> };
  events: Array<{ tick: number; year: number; month: number; kind: string; severity: string; text: string }>;
  history: Array<{ tick: number; legitimacyTotal: number; asabiyyah: number; unrestRisk: number; pacification: number; resistance: number; treasury: number }>;
  narratives: Array<{ kind: string; title: string; text: string; source: string; at: number }>;
}

const API = process.env.NEXT_PUBLIC_API_URL || '';

const STATUS_LABEL: Record<Status, { label: string; cls: string; icon: string }> = {
  stable: { label: 'STABLE — ทรงตัว', cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700', icon: '' },
  unstable: { label: 'UNSTABLE — สั่นคลอน', cls: 'bg-amber-900/50 text-amber-300 border-amber-700', icon: 'alert-triangle' },
  civil_war: { label: 'CIVIL WAR — สงครามกลางเมือง', cls: 'bg-red-900/50 text-red-300 border-red-700', icon: '' },
  collapsed: { label: 'COLLAPSED — ล่มสลาย', cls: 'bg-gray-900 text-gray-400 border-gray-700', icon: '' },
  integrated: { label: 'INTEGRATED — กลืนกลายสำเร็จ', cls: 'bg-blue-900/50 text-blue-300 border-blue-700', icon: '' },
};

const CLS_COLOR: Record<Cls, string> = {
  ruling: 'text-amber-300', economic: 'text-yellow-300', middle: 'text-blue-300', working: 'text-emerald-300', marginalized: 'text-red-300',
};
const CLS_BAR: Record<Cls, string> = {
  ruling: 'bg-amber-500', economic: 'bg-yellow-500', middle: 'bg-blue-500', working: 'bg-emerald-500', marginalized: 'bg-red-500',
};

function bar(value: number, max = 100, color = 'bg-emerald-500'): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="flex items-center gap-2"><div class="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden"><div class="h-full ${color} rounded-full" style="width:${pct}%"></div></div><span class="text-xs w-10 text-right">${Math.round(value)}</span></div>`;
}

export default function GovernanceSimPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string; tick: number; status: Status; population: number }>>([]);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  // form
  const [newName, setNewName] = useState('');
  const [newPop, setNewPop] = useState(3000);
  const [newSeed, setNewSeed] = useState('');
  // levers draft
  const [levers, setLevers] = useState<View['levers'] | null>(null);
  const [narrBusy, setNarrBusy] = useState<string | null>(null);

  const loadScenarios = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios`);
      if (res.ok) setScenarios(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadView = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios/${id}`);
      if (!res.ok) { setMsg({ type: 'error', text: t('governanceSim.loadFailed', 'โหลด Scenario ไม่สำเร็จ') }); return; }
      const data: View = await res.json();
      setView(data);
      setLevers(data.levers);
    } catch { setMsg({ type: 'error', text: t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้') }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  const createScenario = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName || undefined, population: newPop, seed: newSeed ? Number(newSeed) : undefined }),
      });
      if (!res.ok) { setMsg({ type: 'error', text: t('governanceSim.createFailed', 'สร้างไม่สำเร็จ') }); return; }
      const data: View = await res.json();
      setView(data); setLevers(data.levers);
      setNewName(''); setNewSeed('');
      setMsg({ type: 'success', text: t('governanceSim.created', 'สร้าง "{name}" ประชากร {pop} คน', { name: data.name, pop: data.population }) });
      loadScenarios();
    } catch { setMsg({ type: 'error', text: t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้') }); }
    finally { setBusy(false); }
  };

  const runTick = async (steps: number) => {
    if (!view) return;
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios/${view.id}/tick`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps }),
      });
      if (!res.ok) { setMsg({ type: 'error', text: t('governanceSim.tickFailed', 'เดินเวลาไม่สำเร็จ') }); return; }
      const data = await res.json();
      setView(data.view);
      setMsg({ type: 'info', text: t('governanceSim.ticked', 'เดินเวลา {months} เดือน → tick {tick}', { months: steps, tick: data.view.tick }) });
      loadScenarios();
    } catch { setMsg({ type: 'error', text: t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้') }); }
    finally { setBusy(false); }
  };

  const saveLevers = async (partial?: Partial<View['levers']>) => {
    if (!view) return;
    const next = partial ? { ...levers!, ...partial } : levers!;
    setLevers(next);
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios/${view.id}/levers`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
      if (!res.ok) { setMsg({ type: 'error', text: t('governanceSim.leversFailed', 'ตั้ง Levers ไม่สำเร็จ') }); return; }
      const data: View = await res.json();
      setView(data);
      setMsg({ type: 'success', text: t('governanceSim.leversUpdated', 'Levers อัปเดตแล้ว (กดเดินเวลาเพื่อให้มีผล)') });
    } catch { setMsg({ type: 'error', text: t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้') }); }
    finally { setBusy(false); }
  };

  const genNarrative = async (kind: string) => {
    if (!view) return;
    setNarrBusy(kind);
    try {
      const res = await authFetch(`${API}/api/govsim/scenarios/${view.id}/narrative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }),
      });
      if (!res.ok) { setMsg({ type: 'error', text: t('governanceSim.narrativeFailed', 'สร้างข่าวจำลองไม่สำเร็จ') }); return; }
      const narr = await res.json();
      setMsg({ type: 'success', text: t('governanceSim.narrativeCreated', '📰 "{title}" ({source})', { title: narr.title, source: narr.source === 'ollama' ? 'Ollama' : 'template' }) });
      loadView(view.id);
    } catch { setMsg({ type: 'error', text: t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้') }); }
    finally { setNarrBusy(null); }
  };

  const delScenario = async (id: string) => {
    await authFetch(`${API}/api/govsim/scenarios/${id}`, { method: 'DELETE' });
    if (view?.id === id) setView(null);
    loadScenarios();
  };

  const gauge = (label: string, value: number, color: string, unit = '') => (
    <div className="card panel-cyan p-3">
      <div className="text-[11px] text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-100 glow-text">{Math.round(value)}{unit}</div>
      <div className="w-full bg-gray-800 h-2 rounded-full mt-1 overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );

  if (!isHydrated) return <div className="min-h-screen bg-gray-950" />;
  if (!isAuthenticated) return <div className="min-h-screen bg-gray-950" />;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <main className="flex-1 p-6 overflow-y-auto">
        <PageHeader
          eyebrow={t('governanceSim.eyebrow', 'Governance Simulation — War Room')}
          title={t('governanceSim.title', 'ระบบจำลองการปกครองและเสถียรภาพสังคม')} icon={<Icon name="governance" size={18} />}
          subtitle={t('governanceSim.subtitle', 'จำลองระดับบุคคลหลายพันคน ตามทฤษฎี Legitimacy · Asabiyyah · Inclusive Institutions — เรื่องจริง: อำนาจไม่ได้วัดที่กองทัพ แต่ที่ความสามารถบริหารความขัดแย้ง')}
        />

        {msg && (
          <div className={`mb-4 inset px-4 py-2 text-sm ${
            msg.type === 'success' ? 'text-emerald-400'
            : msg.type === 'error' ? 'text-red-400'
            : 'text-sky-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Scenario selector + create */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 card panel-cyan p-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan mb-2">{t('governanceSim.existingScenarios', 'Scenario ที่มีอยู่')}</h2>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {scenarios.length === 0 && <span className="text-xs text-gray-500">{t('governanceSim.noScenarios', 'ยังไม่มี — สร้างใหม่ด้านล่าง (เริ่มจาก "เพิ่งยึดเมืองเสร็จ")')}</span>}
              {scenarios.map((s) => (
                <button key={s.id} onClick={() => loadView(s.id)}
                  className={`px-3 py-1.5 rounded-lg border text-xs text-left ${view?.id === s.id ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'}`}>
                  <div className="font-bold">{s.name}</div>
                  <div className="text-[10px] opacity-70">{STATUS_LABEL[s.status].icon ? <Icon name={STATUS_LABEL[s.status].icon} size={10} /> : null} {s.status} · tick {s.tick} · {s.population} {t('governanceSim.people', 'คน')}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="card panel-glow p-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text mb-2">{t('governanceSim.createTitle', 'สร้างอาณาจักรจำลอง')}</h2>
            <div className="space-y-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('governanceSim.kingdomPlaceholder', 'ชื่ออาณาจักร (ว่าง = สุ่ม)')}
                className="input w-full" />
              <div className="flex gap-2">
                <input type="number" value={newPop} onChange={(e) => setNewPop(Number(e.target.value))} min={100} max={20000} title={t('governanceSim.populationTitle', 'ประชากร')}
                  className="input w-1/2" />
                <input value={newSeed} onChange={(e) => setNewSeed(e.target.value)} placeholder={t('governanceSim.seedPlaceholder', 'Seed (ว่าง=สุ่ม)')}
                  className="input w-1/2" />
              </div>
              <button onClick={createScenario} disabled={busy} className="btn-primary w-full">
                {busy ? t('governanceSim.creating', 'กำลังสร้าง...') : t('governanceSim.captureCity', 'ยึดเมืองใหม่ (สร้าง Scenario)')}
              </button>
            </div>
          </div>
        </div>

        {view && levers && (
          <>
            {/* Status banner */}
            <div className={`mb-4 px-4 py-3 rounded-xl border text-sm font-bold ${STATUS_LABEL[view.status].cls}`}>
              {STATUS_LABEL[view.status].icon ? <Icon name={STATUS_LABEL[view.status].icon} size={14} /> : null} {t('governanceSim.stateStatus', 'สถานะรัฐ: {label}', { label: t(`governanceSim.status.${view.status}`, STATUS_LABEL[view.status].label) })}
              <span className="ml-3 font-normal text-xs opacity-80">{t('governanceSim.bannerMeta', 'ปี {y} เดือน {m} · tick {tick} · คลัง {treasury} · GDP {gdp}', { y: view.year, m: view.month, tick: view.tick, treasury: Math.round(view.treasury), gdp: Math.round(view.gdpIndex) })}</span>
              {view.epistemicCollapse && <span className="ml-3 font-normal text-xs bg-red-900/50 px-2 py-0.5 rounded">{t('governanceSim.epistemicCollapse', 'Epistemic Collapse')}</span>}
            </div>

            {/* Gauges */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {gauge(t('governanceSim.legitimacyGauge', 'ความชอบธรรม (Legitimacy)'), view.legitimacy.total, 'bg-emerald-500', '/100')}
              {gauge(t('governanceSim.asabiyyahGauge', 'ความยึดโยง (Asabiyyah)'), view.asabiyyah, 'bg-blue-500', '/100')}
              {gauge(t('governanceSim.unrestGauge', 'ความเสี่ยงไม่สงบ (Unrest)'), view.unrestRisk, view.unrestRisk > 55 ? 'bg-red-500' : 'bg-amber-500', '/100')}
              {gauge(t('governanceSim.stateReachGauge', 'ศักยภาพรัฐ (State Reach)'), view.stateReach, 'bg-violet-500', '/100')}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Faction satisfaction */}
              <div className="card panel-cyan p-4">
                <h3 className="text-sm font-semibold glow-text-cyan mb-3">{t('governanceSim.factionSatisfaction', 'ความพึงพอใจรายชนชั้น')}</h3>
                <div className="space-y-2">
                  {view.factions.map((f) => (
                    <div key={f.cls}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className={CLS_COLOR[f.cls]}>{f.label} ({f.count})</span>
                        <span className="text-gray-400">Rad {f.radicalization} · Mob {f.mobilization}</span>
                      </div>
                      <div dangerouslySetInnerHTML={{ __html: bar(f.satisfaction, 100, CLS_BAR[f.cls]) }} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[11px] text-gray-500">
                  {t('governanceSim.samplePersons', 'รายบุคคลตัวอย่าง:')}
                  <span className="ml-1 text-gray-400">{view.persons.sample.slice(0, 6).map((p) => `${p.name}(${Math.round(p.satisfaction)})`).join(', ')}</span>
                  {view.persons.insurgents > 0 && <span className="ml-2 text-red-400">{t('governanceSim.insurgents', '· กบฏ {n} คน ({pct}%)', { n: view.persons.insurgents, pct: Math.round(view.insurgencyStrength * 100) })}</span>}
                </div>
              </div>

              {/* Territory map */}
              <div className="card panel-cyan p-4">
                <h3 className="text-sm font-semibold glow-text-cyan mb-3">{t('governanceSim.territories', 'ดินแดน & ความตึงเครียด')}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {view.territories.map((terr) => (
                    <div key={terr.id} className={`rounded-lg border p-2 ${terr.tension >= 60 ? 'border-red-700 bg-red-950/30' : terr.tension >= 35 ? 'border-amber-700 bg-amber-950/20' : 'border-emerald-700 bg-emerald-950/20'}`}>
                      <div className="text-xs font-bold">{terr.label}</div>
                      <div className="text-[10px] text-gray-400">{terr.population} {t('governanceSim.people', 'คน')}</div>
                      <div className="text-lg font-bold text-gray-100 glow-text-red">{t('governanceSim.tension', 'ตึง {n}', { n: terr.tension })}</div>
                      <div className="text-[10px] text-gray-400">{t('governanceSim.territoryMeta', 'พอใจ {s} · กบฏ {i}%', { s: terr.satisfaction, i: terr.insurgency })}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[11px] text-gray-400">
                  {t('governanceSim.assimilation', 'การกลืนกลาย: Friction {f} · Resistance {r} · Pacification {p} · Collaborator {c}%', { f: Math.round(view.friction), r: Math.round(view.resistance), p: Math.round(view.pacification), c: Math.round(view.collaboratorRatio * 100) })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              {/* History chart */}
              <div className="lg:col-span-2 card panel-cyan p-4">
                <h3 className="text-sm font-semibold glow-text-cyan mb-2">{t('governanceSim.historyTitle', 'ประวัติ (Legitimacy / Asabiyyah / Unrest)')}</h3>
                {view.history.length > 1 ? (
                  <svg viewBox="0 0 600 160" className="w-full h-40">
                    {[
                      { key: 'legitimacyTotal', color: '#10b981' },
                      { key: 'asabiyyah', color: '#3b82f6' },
                      { key: 'unrestRisk', color: '#f59e0b' },
                    ].map((s) => {
                      const pts = view.history.map((h, i) => {
                        const x = (i / Math.max(1, view.history.length - 1)) * 600;
                        const y = 150 - (h[s.key as keyof typeof h] as number / 100) * 140;
                        return `${x},${y}`;
                      });
                      return <polyline key={s.key} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" />;
                    })}
                    <line x1="0" y1="150" x2="600" y2="150" stroke="#374151" strokeWidth="1" />
                  </svg>
                ) : <div className="text-xs text-gray-500">{t('governanceSim.runFirst', 'เดินเวลาไปก่อนเพื่อดูกราฟ')}</div>}
                <div className="flex gap-4 text-[11px] text-gray-400 mt-1">
                  <span><span className="inline-block w-3 h-1 bg-emerald-500 mr-1" />Legitimacy</span>
                  <span><span className="inline-block w-3 h-1 bg-blue-500 mr-1" />Asabiyyah</span>
                  <span><span className="inline-block w-3 h-1 bg-amber-500 mr-1" />Unrest</span>
                </div>
              </div>

              {/* Levers */}
              <div className="card panel-glow p-4">
                <h3 className="text-sm font-semibold glow-text mb-2">{t('governanceSim.leversTitle', 'Levers — เครื่องมือผู้ปกครอง')}</h3>
                <div className="space-y-2 text-xs">
                  <LeverSlider label={t('governanceSim.tax', 'ภาษี (%)')} value={levers.taxRate} max={50} onChange={(v) => saveLevers({ taxRate: v })} />
                  <LeverSlider label={t('governanceSim.patrol', 'ความมั่นคง (Patrol)')} value={levers.policePatrols} max={100} onChange={(v) => saveLevers({ policePatrols: v })} />
                  <LeverSlider label={t('governanceSim.surveillance', 'เฝ้าระวัง (Surveillance)')} value={levers.surveillance} max={100} onChange={(v) => saveLevers({ surveillance: v })} />
                  <LeverSlider label={t('governanceSim.media', 'ควบคุมสื่อ (Media)')} value={levers.mediaControl} max={100} onChange={(v) => saveLevers({ mediaControl: v })} />
                  <LeverSlider label={t('governanceSim.minority', 'สิทธิชนกลุ่มน้อย (Minority)')} value={levers.minorityRights} max={100} onChange={(v) => saveLevers({ minorityRights: v })} />
                  <LeverSlider label={t('governanceSim.powerSharing', 'Power Sharing (Inclusive)')} value={levers.powerSharing} max={100} onChange={(v) => saveLevers({ powerSharing: v })} />
                  <LeverSlider label={t('governanceSim.cultural', 'การศึกษาเชิงวัฒนธรรม')} value={levers.culturalEducation} max={100} onChange={(v) => saveLevers({ culturalEducation: v })} />
                  <LeverSlider label={t('governanceSim.subsidy', 'อุดหนุนอาหาร/พลังงาน')} value={levers.subsidy} max={100} onChange={(v) => saveLevers({ subsidy: v })} />
                  <LeverSlider label={t('governanceSim.foreignAppeasement', 'ผ่อนปรนต่างชาติ')} value={levers.foreignAppeasement} max={100} onChange={(v) => saveLevers({ foreignAppeasement: v })} />

                  <div className="flex items-center justify-between">
                    <span>{t('governanceSim.coercionLabel', 'ระดับกำลัง (Coercion)')}</span>
                    <select value={levers.coercion} onChange={(e) => saveLevers({ coercion: Number(e.target.value) })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                      <option value={0}>{t('governanceSim.coercion0', '0 ไม่มี')}</option>
                      <option value={1}>{t('governanceSim.coercion1', '1 เฝ้าดู')}</option>
                      <option value={2}>{t('governanceSim.coercion2', '2 ตำรวจ')}</option>
                      <option value={3}>{t('governanceSim.coercion3', '3 เคอร์ฟิว/กฎอัยการศึก')}</option>
                      <option value={4}>{t('governanceSim.coercion4', '4 กวาดล้าง')}</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <span>{t('governanceSim.assimStrategy', 'กลยุทธ์กลืนกลาย')}</span>
                    <select value={levers.assimilationStrategy} onChange={(e) => saveLevers({ assimilationStrategy: e.target.value as Strategy })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                      <option value="direct">{t('governanceSim.stratDirect', 'Direct (ลบอัตลักษณ์)')}</option>
                      <option value="indirect">{t('governanceSim.stratIndirect', 'Indirect (ผ่านผู้นำท้องถิ่น)')}</option>
                      <option value="economic">{t('governanceSim.stratEconomic', 'Economic (ซื้อใจด้วยความเจริญ)')}</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => saveLevers({ buyOffElites: true })} disabled={busy} className="btn-secondary">{t('governanceSim.buyElites', 'ซื้อใจผู้นำท้องถิ่น')}</button>
                    <button onClick={() => saveLevers({ purge: true })} disabled={busy} className="btn-danger">{t('governanceSim.purge', 'กวาดล้าง (Purge)')}</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button onClick={() => runTick(1)} disabled={busy} className="btn-primary">{t('governanceSim.plus1Month', '+1 เดือน')}</button>
                    <button onClick={() => runTick(6)} disabled={busy} className="btn-primary">{t('governanceSim.plus6Months', '+6 เดือน')}</button>
                    <button onClick={() => runTick(12)} disabled={busy} className="btn-primary">{t('governanceSim.plus1Year', '+1 ปี')}</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Narrative + Events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card panel-cyan p-4">
                <h3 className="text-sm font-semibold glow-text-cyan mb-2">{t('governanceSim.narrativeTitle', 'ข่าวจำลอง (LLM Narrative)')}</h3>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => genNarrative('newspaper')} disabled={narrBusy !== null} className="flex-1 btn-secondary">{t('governanceSim.newspaper', 'หนังสือพิมพ์')}</button>
                  <button onClick={() => genNarrative('threat_letter')} disabled={narrBusy !== null} className="flex-1 btn-danger">{t('governanceSim.threatLetter', 'จดหมายขู่')}</button>
                  <button onClick={() => genNarrative('analysis')} disabled={narrBusy !== null} className="flex-1 btn-primary">{t('governanceSim.analysis', 'บทวิเคราะห์')}</button>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {view.narratives.length === 0 && <div className="text-xs text-gray-500">{t('governanceSim.noNarratives', 'ยังไม่มี — กดสร้างด้านบน (ใช้ Ollama, offline → template)')}</div>}
                  {view.narratives.map((n, i) => (
                    <div key={i} className="border border-gray-700 rounded-lg p-2">
                      <div className="text-xs font-bold text-gray-200">{n.title} <span className="text-[9px] opacity-50">[{n.source}]</span></div>
                      <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-sans">{n.text}</pre>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card panel-cyan p-4">
                <h3 className="text-sm font-semibold glow-text-cyan mb-2">{t('governanceSim.eventLog', 'บันทึกเหตุการณ์')}</h3>
                <div className="space-y-1 max-h-72 overflow-y-auto log-stream">
                  {view.events.length === 0 && <div className="text-xs text-gray-500">{t('governanceSim.noEvents', 'ยังไม่มีเหตุการณ์')}</div>}
                  {view.events.map((e, i) => (
                    <div key={i} className={`text-[11px] px-2 py-1 rounded border ${
                      e.severity === 'critical' ? 'border-red-800 bg-red-950/30 text-red-300'
                      : e.severity === 'warning' ? 'border-amber-800 bg-amber-950/20 text-amber-300'
                      : e.severity === 'success' ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300'
                      : 'border-gray-700 bg-gray-800/50 text-gray-300'}`}>
                      <span className="text-[9px] opacity-50 mr-1">tick{e.tick} y{e.year}m{e.month}</span>{e.text}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-3">
                  <button onClick={delScenario.bind(null, view.id)} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"><Icon name="trash" size={11} /> {t('governanceSim.deleteScenario', 'ลบ Scenario นี้')}</button>
                </div>
              </div>
            </div>
          </>
        )}

        <GovernorPanel onCycleDone={loadScenarios} />
      </main>
    </div>
  );
}

// ── GOVERNOR AI PANEL — AI คุมเมืองเอง, มนุษย์คุมทิศทาง + อนุมัติเรื่องใหญ่ ──
interface GovStatus {
  enabled: boolean;
  direction: string;
  autonomy: 'conservative' | 'balanced' | 'autonomous';
  focusScenarioId: string | null;
  focusScenario: { id: string; name: string; status: string; tick: number; legitimacy: number; unrestRisk: number } | null;
  lastCycleAt: number | null;
  cycleCount: number;
  killSwitch: { active: boolean; reason?: string } | null;
  pendingProposals: Array<{
    id: string; kind: string; title: string; description: string;
    levers: Record<string, any>; suggestedBy: string; createdAt: number; status: string;
  }>;
  memory: Array<{ at: number; tick: number; scenarioId: string; action: string; context: string; outcome: { legitimacyDelta: number; unrestDelta: number; treasuryDelta: number; verdict: string } }>;
  activity: Array<{ at: number; type: string; text: string }>;
}

const AUTONOMY_LABEL: Record<string, string> = {
  conservative: 'Conservative — ปรับเล็กน้อย เรื่องส่วนใหญ่ต้องถามมนุษย์',
  balanced: 'Balanced — ปรับเล็กเองได้ เรื่องใหญ่ถามมนุษย์',
  autonomous: 'Autonomous — ตัดสินใจเองเกือบหมด (purge/กำลัง/กลยุทธ์ ยังต้องมนุษย์)',
};

function GovernorPanel({ onCycleDone }: { onCycleDone: () => void }) {
  const [st, setSt] = useState<GovStatus | null>(null);
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const t = useLanguageStore((s) => s.t);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/governor/status`);
      if (!res.ok) return;
      const data: GovStatus = await res.json();
      setSt(data);
      setDirection(data.direction);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const tmr = setInterval(load, 15000);
    return () => clearInterval(tmr);
  }, [load]);

  const act = async (method: string, path: string, body?: object) => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/governor${path}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setMsg(e.error || 'fail'); return; }
      const data: GovStatus = await res.json();
      setSt(data); setDirection(data.direction);
      setMsg(null);
      onCycleDone();
    } catch { setMsg(t('governanceSim.apiConnectFailed', 'เชื่อมต่อ API ไม่ได้')); }
    finally { setBusy(false); }
  };

  if (!st) return <div className="mt-6 card p-4 text-xs text-gray-500">{t('governanceSim.loadingGovernor', 'กำลังโหลด Governor AI...')}</div>;

  const verdictCls = (v: string) =>
    v === 'good' ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800'
    : v === 'bad' ? 'text-red-300 bg-red-950/40 border-red-800'
    : 'text-gray-300 bg-gray-800 border-gray-700';

  return (
    <div className="mt-6 card panel-glow p-4 border-violet-700/60">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-violet-300 glow-text">{t('governanceSim.governorTitle', 'Governor AI — ระบบคุมเมืองอัตโนมัติ')}</h2>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {t('governanceSim.governorDesc', 'AI ตัดสินใจเองทุกรอบ (ปรับ levers เล็กได้เอง) · เรื่องใหญ่เสนอให้มนุษย์ approve · เรียนรู้จากผลลัพธ์จริง')}
            {st.killSwitch && <span className="ml-2 text-red-400 font-bold">{t('governanceSim.killSwitchActive', 'Kill-switch ACTIVE — ระงับ auto')}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{t('governanceSim.cycleCount', 'รอบที่รัน: {n}', { n: st.cycleCount })}</span>
          <button onClick={() => act('POST', '/cycle')} disabled={busy}
            className="btn-primary"><Icon name="play" size={14} /> {t('governanceSim.runCycle', 'รันรอบทันที')}</button>
          <button onClick={() => act('PUT', '/enabled', { enabled: !st.enabled })} disabled={busy}
            className={`${st.enabled ? 'btn-primary' : 'btn-secondary'}`}>
            {st.enabled ? t('governanceSim.controlling', 'กำลังคุมเมือง') : t('governanceSim.off', 'ปิดอยู่')}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-800 text-xs text-red-300">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* มนุษย์: ทิศทาง */}
        <div className="card p-3">
          <h3 className="text-xs font-semibold text-amber-300 mb-2">{t('governanceSim.directionTitle', 'ทิศทาง (มนุษย์เป็นคนกำหนด)')}</h3>
          <textarea value={direction} onChange={(e) => setDirection(e.target.value)} rows={3}
            placeholder={t('governanceSim.directionPlaceholder', 'เช่น: ฟื้นฟูความชอบธรรม ใช้กำลังอย่างยับยั้งชั่งใจ มุ่งปรองดอง')}
            className="input w-full" />
          <button onClick={() => act('PUT', '/direction', { direction })} disabled={busy || !direction.trim()}
            className="mt-2 w-full btn-primary">{t('governanceSim.applyDirection', 'บังคับทิศทาง AI')}</button>
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-violet-300 mb-1">{t('governanceSim.autonomyLevel', 'ระดับอิสระ AI')}</h3>
            <select value={st.autonomy} onChange={(e) => act('PUT', '/autonomy', { autonomy: e.target.value })}
              className="input w-full">
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="autonomous">Autonomous</option>
            </select>
            <div className="text-[10px] text-gray-500 mt-1">{t(`governanceSim.autonomy.${st.autonomy}`, AUTONOMY_LABEL[st.autonomy])}</div>
          </div>
        </div>

        {/* เรื่องใหญ่รออนุมัติ */}
        <div className="card panel-cyan p-3">
          <h3 className="text-xs font-semibold text-amber-300 mb-2">{t('governanceSim.pendingProposals', 'เรื่องใหญ่รอการอนุมัติ ({n})', { n: st.pendingProposals.length })}</h3>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {st.pendingProposals.length === 0 && <div className="text-[11px] text-gray-500">{t('governanceSim.noProposals', 'ไม่มี — AI จัดการได้หมดในขอบเขตของมัน')}</div>}
            {st.pendingProposals.map((p) => (
              <div key={p.id} className="border border-amber-800/60 bg-amber-950/20 rounded-lg p-2">
                <div className="text-xs font-bold text-amber-200">[{p.kind}] {p.title}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{p.description}</div>
                {Object.keys(p.levers).length > 0 && (
                  <div className="text-[10px] text-gray-500 mt-1">{t('governanceSim.changes', 'การเปลี่ยนแปลง: {list}', { list: Object.entries(p.levers).map(([k, v]) => `${k}=${v}`).join(', ') })}</div>
                )}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => act('POST', `/proposals/${p.id}/approve`)} disabled={busy}
                    className="flex-1 btn-primary">{t('common.approve', 'อนุมัติ')}</button>
                  <button onClick={() => act('POST', `/proposals/${p.id}/reject`, { reason: 'มนุษย์ไม่เห็นด้วย' })} disabled={busy}
                    className="flex-1 btn-danger">{t('common.reject', 'ปฏิเสธ')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* เรียนรู้ + กิจกรรม */}
        <div className="card panel-cyan p-3">
          <h3 className="text-xs font-semibold text-emerald-300 mb-2">{t('governanceSim.lessons', 'บทเรียนที่เรียนรู้ (จากผลลัพธ์จริง)')}</h3>
          <div className="space-y-1 max-h-28 overflow-y-auto mb-3">
            {st.memory.length === 0 && <div className="text-[11px] text-gray-500">{t('governanceSim.noMemory', 'ยังไม่มี — AI จะเรียนรู้เมื่อคุมเมืองไปสักพัก')}</div>}
            {st.memory.map((m, i) => (
              <div key={i} className={`text-[10px] px-2 py-1 rounded border ${verdictCls(m.outcome.verdict)}`}>
                <span className="opacity-70">{t('governanceSim.tickLabel', 'tick {n}:', { n: m.tick })}</span> {m.action}
                <span className="ml-1">{t('governanceSim.verdict', '→ {verdict} (leg {delta})', { verdict: m.outcome.verdict === 'good' ? t('governanceSim.good', 'ดีขึ้น') : m.outcome.verdict === 'bad' ? t('governanceSim.bad', 'แย่ลง') : t('governanceSim.flat', 'ทรง'), delta: `${m.outcome.legitimacyDelta >= 0 ? '+' : ''}${m.outcome.legitimacyDelta}` })}</span>
              </div>
            ))}
          </div>
          <h3 className="text-xs font-semibold text-gray-300 glow-text-cyan mb-2">{t('governanceSim.recentActivity', 'กิจกรรมล่าสุด')}</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {st.activity.map((a, i) => (
              <div key={i} className="text-[10px] text-gray-500 border-b border-gray-800/60 pb-1">{a.text}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeverSlider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span>{label}</span><span className="text-gray-400">{value}</span>
      </div>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500" />
    </div>
  );
}