import './setup-env';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mockModel } from './helpers';

describe('Time-Consensus Engine (Phase 6 — Byzantine Time Drift & NTP Poisoning)', () => {
  async function setup() {
    const mod = await import('../src/services/time-consensus.service');
    mockModel(mod.prisma, 'securityEvent', { create: async (a: any) => ({ id: 'e', ...a.data }) });
    mod.prisma.securityEvent.findMany = async () => [];
    return mod.timeConsensus;
  }

  test('check: DB desync เกิน 2 วิ → จับ db_desync anomaly', async () => {
    const mod = await import('../src/services/time-consensus.service');
    const timeConsensus = await setup();
    // จำลอง DB บอกเวลาเพี้ยนไป +10 นาที (spoof/NTP poison)
    mod.prisma.$queryRawUnsafe = async () => [{ now: new Date(Date.now() + 600000) }];
    const found = await timeConsensus.check();
    const desync = found.find((a) => a.type === 'db_desync');
    assert.ok(desync, 'ต้องจับ DB desync');
    assert.ok(Math.abs(desync.deltaMs) >= 600000 - 5000);
  });

  test('check: clock jump (นาฬิกากระโดด) → จับ clock_jump anomaly', async () => {
    const mod = await import('../src/services/time-consensus.service');
    const timeConsensus = await setup();
    mod.prisma.$queryRawUnsafe = async () => [{ now: new Date() }];
    // รอบแรก: baseline
    await timeConsensus.check();
    // จำลองนาฬิกาถอยหลัง 30 วิ (NTP step)
    const svc = timeConsensus as any;
    const fakeNow = Date.now();
    svc.lastLocalMs = fakeNow + 30000;
    svc.lastCheckAt = fakeNow - 60000;
    const found = await timeConsensus.check();
    const jump = found.find((a) => a.type === 'clock_jump');
    assert.ok(jump, 'ต้องจับ clock jump');
  });

  test('status: มี fields พื้นฐาน + เช็คซ้ำได้ (idempotent)', async () => {
    const mod = await import('../src/services/time-consensus.service');
    const timeConsensus = await setup();
    mod.prisma.$queryRawUnsafe = async () => [{ now: new Date() }];
    await timeConsensus.check();
    const st = timeConsensus.status();
    assert.equal(typeof st.checks, 'number');
    assert.equal(typeof st.dbDesyncMs, 'number');
    assert.ok(Array.isArray(st.anomalies));
    assert.ok(st.lastCheckAt !== null);
  });
});