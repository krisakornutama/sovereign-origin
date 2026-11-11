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
import { resolveUpdateFile, isSafeRelPath } from '../../services/agent-update.service';
import { readVerifiedUpdateManifest } from '../../services/update-manifest-trust.service';
import { readDesktopManifest, resolveVerifiedDesktopAsset } from '../../services/desktop-update.service';
import { createHash } from 'node:crypto';
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
  jobMachineId,
} from '../../services/agent-machines.service';
import {
  listMachinesForUser,
  linkMachineToUser,
  unlinkMachineFromUser,
  listUserIdsForMachine,
  setMachineRole,
  requestPairing,
  revokeLanPairing,
  confirmPairing,
  userCanControl,
} from '../../services/agent-machine-hub.service';
import { gateJobBeforeDispatch, approveJob, rejectJob } from '../../services/orchestrator-approval.service';
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
  jobIdFromScreenshotFile,
} from '../../services/orchestrator-screenshot.service';
import {
  decideEnrollAttempt,
  normalizeExecutors,
  safeEqual,
} from '../../services/machine-enroll.service';
import {
  consumeEnrollToken,
  isEnrollTokenFormat,
  markEnrollTokenMachine,
  releaseEnrollTokenUse,
  verifyEnrollToken,
} from '../../services/fleet-enrollment.service';
import {
  currentFleetPolicy,
  decideUpdateGate,
  type FleetChannel,
} from '../../services/fleet-policy.service';
import {
  readNodeKitManifest,
  resolveVerifiedNodeKitAsset,
  resolveVerifiedBootstrap,
  nodeKitManifestForClient,
} from '../../services/node-kit.service';

import {
  authenticateMachineToken,
  authorizeNodeKitAccess,
  callerIp,
  enrollFailures,
  gateFleetUpdate,
  machineIps,
  publicMachine,
  requireMachineToken,
  screenshotUpload,
} from './agent-machines.shared';
import updatesRouter from './agent-machines-updates.routes';

const router = Router();
// ── ฝั่งผู้ใช้ (JWT) ──

// SITE_ADMIN เห็นข้อมูลเครื่องได้เฉพาะผ่าน /api/fleet (ซึ่งถูกจำกัดสาขาแล้ว)
// โมดูลนี้เปิด GET / ให้ทุก role ที่ล็อกอิน (OPERATOR ใช้หน้า Agent Queue) —
// ถ้าไม่กันไว้ บทบาทสาขาจะเห็นชื่อ/IP/สถานะของเครื่องทุกสาขา = หลุดขอบเขตทางอ้อม
// วางไว้ก่อนทุกเส้นของฝั่ง JWT; เส้นที่ใช้ machine token ไม่มี req.user จึงผ่านได้ตามปกติ
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === 'SITE_ADMIN') {
    return res
      .status(403)
      .json({ error: 'บทบาทนี้ดูข้อมูลเครื่องได้เฉพาะผ่าน /api/fleet', code: 'SITE_SCOPE_FLEET_ONLY' });
  }
  next();
});

// GET /api/agent-machines — รายการเครื่องที่ลงทะเบียน (หน้าเว็บใช้วาด)
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const machines = await listMachines();
    // แนบ IP ที่เห็นล่าสุดจาก heartbeat — หน้า /machine-console ใช้บอกว่าเครื่องอยู่ที่ไหนในวง
    res.json({
      machines: machines.map((m) => {
        const hit = machineIps.get(m.id);
        return {
          ...publicMachine(m),
          ip: hit?.ip ?? null,
          ipSeenAt: hit ? new Date(hit.at).toISOString() : null,
        };
      }),
    });
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
router.get('/screenshots/:file', authenticate, async (req: Request, res: Response) => {
  let resolved: string;
  try {
    // resolveInsideRoot กัน path traversal (..\..\ หรือ absolute) ก่อนแตะดิสก์เสมอ
    resolved = resolveInsideRoot(screenshotDir(), req.params.file);
  } catch {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  // ภาพหน้าจอเป็นข้อมูลของผู้ใช้ ไม่ใช่ของทุกคนที่ล็อกอินได้: ชื่อไฟล์มี jobId อยู่
  // ⇒ ต้องคุมเครื่องที่งานนั้นรันอยู่จริง (เดิมตรวจแค่ว่าล็อกอิน)
  const jobId = jobIdFromScreenshotFile(req.params.file);
  const shotMachine = jobId ? await jobMachineId(jobId) : null;
  const mine = shotMachine ? await userCanControl(req.user!.id, shotMachine) : false;
  if (!jobId || !shotMachine || !mine) {
    return res.status(403).json({ error: 'ภาพนี้ไม่ใช่งานของเครื่องที่คุณควบคุม' });
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

// POST /api/agent-machines/queue/:id/approve|reject — ด่านอนุมัติงานเสี่ยงจากหน้าเว็บ
//
// เดิมมีแค่ฝั่ง Telegram callback ⇒ ผู้ใช้ที่ไม่ได้เปิด Telegram เปิดงานเสี่ยง
// ค้างอยู่จนหมดอายุไม่ได้เลย สอง route นี้จึงเป็นเส้นหลักของหน้า /agent-queue
// approveJob/rejectJob คืน envelope ไม่ throw และ gate ด้วย status=awaiting_approval ในที่เดียว
// (กันสองคนกดพร้อมกัน) ⇒ สถานะไม่ตรงตอบ 409 ไม่ใช่ 200 ปลอม ๆ
const decide = (decideFn: (jobId: string, actor?: string) => Promise<{ ok: boolean; status: string; reason?: string }>, label: string) =>
  async (req: Request, res: Response) => {
    try {
      const out = await decideFn(req.params.id, String(req.body?.actor ?? '') || undefined);
      if (!out.ok) return res.status(409).json({ error: out.reason || `${label} failed`, status: out.status });
      res.json(out);
    } catch (err) {
      console.error(`POST /api/agent-machines/queue/:id/${label} error:`, err instanceof Error ? err.message : err);
      res.status(500).json({ error: `Failed to ${label} job` });
    }
  };

router.post('/queue/:id/approve', authenticate, requireRole('SUPERADMIN'), decide(approveJob, 'approve'));
router.post('/queue/:id/reject', authenticate, requireRole('SUPERADMIN'), decide(rejectJob, 'reject'));

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

// ── ฝั่ง runner (machine token) — อยู่ในโมดูลแยกเพื่อคุมขนาดไฟล์ ──
router.use(updatesRouter);

// POST /api/agent-machines/enroll — เครื่องใหม่ขอ token ของตัวเอง
//
// เจ้าของสั่ง 11/10/69: "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"
//   เดิมต้องออกชุดทีละเครื่องเพื่อฝัง token — ก๊อปชุดเดียวไปหลายเครื่องแล้ว
//   HUB มองเป็นเครื่องเดียว (ระบุตัวจาก token_hash) ⇒ ทำแบบนี้ใช้ไม่ได้จริง
//
// การรักษาความปลอดภัย:
//   • ไม่ต้องล็อกอิน แต่ต้องมี "รหัสเชิญ" — รหัสเดิม MACHINE_ENROLL_CODE หรือรหัสฝูง enr_...
//     (ไม่มีทั้งสองทาง = ปิดช่องนี้)
//   • เครื่องใหม่ได้ role = USER เสมอ (machine-access.service ข้อ 1) = คุมเครื่องอื่นไม่ได้
//     ต้องไปผูกเจ้าของ + กดยืนยันในหน้า /machine-console อีกที
//   • จำกัดครั้งล้มเหลวต่อผู้เรียก และไม่คืนรหัสเชิญกลับในข้อความ error
router.post('/enroll', async (req: Request, res: Response) => {
  try {
    const ip = callerIp(req);
    const prior = Math.max(0, Number(enrollFailures.get(ip) ?? 0));
    const given = String(req.body?.code ?? '').trim();
    const attempt = decideEnrollAttempt({
      expectedCode: process.env.MACHINE_ENROLL_CODE,
      code: given,
      name: req.body?.name,
      priorFailures: prior,
      fleetTokenFormat: isEnrollTokenFormat(given),
    });

    // ไม่ตั้งรหัสเดิมและไม่ได้ส่งรหัสแบบ fleet = ปิดช่องทาง (ไม่บอกว่ามี endpoint)
    if (attempt.action === 'disabled') {
      console.warn(`POST /api/agent-machines/enroll ปฏิเสธ (disabled) จาก ${ip}`);
      res.status(404).json({ error: attempt.reason, decision: 'disabled' });
      return;
    }

    if (attempt.action === 'rate_limited') {
      console.warn(`POST /api/agent-machines/enroll ปฏิเสธ (rate_limited) จาก ${ip}`);
      res.status(429).json({ error: attempt.reason, decision: 'rate_limited' });
      return;
    }

    // ชื่อเครื่องผิด = คำขอเสีย ไม่นับเป็นครั้งล้ม
    if (attempt.action === 'bad_request') {
      res.status(400).json({ error: attempt.reason, decision: 'bad_request' });
      return;
    }

    if (attempt.action === 'bad_code') {
      enrollFailures.set(ip, attempt.failures);
      console.warn(`POST /api/agent-machines/enroll ปฏิเสธ (bad_code) จาก ${ip}`);
      res.status(400).json({ error: attempt.reason, decision: 'bad_code' });
      return;
    }

    const name = attempt.name;
    if (!name) {
      // defensive — decideEnrollAttempt ต้องคืนชื่อเมื่อ action เป็น legacy/fleet
      res.status(400).json({ error: 'ไม่พบชื่อเครื่อง', decision: 'bad_request' });
      return;
    }

    const acceptedBy = attempt.action;
    let fleetTokenId: string | null = null;
    let fleetLabel: string | null = null;

    if (acceptedBy === 'fleet') {
      const consumed = await consumeEnrollToken(given, { id: null, name });
      if (!consumed.ok) {
        enrollFailures.set(ip, prior + 1);
        console.warn(`POST /api/agent-machines/enroll รหัสเชิญ fleet ใช้ไม่ได้ (${consumed.reason}) จาก ${ip}`);
        res.status(400).json({ error: 'รหัสเชิญไม่ถูกต้อง', decision: 'bad_code' });
        return;
      }
      fleetTokenId = consumed.tokenId;
      fleetLabel = consumed.label;
    }

    enrollFailures.set(ip, 0);
    const note =
      acceptedBy === 'fleet'
        ? `ลงทะเบียนเองผ่านรหัสเชิญองค์กร (${fleetLabel ?? 'fleet token'})`
        : 'ลงทะเบียนเองผ่านรหัสเชิญ (POST /enroll)';

    try {
      const created = await registerMachine({
        name,
        os: String(req.body?.os ?? 'windows'),
        executors: normalizeExecutors(req.body?.executors),
        version: String(req.body?.version ?? '') || undefined,
        note,
      });
      if (fleetTokenId) {
        await markEnrollTokenMachine(fleetTokenId, created.machine.id, name).catch((err) => {
          console.error('[fleet] mark enroll token machine failed:', err instanceof Error ? err.message : err);
        });
      }
      console.log(
        `ลงทะเบียนเครื่องใหม่ "${name}" (${created.machine.id}) จาก ${ip} — ${acceptedBy} · role เริ่มต้น USER`,
      );
      res.status(201).json({ id: created.machine.id, name: created.machine.name, token: created.token });
    } catch (err) {
      // คืนสิทธิ์การใช้รหัส ถ้าสร้างเครื่องไม่สำเร็จ — ไม่ให้ token ถูกเผาเปล่า
      if (fleetTokenId) {
        await releaseEnrollTokenUse(fleetTokenId).catch((releaseErr) => {
          console.error('[fleet] release enroll token failed:', releaseErr instanceof Error ? releaseErr.message : releaseErr);
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/agent-machines/enroll error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to enroll machine' });
  }
});

// POST /api/agent-machines/heartbeat — runner ยืนยันว่ายังออนไลน์
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    // บันทึก IP ทุกครั้งที่เครื่องรายงานตัว — เป็นแหล่งเดียวที่รู้ที่อยู่จริงของเครื่องลูก
    machineIps.set(machine.id, { ip: callerIp(req), at: Date.now() });
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
    // สัญญาณอัปเดตผ่าน pull (03/11/69 — แทนการรอรอบ self-update 6 ชม./รีบูต):
    // แนบเวอร์ชันชุดเผยแพร่ล่าสุดถ้ามี — runner เทียบกับรุ่นตัวเองเอง แล้วอัปเดตเมื่อว่างจากงาน
    const verified = readVerifiedUpdateManifest();
    if (verified.ok && verified.manifest?.version) {
      res.set('x-agent-update-version', verified.manifest.version);
    }
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

// ═════════════════════════════════════════════════════════════
//  สิทธิ์ควบคุมเครื่อง (เจ้าของสั่ง 11/10/69)
//
//  กติกา 3 ข้อที่เจ้าของยืนยันด้วยคำพูด:
//    1) เครื่อง USER สั่งงาน AI ได้ · คุมเครื่องอื่นไม่ได้
//    2) เครื่องหนึ่งอยู่ใต้ผู้ใช้ได้หลายคน (มีได้ 1–2 คน) ⇒ many-to-many
//    3) ยืนยัน LAN ต้องกดยืนยันบนเครื่องเป้าหมาย (ดู IP อย่างเดียวไม่พอ)
//
//  ทุกเส้นทางในกลุ่มนี้ = SUPERADMIN เท่านั้น และผูกกับผู้เรียกเอง
//  (ผู้เรียกต้องเป็นคนผูก/ยืนยันเครื่องนั้น — ไม่ใช่แค่เป็น SUPERADMIN คนไหนก็ได้)
// ═════════════════════════════════════════════════════════════

/** เครื่องที่ผู้เรียก (SUPERADMIN) คุมได้จริง พร้อมฟิลด์สิทธิ์ */
router.get('/mine', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const machines = await listMachinesForUser(req.user!.id);
    res.json({
      machines: machines.map((m) => ({
        ...m,
        ip: machineIps.get(m.id)?.ip ?? null,
        ipSeenAt: machineIps.has(m.id) ? new Date(machineIps.get(m.id)!.at).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error('GET /api/agent-machines/mine error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to load machines' });
  }
});

/** ผูกเครื่องไว้ใต้ผู้เรียก (ทำซ้ำได้) — ข้อ 2: หลายคนผูกเครื่องเดียวกันได้ */
router.post('/:id/link', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    await linkMachineToUser(req.params.id, req.user!.id);
    res.json({ ok: true, linked: req.user!.id });
  } catch (err) {
    console.error('POST /api/agent-machines/:id/link error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to link machine' });
  }
});

/** ถอดเครื่องออกจากผู้เรียก (คนอื่นที่ผูกไว้ยังคุมได้อยู่) */
router.delete('/:id/link', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const removed = await unlinkMachineFromUser(req.params.id, req.user!.id);
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('DELETE /api/agent-machines/:id/link error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to unlink machine' });
  }
});

/** ตั้งบทบาทของเครื่อง: HUB = คุมเครื่องอื่นได้ · USER = รับคำสั่ง + สั่งงาน AI ได้ */
router.put('/:id/role', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const role = String((req.body as { role?: unknown })?.role ?? '');
    const machine = await setMachineRole(req.params.id, role);
    res.json({ ok: true, machine });
  } catch (err) {
    console.error('PUT /api/agent-machines/:id/role error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to set role' });
  }
});

/**
 * ข้อ 3 รอบที่ 1: เจ้าของเครื่องกด "ขอคู่" → ได้รหัส 6 หลัก
 * ไปแสดงบนหน้าจอเครื่องนั้น ให้เจ้าของเครื่องพิมพ์กลับมา
 * ยัง "คุมไม่ได้" จนกว่าจะยืนยันเสร็จ
 */
router.post('/:id/pair', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const { code, machine } = await requestPairing(req.params.id, req.user!.id);
    res.json({ ok: true, code, machine, lanVerified: machine.lanVerified });
  } catch (err) {
    console.error('POST /api/agent-machines/:id/pair error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to start pairing' });
  }
});

/** ถอนการยืนยัน LAN (กดผิดไป) — คุมไม่ได้ทันที */
router.delete('/:id/pair', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    await revokeLanPairing(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/agent-machines/:id/pair error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to revoke pairing' });
  }
});

/**
 * ข้อ 3 รอบที่ 2: เครื่องเป้าหมายยืนยันด้วยรหัส
 * ยืนยันได้เฉพาะผู้ที่ผูกเครื่องนี้ไว้ (ไม่ใช่ SUPERADMIN คนไหนก็ได้)
 */
router.post('/:id/pair/confirm', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const allowed = await userCanControl(req.user!.id, req.params.id);
    const linked = await listUserIdsForMachine(req.params.id);
    if (!linked.includes(req.user!.id)) {
      res.status(403).json({ error: 'คุณไม่ได้ผูกเครื่องนี้ไว้' });
      return;
    }
    const body = (req.body || {}) as { code?: unknown; approve?: unknown };
    const result = await confirmPairing(req.params.id, {
      code: typeof body.code === 'string' ? body.code : null,
      approve: body.approve === false ? false : true,
    });
    if (!result.approved) {
      res.status(400).json({ error: result.reason || 'ยืนยันไม่สำเร็จ', allowed });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/agent-machines/:id/pair/confirm error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to confirm pairing' });
  }
});

export default router;