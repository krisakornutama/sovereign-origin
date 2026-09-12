// src/services/business-agent-executor.service.ts
//
// ตัวเชื่อม ผู้ช่วย AI ประจำธุรกิจ → รันบน Ollama (เดิม) โดยฉีดบริบทธุรกิจจริงเข้า prompt
// แยกไฟล์จาก business.service เพื่อ reuse ระบบ AgentRole/AgentJob เดิมแบบไม่ผูกกันลึก
import { prisma } from '../lib/prisma';
import axios from 'axios';
import { getModelForTask } from './ai-router.service';
import { businessContextFor } from './business.service';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';

/** รัน job ของผู้ช่วยธุรกิจ: context ธุรกิจ + system prompt ของ role → Ollama → บันทึกผลลง AgentJob เดิม */
export async function runBusinessAgentJob(jobId: string, agentKey: string, businessId: string): Promise<void> {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  try {
    await prisma.agentJob.update({ where: { id: jobId }, data: { status: 'running', started_at: new Date(), progress: 10 } });
    const role = await prisma.agentRole.findUnique({ where: { id: job.role_id } });
    const context = await businessContextFor(businessId, agentKey);
    const sys = role?.system_prompt || 'คุณคือผู้ช่วยธุรกิจ';
    const model = await getModelForTask('GENERAL_ASSISTANT', process.env.AI_MODEL || 'gemma3:4b');
    const userPrompt = [
      'ข้อมูลธุรกิจปัจจุบัน:',
      context,
      '',
      'ภารกิจ: ' + job.prompt,
      '',
      'ตอบเป็นภาษาไทย สั้น กระชับ อ้างตัวเลขจริงจากข้อมูล ถ้าข้อมูลไม่พอให้บอกว่าต้องการข้อมูลอะไร',
    ].join('\n');
    const resp = await axios.post(
      OLLAMA_URL + '/api/generate',
      { model, system: sys, prompt: userPrompt, stream: false, keep_alive: OLLAMA_KEEP_ALIVE },
      { timeout: 120000 }
    );
    const result = String(resp.data?.response ?? '').trim().slice(0, 8000);
    await prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'done', progress: 100, result: result || '(ไม่มีการตอบกลับ)', completed_at: new Date() },
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
    await prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'error', error: msg, completed_at: new Date() },
    });
  }
}
