// ─────────────────────────────────────────────────────────────
// POST /api/knowledge/import — SSRF
//
// เดิม route นี้เรียก axios.get(url) กับ URL ที่ผู้ใช้ส่งมาตรง ๆ ⇒ ผู้ใช้ที่ล็อกอิน
// คนเดียวก็สั่งให้เซิร์ฟเวอร์ยิง 127.0.0.1 / 169.254.169.254 / localhost ได้
// แล้วเนื้อหาที่ตอบกลับถูกเก็บเป็น content ของ item (อ่านย้อนหลังได้)
// = อ่าน API ภายใน/cloud metadata ผ่านเซิร์ฟเวอร์
//
// กติกาเดียวกับ /api/vision/analyze-url: loopback/link-local/metadata/URL ที่ฝังรหัสผ่าน
// ต้องไม่ถูกยิงออกไป (LAN ยังอนุญาต เพราะกล้อง/วิกิในบ้านคือการใช้งานจริง)
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'content-type': 'application/json' };

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-knowledge-ssrf-'));
  process.env.KNOWLEDGE_DIR = dir;
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });

  mockModel(prisma, 'knowledgeItem', {
    create: async ({ data }: any) => ({ id: 'k-1', created_at: new Date(), updated_at: new Date(), ...data }),
    findMany: async () => [],
    findUnique: async () => null,
    update: async () => null,
    delete: async () => null,
    count: async () => 0,
  });

  const knowledgeRoutes = (await import('../src/modules/knowledge/knowledge.routes')).default;
  server = await createTestServer((app) => app.use('/api/knowledge', knowledgeRoutes));
});

after(async () => {
  if (server) await server.close();
});

function importUrl(url: string) {
  return fetch(`${server.baseUrl}/api/knowledge/import`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ url }),
  });
}

test('import: ปฏิเสธ loopback / localhost / cloud metadata ก่อนยิง request', async () => {
  const blocked = [
    'http://127.0.0.1:3001/api/system/truth',
    'http://localhost:3001/api/health',
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://[::1]:3001/api/health',
    'http://user:pass@example.com/page',
  ];

  for (const url of blocked) {
    const res = await importUrl(url);
    assert.equal(res.status, 400, `ต้องปฏิเสธ ${url} ที่ชั้นตรวจ URL (ได้ ${res.status})`);
  }
});

test('import: scheme ที่ไม่ใช่ http(s) ยังถูกปฏิเสธเหมือนเดิม', async () => {
  const res = await importUrl('file:///etc/passwd');
  assert.equal(res.status, 400);
});
