import './setup-env';
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import aiModelsRoutes from '../src/modules/ai-models/ai-models.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

// ── ai-models routes: ทุกเส้นทางต้อง authenticate + เปลี่ยนสถานะต้อง SUPERADMIN ──

type FakeAxios = {
  get: (url: string) => Promise<{ data: any }>;
  post: (url: string, data?: any) => Promise<{ data: any }>;
  request: (cfg: any) => Promise<{ data: any }>;
};
let fakeAxios: FakeAxios;
const createMock = mock.method(axios, 'create', (() => fakeAxios) as unknown as typeof axios.create);
// isEngineUp ใช้ axios.get ตรง (ไม่ผ่าน create) — mock ให้ reject เร็ว = engine ไม่ตอบ (engineUp: false)
const getMock = mock.method(axios, 'get', async () => { throw new Error('mock: engine offline'); });

// pullModel ใช้ global fetch ตรง (ไม่ผ่าน axios) — stub เฉพาะ URL ที่ชี้ Ollama
// (ตอบสั้น ๆ พอ — ปลายทางจริงเป็นสตรีมยาว ห้ามยิงเน็ตจริงจากเทส)
function stubOllamaPull(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = typeof input === 'string' ? input : String(input?.url ?? input);
    if (u.includes('/api/pull')) {
      return new Response(JSON.stringify({ status: 'mocked' }) + '\n', { status: 200 });
    }
    return original(input as any, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

let server: TestServer;

describe('ai-models.routes — ด่าน auth ครบทุกเส้นทาง', () => {
  before(async () => {
    fakeAxios = { get: async () => ({ data: {} }), post: async () => ({ data: {} }), request: async () => ({ data: {} }) };
    server = await createTestServer((app) => app.use('/api/ai-models', aiModelsRoutes));
  });

  after(async () => {
    await server.close();
    createMock.mock.restore();
    getMock.mock.restore();
  });

  test('GET /models ไม่มี token → 401', async () => {
    const r = await fetch(`${server.baseUrl}/api/ai-models/models`);
    assert.equal(r.status, 401);
  });

  test('GET /models มี token ถูกต้อง → 200 (ผ่านด่านถึง service)', async () => {
    const r = await fetch(`${server.baseUrl}/api/ai-models/models`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json() as any;
    assert.ok('models' in body && 'engineUp' in body);
  });

  test('POST /models/pull ด้วย OPERATOR → 403 (ต้อง SUPERADMIN)', async () => {
    const r = await fetch(`${server.baseUrl}/api/ai-models/models/pull`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${makeToken('OPERATOR')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-model' }),
    });
    assert.equal(r.status, 403);
  });

  test('POST /models/pull ด้วย SUPERADMIN → สตรีมเริ่มได้ + ตัดการเชื่อมต่อกลางทางได้ (fetch stub — ไม่แตะเน็ต)', async () => {
    const restore = stubOllamaPull();
    try {
      const ac = new AbortController();
      const r = await fetch(`${server.baseUrl}/api/ai-models/models/pull`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test-model' }),
        signal: ac.signal,
      });
      assert.equal(r.status, 200);
      assert.ok(r.body, 'ต้องเป็นสตรีม');
      const reader = (r.body as ReadableStream<Uint8Array>).getReader();
      const { value } = await reader.read();
      const firstLine = new TextDecoder().decode(value ?? new Uint8Array());
      assert.ok(firstLine.includes('เริ่มดาวน์โหลด test-model'), 'บรรทัดแรกต้องเป็น progress เริ่มดาวน์โหลด: ' + firstLine);
      // UI ปิดหน้ากลางทาง = ตัดสตรีม — route ต้องอยู่ได้ (ไม่เขียนบน socket ที่ปิดแล้ว)
      ac.abort();
      try { await reader.cancel(); } catch { /* ignore */ }
    } finally {
      restore();
    }
  }, 15000);

  test('DELETE /models/:name ด้วย OPERATOR → 403', async () => {
    const r = await fetch(`${server.baseUrl}/api/ai-models/models/${encodeURIComponent('qwen2.5-coder:7b')}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${makeToken('OPERATOR')}` },
    });
    assert.equal(r.status, 403);
  });

  test('DELETE /models/:name ด้วย SUPERADMIN → ผ่านไปยิง engine (200)', async () => {
    const r = await fetch(`${server.baseUrl}/api/ai-models/models/${encodeURIComponent('qwen2.5-coder:7b')}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(r.status, 200);
  });
});
