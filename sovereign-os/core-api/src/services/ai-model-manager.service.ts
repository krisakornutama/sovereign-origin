import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// ────────────────────────────────────────────────────────────────────────────
// AI Model Manager — คุม Ollama engine ทั้งระบบ (Model Control Plane)
//
// ครอบ REST ของ Ollama: /api/tags /api/ps /api/pull /api/create /api/delete
// + unload ผ่าน /api/generate (keep_alive: 0)
// + import .gguf จาก URL → เขียน Modelfile → register เข้า Ollama
//
// ทุก method ไม่ throw ออกนอกโดยไม่จำเป็น — คืนโครง { ok, error } ให้ route
// ตัดสิน status code เอง และ stream ทั้งหมดรายงาน progress ผ่าน callback
// ────────────────────────────────────────────────────────────────────────────

export interface OllamaModelDetails {
  family?: string;
  families?: string[] | null;
  parameter_size?: string;
  quantization_level?: string;
}

export interface OllamaModel {
  name: string;
  model?: string;
  size: number; // bytes บนดิสก์
  digest?: string;
  modified_at?: string;
  details?: OllamaModelDetails;
}

export interface LoadedModel {
  name: string;
  model?: string;
  size: number;
  size_vram: number; // bytes ที่จับอยู่ใน VRAM
  expires_at?: string;
}

export interface ModelInventory {
  models: OllamaModel[];
  loaded: LoadedModel[];
  storage: { totalBytes: number; modelCount: number };
  vramBytes: number; // รวม VRAM ที่โหลดค้างอยู่
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent: number;
}

export type ProgressCb = (p: PullProgress) => void;

function baseUrl(): string {
  return config.ollama.url;
}

function ax() {
  return axios.create({ baseURL: baseUrl(), timeout: config.ollama.timeoutMs });
}

/** แปลง error จาก axios/fetch เป็นข้อความอ่านง่าย (เช่น Ollama ปิดอยู่) */
export function describeError(e: unknown): string {
  const err = e as { code?: string; message?: string; response?: { status?: number; data?: { error?: string } } };
  if (err?.code === 'ECONNREFUSED') return `เชื่อมต่อ Ollama ไม่ได้ (${baseUrl()}) — ตรวจว่า engine เปิดอยู่`;
  if (err?.response?.data?.error) return err.response.data.error;
  return err?.message || String(e);
}

/** รายชื่อโมเดลที่ install ไว้ + ตัวที่โหลดค้างใน VRAM + สรุปพื้นที่ */
export async function listModels(): Promise<ModelInventory> {
  const [tagsRes, psRes] = await Promise.all([
    ax().get<{ models: OllamaModel[] }>('/api/tags'),
    ax().get<{ models: LoadedModel[] | null }>('/api/ps'),
  ]);
  const models = tagsRes.data.models ?? [];
  const loaded = psRes.data.models ?? [];
  const totalBytes = models.reduce((s, m) => s + (m.size || 0), 0);
  const vramBytes = loaded.reduce((s, m) => s + (m.size_vram || 0), 0);
  return { models, loaded, storage: { totalBytes, modelCount: models.length }, vramBytes };
}

/** อ่าน NDJSON จาก stream → callback ทีละบรรทัด (ใช้ร่วมกับ pull/create) */
async function readNdjsonStream(body: ReadableStream<Uint8Array> | null, onLine: (obj: Record<string, unknown>) => void): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try { onLine(JSON.parse(line)); } catch { /* ข้ามบรรทัดที่ parse ไม่ได้ */ }
    }
  }
  const tail = buf.trim();
  if (tail) { try { onLine(JSON.parse(tail)); } catch { /* ignore */ } }
}

function toProgress(o: Record<string, unknown>): PullProgress {
  const total = typeof o.total === 'number' ? o.total : undefined;
  const completed = typeof o.completed === 'number' ? o.completed : undefined;
  const percent = total && completed != null ? Math.min(100, (completed / total) * 100) : 0;
  return { status: String(o.status ?? ''), digest: o.digest as string | undefined, total, completed, percent };
}

/** ดาวน์โหลดโมเดลจาก registry — stream progress (percent/speed) แบบ real-time */
export async function pullModel(modelName: string, onProgress: ProgressCb): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Ollama ตอบ ${res.status}: ${text.slice(0, 200)}` };
    }
    let lastError: string | undefined;
    await readNdjsonStream(res.body, (o) => {
      if (o.error) lastError = String(o.error);
      onProgress(toProgress(o));
    });
    return lastError ? { ok: false, error: lastError } : { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/** ดาวน์โหลดไฟล์ .gguf จาก URL ลงดิสก์ พร้อมรายงาน byte progress — คืน path ปลายทาง */
export async function downloadGguf(ggufUrl: string, destDir: string, onProgress: (downloaded: number, total: number | null) => void): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  try {
    const res = await fetch(ggufUrl, { redirect: 'follow' });
    if (!res.ok || !res.body) return { ok: false, error: `ดาวน์โหลด GGUF ไม่สำเร็จ: HTTP ${res.status}` };
    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? parseInt(totalHeader, 10) : null;

    // ตั้งชื่อไฟล์จาก URL ถ้าไม่มีนามสกุล .gguf ให้เติม
    let fileName = decodeURIComponent(new URL(ggufUrl).pathname.split('/').pop() || 'model.gguf');
    if (!fileName.toLowerCase().endsWith('.gguf')) fileName += '.gguf';
    fileName = fileName.replace(/[^\w.\-]+/g, '_');
    fs.mkdirSync(destDir, { recursive: true });
    const filePath = path.join(destDir, fileName);

    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    type WritableLike = Parameters<typeof pipeline>[1];
    const nodeStream = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    let downloaded = 0;
    nodeStream.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      onProgress(downloaded, total);
    });
    const fileStream = fs.createWriteStream(filePath) as unknown as WritableLike;
    await pipeline(nodeStream, fileStream);
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/**
 * Import โมเดลจากไฟล์ .gguf (เช่น Kimi / DeepSeek V4 จาก HuggingFace):
 * ดาวน์โหลด → เขียน Modelfile (FROM <path> + SYSTEM) → POST /api/create
 * รายงาน progress 2 เฟส: "download" (bytes) แล้ว "create" (Ollama status)
 */
export async function importGgufModel(
  opts: { modelName: string; ggufUrl: string; systemPrompt?: string },
  onProgress: (phase: 'download' | 'create', p: PullProgress) => void
): Promise<{ ok: boolean; error?: string; filePath?: string }> {
  const { modelName, ggufUrl, systemPrompt } = opts;
  if (!/^[a-zA-Z0-9._\-/:]+$/.test(modelName)) return { ok: false, error: 'ชื่อโมเดลใช้ได้เฉพาะ a-z A-Z 0-9 . _ - / :' };
  const destDir = path.resolve(process.cwd(), config.ollama.ggufDir);

  const dl = await downloadGguf(ggufUrl, destDir, (downloaded, total) => {
    onProgress('download', { status: `downloading ${fileNameOf(ggufUrl)}`, total: total ?? undefined, completed: downloaded, percent: total ? Math.min(100, (downloaded / total) * 100) : 0 });
  });
  if (!dl.ok || !dl.filePath) return { ok: false, error: dl.error, };
  const ggufPath = dl.filePath;

  const modelfile = [`FROM ${ggufPath.replace(/\\/g, '/')}`, systemPrompt ? `SYSTEM """${systemPrompt.replace(/"/g, '\\"')}"""` : ''].filter(Boolean).join('\n');

  try {
    const res = await fetch(`${baseUrl()}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, modelfile, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Ollama create ตอบ ${res.status}: ${text.slice(0, 200)}`, filePath: ggufPath };
    }
    let lastError: string | undefined;
    await readNdjsonStream(res.body, (o) => {
      if (o.error) lastError = String(o.error);
      onProgress('create', toProgress(o));
    });
    if (lastError) return { ok: false, error: lastError, filePath: ggufPath };
    return { ok: true, filePath: ggufPath };
  } catch (e) {
    return { ok: false, error: describeError(e), filePath: ggufPath };
  }
}

function fileNameOf(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'model.gguf'); } catch { return 'model.gguf'; }
}

/** ลบโมเดลออกจากพื้นที่จัดเก็บ */
export async function deleteModel(modelName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await ax().request({ method: 'DELETE', url: '/api/delete', data: { model: modelName } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/** บังคับ unload โมเดลออกจาก VRAM (keep_alive: 0 = ไม่ถือค้างหลัง request นี้) */
export async function unloadModelFromVram(modelName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await ax().post('/api/generate', { model: modelName, keep_alive: 0, prompt: '' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/** ตรวจว่า engine พร้อมใช้ (GET /api/tags ภายใน timeout สั้น) */
export async function isEngineUp(): Promise<boolean> {
  try {
    await axios.get(`${baseUrl()}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
