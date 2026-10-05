// src/services/orchestrator-queue.service.ts
//
// คิวงานฝั่งผู้ใช้ — ดู ยกเลิก ทำซ้ำ และสรุปสถานะ
//
// แยกจาก agent-machines.service (ฝั่ง HUB/เครื่อง) เพราะฝั่งนี้อ่านงานทั้งก้อนเพื่อแสดงผล
// และต้องรู้ชื่อเครื่องมาแปะงาน — ส่วน pullJobs เป็นการ "หยิบ" งานไปทำ
import { prisma } from '../lib/prisma';

const LOG_TAIL_MAX = 500;
const PROMPT_MAX = 3900;

export interface QueueRow {
  id: string;
  roleName: string;
  prompt: string;
  status: string;
  priority: number;
  machineId: string | null;
  machineName: string;
  executor: string | null;
  model: string | null;
  risk: string | null;
  result: string | null;
  error: string | null;
  exitCode: number | null;
  logTail: string | null;
  screenshotUrl: string | null;
  createdAt: string | null;
  canCancel: boolean;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** ยกเลิกได้เฉพาะงานที่ยังไม่เริ่มรัน — งานกำลังรันอยู่ต้องให้เครื่องรายงานผลเอง */
export function canCancel(status: string): boolean {
  return status === 'queued' || status === 'awaiting_approval';
}

export async function listQueue(limit = 100): Promise<QueueRow[]> {
  const rows: any[] = await prisma.agentJob.findMany({
    orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
    take: Math.max(1, Math.min(500, limit)),
  });
  const machines: any[] = await prisma.agentMachine.findMany({});
  const byId = new Map(machines.map((m) => [String(m.id), m]));

  return rows.map((j) => {
    const machine = j.machine_id ? byId.get(String(j.machine_id)) : undefined;
    return {
      id: j.id,
      roleName: str(j.role_name),
      prompt: str(j.prompt),
      status: str(j.status),
      priority: Number(j.priority ?? 0),
      machineId: j.machine_id ?? null,
      machineName: machine?.name ?? '',
      executor: j.executor ?? null,
      model: j.executor_model ?? null,
      risk: j.risk ?? null,
      result: j.result ?? null,
      error: j.error ?? null,
      exitCode: j.exit_code ?? null,
      logTail: j.log_tail ? str(j.log_tail).slice(-LOG_TAIL_MAX) : null,
      screenshotUrl: j.screenshot_url ?? null,
      createdAt: j.created_at ? new Date(j.created_at).toISOString() : null,
      canCancel: canCancel(str(j.status)),
    };
  });
}

export interface CancelResult {
  ok: boolean;
  status: string;
  reason?: string;
}

export async function cancelJob(jobId: string, actor?: string): Promise<CancelResult> {
  try {
    const res = await prisma.agentJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'awaiting_approval'] } },
      data: { status: 'cancelled', approved_by: actor ?? null, approved_at: new Date() },
    });
    const count = (res as any)?.count ?? 0;
    if (count === 0) {
      return { ok: false, status: 'unknown', reason: 'ยกเลิกไม่ได้ — งานนี้รันอยู่หรือจบไปแล้ว' };
    }
    return { ok: true, status: 'cancelled' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[orchestrator-queue] cancelJob failed:', reason);
    return { ok: false, status: 'error', reason };
  }
}

/** คัดลอกงานเดิมเป็นงานใหม่ที่ยังรออยู่ (ผล/สถานะเก่าไม่ติดไปด้วย) */
export async function repeatJob(jobId: string): Promise<CancelResult> {
  try {
    const src: any = await prisma.agentJob.findUnique({ where: { id: jobId } });
    if (!src) return { ok: false, status: 'unknown', reason: 'ไม่พบงานที่จะทำซ้ำ' };
    await prisma.agentJob.create({
      data: {
        role_id: src.role_id,
        role_name: src.role_name,
        prompt: src.prompt,
        status: 'queued',
        machine_id: src.machine_id ?? null,
        executor: src.executor ?? null,
        executor_model: src.executor_model ?? null,
        executor_agent: src.executor_agent ?? null,
        workspace: src.workspace ?? null,
        priority: src.priority ?? 0,
        risk: null, // ให้ตัดสินใจความเสี่ยงใหม่ทุกครั้งที่ทำซ้ำ
      } as any,
    });
    return { ok: true, status: 'queued' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[orchestrator-queue] repeatJob failed:', reason);
    return { ok: false, status: 'error', reason };
  }
}

export interface QueueStats {
  queued: number;
  running: number;
  awaitingApproval: number;
  done: number;
  error: number;
  total: number;
}

export async function queueStats(): Promise<QueueStats> {
  const out: QueueStats = { queued: 0, running: 0, awaitingApproval: 0, done: 0, error: 0, total: 0 };
  try {
    const groups: any[] = await (prisma.agentJob.groupBy as any)({ by: ['status'], _count: { _all: true } });
    for (const g of groups) {
      const n = Number(g?._count?._all ?? 0);
      out.total += n;
      if (g.status === 'queued') out.queued = n;
      else if (g.status === 'running') out.running = n;
      else if (g.status === 'awaiting_approval') out.awaitingApproval = n;
      else if (g.status === 'done') out.done = n;
      else if (g.status === 'error') out.error = n;
    }
  } catch (err) {
    console.error('[orchestrator-queue] stats failed:', err instanceof Error ? err.message : err);
  }
  return out;
}

function esc(text: unknown): string {
  return str(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** ข้อความสั้น ๆ สำหรับตอบใน Telegram (หน้าเว็บใช้ตารางแทน) */
export function summarizeJob(j: any, machineName = ''): string {
  const status = str(j?.status);
  const head =
    status === 'done' ? '✅ เสร็จ' :
    status === 'error' ? '⚠️ ล้มเหลว' :
    status === 'awaiting_approval' ? '⏸ รออนุมัติ' :
    status === 'running' ? '⏳ กำลังรัน' :
    '⏱ รอคิว';
  const lines = [`${head} · ${machineName || 'HUB'}${j?.executor ? ` · ${j.executor}` : ''}`];
  lines.push(`<code>${esc(j?.id)}</code>`);
  if (j?.prompt) lines.push(esc(str(j.prompt).slice(0, 160)));
  if (status === 'error' && j?.error) lines.push(`error: ${esc(str(j.error).slice(0, 200))}`);
  else if (j?.result) lines.push(`${esc(str(j.result).slice(0, 200))}`);
  return lines.join('\n');
}

// ── คำสั่ง Telegram (pure — ทดสอบได้โดยไม่ต้องมี DB) ──

export type QueueCommand =
  | { action: 'list'; limit: number }
  | { action: 'add'; prompt: string; executor: string | null; machineId: string | null; model: string | null; priority: number; risk: 'high' | 'low' | null }
  | { action: 'cancel'; jobId: string }
  | { action: 'repeat'; jobId: string };

const ID_RE = /^[A-Za-z0-9-]+$/;

/** executor ที่ระบบรู้จัก — ใช้ตัดสินว่า @xxx เป็นตัวย่อ executor หรือเป็นแค่คำใน prompt */
const KNOWN_EXECUTORS = new Set(['opencode', 'freebuff', 'echo', 'ollama-inline']);

/**
 * /queue [n] · /add <งาน> [@executor] [@machine:<id>] [@model:<โมเดล>] [@priority:<0-9>] [@risk:high|low]
 * /cancel <id> · /repeat <id>
 *
 * โมเดลและเครื่องมาจากผู้ใช้เสมอ — ถ้าไม่ระบุคือ null ไม่เดาให้
 */
export function parseQueueCommand(text: unknown): QueueCommand | null {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith('/')) return null;
  const space = raw.indexOf(' ');
  const cmd = (space === -1 ? raw.slice(1) : raw.slice(1, space)).toLowerCase();
  const rest = space === -1 ? '' : raw.slice(space + 1).trim();

  if (cmd === 'queue') {
    if (!rest) return { action: 'list', limit: 10 };
    const n = Number(rest);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { action: 'list', limit: Math.min(50, Math.floor(n)) };
  }

  if (cmd === 'cancel' || cmd === 'repeat') {
    if (!rest || !ID_RE.test(rest)) return null;
    return cmd === 'cancel'
      ? { action: 'cancel', jobId: rest }
      : { action: 'repeat', jobId: rest };
  }

  if (cmd === 'add') {
    if (!rest) return null;
    const tokens = rest.split(/\s+/);
    const flags: Record<string, string> = {};
    const words: string[] = [];
    for (const tok of tokens) {
      const m = tok.match(/^@([a-zA-Z]+):(.+)$/);
      // flag ต้องมีค่าตามมา ไม่งั้นถือเป็นคำทั่วไป (prompt อาจมี @ ธรรมดา)
      if (m && m[2]) {
        flags[m[1].toLowerCase()] = m[2];
        continue;
      }
      // ตัวย่อสั้น ๆ: @opencode → executor (เฉพาะชื่อที่ระบบรู้จักเท่านั้น)
      // @alice ใน prompt จึงยังเป็นคำทั่วไป ไม่ถูกเดาผิด
      const bare = tok.match(/^@([a-zA-Z-]+)$/);
      if (bare && KNOWN_EXECUTORS.has(bare[1].toLowerCase())) {
        flags.executor = bare[1].toLowerCase();
        continue;
      }
      words.push(tok);
    }
    const prompt = words.join(' ').trim().slice(0, PROMPT_MAX);
    if (!prompt) return null;
    const pr = flags.priority !== undefined ? Number(flags.priority) : NaN;
    const risk = flags.risk?.toLowerCase();
    return {
      action: 'add',
      prompt,
      executor: flags.executor ?? null,
      machineId: flags.machine ?? null,
      model: flags.model ?? null,
      priority: Number.isFinite(pr) ? pr : 0,
      risk: risk === 'high' || risk === 'low' ? risk : null,
    };
  }

  return null;
}