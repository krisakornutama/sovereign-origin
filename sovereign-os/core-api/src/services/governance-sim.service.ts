// ── Governance & Socio-Political Simulation Engine (Phase 7) ──
// จำลองการปกครอง + เสถียรภาพสังคม ระดับบุคคล (หลายพันคน) ตามพิมพ์เขียว 8 โมดูล:
//   1. Faction & Demographics   2. Political Economy       3. Legitimacy
//   4. Institutional Capacity  5. Security & Coercion     6. Information
//   7. Foreign Intervention    8. Post-Conquest Integration
// จุดขาย: seeded RNG (จำลองซ้ำได้ผลเดิม) + snapshot/load ผ่านไฟล์ state (checksum)
// + Levers (เครื่องมือผู้ปกครอง) + LLM narrative (หนังสือพิมพ์จำลอง/จดหมายขู่/บทวิเคราะห์)

import path from 'path';
import crypto from 'crypto';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import { securityStream } from './security-stream.service';

export type SocialClass = 'ruling' | 'economic' | 'middle' | 'working' | 'marginalized';
export type IdentityGroup = 'majority' | 'minority' | 'conquered';
export type TerritoryId = 'capital' | 'province_north' | 'province_south' | 'conquered_city';
export type AssimilationStrategy = 'direct' | 'indirect' | 'economic';
export type CoercionLevel = 0 | 1 | 2 | 3 | 4;
export type GovSimStatus = 'stable' | 'unstable' | 'civil_war' | 'collapsed' | 'integrated';
export type NarrativeKind = 'newspaper' | 'threat_letter' | 'analysis';

export const SOCIAL_CLASSES: SocialClass[] = ['ruling', 'economic', 'middle', 'working', 'marginalized'];
export const TERRITORIES: TerritoryId[] = ['capital', 'province_north', 'province_south', 'conquered_city'];

const CLASS_LABEL: Record<SocialClass, string> = {
  ruling: 'ชนชั้นปกครอง (Elites)',
  economic: 'ชนชั้นนายทุน (Economic Elites)',
  middle: 'ชนชั้นกลาง / ปัญญาชน',
  working: 'แรงงาน / ชาวนา',
  marginalized: 'คนชายขอบ / ชนกลุ่มน้อย',
};

export interface GovSimLevers {
  taxRate: number; // 0..50 (%)
  budget: { military: number; bureaucracy: number; welfare: number; infrastructure: number; patronage: number }; // % ของ GDP
  mediaControl: number; // 0..100
  policePatrols: number; // 0..100
  surveillance: number; // 0..100
  coercion: CoercionLevel; // 0=ไม่มี 1=เฝ้าดู 2=ตำรวจ 3=เคอร์ฟิว/กฎอัยการศึก 4=ปราบ/กวาดล้าง
  minorityRights: number; // 0..100
  powerSharing: number; // 0..100 (Inclusive — ดึงฝ่ายตรงข้ามเข้าร่วม)
  culturalEducation: number; // 0..100
  subsidy: number; // 0..100 (อุดหนุนอาหาร/พลังงาน)
  buyOffElites: boolean; // ซื้อใจผู้นำท้องถิ่น (กด one-shot)
  purge: boolean; // กวาดล้าง (กด one-shot)
  assimilationStrategy: AssimilationStrategy;
  foreignAppeasement: number; // 0..100 (ยอมผ่อนปรนต่างชาติ ลด proxy)
}

export interface Person {
  id: number;
  name: string;
  cls: SocialClass;
  identity: IdentityGroup;
  religion: 'majority' | 'minority';
  territory: TerritoryId;
  income: number; // 0..100 เทียบภายในชนชั้น
  satisfaction: number; // 0..100
  radicalization: number; // 0..100
  mobilization: number; // 0..100
  identityAlignment: number; // -100..100
  trust: number; // 0..100 (เชื่อถือรัฐ — epistemic)
  grievances: number; // 0..100 (สะสมความแค้น)
  insurgency: boolean; // อยู่ในขบวนการกบฏ?
  age: number;
}

export interface TickRecord {
  tick: number;
  year: number;
  month: number;
  status: GovSimStatus;
  treasury: number;
  gdpIndex: number;
  inflation: number;
  gini: number;
  scarcity: number;
  asabiyyah: number;
  legitimacyTotal: number;
  stateReach: number;
  corruption: number;
  judicialFairness: number;
  coerciveForce: number;
  unrestRisk: number;
  rebellionProbability: number;
  insurgencyStrength: number;
  pacification: number;
  resistance: number;
  friction: number;
  collaboratorRatio: number;
  counterNarrative: number;
}

export interface GovSimEvent {
  tick: number;
  year: number;
  month: number;
  kind: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  text: string;
}

export interface GovSimScenario {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  tick: number;
  year: number;
  month: number;
  status: GovSimStatus;
  population: number;
  treasury: number;
  gdpIndex: number;
  inflation: number;
  gini: number;
  scarcity: number;
  asabiyyah: number;
  legitimacy: { performance: number; ideology: number; procedural: number; total: number };
  stateReach: number;
  corruption: number;
  judicialFairness: number;
  coerciveForce: number;
  suppressionRecord: number;
  unrestRisk: number;
  rebellionProbability: number;
  insurgencyStrength: number;
  mediaControl: number;
  propagandaGap: number;
  epistemicCollapse: boolean;
  counterNarrative: number;
  foreignProxy: number;
  sanctions: number;
  sanctuary: number;
  externalThreat: number;
  friction: number;
  collaboratorRatio: number; // 0..1
  pacification: number;
  resistance: number;
  assimilationStrategy: AssimilationStrategy;
  levers: GovSimLevers;
  persons: Person[];
  events: GovSimEvent[];
  lastTickEvents: GovSimEvent[];
  history: TickRecord[];
  narratives: Array<{ kind: NarrativeKind; title: string; text: string; source: string; at: number }>;
}

const DATA_DIR = process.env.GOVSIM_DATA_DIR || path.resolve(process.cwd(), 'data');
const DEFAULT_POPULATION = Math.min(Math.max(parseInt(process.env.GOVSIM_POPULATION || '3000', 10) || 3000, 100), 20000);
const HISTORY_LIMIT = 240;
const EVENTS_LIMIT = 200;

// ── Seeded RNG (mulberry32) — จำลองซ้ำด้วย seed เดิมได้ผลเดิมเป๊ะ ──
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function rounded(n: number): number {
  return Math.round(n * 100) / 100;
}

function makeId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function scenarioPath(id: string): string {
  return path.join(DATA_DIR, `govsim-${id}.json`);
}

// ── ชื่อไทยจำลอง (seeded สุ่มผสม) ──
const FIRST_NAMES = [
  'สมชาย', 'สมหญิง', 'วิชัย', 'ประภา', 'ธนา', 'กุลยา', 'อนันต์', 'รัตนา', 'บุญมี', 'สุดา',
  'ประเสริฐ', 'นิตยา', 'คำนวณ', 'อุไร', 'สมศักดิ์', 'พัชรี', 'เดชา', 'ละมัย', 'สุริยา', 'อำพร',
  'ไกรสร', 'เบญจา', 'วีระ', 'จันทร์เพ็ญ', 'อดุลย์', 'สายใจ', 'ปรีชา', 'กมล', 'สุภาพ', 'วาสนา',
];
const LAST_NAMES = [
  'แก้วใส', 'ทองดี', 'แสนสุข', 'อินทร์ทอง', 'ชัยวัฒน์', 'พรหมมา', 'รักไทย', 'สุขสม', 'เมฆขาว', 'แสงจันทร์',
  'วงศ์คำ', 'ใจดี', 'ปราบปราม', 'พูนสุข', 'สิทธิพร', 'บัวหลวง', 'คงกระพัน', 'สุวรรณ', 'งามวงศ์', 'เงินทอง',
];

const TERRITORY_LABEL: Record<TerritoryId, string> = {
  capital: 'เมืองหลวง',
  province_north: 'จังหวัดเหนือ',
  province_south: 'จังหวัดใต้',
  conquered_city: 'เมืองยึดครองใหม่',
};

// ── Generation: สร้างประชากรจำลอง ──
function generatePersons(scenario: GovSimScenario, rng: () => number): void {
  const persons: Person[] = [];
  const classWeights: Array<[SocialClass, number]> = [
    ['ruling', 0.04], ['economic', 0.08], ['middle', 0.22], ['working', 0.46], ['marginalized', 0.20],
  ];
  for (let i = 0; i < scenario.population; i++) {
    let roll = rng();
    let cls: SocialClass = 'working';
    for (const [c, w] of classWeights) {
      if (roll < w) { cls = c; break; }
      roll -= w;
    }
    const territoryRoll = rng();
    const territory: TerritoryId =
      territoryRoll < 0.25 ? 'capital' : territoryRoll < 0.5 ? 'province_north' : territoryRoll < 0.75 ? 'province_south' : 'conquered_city';
    // เมืองยึดครอง = คนถูกยึดครองเป็นหลัก
    const identity: IdentityGroup =
      territory === 'conquered_city'
        ? (rng() < 0.8 ? 'conquered' : rng() < 0.5 ? 'minority' : 'majority')
        : (rng() < 0.7 ? 'majority' : 'minority');
    const religion: 'majority' | 'minority' = identity === 'majority' ? 'majority' : rng() < 0.7 ? 'minority' : 'majority';
    const incomeByClass: Record<SocialClass, [number, number]> = {
      ruling: [70, 100], economic: [65, 100], middle: [40, 80], working: [10, 50], marginalized: [0, 25],
    };
    const [lo, hi] = incomeByClass[cls];
    const income = lo + rng() * (hi - lo);
    const identityAlignment = identity === 'majority' ? 20 + rng() * 50 : identity === 'minority' ? -20 + rng() * 40 : -60 + rng() * 40;
    persons.push({
      id: i,
      name: `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]}`,
      cls,
      identity,
      religion,
      territory,
      income,
      satisfaction: 45 + rng() * 20,
      radicalization: 5 + rng() * 15,
      mobilization: 2 + rng() * 10,
      identityAlignment,
      trust: 40 + rng() * 30,
      grievances: 0,
      insurgency: false,
      age: 16 + Math.floor(rng() * 60),
    });
  }
  scenario.persons = persons;
}

export function defaultLevers(): GovSimLevers {
  return {
    taxRate: 20,
    budget: { military: 15, bureaucracy: 15, welfare: 20, infrastructure: 25, patronage: 10 },
    mediaControl: 30,
    policePatrols: 40,
    surveillance: 20,
    coercion: 1,
    minorityRights: 40,
    powerSharing: 20,
    culturalEducation: 20,
    subsidy: 30,
    buyOffElites: false,
    purge: false,
    assimilationStrategy: 'economic',
    foreignAppeasement: 30,
  };
}

export function createScenario(opts: { name?: string; population?: number; seed?: number } = {}): GovSimScenario {
  const seed = opts.seed ?? Math.floor(Math.random() * 2147483647);
  const rng = mulberry32(seed);
  const now = Date.now();
  const scenario: GovSimScenario = {
    id: makeId(),
    name: (opts.name || '').trim() || `อาณาจักร ${seed % 1000}`,
    createdAt: now,
    updatedAt: now,
    seed,
    tick: 0,
    year: 0,
    month: 1,
    status: 'unstable', // เริ่มจาก "เพิ่งยึดเมืองเสร็จ" — ไม่มีอะไรง่าย
    population: opts.population || DEFAULT_POPULATION,
    treasury: 1000,
    gdpIndex: 100,
    inflation: 3,
    gini: 55,
    scarcity: 45,
    asabiyyah: 55,
    legitimacy: { performance: 45, ideology: 40, procedural: 35, total: 41 },
    stateReach: 50,
    corruption: 45,
    judicialFairness: 40,
    coerciveForce: 30,
    suppressionRecord: 0,
    unrestRisk: 35,
    rebellionProbability: 0.25,
    insurgencyStrength: 0.08,
    mediaControl: 30,
    propagandaGap: 20,
    epistemicCollapse: false,
    counterNarrative: 30,
    foreignProxy: 20,
    sanctions: 10,
    sanctuary: 25,
    externalThreat: 20,
    friction: 65,
    collaboratorRatio: 0.2,
    pacification: 25,
    resistance: 70,
    assimilationStrategy: 'economic',
    levers: defaultLevers(),
    persons: [],
    events: [],
    lastTickEvents: [],
    history: [],
    narratives: [],
  };
  generatePersons(scenario, rng);
  saveScenario(scenario);
  return scenario;
}

export function listScenarios(): Array<Pick<GovSimScenario, 'id' | 'name' | 'tick' | 'status' | 'updatedAt' | 'population'>> {
  try {
    const fs = require('fs') as typeof import('fs');
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('govsim-') && f.endsWith('.json'))
      .map((f) => scenarioPath(f.replace(/^govsim-/, '').replace(/\.json$/, '')))
      .map((p) => readJsonVerified<GovSimScenario>(p).data)
      .filter((s): s is GovSimScenario => !!s)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        name: s.name,
        tick: s.tick,
        status: s.status,
        updatedAt: s.updatedAt,
        population: s.population,
      }));
  } catch {
    return [];
  }
}

export function loadScenario(id: string): GovSimScenario | null {
  const { data, rot } = readJsonVerified<GovSimScenario>(scenarioPath(id));
  if (rot) {
    console.warn(`GOVSIM: scenario ${id} checksum mismatch — ignore`);
    return null;
  }
  return data || null;
}

function saveScenario(s: GovSimScenario): void {
  s.updatedAt = Date.now();
  saveJsonAtomic(scenarioPath(s.id), s);
}

export function deleteScenario(id: string): boolean {
  try {
    const fs = require('fs') as typeof import('fs');
    const p = scenarioPath(id);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    fs.unlinkSync(`${p}.sha256`);
    return true;
  } catch {
    return false;
  }
}

function pushEvent(s: GovSimScenario, kind: string, severity: GovSimEvent['severity'], text: string): void {
  const evt: GovSimEvent = { tick: s.tick, year: s.year, month: s.month, kind, severity, text };
  s.events.push(evt);
  if (s.events.length > EVENTS_LIMIT) s.events.splice(0, s.events.length - EVENTS_LIMIT);
  s.lastTickEvents.push(evt);
}

function pushHistory(s: GovSimScenario): void {
  const rec: TickRecord = {
    tick: s.tick, year: s.year, month: s.month, status: s.status,
    treasury: rounded(s.treasury), gdpIndex: rounded(s.gdpIndex), inflation: rounded(s.inflation),
    gini: rounded(s.gini), scarcity: rounded(s.scarcity), asabiyyah: rounded(s.asabiyyah),
    legitimacyTotal: rounded(s.legitimacy.total), stateReach: rounded(s.stateReach),
    corruption: rounded(s.corruption), judicialFairness: rounded(s.judicialFairness),
    coerciveForce: rounded(s.coerciveForce), unrestRisk: rounded(s.unrestRisk),
    rebellionProbability: rounded(s.rebellionProbability), insurgencyStrength: rounded(s.insurgencyStrength),
    pacification: rounded(s.pacification), resistance: rounded(s.resistance),
    friction: rounded(s.friction), collaboratorRatio: rounded(s.collaboratorRatio),
    counterNarrative: rounded(s.counterNarrative),
  };
  s.history.push(rec);
  if (s.history.length > HISTORY_LIMIT) s.history.splice(0, s.history.length - HISTORY_LIMIT);
}

// ── MODULE 2: Political Economy ──
function updateEconomy(s: GovSimScenario, rng: () => number): void {
  const l = s.levers;
  const spendTotal = Math.max(10, l.budget.military + l.budget.bureaucracy + l.budget.welfare + l.budget.infrastructure + l.budget.patronage);
  const infraEffort = l.budget.infrastructure / spendTotal * 100;
  const welfareEffort = l.budget.welfare / spendTotal * 100;
  const patronageEffort = l.budget.patronage / spendTotal * 100;
  // รายได้: ภาษี × GDP — ภาษีสูงเกินไปกดการเติบโต
  const taxDrag = Math.max(0, (l.taxRate - 15) / 100);
  const sanctionDrag = s.sanctions / 250;
  const subsidyCost = l.subsidy / 200;
  let growth =
    0.06 - taxDrag - sanctionDrag - subsidyCost
    + infraEffort / 3000
    - (s.coerciveForce / 100) * 0.03
    - s.corruption / 3000;
  if (l.coercion >= 3) growth -= 0.015;
  if (s.epistemicCollapse) growth -= 0.01;
  // เหตุการณ์สุ่มทางเศรษฐกิจ
  const evt = rng();
  if (evt < 0.03) { growth += 0.04; pushEvent(s, 'economy', 'info', `💰 ฤดูกาลเก็บเกี่ยวดี — GDP โตเกินคาด (+4%)`); }
  else if (evt < 0.05) { growth -= 0.05; s.scarcity = clamp(s.scarcity + 12); pushEvent(s, 'economy', 'warning', `🌾 ภัยแล้ง — Scarcity +12`); }
  else if (evt < 0.065) { growth -= 0.02; s.inflation = clamp(s.inflation + 5); pushEvent(s, 'economy', 'warning', `📈 เงินเฟ้อพุ่ง (+5%) จากราคาพลังงานโลก`); }
  s.gdpIndex = Math.max(30, s.gdpIndex * (1 + growth / 12));
  const revenue = (l.taxRate / 100) * s.gdpIndex * 10;
  const spending = revenue * (spendTotal / 100);
  s.treasury = rounded(s.treasury + revenue - spending);
  if (s.treasury < 0 && s.treasury > -200) s.treasury = rounded(s.treasury);
  // Scarcity: welfare + subsidy ลด, sanctions เพิ่ม
  s.scarcity = clamp(s.scarcity * 0.92 + 8 - welfareEffort / 4 - l.subsidy / 3 - infraEffort / 6 + s.sanctions / 5);
  s.inflation = clamp(s.inflation * 0.9 + 1.5 + subsidyCost * 40 + (l.taxRate - 15) / 30 + s.sanctions / 40, 0, 200);
  // Gini: welfare ลดเหลื่อมล้ำ, patronage/ภาษีสูงเพิ่ม
  const giniDrift = 0.02 - welfareEffort / 4000 + patronageEffort / 2500 + (l.taxRate - 20) / 2000;
  s.gini = clamp(s.gini + giniDrift);
  if (l.subsidy > 60) s.gini = clamp(s.gini - 0.2);
}

// ── MODULE 3: Legitimacy ──
function updateLegitimacy(s: GovSimScenario): void {
  const l = s.levers;
  const securityOk = 100 - s.coerciveForce * 0.5 - s.unrestRisk * 0.4;
  const performance = clamp(
    s.gdpIndex / 2 + 30
    - s.scarcity * 0.35
    - s.inflation * 0.3
    - s.corruption * 0.25
    + securityOk * 0.15
    + s.judicialFairness * 0.2
  );
  const ideology = clamp(
    20
    + l.mediaControl * 0.25
    + l.culturalEducation * 0.25
    + (l.assimilationStrategy === 'direct' ? 5 : 0)
    + (s.epistemicCollapse ? -40 : 0)
    + (l.minorityRights > 50 ? 10 : 0)
  );
  const procedural = clamp(
    10
    + l.powerSharing * 0.4
    + s.judicialFairness * 0.35
    + (5 - l.coercion) * 4
    + (s.epistemicCollapse ? -15 : 0)
  );
  const total = clamp(performance * 0.45 + ideology * 0.25 + procedural * 0.3);
  s.legitimacy = { performance, ideology, procedural, total };
}

// ── MODULE 4: Institutional Capacity ──
function updateInstitutional(s: GovSimScenario): void {
  const l = s.levers;
  const spendTotal = Math.max(10, l.budget.military + l.budget.bureaucracy + l.budget.welfare + l.budget.infrastructure + l.budget.patronage);
  s.stateReach = clamp(
    25
    + (l.budget.bureaucracy / spendTotal) * 90
    + (l.budget.infrastructure / spendTotal) * 30
    + (l.budget.military / spendTotal) * 40
    - s.corruption * 0.25
  );
  const patronage = l.budget.patronage / spendTotal * 100;
  s.corruption = clamp(s.corruption * 0.95 + patronage / 60 + (l.buyOffElites ? 6 : 0) - s.judicialFairness / 120);
  s.judicialFairness = clamp(s.judicialFairness * 0.95 + 2 + l.powerSharing / 15 - s.corruption / 20 - (l.coercion >= 3 ? 3 : 0));
}

// ── MODULE 5: Security & Coercion (Suppression Paradox) ──
function updateSecurity(s: GovSimScenario): void {
  const l = s.levers;
  s.coerciveForce = clamp(
    l.policePatrols * 0.4
    + l.surveillance * 0.3
    + l.coercion * 12
    + (l.budget.military / Math.max(10, l.budget.military + l.budget.bureaucracy + l.budget.welfare + l.budget.infrastructure + l.budget.patronage)) * 30
  );
  // Purge — one-shot กด: ดับทันทีแต่แค้นฝังลึก
  if (l.purge) {
    s.suppressionRecord += 30;
    s.pacification = clamp(s.pacification - 15);
    s.resistance = clamp(s.resistance + 12);
    s.friction = clamp(s.friction + 10);
    s.legitimacy.total = clamp(s.legitimacy.total - 15);
    s.sanctions = clamp(s.sanctions + 25);
    s.foreignProxy = clamp(s.foreignProxy + 10);
    pushEvent(s, 'security', 'critical', `⚔️ รัฐกวาดล้าง (Purge) — กบฏตายจำนวนมาก แต่ความแค้นฝังลึก: Legitimacy -15, Resistance +12, ต่างชาติคว่ำบาตร +25`);
    l.purge = false;
  }
  if (l.buyOffElites) {
    s.friction = clamp(s.friction - 12);
    s.resistance = clamp(s.resistance - 10);
    s.collaboratorRatio = clamp(s.collaboratorRatio + 0.1);
    s.corruption = clamp(s.corruption + 4);
    pushEvent(s, 'integration', 'info', `💸 ซื้อใจผู้นำท้องถิ่น — Friction -12, Collaborator +10% แต่ Corruption +4 (Second-Order Effect)`);
    l.buyOffElites = false;
  }
}

// ── MODULE 6: Information & Ideology ──
function updateInformation(s: GovSimScenario): void {
  const l = s.levers;
  // ช่องว่างโฆษณาชวนเชื่อ: สื่อควบคุมกว้าง + ความจริง (ศาลยุติธรรม/คอร์รัปชัน) ไม่ดี = gap กว้าง
  const realitySignals = 50 + s.judicialFairness * 0.3 - s.corruption * 0.3 - s.scarcity * 0.2;
  s.propagandaGap = clamp(l.mediaControl - realitySignals + s.foreignProxy * 0.1);
  const wasCollapsed = s.epistemicCollapse;
  s.epistemicCollapse = s.propagandaGap > 55;
  if (s.epistemicCollapse && !wasCollapsed) {
    pushEvent(s, 'information', 'critical', `📢 Epistemic Collapse! — ประชาชนเลิกเชื่อรัฐทุกเรื่อง (ช่องว่างโฆษณาชวนเชื่อ vs ความจริง ${Math.round(s.propagandaGap)}) — Counter-narrative ลาม`);
  }
  s.counterNarrative = clamp(
    s.counterNarrative * 0.92
    + s.propagandaGap * 0.3
    + s.foreignProxy * 0.2
    + s.sanctuary * 0.15
    - l.mediaControl * 0.12
  );
}

// ── MODULE 7: Foreign Intervention ──
function updateForeign(s: GovSimScenario, rng: () => number): void {
  const l = s.levers;
  s.foreignProxy = clamp(s.foreignProxy * 0.94 + (s.sanctions > 30 ? 2 : 0) + (l.coercion >= 3 ? 1.5 : 0) - l.foreignAppeasement * 0.08);
  s.sanctions = clamp(s.sanctions * 0.93 + (s.suppressionRecord > 50 ? 1.5 : 0) + (l.coercion >= 4 ? 3 : 0) - l.powerSharing * 0.05 - l.minorityRights * 0.05);
  s.sanctuary = clamp(s.sanctuary * 0.95 + s.resistance * 0.08 - s.pacification * 0.06);
  s.externalThreat = clamp(s.externalThreat * 0.9 + (rng() < 0.06 ? 25 : 0) - l.foreignAppeasement * 0.05);
  if (s.externalThreat > 45 && rng() < 0.4) {
    pushEvent(s, 'foreign', 'warning', `🌍 มหาอำนาจข่มขู่ชายแดน — External Threat ${Math.round(s.externalThreat)} (ช่วยหลอมรวม Asabiyyah แต่กดดันความมั่นคง)`);
  }
}

// ── MODULE 8: Post-Conquest Integration ──
function updateIntegration(s: GovSimScenario): void {
  const l = s.levers;
  const spendTotal = Math.max(10, l.budget.military + l.budget.bureaucracy + l.budget.welfare + l.budget.infrastructure + l.budget.patronage);
  const localServices = clamp(
    (l.budget.welfare / spendTotal) * 80
    + (l.budget.infrastructure / spendTotal) * 60
    + l.subsidy * 0.4
    + l.minorityRights * 0.3
  );
  const basicNeeds = clamp(30 + s.scarcity);
  // กฎเหล็ก: ความต้านทานลดด้วย "บริการ/คุณภาพชีวิต" ไม่ใช่ "จำนวนทหาร"
  const servicesRatio = clamp(localServices / Math.max(30, basicNeeds), 0, 1.5);
  const atrocities = s.suppressionRecord / 120;
  s.resistance = clamp(s.resistance * (1 - servicesRatio * 0.14) + atrocities * 0.5 - l.powerSharing * 0.02);
  // Friction: วัฒนธรรม/กลยุทธ์การกลืนกลาย
  const frictionDrift =
    (l.assimilationStrategy === 'direct' ? 0.8 : l.assimilationStrategy === 'indirect' ? -0.6 : -0.9)
    - l.culturalEducation * 0.04
    - l.minorityRights * 0.03
    + s.suppressionRecord * 0.02;
  s.friction = clamp(s.friction + frictionDrift);
  if (l.assimilationStrategy === 'direct') s.friction = clamp(s.friction + 0.4);
  // Collaborator: indirect/economic ซื้อใจคนท้องถิ่น
  const collabDrift = (l.assimilationStrategy === 'indirect' ? 0.04 : l.assimilationStrategy === 'economic' ? 0.02 : -0.02) - s.resistance * 0.0008;
  s.collaboratorRatio = clamp(s.collaboratorRatio + collabDrift, 0, 1);
  s.pacification = clamp(s.pacification + (100 - s.resistance) * 0.02 + s.collaboratorRatio * 2 - s.friction * 0.05);
}

// ── Per-Person Update (ระดับบุคคล) ──
function updatePersons(s: GovSimScenario, rng: () => number): void {
  const l = s.levers;
  const perf = s.legitimacy.total;
  const coercive = s.coerciveForce / 100;
  const classBenefit: Record<SocialClass, number> = {
    ruling: 0.15, economic: 0.1, middle: 0, working: -0.1, marginalized: -0.25,
  };
  const welfare = (l.budget.welfare / Math.max(10, l.budget.military + l.budget.bureaucracy + l.budget.welfare + l.budget.infrastructure + l.budget.patronage)) * 100;
  let radicalizedCount = 0;
  let mobilizedCount = 0;
  let insurgentCount = 0;

  for (const p of s.persons) {
    // Satisfaction: ปากท้อง + ชนชั้น + ความยุติธรรม + สิทธิชนกลุ่มน้อย + เชื่อถือรัฐ
    const scarcityHit = (s.scarcity / 100) * (p.cls === 'working' || p.cls === 'marginalized' ? 0.7 : 0.3);
    const welfareHit = p.cls === 'working' || p.cls === 'marginalized' ? welfare * 0.08 + l.subsidy * 0.05 : welfare * 0.02;
    const identityHit =
      p.identity === 'conquered' ? l.minorityRights * 0.08 + (l.assimilationStrategy === 'direct' ? -12 : 0) :
      p.identity === 'minority' ? l.minorityRights * 0.05 : 0;
    const justiceHit = (s.judicialFairness - 40) * 0.15;
    const epistemicHit = s.epistemicCollapse ? -12 : 0;
    p.satisfaction = clamp(p.satisfaction * 0.93 + 5 + classBenefit[p.cls] * 30 - scarcityHit + welfareHit + identityHit + justiceHit + epistemicHit + (perf - 50) * 0.08);
    if (p.territory === 'conquered_city') p.satisfaction = clamp(p.satisfaction - (s.friction - 30) * 0.08);

    // Radicalization: ความเหลื่อมล้ำ + ถูกปราบ + ช่องว่างโฆษณา + ไร้สิทธิ
    const inequalityHit = (s.gini - 40) * (p.cls === 'working' || p.cls === 'marginalized' ? 0.14 : 0.04);
    const scarcityHitRad = (s.scarcity - 40) * (p.cls === 'working' || p.cls === 'marginalized' ? 0.05 : 0.01);
    const suppressionHit = s.suppressionRecord * (p.cls === 'marginalized' || p.identity === 'conquered' ? 0.07 : 0.03);
    const gapHit = s.propagandaGap * 0.05;
    const grievanceHit = p.grievances * 0.02;
    p.radicalization = clamp(p.radicalization * 0.95 + inequalityHit + scarcityHitRad + suppressionHit + gapHit + grievanceHit + (40 - p.identityAlignment) * 0.015 + (p.identity === 'conquered' ? 0.8 : 0));
    p.grievances = clamp(p.grievances * 0.98 + (55 - p.satisfaction) * 0.08);

    // Identity Alignment: สิทธิ/การศึกษา/กลยุทธ์การกลืนกลาย
    const alignDrift =
      (p.identity === 'conquered' ? -0.2 : p.identity === 'minority' ? -0.05 : 0.2)
      + l.minorityRights * 0.03
      + l.culturalEducation * 0.025
      + (l.assimilationStrategy === 'direct' && p.identity === 'conquered' ? -0.8 : 0)
      + (s.suppressionRecord > 40 ? -0.3 : 0);
    p.identityAlignment = clamp(p.identityAlignment + alignDrift, -100, 100);

    // Trust (Epistemic): gap กว้าง → ไม่เชื่อรัฐ
    p.trust = clamp(p.trust * 0.95 + (s.epistemicCollapse ? -8 : 4) - s.propagandaGap * 0.06 + s.judicialFairness * 0.03);

    // Mobilization: radicalization + กลุ่มร่วม + ปากท้อง − แรงกดดัน (Suppression Paradox — ระยะสั้น)
    const groupPull = (p.identity === 'conquered' ? s.counterNarrative * 0.05 : 0) + s.foreignProxy * 0.03 + s.sanctuary * 0.02;
    p.mobilization = clamp(p.mobilization * 0.9 + p.radicalization * 0.25 + groupPull + (50 - p.satisfaction) * 0.2 - coercive * 40);
    if (p.mobilization > 70) mobilizedCount++;
    if (p.radicalization > 65) radicalizedCount++;

    // Insurgency: เข้าร่วมขบวนการ
    const joinP = sigmoid((p.radicalization - 55) / 15 + (p.identity === 'conquered' ? 0.6 : 0) - (p.territory === 'conquered_city' ? 0 : 0.4) - p.satisfaction / 80) * 0.12 * (1 - s.collaboratorRatio * 0.5);
    if (!p.insurgency && rng() < joinP && p.radicalization > 50) {
      p.insurgency = true;
    }
    if (p.insurgency) insurgentCount++;
    // กบฏที่พึงพอใจขึ้น/ถูกปราบหนัก → บางส่วนวางอาวุธ
    if (p.insurgency && (p.satisfaction > 65 || rng() < s.pacification * 0.004)) {
      p.insurgency = false;
    }
  }
  s.insurgencyStrength = clamp(insurgentCount / s.persons.length, 0, 1);
  const avgRad = s.persons.reduce((a, p) => a + p.radicalization, 0) / s.persons.length;
  const avgMob = s.persons.reduce((a, p) => a + p.mobilization, 0) / s.persons.length;
  const mobShare = mobilizedCount / Math.max(1, s.persons.length);
  const radShare = radicalizedCount / Math.max(1, s.persons.length);
  // Unrest Risk + Rebellion Probability (สมการพิมพ์เขียว)
  const unrest = clamp(
    avgRad * 0.35
    + avgMob * 0.25
    + radShare * 20
    + mobShare * 25
    + (s.gini / 100) * 15
    + (s.scarcity / 100) * 15
    - s.legitimacy.total * 0.3
  );
  s.unrestRisk = clamp(s.unrestRisk * 0.85 + unrest * 0.3);
  const pReb = sigmoid(
    1.5 * ((s.gini / 100) * (s.unrestRisk / 100)) / (perf + 5)
    + 1.2 * (s.scarcity / 100)
    - 1.0 * coercive
  );
  s.rebellionProbability = pReb;
}

// ── Asabiyyah (สมการ Ibn Khaldun) ──
function updateAsabiyyah(s: GovSimScenario): void {
  const wealthSoftening = (s.gdpIndex - 100) / 400; // สุขสบาย → อ่อนแอ
  const inequalityErosion = (s.gini - 40) / 200;
  const unityBonus = s.externalThreat / 300; // วิกฤตภายนอกหลอมรวม
  const integrationWin = s.pacification > 60 ? (s.pacification - 60) / 200 : 0;
  s.asabiyyah = clamp(s.asabiyyah + unityBonus - inequalityErosion - wealthSoftening + integrationWin);
}

function detectStatus(s: GovSimScenario): void {
  const prev = s.status;
  const conqueredSatisfaction = avgSatisfactionOf(s, (p) => p.identity === 'conquered');
  if (s.pacification >= 88 && s.friction <= 15 && conqueredSatisfaction >= 62) {
    s.status = 'integrated';
  } else if (s.legitimacy.total < 10 || (s.treasury < -150 && s.unrestRisk > 60)) {
    s.status = 'collapsed';
  } else if (s.insurgencyStrength > 0.3 || s.rebellionProbability > 0.72) {
    s.status = 'civil_war';
  } else if (s.unrestRisk > 55 || s.rebellionProbability > 0.4) {
    s.status = 'unstable';
  } else {
    s.status = 'stable';
  }
  if (s.status !== prev) {
    const msg: Record<GovSimStatus, [string, GovSimEvent['severity']]> = {
      stable: ['🕊️ รัฐเข้าสู่เสถียรภาพ — ประชาชนส่วนใหญ่พึงพอใจ', 'success'],
      unstable: ['⚠️ รัฐสั่นคลอน — ความไม่พอใจและกระแสต่อต้านเพิ่มขึ้น', 'warning'],
      civil_war: ['💥 สงครามกลางเมือง! — กลุ่มกบฏลุกขึ้นสู้เต็มรูปแบบ', 'critical'],
      collapsed: ['🏚️ รัฐล่มสลาย — ความชอบธรรมว่างเปล่า ไม่มีใครเชื่อรัฐอีกต่อไป', 'critical'],
      integrated: ['🤝 กลืนกลายสำเร็จ — อดีตศัตรูกลายเป็นพลเมืองเดียวกัน (ยึดเมืองแล้วอยู่ร่วมกันได้)', 'success'],
    };
    pushEvent(s, 'status', msg[s.status][1], msg[s.status][0]);
    securityStream.push('GOVSIM', { scenario: s.id, action: 'status', status: s.status, tick: s.tick, text: msg[s.status][0] });
  }
}

function avgSatisfactionOf(s: GovSimScenario, filter: (p: Person) => boolean): number {
  let sum = 0, n = 0;
  for (const p of s.persons) {
    if (filter(p)) { sum += p.satisfaction; n++; }
  }
  return n ? sum / n : 0;
}

export interface FactionAggregate {
  cls: SocialClass;
  label: string;
  count: number;
  satisfaction: number;
  radicalization: number;
  mobilization: number;
  identityAlignment: number;
}

export interface TerritoryAggregate {
  id: TerritoryId;
  label: string;
  population: number;
  tension: number; // 0..100
  satisfaction: number;
  insurgency: number;
}

export function factionAggregates(s: GovSimScenario): FactionAggregate[] {
  return SOCIAL_CLASSES.map((cls) => {
    const members = s.persons.filter((p) => p.cls === cls);
    const avg = (fn: (p: Person) => number) => members.length ? members.reduce((a, p) => a + fn(p), 0) / members.length : 0;
    return {
      cls,
      label: CLASS_LABEL[cls],
      count: members.length,
      satisfaction: Math.round(avg((p) => p.satisfaction)),
      radicalization: Math.round(avg((p) => p.radicalization)),
      mobilization: Math.round(avg((p) => p.mobilization)),
      identityAlignment: Math.round(avg((p) => p.identityAlignment)),
    };
  });
}

export function territoryAggregates(s: GovSimScenario): TerritoryAggregate[] {
  return TERRITORIES.map((id) => {
    const members = s.persons.filter((p) => p.territory === id);
    const avg = (fn: (p: Person) => boolean) => members.length ? members.filter(fn).length / members.length : 0;
    const tension = Math.round(
      avg((p) => p.radicalization > 60) * 70
      + avg((p) => p.mobilization > 60) * 30
      + avg((p) => p.insurgency) * 50
    );
    return {
      id,
      label: TERRITORY_LABEL[id],
      population: members.length,
      tension: Math.min(100, tension),
      satisfaction: Math.round(members.reduce((a, p) => a + p.satisfaction, 0) / Math.max(1, members.length)),
      insurgency: Math.round(avg((p) => p.insurgency) * 100),
    };
  });
}

export function tickScenario(id: string, steps = 1, autoStatus = true): { scenario: GovSimScenario; ok: boolean; error?: string } {
  const s = loadScenario(id);
  if (!s) return { scenario: null as any, ok: false, error: 'scenario not found' };
  if (s.status === 'collapsed' || s.status === 'integrated') {
    return { scenario: s, ok: true, error: 'simulation_ended' };
  }
  const rng = mulberry32(s.seed + s.tick * 7919);
  const maxSteps = Math.min(Math.max(steps, 1), 120);
  for (let i = 0; i < maxSteps; i++) {
    s.lastTickEvents = [];
    s.month += 1;
    if (s.month > 12) { s.month = 1; s.year += 1; }
    updateEconomy(s, rng);
    updateLegitimacy(s);
    updateInstitutional(s);
    updateSecurity(s);
    updateInformation(s);
    updateForeign(s, rng);
    updateIntegration(s);
    updatePersons(s, rng);
    updateAsabiyyah(s);
    if (autoStatus) detectStatus(s);
    pushHistory(s);
    if ((s.status as GovSimStatus) === 'collapsed' || (s.status as GovSimStatus) === 'integrated') { s.tick += 1; break; }
    s.tick += 1;
  }
  saveScenario(s);
  if (s.lastTickEvents.length) {
    securityStream.push('GOVSIM', { scenario: s.id, action: 'tick', tick: s.tick, events: s.lastTickEvents.map((e) => e.text) });
  }
  return { scenario: s, ok: true };
}

export function applyLevers(id: string, levers: Partial<GovSimLevers>): { scenario: GovSimScenario; ok: boolean; error?: string } {
  const s = loadScenario(id);
  if (!s) return { scenario: null as any, ok: false, error: 'scenario not found' };
  const merged: GovSimLevers = { ...s.levers, ...levers };
  merged.taxRate = clamp(Math.round(merged.taxRate), 0, 50);
  merged.mediaControl = clamp(Math.round(merged.mediaControl));
  merged.policePatrols = clamp(Math.round(merged.policePatrols));
  merged.surveillance = clamp(Math.round(merged.surveillance));
  merged.minorityRights = clamp(Math.round(merged.minorityRights));
  merged.powerSharing = clamp(Math.round(merged.powerSharing));
  merged.culturalEducation = clamp(Math.round(merged.culturalEducation));
  merged.subsidy = clamp(Math.round(merged.subsidy));
  merged.foreignAppeasement = clamp(Math.round(merged.foreignAppeasement));
  for (const k of ['military', 'bureaucracy', 'welfare', 'infrastructure', 'patronage'] as const) {
    merged.budget[k] = clamp(Math.round(merged.budget[k]));
  }
  if (merged.coercion < 0 || merged.coercion > 4) merged.coercion = s.levers.coercion;
  merged.buyOffElites = !!merged.buyOffElites;
  merged.purge = !!merged.purge;
  if (!['direct', 'indirect', 'economic'].includes(merged.assimilationStrategy)) merged.assimilationStrategy = s.levers.assimilationStrategy;
  s.levers = merged;
  saveScenario(s);
  return { scenario: s, ok: true };
}

export function addNarrative(id: string, entry: { kind: string; title: string; text: string; source: string }): boolean {
  const s = loadScenario(id);
  if (!s) return false;
  const kind = (['newspaper', 'threat_letter', 'analysis'] as const).includes(entry.kind as any)
    ? (entry.kind as NarrativeKind)
    : 'analysis';
  s.narratives.push({ kind, title: entry.title, text: entry.text, source: entry.source, at: Date.now() });
  if (s.narratives.length > 50) s.narratives.splice(0, s.narratives.length - 50);
  saveScenario(s);
  return true;
}

export function govsimSnapshot(id: string) {
  const s = loadScenario(id);
  return s ? getView(s) : null;
}

export function getView(s: GovSimScenario) {
  return {
    id: s.id,
    name: s.name,
    seed: s.seed,
    tick: s.tick,
    year: s.year,
    month: s.month,
    status: s.status,
    population: s.population,
    treasury: s.treasury,
    gdpIndex: rounded(s.gdpIndex),
    inflation: rounded(s.inflation),
    gini: rounded(s.gini),
    scarcity: rounded(s.scarcity),
    asabiyyah: rounded(s.asabiyyah),
    legitimacy: { ...s.legitimacy, total: rounded(s.legitimacy.total) },
    stateReach: rounded(s.stateReach),
    corruption: rounded(s.corruption),
    judicialFairness: rounded(s.judicialFairness),
    coerciveForce: rounded(s.coerciveForce),
    suppressionRecord: Math.round(s.suppressionRecord),
    unrestRisk: rounded(s.unrestRisk),
    rebellionProbability: rounded(s.rebellionProbability),
    insurgencyStrength: rounded(s.insurgencyStrength),
    mediaControl: rounded(s.mediaControl),
    propagandaGap: rounded(s.propagandaGap),
    epistemicCollapse: s.epistemicCollapse,
    counterNarrative: rounded(s.counterNarrative),
    foreignProxy: rounded(s.foreignProxy),
    sanctions: rounded(s.sanctions),
    sanctuary: rounded(s.sanctuary),
    externalThreat: rounded(s.externalThreat),
    friction: rounded(s.friction),
    collaboratorRatio: rounded(s.collaboratorRatio),
    pacification: rounded(s.pacification),
    resistance: rounded(s.resistance),
    assimilationStrategy: s.assimilationStrategy,
    levers: s.levers,
    factions: factionAggregates(s),
    territories: territoryAggregates(s),
    persons: {
      count: s.persons.length,
      insurgents: Math.round(s.insurgencyStrength * s.persons.length),
      sample: s.persons.slice(0, 40).map((p) => ({
        name: p.name, cls: p.cls, identity: p.identity, territory: p.territory,
        satisfaction: Math.round(p.satisfaction), radicalization: Math.round(p.radicalization),
        mobilization: Math.round(p.mobilization), insurgency: p.insurgency,
      })),
    },
    events: s.events.slice(-40).reverse(),
    history: s.history,
    narratives: s.narratives.slice(-20).reverse(),
    updatedAt: s.updatedAt,
  };
}
