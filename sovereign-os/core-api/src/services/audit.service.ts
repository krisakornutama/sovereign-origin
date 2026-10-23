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
  }) {
    const take = Math.max(1, Math.min(200, Math.round(params.limit ?? 50)));
    const where: any = {
      action_type: params.actionType || { startsWith: 'FLEET_' },
      ...(params.before ? { timestamp: { lt: params.before } } : {}),
    };
    if (params.machineId) {
      where.payload = { path: ['machineId'], equals: params.machineId };
    }
    return prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
    });
  }
}