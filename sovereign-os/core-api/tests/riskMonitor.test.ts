import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseRss,
  parseThreatResponse,
  RiskWorker,
  riskEmitter,
  type RssItem,
  type ThreatResult,
} from '../src/services/risk-monitor.service';

// ─────────────────────────── parseRss ───────────────────────────

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Reuters World</title>
    <item>
      <title>Oil prices surge as tensions escalate</title>
      <link>https://example.com/oil-surge</link>
      <pubDate>Tue, 11 Aug 2026 08:00:00 GMT</pubDate>
      <description>Crude oil jumped 5% today amid supply fears.</description>
    </item>
    <item>
      <title>Central banks warn of inflation risk</title>
      <link>https://example.com/inflation-warning</link>
      <pubDate>Mon, 10 Aug 2026 18:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test('parseRss extracts items from RSS 2.0', () => {
  const items = parseRss(SAMPLE_RSS);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'Oil prices surge as tensions escalate');
  assert.strictEqual(items[0].link, 'https://example.com/oil-surge');
  assert.strictEqual(items[0].pubDate, 'Tue, 11 Aug 2026 08:00:00 GMT');
  assert.strictEqual(items[0].description, 'Crude oil jumped 5% today amid supply fears.');
});

test('parseRss handles items missing optional fields', () => {
  const xml = `<rss version="2.0"><channel><item><title>Only title</title></item></channel></rss>`;
  const items = parseRss(xml);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'Only title');
  assert.strictEqual(items[0].link, '');
});

test('parseRss returns empty array for malformed or empty XML', () => {
  assert.deepStrictEqual(parseRss(''), []);
  assert.deepStrictEqual(parseRss('<html></html>'), []);
  assert.deepStrictEqual(parseRss('not xml at all'), []);
});

test('parseRss handles Atom feeds with entry elements', () => {
  const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Markets in turmoil</title>
    <link href="https://example.com/turmoil"/>
    <updated>2026-08-11T07:00:00Z</updated>
    <summary>Global markets fell sharply.</summary>
  </entry>
</feed>`;
  const items = parseRss(atom);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'Markets in turmoil');
  assert.strictEqual(items[0].link, 'https://example.com/turmoil');
  assert.strictEqual(items[0].pubDate, '2026-08-11T07:00:00Z');
});

test('parseRss strips CDATA wrappers from title and description', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title><![CDATA[Prices <b>surge</b> &amp; fall]]></title>
    <link>https://example.com/x</link>
    <description><![CDATA[Some <b>HTML</b> here]]></description>
  </item></channel></rss>`;
  const items = parseRss(xml);
  assert.strictEqual(items[0].title, 'Prices <b>surge</b> &amp; fall');
  assert.strictEqual(items[0].description, 'Some <b>HTML</b> here');
});

test('parseRss tolerates a missing channel wrapper', () => {
  const xml = `<rss version="2.0"><item><title>Loose item</title><link>https://example.com/loose</link></item></rss>`;
  const items = parseRss(xml);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'Loose item');
});

// ─────────────────────────── parseThreatResponse ───────────────────────────

test('parseThreatResponse extracts a clean JSON threat result', () => {
  const raw = JSON.stringify({
    overall: 72,
    categories: { war: 60, banking: 40, energy: 80, inflation: 55 },
    summary: 'Tensions rising',
  });
  const result = parseThreatResponse(raw);
  assert.ok(result);
  assert.strictEqual(result!.overall, 72);
  assert.strictEqual(result!.categories.energy, 80);
  assert.strictEqual(result!.summary, 'Tensions rising');
});

test('parseThreatResponse tolerates markdown code fences around JSON', () => {
  const raw = '```json\n{"overall": 65, "categories": {"war": 30}, "summary": "x"}\n```';
  const result = parseThreatResponse(raw);
  assert.ok(result);
  assert.strictEqual(result!.overall, 65);
});

test('parseThreatResponse tolerates prose wrapped around the JSON', () => {
  const raw = 'Here is my analysis:\n{"overall": 80, "categories": {"war": 90}}\nThat is all.';
  const result = parseThreatResponse(raw);
  assert.ok(result);
  assert.strictEqual(result!.overall, 80);
});

test('parseThreatResponse clamps out-of-range values to 0-100', () => {
  const raw = '{"overall": 150, "categories": {"war": -5}}';
  const result = parseThreatResponse(raw);
  assert.ok(result);
  assert.strictEqual(result!.overall, 100);
  assert.strictEqual(result!.categories.war, 0);
});

test('parseThreatResponse returns null when no JSON can be found', () => {
  assert.strictEqual(parseThreatResponse(''), null);
  assert.strictEqual(parseThreatResponse('no json here'), null);
  assert.strictEqual(parseThreatResponse('{"overall": "not a number"}'), null);
});

test('parseThreatResponse fills missing categories with 0', () => {
  const raw = '{"overall": 50, "categories": {"war": 10}}';
  const result = parseThreatResponse(raw);
  assert.ok(result);
  assert.strictEqual(result!.categories.banking, 0);
  assert.strictEqual(result!.categories.energy, 0);
  assert.strictEqual(result!.categories.inflation, 0);
});

// ─────────────────── RiskWorker: AI On-Demand visibility ───────────────────

function workerWithAnalyze(analyze: () => Promise<ThreatResult | null>) {
  return new RiskWorker(
    {
      fetchFeed: async () => '<rss><channel><title>t</title></channel></rss>',
      headlineExists: async () => true,
      saveHeadline: async () => {},
      loadRecentHeadlines: async () => [{ title: 'ข่าวทดสอบ', summary: null }],
      saveThreatIndex: async () => {},
      analyzeWithOllama: analyze,
      log: () => {},
    },
    { enabled: true, feeds: [{ name: 'test', url: 'https://x/rss' }], pollCron: '', ollamaUrl: 'http://ollama:11434', model: 'gemma3:4b', analyzeTop: 5 }
  );
}

test('RiskWorker: Ollama ล้ม → บันทึก lastError + emit risk_error (กันพังเงียบ)', async () => {
  const events: Array<{ lastError: string }> = [];
  const onError = (e: { lastError: string }) => events.push(e);
  riskEmitter.on('risk_error', onError);
  try {
    const w = workerWithAnalyze(async () => null);
    const r = await w.runOnce();
    assert.strictEqual(r.threat, null);
    assert.ok(w.getStatus().lastError);
    assert.ok(w.getStatus().lastErrorAt);
    assert.strictEqual(events.length, 1);
    assert.ok(events[0].lastError.includes('http://ollama:11434'));
  } finally {
    riskEmitter.off('risk_error', onError);
  }
});

test('RiskWorker: วิเคราะห์สำเร็จ → ล้าง lastError + ไม่ emit risk_error', async () => {
  const events: unknown[] = [];
  const onError = (e: unknown) => events.push(e);
  riskEmitter.on('risk_error', onError);
  try {
    const w = workerWithAnalyze(async () => ({ overall: 30, categories: { war: 10, banking: 5, energy: 8, inflation: 7 }, summary: 'ปกติ' }));
    const r = await w.runOnce();
    assert.ok(r.threat);
    assert.strictEqual(w.getStatus().lastError, null);
    assert.strictEqual(events.length, 0);
  } finally {
    riskEmitter.off('risk_error', onError);
  }
});
