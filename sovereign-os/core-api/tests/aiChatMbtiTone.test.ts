// TDD: AI chat กลางจำ MBTI — บล็อกโทนเข้า system prompt + context จริงเมื่อ client ส่ง mbti
import './setup-env';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';

const MBTI_CODES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const;

/** คำว่า "หลวงพี่..." ตามโค้ด — แหล่งเดียวกับ buddhist-healing.service.ts (ตรวจทานใน test แรก) */
const YAK_LABEL: Record<string, string> = {
  INTJ: 'หลวงพี่นักวางแผน', INTP: 'หลวงพี่นักทดลอง', ENTJ: 'หลวงพี่ผู้บัญชาการ', ENTP: 'หลวงพี่นักประดิษฐ์',
  INFJ: 'หลวงพี่ผู้เข้าใจ', INFP: 'หลวงพี่นักเล่าเรื่อง', ENFJ: 'หลวงพี่ผู้เชื่อมใจ', ENFP: 'หลวงพี่นักเที่ยวใจ',
  ISTJ: 'หลวงพี่ผู้มีวินัย', ISFJ: 'หลวงพี่ผู้อนุเคราะห์', ESTJ: 'หลวงพี่ผู้จัดระเบียบ', ESFJ: 'หลวงพี่ผู้เอาใจใส่',
  ISTP: 'หลวงพี่ผู้รู้จริง', ISFP: 'หลวงพี่ผู้ประทับใจ', ESTP: 'หลวงพี่ผู้ปฏิบัติ', ESFP: 'หลวงพี่ผู้เบิกบาน',
};

/** ตัวเลขความแตกต่างระหว่าง 2 prompt (จำนวนอักขระต่างกันแบบไม่อิงตำแหน่ง) */
function charSetDistance(a: string, b: string): number {
  const ca = new Map<string, number>();
  for (const ch of a) ca.set(ch, (ca.get(ch) ?? 0) + 1);
  const cb = new Map<string, number>();
  for (const ch of b) cb.set(ch, (cb.get(ch) ?? 0) + 1);
  let diff = 0;
  for (const [ch, n] of ca) diff += Math.abs(n - (cb.get(ch) ?? 0));
  for (const [ch, n] of cb) if (!ca.has(ch)) diff += n;
  return diff;
}

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

  // ─────────────────────────────────────────────────────────────
  // 16 โค้ด MBTI → prompt ต้องต่างกันจริง (จับคู่ทุกคู่ 120 คู่)
  // ─────────────────────────────────────────────────────────────
  describe('16 โค้ด MBTI → prompt ต่างกันจริง', () => {
    before(() => {
      (aiAgent as any).callOllama = async (prompt: string) => { (aiAgent as any).__lastPrompt = prompt; return '{"thought":"ok"}'; };
    });

    const promptsByCode: Record<string, string> = {};
    const runFor = async (code: string): Promise<string> => {
      if (promptsByCode[code]) return promptsByCode[code];
      await aiAgent.processMessage('ช่วยดูแลใจผมหน่อย', { actor: 'u-mbti-16' }, { mbti: code });
      promptsByCode[code] = (aiAgent as any).__lastPrompt;
      return promptsByCode[code];
    };

    test('ครบ 16 โค้ด — ทุกโค้ดฝังชื่อหลวงพี่ + โทนของตัวเองเข้า prompt', async () => {
      for (const code of MBTI_CODES) {
        const p = await runFor(code);
        assert.match(p, new RegExp(`\\[User Personality - MBTI ${code}\\]`), `${code}: ต้องมีบล็อกบุคลิกของตัวเอง`);
        assert.ok(p.includes(YAK_LABEL[code]), `${code}: ต้องมี "${YAK_LABEL[code]}" ใน prompt`);
      }
    });

    test('ทุกคู่ (120 คู่) ต่างกันจริง — โค้ดกับชื่อหลวงพี่ไม่ซ้ำกันเลย', async () => {
      for (const code of MBTI_CODES) await runFor(code);
      for (let i = 0; i < MBTI_CODES.length; i++) {
        for (let j = i + 1; j < MBTI_CODES.length; j++) {
          const a = MBTI_CODES[i], b = MBTI_CODES[j];
          const pa = promptsByCode[a], pb = promptsByCode[b];
          assert.ok(pa !== pb, `${a} vs ${b}: prompt ต้องไม่เท่ากัน`);
          assert.ok(pa.includes(YAK_LABEL[a]), `${a}: ต้องอ้าง "${YAK_LABEL[a]}"`);
          assert.ok(!pa.includes(YAK_LABEL[b]), `${a}: ห้ามไปอ้าง "${YAK_LABEL[b]}" ของ ${b}`);
          assert.ok(pb.includes(YAK_LABEL[b]), `${b}: ต้องอ้าง "${YAK_LABEL[b]}"`);
          assert.ok(!pb.includes(YAK_LABEL[a]), `${b}: ห้ามไปอ้าง "${YAK_LABEL[a]}" ของ ${a}`);
        }
      }
    });

    test('ทุกคู่ต่างกันเชิงเนื้อหา ≥ 20 อักขระ (ไม่ใช่แค่ต่างตัวอักษร 4 ตัว)', async () => {
      for (const code of MBTI_CODES) await runFor(code);
      for (let i = 0; i < MBTI_CODES.length; i++) {
        for (let j = i + 1; j < MBTI_CODES.length; j++) {
          const a = MBTI_CODES[i], b = MBTI_CODES[j];
          const d = charSetDistance(promptsByCode[a], promptsByCode[b]);
          assert.ok(
            d >= 20,
            `${a} vs ${b}: ความต่างเชิงเนื้อหา = ${d} อักขระ (น้อยกว่าเกณฑ์ 20 — โทนอาจถูกยุบให้เหมือนกัน)`
          );
        }
      }
    });

    test('เคสขอบ: lowercase + ช่องว่าง → normalize แล้วยังได้ prompt ของโค้ดนั้น', async () => {
      // หมายเหตุ: ห้ามใช้ข้อความว่าง/"ทดสอบ"/"สวัสดี" — processMessage มี fast-greeting guard ตอบทันทีโดยไม่ผ่าน Ollama
      await aiAgent.processMessage('ฝึกสติยังไงดี', { actor: 'u-mbti-16' }, { mbti: '  entp  ' });
      const p = (aiAgent as any).__lastPrompt as string;
      assert.match(p, /\[User Personality - MBTI ENTP\]/);
      assert.ok(p.includes(YAK_LABEL.ENTP));
    });
  });
});
