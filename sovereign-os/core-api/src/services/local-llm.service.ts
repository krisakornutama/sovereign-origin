// src/services/local-llm.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Local LLM — Ollama replacement ที่เป็นของโปรเจ็ก (สวิตช์ เปิด/ปิด ได้)
// - โมเดลเก็บใน sovereign-os/core-api/models/*.gguf — เป็นไฟล์ของโปรเจ็ก (ไม่พึ่ง Ollama)
// - ปิดเป็น default — เปิดเมื่อผู้ใช้กดในแอปเท่านั้น (ยินยอมชัด)
// - งานทุกจุดที่เคยเรียก Ollama ต้องตรวจ isEnabled() ก่อน — ไม่เปิด = fallback ทันที
// - รองรับ auto-start: บูตเครื่องแล้วจำค่าล่าสุด (ถ้าปิดไว้ก็ปิดต่อ)
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';

const AI_ENABLED_KEY = 'ai.enabled';
const AI_MODEL_KEY = 'ai.model'; // เช่น gemma3:4b / llama3:8b.gguf

// ── Model catalogue — โมเดลที่แนะนำ (GGUF) ──
export const AI_MODELS = [
  { id: 'gemma3:4b', name: 'Gemma 3 4B', size: '4GB', desc: 'เร็ว แม่นพอสำหรับ chat/วิเคราะหข่าว/สอนลูก' },
  { id: 'llama3:8b', name: 'Llama 3 8B', size: '8GB', desc: 'แม่นกว่า แต่ต้อง RAM ≥ 16GB' },
] as const;

// ── สวิตช์ เปิด/ปิด (จำใน DB) ──
export async function isAiEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: AI_ENABLED_KEY } });
    return row?.value === 'true';
  } catch {
    return false; // ปิดเป็น default — ตรงเป้าหมาย "ไม่เปิดเองจนกว่าผู้ใช้ยินยอม"
  }
}

export async function setAiEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  await prisma.systemSetting.upsert({
    where: { key: AI_ENABLED_KEY },
    update: { value: String(enabled) },
    create: { key: AI_ENABLED_KEY, value: String(enabled) },
  });
  if (!enabled) unloadModel().catch(() => {});
  else loadModel().catch(() => {});
  return { enabled };
}

export async function getAiEnabled(): Promise<{ enabled: boolean; model: string }> {
  const [en, model] = await Promise.all([
    isAiEnabled(),
    prisma.systemSetting.findUnique({ where: { key: AI_MODEL_KEY } }),
  ]);
  return { enabled: en, model: model?.value || AI_MODELS[0].id };
}

export async function setAiModel(model: string): Promise<void> {
  const id = model.trim();
  if (!id) throw new Error('model is required');
  await prisma.systemSetting.upsert({
    where: { key: AI_MODEL_KEY },
    update: { value: id },
    create: { key: AI_MODEL_KEY, value: id },
  });
  // สลับโมเดลขณะเปิดอยู่ → โหลดใหม่
  if (await isAiEnabled()) {
    unloadModel().catch(() => {});
    loadModel().catch(() => {});
  }
}

// ── Engine abstraction — Ollama vs node-llama-cpp ──
export type LlmGenerateOptions = {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
};

export interface LlmEngine {
  name: string;
  isAvailable(): Promise<boolean>;
  generate(opts: LlmGenerateOptions): Promise<string | null>;
  unload(): Promise<void>;
}

// ── Ollama engine (เดิม — ยังใช้ได้เมื่อ Ollama รัน) ──
async function ollamaGenerate(opts: LlmGenerateOptions, model: string): Promise<string | null> {
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const systemPrompt = opts.systemPrompt ? opts.systemPrompt + '\n' : '';
    const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: systemPrompt + opts.prompt,
        stream: false,
        options: { temperature: opts.temperature ?? 0.7, num_predict: opts.maxTokens ?? 512 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return typeof data.response === 'string' && data.response.trim() ? data.response : null;
  } catch {
    return null;
  }
}

// ── node-llama-cpp engine (ฝังในโปรเจ็ก — ยังไม่มี model file จนกว่าผู้ใช้จะดาวน์โหลด) ──
// Lazy import เพื่อไม่ให้ crash ตอน build ถ้ายังไม่ติดตั้ง package
let llamaModel: any = null;
let llamaContext: any = null;

async function localGenerate(opts: LlmGenerateOptions, modelPath: string): Promise<string | null> {
  try {
    // @ts-ignore — optional dependency (ติดตั้งเมื่อพร้อม)
    const { getLlama } = await import('node-llama-cpp');
    const llama = await getLlama();
    if (!llamaModel) {
      llamaModel = await llama.loadModel({ modelPath });
    }
    if (!llamaContext) {
      llamaContext = await llamaModel.createContext();
    }
    const session = new llamaContext.constructor();
    const result: string = await session.prompt(`${opts.systemPrompt ? opts.systemPrompt + '\n' : ''}${opts.prompt}`, {
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 512,
    });
    return result?.trim() || null;
  } catch {
    return null;
  }
}

// ── Public: generate — ตรวจสวิตช์ก่อนเสมอ ──
export async function generateWithLocalLlm(opts: LlmGenerateOptions): Promise<string | null> {
  if (!(await isAiEnabled())) return null; // ปิดอยู่ → ไม่ยิง ไม่โหลดโมเดล
  const { model } = await getAiEnabled();
  // ลอง local GGUF ก่อน (ถ้ามีไฟล์), ไม่ได้ → fallback ไป Ollama (ถ้ารันอยู่)
  const localPath = `models/${model.replace(':', '_')}.gguf`;
  try {
    const fs = await import('fs');
    if (fs.existsSync(localPath)) {
      const r = await localGenerate(opts, localPath);
      if (r) return r;
    }
  } catch {}
  return ollamaGenerate(opts, model);
}

export async function loadModel(): Promise<void> {
  // preload โมเดลเข้า RAM (ถูกเรียกเมื่อเปิดสวิตช์)
  if (!(await isAiEnabled())) return;
  // ไม่ทำอะไรจนกว่าจะมี generate ครั้งแรก (lazy) — กันบูตช้า
}

export async function unloadModel(): Promise<void> {
  try {
    if (llamaContext) { await llamaContext.dispose?.(); llamaContext = null; }
    if (llamaModel) { await llamaModel.dispose?.(); llamaModel = null; }
  } catch {}
}

// ── Auto-load หลังบูต — จำค่าล่าสุด (ถ้าปิดไว้ก็ไม่โหลด) ──
export function autoInitLocalLlm(): void {
  isAiEnabled().then((en) => {
    if (en) console.log('🤖 Local LLM: สวิตช์เปิด — โหลดโมเดลเมื่อมีการเรียกครั้งแรก');
    else console.log('🤖 Local LLM: ปิดอยู่ (รอผู้ใช้กดเปิดในแอป)');
  }).catch(() => {});
}
