// src/services/orchestrator-approval.service.ts
//
// ด่านอนุมัติงานเสี่ยง — งานที่อาจพังระบบ/เงินจริงต้องรอคนกดก่อนถึงเครื่องคอม
//
// เก็บสถานะไว้บนแถว AgentJob เอง (ไม่เพิ่มตารางใหม่) เพราะ 1 job = 1 คำขออนุมัติ
// และการเพิ่มตารางใหม่คือ migration ที่ต้องรอจังหวะผู้ใช้พร้อม
//
// ทุกฟังก์ชันคืนผลลัพธ์ ไม่ throw — ถ้าพังตรงนี้งานที่ทำได้จะกลายเป็นงานที่พัง
import { prisma } from '../lib/prisma';

export type RiskLevel = 'low' | 'high';

/**
 * คำที่บ่งบอกว่างานแตะของที่ย้อนกลับไม่ได้
 *
 * หลักการ: จับที่ **ขอบเขต** ไม่ใช่แค่คำกริยา
 * “ลบไฟล์ log เก่า” เป็นงานประจำ ไม่ควรถูกกัก แต่ “ลบฐานข้อมูลทั้งหมด” ต้องกัก
 * ⇒ ใช้คำว่า “ทั้งหมด/all/the whole” เป็นสัญญาณ ไม่ใช้คำว่า “ลบ” ล้วน ๆ
 */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /rm\s+-rf/i,
  /drop\s+table/i,
  /delete\s+from/i,
  /truncate\s+/i,
  /format\s+c:/i,
  /git\s+push\s+.*--force/i,
  /force[\s-]?push/i,
  /deploy\s+.*prod/i,
  /production/i,
  /\b(?:sudo|shutdown|reboot|rmdir)\b/i,
  /(?:ลบ|ล้าง|ทิ้ง|ฟอร์แมต)[^newline]{0,40}(?:ทั้งหมด|ทั้งอัน|the\s+whole)/,
  /ทิ้ง[^newline]{0,20}ฐานข้อมูล/,
  /deploy|ปล่อยขึ้นระบบจริง/i,
  /โอนเงิน/,
  /จ่ายเงิน/,
  /ขายจริง|ตัดเงินจริง/,
  /force[- ]?push|บังคับดัน/i,
  /wipe\s+(?:the\s+)?(?:database|data|disk|volume)/i,
];

export const RISKY_STATUS = 'awaiting_approval';

/**
 * ระดับความเสี่ยง — ผู้ใช้บังคับได้เอง ถ้าไม่บังคับระบบจะดูจากเนื้อหา prompt
 */
export function classifyRisk(prompt: unknown, forced?: RiskLevel | null): RiskLevel {
  if (forced === 'high' || forced === 'low') return forced;
  const text = String(prompt ?? '');
  return HIGH_RISK_PATTERNS.some((re) => re.test(text)) ? 'high' : 'low';
}

export interface DispatchGateInput {
  id: string;
  prompt?: string | null;
  machine_id?: string | null;
  executor?: string | null;
  risk?: RiskLevel | null;
}

export interface DispatchGateResult {
  needsApproval: boolean;
  risk: RiskLevel;
  status: string;
}

/**
 * เรียกก่อนส่งงานให้เครื่อง — งานเสี่ยงถูกพักไว้สถานะ awaiting_approval
 * (runner จึงดึงไม่ได้ เพราะ pull เฉพาะ status=queued) จนกว่าจะได้กดอนุมัติ
 */
export async function gateJobBeforeDispatch(job: DispatchGateInput): Promise<DispatchGateResult> {
  const risk = classifyRisk(job?.prompt, job?.risk);
  if (risk !== 'high') {
    return { needsApproval: false, risk, status: 'queued' };
  }
  try {
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: RISKY_STATUS, risk },
    });
  } catch (err) {
    // ถ้าบันทึกไม่ได้ ให้ปล่อยผ่านแบบปลอดภัย (ปล่อยให้รัน) แต่ log ไว้
    console.error('[orchestrator-approval] เขียนสถานะ awaiting_approval ไม่สำเร็จ:', err instanceof Error ? err.message : err);
    return { needsApproval: false, risk, status: 'queued' };
  }
  return { needsApproval: true, risk, status: RISKY_STATUS };
}

export interface DecisionResult {
  ok: boolean;
  status: string;
  reason?: string;
}

/**
 * กด ✅ — ปล่อยงานกลับเข้าคิวให้เครื่องดึง
 * ใช้ updateMany แบบมีเงื่อนไข (status=awaiting_approval) กันสองคนกดพร้อมกันแล้วเขียนทับกัน
 */
export async function approveJob(jobId: string, actor?: string): Promise<DecisionResult> {
  try {
    const res = await prisma.agentJob.updateMany({
      where: { id: jobId, status: RISKY_STATUS },
      data: { status: 'queued', approved_by: actor ?? null, approved_at: new Date() },
    });
    const count = (res as any)?.count ?? 0;
    if (count === 0) return { ok: false, status: 'unknown', reason: 'งานนี้ไม่ได้รออนุมัติอยู่แล้ว (อาจถูกตัดสินใจไปแล้ว)' };
    return { ok: true, status: 'queued' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[orchestrator-approval] approveJob failed:', reason);
    return { ok: false, status: 'error', reason };
  }
}

/** กด 🚫 — ยกเลิกงาน เครื่องจะไม่ได้รับงานนี้ */
export async function rejectJob(jobId: string, actor?: string): Promise<DecisionResult> {
  try {
    const res = await prisma.agentJob.updateMany({
      where: { id: jobId, status: RISKY_STATUS },
      data: { status: 'cancelled', approved_by: actor ?? null, approved_at: new Date() },
    });
    const count = (res as any)?.count ?? 0;
    if (count === 0) return { ok: false, status: 'unknown', reason: 'งานนี้ไม่ได้รออนุมัติอยู่แล้ว' };
    return { ok: true, status: 'cancelled' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[orchestrator-approval] rejectJob failed:', reason);
    return { ok: false, status: 'error', reason };
  }
}

/** แยก callback ของงานนี้ออกจาก approve:/reject: ของ agent action เดิม */
export function parseJobCallback(data: unknown): { action: 'approve' | 'reject'; jobId: string } | null {
  const m = String(data ?? '').match(/^job(ok|reject):([A-Za-z0-9-]+)$/);
  if (!m) return null;
  return { action: m[1] === 'ok' ? 'approve' : 'reject', jobId: m[2] };
}