import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  computePortfolioValue,
  computeInventoryValue,
  computeSurvivalRunway,
  type AssetHolding,
  type LatestPrice,
  type InventoryLine,
} from '../src/services/wealth.service';

// ─────────────────────────── computePortfolioValue ───────────────────────────

test('computePortfolioValue sums quantity x price for each asset', () => {
  const assets: AssetHolding[] = [
    { symbol: 'BTC', type: 'CRYPTO', quantity: 0.5 },
    { symbol: 'AAPL', type: 'STOCK', quantity: 10 },
    { symbol: 'XAU', type: 'COMMODITY', quantity: 2 },
  ];
  const prices: LatestPrice[] = [
    { symbol: 'BTC', priceUsd: 60000 },
    { symbol: 'AAPL', priceUsd: 200 },
    { symbol: 'XAU', priceUsd: 2400 },
  ];
  const result = computePortfolioValue(assets, prices);
  assert.strictEqual(result.totalUsd, 0.5 * 60000 + 10 * 200 + 2 * 2400);
  assert.strictEqual(result.assets.length, 3);
  assert.strictEqual(result.missingPrices.length, 0);
});

test('computePortfolioValue excludes assets without a known price from total', () => {
  const assets: AssetHolding[] = [
    { symbol: 'BTC', type: 'CRYPTO', quantity: 0.5 },
    { symbol: 'UNKNOWN', type: 'STOCK', quantity: 10 },
  ];
  const prices: LatestPrice[] = [{ symbol: 'BTC', priceUsd: 60000 }];
  const result = computePortfolioValue(assets, prices);
  assert.strictEqual(result.totalUsd, 0.5 * 60000);
  assert.deepStrictEqual(result.missingPrices, ['UNKNOWN']);
});

test('computePortfolioValue returns zero for empty portfolios', () => {
  assert.strictEqual(computePortfolioValue([], []).totalUsd, 0);
});

// ─────────────────────────── computeInventoryValue ───────────────────────────

test('computeInventoryValue sums quantity x unit price of every line', () => {
  const items: InventoryLine[] = [
    { name: 'ดีเซล', category: 'FUEL', quantity: 500, unit: 'L', unitPriceUsd: 1.2 },
    { name: 'ทองคำแท่ง', category: 'PRECIOUS_METAL', quantity: 2, unit: 'baht', unitPriceUsd: 2200 },
  ];
  assert.strictEqual(computeInventoryValue(items), 500 * 1.2 + 2 * 2200);
});

test('computeInventoryValue returns zero for empty inventory', () => {
  assert.strictEqual(computeInventoryValue([]), 0);
});

// ─────────────────────────── computeSurvivalRunway ───────────────────────────

test('computeSurvivalRunway combines expenses with energy cost and divides liquidity', () => {
  const result = computeSurvivalRunway({
    cashUsd: 3000,
    liquidAssetUsd: 6000,
    monthlyExpensesUsd: 500,
    avgPowerKw: 1.5,
    electricityPricePerKwh: 0.1,
  });
  // พลังงาน: 1.5 kW x 24h x 30d x 0.1 = 108 USD/เดือน → burn = 608
  // runway = 9000 / 608
  assert.strictEqual(result.monthlyBurnUsd, 608);
  assert.ok(Math.abs(result.months - 9000 / 608) < 1e-9);
});

test('computeSurvivalRunway treats zero power draw as zero energy cost', () => {
  const result = computeSurvivalRunway({
    cashUsd: 1000,
    liquidAssetUsd: 0,
    monthlyExpensesUsd: 200,
    avgPowerKw: 0,
    electricityPricePerKwh: 0.1,
  });
  assert.strictEqual(result.monthlyBurnUsd, 200);
  assert.ok(Math.abs(result.months - 5) < 1e-9);
});

test('computeSurvivalRunway returns null months when burn is zero', () => {
  const result = computeSurvivalRunway({
    cashUsd: 1000,
    liquidAssetUsd: 0,
    monthlyExpensesUsd: 0,
    avgPowerKw: 0,
    electricityPricePerKwh: 0.1,
  });
  assert.strictEqual(result.monthlyBurnUsd, 0);
  assert.strictEqual(result.months, null);
});

test('computeSurvivalRunway returns null months when no liquidity at all', () => {
  const result = computeSurvivalRunway({
    cashUsd: 0,
    liquidAssetUsd: 0,
    monthlyExpensesUsd: 300,
    avgPowerKw: 0,
    electricityPricePerKwh: 0.1,
  });
  assert.strictEqual(result.months, 0);
});
