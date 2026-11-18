// account-posture.service — อ่านสถิติบัญชี/audit สำหรับโมดูลอื่น (read-only)
//
// เหตุผลที่ไฟล์นี้อยู่ในนามของโมดูล auth (tools/module-owners.json → serviceAliases):
// ตาราง users และ audit_logs เป็นของ auth ⇒ โมดูลอื่นห้ามยิง prisma ตรง (arch-gate
// module-boundary) ต้องผ่าน service ของเจ้าของตาราง · ไฟล์นี้จึงเป็น "read API" กลาง
// ที่ให้ security-posture (และโมดูลอื่นในอนาคต) เรียกได้โดยไม่แตะตารางของ auth เอง
//
// ขอบเขต: อ่านอย่างเดียว — ห้ามเพิ่ม write ในไฟล์นี้ (write ต้องผ่าน AuthService/AuditService
// ที่มีการตรวจสิทธิ์และเขียน audit ตามกติกา)
import { prisma } from '../lib/prisma';

export interface AccountSecurityCounts {
  total: number;
  withoutMfa: number;
  mustChangePassword: number;
}

/** จำนวนบัญชีที่ยังใช้งาน + สองกลุ่มเสี่ยง (ไม่มี MFA / ยังใช้รหัสชั่วคราว) */
export async function readAccountSecurityCounts(): Promise<AccountSecurityCounts> {
  const [total, withoutMfa, mustChangePassword] = await Promise.all([
    prisma.user.count({ where: { deleted_at: null } }),
    prisma.user.count({ where: { deleted_at: null, mfa_secret: null } }),
    prisma.user.count({ where: { deleted_at: null, must_change_password: true } }),
  ]);
  return { total, withoutMfa, mustChangePassword };
}

/** จำนวนครั้งที่ระบบบล็อกคำขอ login (rate limit) ในช่วงเวลาที่กำหนด */
export async function readRateLimitBlocks(since: Date): Promise<number> {
  return prisma.auditLog.count({
    where: { action_type: 'RATE_LIMIT_BLOCK', timestamp: { gte: since } },
  });
}

export interface AuditTrailCounts {
  entries: number;
  /** ISO ของรายการเก่าสุด — null เมื่อยังไม่มีรายการ */
  oldest: string | null;
}

/** ขนาดของ audit trail + จุดเริ่มต้น (ใช้ตอบว่า "ตรวจย้อนได้ไกลแค่ไหน") */
export async function readAuditTrailCounts(): Promise<AuditTrailCounts> {
  const [entries, oldest] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
  ]);
  return {
    entries,
    oldest: oldest?.timestamp ? new Date(oldest.timestamp).toISOString() : null,
  };
}
