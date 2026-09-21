// TDD: AI chat กลางจำ MBTI — บล็อกโทนเข้า system prompt + context จริงเมื่อ client ส่ง mbti
import './setup-env';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';

describe('AiAgentService MBTI tone', () => {
  let aiAgent: any;
  let prisma: any;

  before(async () => {
    const mod = await import('../src/services/AiAgentService');
    aiAgent = mod.aiAgent;
    prisma = mod.prisma;
    mockModel(prisma, 'securityEvent', { create: async (a: any) => ({ id: 'e', ...a.data }) });
    // chat-memory (listHistory) — ต้องไม่แตะ DB จริง (env ทดสอบไม่มี DB)
    mockModel(prisma, 'chatMessage', {
      findMany: async () => [],
      create: async (a: any) => ({ id: 'm', ...a.data }),
      deleteMany: async () => ({ count: 0 }),
    });
    (aiAgent as any).isOllamaOnline = async () => true;
  });

  test('ส่ง mbti → บล็อก [User Personality] + บริบทโทนเข้า prompt จริง', async () => {
    let captured = '';
    (aiAgent as any).callOllama = async (prompt: string) => { captured = prompt; return '{"thought":"ok"}'; };
    await aiAgent.processMessage('วันนี้บ้านเป็นไงบ้าง', { actor: 'u-mbti-test' }, { mbti: 'INTJ' });
    assert.match(captured, /\[User Personality - MBTI INTJ\]/);
    assert.match(captured, /หลวงพี่นักวางแผน|ตรง กระชับ/);
    assert.match(captured, /MBTI INTJ/);
  });

  test('ไม่ส่ง mbti → prompt ไม่มีบล็อก MBTI (พฤติกรรมเดิมคงเดิม)', async () => {
    let captured = '';
    (aiAgent as any).callOllama = async (prompt: string) => { captured = prompt; return '{"thought":"ok"}'; };
    await aiAgent.processMessage('วันนี้บ้านเป็นไงบ้าง', { actor: 'u-mbti-test' });
    assert.doesNotMatch(captured, /User Personality/);
  });

  test('โค้ดผิด/โค้ดแปลก → เมินอย่างปลอดภัย (ไม่มีบล็อก, ไม่พัง)', async () => {
    let captured = '';
    (aiAgent as any).callOllama = async (prompt: string) => { captured = prompt; return '{"thought":"ok"}'; };
    await aiAgent.processMessage('สวัสดี', { actor: 'u-mbti-test' }, { mbti: 'ZZZZ' });
    assert.doesNotMatch(captured, /User Personality/);
    assert.doesNotMatch(captured, /MBTI ZZZZ/);
  });

  test('tool-path (finalPrompt) ก็ได้รับบริบทโทนด้วย', async () => {
    let final = '';
    (aiAgent as any).callOllama = async (prompt: string, strict: boolean) => {
      if (!strict) final = prompt; // call ที่ 2 = finalPrompt หลัง tool result
      return '{"tool":"getTelemetry","args":{}}';
    };
    await aiAgent.processMessage('แบตเตอรี่เท่าไหร่', { actor: 'u-mbti-test' }, { mbti: 'infp' });
    assert.match(final, /MBTI INFP/);
  });
});
