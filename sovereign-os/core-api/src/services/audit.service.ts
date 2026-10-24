import { prisma } from '../lib/prisma';


export class AuditService {
  static async logAction(params: {
    userId: string;
    actionType: string;
    payload: any;
  }) {
    try {
      await prisma.auditLog.create({
        data: {
          user_id: params.userId,
          action_type: params.actionType,
          payload: params.payload,
        },
      });
    } catch (err) {
      console.error('Audit log error:', err);
    }
  }

  /**
   * อ่าน audit ของ Fleet — ใช้ร่วมกับ view `fleet_audit_view`
   * (view มีไว้ให้ SQL/BI อ่าน; API ใช้ Prisma model เพื่อ filter แบบ type-safe)
   */
  static async listFleetEvents(params: {
    limit?: number;
    before?: Date | null;
    actionType?: string | null;
    machineId?: string | null;
    /**
     * ขอบเขตเครื่องที่ผู้เรียกเห็นได้ (SITE_ADMIN)
     *   undefined / null = ไม่จำกัด (SUPERADMIN)
     *   []               = ไม่เห็นอะไรเลย (สาขาที่ยังไม่มีเครื่อง)
     *   [...]            = เห็นเฉพาะเหตุการณ์ที่ payload.machineId อยู่ในชุดนี้
     * เหตุการณ์ระดับระบบ (เช่น FLEET_POLICY_UPDATE ที่ไม่มี machineId) จะไม่โผล่ให้ผู้ที่ถูกจำกัดขอบเขต
     */
    machineIds?: string[] | null;
  }) {
    const take = Math.max(1, Math.min(200, Math.round(params.limit ?? 50)));
    const allowed = Array.isArray(params.machineIds) ? params.machineIds : null;
    // สาขาว่าง = ไม่มีอะไรให้ดู (ห้ามตีความเป็น "ไม่จำกัด")
    if (allowed && allowed.length === 0) return [];
    const requested = params.machineId || null;
    // ขอเครื่องที่อยู่นอกขอบเขต → ตอบว่าง ไม่บอกว่าเครื่องนั้นมีอยู่จริง
    if (allowed && requested && !allowed.includes(requested)) return [];
    const scopeIds = allowed ?? (requested ? [requested] : null);

    const where: any = {
      action_type: params.actionType || { startsWith: 'FLEET_' },
      ...(params.before ? { timestamp: { lt: params.before } } : {}),
    };
    if (scopeIds && scopeIds.length === 1) {
      where.payload = { path: ['machineId'], equals: scopeIds[0] };
    } else if (scopeIds) {
      // Prisma JSON filter ไม่มี "in" — ใช้ OR ต่อ id (จำนวนเครื่องในฝูงเล็กและถูกจำกัดด้วย take อยู่แล้ว)
      where.OR = scopeIds.map((id) => ({ payload: { path: ['machineId'], equals: id } }));
    }
    return prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
    });
  }
}