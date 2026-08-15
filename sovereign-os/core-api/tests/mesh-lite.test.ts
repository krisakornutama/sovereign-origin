import './setup-env';
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  ensureMeshKey,
  meshKeyFingerprint,
  meshEncrypt,
  meshDecrypt,
  MeshLiteService,
  meshLiteService,
} from '../src/services/mesh-lite.service';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-mesh-'));

function freshDirs(): { backupDir: string; meshDir: string; outputDir: string; keyFile: string; stateFile: string } {
  const base = path.join(TMP, `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const backupDir = path.join(base, 'backups');
  const meshDir = path.join(base, 'mesh');
  const outputDir = path.join(base, 'offsite');
  const keyFile = path.join(base, 'mesh-key');
  const stateFile = path.join(base, 'mesh-state.json');
  fs.mkdirSync(backupDir, { recursive: true });
  return { backupDir, meshDir, outputDir, keyFile, stateFile };
}

function writeFakeBackup(backupDir: string): void {
  fs.writeFileSync(path.join(backupDir, 'sovereign_backup_20260815_020000.sql.gz'), Buffer.from('FAKE-DB-DUMP-CONTENT'));
  fs.writeFileSync(path.join(backupDir, 'sovereign_state_20260815_020000.json.gz'), Buffer.from('{"files":[]}'));
}

describe('Mesh Lite: crypto (AES-256-GCM)', () => {
  test('ensureMeshKey สร้าง key 64 hex + อ่านซ้ำได้ค่าเดิม', () => {
    const keyFile = path.join(TMP, `key-${Math.random()}`);
    const k1 = ensureMeshKey(keyFile);
    assert.match(k1, /^[0-9a-f]{64}$/);
    assert.equal(ensureMeshKey(keyFile), k1);
    assert.equal(meshKeyFingerprint(k1), meshKeyFingerprint(k1));
    assert.match(meshKeyFingerprint(k1), /^[0-9a-f]{16}$/);
    fs.rmSync(keyFile, { force: true });
  });

  test('encrypt → decrypt ได้ข้อมูลเดิม', () => {
    const key = ensureMeshKey(path.join(TMP, `key2-${Math.random()}`));
    const buf = Buffer.from('sovereign mesh payload — ข้อมูลลับ');
    const blob = meshEncrypt(buf, key);
    assert.notEqual(blob, buf.toString('base64'));
    const back = meshDecrypt(blob, key);
    assert.equal(back.toString('utf8'), buf.toString('utf8'));
  });

  test('key ผิด / ข้อมูลโดนแก้ → ถอดรหัสไม่ได้ (GCM tamper-proof)', () => {
    const key = ensureMeshKey(path.join(TMP, `key3-${Math.random()}`));
    const other = ensureMeshKey(path.join(TMP, `key4-${Math.random()}`));
    const blob = meshEncrypt(Buffer.from('secret'), key);
    assert.throws(() => meshDecrypt(blob, other), /unable to authenticate|Wrong final block|bad decrypt|ผิดรูปแบบ/i);
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length - 1] ^= 0xff; // แก้ ciphertext ไบต์สุดท้าย (ในขอบ buffer)
    assert.throws(() => meshDecrypt(raw.toString('base64'), key));
  });
});

describe('Mesh Lite: bundle + replicate (sandbox dirs)', () => {
  after(() => {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {}
  });

  test('createBundle: สร้าง .enc.json + manifest ตรง + decrypt กลับได้', () => {
    const d = freshDirs();
    writeFakeBackup(d.backupDir);
    const svc = new MeshLiteService({ ...d, enabled: true });
    const info = svc.createBundle();
    assert.ok(info);
    assert.equal(info!.dbFile, 'sovereign_backup_20260815_020000.sql.gz');
    assert.equal(info!.dbSha256.length, 64);
    assert.ok(info!.payloadSize > 0);

    const file = path.join(d.meshDir, info!.file);
    assert.ok(fs.existsSync(file));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(raw.format, 'sovereign-mesh-v1');
    assert.equal(raw.keyFingerprint, meshKeyFingerprint(ensureMeshKey(d.keyFile)));

    const plain = gunzipSync(meshDecrypt(raw.payload, ensureMeshKey(d.keyFile))).toString('utf8');
    const payload = JSON.parse(plain);
    assert.equal(payload.db.file, 'sovereign_backup_20260815_020000.sql.gz');
    assert.equal(Buffer.from(payload.db.data, 'base64').toString(), 'FAKE-DB-DUMP-CONTENT');
    assert.ok(payload.state);
  });

  test('replicate: stage ไปปลายทาง (NAS/USB mount) + state อัปเดต', async () => {
    const d = freshDirs();
    writeFakeBackup(d.backupDir);
    const svc = new MeshLiteService({ ...d, enabled: true });
    const r = await svc.replicate();
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(d.outputDir, r.info!.file)));
    assert.equal(svc.status().lastSuccessAt, svc.status().lastReplicateAt);
    assert.equal(svc.status().lastError, null);
  });

  test('push ไป remote (http mock) พร้อม Bearer token + payload ครบ', async () => {
    let received: any = null;
    let authHeader: string | null = null;
    const server = http.createServer((req, res) => {
      authHeader = req.headers.authorization || null;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const d = freshDirs();
      writeFakeBackup(d.backupDir);
      const svc = new MeshLiteService({ ...d, enabled: true, pushUrl: `http://127.0.0.1:${port}/mesh`, pushToken: 'tok-secret' });
      const r = await svc.replicate();
      assert.equal(r.ok, true);
      assert.equal(authHeader, 'Bearer tok-secret');
      assert.ok(received);
      assert.equal(received.format, 'sovereign-mesh-v1');
      assert.ok(received.payload);
      assert.ok(received.manifest.dbSha256);
      assert.equal(received.manifest.dbFile, 'sovereign_backup_20260815_020000.sql.gz');
    } finally {
      server.close();
    }
  });

  test('push ล้มเหลว → lastError + ok=false', async () => {
    const d = freshDirs();
    writeFakeBackup(d.backupDir);
    const svc = new MeshLiteService({ ...d, enabled: true, pushUrl: 'http://127.0.0.1:1/nope' });
    const r = await svc.replicate();
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    assert.ok(svc.status().lastError);
  });

  test('ยังไม่ตั้งปลายทาง → ปฏิเสธ replicate (ไม่มีอะไรหลุด)', async () => {
    const d = freshDirs();
    writeFakeBackup(d.backupDir);
    const svc = new MeshLiteService({ ...d, enabled: true, outputDir: null, pushUrl: null });
    const r = await svc.replicate();
    assert.equal(r.ok, false);
    assert.match(r.reason!, /ปลายทาง/);
  });

  test('disabled → ปฏิเสธทุกอย่าง', async () => {
    const d = freshDirs();
    writeFakeBackup(d.backupDir);
    const svc = new MeshLiteService({ ...d, enabled: false });
    const r = await svc.replicate();
    assert.equal(r.ok, false);
    assert.match(r.reason!, /ปิด/);
  });

  test('retention: เก็บ MESH_RETAIN ล่าสุด', () => {
    const d = freshDirs();
    const svc = new MeshLiteService({ ...d, enabled: true, minIntervalMs: 0 });
    writeFakeBackup(d.backupDir);
    for (let i = 0; i < 3; i++) {
      svc.createBundle();
      fs.writeFileSync(path.join(d.backupDir, `sovereign_backup_2026081${i}_020000.sql.gz`), Buffer.from(`dump-${i}`));
    }
    // createBundle เรียก applyRetention หลังเขียน — เก็บ 30 (ค่าเริ่มต้น) → ยังมี 3
    assert.equal(svc.listBundles().length, 3);
  });

  test('hasPendingBackup: backup ใหม่กว่า bundle ล่าสุด', () => {
    const d = freshDirs();
    const svc = new MeshLiteService({ ...d, enabled: true });
    writeFakeBackup(d.backupDir);
    svc.createBundle();
    assert.equal(svc.hasPendingBackup(), false);
    fs.writeFileSync(path.join(d.backupDir, 'sovereign_backup_20260816_020000.sql.gz'), Buffer.from('newer'));
    assert.equal(svc.hasPendingBackup(), true);
  });

  test('singleton status() ทำงาน (ไม่มี crash — ใช้ค่าเริ่มต้นจริง)', () => {
    const st = meshLiteService.status();
    assert.equal(typeof st.enabled, 'boolean');
    assert.ok(Array.isArray(st.bundles));
  });
});