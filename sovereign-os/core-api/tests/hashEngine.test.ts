import './setup-env';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { mockModel } from './helpers';
import { hashEngine, prisma as hashPrisma, sniffMime, EICAR, MAX_SCAN_BYTES } from '../src/services/hash-engine.service';

// ── Lite AV: SHA-256 Checksum Engine (แทน ClamAV) ──
// ใช้ quarantine dir ชั่วคราวใน temp (ไม่ทิ้งขยะใน repo)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-engine-'));
let createdEvents: any[] = [];

before(() => {
  process.env.HASH_QUARANTINE_DIR = TMP;
  mockModel(hashPrisma, 'securityEvent', {
    create: async (args: any) => { createdEvents.push(args.data); return { id: 'e-1', ...args.data }; },
  });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('hashEngine.scanBuffer', () => {
  test('ไฟล์ว่าง → rejected (0 byte)', async () => {
    const r = await hashEngine.scanBuffer(Buffer.alloc(0));
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'rejected');
  });

  test('ไฟล์ใหญ่เกิน 25MB → rejected', async () => {
    const r = await hashEngine.scanBuffer(Buffer.alloc(MAX_SCAN_BYTES + 1));
    assert.equal(r.ok, false);
    assert.match(r.error || '', /ใหญ่เกิน/);
  });

  test('PNG ปกติ → clean + sha256 ถูกต้อง', async () => {
    const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload-12345')]);
    const r = await hashEngine.scanBuffer(data);
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'clean');
    assert.equal(r.mimeType, 'image/png');
    const expect = crypto.createHash('sha256').update(data).digest('hex');
    assert.equal(r.hash, expect);
  });

  test('executable (MZ) → rejected + quarantine + MALWARE_DETECTED', async () => {
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'), Buffer.from('notreallyexe')]);
    const r = await hashEngine.scanBuffer(exe, { originalName: 'innocent.jpg' });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'rejected');
    assert.ok(r.quarantinedTo, 'ควรถูกกักกัน');
    assert.ok(fs.existsSync(r.quarantinedTo as string), 'ไฟล์ควรอยู่ใน quarantine dir');
    assert.ok(createdEvents.some((e) => e.event_type === 'MALWARE_DETECTED'), 'ควรมี securityEvent');
  });

  test('EICAR test file → malware + quarantine', async () => {
    const data = Buffer.from(`hello\n${EICAR}\nbye`, 'latin1');
    const r = await hashEngine.scanBuffer(data, { originalName: 'eicar.txt' });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'malware');
    assert.match(r.error || '', /EICAR/);
    assert.ok(r.quarantinedTo);
  });

  test('Threat Intel FILE hash match → malware', async () => {
    const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('known-bad-image')]);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    mockModel(hashPrisma, 'threatIntelItem', {
      findFirst: async (args: any) => {
        assert.equal(args.where.type, 'FILE');
        assert.equal(args.where.value, hash);
        return { id: 't-1', type: 'FILE', value: hash, category: 'malware', active: true };
      },
    });
    const r = await hashEngine.scanBuffer(data, { originalName: 'bad.png' });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, 'malware');
    assert.match(r.error || '', /FILE hit/);
  });

  test('status: engine=sha256-lite, no daemon, counters อัปเดต', async () => {
    const s = hashEngine.status();
    assert.equal(s.engine, 'sha256-lite');
    assert.equal(s.mode, 'on-demand');
    assert.equal(s.hash, 'sha256');
    assert.equal(s.daemon, null);
    assert.ok(s.scans >= 1);
    assert.ok(s.detections >= 2);
    assert.ok(s.quarantined >= 2);
  });
});

describe('sniffMime edge cases', () => {
  test('ไบต์ binary ล้วน → ไม่ใช่ text (null)', () => {
    assert.equal(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])), null);
  });

  test('text ธรรมดา (ไทย/ASCII) → text/plain', () => {
    assert.equal(sniffMime(Buffer.from('บันทึกความรู้ภาษาไทยปกติ\nบรรทัดสอง', 'utf8')), 'text/plain');
    assert.equal(sniffMime(Buffer.from('hello world\nline 2\n')), 'text/plain');
  });

  test('binary ปลอมเป็น .txt → ไม่ใช่ text (null)', () => {
    const bin = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) bin[i] = i % 8 === 0 ? 0x00 : 0x01; // ไบต์ต่ำเยอะ
    assert.equal(sniffMime(bin), null);
  });
});