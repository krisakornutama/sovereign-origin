// tests/agentUpdate.test.ts — ชุดอัปเดตโค้ด runner ที่เครื่องลูกดึงไปเอง
//
// ของที่ต้องจับ (route นี้เป็นทางเข้าถึง HUB จึงต้องกันให้แน่น):
//   1) ต้องถามชื่อไฟล์ที่ "อยู่ใน manifest เท่านั้น" — ไฟล์อื่นบนเครื่อง HUB อ่านไม่ได้
//   2) ชื่อไฟล์ที่มีทางลัดออกนอกโฟลเดอร์ (`..`, absolute, ไดรฟ์) ต้องถูกปฏิเสธ
//   3) ไฟล์บนดิสก์ถูกแก้หลังเผยแพร่ = ต้องไม่ส่งออก (เครื่องลูกจะได้ไม่อัปเดตเป็นโค้ดที่ไม่มีใครรับรอง)
//   4) ไม่มี token ของเครื่อง = 401 ทุกเส้น (ชุดโค้ดนี้เป็นข้อมูลของทั้งระบบ)
import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createTestServer, makeToken, mockModel } from './helpers';
import { prisma } from '../src/lib/prisma';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// Phase 3A: route ตรวจลายเซ็นด้วย public key — เทสต์ใช้ key ชั่วคราวของตัวเอง
const TEST_KEY_ID = 'test-key';
const TEST_PAIR = generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = TEST_PAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.AGENT_UPDATE_PUBLIC_KEY = TEST_PUBLIC_PEM;
process.env.AGENT_UPDATE_PUBLIC_KEY_ID = TEST_KEY_ID;

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-update-test-'));
process.env.AGENT_UPDATE_DIR = ROOT;

/** canonical payload ต้องตรงกับ update-manifest-trust.service.ts */
function manifestPayload(manifest: { version: string; generatedAt: string; files: Array<{ path: string; sha256: string; size: number }> }) {
  return Buffer.from(
    JSON.stringify({
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      files: manifest.files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    }),
    'utf8',
  );
}

function signTestManifest<T extends { version: string; generatedAt: string; files: Array<{ path: string; sha256: string; size: number }> }>(manifest: T) {
  return {
    ...manifest,
    signature: {
      alg: 'ed25519',
      keyId: TEST_KEY_ID,
      value: sign(null, manifestPayload(manifest), TEST_PAIR.privateKey).toString('base64'),
    },
  };
}

// ตั้งค่า env ก่อนจะ require เพราะ service อ่านค่านี้ตอนโหลดโมดูล
const serviceMod = require('../src/services/agent-update.service') as typeof import('../src/services/agent-update.service');
const readUpdateManifest = serviceMod.readUpdateManifest as (root?: string) => import('../src/services/agent-update.service').UpdateManifest | null;
const resolveUpdateFile = serviceMod.resolveUpdateFile as (rel: string, root?: string, manifest?: import('../src/services/agent-update.service').UpdateManifest | null) => { abs: string; entry: import('../src/services/agent-update.service').UpdateFileEntry } | null;
const isSafeRelPath = serviceMod.isSafeRelPath as (rel: unknown) => boolean;
const updateSummary = serviceMod.updateSummary as (root?: string) => Readonly<{ published: boolean; version?: string; generatedAt?: string; fileCount?: number; totalBytes?: number; root: string; hint?: string }>;

const FILES: Record<string, string> = {
  'src/main.mjs': 'export const a = 1;\n',
  'package.json': '{ "name": "runner" }\n',
};

/** จำลองโฟลเดอร์ที่ตัวแพ็กเขียนไว้ (manifest.json + files/) */
function seedBundle(files: Record<string, string> = FILES, version = 'v-test-1') {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const entries = Object.entries(files).map(([rel, body]) => {
    const abs = path.join(ROOT, 'files', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return { path: rel, sha256: sha256(body), size: Buffer.byteLength(body) };
  });
  fs.mkdirSync(ROOT, { recursive: true });
  const manifest = signTestManifest({ version, generatedAt: '2026-01-01T00:00:00.000Z', files: entries });
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { version, entries, manifest };
}

beforeEach(() => {
  mockModel(prisma as any, 'agentMachine', {
    findFirst: async () => ({ id: 'm-1', name: 'runner-a', status: 'online', executors: ['echo'] }),
    findUnique: async () => ({ id: 'm-1', name: 'runner-a', status: 'online', executors: ['echo'] }),
    update: async (args: any) => ({ id: 'm-1', ...args.data }),
  });
});

describe('agent-update service', () => {
  test('อ่าน manifest ที่ยังไม่มี/ไฟล์เสีย = null (ไม่โยน error ให้ route พัง)', () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    assert.equal(readUpdateManifest(ROOT), null, 'ยังไม่มีไฟล์');
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), '{ ไม่ใช่ json');
    assert.equal(readUpdateManifest(ROOT), null, 'json เสีย');
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify({ version: 'v', files: [] }));
    assert.equal(readUpdateManifest(ROOT), null, 'ไม่มีไฟล์ในชุด');
    const seeded = seedBundle();
    assert.equal(readUpdateManifest(ROOT)?.version, seeded.version);
  });

  test('ชื่อไฟล์ที่ยอมรับ: เฉพาะ relative และไม่มีทางลัดออกนอกโฟลเดอร์', () => {
    for (const ok of ['src/main.mjs', 'package.json', 'run-runner.cmd']) assert.equal(isSafeRelPath(ok), true, ok);
    for (const bad of ['../secret.mjs', 'src/../../secret.mjs', '/etc/passwd', 'C:\\Windows\\win.ini', 'src/ไฟล์.mjs', '', null, 42]) {
      assert.equal(isSafeRelPath(bad as unknown), false, String(bad));
    }
    assert.equal(isSafeRelPath('src\\main.mjs'), true, 'แบ็กสแลชจาก Windows ใช้ได้ (แปลงเป็น / ก่อนตรวจ)');
  });

  test('ให้บริการเฉพาะไฟล์ที่อยู่ในชุด — ไฟล์อื่นบนเครื่อง HUB อ่านไม่ได้', () => {
    seedBundle();
    // ไฟล์ที่มีอยู่จริงบนดิสก์แต่ "ไม่อยู่ในชุด" ห้ามให้บริการ
    fs.writeFileSync(path.join(ROOT, 'files', 'secret.env'), 'TOKEN=xxxx\n');
    assert.equal(resolveUpdateFile('secret.env', ROOT), null);
    assert.equal(resolveUpdateFile('src/main.mjs', ROOT)?.abs, path.join(ROOT, 'files', 'src', 'main.mjs'));
    assert.equal(resolveUpdateFile('../manifest.json', ROOT), null, 'ออกนอกโฟลเดอร์');
    assert.equal(resolveUpdateFile('src/nope.mjs', ROOT), null, 'ไม่อยู่ในชุด');
  });

  test('ไฟล์ในชุดหายจากดิสก์ = บอกว่าไม่มี (ไม่คืนพาธไปให้อ่านพลาด)', () => {
    seedBundle();
    fs.rmSync(path.join(ROOT, 'files', 'package.json'));
    assert.equal(resolveUpdateFile('package.json', ROOT), null);
    assert.equal(updateSummary(ROOT).published, true, 'manifest ยังอยู่ → ยังถือว่าเผยแพร่แล้ว (ไฟล์นั้นจะตอบ 404)');
  });

  test('สรุปชุดอัปเดต + คำแนะนำเมื่อยังไม่เผยแพร่', () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    const empty = updateSummary(ROOT);
    assert.equal(empty.published, false);
    assert.match(String(empty.hint), /pack\.mjs/);
    seedBundle(FILES, 'v-abc');
    const sum = updateSummary(ROOT);
    assert.equal(sum.published, true);
    assert.equal(sum.version, 'v-abc');
    assert.equal(sum.fileCount, 2);
    assert.ok(sum.totalBytes > 0);
  });
});

describe('agent-update routes (machine token)', () => {
  const loadRouter = () => {
    const mod = require('../src/modules/agent-machines/agent-machines.routes');
    return mod.default;
  };

  async function call(router: unknown, method: 'GET', url: string, token?: string) {
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router as never));
    try {
      const headers: Record<string, string> = {};
      if (token) headers['x-machine-token'] = token;
      const res = await fetch(`${srv.baseUrl}${url}`, { method, headers });
      return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') || '' };
    } finally {
      await srv.close();
    }
  }

  test('ไม่มี token = 401 ทั้ง manifest และ file', async () => {
    seedBundle();
    const router = loadRouter();
    assert.equal((await call(router, 'GET', '/api/agent-machines/update/manifest')).status, 401);
    assert.equal((await call(router, 'GET', '/api/agent-machines/update/file?path=src/main.mjs')).status, 401);
  });

  test('มี token = ได้ manifest ของชุดที่เผยแพร่ (ไม่ต้องมี DB อะไรเพิ่ม)', async () => {
    const seeded = seedBundle(FILES, 'v-live');
    const token = await makeToken();
    const res = await call(loadRouter(), 'GET', '/api/agent-machines/update/manifest', token);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body.version, 'v-live');
    assert.deepEqual(body.files.map((f: { path: string }) => f.path), seeded.entries.map((e) => e.path));
    assert.equal(body.files[0].sha256, seeded.entries[0].sha256);
    assert.equal(body.signature.alg, 'ed25519');
    assert.equal(body.signature.keyId, TEST_KEY_ID);
    assert.equal(
      verify(null, manifestPayload(body), TEST_PAIR.publicKey, Buffer.from(body.signature.value, 'base64')),
      true,
      'manifest ที่ HUB ส่งออกต้องมีลายเซ็นที่ตรวจได้ด้วย public key ที่ runner ถือ',
    );
  });

  test('manifest ที่ไม่ได้ลงนาม/ถูกแก้หลังเซ็น = 503 ไม่ส่งต่อให้ runner', async () => {
    const seeded = seedBundle(FILES, 'v-unsigned');
    const router = loadRouter();
    const token = await makeToken();
    const manifestPath = path.join(ROOT, 'manifest.json');
    const original = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    delete original.signature;
    fs.writeFileSync(manifestPath, JSON.stringify(original, null, 2));
    const unsigned = await call(router, 'GET', '/api/agent-machines/update/manifest', token);
    assert.equal(unsigned.status, 503);
    assert.match(unsigned.text, /not signed|unsigned/i);

    const unsignedFile = await call(
      router,
      'GET',
      `/api/agent-machines/update/file?path=${encodeURIComponent(seeded.entries[0].path)}`,
      token,
    );
    assert.equal(unsignedFile.status, 503, 'manifest ไม่ผ่าน trust = ต้องไม่เสิร์ฟไฟล์โค้ดออกไป');

    const tampered = seeded.manifest;
    tampered.files[0].sha256 = '00'.repeat(32);
    fs.writeFileSync(manifestPath, JSON.stringify(tampered, null, 2));
    const bad = await call(router, 'GET', '/api/agent-machines/update/manifest', token);
    assert.equal(bad.status, 503);
    assert.match(bad.text, /bad-signature|not signed/i);
  });

  test('ยังไม่เผยแพร่ชุด = 404 พร้อมบอกวิธีเผยแพร่ (ไม่ใช่ 500)', async () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    const res = await call(loadRouter(), 'GET', '/api/agent-machines/update/manifest', await makeToken());
    assert.equal(res.status, 404);
    assert.match(res.text, /pack\.mjs/);
  });

  test('ดาวน์โหลดไฟล์ในชุดได้เนื้อตรงเป๊ะ · ชื่อแปลก/อยู่นอกชุด = 4xx', async () => {
    seedBundle();
    const token = await makeToken();
    const router = loadRouter();
    const ok = await call(router, 'GET', '/api/agent-machines/update/file?path=src/main.mjs', token);
    assert.equal(ok.status, 200);
    assert.equal(ok.text, FILES['src/main.mjs']);
    assert.match(ok.contentType, /text\/plain/);

    assert.equal((await call(router, 'GET', '/api/agent-machines/update/file?path=../manifest.json', token)).status, 400);
    assert.equal((await call(router, 'GET', '/api/agent-machines/update/file?path=secret.env', token)).status, 404);
    assert.equal((await call(router, 'GET', '/api/agent-machines/update/file', token)).status, 400);
  });

  test('ไฟล์บนดิสก์ถูกแก้หลังเผยแพร่ = ไม่ส่งออก (500) — เครื่องลูกจะไม่ได้โค้ดที่ไม่มีใครรับรอง', async () => {
    seedBundle();
    fs.appendFileSync(path.join(ROOT, 'files', 'src/main.mjs'), '// แก้ทีหลัง\n');
    const res = await call(loadRouter(), 'GET', '/api/agent-machines/update/file?path=src/main.mjs', await makeToken());
    assert.equal(res.status, 500);
    assert.match(res.text, /manifest/);
  });
});
