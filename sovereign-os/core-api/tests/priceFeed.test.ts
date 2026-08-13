import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import { PriceCache, parseBinanceTicker, parseYahooChart } from '../src/services/price-feed.service';

// ─────────────────────────── parsers ───────────────────────────

test('parseBinanceTicker extracts price from ticker JSON', () => {
  const price = parseBinanceTicker('{"symbol":"BTCUSDT","price":"67890.12"}');
  assert.strictEqual(price, 67890.12);
});

test('parseBinanceTicker returns null on malformed input', () => {
  assert.strictEqual(parseBinanceTicker(''), null);
  assert.strictEqual(parseBinanceTicker('not json'), null);
  assert.strictEqual(parseBinanceTicker('{"symbol":"BTCUSDT"}'), null);
  assert.strictEqual(parseBinanceTicker('{"symbol":"BTCUSDT","price":"abc"}'), null);
});

test('parseYahooChart extracts regularMarketPrice from chart JSON', () => {
  const body = JSON.stringify({
    chart: { result: [{ meta: { regularMarketPrice: 306.07, currency: 'USD' } }] },
  });
  assert.strictEqual(parseYahooChart(body), 306.07);
});

test('parseYahooChart returns null on malformed input', () => {
  assert.strictEqual(parseYahooChart(''), null);
  assert.strictEqual(parseYahooChart('not json'), null);
  assert.strictEqual(parseYahooChart(JSON.stringify({ chart: { result: [] } })), null);
  assert.strictEqual(
    parseYahooChart(JSON.stringify({ chart: { error: { code: 'Not Found' }, result: null } })),
    null
  );
  assert.strictEqual(parseYahooChart(JSON.stringify({ chart: { result: [{ meta: {} }] } })), null);
});

// ─────────────────────────── cache ───────────────────────────

test('PriceCache returns null for unknown symbol', () => {
  const cache = new PriceCache(60000);
  assert.strictEqual(cache.get('BTC'), null);
});

test('PriceCache returns cached value within TTL', () => {
  const cache = new PriceCache(60000, () => 1000);
  cache.set('BTC', 67000);
  assert.strictEqual(cache.get('BTC'), 67000);
});

test('PriceCache expires entries after TTL', () => {
  let now = 1000;
  const cache = new PriceCache(60000, () => now);
  cache.set('BTC', 67000);
  now = 1000 + 60000; // exactly TTL → expired
  assert.strictEqual(cache.get('BTC'), null);
  // ตั้งใหม่ผ่าน TTL
  now = 1000 + 59999;
  cache.set('BTC', 67001);
  assert.strictEqual(cache.get('BTC'), 67001);
});

test('PriceCache keeps symbols independent', () => {
  const cache = new PriceCache(60000);
  cache.set('BTC', 67000);
  assert.strictEqual(cache.get('ETH'), null);
  assert.strictEqual(cache.get('BTC'), 67000);
});

test('PriceCache.clear empties all entries', () => {
  const cache = new PriceCache(60000);
  cache.set('BTC', 1);
  cache.set('ETH', 2);
  cache.clear();
  assert.strictEqual(cache.get('BTC'), null);
  assert.strictEqual(cache.get('ETH'), null);
});
