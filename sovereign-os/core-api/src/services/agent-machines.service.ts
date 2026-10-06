// src/services/agent-machines.service.ts
//
// Agent Orchestration Hub — ฝั่ง HUB (โน้ตบุ๊คตัวกลาง)
//
// เครื่องคอมที่ทำงานจริง (runner) ดึงงานจากที่นี่ผ่าน LAN แบบ pull
// ⇒ เครื่องเป้าหมายไม่ต้องเปิดพอร์ตรับ และ HUB ไม่ต้องมี public URL
//
// ความปลอดภัย:
// - เก็บ sha256(token) เท่านั้น ไม่มี token จริงลง DB (ถ้า DB รั่วก็ยังใช้ไม่ได้)
// - token คืนครั้งเดียวตอน register — ผู้ใช้เก็บใน .env ของ runner
// - pullJobs กรองด้วย executor/capability ของเครื่อง และ mark dispatched
//   ทันทีกันสองเครื่องหยิบงานเดียวกัน
//
// หมายเหตุ: job ที่ machine_id = null ยังทำงานเหมือนเดิม (runner ใน process ของ HUB)
// ค่า default ไม่เปลี่ยนพฤติกรรมของระบบเดิม
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

export { prisma };

export type ExecutorName = 'opencode' | 'freebuff' | 'echo' | 'ollama-inline';

const EXECUTORS: ExecutorName[] = ['opencode', 'freebuff', 'echo', 'ollama-inline'];

export interface MachineRow {
  id: string;
  name: string;
  os?: string;
  capabilities?: unknown;
  executors?: unknown;
  status?: string;
  last_heartbeat?: Date | null;
  version?: string | null;
  note?: string | null;
}

export interface EnqueueInput {
  machineId: string;
  executor: string;
  prompt: string;
  roleId?: string;
  roleName?: string;
  model?: string | null;
  agent?: string | null;
  workspace?: string | null;
  priority?: number;
  timeoutSec?: number | null;
}

export interface JobResultInput {
  status: 'done' | 'error' | 'cancelled';
  result?: string | null;
  error?: string | null;
  exitCode?: number | null;
  logTail?: string | null;
  screenshotUrl?: string | null;
  progress?: number | null;
}

// ── token helpers (pure — ทดสอบได้โดยไม่ต้องมี DB) ──

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ── register / auth ──

export interface RegisterInput {
  name: string;
  os?: string;
  capabilities?: string[];
  executors?: string[];
  note?: string;
  version?: string;
}

export async function registerMachine(input: RegisterInput): Promise<{ machine: MachineRow; token: string }> {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('machine name is required');
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities.filter(Boolean).map(String) : [];
  const executors = Array.isArray(input.executors) ? input.executors.filter(Boolean).map(String) : [];
  if (executors.length === 0) executors.push('echo'); // runner ที่ไม่มี agent ก็ยังลงทะเบียนเพื่อทดสอบได้

  const token = generateToken();
  const machine = await prisma.agentMachine.create({
    data: {
      name,
      os: input.os || 'windows',
      capabilities,
      executors,
      token_hash: hashToken(token),
      note: input.note ?? null,
      version: input.version ?? null,
      status: 'offline',
    },
  });
  return { machine: machine as unknown as MachineRow, token };
}

export async function authenticateToken(token: string): Promise<MachineRow | null> {
  if (!token) return null;
  const found = await prisma.agentMachine.findFirst({ where: { token_hash: hashToken(token) } });
  if (!found) return null;
  return found as unknown as MachineRow;
}

export async function listMachines(): Promise<MachineRow[]> {
  const rows = await prisma.agentMachine.findMany({ orderBy: { created_at: 'asc' } });
  return rows as unknown as MachineRow[];
}

export async function heartbeat(machineId: string, version?: string): Promise<MachineRow> {
  const updated = await prisma.agentMachine.update({
    where: { id: machineId },
    data: { status: 'online', last_heartbeat: new Date(), ...(version ? { version } : {}) },
  });
  return updated as unknown as MachineRow;
}

export async function setMachineStatus(machineId: string, status: string): Promise<MachineRow> {
  const updated = await prisma.agentMachine.update({ where: { id: machineId }, data: { status } });
  return updated as unknown as MachineRow;
}

// ── dispatch ──

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** เครื่องนี้รัน executor นี้ได้ไหม (executor ต้องอยู่ในรายการ และถ้าระบุ tag ต้องมีด้วย) */
export function canMachineRun(machine: MachineRow, executor: string, tag?: string | null): boolean {
  if (!executor) return false;
  if (machine.status === 'disabled') return false;
  const ex = asArray(machine.executors);
  if (ex.length > 0 && !ex.includes(executor)) return false;
  if (tag) {
    const caps = asArray(machine.capabilities);
    if (!caps.includes(tag)) return false;
  }
  return true;
}

export async function enqueueRemoteJob(input: EnqueueInput) {
  const executor = String(input.executor ?? '').trim();
  if (!EXECUTORS.includes(executor as ExecutorName)) {
    throw new Error(`unsupported executor: ${executor || '(empty)'}`);
  }
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('prompt is required');

  const machine = await prisma.agentMachine.findUnique({ where: { id: input.machineId } });
  if (!machine) throw new Error(`machine not found: ${input.machineId}`);

  // role_id เป็น UUID NOT NULL + FK — ส่งค่าว่าง PostgreSQL จะปฏิเสธทั้งประกาศ
  // ("invalid length: expected length 32, found 0") และหน้าเว็บ/Telegram ไม่ได้ส่งมาเลย
  // ถ้าไม่ระบุ ให้ผูกกับบทบาทจริงที่มีอยู่ และถ้าไม่มีบทบาทเลย = บอกชัด ไม่เขียนงานทิ้งลอย
  let roleId = input.roleId?.trim() || '';
  let roleName = input.roleName?.trim() || '';
  if (!roleId) {
    const fallback = await prisma.agentRole.findFirst({
      where: { enabled: true },
      orderBy: { created_at: 'asc' },
      select: { id: true, name: true },
    });
    if (!fallback) throw new Error('no agent role available — สร้างบทบาท (agent role) อย่างน้อยหนึ่งตัวก่อนสั่งงาน');
    roleId = fallback.id;
    if (!roleName) roleName = fallback.name;
  }

  const job = await prisma.agentJob.create({
    data: {
      role_id: roleId,
      role_name: roleName || 'remote',
      prompt,
      status: 'queued',
      machine_id: input.machineId,
      executor,
      executor_model: input.model ?? null,
      executor_agent: input.agent ?? null,
      workspace: input.workspace ?? null,
      priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
    },
  });
  return job;
}

/**
 * runner ดึงงานของตัวเอง — กรองเฉพาะ executor ที่เครื่องนี้ทำได้
 * และเรียงตาม priority สูงสุดก่อน (คิวของผู้ใช้จัด)
 */
export async function pullJobs(machine: MachineRow, limit = 3) {
  const queued = await prisma.agentJob.findMany({
    where: { status: 'queued', machine_id: machine.id },
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
  });
  const mine = (queued as any[]).filter((j) => canMachineRun(machine, j.executor, j.capability_tag ?? null));

  const out: any[] = [];
  for (const job of mine.slice(0, Math.max(1, limit))) {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'running', dispatched_at: new Date() },
    });
    out.push({
      id: job.id,
      executor: job.executor,
      prompt: job.prompt,
      model: job.executor_model,
      agent: job.executor_agent,
      workspace: job.workspace,
      priority: job.priority,
    });
  }
  return out;
}

export async function reportJobResult(jobId: string, input: JobResultInput) {
  const status = String(input?.status ?? '');
  if (!['done', 'error', 'cancelled'].includes(status)) {
    throw new Error(`invalid status: ${status || '(empty)'}`);
  }
  const data: Record<string, unknown> = {
    status,
    completed_at: new Date(),
  };
  if (input.result != null) data.result = String(input.result);
  if (input.error != null) data.error = String(input.error);
  if (input.exitCode != null && Number.isFinite(Number(input.exitCode))) data.exit_code = Number(input.exitCode);
  if (input.logTail != null) data.log_tail = String(input.logTail);
  if (input.screenshotUrl != null) data.screenshot_url = String(input.screenshotUrl);
  if (input.progress != null) data.progress = Math.max(0, Math.min(100, Number(input.progress)));

  const updated = await prisma.agentJob.update({ where: { id: jobId }, data: data as any });
  return updated;
}