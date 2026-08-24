import './setup-env';
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listModels,
  pullModel,
  deleteModel,
  unloadModelFromVram,
  importGgufModel,
  describeError,
} from '../src/services/ai-model-manager.service';
import { config } from '../src/config';

// ── mock axios.create → คืน fake instance (service ใช้ axios.create ทุก call) ──
type FakeAxios = { get: (url: string) => Promise<{ data: any }>; post: (url: string, data?: any) => Promise<{ data: any }>; request: (cfg: any) => Promise<{ data: any }> };
let fakeAxios: FakeAxios;
const createMock = mock.method(axios, 'create', (() => fakeAxios) as unknown as typeof axios.create);

const TAGS = {
  models: [
    { name: 'qwen2.5-coder:7b', size: 4700000000, digest: 'aaa', details: { parameter_size: '7.6B', family: 'qwen2' } },
    { name: 'deepseek-r1:14b', size: 9000000000, digest: 'bbb', details: { parameter_size: '14.8B', family: 'qwen2' } },
  ],
};
const PS = {
  models: [{ name: 'qwen2.5-coder:7b', size: 4700000000, size_vram: 4800000000, expires_at: '2026-08-24T10:00:00Z' }],
};

function ndjsonResponse(lines: object[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });
}

describe('ai-model-manager.service', () => {
  before(() => {
    config.ollama.ggufDir = path.join(os.tmpdir(), `sovereign-gguf-test-${Date.now()}`);
  });
  after(() => {
    try { fs.rmSync(config.ollama.ggufDir, { recursive: true, force: true }); } catch { /* ignore */ }
    createMock.mock.restore();
  });

  test('listModels — รวม tags + ps + สรุป storage/vram ถูกต้อง', async () => {
    fakeAxios = {
      get: async (url: string) => (url === '/api/tags' ? { data: TAGS } : { data: PS }),
      post: async () => ({ data: {} }),
      request: async () => ({ data: {} }),
    };
    const inv = await listModels();
    assert.equal(inv.models.length, 2);
    assert.equal(inv.loaded.length, 1);
    assert.equal(inv.loaded[0].name, 'qwen2.5-coder:7b');
    assert.equal(inv.storage.modelCount, 2);
    assert.equal(inv.storage.totalBytes, 4700000000 + 9000000000);
    assert.equal(inv.vramBytes, 4800000000);
    assert.equal(inv.models[1].details?.parameter_size, '14.8B');
  });

  test('deleteModel — เรียก DELETE /api/delete ด้วยชื่อโมเดล', async () => {
    let captured: any = null;
    fakeAxios = {
      get: async () => ({ data: {} }),
      post: async () => ({ data: {} }),
      request: async (cfg: any) => { captured = cfg; return { data: {} }; },
    };
    const r = await deleteModel('deepseek-r1:14b');
    assert.equal(r.ok, true);
    assert.equal(captured.method, 'DELETE');
    assert.deepEqual(captured.data, { model: 'deepseek-r1:14b' });
  });

  test('unloadModelFromVram — POST /api/generate keep_alive:0', async () => {
    let capturedUrl = ''; let capturedBody: any = null;
    fakeAxios = {
      get: async () => ({ data: {} }),
      post: async (url: string, data: any) => { capturedUrl = url; capturedBody = data; return { data: {} }; },
      request: async () => ({ data: {} }),
    };
    const r = await unloadModelFromVram('qwen2.5-coder:7b');
    assert.equal(r.ok, true);
    assert.equal(capturedUrl, '/api/generate');
    assert.equal(capturedBody.keep_alive, 0);
    assert.equal(capturedBody.model, 'qwen2.5-coder:7b');
  });

  test('pullModel — stream NDJSON → progress percent ไต่ขึ้น + done', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', (async () => ndjsonResponse([
      { status: 'pulling manifest' },
      { status: 'downloading sha256:abc', digest: 'sha256:abc', total: 100, completed: 40 },
      { status: 'downloading sha256:abc', digest: 'sha256:abc', total: 100, completed: 100 },
      { status: 'success' },
    ])) as unknown as typeof fetch);
    try {
      const events: any[] = [];
      const r = await pullModel('qwen2.5:7b', (p) => events.push(p));
      assert.equal(r.ok, true);
      assert.equal(events.length, 4);
      assert.equal(events[1].percent, 40);
      assert.ok(events.some((e) => e.percent === 100));
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('pullModel — Ollama ตอบ error line → ok:false พร้อมข้อความ', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', (async () => ndjsonResponse([
      { error: 'pull model manifest: file does not exist' },
    ])) as unknown as typeof fetch);
    try {
      const r = await pullModel('nope:latest', () => {});
      assert.equal(r.ok, false);
      assert.match(r.error || '', /manifest/);
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('importGgufModel — ดาวน์โหลด gguf + เขียน Modelfile + create ผ่าน 2 เฟส', async () => {
    const ggufBytes = Buffer.from('GGUF-fake-'.repeat(100));
    const fetchMock = mock.method(globalThis, 'fetch', (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/api/create')) {
        assert.equal(init.method, 'POST');
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'kimi-k2:custom');
        assert.ok(body.modelfile.startsWith('FROM '));
        assert.ok(body.modelfile.includes('SYSTEM """ทดสอบ"""'));
        assert.ok(body.modelfile.replace(/\\\\/g, '\\').includes('.gguf'));
        return ndjsonResponse([{ status: 'reading model metadata' }, { status: 'verifying sha256 digest' }, { status: 'success' }]);
      }
      // gguf download
      return new Response(ggufBytes, { status: 200, headers: { 'content-length': String(ggufBytes.length) } });
    }) as unknown as typeof fetch);
    try {
      const phases: Array<{ phase: string; percent: number }> = [];
      const r = await importGgufModel(
        { modelName: 'kimi-k2:custom', ggufUrl: 'https://huggingface.co/test/model.gguf?download=true', systemPrompt: 'ทดสอบ' },
        (phase, p) => phases.push({ phase, percent: p.percent })
      );
      assert.equal(r.ok, true, r.error);
      assert.ok(fs.existsSync(r.filePath!));
      assert.ok(phases.some((p) => p.phase === 'download' && p.percent === 100));
      assert.ok(phases.some((p) => p.phase === 'create'));
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('importGgufModel — ปฏิเสธชื่อโมเดลที่มีอักขระแปลก', async () => {
    const r = await importGgufModel({ modelName: 'bad name;rm -rf', ggufUrl: 'https://x/y.gguf' }, () => {});
    assert.equal(r.ok, false);
    assert.match(r.error || '', /ชื่อโมเดล/);
  });

  test('describeError — ECONNREFUSED อธิบายเป็นภาษาคน', () => {
    const msg = describeError({ code: 'ECONNREFUSED' });
    assert.match(msg, /เชื่อมต่อ Ollama ไม่ได้/);
  });
});
