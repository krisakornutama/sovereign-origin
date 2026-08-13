import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { agentPolicy, AGENT_TOOLS } from '../../services/agent-policy.service';
import { agentActions } from '../../services/agent-actions.service';
import * as chatMemory from '../../services/chat-memory.service';
import * as advisor from '../../services/advisor.service';
import axios from 'axios';
import os from 'os';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CURRENT_MODEL = process.env.AI_MODEL || 'gemma3:4b';

const router = Router();

// GET /api/ai/status — สถานะ AI: Ollama ออนไลน์ไหม, โมเดลที่ใช้, ทรัพยากรระบบ
router.get('/status', authenticate, async (_req, res) => {
  let ollamaOnline = false;
  let models: Array<{ name: string; size: string }> = [];
  try {
    const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 4000 });
    ollamaOnline = true;
    models = ((r.data?.models as any[]) || []).map((m) => ({
      name: m.name,
      size: m.size != null ? (m.size / 1024 / 1024 / 1024).toFixed(1) + ' GB' : '?',
    }));
  } catch {
    ollamaOnline = false;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg();
  const cpuCount = os.cpus().length;

  res.json({
    ollamaOnline,
    ollamaUrl: OLLAMA_URL,
    currentModel: CURRENT_MODEL,
    models,
    resources: {
      cpuCores: cpuCount,
      cpuUsagePercent: cpuCount > 0 ? Math.min(100, Math.round((load[0] / cpuCount) * 100)) : null,
      memoryTotalGb: Number((totalMem / 1024 / 1024 / 1024).toFixed(1)),
      memoryFreeGb: Number((freeMem / 1024 / 1024 / 1024).toFixed(1)),
      memoryUsedPercent: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null,
    },
    uptimeSeconds: os.uptime(),
  });
});

// GET /api/ai/policy — ระดับ autonomy ปัจจุบัน + สิทธิ์ของแต่ละ tool
router.get('/policy', authenticate, (req, res) => {
  const autonomy = agentPolicy.getAutonomy();
  const tools = Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
    name,
    kind: tool.kind,
    description: tool.description,
    available: tool.kind === 'read-only' || autonomy !== 'view',
  }));
  res.json({
    autonomy,
    approvalTtlMs: agentPolicy.getApprovalTtlMs(),
    protectedIps: agentPolicy.getProtectedIps(),
    protectedProcesses: agentPolicy.getProtectedProcesses(),
    tools,
  });
});

// PUT /api/ai/policy — เปลี่ยนระดับ autonomy (Superadmin เท่านั้น)
router.put('/policy', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const { autonomy } = req.body;
  if (!autonomy) return res.status(400).json({ error: 'autonomy is required' });
  try {
    agentPolicy.setAutonomy(autonomy);
    res.json({ autonomy: agentPolicy.getAutonomy() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/ai/approvals — รายการคำขออนุมัติ (pending + ประวัติล่าสุด)
router.get('/approvals', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  res.json(agentActions.listApprovals());
});

// POST /api/ai/approvals/:id/approve — อนุมัติและสั่งให้ดำเนินการ
router.post('/approvals/:id/approve', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const result = await agentActions.approveApproval(req.params.id, req.user?.id);
  if (result.status === 'denied') {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/ai/approvals/:id/reject — ปฏิเสธคำขอ
router.post('/approvals/:id/reject', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const result = agentActions.rejectApproval(req.params.id, req.user?.id);
  if (!result) {
    return res.status(404).json({ error: 'Approval not found or already decided' });
  }
  res.json(result);
});

// ── P1: Conversational Memory — ประวัติสนทนา ──

// GET /api/ai/history — ประวัติการสนทนาล่าสุด (?limit=, default 50, max 200)
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const rows = await chatMemory.listHistory(String(req.user?.id), limit);
    res.json({
      history: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

// DELETE /api/ai/history — ล้างประวัติทั้งหมด (ทุกคนในบ้านใช้ร่วม?)
router.delete('/history', authenticate, async (req, res) => {
  const count = await chatMemory.clearHistory(String(req.user?.id));
  res.json({ success: true, deleted: count });
});

// DELETE /api/ai/history/:id — ลบข้อความเดียว
router.delete('/history/:id', authenticate, async (req, res) => {
  const ok = await chatMemory.deleteMessage(req.params.id, String(req.user?.id));
  if (!ok) return res.status(404).json({ error: 'Message not found' });
  res.json({ success: true });
});

// ── P2: Decision Support AI — ถาม "ควรทำอะไรดี" จากข้อมูลจริง ──

// POST /api/ai/advisor — วิเคราะห์จากสถานการณ์จริง → คำแนะนำไทย
router.post('/advisor', authenticate, async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 2000) return res.status(400).json({ error: 'question too long (max 2000)' });
  try {
    const context = await advisor.buildSituationContext();
    const advice = await advisor.askAdvisor(question, context);
    res.json({ question, advice, context });
  } catch (err) {
    console.error('Advisor route error:', err);
    res.status(500).json({ error: 'Advisor failed' });
  }
});

// POST /api/ai/advisor/what-if — สถานการณ์จำลอง (ฝนไม่ตก/ไฟไม่มี/ค่าใช้จ่ายขึ้น)
router.post('/advisor/what-if', authenticate, async (req, res) => {
  const scenario = String(req.body?.scenario || '');
  const days = Math.floor(Number(req.body?.days));
  if (!advisor.WHAT_IF_SCENARIOS.includes(scenario as any)) {
    return res.status(400).json({ error: `invalid scenario (${advisor.WHAT_IF_SCENARIOS.join('|')})` });
  }
  if (!(days >= 1 && days <= 365)) {
    return res.status(400).json({ error: 'days must be a number 1-365' });
  }
  try {
    const context = await advisor.buildSituationContext();
    const computed = advisor.runWhatIf(context, { scenario: scenario as any, days });
    const advice = await advisor.summarizeImpact(computed, context);
    res.json({ params: { scenario, days }, computed, advice, context });
  } catch (err) {
    console.error('Advisor what-if route error:', err);
    res.status(500).json({ error: 'What-if failed' });
  }
});

export default router;
