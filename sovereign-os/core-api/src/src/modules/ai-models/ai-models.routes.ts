import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  listModels,
  pullModel,
  importGgufModel,
  deleteModel,
  unloadModelFromVram,
  isEngineUp,
  describeError,
  type PullProgress,
} from '../../services/ai-model-manager.service';
import { TASK_TYPES, getAllRoutes, setModelForTask, getModelForTask } from '../../services/ai-router.service';
import { config } from '../../config';
// legacy env constants ของแต่ละโดเมน — ใช้แสดง effective default ใน UI (DB > env > spec)
import { CODING_MODEL } from '../../services/coding-agent.service';
import { VISION_MODEL } from '../../services/vision.service';
import { MODEL as GOVERNOR_MODEL } from '../../services/governor.service';
import { MODEL as ADVISOR_MODEL } from '../../services/advisor.service';

const LEGACY_DEFAULTS = {
  CODING_AGENT: CODING_MODEL,
  VISION_AI: VISION_MODEL,
  REASONING_GOVERNOR: GOVERNOR_MODEL,
  GENERAL_ASSISTANT: ADVISOR_MODEL,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// /api/v1/ai — Ollama Control System (SUPERADMIN เท่านั้น — คุม engine กลาง)
//   GET    /models            → inventory + VRAM + task mappings
//   POST   /models/pull       → stream progress แบบ NDJSON (real-time)
//   POST   /models/import-gguf → เริ่ม job ดาวน์โหลด+register → GET /jobs/:id ติดตาม
//   POST   /models/route      → ตั้ง task→model mapping
//   DELETE /models/:name      → ลบโมเดล
//   POST   /models/:name/unload → บังคับปล่อย VRAM
// ────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate, requireRole('SUPERADMIN'));

// ── import jobs (in-memory — รื้อ server แล้วหาย ไม่เป็นไร เพราะ Ollama เก็บผลจริง) ──
interface ImportJob {
  id: string;
  modelName: string;
  status: 'queued' | 'downloading' | 'creating' | 'done' | 'error';
  phase: 'download' | 'create' | '-';
  progress: PullProgress | null;
  error?: string;
  startedAt: number;
  updatedAt: number;
}
const jobs = new Map<string, ImportJob>();

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if ((j.status === 'done' || j.status === 'error') && now - j.updatedAt > 30 * 60 * 1000) jobs.delete(id);
  }
}

function writeNdjson(res: Response, obj: unknown): void {
  res.write(JSON.stringify(obj) + '\n');
}

// ── GET /models — inventory + VRAM + task mappings ──
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const [inventory, routes, engineUp] = await Promise.all([
      listModels(),
      getAllRoutes(LEGACY_DEFAULTS),
      isEngineUp(),
    ]);
    res.json({ ...inventory, routes, taskTypes: TASK_TYPES, engineUp, engineUrl: config.ollama.url });
  } catch (e) {
    res.status(502).json({ error: describeError(e), engineUp: false, engineUrl: config.ollama.url, routes: null });
  }
});

// ── POST /models/pull {model} — stream progress NDJSON ทันที ──
router.post('/models/pull', async (req: Request, res: Response) => {
  const model = String(req.body?.model || '').trim();
  if (!model) return res.status(400).json({ error: 'ต้องระบุ model' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  let closed = false;
  req.on('close', () => { closed = true; });
  writeNdjson(res, { status: `เริ่มดาวน์โหลด ${model}`, percent: 0 });
  const result = await pullModel(model, (p) => {
    if (!closed) writeNdjson(res, p);
  });
  if (closed) return;
  if (result.ok) writeNdjson(res, { status: 'done', percent: 100, ok: true });
  else { res.status(502); writeNdjson(res, { status: 'error', error: result.error, ok: false }); }
  res.end();
});

// ── POST /models/import-gguf {modelName, ggufUrl, systemPrompt?} — เริ่ม job ──
router.post('/models/import-gguf', async (req: Request, res: Response) => {
  const modelName = String(req.body?.modelName || '').trim();
  const ggufUrl = String(req.body?.ggufUrl || '').trim();
  const systemPrompt = req.body?.systemPrompt ? String(req.body.systemPrompt) : undefined;
  if (!modelName || !ggufUrl) return res.status(400).json({ error: 'ต้องระบุ modelName และ ggufUrl' });
  if (!/^https?:\/\//i.test(ggufUrl)) return res.status(400).json({ error: 'ggufUrl ต้องเป็น http(s) URL' });

  pruneJobs();
  const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: ImportJob = { id, modelName, status: 'queued', phase: '-', progress: null, startedAt: Date.now(), updatedAt: Date.now() };
  jobs.set(id, job);

  // รันพื้นหลัง — request นี้ตอบ jobId ทันที ไม่ block (ตาม acceptance criteria)
  (async () => {
    job.status = 'downloading';
    const result = await importGgufModel({ modelName, ggufUrl, systemPrompt }, (phase, p) => {
      job.phase = phase;
      job.progress = p;
      job.updatedAt = Date.now();
      if (phase === 'create') job.status = 'creating';
    });
    if (result.ok) {
      job.status = 'done';
      job.phase = 'create';
      job.progress = { status: 'done', percent: 100 };
    } else {
      job.status = 'error';
      job.error = result.error;
    }
    job.updatedAt = Date.now();
  })().catch((e) => { job.status = 'error'; job.error = describeError(e); job.updatedAt = Date.now(); });

  res.status(202).json({ jobId: id, modelName });
});

// ── GET /jobs/:id — สถานะ import job ──
router.get('/jobs/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'ไม่พบ job' });
  res.json(job);
});

// ── POST /models/route {taskType, model} — ตั้ง task→model ──
router.post('/models/route', async (req: Request, res: Response) => {
  const taskType = String(req.body?.taskType || '');
  const model = String(req.body?.model || '');
  const r = await setModelForTask(taskType, model);
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true, taskType, model, effective: await getModelForTask(taskType) });
});

// ── DELETE /models/:name — ลบโมเดลออกจากพื้นที่จัดเก็บ ──
router.delete('/models/:name', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name || '');
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อโมเดล' });
  const r = await deleteModel(name);
  if (!r.ok) return res.status(502).json(r);
  res.json({ ok: true, name });
});

// ── POST /models/:name/unload — ปล่อย VRAM ทันที ──
router.post('/models/:name/unload', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name || '');
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อโมเดล' });
  const r = await unloadModelFromVram(name);
  if (!r.ok) return res.status(502).json(r);
  // อ่าน VRAM ใหม่หลัง unload เพื่อให้ UI สะท้อนทันที (acceptance criteria)
  try {
    const inv = await listModels();
    res.json({ ok: true, name, vramBytes: inv.vramBytes, loaded: inv.loaded });
  } catch {
    res.json({ ok: true, name });
  }
});

export default router;
