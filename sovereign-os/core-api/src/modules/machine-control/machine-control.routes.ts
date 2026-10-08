// src/modules/machine-control/machine-control.routes.ts
//
// Endpoint ของ "ช่องควบคุมเครื่องระยะไกล" — แยกสองกลุ่มผู้เรียกชัดเจน
// เหมือนโมดูล agent-machines (เจตนาเดียวกัน: คนกับเครื่องใช้คนละหลักฐานยืนยันตัวตน)
//
//   1) runner (เครื่องที่ถูกควบคุม) → x-machine-token เท่านั้น
//        POST /next     ค้างไว้ (long-poll) รอคำสั่ง
//        POST /frame    ส่งภาพหน้าจอ 1 เฟรม
//        POST /result   รายงานผลของคำสั่งที่ได้รับ
//
//   2) ผู้ใช้ (หน้าเว็บ) → JWT + SUPERADMIN เท่านั้น
//        GET  /state          สถานะช่องของทุกเครื่อง (มีคนดูอยู่ไหม/ล่าสุดเมื่อไร)
//        GET  /frame/:id      ภาพล่าสุดเป็น binary (ใช้เป็น fallback ของสตรีม)
//        POST /command        ยิงคำสั่งตรง ๆ (ไฟล์ที่ไม่ต้องเปิด session ดูจอ)
//
// ทุก handler มี try/catch ในตัวเอง — Express 4 ไม่ส่ง error ออกจาก async handler
// (handler ที่ throw จะ "ค้างไม่ตอบ" ไม่ใช่ 500 — ผู้เรียกจะรอจน timeout)
import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuditService } from '../../services/audit.service';
import { authenticateToken, type MachineRow } from '../../services/agent-machines.service';
import { getIo } from '../../realtime/io-registry';
import {
  DEFAULT_POLL_WAIT_MS,
  MAX_FRAME_BYTES,
  awaitCommand,
  controlState,
  dispatchCommand,
  getLatestFrame,
  isAuditableCommandType,
  machineRoom,
  submitFrame,
  submitResult,
} from '../../services/machine-control.service';

const router = Router();

/** รับ machine จาก x-machine-token (หรือ Bearer เดียวกัน เผื่อบางไคลเอนต์ส่งมาแบบนั้น) */
async function authenticateMachineToken(req: Request, res: Response): Promise<MachineRow | null> {
  const header = req.header('x-machine-token') || '';
  const auth = req.header('authorization') || '';
  const token = header || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!token) {
    res.status(401).json({ error: 'invalid or missing machine token' });
    return null;
  }
  const machine = await authenticateToken(token);
  if (!machine) {
    res.status(401).json({ error: 'invalid or missing machine token' });
    return null;
  }
  return machine;
}

/** middleware: บังคับ machine token แล้วฝาก machine ไว้บน request */
function requireMachineToken(req: Request, res: Response, next: NextFunction) {
  authenticateMachineToken(req, res)
    .then((machine) => {
      if (!machine) return; // 401 ถูกส่งไปแล้ว
      (req as Request & { machine?: MachineRow }).machine = machine;
      next();
    })
    .catch((err) => {
      console.error('machine-control token auth error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Machine auth failed' });
    });
}

// ── ฝั่ง runner (machine token) ──

// POST /api/machine-control/next — long-poll รอคำสั่ง
// คืน { command: null } เมื่อครบเวลา = "ยังไม่มีงาน" ไม่ใช่ error
router.post('/next', requireMachineToken, async (req: Request, res: Response) => {
  const machine = (req as Request & { machine?: MachineRow }).machine!;
  try {
    const requested = Number((req.body as { waitMs?: unknown } | undefined)?.waitMs);
    const waitMs =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, DEFAULT_POLL_WAIT_MS * 2)
        : DEFAULT_POLL_WAIT_MS;

    const command = await awaitCommand(machine.id, waitMs);

    // ผู้ใช้ปิดหน้าไปแล้วระหว่างรอ — เขียนตอบไปก็ไม่มีใครรับ
    if (res.writableEnded) return;
    res.json({ command });
  } catch (err) {
    console.error('POST /api/machine-control/next error:', err instanceof Error ? err.message : err);
    if (!res.writableEnded) res.status(500).json({ error: 'Failed to await command' });
  }
});

// POST /api/machine-control/frame — runner ส่งภาพหน้าจอ 1 เฟรม (base64 ใน JSON)
// ใช้ JSON ไม่ใช่ multipart เพราะเฟรมวิ่งถี่ — หลีกเลี่ยง overhead ของ multipart ต่อเฟรม
router.post('/frame', requireMachineToken, async (req: Request, res: Response) => {
  const machine = (req as Request & { machine?: MachineRow }).machine!;
  try {
    const body = (req.body || {}) as {
      data?: unknown;
      mime?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const raw = typeof body.data === 'string' ? body.data : '';
    if (!raw) {
      res.status(400).json({ error: 'data (base64) required' });
      return;
    }

    // เช็คขนาดจากความยาว base64 ก่อน decode — ไม่ต้องเสียหน่วยความจำถอดของที่ใหญ่เกิน
    const approxBytes = Math.floor((raw.length * 3) / 4);
    if (approxBytes > MAX_FRAME_BYTES) {
      res.status(413).json({ error: `frame too large (max ${MAX_FRAME_BYTES} bytes)` });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      res.status(400).json({ error: 'data is not valid base64' });
      return;
    }

    const frame = submitFrame(machine.id, buffer, {
      mime: typeof body.mime === 'string' ? body.mime : undefined,
      width: Number.isFinite(Number(body.width)) ? Number(body.width) : null,
      height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
    });
    if (!frame) {
      res.status(413).json({ error: 'frame rejected (empty or too large)' });
      return;
    }

    // relay ต่อให้ browser ที่กำลังดูเครื่องนี้ (ไม่ผ่าน sanitize ของ io.emit โดยเจตนา —
    // io.to(room).emit ไม่ถูกครอบ และ payload นี้ไม่ใช่ข้อมูลธุรกิจที่จะต้องตัดฟิลด์)
    getIo()?.to(machineRoom(machine.id)).emit('control:frame', {
      machineId: machine.id,
      seq: frame.seq,
      at: frame.at,
      mime: frame.mime,
      width: frame.width,
      height: frame.height,
      data: raw,
    });

    res.json({ ok: true, seq: frame.seq });
  } catch (err) {
    console.error('POST /api/machine-control/frame error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to store frame' });
  }
});

// POST /api/machine-control/result — runner รายงานผลของคำสั่ง
router.post('/result', requireMachineToken, async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { commandId?: unknown; ok?: unknown; result?: unknown; error?: unknown };
    const commandId = typeof body.commandId === 'string' ? body.commandId : '';
    if (!commandId) {
      res.status(400).json({ error: 'commandId required' });
      return;
    }

    const routed = submitResult(commandId, body.ok !== false, body.result, typeof body.error === 'string' ? body.error : undefined);
    if (!routed) {
      // คำสั่งหมดอายุ/ไม่รู้จัก — ตอบ 200 ให้ runner ไปต่อ ไม่ใช่ error ที่ต้อง retry
      res.json({ ok: false, reason: 'unknown or expired command' });
      return;
    }

    getIo()?.to(machineRoom(routed.machineId)).emit('control:result', {
      machineId: routed.machineId,
      commandId,
      ok: routed.ok,
      result: routed.result,
      error: routed.error,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/machine-control/result error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to record result' });
  }
});

// ── ฝั่งผู้ใช้ (JWT + SUPERADMIN) ──
// SUPERADMIN เท่านั้น: ช่องนี้สั่งรันคำสั่งบนเครื่องอื่นได้จริง (เมาส์/คีย์บอร์ด/ไฟล์ทั้งไดรฟ์)

// GET /api/machine-control/state — สถานะช่องของทุกเครื่อง
router.get('/state', authenticate, requireRole('SUPERADMIN'), async (_req: Request, res: Response) => {
  try {
    res.json({ channels: controlState() });
  } catch (err) {
    console.error('GET /api/machine-control/state error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read control state' });
  }
});

// GET /api/machine-control/frame/:machineId — ภาพล่าสุดเป็น binary
// ใช้ตอนผู้ใช้เพิ่งเปิดหน้า (ยังไม่ได้รับเฟรมจาก socket) — ได้ภาพทันทีไม่ต้องรอรอบถัดไป
router.get('/frame/:machineId', authenticate, requireRole('SUPERADMIN'), (req: Request, res: Response) => {
  try {
    const frame = getLatestFrame(String(req.params.machineId));
    if (!frame) {
      res.status(404).json({ error: 'no frame yet' });
      return;
    }
    res.set({
      'Content-Type': frame.mime,
      'Content-Length': String(frame.buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(frame.buffer);
  } catch (err) {
    console.error('GET /api/machine-control/frame error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read frame' });
  }
});

// POST /api/machine-control/command — ยิงคำสั่งไปเครื่องหนึ่ง (สำหรับงานที่ไม่ต้องเปิดดูจอ)
// ตัวอย่าง: { machineId, type: 'fs.list', payload: { path: 'E:\\' } }
router.post('/command', authenticate, requireRole('SUPERADMIN'), async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as {
      machineId?: unknown;
      type?: unknown;
      payload?: unknown;
      timeoutMs?: unknown;
    };
    const machineId = typeof body.machineId === 'string' ? body.machineId : '';
    const type = typeof body.type === 'string' ? body.type : '';
    if (!machineId || !type) {
      res.status(400).json({ error: 'machineId and type required' });
      return;
    }

    const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : undefined;
    const command = dispatchCommand(
      machineId,
      type,
      (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>,
      timeoutMs,
    );

    // ร่องรอยของ "ใครทำอะไรกับเครื่องไหน" — เฉพาะคำสั่งที่เปลี่ยนสถานะ
    // (เมาส์/คีย์บอร์ด/เฟรม ไม่บันทึก: ถี่เกินไปจน audit ไม่มีคุณค่า)
    if (isAuditableCommandType(type) && req.user) {
      AuditService.logAction({
        userId: req.user.id,
        actionType: `MACHINE_CONTROL ${type} ${machineId}`,
        payload: { machineId, type, payload: command.payload, commandId: command.id, ip: req.ip },
      }).catch(console.error);
    }

    res.json({ command });
  } catch (err) {
    console.error('POST /api/machine-control/command error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to dispatch command' });
  }
});

export default router;
