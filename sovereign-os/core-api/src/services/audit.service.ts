import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}