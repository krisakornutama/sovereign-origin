// SEC-045: `POST /api/ai-models/models/import-gguf` ให้ผู้ใช้กำหนด URL ที่เซิร์ฟเวอร์
// ไปดาวน์โหลดเอง — ถ้าไม่กรอง จะยิงเข้า loopback/docker/metadata ได้ (SSRF)
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import aiModelRoutes from '../src/modules/ai-models/ai-models.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

let api: TestServer;

before(async () => {
  api = await createTestServer((app) => app.use('/api/ai-models', aiModelRoutes));
});

after(async () => {
  if (api) await api.close();
});

function importGguf(ggufUrl: string, token?: string) {
  return fetch(api.baseUrl + '/api/ai-models/models/import-gguf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ modelName: 'ssrf-probe', ggufUrl }),
  });
}

test('import-gguf: URL ที่ชี้เข้า loopback/docker ภายใน = 400 (ไม่สร้าง job)', async () => {
  const blocked = [
    'http://127.0.0.1:3001/api/health',
    'http://localhost:11434/api/tags',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.7/model.gguf',
    'http://192.168.1.10/model.gguf',
    'http://[::1]/model.gguf',
  ];
  for (const url of blocked) {
    const res = await importGguf(url, makeToken('SUPERADMIN'));
    assert.equal(res.status, 400, url);
    const body = (await res.json()) as { jobId?: string };
    assert.equal(body.jobId, undefined, `${url} ต้องไม่สร้าง job`);
  }
});

test('import-gguf: URL ที่ไม่ใช่ http(s) = 400', async () => {
  const res = await importGguf('file:///etc/passwd', makeToken('SUPERADMIN'));
  assert.equal(res.status, 400);
});

test('import-gguf: ไม่ใช่ SUPERADMIN = 403 (ด่าน role ยังอยู่)', async () => {
  const res = await importGguf('http://127.0.0.1:3001/x', makeToken('OPERATOR'));
  assert.equal(res.status, 403);
});
