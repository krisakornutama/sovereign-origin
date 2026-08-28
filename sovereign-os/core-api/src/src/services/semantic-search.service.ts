import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { knowledgeDir } from './knowledge-dir.service';

export { prisma };

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
export const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const KNOWLEDGE_DIR = knowledgeDir();

/** ป้ายบอกว่า chunk มาจาก Knowledge Item (ไม่ใช่ไฟล์คู่มือ) — กันชนกับชื่อไฟล์จริง */
export const KB_ITEM_PREFIX = '📚 ';

/** แบ่งไฟล์เป็น chunk ~500 ตัวอักษร (overlap 80) — กันตัดความหมายกลางประโยค */
export function chunkText(text: string, size = 500, overlap = 80): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + size, cleaned.length);
    // ย้อนหา newline ใกล้สุด (ไม่ตัดกลางบรรทัด)
    if (end < cleaned.length) {
      const nl = cleaned.lastIndexOf('\n', end);
      if (nl > start + size / 2) end = nl + 1;
    }
    chunks.push(cleaned.slice(start, end).trim());
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter((c) => c.length > 0);
}

/** เรียก Ollama embeddings — คืน null ถ้า model/ollama ใช้ไม่ได้ */
export async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await axios.post(
      `${OLLAMA_URL}/api/embeddings`,
      { model: EMBED_MODEL, prompt: text, keep_alive: OLLAMA_KEEP_ALIVE },
      { timeout: 60000 }
    );
    const emb = res.data?.embedding;
    if (!Array.isArray(emb) || emb.length === 0) return null;
    return emb.map(Number);
  } catch (err) {
    console.error('Embedding error:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** สร้าง/อัปเดต index: ลบของเก่าของไฟล์แล้ว embed ใหม่ทุก chunk */
export async function rebuildIndex(): Promise<{ files: number; chunks: number }> {
  // 1) ไฟล์คู่มือ (.txt/.md) ใน knowledge/
  const files = fs.existsSync(KNOWLEDGE_DIR)
    ? fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.txt') || f.endsWith('.md'))
    : [];

  // 2) Knowledge Items (ลิงก์/วิดีโอ/PDF/TXT/เว็บเพจ/บันทึก) ที่มีเนื้อหา
  let items: Array<{ id: string; type: string; title: string; content: string | null; notes: string | null }> = [];
  try {
    items = await prisma.knowledgeItem.findMany({
      select: { id: true, type: true, title: true, content: true, notes: true },
    });
  } catch {
    items = []; // ตารางยังไม่มี (migration ยังไม่รัน) → ข้าม
  }

  let chunks = 0;
  const indexOne = async (fileKey: string, content: string) => {
    const parts = chunkText(content);
    await prisma.knowledgeEmbedding.deleteMany({ where: { file: fileKey } });
    let idx = 0;
    for (const chunk of parts) {
      const embedding = await embed(chunk);
      if (!embedding) continue; // embed ไม่ได้ (Ollama offline / ไม่มี model) → ข้าม chunk นี้
      await prisma.knowledgeEmbedding.create({
        data: { file: fileKey, chunk_index: idx, content: chunk, embedding },
      });
      idx++;
      chunks++;
    }
  };

  for (const file of files) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8');
    await indexOne(file, content);
  }

  let indexedItems = 0;
  for (const item of items) {
    const text = [item.title, item.notes, item.content].filter(Boolean).join('\n');
    if (!text.trim()) continue;
    const fileKey = `${KB_ITEM_PREFIX}${item.title} [${item.id}]`;
    await indexOne(fileKey, text);
    indexedItems++;
  }

  console.log(`🔎 Semantic index rebuilt: ${files.length} files + ${indexedItems} items, ${chunks} chunks (model: ${EMBED_MODEL})`);
  return { files: files.length + indexedItems, chunks };
}

export async function indexStats(): Promise<{ files: number; chunks: number; model: string }> {
  const chunks = await prisma.knowledgeEmbedding.count();
  const files = await prisma.knowledgeEmbedding.findMany({ distinct: ['file'], select: { file: true } });
  return { files: files.length, chunks, model: EMBED_MODEL };
}

/** ค้นแบบ keyword (fallback เมื่อ embed ใช้ไม่ได้ หรือ index ว่าง) — อ่านไฟล์สด + Knowledge Items */
async function keywordSearch(query: string, topK: number) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: { file: string; chunk_index: number; content: string; score: number; source: 'keyword' }[] = [];
  const files = fs.existsSync(KNOWLEDGE_DIR)
    ? fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.txt') || f.endsWith('.md'))
    : [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8');
    chunkText(content).forEach((chunk, i) => {
      const lower = chunk.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
      if (score > 0) hits.push({ file, chunk_index: i, content: chunk, score: score / terms.length, source: 'keyword' });
    });
  }
  // Knowledge Items ด้วย — ใช้ชื่อที่ลง index ให้ตรงกัน (KB_ITEM_PREFIX + title + [id])
  try {
    const items = await prisma.knowledgeItem.findMany({
      select: { id: true, title: true, content: true, notes: true },
    });
    for (const item of items) {
      const text = [item.title, item.notes, item.content].filter(Boolean).join('\n');
      if (!text.trim()) continue;
      const fileKey = `${KB_ITEM_PREFIX}${item.title} [${item.id}]`;
      chunkText(text).forEach((chunk, i) => {
        const lower = chunk.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
        if (score > 0) hits.push({ file: fileKey, chunk_index: i, content: chunk, score: score / terms.length, source: 'keyword' });
      });
    }
  } catch {
    // ตารางยังไม่มี → ข้าม
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}

export interface SearchResult {
  file: string;
  chunk_index: number;
  content: string;
  score: number;
  source: 'semantic' | 'keyword';
}

export async function search(query: string, topK = 5): Promise<SearchResult[]> {
  const count = await prisma.knowledgeEmbedding.count();
  if (count === 0) {
    return keywordSearch(query, topK); // ยังไม่ได้ index → keyword ทันที
  }
  const queryEmbedding = await embed(query);
  if (!queryEmbedding) {
    return keywordSearch(query, topK); // Ollama offline → fallback
  }
  const rows = await prisma.knowledgeEmbedding.findMany();
  const results = rows
    .map((r) => ({ ...r, score: cosine(queryEmbedding, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return results.map((r) => ({
    file: r.file,
    chunk_index: r.chunk_index,
    content: r.content,
    score: Number(r.score.toFixed(4)),
    source: 'semantic' as const,
  }));
}
