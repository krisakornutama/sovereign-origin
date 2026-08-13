// TDD: Aladdin-style risk engine — ใช้ข้อมูลอดีตทำนายอนาคต (สไตล์ BlackRock Aladdin)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAssetRisk,
  simulatePortfolio,
  portfolioRisk,
  buildRiskActions,
  type PricePoint,
} from '../src/services/aladdin-risk.service';

function series(base: number, step: number, n: number, jitter = 0): PricePoint[] {
  const out: PricePoint[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    // มี pullback บ้าง (ขึ้น 5 วัน เด้งลง 1 วัน) — ให้ RSI ไม่ติด 100 เหมือนตลาดจริง
    v += i % 6 === 5 ? -Math.abs(step) * 0.6 : step + (i % 3 === 0 ? jitter : 0);
    out.push({ time: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), price: Math.max(0.01, v) });
  }
  return out;
}

test('analyzeAssetRisk detects a rising trend with BUY signal', () => {
  const r = analyzeAssetRisk({ symbol: 'BTC', type: 'CRYPTO', history: series(100, 2, 60) });
  assert.equal(r.trend, 'rising');
  assert.equal(r.signal, 'BUY');
  assert.ok(r.actions.length > 0);
  assert.ok(r.current > r.support && r.current < r.resistance || r.current >= r.resistance);
});

test('analyzeAssetRisk detects a falling trend with SELL/REDUCE signal', () => {
  const r = analyzeAssetRisk({ symbol: 'GOLD', type: 'COMMODITY', history: series(200, -1.5, 60) });
  assert.equal(r.trend, 'falling');
  assert.ok(r.signal === 'SELL' || r.signal === 'REDUCE');
  assert.ok(r.volatility >= 0);
  assert.ok(r.rsi >= 0 && r.rsi <= 100);
});

test('analyzeAssetRisk handles flat prices and short history gracefully', () => {
  const flat = analyzeAssetRisk({ symbol: 'X', type: 'STOCK', history: series(50, 0, 40) });
  assert.ok(['rising', 'falling', 'flat'].includes(flat.trend));
  const short = analyzeAssetRisk({ symbol: 'Y', type: 'STOCK', history: series(50, 1, 5) });
  assert.equal(short.trend, 'flat'); // ข้อมูลน้อยเกินไป → ไม่ฟันธง
});

test('simulatePortfolio produces ordered quantiles with seeded determinism', () => {
  const dist = simulatePortfolio(
    [
      { symbol: 'BTC', valueUsd: 100, history: series(100, 1, 60) },
      { symbol: 'GOLD', valueUsd: 100, history: series(200, 0.5, 60) },
    ],
    { horizonDays: 30, paths: 500, seed: 42 }
  );
  assert.ok(dist.p10 < dist.p50);
  assert.ok(dist.p50 < dist.p90);
  assert.ok(dist.mean > 0);
  assert.ok(dist.probLoss >= 0 && dist.probLoss <= 1);
  // determinism: seed เดียวกัน → ผลเดียวกัน
  const again = simulatePortfolio(
    [
      { symbol: 'BTC', valueUsd: 100, history: series(100, 1, 60) },
      { symbol: 'GOLD', valueUsd: 100, history: series(200, 0.5, 60) },
    ],
    { horizonDays: 30, paths: 500, seed: 42 }
  );
  assert.equal(dist.p50, again.p50);
});

test('portfolioRisk computes VaR95, concentration and max drawdown', () => {
  const r = portfolioRisk([
    { symbol: 'BTC', valueUsd: 60, history: series(100, 1, 60) },
    { symbol: 'GOLD', valueUsd: 40, history: series(200, -0.2, 60) },
  ]);
  assert.ok(r.var95 >= 0);
  assert.ok(r.concentration >= 0 && r.concentration <= 1);
  // 60/40 → HHI = 0.36+0.16 = 0.52
  assert.ok(Math.abs(r.concentration - 0.52) < 1e-9);
  assert.ok(r.maxDrawdown <= 0);
  assert.ok(r.diversificationGrade.length > 0);
});

test('buildRiskActions returns Thai instructions from signals', () => {
  const actions = buildRiskActions([
    { symbol: 'BTC', signal: 'BUY', trend: 'rising' },
    { symbol: 'GOLD', signal: 'SELL', trend: 'falling' },
  ]);
  assert.ok(actions.some((a) => a.includes('BTC')));
  assert.ok(actions.some((a) => a.includes('เพิ่ม')));
  assert.ok(actions.some((a) => a.includes('ลด') || a.includes('ขาย')));
});
