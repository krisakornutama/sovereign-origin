// src/modules/fleet/fleet.routes.ts
//
// ── Fleet Control Plane API ─────────────────────────────────────────────────
// สิทธิ์แยกเป็นรายเส้น (ไม่ใช้ router.use(requireRole) ทั้งโมดูล):
//   • อ่านอย่างเดียว → SUPERADMIN + SITE_ADMIN
//     SITE_ADMIN ถูกจำกัดด้วย assigned_site_id (ดู fleet-scope.service) — เห็นเฉพาะเครื่อง/กลุ่ม
//     ของสาขาตัวเอง และไม่เห็นเหตุการณ์ audit ของสาขาอื่น
//   • เขียน/จัดการกุญแจ → SUPERADMIN เท่านั้น (SITE_ADMIN สั่งการฝูงเครื่องไม่ได้เลย)
//
//   GET    /api/fleet/overview                     ภาพรวม + compliance + เวอร์ชันที่เผยแพร่ (scoped)
//   GET    /api/fleet/policy                       นโยบายช่องทาง/rollout (อ่านได้ทั้งสองบทบาท)
//   PUT    /api/fleet/policy                       แก้ rollout / default channel          [SUPERADMIN]
//   GET    /api/fleet/sites                        รายการสาขา (SITE_ADMIN เห็นเฉพาะของตัวเอง)
//   GET    /api/fleet/groups                       รายการกลุ่ม (SITE_ADMIN เห็นเฉพาะของสาขา)
//   GET    /api/fleet/audit                        เหตุการณ์ FLEET_* (SITE_ADMIN เฉพาะเครื่องในสาขา)
//   GET    /api/fleet/enroll-tokens                รายการรหัสเชิญ (ไม่คืนรหัสจริง)        [SUPERADMIN]
//   POST   /api/fleet/enroll-tokens                สร้างรหัสเชิญ (คืนรหัสจริงครั้งเดียว)  [SUPERADMIN]
//   POST   /api/fleet/enroll-tokens/:id/revoke     เพิกถอนรหัส                            [SUPERADMIN]
//   PUT    /api/fleet/machines/:id                 ตั้ง channel / site / group / tags      [SUPERADMIN]
//   POST   /api/fleet/machines/:id/rotate-token    หมุน machine token (คืนครั้งเดียว)     [SUPERADMIN]
//
// ⚠️ Express 4: async handler ที่ throw จะค้างไม่ตอบ — ทุก handler จึงมี try/catch
// ⚠️ ห้ามส่ง token_hash หรือ token จริงออกไป ยกเว้น field ที่ตั้งใจคืนครั้งเดียว
import { Router, type Request, type Response } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuditService } from '../../services/audit.service';
import { buildFleetOverview, listMachineSitePairs } from '../../services/fleet-overview.service';
import {
  filterFleetOverviewForScope,
  machineIdsForScope,
  resolveFleetScope,
  type FleetScope,
} from '../../services/fleet-scope.service';
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
import { listFleetGroupsScoped, listFleetSitesScoped, getFleetSiteById } from '../../services/fleet-persistence.service';
import { getMachineWithAccess } from '../../services/agent-machine-hub.service';
import { rotateMachineToken, type MachineRow } from '../../services/agent-machines.service';

const router = Router();

// ทุกเส้นต้องล็อกอิน — สิทธิ์รายเส้นกำหนดด้านล่าง (ห้ามเปลี่ยนกลับเป็น router.use(requireRole) ทั้งโมดูล)
router.use(authenticate);

const readOnly = requireRole('SUPERADMIN', 'SITE_ADMIN');
const superOnly = requireRole('SUPERADMIN');

/**
 * แปลงผู้ใช้เป็นขอบเขตข้อมูล
 *   SUPERADMIN → เห็นทั้งหมด
 *   SITE_ADMIN → ต้องมีสาขาที่มีอยู่จริง ไม่งั้น 403 (fail closed ไม่ใช่เห็นทั้งฝูง)
 * ตอบ 403 เองแล้วคืน null เมื่อไม่ผ่าน
 */
async function scopeOf(req: Request, res: Response): Promise<FleetScope | null> {
  const assigned = req.user?.assigned_site_id ?? null;
  // โหลดเฉพาะ SITE_ADMIN — SUPERADMIN ไม่ต้องแตะตารางสาขาเลย
  const site = req.user?.role === 'SITE_ADMIN' && assigned ? await getFleetSiteById(assigned) : null;
  const resolved = resolveFleetScope({ role: req.user?.role ?? '', assigned_site_id: assigned }, site);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error, code: resolved.code });
    return null;
  }
  return resolved.scope;
}

function siteIdOfScope(scope: FleetScope): string | null {
  return scope.kind === 'site' ? scope.siteId : null;
}

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

router.get('/overview', readOnly, async (req: Request, res: Response) => {
  try {
    const scope = await scopeOf(req, res);
    if (!scope) return;
    res.json(filterFleetOverviewForScope(await buildFleetOverview(), scope));
  } catch (err) {
    console.error('[fleet] overview failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านภาพรวมฝูงเครื่องไม่ได้');
  }
});

// อ่านนโยบายได้ทั้งสองบทบาท — ข้อมูลชุดนี้ถูกส่งไปใน /overview อยู่แล้ว
// (การซ่อนเส้นนี้จึงไม่ได้ลดข้อมูลที่ SITE_ADMIN เข้าถึงได้จริง)
// แต่ยังต้อง resolve scope เพื่อให้บัญชีที่ยังไม่ผูกสาขาถูกปฏิเสธเหมือนเส้นอื่น
router.get('/policy', readOnly, async (req: Request, res: Response) => {
  try {
    const scope = await scopeOf(req, res);
    if (!scope) return;
    res.json({ policy: fleetPolicyForClient(await loadFleetPolicy()) });
  } catch (err) {
    console.error('[fleet] read policy failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านนโยบายไม่ได้');
  }
});

router.put('/policy', superOnly, async (req: Request, res: Response) => {
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

router.get('/sites', readOnly, async (req: Request, res: Response) => {
  try {
    const scope = await scopeOf(req, res);
    if (!scope) return;
    res.json({ sites: await listFleetSitesScoped(siteIdOfScope(scope)) });
  } catch (err) {
    console.error('[fleet] list sites failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการสาขาไม่ได้');
  }
});

router.get('/groups', readOnly, async (req: Request, res: Response) => {
  try {
    const scope = await scopeOf(req, res);
    if (!scope) return;
    res.json({ groups: await listFleetGroupsScoped(siteIdOfScope(scope)) });
  } catch (err) {
    console.error('[fleet] list groups failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการกลุ่มไม่ได้');
  }
});

router.get('/audit', readOnly, async (req: Request, res: Response) => {
  try {
    const scope = await scopeOf(req, res);
    if (!scope) return;
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
    // null = ไม่จำกัด (SUPERADMIN) · [] = สาขาที่ยังไม่มีเครื่อง → ไม่มีเหตุการณ์ให้ดู
    const machineIds = scope.kind === 'all' ? null : machineIdsForScope(await listMachineSitePairs(), scope);
    const events = await AuditService.listFleetEvents({
      limit,
      before,
      actionType: actionTypeRaw || null,
      machineId: machineId || null,
      machineIds,
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

router.get('/enroll-tokens', superOnly, async (_req: Request, res: Response) => {
  try {
    res.json({ tokens: await listEnrollTokensDb() });
  } catch (err) {
    console.error('[fleet] list enroll tokens failed:', err instanceof Error ? err.message : err);
    fail(res, 500, 'อ่านรายการรหัสเชิญไม่ได้');
  }
});

router.post('/enroll-tokens', superOnly, async (req: Request, res: Response) => {
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

router.post('/enroll-tokens/:id/revoke', superOnly, async (req: Request, res: Response) => {
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

router.put('/machines/:id', superOnly, async (req: Request, res: Response) => {
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

router.post('/machines/:id/rotate-token', superOnly, async (req: Request, res: Response) => {
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
