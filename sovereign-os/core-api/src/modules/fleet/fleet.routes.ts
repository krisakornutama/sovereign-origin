// src/modules/fleet/fleet.routes.ts
//
// ── Fleet Control Plane API ─────────────────────────────────────────────────
// ทุก route ในไฟล์นี้ = SUPERADMIN เท่านั้น (จัดการเครื่องทั้งฝูง)
//
//   GET    /api/fleet/overview                     ภาพรวม + compliance + เวอร์ชันที่เผยแพร่
//   GET    /api/fleet/policy                       นโยบายช่องทาง/rollout
//   PUT    /api/fleet/policy                       แก้ rollout / default channel
//   GET    /api/fleet/enroll-tokens                รายการรหัสเชิญ (ไม่คืนรหัสจริง)
//   POST   /api/fleet/enroll-tokens                สร้างรหัสเชิญ (คืนรหัสจริงครั้งเดียว)
//   POST   /api/fleet/enroll-tokens/:id/revoke     เพิกถอนรหัส
//   PUT    /api/fleet/machines/:id                 ตั้ง channel / site / group / tags
//   POST   /api/fleet/machines/:id/rotate-token    หมุน machine token (คืนครั้งเดียว)
//
// ⚠️ Express 4: async handler ที่ throw จะค้างไม่ตอบ — ทุก handler จึงมี try/catch
// ⚠️ ห้ามส่ง token_hash หรือ token จริงออกไป ยกเว้น field ที่ตั้งใจคืนครั้งเดียว
import { Router, type Request, type Response } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuditService } from '../../services/audit.service';
import { buildFleetOverview } from '../../services/fleet-overview.service';
import {
  fleetPolicyForClient,
  loadFleetPolicy,
  setMachineOverride,
  updateFleetPolicy,
  validateMachineOverride,
  validatePolicyPatch,
} from '../../services/fleet-policy.service';
import {
  createEnrollToken,
  listEnrollTokensDb,
  revokeEnrollToken,
} from '../../services/fleet-enrollment.service';
import { listFleetGroups, listFleetSites } from '../../services/fleet-persistence.service';
import { getMachineWithAccess } from '../../services/agent-machine-hub.service';
import { rotateMachineToken, type MachineRow } from '../../services/agent-machines.service';

const router = Router();

// ทั้งโมดูลเป็นพื้นที่ของผู้ดูแลระบบ — ไม่มี route ย่อยที่เปิดให้ USER
router.use(authenticate, requireRole('SUPERADMIN'));

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function machineIdOf(req: Request): string | null {
  const id = String(req.params.id ?? '').trim();
  // UUID มีขีดกลาง — isSafeKey ยอมรับ A-Z a-z 0-9 _ - และคุมความยาว
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/** คัดเฉพาะฟิลด์ที่เปิดเผยได้ — ไม่มี token_hash */
function machineForClient(row: MachineRow) {
  return {
    id: row.id,
    name: row.name,
    os: row.os ?? 'unknown',
    status: row.status ?? 'offline',
    version: row.version ?? null,
    lastHeartbeat: row.last_heartbeat ?? null,
    role: row.role ?? null,
    note: row.note ?? null,
    lanVerified: Boolean(row.lan_confirmed_at),
  };
}

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    res.json(await buildFleetOverview());
  } catch (err) {
    console.error('[fleet] overview failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านภาพรวมฝูงเครื่องไม่ได้');
  }
});

router.get('/policy', async (_req: Request, res: Response) => {
  try {
    res.json({ policy: fleetPolicyForClient(await loadFleetPolicy()) });
  } catch (err) {
    console.error('[fleet] read policy failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านนโยบายไม่ได้');
  }
});

router.put('/policy', async (req: Request, res: Response) => {
  try {
    const checked = validatePolicyPatch(req.body);
    if (!checked.ok) return fail(res, 400, checked.error);
    const policy = await updateFleetPolicy(checked.patch, req.user?.id ?? null);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'FLEET_POLICY_UPDATE',
      payload: {
        defaultChannel: policy.defaultChannel,
        channels: policy.channels,
        requireLanVerification: policy.requireLanVerification,
        notes: policy.notes,
      },
    });
    res.json({ policy: fleetPolicyForClient(policy) });
  } catch (err) {
    console.error('[fleet] update policy failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'บันทึกนโยบายไม่ได้');
  }
});

router.get('/sites', async (_req: Request, res: Response) => {
  try {
    res.json({ sites: await listFleetSites() });
  } catch (err) {
    console.error('[fleet] list sites failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการสาขาไม่ได้');
  }
});

router.get('/groups', async (_req: Request, res: Response) => {
  try {
    res.json({ groups: await listFleetGroups() });
  } catch (err) {
    console.error('[fleet] list groups failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการกลุ่มไม่ได้');
  }
});

router.get('/audit', async (req: Request, res: Response) => {
  try {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.round(limitRaw))) : 50;
    const beforeRaw = typeof req.query.before === 'string' ? req.query.before : '';
    const before = beforeRaw ? new Date(beforeRaw) : null;
    if (beforeRaw && Number.isNaN(before?.getTime())) return fail(res, 400, 'before ต้องเป็น ISO date');
    const actionTypeRaw = typeof req.query.actionType === 'string' ? req.query.actionType.trim() : '';
    if (actionTypeRaw && !actionTypeRaw.startsWith('FLEET_')) {
      return fail(res, 400, 'actionType ต้องขึ้นต้นด้วย FLEET_');
    }
    const machineId = typeof req.query.machineId === 'string' ? req.query.machineId.trim() : '';
    const events = await AuditService.listFleetEvents({
      limit,
      before,
      actionType: actionTypeRaw || null,
      machineId: machineId || null,
    });
    res.json({
      events,
      nextBefore: events.length ? events[events.length - 1]?.timestamp ?? null : null,
    });
  } catch (err) {
    console.error('[fleet] list audit failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่าน audit ของฝูงเครื่องไม่ได้');
  }
});

router.get('/enroll-tokens', async (_req: Request, res: Response) => {
  try {
    res.json({ tokens: await listEnrollTokensDb() });
  } catch (err) {
    console.error('[fleet] list enroll tokens failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการรหัสเชิญไม่ได้');
  }
});

router.post('/enroll-tokens', async (req: Request, res: Response) => {
  try {
    const created = await createEnrollToken(req.body ?? {}, req.user?.id ?? null);
    if (!created.ok) return fail(res, 400, created.error);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'FLEET_ENROLL_TOKEN_CREATE',
      payload: {
        id: created.record.id,
        label: created.record.label,
        maxUses: created.record.maxUses,
        expiresAt: created.record.expiresAt,
      },
    });
    res.status(201).json({ token: created.token, tokenRecord: created.record });
  } catch (err) {
    console.error('[fleet] create enroll token failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'สร้างรหัสเชิญไม่ได้');
  }
});

router.post('/enroll-tokens/:id/revoke', async (req: Request, res: Response) => {
  try {
    const id = machineIdOf(req);
    if (!id) return fail(res, 400, 'id ไม่ถูกต้อง');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const revoked = await revokeEnrollToken(id, undefined, reason);
    if (!revoked.ok) return fail(res, 404, 'ไม่พบรหัสเชิญนี้');
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'FLEET_ENROLL_TOKEN_REVOKE',
      payload: { id: revoked.record.id, label: revoked.record.label },
    });
    res.json({ tokenRecord: revoked.record });
  } catch (err) {
    console.error('[fleet] revoke enroll token failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'เพิกถอนรหัสเชิญไม่ได้');
  }
});

router.put('/machines/:id', async (req: Request, res: Response) => {
  try {
    const id = machineIdOf(req);
    if (!id) return fail(res, 400, 'machine id ไม่ถูกต้อง');
    const machine = await getMachineWithAccess(id);
    if (!machine) return fail(res, 404, 'ไม่พบเครื่องนี้');
    const checked = validateMachineOverride(req.body);
    if (!checked.ok) return fail(res, 400, checked.error);
    const saved = await setMachineOverride(id, checked.input, req.user?.id ?? null);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'FLEET_MACHINE_POLICY_UPDATE',
      payload: { machineId: id, override: saved.override },
    });
    res.json({ machineId: id, override: saved.override });
  } catch (err) {
    console.error('[fleet] update machine override failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'บันทึกค่าของเครื่องไม่ได้');
  }
});

router.post('/machines/:id/rotate-token', async (req: Request, res: Response) => {
  try {
    const id = machineIdOf(req);
    if (!id) return fail(res, 400, 'machine id ไม่ถูกต้อง');
    const existing = await getMachineWithAccess(id);
    if (!existing) return fail(res, 404, 'ไม่พบเครื่องนี้');
    const rotated = await rotateMachineToken(id);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'FLEET_MACHINE_TOKEN_ROTATE',
      payload: { machineId: id, name: rotated.machine.name },
    });
    res.json({
      machine: machineForClient(rotated.machine),
      token: rotated.token,
      warning: 'token เดิมใช้ไม่ได้แล้ว — ต้องตั้งค่า token ใหม่บนเครื่องนั้นทันที',
    });
  } catch (err) {
    console.error('[fleet] rotate machine token failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'หมุน token ของเครื่องไม่ได้');
  }
});

export default router;
