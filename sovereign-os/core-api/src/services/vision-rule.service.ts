// src/services/vision-rule.service.ts
//
// Vision AI "คนแปลกหน้า" — ผู้ใหญ่ตั้งเงื่อนไขได้เอง:
//   - ลงทะเบียนใบหน้าที่คุ้นเคย (ชื่อ + รูป) → โมเดลจำภาพ (qwen3-vl) เทียบเมื่อเจอคน
//   - ตั้งกฎ: เปิด/ปิด, ความถี่ตรวจ, ความมั่นใจขั้นต่ำ, เฉพาะคนแปลกหน้า, แจ้ง Telegram
//   - เมื่อเจอคนที่เข้าเงื่อนไข → จับภาพ → แจ้งเตือน (Telegram) + เก็บประวัติแจ้งเตือน
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { embedFace, matchFaceInImage } from './face-embed.service';
import { firstResponder } from './first-responder.service';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
const VL_MODEL = process.env.VISION_MODEL || 'qwen3-vl:8b';

export interface KnownFaceInput {
  name: string;
  photo_url?: string | null;
  photo_data?: string | null; // ภาพจริง (data URI) — พ่อแม่อัปโหลด/ถ่ายจากกล้อง
  dhash?: string | null; // perceptual hash จากเบราว์เซอร์
  note?: string | null;
}

// ── DI (ใช้ในเทสต์) ──
type PostFn = (url: string, body: any) => Promise<{ data?: { response?: string } }>;
let vlPost: PostFn = async (url, body) => axios.post(url, body, { timeout: 120000 });
export function setVisionOllama(deps: { post?: PostFn }): void {
  if (deps?.post) vlPost = deps.post;
}
type NotifyFn = (message: string) => Promise<void>;
let visionNotify: NotifyFn = async (message: string) => {
  try {
    const { sendTelegram } = await import('../modules/telegram/telegram.routes');
    await sendTelegram(message);
  } catch (err) {
    console.error('vision notify error:', err instanceof Error ? err.message : err);
  }
};
export function setVisionNotify(fn: NotifyFn): void {
  visionNotify = fn;
}

// ── ใบหน้าที่คุ้นเคย ──
export async function listKnownFaces(): Promise<any[]> {
  return prisma.knownFace.findMany({ orderBy: { created_at: 'desc' } });
}

export async function addKnownFace(input: KnownFaceInput): Promise<{ id: string; embedding_ready: boolean; embed_method: string | null }> {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('name is required');
  const photo_url = input?.photo_url ? String(input.photo_url).trim().slice(0, 2000) : null;
  if (photo_url && !/^(https?:\/\/|data:image\/)/i.test(photo_url)) {
    throw new Error('photo_url ต้องเป็น http(s) หรือ data:image');
  }
  // ภาพจริงจากกล้อง/อัปโหลด — จำกัดขนาด (ฐานข้อมูลไม่บวม)
  let photo_data = input?.photo_data ? String(input.photo_data).trim() : null;
  if (photo_data && !/^data:image\//i.test(photo_data)) {
    photo_data = null;
  }
  if (photo_data && photo_data.length > 400000) {
    photo_data = photo_data.slice(0, 400000);
  }
  const dhash = input?.dhash ? String(input.dhash).trim().slice(0, 64) : null;

  // สร้าง embedding ครั้งเดียวตอนลงทะเบียน (Ollama ไม่พร้อม → ลงทะเบียนได้ รอทีหลัง)
  let embedding: number[] | null = null;
  let embed_method: string | null = null;
  const sourceImage = photo_data ?? photo_url;
  if (sourceImage) {
    const res = await embedFace(sourceImage);
    embedding = res.embedding;
    embed_method = res.method;
  }

  const item = await prisma.knownFace.create({
    data: {
      name,
      photo_url,
      photo_data,
      dhash,
      embedding: embedding ? embedding : undefined,
      embed_method,
      note: input?.note ? String(input.note).trim().slice(0, 300) : null,
    },
  });
  return { id: item.id, embedding_ready: !!embedding, embed_method };
}

export async function deleteKnownFace(id: string): Promise<void> {
  await prisma.knownFace.delete({ where: { id } });
}

// ── กฎการตรวจ ──
export async function getVisionRule(): Promise<any> {
  let rule = await prisma.visionRule.findFirst({ where: { id: 1 } });
  if (!rule) {
    rule = await prisma.visionRule.create({
      data: {
        id: 1,
        enabled: true,
        interval_min: 10,
        notify_telegram: true,
        confidence_min: 0.5,
        only_strangers: true,
      },
    });
  }
  return rule;
}

export async function updateVisionRule(patch: Record<string, unknown>): Promise<any> {
  const data: any = {};
  if (patch.enabled !== undefined) data.enabled = Boolean(patch.enabled);
  if (patch.notify_telegram !== undefined) data.notify_telegram = Boolean(patch.notify_telegram);
  if (patch.only_strangers !== undefined) data.only_strangers = Boolean(patch.only_strangers);
  if (patch.interval_min !== undefined) {
    const v = Math.floor(Number(patch.interval_min));
    if (!Number.isFinite(v) || v < 1 || v > 1440) throw new Error('interval_min ต้องอยู่ระหว่าง 1-1440 นาที');
    data.interval_min = v;
  }
  if (patch.confidence_min !== undefined) {
    const v = Number(patch.confidence_min);
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('confidence_min ต้องอยู่ระหว่าง 0-1');
    data.confidence_min = v;
  }
  return prisma.visionRule.update({ where: { id: 1 }, data });
}

// ── วิเคราะห์ภาพ: เจอคนกี่คน? ใครคุ้นเคย? มีคนแปลกหน้ากี่คน? ──
export async function analyzeStranger(
  photo: string,
  faces: Array<{ name: string; photo_url: string | null }> = []
): Promise<{ persons: number; familiar: string[]; strangers: number; raw: string }> {
  const faceList =
    faces.length === 0
      ? '(ยังไม่มีใบหน้าที่ลงทะเบียนไว้)'
      : faces.map((f) => `- ${f.name}${f.photo_url ? ` (มีรูปอ้างอิงให้เทียบได้)` : ''}`).join('\n');
  const resp = await vlPost(`${OLLAMA_URL}/api/generate`, {
    model: VL_MODEL,
    prompt:
      `คุณคือระบบเฝ้าระวังบ้าน วิเคราะห์ภาพนี้:\n` +
      `1. มีคน (person) อยู่ในภาพกี่คน?\n` +
      `2. เทียบกับใบหน้าที่คุ้นเคยด้านล่าง — คนไหนใช่คนคุ้นเคยบ้าง (ตอบชื่อ), คนไหนเป็นคนแปลกหน้า?\n` +
      `ใบหน้าที่คุ้นเคยที่ลงทะเบียน:\n${faceList}\n\n` +
      'ตอบเป็น JSON เท่านั้น รูปแบบ {"persons": <จำนวนคน>, "familiar": ["ชื่อคนคุ้นเคย..."], "strangers": <จำนวนคนแปลกหน้า>}',
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
  });
  const raw = String(resp.data?.response ?? '').trim();
  return parseStrangerJson(raw);
}

/** parse คำตอบ JSON (กัน fence/ข้อความเกิน) */
export function parseStrangerJson(raw: string): { persons: number; familiar: string[]; strangers: number; raw: string } {
  const text = String(raw ?? '').trim();
  let obj: unknown = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    obj = JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        obj = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        obj = null;
      }
    }
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  const persons = Math.max(0, Math.floor(Number(o.persons) || 0));
  const familiar = Array.isArray(o.familiar) ? o.familiar.map((x) => String(x)).filter(Boolean) : [];
  const strangers = Math.max(0, Math.floor(Number(o.strangers) || 0));
  return { persons, familiar, strangers, raw: text.slice(0, 2000) };
}

/** แปลงภาพ: data URI / URL ผ่านเลย, path ไฟล์ในเครื่อง → base64 data URI */
function toDataUri(photo: string): string | null {
  const p = String(photo ?? '').trim();
  if (!p) return null;
  if (/^data:image\//i.test(p)) return p;
  if (/^https?:\/\//i.test(p)) return p;
  try {
    const buf = fs.readFileSync(path.resolve(p));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * ตัวตรวจหลัก (worker) — ใช้กฎ + ภาพล่าสุด:
 * - disabled / ยังไม่ถึงเวลา → ข้าม
 * - ภาพจากที่ส่งมา หรือ DetectionEvent ล่าสุดที่มีภาพ
 * - เจอคนเข้าเงื่อนไข → แจ้ง Telegram + บันทึก VisionAlert
 */
export async function runVisionCheck(opts?: { photo?: string }): Promise<{
  alerted: boolean;
  skipped?: string;
  honeypot?: boolean;
  persons?: number;
  strangers?: number;
  familiar?: string[];
  message?: string;
}> {
  // First-Responder Mode (Phase 6 — Zero-Trust + Honeypot):
  // ไม่หยุดดู — วิเคราะห์ต่อแบบเงียบ ๆ บันทึก VisionAlert kind='honeypot' (ลับ, ไม่มี Telegram, ไม่ขึ้น alert)
  // ใช้วิเคราะห์ย้อนหลังว่า "เหตุฉุกเฉิน" เป็นของจริงหรือถูกจัดฉาก (Emergency Exploitation)
  const frActive = firstResponder.isActive();
  const rule = await getVisionRule();
  if (!rule.enabled) return { alerted: false, skipped: 'disabled' };
  const now = new Date();
  const lastAt = rule.last_check_at ? new Date(rule.last_check_at).getTime() : 0;

  // Lazy Vision AI (Lean): ตรวจเฉพาะเมื่อมี Trigger ใหม่จริง
  // 1) ภาพจากผู้ใช้ (manual) → ตรวจได้เสมอ
  // 2) ภาพจาก DetectionEvent (เช่น Motion/PIR) เฉพาะเหตุการณ์ที่ใหม่กว่า check ล่าสุด
  //    — ไม่มีเหตุการณ์ใหม่ → ข้ามทันที (ไม่แตะ DB เขียน / ไม่โหลด VL model)
  let photo = opts?.photo ? toDataUri(opts.photo) : null;
  let source = opts?.photo ?? '';
  if (!photo) {
    const ev = await prisma.detectionEvent.findFirst({
      where: { image_path: { not: null } },
      orderBy: { detected_at: 'desc' },
      select: { image_path: true, detected_at: true },
    });
    if (!ev?.image_path || (lastAt > 0 && ev.detected_at.getTime() <= lastAt)) {
      return { alerted: false, skipped: 'no_new_trigger' };
    }
    photo = toDataUri(ev.image_path);
    source = ev.image_path;
  }
  // กันการตรวจซ้ำถี่เกิน (interval_min — pacing ของกฎ ยังคงเดิม)
  if (lastAt > 0 && now.getTime() - lastAt < (rule.interval_min ?? 10) * 60000) {
    return { alerted: false, skipped: 'not_due' };
  }
  if (!photo) {
    return { alerted: false, skipped: 'no_image' }; // safety: ภาพใช้ไม่ได้ → ข้าม
  }

  // ── เปรียบเทียบด้วย embedding/dhash ก่อน (เชิงตัวเลข ไม่ต้องพึ่ง LLM ตัดสิน) ──
  const faces = await prisma.knownFace.findMany({
    select: { id: true, name: true, photo_url: true, photo_data: true, dhash: true, embedding: true },
  });
  const faceRefs = faces.map((f) => ({
    id: f.id,
    name: f.name,
    embedding: Array.isArray(f.embedding) ? f.embedding as number[] : null,
    dhash: f.dhash,
  }));
  let result: Awaited<ReturnType<typeof analyzeStranger>>;
  const hasSignals = faceRefs.some((f) => (Array.isArray(f.embedding) && f.embedding.length > 0) || f.dhash);
  if (hasSignals && photo) {
    const m = await matchFaceInImage(photo, faceRefs as any);
    if (m.method !== 'none') {
      // สรุปเป็นโครงเดียวกันกับ analyzeStranger เพื่อให้ flow ด้านล่างทำงานเหมือนเดิม
      result = {
        persons: 1,
        familiar: m.known && m.person ? [m.person] : [],
        strangers: m.strangers,
        raw: m.raw ?? m.method,
      };
    } else {
      result = await analyzeStranger(photo, faces.map((f) => ({ name: f.name, photo_url: f.photo_url ?? f.photo_data ?? null })));
    }
  } else {
    result = await analyzeStranger(photo, faces.map((f) => ({ name: f.name, photo_url: f.photo_url ?? f.photo_data ?? null })));
  }

  const suspicious = result.persons > 0 && (rule.only_strangers ? result.strangers > 0 : true);
  if (!suspicious) {
    await prisma.visionRule.update({ where: { id: 1 }, data: { last_check_at: now } });
    return { alerted: false, persons: result.persons, strangers: result.strangers, familiar: result.familiar };
  }

  if (frActive) {
    // Honeypot: บันทึกภาพ/ใบหน้าลับขณะโหมดฉุกเฉิน — ไม่แจ้งเตือน, ไม่รบกวนเจ้าหน้าที่
    const message =
      `🧊 HONEPYOT: บันทึกเงียบระหว่าง First-Responder Mode\n` +
      `👥 คนในภาพ: ${result.persons} | คนแปลกหน้า: ${result.strangers} | คุ้นเคย: ${result.familiar.length ? result.familiar.join(', ') : 'ไม่มี'}\n` +
      `📸 แหล่งภาพ: ${source || 'snapshot'}`;
    await prisma.visionAlert.create({
      data: {
        image_url: source || null,
        message,
        kind: 'honeypot',
        confidence: result.persons > 0 ? Math.min(1, 0.5 + result.strangers * 0.15) : 0,
      },
    });
    await prisma.visionRule.update({ where: { id: 1 }, data: { last_check_at: now } });
    return {
      alerted: false,
      honeypot: true,
      persons: result.persons,
      strangers: result.strangers,
      familiar: result.familiar,
      message,
    };
  }

  const message =
    `🚨 Vision AI: พบ${rule.only_strangers && result.strangers > 0 ? 'คนแปลกหน้า' : 'บุคคล'}ในภาพ!\n` +
    `👥 คนในภาพ: ${result.persons} | คนแปลกหน้า: ${result.strangers} | คุ้นเคย: ${result.familiar.length ? result.familiar.join(', ') : 'ไม่มี'}\n` +
    `📸 แหล่งภาพ: ${source || 'snapshot'}`;

  await prisma.visionAlert.create({
    data: {
      image_url: source || null,
      message,
      kind: 'stranger',
      confidence: result.persons > 0 ? Math.min(1, 0.5 + result.strangers * 0.15) : 0,
    },
  });
  if (rule.notify_telegram) await visionNotify(message);
  await prisma.visionRule.update({ where: { id: 1 }, data: { last_check_at: now } });
  return { alerted: true, persons: result.persons, strangers: result.strangers, familiar: result.familiar, message };
}
