import './setup-env';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getModelForTask, getAllRoutes } from '../src/services/ai-router.service';
import { prisma } from '../src/lib/prisma';
import { mockModel } from './helpers';

// ── พิสูจน์ priority chain ของ getModelForTask(task, legacyFallback):
//    DB override (Matrix) > legacy env constant > spec default
//    — หัวใจของ dynamic routing: เปลี่ยนใน Matrix แล้ว service ใช้โมเดลใหม่ทันที
const store = new Map<string, string>();

mockModel(prisma as any, 'systemSetting', {
  findUnique: async ({ where }: { where: { key: string } }) => {
    const v = store.get(where.key);
    return v != null ? { key: where.key, value: v } : null;
  },
});

describe('ai-router wiring (priority chain)', () => {
  beforeEach(() => store.clear());

  test('ไม่มี override + ไม่มี legacy → spec default (qwen3:8b)', async () => {
    assert.equal(await getModelForTask('CODING_AGENT'), 'qwen3:8b');
  });

  test('ไม่มี override + มี legacy env → ใช้ legacy (back-compat: tests/.env เดิมไม่พัง)', async () => {
    assert.equal(await getModelForTask('CODING_AGENT', 'qwen3:8b'), 'qwen3:8b');
    assert.equal(await getModelForTask('VISION_AI', 'qwen3-vl:8b'), 'qwen3-vl:8b');
    assert.equal(await getModelForTask('REASONING_GOVERNOR', 'gemma3:4b'), 'gemma3:4b');
    assert.equal(await getModelForTask('GENERAL_ASSISTANT', 'gemma3:4b'), 'gemma3:4b');
  });

  test('มี DB override → ชนะ legacy (dynamic routing ทำงาน)', async () => {
    store.set('ai.route.CODING_AGENT', 'qwen3:8b');
    assert.equal(await getModelForTask('CODING_AGENT', 'qwen2.5-coder:7b'), 'qwen3:8b');
  });

  test('เปลี่ยน override กลางคัน → call ถัดไปใช้ค่าใหม่ (ไม่ต้อง restart)', async () => {
    store.set('ai.route.REASONING_GOVERNOR', 'deepseek-r1:8b');
    assert.equal(await getModelForTask('REASONING_GOVERNOR', 'gemma3:4b'), 'deepseek-r1:8b');
    store.set('ai.route.REASONING_GOVERNOR', 'deepseek-r1:14b');
    assert.equal(await getModelForTask('REASONING_GOVERNOR', 'gemma3:4b'), 'deepseek-r1:14b');
  });

  test('getAllRoutes(legacyDefaults) — legacy เติมใต้ DB override ถูกต้อง', async () => {
    store.set('ai.route.VISION_AI', 'qwen3-vl:8b');
    const routes = await getAllRoutes({
      CODING_AGENT: 'qwen3:8b',
      VISION_AI: 'qwen3-vl:8b',
      REASONING_GOVERNOR: 'gemma3:4b',
      GENERAL_ASSISTANT: 'gemma3:4b',
    });
    // DB override ชนะ
    assert.equal(routes.VISION_AI, 'qwen3-vl:8b');
    // ไม่มี override → legacy ที่ส่งมา
    assert.equal(routes.CODING_AGENT, 'qwen3:8b');
    assert.equal(routes.REASONING_GOVERNOR, 'gemma3:4b');
    assert.equal(routes.GENERAL_ASSISTANT, 'gemma3:4b');
  });

  test('legacy ว่าง/ช่องว่าง → ข้ามไป spec default', async () => {
    assert.equal(await getModelForTask('CODING_AGENT', '   '), 'qwen3:8b');
    assert.equal(await getModelForTask('CODING_AGENT', ''), 'qwen3:8b');
  });
});
