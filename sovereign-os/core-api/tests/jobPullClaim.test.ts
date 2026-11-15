// ─────────────────────────────────────────────────────────────
// POST /api/agent-machines/jobs/pull — การ "จอง" งานต้องไม่ซ้ำ
//
// เดิม pullJobs() อ่านงาน status=queued แล้วสั่ง update({ where: { id } }) ตรง ๆ
// โดยไม่ตรวจสถานะเดิม ⇒ สองคำขอที่ดึงพร้อมกัน (หรือเครื่องเดียวยิงซ้อน) เห็นงานเดียวกัน
// แล้วต่างก็ได้งานไปรัน = งานเดียวถูกสั่งทำสองรอบ (ผลข้างเคียงซ้ำ, ของจริงในโลกจริง)
// การจองที่ถูกต้องคือ updateMany แบบมีเงื่อนไข status=queued แล้วนับว่าใครชนะ
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mockModel } from './helpers';
import { prisma } from '../src/lib/prisma';
import { pullJobs } from '../src/services/agent-machines.service';

const job = { id: 'j-1', executor: 'opencode', prompt: 'do it', priority: 1, capability_tag: null, status: 'queued' };
const machine = { id: 'm-1', executors: ['opencode'], status: 'online' } as any;

let claimCount = 1;
let unconditionalUpdates = 0;

beforeEach(() => {
  claimCount = 1;
  unconditionalUpdates = 0;
  mockModel(prisma as any, 'agentJob', {
    findMany: async () => [job],
    updateMany: async () => ({ count: claimCount }),
    update: async () => {
      unconditionalUpdates += 1;
      return { id: job.id };
    },
  });
});

test('จองงานได้เมื่อยังว่าง (updateMany ชนะ)', async () => {
  const out = await pullJobs(machine, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, job.id);
  assert.equal(unconditionalUpdates, 0, 'ห้ามใช้ update แบบไม่มีเงื่อนไขสถานะในการจองงาน');
});

test('อีกคำขอจองไปก่อนแล้ว ⇒ ต้องไม่ได้งานซ้ำ', async () => {
  claimCount = 0; // มีคนอื่นคว้าไปแล้ว
  const out = await pullJobs(machine, 3);
  assert.deepEqual(out, [], 'งานที่ถูกจองไปแล้วต้องไม่ถูกส่งซ้ำ');
});
