import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { mockModel } from './helpers';

describe('First-Responder Mode (SOS / Emergency Override)', () => {
  let testDir: string;
  let stateFile: string;
  let firstResponder: any;

  before(async () => {
    // กัน flake ที่ต้นเหตุ (เหมือนกรณี telegram.test): firstResponder.set() ยิง prisma.securityEvent.create
    // เข้า 127.0.0.1:5432 ปลอมของชุด mock — engine หมดเวลาต่อ ~2.3 วิ แล้วอาการ rejection ข้าม promise chain
    // ทำให้ runner ตัดสินไฟล์ล้มทั้งไฟล์ (เคยเห็น "Unable to deserialize cloned data") — ผูก delegate ปลอม
    // ตามแพทเทิร์น mockModel ให้ create ตอบทันที เทสนี้จึงไม่แตะ engine เลย (assertion ทั้งหมดอยู่ที่ state/ไฟล์)
    mockModel(prisma as any, 'securityEvent', {
      create: async (args: any) => ({ id: 1, ...args?.data }),
    });
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-firstresponder-'));
    stateFile = path.join(testDir, 'first-responder.json');
    process.env.FIRST_RESPONDER_FILE = stateFile;
    process.env.FIRST_RESPONDER_DURATION_MS = '600000'; // 10 นาที (สั้นสุดเพื่อเทสต์ expiry)

    const mod = await import('../src/services/first-responder.service');
    firstResponder = mod.firstResponder;
    firstResponder.init();
  });

  after(() => {
    try {
      firstResponder?.set(false, '', 'test cleanup');
    } catch {}
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.FIRST_RESPONDER_FILE;
    delete process.env.FIRST_RESPONDER_DURATION_MS;
  });

  test('init: เริ่มต้นเป็น OFF เสมอ', async () => {
    const st = await firstResponder.status();
    assert.equal(st.active, false);
    assert.equal(firstResponder.isActive(), false);
    assert.equal(st.remainingMs, null);
  });

  test('set(true): เปิดโหมด + จำคนเปิด + หมายเหตุ + หมดอายุอัตโนมัติ', async () => {
    const st = await firstResponder.set(true, 'admin', 'เรียกหน่วยกู้ภัย');
    assert.equal(st.active, true);
    assert.equal(st.by, 'admin');
    assert.equal(st.note, 'เรียกหน่วยกู้ภัย');
    assert.ok(typeof st.at === 'number');
    assert.ok(typeof st.expiresAt === 'number');
    assert.ok(st.expiresAt! - Date.now() > 0, 'expiresAt ต้องอยู่ในอนาคต');
    assert.ok(st.remainingMs && st.remainingMs > 0);
    assert.equal(firstResponder.isActive(), true);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, true);
    assert.equal(saved.note, 'เรียกหน่วยกู้ภัย');
  });

  test('หมดอายุอัตโนมัติ (lazy expiry): active แต่เลยเวลา → ปิดเอง + persist', async () => {
    await firstResponder.set(true, 'admin', 'ลืมปิด');
    const state = { ...firstResponder.state };
    state.expiresAt = Date.now() - 1000;
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
    firstResponder.state = state;

    assert.equal(firstResponder.isActive(), false, 'เลยเวลาแล้วต้องปลดเอง');
    assert.equal((await firstResponder.status()).active, false);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, false, 'ไฟล์ต้องถูก persist เป็น off');
  });

  test('set(false): ปิดโหมด + เก็บไฟล์', async () => {
    await firstResponder.set(true, 'admin', 'x');
    const st = await firstResponder.set(false, 'admin', 'สถานการณ์ปกติแล้ว');
    assert.equal(st.active, false);
    assert.equal(st.expiresAt, null);
    assert.equal(firstResponder.isActive(), false);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, false);
  });

  test('runVisionCheck: โหมด ON → ไม่ skip แล้ว (Honeypot ยังบันทึกเงียบ)', async () => {
    await firstResponder.set(true, 'admin', 'เจ้าหน้าที่เข้าพื้นที่');
    const { prisma, runVisionCheck } = await import('../src/services/vision-rule.service');
    const { mockModel } = await import('./helpers');
    mockModel(prisma, 'visionRule', {
      findFirst: async () => ({ id: 1, enabled: true, interval_min: 10, last_check_at: null }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    });
    mockModel(prisma, 'detectionEvent', { findFirst: async () => null });
    const res = await runVisionCheck();
    assert.equal(res.alerted, false);
    assert.notEqual(res.skipped, 'first_responder', 'FR mode ต้องไม่ skip อีกต่อไป — ต้องบันทึกเงียบ');
    await firstResponder.set(false, 'admin', 'test cleanup');
  });

  test('activatePhysical: ปุ่มกลไกในบ้าน → source="physical" (Zero-Trust)', async () => {
    const st = await firstResponder.activatePhysical('node-1', true);
    assert.equal(st.active, true);
    assert.equal(st.source, 'physical');
    assert.ok(String(st.by).startsWith('physical:'));
    const off = await firstResponder.activatePhysical('node-1', false);
    assert.equal(off.active, false);
    assert.equal(off.source, 'api'); // ปุ่มปลดผ่าน MQTT (ยังต้องตรวจย้อนหลังได้)
    await firstResponder.set(false, 'admin', 'test cleanup');
  });

  test('runVisionCheck: โหมด OFF → ทำงานปกติ (ไม่มี skipped first_responder)', async () => {
    const { prisma, runVisionCheck } = await import('../src/services/vision-rule.service');
    const { mockModel } = await import('./helpers');
    mockModel(prisma, 'visionRule', {
      findFirst: async () => null,
      create: async (args: any) => ({ id: 1, enabled: true, ...args.data }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    });
    mockModel(prisma, 'detectionEvent', { findFirst: async () => null });
    await firstResponder.set(false, 'admin', '');
    const res = await runVisionCheck();
    assert.equal(res.alerted, false);
    assert.notEqual(res.skipped, 'first_responder');
  });
});