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
import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { hardenUpload, handledUpload, resolveInsideRoot, IMAGE_MIME } from '../../lib/harden-upload';
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
import { gateJobBeforeDispatch } from '../../services/orchestrator-approval.service';
import { notifyJobFinished, notifyJobNeedsApproval } from '../../services/orchestrator-notify.service';
import {
  listQueue,
  cancelJob,
  repeatJob,
  queueStats,
} from '../../services/orchestrator-queue.service';
import { callerStatus, placeCall } from '../../services/caller.service';
import {
  getAlertPhone,
  setAlertPhone,
  clearAlertPhone,
  maskPhone,
} from '../../services/orchestrator-alert-phone.service';
import {
  saveJobScreenshot,
  screenshotDir,
} from '../../services/orchestrator-screenshot.service';

const router = Router();

/** นามสกุลภาพหน้าจอที่ยอมรับ — runner ส่ง PNG เสมอ แต่เปิดรับ jpeg/webp ด้วย */
const SCREENSHOT_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

// รับภาพเข้าหน่วยความจำก่อน — service เป็นคนเขียนดิสก์ด้วยชื่อไฟล์สุ่มของตัวเอง
const screenshotUpload = hardenUpload({
  allowedExtensions: SCREENSHOT_EXTS,
  maxSizeMB: 10,
  mode: 'memory',
  mimeAllow: IMAGE_MIME,
});

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

/** middleware: บังคับ machine token แล้วฝาก machine ไว้บน request (handler ใช้ต่อ) */
function requireMachineToken(req: Request, res: Response, next: NextFunction) {
  authenticateMachineToken(req, res)
    .then((machine) => {
      if (!machine) return; // 401 ถูกส่งไปแล้วใน authenticateMachineToken
      (req as Request & { machine?: MachineRow }).machine = machine;
      next();
    })
    .catch((err) => {
      console.error('machine token auth error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Machine auth failed' });
    });
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
// งานเสี่ยงจะถูกพักสถานะ awaiting_approval และส่งปุ่ม ✅/🚫 ไป Telegram
router.post('/jobs', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const job = await enqueueRemoteJob(body);
    const gate = await gateJobBeforeDispatch({
      id: job.id,
      prompt: job.prompt,
      machine_id: job.machine_id,
      executor: job.executor,
      risk: body.risk ?? null,
    });
    if (gate.needsApproval) {
      await notifyJobNeedsApproval({
        jobId: job.id,
        machineName: body.machineName ?? null,
        executor: job.executor,
        prompt: job.prompt,
      });
    }
    res.status(202).json({ job: { ...job, status: gate.status }, needsApproval: gate.needsApproval, risk: gate.risk });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/required|unsupported executor|not found/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('POST /api/agent-machines/jobs error:', msg);
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

// GET /api/agent-machines/queue — คิวงานทั้งหมดสำหรับหน้าเว็บ
router.get('/queue', authenticate, async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit ?? 100) || 100;
    const [jobs, stats] = await Promise.all([listQueue(limit), queueStats()]);
    res.json({ jobs, stats });
  } catch (err) {
    console.error('GET /api/agent-machines/queue error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to load queue' });
  }
});

// GET /api/agent-machines/call-status — ระบบโทรเปิดอยู่ไหม (ไม่คืน key)
router.get('/call-status', authenticate, async (_req: Request, res: Response) => {
  try {
    // hasPhone สำคัญมาก: เดิมเปิดสวิตช์โทรได้แต่ไม่มีเบอร์ให้โทร ⇒ โทรไม่ออก
    // UI ต้องเห็นค่านี้เพื่อบอกผู้ใช้ว่าต้องตั้งเบอร์ก่อน ไม่ใช่แค่เปิดสวิตช์
    const phone = await getAlertPhone();
    res.json({ ...callerStatus(), hasPhone: Boolean(phone), phoneMasked: maskPhone(phone) });
  } catch (err) {
    console.error('GET /api/agent-machines/call-status error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read caller status' });
  }
});

// PUT /api/agent-machines/call-phone { phone } — ตั้งเบอร์ที่ระบบโทรจะใช้ (SUPERADMIN)
// validate E.164 ตอนบันทึก (service) ไม่ใช่ตอนโทร — ผิดที่ตั้งครั้งเดียว ไม่ต้องรอวันโทรจริง
router.put('/call-phone', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const phone = await setAlertPhone(req.body?.phone);
    res.json({ ok: true, hasPhone: true, phoneMasked: maskPhone(phone) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/E\.164/.test(msg)) return res.status(400).json({ error: msg });
    console.error('PUT /api/agent-machines/call-phone error:', msg);
    res.status(500).json({ error: 'Failed to save phone number' });
  }
});

// DELETE /api/agent-machines/call-phone — ลบเบอร์ กลับไปใช้ค่าจาก env (SUPERADMIN)
router.delete('/call-phone', authenticate, requireRole('SUPERADMIN'), async (_req: Request, res: Response) => {
  try {
    await clearAlertPhone();
    const phone = await getAlertPhone();
    res.json({ ok: true, hasPhone: Boolean(phone), phoneMasked: maskPhone(phone) });
  } catch (err) {
    console.error('DELETE /api/agent-machines/call-phone error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to clear phone number' });
  }
});

// POST /api/agent-machines/call-test — ยิงสายทดสอบไปเบอร์ที่ตั้งไว้ (SUPERADMIN)
// ปิดช่องสุดท้ายของ "เปิดสวิตช์โทรแล้วกดทดสอบแต่ไม่มีอะไรเกิดขึ้น":
// เดิมไม่มีที่กรอกเบอร์ ไม่มี endpoint ทดสอบ ⇒ ผู้ใช้ไม่มีทางรู้ว่าระบบโทรใช้ได้จริงหรือยัง
// ไม่ throw เด็ดขาด: provider ปิด/ไม่มี key = skipped ตั้งใจ ไม่ใช่ error ให้ UI ตกใจ
router.post('/call-test', authenticate, requireRole('SUPERADMIN'), async (_req: Request, res: Response) => {
  try {
    const phone = await getAlertPhone();
    if (!phone) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งเบอร์โทร — กรอกเบอร์ก่อนทดสอบ (Settings → ระบบโทร)' });
    }
    const result = await placeCall({
      to: phone,
      message: 'ทดสอบระบบแจ้งเตือน Sovereign Origin — ได้ยินข้อความนี้แปลว่าระบบโทรใช้งานได้',
    });
    res.json({ ...result, phoneMasked: maskPhone(phone) });
  } catch (err) {
    console.error('POST /api/agent-machines/call-test error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to place test call' });
  }
});

// GET /api/agent-machines/screenshots/:file — เปิดภาพหน้าจอตอนจบงาน (ต้องล็อกอิน)
// ไม่เปิดสาธารณะ: ภาพหน้าจอของเครื่องเป็นข้อมูลส่วนตัวของผู้ใช้
router.get('/screenshots/:file', authenticate, (req: Request, res: Response) => {
  let resolved: string;
  try {
    // resolveInsideRoot กัน path traversal (..\..\ หรือ absolute) ก่อนแตะดิสก์เสมอ
    resolved = resolveInsideRoot(screenshotDir(), req.params.file);
  } catch {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  try {
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(resolved);
  } catch (err) {
    console.error('GET /api/agent-machines/screenshots error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

// POST /api/agent-machines/queue/:id/cancel
router.post('/queue/:id/cancel', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const out = await cancelJob(req.params.id, String(req.body?.actor ?? '') || undefined);
    if (!out.ok) return res.status(409).json({ error: out.reason || 'cancel failed' });
    res.json(out);
  } catch (err) {
    console.error('POST /api/agent-machines/queue/:id/cancel error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// POST /api/agent-machines/queue/:id/repeat — ทำซ้ำงานเดิมลงคิวใหม่
router.post('/queue/:id/repeat', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const out = await repeatJob(req.params.id);
    if (!out.ok) return res.status(404).json({ error: out.reason || 'repeat failed' });
    res.json(out);
  } catch (err) {
    console.error('POST /api/agent-machines/queue/:id/repeat error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to repeat job' });
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

// POST /api/agent-machines/jobs/:id/result — ส่งผลกลับ + แจ้งเตือนผู้ใช้
router.post('/jobs/:id/result', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const job = await reportJobResult(req.params.id, req.body || {});
    // แจ้งเตือนแบบ fire-and-forget: การส่งล้มเหลวห้ามทำให้งานที่เพิ่งเสร็จกลายเป็น error
    void notifyJobFinished({
      status: job.status,
      jobId: job.id,
      machineName: machine.name,
      executor: job.executor,
      model: job.executor_model,
      result: job.result,
      error: job.error,
      exitCode: job.exit_code,
    }).catch((e) => console.error('[agent-machines] notify failed:', e instanceof Error ? e.message : e));
    res.json({ job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid status/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('POST /api/agent-machines/jobs/:id/result error:', msg);
    res.status(500).json({ error: 'Failed to record job result' });
  }
});

// POST /api/agent-machines/jobs/:id/screenshot — runner ส่งภาพหน้าจอตอนจบงาน
// auth ด้วย x-machine-token เท่านั้น และงานต้องเป็นของเครื่องที่อัปโหลดจริง
router.post(
  '/jobs/:id/screenshot',
  requireMachineToken,
  handledUpload(screenshotUpload, 'file'),
  async (req: Request, res: Response) => {
    try {
      const machine = (req as Request & { machine?: MachineRow }).machine as MachineRow;
      const file = (req as Request & { file?: { buffer?: Buffer; originalname?: string } }).file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'ต้องแนบไฟล์ภาพในฟิลด์ file' });
      }
      const url = await saveJobScreenshot(req.params.id, machine.id, file.buffer, String(file.originalname || ''));
      if (!url) return res.status(404).json({ error: 'ไม่พบงานนี้สำหรับเครื่องที่อัปโหลด' });
      res.status(201).json({ ok: true, screenshotUrl: url });
    } catch (err) {
      console.error('POST /api/agent-machines/jobs/:id/screenshot error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to store screenshot' });
    }
  }
);

export default router;