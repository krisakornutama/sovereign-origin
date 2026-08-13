// src/services/agent-team.service.ts
//
// ระบบ Agentic AI แบบทีม — ผู้ใหญ่กำหนดบทบาท (กี่คน ทำงานอะไร) เพื่อแบ่งเบาภาระ
// แต่ละบทบาทมี system prompt + capability (แหล่งข้อมูลที่อ่านได้) ของตัวเอง
// งานที่สั่ง ("run job") รันแบบเบื้องหลังใน process เดียวกัน — API ตอบกลับทันที
// และหน้าเว็บ poll สถานะได้ ระหว่างที่ผู้ใช้เปิดหน้าอื่นได้ตามปกติ
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const AGENT_MODEL = process.env.AI_MODEL || 'gemma3:4b';

export interface AgentRoleInput {
  name: string;
  emoji?: string | null;
  description: string;
  system_prompt: string;
  capability: string; // inventory | farm | risk | health | water | knowledge | kids | general
  count: number;      // จำนวน agent ในบทบาทนี้ (แบ่งเบาภาระ)
  enabled?: boolean;
}

/** บทบาทเริ่มต้น — ครอบคลุมระบบหลักของบ้าน แต่ละบทบาทอ่านข้อมูลของตัวเอง */
export const DEFAULT_ROLES: AgentRoleInput[] = [
  {
    name: 'ผู้ดูแลระบบน้ำ',
    emoji: '💧',
    description: 'เฝ้าระวังคุณภาพน้ำ + ระบบน้ำของบ้าน (ถัง/กรอง/คุณภาพ)',
    system_prompt: 'คุณคือผู้ดูแลระบบน้ำของครอบครัว อ่านข้อมูลน้ำปัจจุบันแล้วสรุปความเสี่ยงและคำแนะนำที่ปฏิบัติได้จริง',
    capability: 'water',
    count: 1,
  },
  {
    name: 'นักวิเคราะห์พลังงาน',
    emoji: '⚡',
    description: 'ดูโซลาร์ + แบตเตอรี่ + การใช้ไฟ วางแผนประหยัดพลังงาน',
    system_prompt: 'คุณคือนักวิเคราะห์พลังงานของบ้าน อ่านสถานะพลังงาน/อุปกรณ์แล้วแนะนำวิธีประหยัดและสำรองไฟ',
    capability: 'general',
    count: 1,
  },
  {
    name: 'ผู้จัดการเสบียง',
    emoji: '📦',
    description: 'ตรวจคลังเสบียง อาหาร น้ำดื่ม เชื้อเพลิง เตือนของใกล้หมด/หมดอายุ',
    system_prompt: 'คุณคือผู้จัดการเสบียง ตรวจรายการคงคลัง เตือนของเหลือน้อยและใกล้หมดอายุ แนะนำการหมุนเวียน',
    capability: 'inventory',
    count: 1,
  },
  {
    name: 'นักวางแผนฟาร์ม',
    emoji: '🌱',
    description: 'ดูแปลงผัก กำหนดการเพาะปลูก/เก็บเกี่ยว เตือนงานเกษตร',
    system_prompt: 'คุณคือนักวางแผนฟาร์ม อ่านสถานะแปลงผักแล้วแนะนำตารางรดน้ำ/ใส่ปุ๋ย/เก็บเกี่ยว',
    capability: 'farm',
    count: 1,
  },
  {
    name: 'นักวิเคราะห์ความเสี่ยง',
    emoji: '🛡️',
    description: 'อ่านข่าวภัย/การเงิน/พลังงาน + ดัชนีคุกคาม สรุปความเสี่ยงรายวัน',
    system_prompt: 'คุณคือนักวิเคราะห์ความเสี่ยง อ่านข่าวและดัชนีคุกคามแล้วสรุปความเสี่ยงหลัก + แนวรับมือ',
    capability: 'risk',
    count: 1,
  },
  {
    name: 'ผู้ช่วยสุขภาพครอบครัว',
    emoji: '🩺',
    description: 'ตรวจธงสุขภาพที่ค้าง/อาการล่าสุด เตือนให้ดูแล',
    system_prompt: 'คุณคือผู้ช่วยสุขภาพครอบครัว อ่านธงสุขภาพและอาการล่าสุดแล้วสรุปสิ่งที่ควรดูแล',
    capability: 'health',
    count: 1,
  },
  {
    name: 'ผู้จัดคลังความรู้',
    emoji: '📚',
    description: 'ดูแลคลังความรู้ จัดหมวด สรุปของใหม่ แนะนำสิ่งที่ควรเพิ่ม',
    system_prompt: 'คุณคือผู้จัดคลังความรู้ของครอบครัว อ่านรายการคลังแล้วสรุปสถานะและแนะนำสิ่งที่ควรบันทึกเพิ่ม',
    capability: 'knowledge',
    count: 1,
  },
  {
    name: 'ผู้ช่วยสอนลูก',
    emoji: '🧒',
    description: 'สรุปความคืบหน้าของลูก: การเรียน งานบ้าน การออม และพอร์ตหุ้น',
    system_prompt: 'คุณคือผู้ช่วยสอนลูก อ่านโปรไฟล์เด็ก/คะแนน/งานบ้าน/การออม แล้วสรุปความคืบหน้าและแนะนำกิจกรรม',
    capability: 'kids',
    count: 1,
  },
];

// ── Ollama DI (ใช้ในเทสต์) ──
type PostFn = (url: string, body: any) => Promise<{ data?: { response?: string } }>;
let ollamaPost: PostFn = async (url, body) => axios.post(url, body, { timeout: 180000 });
export function setAgentOllama(deps: { post?: PostFn }): void {
  if (deps?.post) ollamaPost = deps.post;
}

// ── Telegram DI (สรุปรายวัน) ──
type NotifyFn = (message: string) => Promise<void>;
let agentNotify: NotifyFn = async (message: string) => {
  try {
    const { sendTelegram } = await import('../modules/telegram/telegram.routes');
    await sendTelegram(message);
  } catch (err) {
    console.error('agent notify error:', err instanceof Error ? err.message : err);
  }
};
export function setAgentNotify(fn: NotifyFn): void {
  agentNotify = fn;
}

// ── Context: อ่านข้อมูลจริง (read-only) ตาม capability ของบทบาท ──
async function contextFor(capability: string): Promise<string> {
  try {
    switch (capability) {
      case 'inventory': {
        const items = await prisma.inventoryItem.findMany({ orderBy: { updated_at: 'desc' }, take: 25 });
        if (items.length === 0) return '(ไม่มีรายการเสบียงในระบบ)';
        return items
          .map((i) => `${i.name} | ${i.quantity} ${i.unit} | ${i.category}${i.location ? ' | ที่ ' + i.location : ''}${i.expiry_date ? ' | หมดอายุ ' + i.expiry_date.toISOString().slice(0, 10) : ''}`)
          .join('\n');
      }
      case 'farm': {
        const plots = await prisma.farmPlot.findMany({ orderBy: { created_at: 'desc' }, take: 20 });
        if (plots.length === 0) return '(ไม่มีแปลงผักในระบบ)';
        return plots
          .map((p) => `${p.name} | พืช: ${p.crop ?? '-'} | สถานะ: ${p.status}${p.expected_harvest_at ? ' | เก็บเกี่ยวคาด: ' + p.expected_harvest_at.toISOString().slice(0, 10) : ''}`)
          .join('\n');
      }
      case 'risk': {
        const headlines = await prisma.riskHeadline.findMany({ orderBy: { published: 'desc' }, take: 10 });
        const latest = await prisma.threatIndex.findFirst({ orderBy: { timestamp: 'desc' } });
        const h = headlines.length === 0 ? '(ไม่มีข่าวล่าสุด)' : headlines.map((x) => `[${x.category ?? 'ทั่วไป'}] ${x.title}`).join('\n');
        return `ดัชนีคุกคามล่าสุด: ${latest ? latest.overall + '/100 — ' + (latest.summary ?? '') : 'ยังไม่มี'}\nข่าวล่าสุด:\n${h}`;
      }
      case 'health': {
        const flags = await prisma.healthFlag.findMany({ where: { status: 'PENDING' }, orderBy: { created_at: 'desc' }, take: 10 });
        if (flags.length === 0) return '(ไม่มีธงสุขภาพค้าง)';
        return flags.map((f) => `[${f.category}] ${f.flag_type}${f.note ? ': ' + f.note : ''}`).join('\n');
      }
      case 'water': {
        const readings = await prisma.waterQualityReading.findMany({ orderBy: { measured_at: 'desc' }, take: 10 });
        if (readings.length === 0) return '(ยังไม่มีข้อมูลคุณภาพน้ำ)';
        return readings
          .map((r) => `${r.measured_at.toISOString().slice(0, 16)} | ${r.tank_name} | pH ${r.ph ?? '-'} | TDS ${r.tds ?? '-'} | ความขุ่น ${r.turbidity ?? '-'}`)
          .join('\n');
      }
      case 'knowledge': {
        const items = await prisma.knowledgeItem.findMany({ orderBy: { created_at: 'desc' }, take: 15 });
        if (items.length === 0) return '(คลังความรู้ยังว่าง)';
        return items.map((i) => `${i.title} [${i.type}]`).join('\n');
      }
      case 'kids': {
        const kids = await prisma.kidProfile.findMany({ orderBy: { created_at: 'asc' } });
        if (kids.length === 0) return '(ยังไม่มีโปรไฟล์เด็ก)';
        return kids
          .map((k) => `${k.emoji ?? '🧒'} ${k.name} (อายุ ${k.age ?? '?'}) | XP ${k.xp ?? 0} ระดับ ${levelFromXp(k.xp ?? 0)} | เงิน ${k.money_mode === 'real' ? '[จริง]' : '[จำลอง]'}`)
          .join('\n');
      }
      case 'general':
      default: {
        const devices = await prisma.device.findMany({ take: 15 });
        if (devices.length === 0) return '(ไม่มีข้อมูลอุปกรณ์)';
        return devices.map((d) => `${d.type} | ${d.is_active ? 'ทำงาน' : 'ปิด'} | หัวใจล่าสุด ${d.last_heartbeat ? d.last_heartbeat.toISOString().slice(0, 16) : '-'}`).join('\n');
      }
    }
  } catch (err) {
    console.error('agent context error:', err instanceof Error ? err.message : err);
    return '(ดึงข้อมูลเบื้องต้นไม่ได้)';
  }
}

function levelFromXp(xp: number): number {
  // triangular: level 1 ที่ 0 XP, 2 ที่ 100, 3 ที่ 300, 4 ที่ 600...
  if (xp < 0) return 1;
  return Math.floor((Math.sqrt(1 + (8 * xp) / 100) - 1) / 2) + 1;
}

// ── Role CRUD ──
export async function listAgentRoles(): Promise<any[]> {
  return prisma.agentRole.findMany({ orderBy: { created_at: 'asc' } });
}

export async function createAgentRole(input: AgentRoleInput): Promise<{ id: string }> {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  const description = String(input?.description ?? '').trim().slice(0, 300);
  const system_prompt = String(input?.system_prompt ?? '').trim().slice(0, 2000);
  const capability = String(input?.capability ?? '').trim().slice(0, 40);
  const count = Math.max(1, Math.floor(Number(input?.count) || 1));
  if (!name) throw new Error('name is required');
  if (!description) throw new Error('description is required');
  if (!system_prompt) throw new Error('system_prompt is required');
  if (!capability) throw new Error('capability is required');
  const item = await prisma.agentRole.create({
    data: {
      name,
      description,
      system_prompt,
      capability,
      count,
      emoji: input?.emoji ? String(input.emoji).trim().slice(0, 8) : '🤖',
      enabled: input?.enabled !== false,
    },
  });
  return { id: item.id };
}

export async function updateAgentRole(id: string, input: Partial<AgentRoleInput>): Promise<void> {
  const data: any = {};
  if (input.name !== undefined) data.name = String(input.name).trim().slice(0, 80);
  if (input.description !== undefined) data.description = String(input.description).trim().slice(0, 300);
  if (input.system_prompt !== undefined) data.system_prompt = String(input.system_prompt).trim().slice(0, 2000);
  if (input.capability !== undefined) data.capability = String(input.capability).trim().slice(0, 40);
  if (input.emoji !== undefined) data.emoji = String(input.emoji).trim().slice(0, 8) || '🤖';
  if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);
  if (input.count !== undefined) data.count = Math.max(1, Math.floor(Number(input.count) || 1));
  if ((input as any).daily_report !== undefined) data.daily_report = Boolean((input as any).daily_report);
  if ((input as any).report_hour !== undefined) {
    const h = Math.floor(Number((input as any).report_hour));
    data.report_hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 7;
  }
  await prisma.agentRole.update({ where: { id }, data });
}

export async function deleteAgentRole(id: string): Promise<void> {
  await prisma.agentRole.delete({ where: { id } });
}

/** คืนค่าเริ่มต้นกลับมาเมื่อตารางว่าง (idempotent) */
export async function seedDefaultRoles(): Promise<number> {
  const existing = await prisma.agentRole.findMany();
  if (existing.length > 0) return 0;
  const res = await prisma.agentRole.createMany({
    data: DEFAULT_ROLES.map((r) => ({
      ...r,
      emoji: r.emoji ?? '🤖',
      count: r.count ?? 1,
      enabled: true,
    })),
  });
  return res.count;
}

// ── Background jobs ──
export async function listAgentJobs(): Promise<any[]> {
  return prisma.agentJob.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
}

export async function getAgentJob(id: string): Promise<any> {
  const job = await prisma.agentJob.findUnique({ where: { id } });
  if (!job) throw new Error('job not found');
  return job;
}

export async function cancelAgentJob(id: string): Promise<any> {
  const job = await prisma.agentJob.findUnique({ where: { id } });
  if (!job) throw new Error('job not found');
  if (job.status === 'queued' || job.status === 'running') {
    return prisma.agentJob.update({ where: { id }, data: { status: 'cancelled', completed_at: new Date() } });
  }
  return job;
}

export async function deleteAgentJob(id: string): Promise<void> {
  await prisma.agentJob.delete({ where: { id } });
}

/** สั่งงานบทบาท → สร้าง job (queued) แล้วปล่อย runner ทำงานเบื้องหลัง — API ไม่รอ */
export async function runAgentJob(roleId: string, prompt: string): Promise<{ id: string }> {
  const role = await prisma.agentRole.findUnique({ where: { id: roleId } });
  if (!role) throw new Error('role not found');
  if (!role.enabled) throw new Error('role disabled');
  const text = String(prompt ?? '').trim().slice(0, 2000);
  if (!text) throw new Error('prompt is required');
  const job = await prisma.agentJob.create({
    data: {
      role_id: role.id,
      role_name: role.name,
      prompt: text,
      status: 'queued',
      progress: 0,
    },
  });
  // หมายเหตุ: ตัว kick ให้รันแบบเบื้องหลังอยู่ที่ route (`void processAgentQueue()`)
  // และ server.ts poll ทุก 30 วิ — กันงานค้างหลัง restart
  return { id: job.id };
}

/** ประมวลผลงานเดียว (context → Ollama → บันทึกผล) — ใช้ร่วมกัน runner กับสรุปรายวัน */
async function executeAgentJob(job: any): Promise<string | null> {
  try {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'running', started_at: new Date(), progress: 10 },
    });
    const role = await prisma.agentRole.findUnique({ where: { id: job.role_id } });
    const context = role ? await contextFor(role.capability) : '';
    const sys = role?.system_prompt || 'คุณคือผู้ช่วยอัตโนมัติของครอบครัว';
    const resp = await ollamaPost(`${OLLAMA_URL}/api/generate`, {
      model: AGENT_MODEL,
      system: sys,
      prompt:
        `ข้อมูลปัจจุบัน:\n${context}\n\nภารกิจ: ${job.prompt}\n\n` +
        'ตอบเป็นภาษาไทย สั้น กระชับ อ้างตัวเลขจริงจากข้อมูล ถ้าข้อมูลไม่พอให้บอกว่าต้องการข้อมูลอะไร',
      stream: false,
    });
    const result = String(resp.data?.response ?? '').trim().slice(0, 8000);
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'done', progress: 100, result: result || '(ไม่มีการตอบกลับ)', completed_at: new Date() },
    });
    return result || '(ไม่มีการตอบกลับ)';
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: 'error', error: msg, completed_at: new Date() },
    });
    return null;
  }
}

/** runner หลัก — ดึงงาน queued มาทำ (จำกัดพร้อมกัน 2 งาน) เรียกซ้ำได้ทุกที่ */
export async function processAgentQueue(opts?: { limit?: number }): Promise<{ ran: number }> {
  const limit = opts?.limit ?? 2;
  const queued = await prisma.agentJob.findMany({
    where: { status: 'queued' },
    orderBy: { created_at: 'asc' },
    take: limit,
  });
  let ran = 0;
  for (const job of queued) {
    if (job.status !== 'queued') continue;
    ran += 1;
    await executeAgentJob(job);
  }
  return { ran };
}

/**
 * สรุปประจำวันส่ง Telegram ของแต่ละบทบาท (ทุกเช้า ตาม report_hour)
 * — กันส่งซ้ำด้วย last_report_date (YYYY-MM-DD) — รันแบบ await ใน worker
 */
export async function runMorningReports(now?: Date): Promise<{ reported: number; skipped: number }> {
  const at = now ?? new Date();
  const today = at.toISOString().slice(0, 10);
  const roles = await prisma.agentRole.findMany({ where: { enabled: true } });
  let reported = 0;
  let skipped = 0;
  for (const role of roles) {
    if (!role.daily_report) { skipped += 1; continue; }
    if (role.last_report_date === today) { skipped += 1; continue; }
    if (at.getHours() < (role.report_hour ?? 7)) { skipped += 1; continue; }
    // สร้างงาน + รันทันที (await) แล้วส่งผลให้ Telegram
    const job = await prisma.agentJob.create({
      data: {
        role_id: role.id,
        role_name: role.name,
        prompt: `สรุปสถานะประจำวันนี้ของบทบาท ${role.name} สั้น ๆ กระชับ พร้อมตัวเลขสำคัญและข้อควรทำวันนี้`,
        status: 'queued',
        progress: 0,
      },
    });
    const result = await executeAgentJob(job);
    if (result) {
      await agentNotify(`🤖 ${role.emoji ?? '📋'} ${role.name} — สรุปประจำวัน\n${result}`);
      reported += 1;
    }
    await prisma.agentRole.update({ where: { id: role.id }, data: { last_report_date: today } });
  }
  return { reported, skipped };
}
