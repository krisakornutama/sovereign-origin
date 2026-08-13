// src/services/face-embed.service.ts
//
// ระบบจดจำใบหน้าด้วย embedding — ลงทะเบียนรูปจริงครั้งเดียว แล้วเปรียบเทียบ
// ความคล้ายเชิงตัวเลข (cosine similarity / dhash) โดยไม่ต้องพึ่ง LLM ในการตัดสินทุกครั้ง
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const VL_MODEL = process.env.VISION_MODEL || 'qwen3-vl:8b';
const TEXT_EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
// คลิป/โมเดล embed ภาพตรง ๆ (ถ้ามี → ไม่ต้องเรียก LLM ทุกครั้ง)
const IMAGE_EMBED_MODEL = process.env.FACE_EMBED_IMAGE_MODEL || 'clip';

// เกณฑ์ความคล้ายขั้นต่ำ (cosine) — ตั้งได้ผ่าน env
export const FACE_EMBED_THRESHOLD = Number(process.env.FACE_EMBED_THRESHOLD || 0.78);

// ── DI (เทสต์) ──
interface FaceOllamaDeps {
  generate?: (url: string, body: any) => Promise<{ data?: { response?: string } }>;
  embed?: (url: string, body: any) => Promise<{ data?: { embeddings?: number[][] } }>;
  tags?: (url: string) => Promise<{ data?: { models?: Array<{ name: string }> } }>;
}
let faceDeps: FaceOllamaDeps = {
  generate: (url, body) => axios.post(url, body, { timeout: 120000 }),
  embed: (url, body) => axios.post(url, body, { timeout: 120000 }),
  tags: (url) => axios.get(url, { timeout: 5000 }),
};
export function setFaceOllama(deps: FaceOllamaDeps): void {
  if (deps) faceDeps = { ...faceDeps, ...deps };
}

// ── คณิตศาสตร์เชิงตัวเลข (pure) ──

/** cosine similarity ระหว่าง 2 เวกเตอร์ — 0 เมื่อเวกเตอร์ว่าง/ศูนย์ */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** hamming distance ระหว่าง dhash 2 ค่า (hex) — ต่างกันกี่บิต */
export function hammingDistance(aHex: string, bHex: string): number {
  const a = String(aHex ?? '').trim();
  const b = String(bHex ?? '').trim();
  let dist = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ac = parseInt(a[i] ?? '0', 16);
    const bc = parseInt(b[i] ?? '0', 16);
    let x = ac ^ bc;
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

export interface FaceRef {
  id: string;
  name: string;
  embedding?: number[] | null;
  dhash?: string | null;
}

/** หาคนคุ้นเคยที่คล้ายที่สุดจาก embedding — null = คนแปลกหน้า */
export function matchFaceByEmbedding(
  query: number[] | null | undefined,
  faces: FaceRef[],
  threshold = FACE_EMBED_THRESHOLD
): { name: string; id: string; similarity: number } | null {
  if (!Array.isArray(query) || query.length === 0) return null;
  let best: { name: string; id: string; similarity: number } | null = null;
  for (const f of faces) {
    if (!Array.isArray(f.embedding) || f.embedding.length === 0) continue;
    const sim = cosineSimilarity(query, f.embedding);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { name: f.name, id: f.id, similarity: sim };
    }
  }
  return best;
}

/** หาคนคุ้นเคยจาก dhash (ระยะห่างบิต ≤ เกณฑ์) — ใช้กับภาพที่เบราว์เซอร์ hash ให้ */
export function matchFaceByDhash(
  queryDhash: string | null | undefined,
  faces: FaceRef[],
  maxBits = 12
): { name: string; id: string; distance: number } | null {
  if (!queryDhash) return null;
  let best: { name: string; id: string; distance: number } | null = null;
  for (const f of faces) {
    if (!f.dhash) continue;
    const dist = hammingDistance(queryDhash, f.dhash);
    if (dist <= maxBits && (!best || dist < best.distance)) {
      best = { name: f.name, id: f.id, distance: dist };
    }
  }
  return best;
}

// ── สร้าง embedding จากรูป (เรียกครั้งเดียวตอนลงทะเบียน) ──

/** เปลียน data URI → base64 ล้วน (Ollama ไม่รับ prefix) */
export function stripDataUri(image: string): string {
  const m = String(image ?? '').match(/^data:[^;]+;base64,([\s\S]+)$/i);
  return m ? m[1] : String(image ?? '');
}

export interface FaceEmbedResult {
  embedding: number[] | null;
  method: 'image-embed' | 'describe-nomic' | 'none';
  description?: string;
}

/**
 * วิธีที่ 1: ถ้ามีโมเดล embed ภาพ (clip ฯลฯ) → ส่งภาพตรง ๆ ได้เวกเตอร์โดยไม่ต้อง LLM
 * วิธีที่ 2: ไม่มี → ใช้ VL model บรรยายใบหน้า 1 ประโยค แล้ว embed ข้อความด้วย nomic
 * ถ้า Ollama ไม่พร้อม → embedding = null (ลงทะเบียนได้ รออัปเดตทีหลัง)
 */
export async function embedFace(photo: string): Promise<FaceEmbedResult> {
  const image = String(photo ?? '').trim();
  if (!image) return { embedding: null, method: 'none' };
  try {
    // ตรวจว่าโมเดล embed ภาพมีไหม (แคช 5 นาที)
    let hasImageEmbed = false;
    try {
      const tags = await faceDeps.tags?.(`${OLLAMA_URL}/api/tags`);
      hasImageEmbed = (tags?.data?.models ?? []).some((m) => String(m.name).startsWith(IMAGE_EMBED_MODEL));
    } catch {
      hasImageEmbed = false;
    }

    if (hasImageEmbed) {
      const resp = await faceDeps.embed?.(`${OLLAMA_URL}/api/embed`, {
        model: IMAGE_EMBED_MODEL,
        input: stripDataUri(image),
      });
      const emb = resp?.data?.embeddings?.[0];
      if (Array.isArray(emb) && emb.length > 0) return { embedding: emb, method: 'image-embed' };
    }

    // ทางลัด: บรรยายด้วย VL → embed ข้อความ
    const gen = await faceDeps.generate?.(`${OLLAMA_URL}/api/generate`, {
      model: VL_MODEL,
      prompt:
        'บรรยายใบหน้าคนในภาพนี้ให้สั้นที่สุด 1 ประโยค ในรูปแบบ "ใบหน้าของ[เพศ/อายุ/ลักษณะเด่น]" ' +
        'เพื่อใช้เป็นลายเซ็นเปรียบเทียบความคล้าย เช่น "ใบหน้าชายไทยวัยกลางคน หนวดเคราบาง ผมสั้น" — ตอบเฉพาะประโยคเดียว ไม่มีคำอธิบายอื่น',
      images: [stripDataUri(image)],
      stream: false,
    });
    const description = String(gen?.data?.response ?? '').trim().slice(0, 200);
    if (!description) return { embedding: null, method: 'none' };

    const emb = await faceDeps.embed?.(`${OLLAMA_URL}/api/embed`, {
      model: TEXT_EMBED_MODEL,
      input: description,
    });
    const vec = emb?.data?.embeddings?.[0];
    if (Array.isArray(vec) && vec.length > 0) return { embedding: vec, method: 'describe-nomic', description };
    return { embedding: null, method: 'none' };
  } catch (err) {
    console.error('embedFace error:', err instanceof Error ? err.message : err);
    return { embedding: null, method: 'none' };
  }
}

// ── ตรวจภาพ (worker/มือ) — ตัดสินเชิงตัวเลข ──

export interface MatchResult {
  known: boolean;
  person: string | null;
  similarity: number | null;
  strangers: number;
  method: 'embedding' | 'dhash' | 'llm' | 'none';
  raw?: string;
}

/**
 * ตัวเปรียบเทียบหลัก: ใช้ embedding/dhash ก่อน ถ้าไม่มีข้อมูลเลยจึงค่อยพึ่ง LLM
 */
export async function matchFaceInImage(
  photo: string,
  faces: FaceRef[],
  opts?: { dhash?: string | null }
): Promise<MatchResult> {
  const image = String(photo ?? '').trim();
  if (!image) return { known: false, person: null, similarity: null, strangers: 0, method: 'none' };

  const withEmbed = faces.filter((f) => Array.isArray(f.embedding) && f.embedding.length > 0);
  const withDhash = faces.filter((f) => f.dhash);

  // 1) ทาง embedding: บรรยายภาพ (1 ครั้ง) → embed → เทียบ cosine กับทุกคน
  if (withEmbed.length > 0) {
    try {
      const gen = await faceDeps.generate?.(`${OLLAMA_URL}/api/generate`, {
        model: VL_MODEL,
        prompt:
          'บรรยายใบหน้าคนในภาพนี้สั้นที่สุด 1 ประโยค ในรูปแบบ "ใบหน้าของ[เพศ/อายุ/ลักษณะเด่น]" ' +
          'เพื่อใช้เปรียบเทียบความคล้าย — ตอบเฉพาะประโยคเดียว',
        images: [stripDataUri(image)],
        stream: false,
      });
      const description = String(gen?.data?.response ?? '').trim();
      if (description) {
        const emb = await faceDeps.embed?.(`${OLLAMA_URL}/api/embed`, {
          model: TEXT_EMBED_MODEL,
          input: description,
        });
        const vec = emb?.data?.embeddings?.[0];
        if (Array.isArray(vec) && vec.length > 0) {
          const match = matchFaceByEmbedding(vec, withEmbed);
          const strangers = match ? 0 : 1;
          return {
            known: !!match,
            person: match?.name ?? null,
            similarity: match?.similarity ?? null,
            strangers,
            method: 'embedding',
            raw: description,
          };
        }
      }
    } catch (err) {
      console.error('matchFaceInImage embedding path error:', err instanceof Error ? err.message : err);
    }
  }

  // 2) dhash — ภาพจากเบราว์เซอร์/แอพคำนวณ perceptual hash มาแล้ว เทียบเชิงตัวเลข
  if (opts?.dhash && withDhash.length > 0) {
    const match = matchFaceByDhash(opts.dhash, withDhash);
    return {
      known: !!match,
      person: match?.name ?? null,
      similarity: match ? Math.max(0, 1 - match.distance / 64) : null,
      strangers: match ? 0 : 1,
      method: 'dhash',
    };
  }

  return { known: false, person: null, similarity: null, strangers: 1, method: 'none' };
}
