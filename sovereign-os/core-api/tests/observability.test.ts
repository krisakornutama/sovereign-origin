// sovereign-os/core-api/tests/observability.test.ts
//
// ── "พังแล้วต้องรู้ว่าพังตรงไหน" (เส้นทาง A: มองเห็นได้) ────────────────────────────
// เจ้าของสั่ง 27/10/69: ให้เริ่มจาก reliability/observability ก่อน
//
// ก่อนหน้านี้ระบบมี watchdog เยอะ แต่ **ไม่มี** สิ่งพื้นฐานสามอย่างที่ระบบระดับโลกมี:
//   1) request-id ไล่ได้ทั้งเส้น (ตอนนี้ถ้า frontend แจ้ง error มา เราไม่รู้ว่า log บรรทัดไหน)
//   2) access log แบบโครงสร้าง (JSON) ที่ไม่หลุดความลับ (query string/header/body)
//   3) /metrics ให้ Prometheus/Grafana ดึงไปทำกราฟ + SLO ได้
//
// เทสต์นี้ล็อกกติกาที่ "ห้ามพัง" มากกว่าความสวย:
//   · request-id จากภายนอกที่ปลอดภัย = ใช้ต่อ (trace ข้าม frontend → API ได้)
//   · request-id ที่มีอักขระแปลก/ยาวเกิน = สร้างใหม่ (กัน log injection)
//   · log ต้องไม่มี query string (token ใน query หลุดบ่อยที่สุด), ไม่มี header/body
//   · metrics ต้อง label ด้วย "route pattern" ไม่ใช่ URL จริง (กัน cardinality ระเบิด)
//   · metrics ต้องปิดโดยปริญญา: ไม่ตั้ง METRICS_TOKEN = 401 (ไม่ใช่เปิดโล่ง)
import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTestServer } from './helpers';
import {
  MetricsRegistry,
  accessLogRecord,
  isMetricsAuthorized,
  normalizeRequestId,
  prometheusEscape,
} from '../src/lib/observability';
import { createObservability } from '../src/middleware/observability.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request-id: รับของจริง กันของปลอม', () => {
  test('id ที่ปลอดภัยจาก frontend = ใช้ต่อทั้งเส้น', () => {
    assert.equal(normalizeRequestId('3f2a1b4c-aaaa-bbbb-cccc-0123456789ab'), '3f2a1b4c-aaaa-bbbb-cccc-0123456789ab');
    assert.equal(normalizeRequestId('  abc-123  '), 'abc-123');
  });

  test('อักขระอันตราย/ยาวเกิน/ว่าง = สร้างใหม่ (กัน log injection)', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\tb', '<script>', 'x'.repeat(65), '', '   ', null, undefined, 42]) {
      const id = normalizeRequestId(bad as any);
      assert.match(id, UUID, `"${String(bad)}" ต้องถูกแทนด้วย uuid ใหม่ — ได้ ${id}`);
    }
  });

  test('อักขระที่ยอมรับ = ตัวอักษร ตัวเลข - _ . : เท่านั้น', () => {
    assert.equal(normalizeRequestId('a.b_c:d-1'), 'a.b_c:d-1');
    assert.match(normalizeRequestId('a b'), UUID);
    assert.match(normalizeRequestId('a/b'), UUID);
    assert.match(normalizeRequestId('a"b'), UUID);
  });
});

describe('access log: โครงสร้างคงที่ และไม่หลุดความลับ', () => {
  const rec = accessLogRecord({
    requestId: 'req-1',
    method: 'POST',
    path: '/api/auth/login?token=super-secret&x=1',
    status: 201,
    durationMs: 12.7,
    tenant: 'acme',
    userId: 'u-1',
  });

  test('มีฟิลด์ที่ต้องใช้ debug ครบ', () => {
    assert.equal(rec.requestId, 'req-1');
    assert.equal(rec.method, 'POST');
    assert.equal(rec.status, 201);
    assert.equal(rec.durationMs, 13, 'ปัดเป็นจำนวนเต็ม ms');
    assert.equal(rec.tenant, 'acme');
    assert.equal(rec.userId, 'u-1');
  });

  test('query string ถูกตัดทิ้ง (token ใน query คือรอยรั่วที่พบบ่อยที่สุด)', () => {
    assert.equal(rec.path, '/api/auth/login');
    assert.doesNotMatch(JSON.stringify(rec), /super-secret/);
  });

  test('ไม่มี header/cookie/body ใน log', () => {
    const text = JSON.stringify(rec).toLowerCase();
    for (const forbidden of ['authorization', 'cookie', 'set-cookie', 'password', 'bearer']) {
      assert.ok(!text.includes(forbidden), `log ต้องไม่มี "${forbidden}"`);
    }
  });

  test('ไม่มี userId = ใส่ null (รูปร่างคงที่ เครื่องมือ parse ได้)', () => {
    const r = accessLogRecord({ requestId: 'r', method: 'GET', path: '/x', status: 200, durationMs: 1, tenant: 't' });
    assert.equal(r.userId, null);
  });
});

describe('MetricsRegistry: ตัวเลขที่ Prometheus อ่านได้', () => {
  test('counter นับตาม label และเรียงลำดับคงที่', () => {
    const m = new MetricsRegistry();
    m.inc('sovereign_http_requests_total', { method: 'GET', route: '/api/health', status: '200' });
    m.inc('sovereign_http_requests_total', { method: 'GET', route: '/api/health', status: '200' });
    const a = m.render();
    const b = m.render();
    assert.equal(a, b, 'render ต้อง deterministic (diff ของ config ไม่ควรเปลี่ยนเพราะลำดับ map)');
    assert.match(
      a,
      /sovereign_http_requests_total\{method="GET",route="\/api\/health",status="200"\} 2/,
    );
    assert.match(a, /# TYPE sovereign_http_requests_total counter/);
  });

  test('histogram เป็น cumulative bucket + _sum + _count', () => {
    const m = new MetricsRegistry();
    m.observe('sovereign_http_request_duration_ms', 30, { method: 'GET', route: '/x' });
    const text = m.render();
    assert.match(text, /sovereign_http_request_duration_ms_bucket\{[^}]*le="25"\} 0/);
    assert.match(text, /sovereign_http_request_duration_ms_bucket\{[^}]*le="50"\} 1/);
    assert.match(text, /sovereign_http_request_duration_ms_bucket\{[^}]*le="\+Inf"\} 1/);
    assert.match(text, /sovereign_http_request_duration_ms_sum\{[^}]*\} 30/);
    assert.match(text, /sovereign_http_request_duration_ms_count\{[^}]*\} 1/);
  });

  test('label ที่มีอักขระพิเศษถูก escape (ไม่งั้น Prometheus parse ไม่ได้)', () => {
    assert.equal(prometheusEscape('a"b\\c\nd'), 'a\\"b\\\\c\\nd');
    const m = new MetricsRegistry();
    m.inc('x_total', { route: '/a"b' });
    assert.match(m.render(), /route="\/a\\"b"/);
  });

  test('reset() ล้างของเก่า (ใช้ในเทสต์/ตอน reload)', () => {
    const m = new MetricsRegistry();
    m.inc('x_total', {});
    m.reset();
    assert.doesNotMatch(m.render(), /x_total\{/);
  });
});

describe('metrics endpoint: ปิดโดยปริญญา', () => {
  test('ไม่ตั้ง token = ปฏิเสธทุกคำขอ', () => {
    assert.equal(isMetricsAuthorized('', ''), false);
    assert.equal(isMetricsAuthorized('อะไรก็ได้', ''), false);
    assert.equal(isMetricsAuthorized('', undefined), false);
    assert.equal(isMetricsAuthorized('', '   '), false, 'ช่องว่างล้วน = ยังไม่ตั้ง');
  });

  test('token ผิด/สั้นกว่า/ยาวกว่า = ปฏิเสธ (ไม่ throw)', () => {
    assert.equal(isMetricsAuthorized('abc', 'abcd'), false);
    assert.equal(isMetricsAuthorized('abcde', 'abcd'), false);
    assert.equal(isMetricsAuthorized('abce', 'abcd'), false);
    assert.equal(isMetricsAuthorized(null as any, 'abcd'), false);
    assert.equal(isMetricsAuthorized(123 as any, 'abcd'), false);
  });

  test('token ตรง = ผ่าน', () => {
    assert.equal(isMetricsAuthorized('abcd', 'abcd'), true);
    assert.equal(isMetricsAuthorized('  abcd  ', 'abcd'), true, 'ตัดช่องว่างหัวท้ายให้ (ก็อปจาก .env ง่าย)');
  });
});

describe('middleware: ต่อเข้าจริงแล้วได้ของจริง', () => {
  test('response มี x-request-id + log ใช้ route pattern ไม่ใช่ URL จริง', async () => {
    const lines: string[] = [];
    const obs = createObservability({ sink: (l) => lines.push(l), tenant: 'acme' });
    const server = await createTestServer((app) => {
      app.use(obs.requestContext);
      app.get('/api/users/:id', (_req, res) => res.json({ ok: true }));
      app.get('/api/metrics', obs.metricsHandler);
    });
    try {
      const res = await fetch(`${server.baseUrl}/api/users/abc123`, {
        headers: { 'x-request-id': 'req-from-frontend' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-request-id'), 'req-from-frontend');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(lines.length, 1, `ต้องมี log 1 บรรทัด — ได้ ${lines.length}`);
      const rec = JSON.parse(lines[0]);
      assert.equal(rec.requestId, 'req-from-frontend');
      assert.equal(rec.route, '/api/users/:id', 'ต้องเป็น pattern ไม่ใช่ /api/users/abc123');
      assert.equal(rec.path, '/api/users/abc123');
      assert.equal(rec.status, 200);
      assert.equal(rec.tenant, 'acme');
      assert.ok(typeof rec.durationMs === 'number');
    } finally {
      await server.close();
    }
  });

  test('request-id ที่ไม่ปลอดภัยถูกแทน + response บอก id ที่ใช้จริง', async () => {
    const lines: string[] = [];
    const obs = createObservability({ sink: (l) => lines.push(l), tenant: 't' });
    const server = await createTestServer((app) => {
      app.use(obs.requestContext);
      app.get('/ping', (_req, res) => res.send('pong'));
    });
    try {
      const res = await fetch(`${server.baseUrl}/ping`, { headers: { 'x-request-id': 'bad id with spaces' } });
      const id = res.headers.get('x-request-id');
      assert.match(String(id), UUID);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(JSON.parse(lines[0]).requestId, id);
    } finally {
      await server.close();
    }
  });

  test('ไม่ตั้ง token = 401 และไม่คายตัวเลขออกไป', async () => {
    const obs = createObservability({ sink: () => {}, tenant: 't', getToken: () => '' });
    const server = await createTestServer((app) => {
      app.use(obs.requestContext);
      app.get('/api/metrics', obs.metricsHandler);
    });
    try {
      const res = await fetch(`${server.baseUrl}/api/metrics`);
      assert.equal(res.status, 401);
      const text = await res.text();
      assert.doesNotMatch(text, /sovereign_http_requests_total/, 'ห้ามคาย metrics เมื่อไม่ได้รับอนุญาต');
    } finally {
      await server.close();
    }
  });

  test('token ถูก = 200 text/plain และมีตัวเลขของ request ก่อนหน้า', async () => {
    const obs = createObservability({ sink: () => {}, tenant: 't', getToken: () => 'sekret' });
    const server = await createTestServer((app) => {
      app.use(obs.requestContext);
      app.get('/api/users/:id', (_req, res) => res.json({ ok: true }));
      app.get('/api/metrics', obs.metricsHandler);
    });
    try {
      await fetch(`${server.baseUrl}/api/users/1`);
      const bad = await fetch(`${server.baseUrl}/api/metrics`, { headers: { 'x-metrics-token': 'wrong' } });
      assert.equal(bad.status, 401);
      const res = await fetch(`${server.baseUrl}/api/metrics`, { headers: { 'x-metrics-token': 'sekret' } });
      assert.equal(res.status, 200);
      assert.match(String(res.headers.get('content-type')), /text\/plain/);
      const text = await res.text();
      assert.match(text, /sovereign_http_requests_total\{[^}]*route="\/api\/users\/:id"/);
      assert.match(text, /sovereign_up\{tenant="t"\} 1/);
      assert.match(text, /sovereign_process_resident_memory_bytes \d+/);
    } finally {
      await server.close();
    }
  });

  test('ไม่ log /healthz (watchdog ยิงถี่ — จะท่วม log โดยไม่ช่วยอะไร)', async () => {
    const lines: string[] = [];
    const obs = createObservability({ sink: (l) => lines.push(l), tenant: 't' });
    const server = await createTestServer((app) => {
      app.use(obs.requestContext);
      app.get('/healthz', (_req, res) => res.send('ok'));
    });
    try {
      await fetch(`${server.baseUrl}/healthz`);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(lines.length, 0);
    } finally {
      await server.close();
    }
  });
});
