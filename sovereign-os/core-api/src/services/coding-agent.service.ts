// src/services/coding-agent.service.ts
//
// Coding Agent — ผู้ใช้พิมพ์ภาพรวมครั้งเดียว → AI วางแผน → เขียนโค้ดทุกไฟล์
// → ตรวจงาน (lint/review) → เสนอทางต่อ 2-4 ตัวเลือก — รันแบบเบื้องหลัง (poll ได้)
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CODING_MODEL = process.env.CODING_MODEL || process.env.OLLAMA_MODEL || 'qwen3:8b';

// ── Pure: ตัวแยก JSON จากคำตอบของ AI ──

export interface PlanFile {
  path: string;
  purpose: string;
}
export interface CodePlan {
  title: string;
  files: PlanFile[];
}

/** ดึง JSON ออกจากคำตอบ (รองรับ ```json fence และคำพูดประกอบรอบข้าง) */
export function parsePlanJson(raw: string): CodePlan {
  try {
    const text = String(raw ?? '');
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return { title: '', files: [] };
    const obj = JSON.parse(candidate.slice(start, end + 1));
    return {
      title: String(obj?.title ?? ''),
      files: Array.isArray(obj?.files)
        ? obj.files.map((f: any) => ({
            path: String(f?.path ?? ''),
            purpose: String(f?.purpose ?? ''),
          }))
        : [],
    };
  } catch {
    return { title: '', files: [] };
  }
}

/** ดึงรายการ "ทำอะไรต่อ" (2-4 ตัวเลือก) จากคำตอบ AI */
export function parseSuggestionsJson(raw: string): string[] {
  try {
    const m = String(raw ?? '').match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => String(x ?? '').trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

// ── Prompt builders ──

export function buildPlanPrompt(task: string, context?: string): string {
  return (
    'คุณคือสถาปนิกโค้ดของระบบ Sovereign OS — ผู้ใช้บอกภาพรวมครั้งเดียว แล้วคุณวางแผนการเขียนโค้ดให้เสร็จทั้งระบบ\n' +
    'ภาษาไทย พูดสั้น ตอบเฉพาะ JSON ตามรูปแบบ:\n' +
    '```json\n{"title": "ชื่องาน", "files": [{"path": "path", "purpose": "ไฟล์นี้ใช้ทำอะไร"}]}\n```\n' +
    'จำนวนไฟล์ 1-6 ไฟล์ ขนาดเหมาะสมกับงาน แต่ละไฟล์มี purpose ชัดเจน\n\n' +
    (context ? `บริบทของระบบ (มีอยู่แล้ว):\n${String(context).slice(0, 2000)}\n\n` : '') +
    `งานที่ต้องการ: ${String(task).slice(0, 2000)}`
  );
}

export function buildCodePrompt(file: PlanFile, task: string, existingCode?: string): string {
  return (
    'คุณคือวิศวกรซอฟต์แวร์ เขียนโค้ดให้สมบูรณ์ พร้อมใช้งานได้ทันที ตอบเฉพาะโค้ด อย่าอธิบายเพิ่ม\n' +
    `งานรวม: ${String(task).slice(0, 1000)}\n` +
    `ไฟล์: ${file.path}\n` +
    `วัตถุประสงค์: ${file.purpose}\n` +
    (existingCode ? `โค้ดเดิมในไฟล์นี้:\n${String(existingCode).slice(0, 3000)}\n` : '') +
    'ถ้าเป็น TypeScript ให้มี type annotation ครบ รองรับ error handling ภาษาไทยในข้อความแสดงผล'
  );
}

// ── Flow: วางแผน → เขียนโค้ด → ตรวจ → เสนอต่อ ──

/** ตรวจแผนก่อนเริ่มเขียน — กันงานจบ "done" ทั้งที่ไม่มีไฟล์เลย */
export function validatePlan(plan: CodePlan): string | null {
  if (!plan) return 'แผนงานว่างเปล่า';
  const files = Array.isArray(plan.files) ? plan.files : [];
  if (files.length === 0) return 'แผนไม่มีไฟล์ — ลองสั่งงานใหม่อีกครั้ง';
  if (files.some((f) => !String(f?.path ?? '').trim())) return 'แผนมีไฟล์ที่ไม่มี path — ลองสั่งงานใหม่อีกครั้ง';
  return null;
}

/** ขั้น 1: วางแผนจากภาพรวม (AI) — fallback เป็นแผนไฟล์เดียวถ้า AI ตอบไม่เป็น JSON */
export async function planTask(task: string, context?: string): Promise<CodePlan> {
  const resp = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: CODING_MODEL,
      system: 'คุณเป็นสถาปนิกโค้ด ตอบเป็นภาษาไทย ให้ JSON ตามรูปแบบที่ขอ',
      prompt: buildPlanPrompt(task, context),
      stream: false,
    },
    { timeout: 300000 }
  );
  const plan = parsePlanJson(resp.data?.response ?? '');
  if (!plan.title && plan.files.length === 0) {
    return {
      title: String(task).slice(0, 80),
      files: [{ path: 'generated/index.ts', purpose: 'โค้ดหลักที่สร้างจากภาพรวม' }],
    };
  }
  if (!plan.title) plan.title = String(task).slice(0, 80);
  return plan;
}

/** ขั้น 2: เขียนโค้ดจริงสำหรับแต่ละไฟล์ในแผน */
export async function generateFile(file: PlanFile, task: string, existingCode?: string): Promise<string> {
  const resp = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: CODING_MODEL,
      system: 'คุณเป็นวิศวกรซอฟต์แวร์ เขียนโค้ดภาษา TypeScript/Python/Shell ที่รันได้จริง ตอบเฉพาะโค้ด',
      prompt: buildCodePrompt(file, task, existingCode),
      stream: false,
    },
    { timeout: 300000 }
  );
  let code = String(resp.data?.response ?? '').trim();
  const fenced = code.match(/```(?:ts|typescript|js|javascript|py|python|sh|bash|json)?\s*([\s\S]*?)```/);
  if (fenced) code = fenced[1].trim();
  if (!code) code = `// ${file.path}\n// ${file.purpose}\n// (AI ไม่ได้คืนโค้ด — กรุณาลองใหม่อีกครั้ง)\n`;
  return code;
}

/** ขั้น 3: ตรวจงานอัตโนมัติ (ไม่ต้องพึ่ง AI ทุกครั้ง) — โครงสร้าง/ความเสี่ยง/secret ฮาร์ดโค้ด */
export function autoReview(files: Array<{ path: string; content: string }>): Array<{ severity: 'error' | 'warning' | 'info'; message: string }> {
  const findings: Array<{ severity: 'error' | 'warning' | 'info'; message: string }> = [];
  for (const f of files) {
    const content = String(f?.content ?? '');
    if (!content.trim()) {
      findings.push({ severity: 'error', message: `${f.path}: ไฟล์ว่างเปล่า` });
    }
    if (content.includes('TODO') || content.includes('FIXME')) {
      findings.push({ severity: 'warning', message: `${f.path}: มี TODO/FIXME ค้างอยู่` });
    }
    if (/eval\s*\(|child_process\.exec\s*\(|execSync\s*\(/.test(content)) {
      findings.push({ severity: 'warning', message: `${f.path}: พบ eval/exec — ตรวจสอบ input จากผู้ใช้` });
    }
    if (/api[_\-]?key|password\s*=\s*["']|secret\s*=\s*["']/i.test(content)) {
      findings.push({ severity: 'warning', message: `${f.path}: พบข้อความคล้าย secret ฮาร์ดโค้ด — ควรใช้ env` });
    }
    if (/console\.log\(/.test(content) && f.path.endsWith('.ts')) {
      findings.push({ severity: 'info', message: `${f.path}: มี console.log — ควรใช้ logger ของระบบ` });
    }
  }
  if (findings.length === 0) {
    findings.push({ severity: 'info', message: 'ผ่านการตรวจเบื้องต้น: ไม่พบข้อผิดพลาดชัดเจน' });
  }
  return findings;
}

/** ขั้น 4: เสนอทางต่อ 2-4 ตัวเลือก (AI) */
export async function suggestNext(task: string, resultSummary: string): Promise<string[]> {
  const resp = await axios.post(
    `${OLLAMA_URL}/api/generate`,
    {
      model: CODING_MODEL,
      system: 'คุณเป็นผู้ช่วยวางแผนต่อ ตอบเป็นภาษาไทย สั้น เฉพาะรายการ',
      prompt:
        `งานที่เสร็จแล้ว: ${String(task).slice(0, 500)}\n` +
        `ผลลัพธ์: ${String(resultSummary).slice(0, 500)}\n\n` +
        'เสนอสิ่งที่อยากทำต่อ 2-4 ตัวเลือก เป็น JSON array ของสตริงภาษาไทย เช่น ["เพิ่มการทดสอบ", "เพิ่มหน้า UI"] ตอบเฉพาะ array',
      stream: false,
    },
    { timeout: 300000 }
  );
  const opts = parseSuggestionsJson(resp.data?.response ?? '');
  if (opts.length === 0) {
    return ['เพิ่มการทดสอบให้โค้ดที่สร้าง', 'เพิ่มเอกสาร README', 'เชื่อมต่อกับระบบที่มีอยู่'];
  }
  return opts;
}

// ── Background job (poll ได้, ทำงานระหว่างเปิดหน้าอื่น) ──

export async function listCodingJobs(): Promise<any[]> {
  return prisma.codingJob.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
}
export async function deleteCodingJob(id: string): Promise<void> {
  await prisma.codingJob.delete({ where: { id } });
}

/** สั่งงานเขียนโค้ด → สร้าง job (queued) แล้วปล่อย runner — API ไม่รอ */
export async function createCodingJob(task: string): Promise<{ id: string }> {
  const text = String(task ?? '').trim().slice(0, 3000);
  if (!text) throw new Error('task is required');
  const job = await prisma.codingJob.create({
    data: { title: text.slice(0, 120), task: text, status: 'queued', progress: 0 },
  });
  return { id: job.id };
}

/** ประมวลผลงานเดียว: วางแผน → เขียนโค้ดทุกไฟล์ → ตรวจ → บันทึกผล */
async function executeCodingJob(job: any): Promise<string | null> {
  try {
    await prisma.codingJob.update({
      where: { id: job.id },
      data: { status: 'running', started_at: new Date(), progress: 10 },
    });
    const plan = await planTask(job.task);
    const planErr = validatePlan(plan);
    if (planErr) throw new Error(planErr);
    await prisma.codingJob.update({
      where: { id: job.id },
      data: { progress: 30, plan_json: JSON.stringify(plan) },
    });
    const files: Array<{ path: string; content: string }> = [];
    let i = 0;
    for (const pf of plan.files.slice(0, 6)) {
      const content = await generateFile(pf, job.task);
      files.push({ path: pf.path, content });
      i += 1;
      await prisma.codingJob.update({
        where: { id: job.id },
        data: { progress: 30 + Math.round((i / plan.files.length) * 40) },
      });
    }
    const review = autoReview(files);
    const result = {
      plan,
      files,
      review,
      summary: `สร้าง ${files.length} ไฟล์${review.some((r) => r.severity === 'error') ? ' — มีข้อผิดพลาดให้แก้' : ''}`,
    };
    await prisma.codingJob.update({
      where: { id: job.id },
      data: {
        status: 'done',
        progress: 100,
        files_json: JSON.stringify(files),
        result: JSON.stringify(result),
        completed_at: new Date(),
      },
    });
    return JSON.stringify(result);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
    await prisma.codingJob.update({
      where: { id: job.id },
      data: { status: 'error', error: msg, completed_at: new Date() },
    });
    return null;
  }
}

/** runner — ดึงงาน queued มาทำทีละ 1 งาน (งานเขียนโค้ดใช้เวลานานในเครื่อง CPU) */
export async function processCodingQueue(): Promise<{ ran: number }> {
  const queued = await prisma.codingJob.findMany({
    where: { status: 'queued' },
    orderBy: { created_at: 'asc' },
    take: 1,
  });
  let ran = 0;
  for (const job of queued) {
    // อ้างสิทธิ์แบบ atomic — กัน runner สองตัว (route kick + interval) รันงานเดียวกันซ้ำ
    const claimed = await prisma.codingJob.updateMany({
      where: { id: job.id, status: 'queued' },
      data: { status: 'running' },
    });
    if (claimed.count === 0) continue;
    ran += 1;
    await executeCodingJob(job);
  }
  return { ran };
}
