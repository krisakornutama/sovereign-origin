// src/modules/agent-machines/agent-machines.routes.ts
//
// Endpoint ฝั่ง HUB สำหรับ Agent Orchestration
//
// แยกสองกลุ่มผู้เรียกชัดเจน (สำคัญมากเรื่องความปลอดภัย):
// 1) ผู้ใช้ (หน้าเว็บ)  → JWT เหมือน route อื่นของระบบ
// 2) runner (เครื่องคอม) → x-machine-token เท่านั้น ไม่ใช้ JWT ของคน
//
// ทั้งสองทางมี try/catch ในตัวเอง เพราะ Express 4 ไม่ส่ง error ออกจาก
// async handler ที่ throw (คนเรียกจะค้างไม่ตอบ)
import { Router, type Request, type Response } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  prisma,
  authenticateToken,
  registerMachine,
  listMachines,
  heartbeat,
  enqueueRemoteJob,
  pullJobs,
  reportJobResult,
  setMachineStatus,
  type MachineRow,
} from '../../services/agent-machines.service';

const router = Router();

/** ดึง machine จาก x-machine-token หรือ Authorization: Bearer <token> */
async function authenticateMachineToken(req: Request, res: Response): Promise<MachineRow | null> {
  const header = req.header('x-machine-token') || '';
  const auth = req.header('authorization') || '';
  const token = header || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const machine = await authenticateToken(token);
  if (!machine) {
    res.status(401).json({ error: 'invalid or missing machine token' });
    return null;
  }
  return machine;
}

// ── ฝั่งผู้ใช้ (JWT) ──

// GET /api/agent-machines — รายการเครื่องที่ลงทะเบียน (หน้าเว็บใช้วาด)
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const machines = await listMachines();
    res.json({ machines });
  } catch (err) {
    console.error('GET /api/agent-machines error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to load machines' });
  }
});

// POST /api/agent-machines/register — สร้างเครื่อง + คืน token ครั้งเดียว
router.post('/register', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const { name, os, capabilities, executors, note, version } = req.body || {};
    const out = await registerMachine({ name, os, capabilities, executors, note, version });
    res.status(201).json({ machine: out.machine, token: out.token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/name is required/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('POST /api/agent-machines/register error:', msg);
    res.status(500).json({ error: 'Failed to register machine' });
  }
});

// POST /api/agent-machines/:id/status — เปิด/ปิดเครื่อง (SUPERADMIN)
router.post('/:id/status', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['online', 'offline', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'status must be online|offline|disabled' });
    }
    const machine = await setMachineStatus(req.params.id, status);
    res.json({ machine });
  } catch (err) {
    console.error('POST /api/agent-machines/:id/status error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to update machine status' });
  }
});

// POST /api/agent-machines/jobs — สั่งงานให้เครื่องที่ระบุ
router.post('/jobs', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const job = await enqueueRemoteJob(req.body || {});
    res.status(202).json({ job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/required|unsupported executor|not found/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('POST /api/agent-machines/jobs error:', msg);
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

// ── ฝั่ง runner (machine token) ──

// POST /api/agent-machines/heartbeat — runner ยืนยันว่ายังออนไลน์
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const updated = await heartbeat(machine.id, String(req.body?.version ?? '') || undefined);
    res.json({ machine: updated });
  } catch (err) {
    console.error('POST /api/agent-machines/heartbeat error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to heartbeat' });
  }
});

// POST /api/agent-machines/jobs/pull — ดึงงานที่เครื่องนี้ทำได้
router.post('/jobs/pull', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const limit = Number(req.body?.limit ?? 3) || 3;
    const jobs = await pullJobs(machine, limit);
    res.json({ machine: { id: machine.id, name: machine.name }, jobs });
  } catch (err) {
    console.error('POST /api/agent-machines/jobs/pull error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to pull jobs' });
  }
});

// POST /api/agent-machines/jobs/:id/result — ส่งผลกลับ
router.post('/jobs/:id/result', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const job = await reportJobResult(req.params.id, req.body || {});
    res.json({ job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid status/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('POST /api/agent-machines/jobs/:id/result error:', msg);
    res.status(500).json({ error: 'Failed to record job result' });
  }
});

export default router;