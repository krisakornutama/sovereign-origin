import axios from 'axios';
import { prisma } from '../lib/prisma';
import { getModelForTask } from './ai-router.service';

export { prisma };

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
export const VISION_MODEL = process.env.VISION_MODEL || 'qwen3-vl:8b';
export const VISION_ENABLED = (process.env.VISION_ENABLED || 'true') !== 'false';
export const VISION_MAX_IMAGE_MB = parseInt(process.env.VISION_MAX_IMAGE_MB || '10', 10);

export const OBJECT_TYPES = ['person', 'vehicle', 'animal', 'venomous', 'other'] as const;

export interface VisionLabel {
  object_type: string;
  confidence?: number | null;
  bbox?: [number, number, number, number] | null;
  note?: string | null;
}

export interface VisionParseResult {
  summary: string;
  labels: VisionLabel[];
  raw: string;
}

export const VISION_PROMPT = [
  'You are an offline home security and household monitoring AI (Sovereign OS).',
  'Analyze the image and return ONLY valid JSON with this exact shape:',
  '{"summary": "<1-2 sentence Thai summary of the scene>", "detections": [{"label": "<category>", "confidence": 0.0-1.0, "bbox": [x1,y1,x2,y2]}]}',
  'Categories: person, vehicle, animal, venomous (snake/scorpion/spider/centipede/wasp), other.',
  'bbox = fractions 0-1 of image width/height (top-left x1,y1 to bottom-right x2,y2), or omit if unsure.',
  'No text outside the JSON.',
].join(' ');

/** map ป้ายจากโมเดล (อังกฤษ/ไทย) → หมวดที่เราจัดการได้ */
export function normalizeLabel(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/(venomous|snake|งู|scorpion|แมงป่อง|spider|แมงมุม|centipede|ตะขาบ|wasp|hornet|bee|ต่อ|แตน)/.test(s)) return 'venomous';
  if (/(person|human|intruder|man|woman|men|women|คน|มนุษย์|ผู้บุกรุก|คนร้าย|โจร)/.test(s)) return 'person';
  if (/(vehicle|car|truck|motorcycle|motorbike|bike|bicycle|van|boat|drone|ยานพาหนะ|รถ|มอเตอร์ไซค์|จักรยาน)/.test(s)) return 'vehicle';
  if (/(animal|dog|cat|cow|pig|chicken|bird|elephant|monkey|buffalo|goat|deer|owl|duck|rabbit|สัตว์|หมา|แมว|วัว|หมู|ไก่|นก|ช้าง|ลิง|ควาย)/.test(s)) return 'animal';
  return 'other';
}

function clampConfidence(value: unknown): number | null {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null;
  return Math.min(1, Math.max(0, Number(value)));
}

function toBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((v) => Number(v));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums as [number, number, number, number];
}

/** parse คำตอบจาก VL model — รับทั้ง JSON เปล่า ๆ, อยู่ใน ```json fence, หรือ array ล้วน */
export function parseVisionResponse(text: string): VisionParseResult {
  const raw = String(text ?? '').trim();
  let summary = '';
  const labels: VisionLabel[] = [];

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();

  let obj: unknown = null;
  if (candidate) {
    try {
      obj = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      const arrStart = candidate.indexOf('[');
      const arrEnd = candidate.lastIndexOf(']');
      if (start >= 0 && end > start) {
        try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch { /* ignore */ }
      } else if (arrStart >= 0 && arrEnd > arrStart) {
        try { obj = JSON.parse(candidate.slice(arrStart, arrEnd + 1)); } catch { /* ignore */ }
      }
    }
  }

  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if (typeof o.summary === 'string') summary = o.summary.slice(0, 2000);
    const dets = Array.isArray(o.detections) ? o.detections : Array.isArray(o.labels) ? o.labels : [];
    for (const d of dets) {
      if (!d || typeof d !== 'object') continue;
      const dd = d as Record<string, unknown>;
      const rawLabel = dd.label ?? dd.object_type ?? dd.class ?? dd.name ?? dd.category ?? 'other';
      const normalized = normalizeLabel(rawLabel);
      const label: VisionLabel = {
        object_type: normalized,
        confidence: clampConfidence(dd.confidence ?? dd.conf ?? dd.score),
        bbox: toBbox(dd.bbox ?? dd.box),
      };
      const note = String(rawLabel).trim();
      if (normalized !== note && note) label.note = note.slice(0, 200);
      labels.push(label);
    }
  } else if (Array.isArray(obj)) {
    for (const d of obj) {
      if (!d || typeof d !== 'object') continue;
      const dd = d as Record<string, unknown>;
      const rawLabel = dd.label ?? dd.object_type ?? dd.class ?? dd.name ?? 'other';
      const normalized = normalizeLabel(rawLabel);
      const label: VisionLabel = {
        object_type: normalized,
        confidence: clampConfidence(dd.confidence ?? dd.conf ?? dd.score),
        bbox: toBbox(dd.bbox ?? dd.box),
      };
      const note = String(rawLabel).trim();
      if (normalized !== note && note) label.note = note.slice(0, 200);
      labels.push(label);
    }
  } else {
    summary = raw.slice(0, 1000);
  }

  return { summary, labels, raw };
}

export interface CallVisionDeps {
  post?: (url: string, body: unknown, opts?: any) => Promise<{ data?: { response?: unknown } }>;
}

/** เรียก Ollama /api/generate ด้วยภาพ base64 — โมเดล vision ต้องคืน JSON ตาม prompt */
export async function callVision(base64: string, prompt: string, deps: CallVisionDeps = {}): Promise<string> {
  const post =
    deps.post ??
    ((url: string, body: unknown, opts?: any) => axios.post(url, body, opts));
  const resp = await post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: await getModelForTask('VISION_AI', VISION_MODEL),
      prompt,
      images: [base64],
      stream: false,
      options: { temperature: 0.1 },
      keep_alive: OLLAMA_KEEP_ALIVE,
    },
    { timeout: 120000 }
  );
  const text = String(resp.data?.response ?? '');
  if (!text.trim()) throw new Error('empty ollama response');
  return text.trim();
}

export interface RunVisionOptions extends CallVisionDeps {
  prompt?: string;
  cameraId?: string | null;
}

export interface RunVisionResult extends VisionParseResult {
  model: string;
  saved: number;
  savedEvents: Array<{ id: string; object_type: string; confidence: number | null; detected_at: string }>;
}

/**
 * วิเคราะห์ภาพ: เรียกโมเดล → parse ผล → (ถ้าระบุกล้อง) บันทึก DetectionEvent + อัปเดต last_event_at
 */
export async function runVisionAnalysis(base64: string, opts: RunVisionOptions = {}): Promise<RunVisionResult> {
  if (!VISION_ENABLED) throw new Error('Vision AI disabled (VISION_ENABLED=false)');
  const prompt = opts.prompt || VISION_PROMPT;
  const text = await callVision(base64, prompt, opts);
  const parsed = parseVisionResponse(text);

  const savedEvents: RunVisionResult['savedEvents'] = [];
  if (opts.cameraId) {
    const camera = await prisma.camera.findUnique({ where: { id: opts.cameraId } });
    if (!camera) throw new Error(`camera_id not found: ${opts.cameraId}`);
    for (const label of parsed.labels) {
      const event = await prisma.detectionEvent.create({
        data: {
          camera_id: opts.cameraId,
          object_type: label.object_type,
          confidence: label.confidence ?? null,
        },
      });
      savedEvents.push({
        id: event.id,
        object_type: event.object_type,
        confidence: event.confidence,
        detected_at: event.detected_at.toISOString(),
      });
    }
    await prisma.camera.update({ where: { id: opts.cameraId }, data: { last_event_at: new Date() } });
  }

  return { ...parsed, model: await getModelForTask('VISION_AI', VISION_MODEL), saved: savedEvents.length, savedEvents };
}
