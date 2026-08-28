// src/services/aladdin-risk.service.ts
//
// Risk Engine สไตล์ BlackRock Aladdin — ใช้ข้อมูลราคาอดีตทำนายอนาคต:
//   - วิเคราะห์รายตัว: แนวโน้ม, โมเมนตัม, RSI, support/resistance, สัญญาณซื้อ/ขาย
//   - Monte Carlo จำลองพอร์ต: P10/P50/P90, โอกาสขาดทุน
//   - ความเสี่ยงพอร์ต: VaR95, ความเข้มข้น (HHI), drawdown
//   - สิ่งที่ต้องทำ: รายการคำสั่งไทย อ่านแล้วทำตามได้ทันที

export interface PricePoint {
  time: string;
  price: number;
}

export interface AssetRiskInput {
  symbol: string;
  type: 'CRYPTO' | 'STOCK' | 'COMMODITY';
  history: PricePoint[];
  valueUsd?: number; // มูลค่าปัจจุบันในพอร์ต (ถ้ามี)
}

export interface AssetRisk {
  symbol: string;
  type: string;
  current: number;
  return30dPct: number;
  volatility: number; // annualized (std ของ daily return × √252)
  trend: 'rising' | 'falling' | 'flat';
  momentum: 'strong' | 'moderate' | 'weak';
  rsi: number;
  support: number;
  resistance: number;
  signal: 'BUY' | 'HOLD' | 'REDUCE' | 'SELL';
  signalStrength: number; // 0-1
  reasoning: string;
  actions: string[];
}

// PRNG กำหนดเอง (mulberry32) — seed เดียวกันได้ผลเหมือนเดิม (เทสต์ได้)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** สมการเส้นตรง (linear regression) → slope */
function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den === 0 ? 0 : num / den;
}

export function rsi14(prices: number[]): number {
  if (prices.length < 15) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= 14; i++) {
    const d = prices[prices.length - i] - prices[prices.length - 1 - i];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** วิเคราะห์ความเสี่ยงรายตัว — ใช้ข้อมูลอดีต (อย่างน้อย ~15 จุด ถึงจะฟันธง) */
export function analyzeAssetRisk(input: AssetRiskInput): AssetRisk {
  const prices = input.history.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0);
  const symbol = input.symbol.toUpperCase();
  const current = prices.length > 0 ? prices[prices.length - 1] : 0;

  if (prices.length < 8) {
    return {
      symbol, type: input.type, current,
      return30dPct: 0, volatility: 0, trend: 'flat', momentum: 'weak', rsi: 50,
      support: current, resistance: current,
      signal: 'HOLD', signalStrength: 0.2,
      reasoning: 'ข้อมูลราคาไม่พอ (ต้องมีอย่างน้อย ~15 จุด) — ยังไม่ฟันธง',
      actions: ['📉 รอเก็บข้อมูลราคาเพิ่มอีกสักระยะก่อนตัดสินใจ', '🗂️ บันทึกราคาให้สม่ำเสมอ (worker จะทำอัตโนมัติ)'],
    };
  }

  // daily returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(prices[i] / prices[i - 1] - 1);
  const vol = stdev(returns) * Math.sqrt(252);

  // แนวโน้ม: slope ของราคา 30 วันล่าสุดเทียบกับขนาดราคา
  const window = prices.slice(-30);
  const slope = linearSlope(window);
  const trend: AssetRisk['trend'] = Math.abs(slope) / Math.max(1e-9, current) < 0.001 ? 'flat' : slope > 0 ? 'rising' : 'falling';

  // โมเมนตัม: MA5 vs MA20
  const ma = (n: number) => mean(prices.slice(-n));
  const ma5 = ma(5), ma20 = ma(Math.min(20, prices.length));
  const momentum: AssetRisk['momentum'] = ma5 > ma20 * 1.02 ? 'strong' : ma5 < ma20 * 0.98 ? 'weak' : 'moderate';

  const rsi = rsi14(prices);
  const support = Math.min(...prices.slice(-30));
  const resistance = Math.max(...prices.slice(-30));

  const return30dPct = prices.length >= 30 ? ((prices[prices.length - 1] / prices[prices.length - 30]) - 1) * 100 : 0;

  // สัญญาณรวม: แนวโน้ม > โมเมนตัม > RSI (แนวโน้มเป็นหลัก เหมือน Aladdin ใช้ trend ครอบ)
  let signal: AssetRisk['signal'] = 'HOLD';
  let strength = 0.4;
  const reasons: string[] = [];
  if (trend === 'rising' && momentum !== 'weak' && rsi < 88) {
    signal = 'BUY';
    strength = 0.55 + (momentum === 'strong' ? 0.2 : 0.1) + (rsi < 55 ? 0.1 : 0);
    reasons.push(`แนวโน้มขาขึ้น (slope > 0)`);
    reasons.push(`RSI ${rsi.toFixed(0)} — แรงซื้อต่อเนื่อง ยังไม่สุดขีด`);
  } else if (trend === 'falling' && momentum !== 'strong') {
    signal = rsi > 30 ? 'REDUCE' : 'SELL';
    strength = 0.55 + (momentum === 'weak' ? 0.2 : 0.1);
    reasons.push(`แนวโน้มขาลง (slope < 0)`);
    reasons.push(`RSI ${rsi.toFixed(0)} — ${rsi > 30 ? 'ยังมีแรงขาย' : 'oversold ระวังเด้ง'}`);
  } else if (trend === 'falling') {
    signal = 'REDUCE';
    strength = 0.5;
    reasons.push('แนวโน้มขาลงแต่โมเมนตัมยังไม่ชัด — ลดน้ำหนักก่อน');
  } else if (rsi > 88) {
    signal = 'REDUCE';
    strength = 0.5;
    reasons.push(`RSI ${rsi.toFixed(0)} สุดขีด — overbought เสี่ยงเด้งลง`);
  } else {
    reasons.push('แนวโน้ม/โมเมนตัมผสม — ถือก่อน');
  }
  strength = Math.min(0.95, strength);

  const reasoning = reasons.join(' · ');
  const actions = buildAssetActions(symbol, signal, trend, current, support, resistance, rsi);

  return { symbol, type: input.type, current, return30dPct, volatility: vol, trend, momentum, rsi: Math.round(rsi), support, resistance, signal, signalStrength: Math.round(strength * 100) / 100, reasoning, actions };
}

/** รายการสิ่งที่ต้องทำต่อตัว (ไทย) */
export function buildAssetActions(
  symbol: string,
  signal: AssetRisk['signal'],
  trend: AssetRisk['trend'],
  current: number,
  support: number,
  resistance: number,
  rsi: number
): string[] {
  const out: string[] = [];
  const pct = (v: number) => `${Math.round((v / current - 1) * 100)}%`;
  if (signal === 'BUY') {
    out.push(`🟢 ${symbol}: แนวโน้มขึ้น — ซื้อเพิ่มแบบทยอย (DCA) อย่าใส่ครั้งเดียว`);
    out.push(`🎯 เป้าหมายขายแรก: แนวต้าน ${resistance.toFixed(2)} (กำไร ~${pct(resistance)})`);
    out.push(`🛑 stop-loss: ต่ำกว่าแนวรับ ${support.toFixed(2)} (-${Math.abs(Math.round((1 - support / current) * 100))}%)`);
  } else if (signal === 'SELL') {
    out.push(`🔴 ${symbol}: แนวโน้มลงชัด — ขายออกก่อน (RSI ต่ำแล้ว ระวังรีบาวด์ ทยอยขาย)`);
    out.push(`👀 ถ้าขายแล้ว อย่าซื้อคืนทันที รอสัญญาณกลับตัว`);
  } else if (signal === 'REDUCE') {
    out.push(`🟠 ${symbol}: ลดน้ำหนักลง ~ครึ่งหนึ่ง (ขายส่วนที่กำไรไว้ก่อน)`);
    out.push(`🎯 เก็บส่วนที่เหลือ ตั้ง stop-loss ที่แนวรับ ${support.toFixed(2)}`);
  } else {
    out.push(`⚪ ${symbol}: ถือไว้ก่อน — ยังไม่มีสัญญาณชัดเจน`);
    out.push(`🎯 ซื้อเพิ่มเมื่อย่อลงมาที่แนวรับ ${support.toFixed(2)} หรือ RSI < 40`);
  }
  out.push(`📊 ติดตาม RSI: ${rsi.toFixed(0)} — ${rsi > 70 ? 'ระวัง overbought' : rsi < 30 ? 'เข้าสู่ oversold' : 'กลาง ๆ'}`);
  return out;
}

// ── Monte Carlo ──

export interface SimInput {
  symbol: string;
  valueUsd: number;
  history: PricePoint[];
}

export interface SimOptions {
  horizonDays: number;
  paths: number;
  seed?: number;
}

export interface SimResult {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  probLoss: number;
}

/** Geometric Brownian Motion: μ, σ จากข้อมูลอดีต → จำลอง N เส้นทาง */
export function simulatePortfolio(inputs: SimInput[], opts: SimOptions): SimResult {
  const rnd = mulberry32(opts.seed ?? Date.now() % 100000);
  const norm = (): number => {
    // Box-Muller
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const assets = inputs.map((a) => {
    const prices = a.history.map((p) => Number(p.price)).filter((n) => n > 0);
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) returns.push(prices[i] / prices[i - 1] - 1);
    const mu = mean(returns);
    const sigma = stdev(returns);
    return { value: a.valueUsd, mu, sigma };
  });

  const endings: number[] = [];
  const horizon = Math.max(1, opts.horizonDays);
  for (let p = 0; p < opts.paths; p++) {
    let total = 0;
    for (const a of assets) {
      let v = a.value;
      // จำลองรายวัน (หรือขั้นบันได 10 ก้าวเพื่อความเร็ว)
      const steps = Math.min(horizon, 30);
      const dt = horizon / steps;
      for (let s = 0; s < steps; s++) {
        v *= Math.exp((a.mu - 0.5 * a.sigma * a.sigma) * dt + a.sigma * Math.sqrt(dt) * norm());
      }
      total += v;
    }
    endings.push(total);
  }
  endings.sort((x, y) => x - y);
  const q = (pct: number) => endings[Math.min(endings.length - 1, Math.max(0, Math.floor(pct * endings.length)))];
  const p10 = q(0.1), p50 = q(0.5), p90 = q(0.9);
  const probLoss = endings.filter((v) => v < inputs.reduce((s, a) => s + a.valueUsd, 0)).length / endings.length;
  return { p10, p50, p90, mean: mean(endings), probLoss };
}

// ── ความเสี่ยงพอร์ตรวม ──

export interface PortfolioRisk {
  totalUsd: number;
  var95: number; // ขาดทุนสูงสุด 95% CI (บาท/ดอลลาร์) — ค่า ≥ 0
  var95Pct: number;
  concentration: number; // HHI 0-1 (1 = ลงในตัวเดียว)
  diversificationGrade: string;
  maxDrawdown: number; // ≤ 0
  topHolding: string;
}

export function portfolioRisk(inputs: SimInput[]): PortfolioRisk {
  const totalUsd = inputs.reduce((s, a) => s + a.valueUsd, 0);
  const hhi = inputs.reduce((s, a) => s + (a.valueUsd / totalUsd) ** 2, 0);

  // historical VaR95: ใช้ daily return ของพอร์ต (ถ่วงน้ำหนัก)
  const days = Math.min(30, ...inputs.map((a) => a.history.length));
  const dailyReturns: number[] = [];
  if (days >= 3 && inputs.length > 0) {
    const weightOf = new Map(inputs.map((a) => [a.symbol, a.valueUsd / totalUsd]));
    for (let d = days - 1; d >= 1; d--) {
      let ret = 0;
      for (const a of inputs) {
        const prices = a.history.map((p) => Number(p.price)).filter((n) => n > 0);
        const idx = prices.length - d;
        if (idx >= 1 && prices[idx] > 0) {
          ret += (weightOf.get(a.symbol) ?? 0) * (prices[idx] / prices[idx - 1] - 1);
        }
      }
      dailyReturns.push(ret);
    }
  }
  dailyReturns.sort((x, y) => x - y);
  const varDailyPct = dailyReturns.length > 0 ? Math.max(0, -dailyReturns[Math.floor(dailyReturns.length * 0.05)]) : 0.05;
  const var95 = totalUsd * Math.min(1, varDailyPct * Math.sqrt(30)); // 30 วัน
  const maxDrawdown = (() => {
    // drawdown จาก daily weighted series
    let peak = 0, dd = 0, cum = 0;
    for (const r of dailyReturns) {
      cum += r;
      peak = Math.max(peak, cum);
      dd = Math.min(dd, cum - peak);
    }
    return dd;
  })();
  const grade = hhi < 0.3 ? 'กระจายดี' : hhi < 0.55 ? 'กระจายพอใช้' : hhi < 0.8 ? 'กระจุกตัวสูง' : 'เสี่ยงสุดขีด (ตัวเดียว)';
  const top = [...inputs].sort((a, b) => b.valueUsd - a.valueUsd)[0];
  return {
    totalUsd,
    var95: Math.round(var95 * 100) / 100,
    var95Pct: Math.round((var95 / Math.max(1e-9, totalUsd)) * 1000) / 10,
    concentration: Math.round(hhi * 100) / 100,
    diversificationGrade: grade,
    maxDrawdown: Math.round(maxDrawdown * 1000) / 1000,
    topHolding: top?.symbol ?? '',
  };
}

/** รายการสิ่งที่ต้องทำระดับพอร์ต */
export function buildRiskActions(assets: Array<{ symbol: string; signal: AssetRisk['signal']; trend: AssetRisk['trend'] }>): string[] {
  const out: string[] = [];
  for (const a of assets) {
    if (a.signal === 'BUY') out.push(`➕ เพิ่มน้ำหนัก ${a.symbol} (แนวโน้ม${a.trend === 'rising' ? 'ขึ้น' : a.trend === 'falling' ? 'ลง' : 'นิ่ง'}) — แบบ DCA`);
    else if (a.signal === 'SELL') out.push(`➖ ขาย ${a.symbol} ออกจากพอร์ต (แนวโน้มลงชัด)`);
    else if (a.signal === 'REDUCE') out.push(`➗ ลด ${a.symbol} ลงครึ่งหนึ่ง — เก็บกำไรก่อน`);
    else out.push(`⏸️ ถือ ${a.symbol} ไว้ก่อน รอสัญญาณชัด`);
  }
  out.push('🛡️ ตั้ง stop-loss ทุกตัว (ตามแนวรับที่ระบบคำนวณให้)');
  out.push('💧 แบ่งพอร์ต: เก็บเงินสด/ทองคำสำรอง ~20% เผื่อเหตุการณ์ฉุกเฉิน');
  return out;
}
