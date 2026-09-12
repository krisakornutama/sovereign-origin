// src/lib/business.ts
//
// BUSINESS PLATFORM core — ตำแหน่ง + สิทธิ์ + บริบทข้อมูลของธุรกิจ
//
// กติกาเดียวกับ lib/roles.ts ฝั่ง frontend: string ตำแหน่งถูกจับอยู่ที่นี่ที่เดียว
// ทุก route ตรวจสิทธิ์ผ่าน requireBusinessAccess เท่านั้น — ห้ามเช็คเองกระจัดกระจาย
import { prisma } from './prisma';

export const BUSINESS_POSITIONS = [
  'OWNER',
  'MANAGER',
  'SALES',
  'TECHNICIAN',
  'STOCK_KEEPER',
  'ACCOUNTANT',
  'VIEWER',
] as const;

export type BusinessPosition = (typeof BUSINESS_POSITIONS)[number];

// ลำดับสิทธิ์ — ยิ่งเลขน้อยยิ่งสูง (OWNER=0 ทำได้ทุกอย่าง, VIEWER=6 อ่านอย่างเดียว)
export const POSITION_RANK: Record<string, number> = {
  OWNER: 0,
  MANAGER: 1,
  SALES: 2,
  TECHNICIAN: 3,
  STOCK_KEEPER: 3,
  ACCOUNTANT: 3,
  VIEWER: 6,
};

/** ผู้ใช้มีตำแหน่งในธุรกิจนี้อย่างน้อย `min` หรือไม่ (SUPERADMIN ของระบบผ่านเสมอ) */
export async function hasBusinessAccess(
  businessId: string,
  userId: string,
  systemRole: string | undefined,
  min: BusinessPosition = 'VIEWER'
): Promise<BusinessPosition | null> {
  if (systemRole === 'SUPERADMIN') return 'OWNER';
  const member = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId } },
  });
  if (!member) return null;
  return POSITION_RANK[member.position] <= POSITION_RANK[min] ? (member.position as BusinessPosition) : null;
}

/** error object มาตรฐานสำหรับ 403 */
export function businessAccessError(): { status: number; json: Record<string, string> } {
  return { status: 403, json: { error: 'คุณไม่มีสิทธิ์ในธุรกิจนี้' } };
}
