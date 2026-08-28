// ── Governor AI — ระบบคุมเมืองอัตโนมัติ + เรียนรู้จากผลลัพธ์ ──
// หลักการ: มนุษย์ตั้ง "ทิศทาง" + ตรวจสอบเฉพาะเรื่องใหญ่ (purge / coercion≥3 / เปลี่ยนกลยุทธ์ / งบประมาณใหญ่)
//          AI ตัดสินใจรายละเอียดเองทุก cycle (ตั้ง levers เล็ก ๆ ได้เองภายในขอบเขต)
//          แล้ววัดผลจริงจาก sim (legitimacy/unrest/treasury เปลี่ยนไปแค่ไหน) เก็บเป็น "บทเรียน"
//          รอบถัดไป AI เห็นบทเรียนย้อนหลัง → ปรับการตัดสินใจเอง (learning loop)
//          ถ้า Ollama ล้ม → fallback เป็นกฎ deterministic (ระบบยังทำงาน ไม่หยุด)
import path from 'path';
import axios from 'axios';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import { securityStream } from './security-stream.service';
import { aiKillSwitch } from './ai-kill-switch.service';
import { getModelForTask } from './ai-router.service';
import { syncActuatorsFromLevers } from './actuation.service';
import {
  createScenario, listScenarios, loadScenario, applyLevers, tickScenario, govsimSnapshot,

} from './governance-sim.service';

const STATE_FILE = process.env.GOVERNOR_STATE_FILE || path.resolve(process.cwd(), 'data', 'governor.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
export const MODEL = process.env.GOVERNOR_MODEL || process.env.RISK_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b';
const TICKS_PER_CYCLE = Math.min(Math.max(parseInt(process.env.GOVERNOR_TICKS_PER_CYCLE || '2', 10) || 2, 1), 12);
const LEVER_WHITELIST = new Set([
  'welfare', 'subsidy', 'minorityRights', 'powerSharing', 'culturalEducation',
  'policePatrols', 'foreignAppeasement', 'taxRate',
]);
const BUDGET_WHITELIST = new Set(['military', 'bureaucracy', 'welfare', 'infrastructure', 'patronage']);
const PROPOSAL_LIMIT = 50;
const MEMORY_LIMIT = 60;
const ACTIVITY_LIMIT = 100;

export type AutonomyLevel = 'conservative' | 'balanced' | 'autonomous';
export type ProposalKind =
  | 'purge' | 'buy_off' | 'coercion' | 'strategy'
  | 'budget_overhaul' | 'authoritarian' | 'tax_change' | 'direction';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  description: string;
  levers: Record<string, any>;
  suggestedBy: 'ai' | 'human';
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: number;
  decidedBy?: string;
  reason?: string;
}

export interface MemoryEntry {
  at: number;
  tick: number;
  scenarioId: string;
  action: string;
  context: string;
  outcome: {
    legitimacyDelta: number;
    unrestDelta: number;
    treasuryDelta: number;
    verdict: 'good' | 'neutral' | 'bad';
  };
}

export interface ActivityEntry {
  at: number;
  type: 'cycle' | 'auto_action' | 'proposal' | 'approve' | 'reject' | 'direction' | 'autonomy' | 'error' | 'paused';
  text: string;
}

export interface GovernorState {
  enabled: boolean;
  direction: string;
  autonomy: AutonomyLevel;
  focusScenarioId: string | null;
  lastCycleAt: number | null;
  cycleCount: number;
  proposals: Proposal[];
  memory: MemoryEntry[];
  activity: ActivityEntry[];
}

function defaultState(): GovernorState {
  return {
    enabled: false,
    direction: 'ฟื้นฟูความชอบธรรมของรัฐหลังการยึดครอง ใช้กำลังอย่างยับยั้งชั่งใจ มุ่งปรองดองระยะยาว',
    autonomy: 'balanced',
    focusScenarioId: null,
    lastCycleAt: null,
    cycleCount: 0,
    proposals: [],
    memory: [],
    activity: [],
  };
}

let state: GovernorState | null = null;

export function loadGovernorState(): GovernorState {
  if (state) return state;
  const { data } = readJsonVerified<GovernorState>(STATE_FILE);
  state = { ...defaultState(), ...(data || {}) };
  return state;
}

function saveState(): void {
  if (!state) return;
  saveJsonAtomic(STATE_FILE, state);
}

function log(type: ActivityEntry['type'], text: string): void {
  state!.activity.push({ at: Date.now(), type, text });
  if (state!.activity.length > ACTIVITY_LIMIT) state!.activity.splice(0, state!.activity.length - ACTIVITY_LIMIT);
  securityStream.push('GOVERNOR', { action: type, text });
}

function makeId(): string {
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
}

// ── API สำหรับมนุษย์ ──

export function setDirection(direction: string): { ok: boolean; error?: string } {
  const text = String(direction ?? '').trim().slice(0, 500);
  if (!text) return { ok: false, error: 'direction ต้องไม่ว่าง' };
  loadGovernorState();
  state!.direction = text;
  saveState();
  log('direction', `🧭 มนุษย์ตั้งทิศทาง: "${text}"`);
  return { ok: true };
}

export function setAutonomy(level: string): { ok: boolean; error?: string } {
  if (!['conservative', 'balanced', 'autonomous'].includes(level)) {
    return { ok: false, error: 'autonomy ต้องเป็น conservative | balanced | autonomous' };
  }
  loadGovernorState();
  state!.autonomy = level as AutonomyLevel;
  saveState();
  log('autonomy', `⚙️ ระดับอิสระ AI: ${level}`);
  return { ok: true };
}

export function setEnabled(enabled: boolean): { ok: boolean } {
  loadGovernorState();
  state!.enabled = !!enabled;
  saveState();
  log(enabled ? 'cycle' : 'paused', enabled ? '▶️ Governor เริ่มทำงานอัตโนมัติ' : '⏸️ Governor หยุดชั่วคราว (มนุษย์สั่ง)');
  return { ok: true };
}

export function setFocusScenario(id: string | null): { ok: boolean; error?: string } {
  loadGovernorState();
  if (id && !loadScenario(id)) return { ok: false, error: 'scenario not found' };
  state!.focusScenarioId = id;
  saveState();
  return { ok: true };
}

// ── Pure: แยกแยะว่าการกระทำใด "ใหญ่" ต้องให้มนุษย์ approve ──

export function isSignificantLever(lever: string, value: number, current: number): boolean {
  const diff = Math.abs(value - current);
  if (lever === 'purge' && value) return true;
  if (lever === 'buyOffElites' && value) return true;
  if (lever === 'coercion') return value >= 3 || diff >= 2;
  if (lever === 'assimilationStrategy') return true;
  if (lever === 'taxRate') return diff >= 5;
  if (lever === 'mediaControl' || lever === 'surveillance') return value > 50;
  if (BUDGET_WHITELIST.has(lever)) return diff >= 15;
  return false;
}

// ขอบเขตปรับสูงสุดต่อรอบตามระดับอิสระ — conservative: แค่ +-2, autonomous: +-6
export function maxDeltaFor(autonomy: AutonomyLevel, lever: string): number {
  const base = autonomy === 'conservative' ? 2 : autonomy === 'balanced' ? 4 : 6;
  if (lever === 'taxRate' || lever === 'coercion') return Math.min(base, 2);
  if (BUDGET_WHITELIST.has(lever)) return Math.min(base, 5);
  return base;
}

// ── Pure: Fallback heuristic (ทำงานเมื่อ Ollama ล้ม) — กฎจากทฤษฎีรัฐศาสตร์ ──

export function heuristicDecide(snap: any, autonomy: AutonomyLevel): { auto: Array<{ lever: string; value: number; reason: string }>; proposals: Array<{ kind: ProposalKind; title: string; description: string; levers: Record<string, any> }> } {
  const auto: Array<{ lever: string; value: number; reason: string }> = [];
  const proposals: Array<{ kind: ProposalKind; title: string; description: string; levers: Record<string, any> }> = [];
  const l = snap.levers;
  const push = (lever: string, target: number, reason: string) => {
    const cur = lever in l ? (l as any)[lever] : l.budget?.[lever];
    if (typeof cur !== 'number') return;
    const maxD = maxDeltaFor(autonomy, lever);
    const clamped = Math.max(cur - maxD, Math.min(cur + maxD, target));
    if (clamped !== cur && !isSignificantLever(lever, clamped, cur)) auto.push({ lever, value: clamped, reason });
  };

  if (snap.legitimacy.total < 40) {
    push('powerSharing', l.powerSharing + 10, `Legitimacy ต่ำ (${Math.round(snap.legitimacy.total)}) — เปิดพื้นที่ร่วม`);
  }
  if (snap.unrestRisk > 55) {
    push('policePatrols', l.policePatrols + 6, `Unrest ${Math.round(snap.unrestRisk)} — เพิ่มกำลังตำรวจ`);
  }
  if (snap.gini > 60) {
    push('welfare', l.welfare + 6, `Gini ${Math.round(snap.gini)} — เพิ่มสวัสดิการลดเหลื่อมล้ำ`);
    push('subsidy', l.subsidy + 5, `Gini สูง — อุดหนุนราคาอาหาร`);
  }
  if (snap.scarcity > 55) push('subsidy', l.subsidy + 6, `Scarcity ${Math.round(snap.scarcity)} — อุดหนุนบรรเทาความเดือดร้อน`);
  if (snap.treasury < 0) push('taxRate', Math.min(35, l.taxRate + 2), `คลังติดลบ ${Math.round(snap.treasury)} — เพิ่มภาษีเล็กน้อย`);
  if (snap.insurgencyStrength > 0.12) {
    push('policePatrols', l.policePatrols + 5, `กบฏ ${Math.round(snap.insurgencyStrength * 100)}% — ตรึงกำลัง`);
    if (snap.insurgencyStrength > 0.25) {
      proposals.push({
        kind: 'coercion', title: 'ยกระดับกำลังปราบปราม', description: `กบฏ ${Math.round(snap.insurgencyStrength * 100)}% ของประชากร — เสนอใช้กำลังระดับ 3 (เคอร์ฟิว/กฎอัยการศึก)`, levers: { coercion: 3 },
      });
    }
  }
  if (snap.resistance > 60) {
    push('culturalEducation', l.culturalEducation + 5, `Resistance ${Math.round(snap.resistance)} — เรียนรู้วัฒนธรรมกันเอง`);
    push('powerSharing', l.powerSharing + 4, `Resistance สูง — ดึงผู้นำฝ่ายตรงข้ามเข้าร่วม`);
  }
  if (snap.friction > 55) push('welfare', l.welfare + 4, `Friction ${Math.round(snap.friction)} — บริการพื้นฐานลดแรงเสียดทาน`);
  if (snap.foreignProxy > 40) push('foreignAppeasement', l.foreignAppeasement + 5, `Proxy ${Math.round(snap.foreignProxy)} — ผ่อนปรนต่างชาติ`);
  if (snap.counterNarrative > 55) {
    proposals.push({
      kind: 'direction', title: 'ลดช่องว่างข้อมูล', description: `Counter-narrative ${Math.round(snap.counterNarrative)} — เสนอเพิ่มความโปร่งใส/เปิดข้อมูลเพื่อกัน Epistemic Collapse`, levers: {},
    });
  }
  if (snap.corruption > 55) {
    proposals.push({
      kind: 'budget_overhaul', title: 'ปราบคอร์รัปชันในระบบราชการ', description: `Corruption ${Math.round(snap.corruption)} — เสนอปรับงบ bureaucracy ลดลง + เพิ่ม audit`, levers: { budget: { ...l.budget, bureaucracy: Math.max(5, l.budget.bureaucracy - 5) } },
    });
  }
  if (snap.status === 'civil_war') {
    proposals.push({
      kind: 'strategy', title: 'เปลี่ยนกลยุทธ์การกลืนกลาย', description: 'สงครามกลางเมือง — เสนอเปลี่ยนจาก direct เป็น economic/indirect เพื่อลดแรงเสียดทาน', levers: { assimilationStrategy: 'economic' },
    });
  }
  if (proposals.length === 0 && auto.length === 0) {
    return { auto: [], proposals: [{ kind: 'direction', title: 'คงนโยบายปัจจุบัน', description: 'ตัวชี้วัดทรงตัว — ไม่ต้องปรับอะไรในรอบนี้', levers: {} }] };
  }
  return { auto, proposals };
}

// ── Pure: parse คำตอบ JSON จาก LLM ──

export function parseGovernorDecision(raw: string): { strategy?: string; auto?: any[]; proposals?: any[] } {
  try {
    const text = String(raw ?? '');
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    const obj = JSON.parse(candidate.slice(start, end + 1));
    return {
      strategy: String(obj?.strategy ?? '').slice(0, 200),
      auto: Array.isArray(obj?.auto_actions) ? obj.auto_actions : [],
      proposals: Array.isArray(obj?.proposals) ? obj.proposals : [],
    };
  } catch {
    return {};
  }
}

// ── Pure: กลั่นกรอง auto-action (whitelist + bound + ไม่ใหญ่เกิน) ──

export function sanitizeAutoActions(actions: any[], snap: any, autonomy: AutonomyLevel): Array<{ lever: string; value: number; reason: string }> {
  const out: Array<{ lever: string; value: number; reason: string }> = [];
  const l = snap.levers;
  for (const a of actions || []) {
    const lever = String(a?.lever ?? '');
    let value = Number(a?.value);
    if (!Number.isFinite(value)) continue;
    const cur = lever in l ? (l as any)[lever] : l.budget?.[lever];
    if (typeof cur !== 'number') continue;
    if (!LEVER_WHITELIST.has(lever) && !BUDGET_WHITELIST.has(lever)) continue;
    const maxD = maxDeltaFor(autonomy, lever);
    const clamped = Math.max(cur - maxD, Math.min(cur + maxD, Math.round(value)));
    if (clamped === cur) continue;
    if (isSignificantLever(lever, clamped, cur)) continue;
    if (lever === 'taxRate' && clamped > 40) continue;
    out.push({ lever, value: clamped, reason: String(a?.reason ?? '').slice(0, 200) });
  }
  return out;
}

// ── Pure: วัดผลลัพธ์ของสิ่งที่ทำไป (learning verdict) ──

export function evaluateOutcome(before: any, after: any): MemoryEntry['outcome'] {
  const legitimacyDelta = Math.round((after.legitimacy.total - before.legitimacy.total) * 10) / 10;
  const unrestDelta = Math.round((after.unrestRisk - before.unrestRisk) * 10) / 10;
  const treasuryDelta = Math.round((after.treasury - before.treasury) * 10) / 10;
  let verdict: MemoryEntry['outcome']['verdict'] = 'neutral';
  if (legitimacyDelta >= 2 || unrestDelta <= -2) verdict = 'good';
  else if (legitimacyDelta <= -2 || unrestDelta >= 2) verdict = 'bad';
  return { legitimacyDelta, unrestDelta, treasuryDelta, verdict };
}

// ── กลไกหลัก: รันหนึ่งรอบ ──

export async function runGovernorCycle(opts: { force?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
  loadGovernorState();
  const s = state!;
  if (!opts.force && !s.enabled) return { ok: false, reason: 'disabled' };
  if (aiKillSwitch.isActive()) {
    log('paused', `🔒 Kill-switch active — Governor ระงับ auto-actions (${aiKillSwitch.status().reason})`);
    return { ok: false, reason: 'kill_switch' };
  }

  // หา scenario: focus หรือตัวล่าสุดที่ยังไม่จบ
  let scenarioId = s.focusScenarioId;
  if (!scenarioId || !loadScenario(scenarioId)) {
    const candidates = listScenarios().filter((x) => x.status !== 'collapsed' && x.status !== 'integrated');
    scenarioId = candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || null;
    if (!scenarioId) return { ok: false, reason: 'no_scenario' };
    s.focusScenarioId = scenarioId;
  }
  const snap = govsimSnapshot(scenarioId);
  if (!snap) return { ok: false, reason: 'scenario_not_found' };

  const before = { legitimacy: { total: snap.legitimacy.total }, unrestRisk: snap.unrestRisk, treasury: snap.treasury };
  const lessons = s.memory.slice(-8).map((m) => `${m.action} → ${m.outcome.verdict} (leg ${m.outcome.legitimacyDelta >= 0 ? '+' : ''}${m.outcome.legitimacyDelta} / unrest ${m.outcome.unrestDelta >= 0 ? '+' : ''}${m.outcome.unrestDelta})`);
  const context = [
    `ทิศทางจากมนุษย์: ${s.direction}`,
    `สถานะ: ${snap.status} | Legitimacy ${Math.round(snap.legitimacy.total)} | Asabiyyah ${Math.round(snap.asabiyyah)} | Unrest ${Math.round(snap.unrestRisk)} | Gini ${Math.round(snap.gini)} | Scarcity ${Math.round(snap.scarcity)}`,
    `กบฏ ${Math.round(snap.insurgencyStrength * 100)}% | Resistance ${Math.round(snap.resistance)} | Friction ${Math.round(snap.friction)} | Treasury ${Math.round(snap.treasury)} | GDP ${Math.round(snap.gdpIndex)}`,
    `Corruption ${Math.round(snap.corruption)} | Proxy ${Math.round(snap.foreignProxy)} | Counter-narrative ${Math.round(snap.counterNarrative)} | Suppression ${Math.round(snap.suppressionRecord)}`,
    `Levers ปัจจุบัน: tax ${snap.levers.taxRate}% | welfare ${snap.levers.budget.welfare} | subsidy ${snap.levers.subsidy} | powerSharing ${snap.levers.powerSharing} | coercion ${snap.levers.coercion} | patrols ${snap.levers.policePatrols}`,
  ].join('\n');
  const lessonsText = lessons.length ? `บทเรียนที่ผ่านมา (ใช้ประกอบการตัดสินใจ):\n${lessons.join('\n')}` : 'ยังไม่มีบทเรียน (รอบแรก)';

  const prompt = `คุณคือผู้ว่าการ (Governor AI) ของระบบจำลองการปกครอง\n${context}\n\n${lessonsText}\n\nตัดสินใจรอบนี้:\n1) auto_actions — ปรับ levers เล็กน้อย (ห้ามเกินขอบเขต ปรับทีละไม่กี่จุด ไม่ใช้ purge/buyOff/coercion≥3) ทำเองได้เลย\n2) proposals — เรื่องใหญ่ที่ต้องให้มนุษย์ approve: purge, buyOffElites, coercion≥3, เปลี่ยนกลยุทธ์, ปรับงบ >15 จุด, สื่อ/สอดส่อง >50\nตอบ JSON เท่านั้น:\n{"strategy": "กลยุทธ์สั้น 1 ประโยค", "auto_actions": [{"lever": "...", "value": ตัวเลข, "reason": "เหตุผลสั้น"}], "proposals": [{"kind": "purge|buy_off|coercion|strategy|budget_overhaul|authoritarian|tax_change|direction", "title": "...", "description": "...", "levers": {}}]}\nยึดทิศทางมนุษย์เป็นหลัก`;

  let decision: { strategy?: string; auto?: any[]; proposals?: any[] } = {};
  let llmOk = false;
  try {
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: await getModelForTask('REASONING_GOVERNOR', MODEL), prompt, stream: false, options: { temperature: 0.7, num_predict: 800 }, keep_alive: OLLAMA_KEEP_ALIVE,
    }, { timeout: 60000 });
    const raw = String(resp.data?.response ?? '').trim();
    decision = parseGovernorDecision(raw);
    llmOk = Object.keys(decision).length > 0 && (Array.isArray(decision.auto) || Array.isArray(decision.proposals));
  } catch {
    // Ollama ล้ม → fallback heuristic
  }
  if (!llmOk) {
    const h = heuristicDecide(snap, s.autonomy);
    decision = { strategy: 'fallback heuristic (Ollama ไม่ตอบ)', auto: h.auto, proposals: h.proposals };
  }

  // 1) auto-actions (ภายในขอบเขต)
  const auto = sanitizeAutoActions(decision.auto ?? [], snap, s.autonomy);
  const leversPatch: Record<string, any> = {};
  for (const a of auto) leversPatch[a.lever] = a.value;
  if (Object.keys(leversPatch).length) {
    applyLevers(scenarioId, leversPatch);
    log('auto_action', `⚡ AI ปรับเอง: ${Object.entries(leversPatch).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    // Phase 7: แปลง levers → actuator (ผ่าน Safety Envelope — โดนบล็อกก็ไม่พังรอบนี้)
    try {
      void syncActuatorsFromLevers(leversPatch, 'governor');
    } catch (err) {
      console.error('Governor: actuation sync failed:', err instanceof Error ? err.message : err);
    }
  }

  // 2) proposals → queue รอมนุษย์ (เรื่องใหญ่ — levers ผ่านการ validate เท่านั้น ไม่กรอง)
  for (const p of (decision.proposals || [])) {
    const kind = String(p?.kind ?? '');
    if (!['purge', 'buy_off', 'coercion', 'strategy', 'budget_overhaul', 'authoritarian', 'tax_change', 'direction'].includes(kind)) continue;
    const title = String(p?.title ?? '').trim().slice(0, 120);
    if (!title) continue;
    const levers: Record<string, any> = {};
    for (const [k, v] of Object.entries(p?.levers || {})) {
      if (k === 'budget' && typeof v === 'object' && v !== null) {
        levers.budget = { ...(v as any) };
      } else if (typeof v === 'boolean') {
        levers[k] = v;
      } else {
        const num = Number(v);
        if (Number.isFinite(num)) levers[k] = k === 'coercion' ? Math.max(0, Math.min(4, Math.round(num))) : Math.round(num);
      }
    }
    s.proposals.push({
      id: makeId(), kind: kind as ProposalKind, title, description: String(p?.description ?? '').trim().slice(0, 400),
      levers, suggestedBy: 'ai', createdAt: Date.now(), status: 'pending',
    });
    if (s.proposals.length > PROPOSAL_LIMIT) s.proposals.splice(0, s.proposals.length - PROPOSAL_LIMIT);
    log('proposal', `📨 AI เสนอ (รอมนุษย์): ${title}`);
  }

  // 3) เดินเวลา แล้ววัดผลลัพธ์จริง → บทเรียน
  if (auto.length) {
    const { scenario } = tickScenario(scenarioId, TICKS_PER_CYCLE);
    if (scenario) {
      const snap2 = govsimSnapshot(scenarioId);
      if (snap2) {
        const outcome = evaluateOutcome(before, snap2);
        s.memory.push({
          at: Date.now(), tick: snap2.tick, scenarioId, action: Object.entries(leversPatch).map(([k, v]) => `${k}=${v}`).join(', '),
          context: `leg ${Math.round(before.legitimacy.total)} → ${Math.round(snap2.legitimacy.total)} | unrest ${Math.round(before.unrestRisk)} → ${Math.round(snap2.unrestRisk)}`,
          outcome,
        });
        if (s.memory.length > MEMORY_LIMIT) s.memory.splice(0, s.memory.length - MEMORY_LIMIT);
        log('cycle', `🧠 บทเรียน: ${outcome.verdict === 'good' ? '✅ ใช้ได้' : outcome.verdict === 'bad' ? '❌ แย่ลง' : '➖ ทรงตัว'} (leg ${outcome.legitimacyDelta >= 0 ? '+' : ''}${outcome.legitimacyDelta})`);
      }
    }
  }

  s.lastCycleAt = Date.now();
  s.cycleCount += 1;
  saveState();
  return { ok: true };
}

// ── Proposals: มนุษย์ approve / reject ──

export function approveProposal(id: string, by = 'human'): { ok: boolean; error?: string; scenarioId?: string } {
  loadGovernorState();
  const p = state!.proposals.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'proposal not found' };
  if (p.status !== 'pending') return { ok: false, error: `proposal ถูก ${p.status} แล้ว` };
  const scenarioId = state!.focusScenarioId;
  if (!scenarioId || !loadScenario(scenarioId)) return { ok: false, error: 'ไม่มี scenario ที่ governor ดูแล' };
  const r = applyLevers(scenarioId, p.levers);
  if (!r.ok) return { ok: false, error: r.error };
  p.status = 'approved';
  p.decidedAt = Date.now();
  p.decidedBy = by;
  saveState();
  log('approve', `✅ มนุษย์อนุมัติ: ${p.title}`);
  securityStream.push('GOVSIM', { scenario: scenarioId, action: 'levers', text: `Governor: ${p.title}` });
  // Phase 7: เรื่องใหญ่ที่มนุษย์อนุมัติ → ส่งลงมือจริง (ผ่าน Safety Envelope ด้วย)
  try {
    void syncActuatorsFromLevers(p.levers, 'human');
  } catch (err) {
    console.error('Governor: actuation sync failed (approved proposal):', err instanceof Error ? err.message : err);
  }
  return { ok: true, scenarioId };
}

export function rejectProposal(id: string, by = 'human', reason?: string): { ok: boolean; error?: string } {
  loadGovernorState();
  const p = state!.proposals.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'proposal not found' };
  if (p.status !== 'pending') return { ok: false, error: `proposal ถูก ${p.status} แล้ว` };
  p.status = 'rejected';
  p.decidedAt = Date.now();
  p.decidedBy = by;
  p.reason = String(reason ?? '').trim().slice(0, 300) || undefined;
  saveState();
  log('reject', `⛔ มนุษย์ปฏิเสธ: ${p.title}${p.reason ? ` — ${p.reason}` : ''}`);
  return { ok: true };
}

export function governorStatus() {
  loadGovernorState();
  const s = state!;
  const scenario = s.focusScenarioId ? govsimSnapshot(s.focusScenarioId) : null;
  return {
    enabled: s.enabled,
    direction: s.direction,
    autonomy: s.autonomy,
    focusScenarioId: s.focusScenarioId,
    focusScenario: scenario
      ? { id: scenario.id, name: scenario.name, status: scenario.status, tick: scenario.tick, legitimacy: scenario.legitimacy.total, unrestRisk: scenario.unrestRisk }
      : null,
    lastCycleAt: s.lastCycleAt,
    cycleCount: s.cycleCount,
    killSwitch: aiKillSwitch.isActive() ? aiKillSwitch.status() : null,
    pendingProposals: s.proposals.filter((p) => p.status === 'pending'),
    memory: s.memory.slice(-10).reverse(),
    activity: s.activity.slice(-15).reverse(),
  };
}

// boot: โหลด state ตั้งแต่แรก (ไม่มีผลข้างเคียง)
export function initGovernor(): void {
  loadGovernorState();
}