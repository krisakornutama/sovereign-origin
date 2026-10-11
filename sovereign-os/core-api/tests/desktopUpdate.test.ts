// tests/desktopUpdate.test.ts — ชุดอัปเดต "แอปเดสก์ท็อป" (HUB เป็นแหล่งอัปเดตของแอป)
//
// เจ้าของสั่ง 11/10/69: "ผมหมายถึง app desktop ที่จะไปติดตั้งอีกเครื่อง" ⇒ HUB ต้องเป็น
// แหล่งอัปเดตของตัวแอปได้ (เครื่องปลายทางถามก่อน แล้วค่อยตกไป GitHub)
//
// ของที่ต้องจับ (route นี้เปิดทางให้เครื่องในวงดึงไฟล์ติดตั้งของทั้งระบบ):
//   1) ยังไม่เผยแพร่ = 404 (ไม่ใช่ 500/ค้าง) — แอปจะได้ตกไปเช็ค GitHub แทนได้
//   2) ต้องมี machine token เท่านั้น — ไม่มี = 401
//   3) ไฟล์บนดิสก์ถูกแก้หลังเผยแพร่ = ต้องไม่ส่งออก (fail-closed)
//   4) ชื่อไฟล์ใน manifest ต้องไม่มีทางลัดออกนอกโฟลเดอร์ (route นี้เข้าถึงได้จากวง LAN)
import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mockModel, createTestServer } from './helpers';
import { prisma } from '../src/lib/prisma';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-update-test-'));
process.env.DESKTOP_UPDATE_DIR = ROOT; // ต้องตั้งก่อน require — service อ่านค่าตอนโหลดโมดูล

const svc = require('../src/services/desktop-update.service') as typeof import('../src/services/desktop-update.service');
const readDesktopManifest = svc.readDesktopManifest as (root?: string) => import('../src/services/desktop-update.service').DesktopUpdateManifest | null;
const isSafeAssetName = svc.isSafeAssetName as (name: unknown) => boolean;
const resolveVerifiedDesktopAsset = svc.resolveVerifiedDesktopAsset as (
  root?: string,
  manifest?: import('../src/services/desktop-update.service').DesktopUpdateManifest | null,
) => Promise<{ abs: string; entry: import('../src/services/desktop-update.service').DesktopAssetEntry } | null>;

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ASSET_NAME = 'Sovereign-OS-1.1.1-portable.exe';

/** จำลองโฟลเดอร์ที่ตัวประกอบ (PACK-DESKTOP.mjs) เขียนไว้ */
function seedPublished(body = 'MZ-fake-portable-app', name = ASSET_NAME) {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const abs = path.join(ROOT, 'files', name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  fs.writeFileSync(
    path.join(ROOT, 'manifest.json'),
    JSON.stringify(
      {
        version: '1.1.1',
        generatedAt: '2026-10-11T00:00:00.000Z',
        asset: { name, sha256: sha256(body), size: Buffer.byteLength(body) },
        notes: 'แอปเดสก์ท็อป v1.1.1',
      },
      null,
      2,
    ),
  );
  return { abs, body };
}

function loadRouter() {
  const mod = require('../src/modules/agent-machines/agent-machines.routes');
  return mod.default;
}

beforeEach(() => {
  // route ใช้ machine token → ต้องมีแถวเครื่องให้ authenticateToken หาเจอ
  mockModel(prisma as any, 'agentMachine', {
    findFirst: async () => ({ id: 'm-1', name: 'คอมเครื่องที่ 2', status: 'online', executors: ['echo'] }),
    findMany: async () => [],
    update: async (args: any) => ({ id: 'm-1', ...args.data }),
  });
});

describe('desktop-update service', () => {
  test('ยังไม่เผยแพร่/ไฟล์เสีย = null (ไม่โยน error ให้ route พัง)', () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    assert.equal(readDesktopManifest(ROOT), null, 'ยังไม่มี manifest');
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), '{ ไม่ใช่ json');
    assert.equal(readDesktopManifest(ROOT), null, 'json เสีย');
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
    assert.equal(readDesktopManifest(ROOT), null, 'ไม่มี asset');
    seedPublished();
    assert.equal(readDesktopManifest(ROOT)?.version, '1.1.1');
  });

  test('ชื่อไฟล์ใน manifest: เฉพาะชื่อไฟล์เดี่ยว (กัน path traversal / ไดรฟ์)', () => {
    assert.equal(isSafeAssetName(ASSET_NAME), true, 'ชื่อปกติต้องผ่าน');
    assert.equal(isSafeAssetName('..\\..\\windows\\system32\\x.exe'), false);
    assert.equal(isSafeAssetName('sub/dir/app.exe'), false);
    assert.equal(isSafeAssetName('C:app.exe'), false);
    assert.equal(isSafeAssetName(''), false);
  });

  test('ไฟล์ตรงแฮช = ส่งได้ · ไฟล์ถูกแก้ = ปฏิเสธ (fail-closed)', async () => {
    seedPublished('MZ-good');
    const ok = await resolveVerifiedDesktopAsset(ROOT);
    assert.ok(ok, 'manifest กับไฟล์ตรงกันต้องส่งออกได้');
    assert.equal(ok?.entry.name, ASSET_NAME);

    // ไฟล์ถูกแก้หลังเผยแพร่ (คนละความยาว → ไม่เกี่ยวกับแคชแฮชด้วย)
    fs.writeFileSync(path.join(ROOT, 'files', ASSET_NAME), 'MZ-tampered-content-longer');
    assert.equal(await resolveVerifiedDesktopAsset(ROOT), null, 'แฮชไม่ตรง = ห้ามส่งออก');
  });
});

describe('desktop-update routes (เครื่องปลายทางดึงจาก HUB)', () => {
  test('ไม่มี machine token = 401 ทั้งสองเส้น', async () => {
    seedPublished();
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const a = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/manifest`);
      const b = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/asset`);
      assert.equal(a.status, 401);
      assert.equal(b.status, 401);
    } finally {
      await srv.close();
    }
  });

  test('ยังไม่เผยแพร่ = 404 ไม่ใช่ 500 (แอปตกไป GitHub ต่อได้)', async () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/manifest`, {
        headers: { 'x-machine-token': 'valid-token' },
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as any;
      assert.match(String(body.hint ?? ''), /PACK-DESKTOP/, 'ต้องบอกวิธีเผยแพร่ให้เครื่องปลายทางอัปเดตได้');
    } finally {
      await srv.close();
    }
  });

  test('เผยแพร่แล้ว: manifest + ตัวติดตั้งส่งออกได้ครบไบต์', async () => {
    const seeded = seedPublished('MZ-portable-bytes-1234567890');
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const m = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/manifest`, {
        headers: { 'x-machine-token': 'valid-token' },
      });
      assert.equal(m.status, 200);
      const manifest = (await m.json()) as any;
      assert.equal(manifest.version, '1.1.1');
      assert.equal(manifest.asset.name, ASSET_NAME);
      assert.equal(manifest.asset.sha256, sha256(seeded.body));

      const a = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/asset`, {
        headers: { 'x-machine-token': 'valid-token' },
      });
      assert.equal(a.status, 200);
      assert.equal(a.headers.get('content-length'), String(Buffer.byteLength(seeded.body)));
      assert.match(String(a.headers.get('content-disposition') ?? ''), /Sovereign-OS-1\.1\.1-portable\.exe/);
      const got = Buffer.from(await a.arrayBuffer());
      assert.equal(got.length, Buffer.byteLength(seeded.body), 'ต้องได้ไฟล์เต็ม (stream ไม่ตัด)');
      assert.equal(sha256(got), sha256(seeded.body), 'ไบต์ที่ส่งต้องตรงแฮชใน manifest');
    } finally {
      await srv.close();
    }
  });

  test('ไฟล์ถูกแก้หลังเผยแพร่ = 404 (ไม่ส่งของที่ไม่มีใครรับรอง)', async () => {
    seedPublished('MZ-original');
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      fs.writeFileSync(path.join(ROOT, 'files', ASSET_NAME), 'MZ-swapped-after-publish-longer');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/desktop-update/asset`, {
        headers: { 'x-machine-token': 'valid-token' },
      });
      assert.equal(res.status, 404);
    } finally {
      await srv.close();
    }
  });
});
