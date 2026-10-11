// tests/nodeKit.test.ts — ชุดติดตั้งเครื่องใหม่ที่ HUB เป็นคนเสิร์ฟ
//
// เจ้าของสั่ง 12/10/69: ตัวติดตั้งไฟล์เดียวต้องดึงชุดระบบจาก HUB เอง
//   (ไม่ใช่ให้เจ้าของก๊อปโฟลเดอร์ 700 MB ไปเอง)
//
// เทสต์นี้ล็อก (เงื่อนไขเดียวกับชุด desktop-update เพื่อให้ผู้ดูแลคาดเดาได้):
//   1) manifest เพี้ยน/ไม่ครบ = null ไม่ใช่ส่งต่อ
//   2) ไฟล์บนดิสก์ไม่ตรง manifest = ไม่ส่ง (fail-closed)
//   3) ไม่คืนพาธบนดิสก์ให้ client
//   4) enrollmentOpen ขาด = ถือว่าปิด (ไม่เดาว่าเปิด)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  readNodeKitManifest,
  resolveNodeKitAsset,
  resolveVerifiedNodeKitAsset,
  nodeKitManifestForClient,
  nodeKitSummary,
} from '../src/services/node-kit.service';

/** สร้างโฟลเดอร์ชุดติดตั้งปลอม + เขียนไฟล์จริงพร้อมแฮชที่ถูกต้อง */
function makeKit({ manifest = {}, body = 'kit-bytes', noFile = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-kit-'));
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  const name = 'node-kit.zip';
  const abs = path.join(dir, 'files', name);
  if (!noFile) fs.writeFileSync(abs, body);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const full = {
    version: '1.0.0',
    generatedAt: '2026-10-12T00:00:00.000Z',
    asset: { name, sha256, size: Buffer.byteLength(body) },
    entrypoint: 'SETUP-NODE.cmd',
    enrollmentOpen: true,
    ...manifest,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(full, null, 2));
  return { dir, abs, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('readNodeKitManifest', () => {
  it('อ่าน manifest ที่ครบ = ได้ข้อมูลครบ', () => {
    const k = makeKit();
    try {
      const m = readNodeKitManifest(k.dir);
      assert.ok(m);
      assert.equal(m.version, '1.0.0');
      assert.equal(m.asset.name, 'node-kit.zip');
      assert.match(m.asset.sha256, /^[0-9a-f]{64}$/);
      assert.equal(m.entrypoint, 'SETUP-NODE.cmd');
      assert.equal(m.enrollmentOpen, true);
    } finally {
      k.cleanup();
    }
  });

  it('ไม่มี manifest = null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-kit-empty-'));
    try {
      assert.equal(readNodeKitManifest(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('manifest เพี้ยน (JSON พัง) = null ไม่ใช่ throw', () => {
    const k = makeKit();
    try {
      fs.writeFileSync(path.join(k.dir, 'manifest.json'), '{ พัง');
      assert.equal(readNodeKitManifest(k.dir), null);
    } finally {
      k.cleanup();
    }
  });

  it('ชื่อไฟล์อันตราย (มี .. หรือพาธ) = ปฏิเสธ ไม่ใช่อ่านที่ไหนก็ได้', () => {
    for (const bad of ['../../etc/passwd', 'sub/dir.zip', 'C:\\x.zip', '']) {
      const k = makeKit({ manifest: { asset: { name: bad, sha256: 'a'.repeat(64), size: 10 } } });
      try {
        assert.equal(readNodeKitManifest(k.dir), null, `ชื่อ "${bad}" ต้องถูกปฏิเสธ`);
      } finally {
        k.cleanup();
      }
    }
  });

  it('แฮชผิดรูป = null', () => {
    const k = makeKit({ manifest: { asset: { name: 'node-kit.zip', sha256: 'ไม่ใช่แฮช', size: 10 } } });
    try {
      assert.equal(readNodeKitManifest(k.dir), null);
    } finally {
      k.cleanup();
    }
  });

  it('enrollmentOpen ไม่มีใน manifest = ถือว่าปิด (fail-closed ไม่ใช่เดาว่าเปิด)', () => {
    const k = makeKit();
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(k.dir, 'manifest.json'), 'utf8'));
      delete raw.enrollmentOpen;
      fs.writeFileSync(path.join(k.dir, 'manifest.json'), JSON.stringify(raw));
      const m = readNodeKitManifest(k.dir);
      assert.ok(m);
      assert.equal(m.enrollmentOpen, false, 'ไม่มีฟิลด์ = ต้องเป็น false ไม่ใช่ true');
    } finally {
      k.cleanup();
    }
  });
});

describe('resolveVerifiedNodeKitAsset — ไม่ส่งของที่ไม่ผ่าน', () => {
  it('ไฟล์ตรง manifest = ผ่าน', async () => {
    const k = makeKit();
    try {
      const r = await resolveVerifiedNodeKitAsset(k.dir);
      assert.ok(r);
      assert.equal(r.abs, k.abs);
      assert.match(r.sha256, /^[0-9a-f]{64}$/);
    } finally {
      k.cleanup();
    }
  });

  it('ไฟล์หายจากดิสก์ = ไม่ส่ง (คนได้ 404 ไม่ใช่ไฟล์เสีย)', async () => {
    const k = makeKit({ noFile: true });
    try {
      assert.equal(await resolveVerifiedNodeKitAsset(k.dir), null);
    } finally {
      k.cleanup();
    }
  });

  it('ไฟล์ถูกแก้หลังเผยแพร่ = ไม่ส่ง (สำคัญสุด: ของเสียต้องไม่ถึงเครื่องลูก)', async () => {
    const k = makeKit();
    try {
      fs.writeFileSync(k.abs, 'ถูกแก้ไปแล้ว');
      assert.equal(await resolveVerifiedNodeKitAsset(k.dir), null);
    } finally {
      k.cleanup();
    }
  });

  it('ขนาดไม่ตรง manifest = ไม่ส่ง', async () => {
    const k = makeKit();
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(k.dir, 'manifest.json'), 'utf8'));
      raw.asset.size = 999999;
      fs.writeFileSync(path.join(k.dir, 'manifest.json'), JSON.stringify(raw));
      assert.equal(await resolveVerifiedNodeKitAsset(k.dir), null);
    } finally {
      k.cleanup();
    }
  });

  it('ไม่มี manifest = ไม่ส่ง', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-kit-empty-'));
    try {
      assert.equal(resolveNodeKitAsset(dir), null);
      assert.equal(await resolveVerifiedNodeKitAsset(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('nodeKitManifestForClient — ห้ามเผยรายละเอียดเครื่อง HUB', () => {
  it('ไม่คืนพาธบนดิสก์ของ HUB', () => {
    const k = makeKit();
    try {
      const out = nodeKitManifestForClient(readNodeKitManifest(k.dir), '/api/node-kits/asset');
      assert.ok(out);
      const text = JSON.stringify(out);
      assert.ok(!text.includes(k.dir), 'ต้องไม่หลุดพาธเครื่อง HUB');
      assert.ok(!text.includes('files'), 'ต้องไม่หลุดโครงสร้างโฟลเดอร์ภายใน');
      assert.equal(out.assetUrl, '/api/node-kits/asset');
    } finally {
      k.cleanup();
    }
  });

  it('assetUrl ว่าง = client ต้องประกอบ URL เอง (HUB คนละทาง)', () => {
    const k = makeKit();
    try {
      const out = nodeKitManifestForClient(readNodeKitManifest(k.dir), '');
      assert.equal(out.assetUrl, '');
    } finally {
      k.cleanup();
    }
  });

  it('ไม่มี manifest = null', () => {
    assert.equal(nodeKitManifestForClient(null, '/x'), null);
  });

  it('entrypoint ขาด = บอกค่าเริ่มต้นให้ client (ไม่ใช่ undefined)', () => {
    const k = makeKit();
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(k.dir, 'manifest.json'), 'utf8'));
      delete raw.entrypoint;
      fs.writeFileSync(path.join(k.dir, 'manifest.json'), JSON.stringify(raw));
      const out = nodeKitManifestForClient(readNodeKitManifest(k.dir), '/x');
      assert.equal(out.entrypoint, 'SETUP-NODE.cmd');
    } finally {
      k.cleanup();
    }
  });
});

describe('nodeKitSummary — บอกคนดูแลได้ว่าทำอะไรต่อ', () => {
  it('ยังไม่เผยแพร่ = บอกวิธีทำ', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-kit-empty-'));
    try {
      const s = nodeKitSummary(dir);
      assert.equal(s.published, false);
      assert.match(s.hint, /build-node-kit/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('เผยแพร่แล้ว = มีเวอร์ชัน + แฮช + สถานะ enrollment', () => {
    const k = makeKit();
    try {
      const s = nodeKitSummary(k.dir);
      assert.equal(s.published, true);
      assert.equal(s.version, '1.0.0');
      assert.equal(s.enrollmentOpen, true);
    } finally {
      k.cleanup();
    }
  });
});
