import './setup-env';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TASK_TYPES,
  DEFAULT_ROUTES,
  getModelForTask,
  getAllRoutes,
  setModelForTask,
  resetModelForTask,
} from '../src/services/ai-router.service';
import { prisma } from '../src/lib/prisma';
import { mockModel } from './helpers';

// ── mock SystemSetting delegate ทั้งชุด (in-memory map) ──
const store = new Map<string, string>();

mockModel(prisma as any, 'systemSetting', {
  findUnique: async ({ where }: { where: { key: string } }) => {
    const v = store.get(where.key);
    return v != null ? { key: where.key, value: v } : null;
  },
  findMany: async ({ where }: { where: { key: { startsWith: string } } }) =>
    [...store.entries()].filter(([k]) => k.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
  upsert: async ({ where, update, create }: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => {
    store.set(where.key, update.value ?? create.value);
    return { key: where.key, value: store.get(where.key)! };
  },
  deleteMany: async ({ where }: { where: { key: string } }) => {
    let n = 0;
    for (const k of [...store.keys()]) if (k === where.key || k.startsWith(where.key)) { store.delete(k); n++; }
    return { count: n };
  },
});

describe('ai-router.service', () => {
  beforeEach(() => store.clear());

  test('TASK_TYPES ครบ 4 โดเมน + default ตรงตามสเปก', () => {
    assert.deepEqual([...TASK_TYPES].sort(), ['CODING_AGENT', 'GENERAL_ASSISTANT', 'REASONING_GOVERNOR', 'VISION_AI']);
    assert.equal(DEFAULT_ROUTES.CODING_AGENT, 'qwen2.5-coder:7b');
    assert.equal(DEFAULT_ROUTES.VISION_AI, 'qwen2.5-vl:7b');
    assert.equal(DEFAULT_ROUTES.REASONING_GOVERNOR, 'deepseek-r1:14b');
    assert.equal(DEFAULT_ROUTES.GENERAL_ASSISTANT, 'qwen2.5:7b');
  });

  test('getModelForTask — ไม่มี override → คืน default', async () => {
    assert.equal(await getModelForTask('CODING_AGENT'), 'qwen2.5-coder:7b');
    assert.equal(await getModelForTask('VISION_AI'), 'qwen2.5-vl:7b');
  });

  test('getModelForTask — มี override ใน SystemSetting → ใช้ค่าที่ตั้ง', async () => {
    store.set('ai.route.CODING_AGENT', 'qwen3-coder:30b');
    assert.equal(await getModelForTask('CODING_AGENT'), 'qwen3-coder:30b');
    // โดเมนอื่นยังใช้ default
    assert.equal(await getModelForTask('VISION_AI'), 'qwen2.5-vl:7b');
  });

  test('getModelForTask — task ไม่รู้จัก → fallback GENERAL_ASSISTANT ไม่ throw', async () => {
    assert.equal(await getModelForTask('UNKNOWN_TASK'), 'qwen2.5:7b');
  });

  test('setModelForTask → getModelForTask อ่านค่ากลับมาได้ (round-trip)', async () => {
    const r = await setModelForTask('REASONING_GOVERNOR', 'deepseek-r1:32b');
    assert.equal(r.ok, true);
    assert.equal(await getModelForTask('REASONING_GOVERNOR'), 'deepseek-r1:32b');
  });

  test('setModelForTask — ปฏิเสธ task ไม่รู้จัก + ชื่อโมเดลแปลก', async () => {
    assert.equal((await setModelForTask('NOPE', 'x:1')).ok, false);
    assert.equal((await setModelForTask('CODING_AGENT', 'bad name;rm')).ok, false);
    assert.equal((await setModelForTask('CODING_AGENT', '')).ok, false);
    assert.equal(store.size, 0, 'ไม่ควรเขียนอะไรลง store เมื่อ validate ไม่ผ่าน');
  });

  test('getAllRoutes — รวม default + override ปนกันถูกต้อง', async () => {
    await setModelForTask('GENERAL_ASSISTANT', 'gemma3:4b');
    const all = await getAllRoutes();
    assert.equal(all.GENERAL_ASSISTANT, 'gemma3:4b');
    assert.equal(all.CODING_AGENT, 'qwen2.5-coder:7b');
    assert.equal(Object.keys(all).length, 4);
  });

  test('resetModelForTask — ล้าง override แล้วกลับไป default', async () => {
    await setModelForTask('VISION_AI', 'llava:13b');
    await resetModelForTask('VISION_AI');
    assert.equal(await getModelForTask('VISION_AI'), 'qwen2.5-vl:7b');
  });
});
