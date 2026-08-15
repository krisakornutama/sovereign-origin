import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Data Integrity Guard (Phase 6 — NAND Flash / Silent Bit Rot)', () => {
  let testDir: string;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-bitrot-'));
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('saveJsonAtomic + readJsonVerified: roundtrip ตรงกัน', async () => {
    const { saveJsonAtomic, readJsonVerified, sha256 } = await import('../src/services/data-integrity.service');
    const file = path.join(testDir, 'state.json');
    const data = { active: true, count: 42, nested: { a: [1, 2, 3] } };
    saveJsonAtomic(file, data);
    assert.ok(fs.existsSync(`${file}.sha256`), 'ต้องมี sidecar checksum');
    const sidecar = fs.readFileSync(`${file}.sha256`, 'utf8').trim();
    assert.equal(sidecar, sha256(JSON.stringify(data, null, 2)));
    const { ok, data: loaded, rot } = readJsonVerified<typeof data>(file);
    assert.equal(ok, true);
    assert.equal(rot, false);
    assert.deepEqual(loaded, data);
  });

  test('อ่านไฟล์ที่ "เพี้ยนเงียบ" (bit เปลี่ยน) → จับ rot ได้ทันที', async () => {
    const { saveJsonAtomic, readJsonVerified } = await import('../src/services/data-integrity.service');
    const file = path.join(testDir, 'rot.json');
    saveJsonAtomic(file, { value: 1 });
    // จำลอง bit rot: แก้ไฟล์โดยไม่แตะ sidecar (OS ไม่มี error — เหมือน NAND เสื่อม)
    fs.writeFileSync(file, '{"value": 0}', 'utf8');
    const { ok, rot } = readJsonVerified(file);
    assert.equal(ok, false);
    assert.equal(rot, true, 'ต้องตรวจจับได้ว่าไฟล์เพี้ยน');
  });

  test('ไฟล์เก่าไม่มี sidecar → ยังอ่านได้ + ขึ้น baseline ได้ (ไม่ตีเป็น rot)', async () => {
    const { readJsonVerified } = await import('../src/services/data-integrity.service');
    const file = path.join(testDir, 'legacy.json');
    fs.writeFileSync(file, '{"legacy": true}', 'utf8');
    const { ok, rot } = readJsonVerified(file);
    assert.equal(ok, true, 'ไฟล์เก่าที่ไม่มี sidecar ยังต้องอ่านได้');
    assert.equal(rot, false, 'ไม่มี sidecar = ยังไม่รู้ว่าพัง (ไม่ตีความผิด)');
  });

  test('quarantineCorrupt: สำรองไฟล์เสียไว้ ไม่ลบทิ้ง', async () => {
    const { saveJsonAtomic, quarantineCorrupt } = await import('../src/services/data-integrity.service');
    const file = path.join(testDir, 'q.json');
    saveJsonAtomic(file, { x: 1 });
    const dest = quarantineCorrupt(file);
    assert.ok(dest, 'ต้องสำรองไฟล์ได้');
    assert.ok(fs.existsSync(dest!));
    assert.ok(fs.existsSync(file), 'ไฟล์เดิมยังอยู่');
  });

  test('runBitRotScan: สแกน data/ จริง + สร้าง baseline ไฟล์เก่า (raiseAlerts=false ไม่แตะ DB)', async () => {
    const { runBitRotScan } = await import('../src/services/data-integrity.service');
    const r = await runBitRotScan(false);
    assert.ok(r.scanned >= 0);
    assert.equal(typeof r.baselineCreated, 'number');
    assert.ok(Array.isArray(r.corrupt), 'ผลลัพธ์ต้องเป็น array');
    assert.ok(r.scanned === r.ok + r.corrupt.length);
  });
});