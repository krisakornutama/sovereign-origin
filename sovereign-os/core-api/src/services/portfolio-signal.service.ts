// src/services/portfolio-signal.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// AI Portfolio Manager — Small-Cap signal engine (Dime! portfolio)
// กฎผู้ใช้กำหนดเอง (ไม่ใช่คำแนะนำการลงทุน):
//  Rule 1 Catalyst Rotation — RDW/LUNR ชนเป้า → แจ้งโยกกำไรเข้า ASPI/POET โซน Buy Dip
//  Rule 2 Trailing Stop — บวกเกิน +50% → ล็อกทุนที่ peak×(1-pct) กันกำไรกลายเป็นขาดทุน
//  Rule 3 No Daily Over-trading — สัญญาณซ้ำในวันเดียวกันถูก dedup (eventKey มีวันที่)
// State เก็บใน SystemSetting (key 'portfolio.triggers' / 'portfolio.state') — ไม่ต้อง migrate
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';
import { fetchPrice } from './price-feed.service';
import { sendTelegramAlert } from './telegram-alert.service';

// ── โครงสร้างกฎต่อตัวหุ้น ──
export type TickerRole = 'CORE' | 'SATELLITE' | 'MOONSHOT';

export interface SellLevel {
  min: number; // ราคาต่ำสุดของโซนขาย (USD)
  max: number; // ราคาสูงสุดของโซน
  sellPct: number; // % ของจำนวนหุ้นที่ขายออก (0-100)
}

export interface PortfolioTriggerDef {
  symbol: string; // เช่น 'ASPI'
  role: TickerRole; // CORE = ถือหนัก, SATELLITE = หมุนเงิน, MOONSHOT = ถือยาว
  weightTargetMin: number; // % น้ำหนักเป้าหมายต่ำสุด
  weightTargetMax: number;
  buyDipMin: number | null; // โซนรับซื้อ (null = ห้ามซื้อเพิ่ม)
  buyDipMax: number | null;
  sellLevels: SellLevel[];
  noNewMoney: boolean; // true = ห้ามเติมเงินใหม่ (รอเก็บกำไรอย่างเดียว)
  trailingStopPct: number; // % ห่างจาก peak (0 = ปิด trailing)
  enabled: boolean;
}

export interface TickerState {
  peakPrice: number | null; // ราคาสูงสุดตั้งแต่ถือ (สำหรับ trailing)
  trailingArmed: boolean; // true เมื่อบวกเกิน armThreshold
  l1Done: boolean; // ขาย Level 1 แล้ว
  l2Done: boolean; // ขาย Level 2 แล้ว
  lastAlertDate?: string; // YYYY-MM-DD ล่าสุดที่ส่งสัญญาณ (Rule 3)
}

// ── กฎเริ่มต้นตามสเปกเจ้าของพอร์ต ──
export const DEFAULT_TRIGGERS: PortfolioTriggerDef[] = [
  {
    symbol: 'ASPI', role: 'CORE', weightTargetMin: 40, weightTargetMax: 50,
    buyDipMin: 3.50, buyDipMax: 4.00,
    sellLevels: [
      { min: 6.50, max: 8.00, sellPct: 25 },   // Level 1
      { min: 12.00, max: 13.50, sellPct: 30 }, // Level 2
    ],
    noNewMoney: false, trailingStopPct: 20, enabled: true,
  },
  {
    symbol: 'POET', role: 'CORE', weightTargetMin: 20, weightTargetMax: 30,
    buyDipMin: 6.00, buyDipMax: 7.50,
    sellLevels: [{ min: 12.00, max: 15.00, sellPct: 30 }],
    noNewMoney: false, trailingStopPct: 20, enabled: true,
  },
  {
    symbol: 'EOSE', role: 'CORE', weightTargetMin: 10, weightTargetMax: 15,
    buyDipMin: 2.00, buyDipMax: 2.50,
    sellLevels: [{ min: 5.00, max: 6.50, sellPct: 50 }],
    noNewMoney: false, trailingStopPct: 20, enabled: true,
  },
  {
    symbol: 'RDW', role: 'SATELLITE', weightTargetMin: 0, weightTargetMax: 15,
    buyDipMin: null, buyDipMax: null, // ห้ามเติมเงินใหม่
    sellLevels: [{ min: 14.80, max: 15.50, sellPct: 100 }], // ขาย 50-100% โยกเข้า ASPI/POET
    noNewMoney: true, trailingStopPct: 20, enabled: true,
  },
  {
    symbol: 'LUNR', role: 'SATELLITE', weightTargetMin: 0, weightTargetMax: 15,
    buyDipMin: null, buyDipMax: null,
    sellLevels: [{ min: 25.00, max: 27.00, sellPct: 100 }],
    noNewMoney: true, trailingStopPct: 20, enabled: true,
  },
  {
    symbol: 'SPCX', role: 'MOONSHOT', weightTargetMin: 0, weightTargetMax: 10,
    buyDipMin: null, buyDipMax: null,
    sellLevels: [], // ถือยาว ไม่เล่นรอบสั้น
    noNewMoney: false, trailingStopPct: 0, enabled: true,
  },
];

// ตัวหุ้นปลายทางของ Rule 1 (Catalyst Rotation)
export const ROTATION_TARGETS = ['ASPI', 'POET'];

const ARM_GAIN_PCT = 50; // Rule 2: บวกเกิน +50% → arm trailing stop
const TRIGGERS_KEY = 'portfolio.triggers';
const STATE_KEY = 'portfolio.state';
const USD_THB = 35; // อัตราอ้างอิงเดียวกับ treasury

// ── Storage helpers (SystemSetting JSON) ──
async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row?.value) return fallback;
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
}

export async function getTriggers(): Promise<PortfolioTriggerDef[]> {
  return readJson<PortfolioTriggerDef[]>(TRIGGERS_KEY, DEFAULT_TRIGGERS);
}
export async function saveTriggers(triggers: PortfolioTriggerDef[]): Promise<void> {
  await writeJson(TRIGGERS_KEY, triggers);
}
export async function getState(): Promise<Record<string, TickerState>> {
  return readJson<Record<string, TickerState>>(STATE_KEY, {});
}
export async function saveState(state: Record<string, TickerState>): Promise<void> {
  await writeJson(STATE_KEY, state);
}

// ═════════════════════════════════════════════════════════════
// Pure functions — testable ไม่แตะ DB/เน็ต
// ═════════════════════════════════════════════════════════════

export type SignalAction = 'BUY_DIP' | 'SELL_L1' | 'SELL_L2' | 'TRAILING_STOP' | 'NONE';

export interface SignalResult {
  action: SignalAction;
  symbol: string;
  priceUsd: number;
  priceTHB: number;
  /** ข้อความสั้นสำหรับ Telegram (format [PORTFOLIO ALERT]) */
  message: string;
  /** true = ควรแจ้งเตือน (action ไม่ใช่ NONE) */
  alert: boolean;
}

/** ตรวจราคาเทียบกฎตัวเดียว — pure (state ผ่าน parameter, คืน state ใหม่กลับไป) */
export function evaluateTrigger(
  trigger: PortfolioTriggerDef,
  price: number,
  state: TickerState
): { signal: SignalResult; nextState: TickerState } {
  const priceTHB = Math.round(price * USD_THB * 100) / 100;
  const base = { symbol: trigger.symbol, priceUsd: price, priceTHB };
  const next: TickerState = { ...state };
  const today = new Date().toISOString().slice(0, 10);
  next.lastAlertDate = today;

  if (!trigger.enabled || price <= 0) {
    return { signal: { action: 'NONE', ...base, message: '', alert: false }, nextState: next };
  }

  // Rule 2: Trailing Stop — arm เมื่อ peak สูงกว่าราคาอ้างอิง +50%
  // (ใช้ buyDipMax เป็นราคาอ้างอิงทุนถ้ามี, ไม่มี → ใช้ราคาแรกที่เห็น)
  const costRef = trigger.buyDipMax ?? state.peakPrice ?? price;
  next.peakPrice = Math.max(state.peakPrice ?? price, price);
  if (!next.trailingArmed && costRef > 0 && (next.peakPrice / costRef - 1) * 100 >= ARM_GAIN_PCT) {
    next.trailingArmed = true;
  }
  if (next.trailingArmed && trigger.trailingStopPct > 0) {
    const stop = next.peakPrice * (1 - trigger.trailingStopPct / 100);
    if (price <= stop) {
      return {
        signal: {
          action: 'TRAILING_STOP', ...base, alert: true,
          message: `🔒 Rule 2 TRAILING STOP — ${trigger.symbol} ราคา $${price.toFixed(2)} (฿${priceTHB.toLocaleString()}) หลุดจาก peak $${next.peakPrice.toFixed(2)} −${trigger.trailingStopPct}% → ขายล็อกกำไรทันที (ห้ามปล่อยให้กำไรกลายเป็นขาดทุน)`,
        },
        nextState: next,
      };
    }
  }

  // Sell Levels (L1 ก่อน L2, ทำครั้งเดียวต่อรอบ)
  for (let i = 0; i < trigger.sellLevels.length; i++) {
    const lvl = trigger.sellLevels[i];
    const doneKey = i === 0 ? 'l1Done' : 'l2Done';
    if (next[doneKey]) continue;
    if (price >= lvl.min && price <= lvl.max) {
      next[doneKey] = true;
      const label = i === 0 ? 'SELL LEVEL 1' : 'SELL LEVEL 2';
      const rotation =
        trigger.role === 'SATELLITE'
          ? ` → 🔄 Rule 1: โยกกำไร ${lvl.sellPct}% เข้า ${ROTATION_TARGETS.join('/')} โซน Buy Dip`
          : '';
      return {
        signal: {
          action: i === 0 ? 'SELL_L1' : 'SELL_L2', ...base, alert: true,
          message: `💰 ${label} — ${trigger.symbol} แตะ $${price.toFixed(2)} (฿${priceTHB.toLocaleString()}) อยู่ในโซน $${lvl.min}-$${lvl.max} → ขายออก ${lvl.sellPct}% ของจำนวน${rotation}`,
        },
        nextState: next,
      };
    }
  }

  // Buy Dip (เฉพาะตัวที่เปิดรับซื้อ)
  if (!trigger.noNewMoney && trigger.buyDipMin != null && trigger.buyDipMax != null) {
    if (price >= trigger.buyDipMin && price <= trigger.buyDipMax) {
      return {
        signal: {
          action: 'BUY_DIP', ...base, alert: true,
          message: `🟢 BUY DIP — ${trigger.symbol} ราคา $${price.toFixed(2)} (฿${priceTHB.toLocaleString()}) เข้าโซนรับซื้อ $${trigger.buyDipMin}-$${trigger.buyDipMax} (น้ำหนักเป้า ${trigger.weightTargetMin}-${trigger.weightTargetMax}%)`,
        },
        nextState: next,
      };
    }
  }

  return { signal: { action: 'NONE', ...base, message: '', alert: false }, nextState: next };
}

/** จัดรูปแบบ [PORTFOLIO ALERT] ตามสเปกเจ้าของพอร์ต */
export function formatPortfolioAlert(sig: SignalResult): string {
  return [
    '[PORTFOLIO ALERT]',
    `• Ticker: ${sig.symbol}`,
    `• Target Price: $${sig.priceUsd.toFixed(2)} (฿${sig.priceTHB.toLocaleString()})`,
    `• Action: ${sig.action}`,
    `• เหตุผล: ${sig.message.replace(/^\S+\s/, '')}`,
  ].join('\n');
}

// ═════════════════════════════════════════════════════════════
// Service — รอบตรวจจริง (cron เรียก)
// ═════════════════════════════════════════════════════════════

export interface CheckReport {
  ranAt: string;
  checked: number;
  alerts: SignalResult[];
  errors: string[];
}

/** รันตรวจทุกตัว — ดึงราคาจริง, เทียบกฎ, ส่ง Telegram (dedup ต่อวันต่อ action ผ่าน eventKey) */
export async function runSignalCheck(): Promise<CheckReport> {
  const triggers = (await getTriggers()).filter((t) => t.enabled);
  const state = await getState();
  const report: CheckReport = { ranAt: new Date().toISOString(), checked: 0, alerts: [], errors: [] };

  for (const trigger of triggers) {
    try {
      const quote = await fetchPrice(trigger.symbol, 'STOCK');
      if (!quote) continue; // ดึงราคาไม่ได้ (offline/SPCX ไม่มี ticker จริง) — ข้ามเงียบ
      report.checked++;
      const { signal, nextState } = evaluateTrigger(trigger, quote.priceUsd, state[trigger.symbol] ?? {});
      state[trigger.symbol] = nextState;
      if (!signal.alert) continue;

      // Rule 3: สัญญาณเดิมในวันเดียวกันไม่ส่งซ้ำ (ยกเว้น TRAILING_STOP = critical ข้าม dedup ได้)
      const sev = signal.action === 'TRAILING_STOP' ? 'critical' : 'warn';
      await sendTelegramAlert({
        text: formatPortfolioAlert(signal),
        severity: sev,
        eventKey: `portfolio:${signal.symbol}:${signal.action}:${signal.message.slice(0, 60)}:${new Date().toISOString().slice(0, 10)}`,
      });
      report.alerts.push(signal);
    } catch (err) {
      report.errors.push(`${trigger.symbol}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await saveState(state);
  return report;
}
