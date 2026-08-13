import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { mkdtempSync } from 'fs';
import farmRoutes, { prisma } from '../src/modules/farm/farm.routes';
import { buildFarmMapSvg, daysToHarvest, escapeXml, type FarmMapPlot } from '../src/services/farm-map.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';
import { resolveTtsConfig, piperReady } from '../src/modules/tts/tts.routes';

// ─────────────────────────────────────────────────────────────
// farm-map.service — pure functions
// ─────────────────────────────────────────────────────────────
test('escapeXml escapes XML special characters', () => {
  assert.strictEqual(escapeXml(`<script>alert("x") & 'y'</script>`), '&lt;script&gt;alert(&quot;x&quot;) &amp; &apos;y&apos;&lt;/script&gt;');
  assert.strictEqual(escapeXml(null), '');
  assert.strictEqual(escapeXml(undefined), '');
  assert.strictEqual(escapeXml('มะเขือ 100%'), 'มะเขือ 100%');
});

test('daysToHarvest: ceil days, clamp 0, null-safe', () => {
  const now = Date.parse('2026-08-12T00:00:00Z');
  assert.strictEqual(daysToHarvest('2026-08-15T00:00:00Z', now), 3);
  assert.strictEqual(daysToHarvest('2026-08-12T06:00:00Z', now), 1);
  assert.strictEqual(daysToHarvest('2026-08-11T00:00:00Z', now), 0);
  assert.strictEqual(daysToHarvest(null, now), null);
  assert.strictEqual(daysToHarvest('not-a-date', now), null);
});

const plot = (id: string, over: Partial<FarmMapPlot> = {}): FarmMapPlot => ({
  id,
  name: `แปลง${id}`,
  crop: 'มะเขือเทศ',
  area_sqm: 20,
  status: 'growing',
  location: 'โซน A',
  planted_at: null,
  expected_harvest_at: '2026-08-20T00:00:00Z',
  ...over,
});

test('buildFarmMapSvg: layout + escaping + status colors', () => {
  const svg = buildFarmMapSvg(
    [
      plot('1', { status: 'active' }),
      plot('2', { name: '<b>น่ารัก</b>' }),
      plot('3', { expected_harvest_at: null }),
      plot('4', { expected_harvest_at: '2026-08-11T00:00:00Z' }), // ผ่านมาแล้ว → พร้อมเก็บ
    ],
    { cols: 3, now: Date.parse('2026-08-12T00:00:00Z') }
  );
  assert.ok(svg.startsWith('<svg'), 'must start with <svg');
  assert.match(svg, /#10b981/, 'active fill present');
  assert.ok(svg.includes('&lt;b&gt;น่ารัก&lt;/b&gt;'), 'name escaped');
  assert.ok(!svg.includes('<b>น่ารัก</b>'), 'raw html must not appear');
  assert.match(svg, /พร้อมเก็บแล้ว/, 'past harvest → ready label');
  assert.match(svg, /🗺️ แผนที่แปลงฟาร์ม/, 'header present');
  assert.match(svg, /สถานะ:/, 'legend present');
  assert.match(svg, /4 แปลง/, 'count in subtitle');
});

test('buildFarmMapSvg: empty state', () => {
  const svg = buildFarmMapSvg([], { now: Date.now() });
  assert.match(svg, /ยังไม่มีแปลง/, 'empty message shown');
  assert.ok(!svg.includes('<rect x="24"'), 'no plot rects');
});

test('buildFarmMapSvg: grid layout places 2 cols on 2 rows for 5 plots (cols=3 → 2 rows)', () => {
  const svg = buildFarmMapSvg(Array.from({ length: 5 }, (_, i) => plot(String(i + 1))), { cols: 3 });
  assert.match(svg, /แปลง1/, 'plot 1 rendered');
  assert.match(svg, /แปลง5/, 'plot 5 rendered');
});

// ─────────────────────────────────────────────────────────────
// GET /api/farm/plots/map.svg — route (auth + svg content-type)
// ─────────────────────────────────────────────────────────────
let server: TestServer;
let adminToken: string;
let userToken: string;

before(async () => {
  mockModel(prisma, 'farmPlot', {
    findMany: async () => [plot('A', { name: 'แปลงหน้า' }), plot('B', { status: 'harvested' })],
  });
  server = await createTestServer((app) => app.use('/api/farm/plots', farmRoutes));
  adminToken = makeToken('SUPERADMIN');
  userToken = makeToken('FARMER');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

test('GET /map.svg requires auth', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots/map.svg');
  assert.strictEqual(res.status, 401);
});

test('GET /map.svg returns SVG with plots', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots/map.svg', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/);
  const body = await res.text();
  assert.ok(body.startsWith('<svg'), 'body is svg');
  assert.match(body, /แปลงหน้า/, 'plot from mock db');
  assert.match(body, /เก็บแล้ว/, 'harvested label');
});

// ─────────────────────────────────────────────────────────────
// tts config — engine select + piper readiness (env-driven, pure)
// ─────────────────────────────────────────────────────────────
test('resolveTtsConfig defaults to pyttsx3', () => {
  const cfg = resolveTtsConfig({});
  assert.strictEqual(cfg.engine, 'pyttsx3');
  assert.strictEqual(piperReady(cfg), false);
});

test('resolveTtsConfig picks piper via TTS_ENGINE', () => {
  const cfg = resolveTtsConfig({ TTS_ENGINE: 'piper' });
  assert.strictEqual(cfg.engine, 'piper');
});

test('piperReady only true when exe + voice exist on disk', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tts-test-'));
  const exe = path.join(dir, 'piper.exe');
  const voice = path.join(dir, 'voice.onnx');
  try {
    assert.strictEqual(piperReady(resolveTtsConfig({ TTS_ENGINE: 'piper', PIPER_EXE: exe, PIPER_VOICE: voice })), false);
    writeFileSync(exe, '');
    assert.strictEqual(piperReady(resolveTtsConfig({ TTS_ENGINE: 'piper', PIPER_EXE: exe, PIPER_VOICE: voice })), false);
    writeFileSync(voice, '');
    assert.strictEqual(piperReady(resolveTtsConfig({ TTS_ENGINE: 'piper', PIPER_EXE: exe, PIPER_VOICE: voice })), true);
  } finally {
    try { unlinkSync(voice); } catch { /* ignore */ }
    try { unlinkSync(exe); } catch { /* ignore */ }
  }
});
