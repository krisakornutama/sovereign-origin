// src/services/ai-local.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// AI Local — node-llama-cpp wrapper แบบมี consent
// - ปิดเป็นค่าเริ่มต้น (ต้องกดเปิดเอง หรือตั้ง autoStart=true เอง)
// - เปิดแล้ว: โหลดโมเดล GGUF จาก sovereign-os/core-api/models/ แล้ว inference ใน process เดียวกับ core-api
// - ปิดแล้ว: ระบบหลักทำงานปกติ ไม่กิน RAM
// - สถานะเก็บใน SystemSetting: ai.localEnabled, ai.autoStart, ai.modelPath
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

const ENABLED_KEY = 'ai.localEnabled';
const AUTO_START_KEY = 'ai.autoStart';
const MODEL_PATH_KEY = 'ai.modelPath';
const DEFAULT_MODEL = 'models/gemma-3-4b.gguf'; // วางไฟล์ GGUF ที่นี่

export interface AiLocalStatus {
  enabled: boolean; // ผู้ใช้กดเปิดหรือยัง (consent)
  autoStart: boolean; // เปิดเครื่องแล้ว auto-start ไหม
  modelPath: string;
  modelExists: boolean;
  modelSizeMb: number | null;
  loaded: boolean;
  ramMb: number | null;
  error: string | null;
}

let loaded = false;
let loadError: string | null = null;
// lazy holder — ถ้า node-llama-cpp ยังไม่ติดตั้ง จะ catch แล้ว fallback
let llamaInstance: any = null;

export async function getStatus(): Promise<AiLocalStatus> {
  const [enabledRow, autoRow, pathRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: ENABLED_KEY } }).catch(() => null),
    prisma.systemSetting.findUnique({ where: { key: AUTO_START_KEY } }).catch(() => null),
    prisma.systemSetting.findUnique({ where: { key: MODEL_PATH_KEY } }).catch(() => null),
  ]);
  const enabled = enabledRow?.value === 'true';
  const autoStart = autoRow?.value === 'true';
  const modelPath = pathRow?.value || DEFAULT_MODEL;
  const abs = path.resolve(process.cwd(), modelPath);
  let exists = false;
  let sizeMb: number | null = null;
  try {
    const st = fs.statSync(abs);
    exists = st.isFile();
    sizeMb = Math.round(st.size / (1024 * 1024));
  } catch {}
  return { enabled, autoStart, modelPath, modelExists: exists, modelSizeMb: sizeMb, loaded, ramMb: null, error: loadError };
}

export async function setEnabled(enabled: boolean): Promise<AiLocalStatus> {
  await prisma.systemSetting.upsert({
    where: { key: ENABLED_KEY },
    update: { value: String(enabled) },
    create: { key: ENABLED_KEY, value: String(enabled) },
  });
  if (!enabled) {
    loaded = false;
    loadError = null;
    llamaInstance = null;
  }
  return getStatus();
}

export async function setAutoStart(autoStart: boolean): Promise<AiLocalStatus> {
  await prisma.systemSetting.upsert({
    where: { key: AUTO_START_KEY },
    update: { value: String(autoStart) },
    create: { key: AUTO_START_KEY, value: String(autoStart) },
  });
  return getStatus();
}

export async function setModelPath(modelPath: string): Promise<AiLocalStatus> {
  const clean = String(modelPath || '').trim().slice(0, 300) || DEFAULT_MODEL;
  await prisma.systemSetting.upsert({
    where: { key: MODEL_PATH_KEY },
    update: { value: clean },
    create: { key: MODEL_PATH_KEY, value: clean },
  });
  loaded = false;
  loadError = null;
  return getStatus();
}

/** โหลดโมเดล — เรียกเมื่อ enabled=true และ modelExists=true เท่านั้น */
export async function loadModel(): Promise<{ ok: boolean; error?: string }> {
  const status = await getStatus();
  if (!status.enabled) return { ok: false, error: 'AI Local ยังไม่เปิด — กดเปิดก่อน' };
  if (!status.modelExists) return { ok: false, error: `ไม่พบโมเดลที่ ${status.modelPath} — ดาวน์โหลด GGUF มาก่อน` };
  try {
    // dynamic import — ถ้ายังไม่ติดตั้ง node-llama-cpp จะ throw แล้วจับเป็น error
    // @ts-ignore — optional dependency (ติดตั้งเมื่อต้องการใช้ AI Local)
    const { getLlama } = await import('node-llama-cpp' as any);
    const llama = await getLlama();
    const abs = path.resolve(process.cwd(), status.modelPath);
    const model = await llama.loadModel({ modelPath: abs });
    // สร้าง context เล็กเพื่อ warm-up (ไม่ต้องเก็บยาว — inference สร้าง context ต่อครั้ง)
    llamaInstance = { llama, model };
    loaded = true;
    loadError = null;
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // ถ้า package ยังไม่ติดตั้ง
    if (msg.includes('Cannot find package') || msg.includes('node-llama-cpp')) {
      loadError = 'ยังไม่ติดตั้ง node-llama-cpp — รัน: npm install node-llama-cpp';
    } else {
      loadError = msg.slice(0, 300);
    }
    loaded = false;
    return { ok: false, error: loadError ?? undefined };
  }
}

/** ถาม AI Local — ใช้เมื่อ loaded=true เท่านั้น */
export async function askLocal(prompt: string, opts: { maxTokens?: number } = {}): Promise<string | null> {
  if (!loaded || !llamaInstance) return null;
  try {
    const context = await llamaInstance.model.createContext();
    const session = new (context as any).Session();
    const out = await session.prompt(prompt, { maxTokens: opts.maxTokens ?? 512 });
    return out as string;
  } catch {
    return null;
  }
}

/** เรียกตอน boot — ถ้า autoStart=true + enabled=true ถึงจะโหลด */
export async function maybeAutoStart(): Promise<void> {
  const s = await getStatus();
  if (s.enabled && s.autoStart && s.modelExists && !loaded) {
    console.log('🤖 AI Local auto-start — กำลังโหลดโมเดล ' + s.modelPath);
    const r = await loadModel();
    console.log(r.ok ? '🤖 AI Local พร้อม' : '🤖 AI Local โหลดไม่สำเร็จ: ' + r.error);
  } else if (!s.enabled) {
    console.log('🤖 AI Local ปิดอยู่ (ต้องกดเปิดเอง) — ระบบหลักทำงานปกติ');
  }
}
