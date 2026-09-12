// src/services/feature-grant.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// สิทธิ์ฟังก์ชั่นต่อคน (Family member feature grants)
// - SUPERADMIN เห็นทุกอย่างเสมอ (ไม่ต้อง grant)
// - สมาชิก (OPERATOR / NODE_ADMIN / SYSTEM_AI) เห็นเฉพาะ feature ที่ถูก grant
//   ในตาราง user_feature_grants — ถ้าไม่มีแถว = ไม่เห็นอะไรเลย
// - feature key = href ของหน้า เช่น "/portfolio" | "/health" | "/farm"
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../lib/prisma';

export { prisma };

// ── รายชื่อหน้าทั้งหมด (ตรงกับ NAV_GROUPS ใน frontend/src/lib/navigation.ts) ──
// key = href ของหน้า — ใช้เป็น feature key ในตาราง grant
export interface FeatureDef {
  key: string;      // href เช่น "/portfolio"
  label: string;    // ชื่อที่แสดงในหน้า Users
  group: string;    // หมวดเมนู
  adminOnly?: boolean; // หน้าเฉพาะ superadmin (ระบบ) — ไม่เปิดให้สมาชิกเด็ดขาด
}

export const FEATURE_CATALOG: FeatureDef[] = [
  { key: '/dashboard', label: 'Dashboard', group: 'ภาพรวม' },
  // อุปกรณ์ & พลังงาน
  { key: '/sensors', label: 'Device + Sensors', group: 'อุปกรณ์ & พลังงาน' },
  { key: '/energy', label: 'Energy', group: 'อุปกรณ์ & พลังงาน' },
  { key: '/predictive', label: 'Predictive', group: 'อุปกรณ์ & พลังงาน' },
  { key: '/relay', label: 'Relay Control', group: 'อุปกรณ์ & พลังงาน' },
  { key: '/automation', label: 'Automation', group: 'อุปกรณ์ & พลังงาน' },
  { key: '/ota', label: 'OTA Updates', group: 'อุปกรณ์ & พลังงาน' },
  // ความปลอดภัย
  { key: '/security', label: 'Cyber Security', group: 'ความปลอดภัย' },
  { key: '/ai-agent', label: 'AI Agent', group: 'ความปลอดภัย' },
  { key: '/ai', label: 'AI Command Center', group: 'ความปลอดภัย' },
  { key: '/vision', label: 'Vision AI', group: 'ความปลอดภัย' },
  { key: '/property', label: 'Property Map', group: 'ความปลอดภัย' },
  { key: '/alerts', label: 'Alert History', group: 'ความปลอดภัย' },
  { key: '/risk-monitor', label: 'Risk Monitor', group: 'ความปลอดภัย' },
  { key: '/infrastructure', label: 'Infrastructure', group: 'ความปลอดภัย' },
  // ชีวิต & การเงิน
  { key: '/health', label: 'Health Screening', group: 'ชีวิต & การเงิน' },
  { key: '/inventory', label: 'Inventory & Supplies', group: 'ชีวิต & การเงิน' },
  { key: '/farm', label: 'Farm Plots', group: 'ชีวิต & การเงิน' },
  { key: '/livestock', label: 'Sovereign Livestock', group: 'ชีวิต & การเงิน' },
  { key: '/restaurant', label: 'Restaurant Empire', group: 'ชีวิต & การเงิน' },
  { key: '/business', label: 'ธุรกิจของฉัน (Business Platform)', group: 'ชีวิต & การเงิน' },
  { key: '/selfreliance', label: 'วันรอด (Autonomy)', group: 'ชีวิต & การเงิน' },
  { key: '/portfolio', label: 'Wealth & Assets (legacy)', group: 'ชีวิต & การเงิน' },
  { key: '/treasury', label: 'Treasury & Invest', group: 'ชีวิต & การเงิน' },
  { key: '/knowledge', label: 'Knowledge Base', group: 'ชีวิต & การเงิน' },
  { key: '/healing', label: 'Buddhist Healing', group: 'ชีวิต & การเงิน' },
  { key: '/lifestyle', label: 'วิถีชีวิต (Embracing Chaos)', group: 'ชีวิต & การเงิน' },
  // ข้อมูล & รายงาน
  { key: '/history', label: 'History', group: 'ข้อมูล & รายงาน' },
  { key: '/reports', label: 'AI Reports', group: 'ข้อมูล & รายงาน' },
  // ระบบ — เฉพาะ superadmin เสมอ (กันเผลอเปิดให้ลูก)
  { key: '/system', label: 'System Health', group: 'ระบบ', adminOnly: true },
  { key: '/backup', label: 'Backup', group: 'ระบบ', adminOnly: true },
  { key: '/users', label: 'Users', group: 'ระบบ', adminOnly: true },
  { key: '/audit', label: 'Audit Log', group: 'ระบบ', adminOnly: true },
  { key: '/settings', label: 'Settings', group: 'ระบบ', adminOnly: true },
];

/** feature ทั้งหมดที่สมาชิกทั่วไปเปิดให้ได้ (ไม่รวมหน้า admin) */
export const MEMBER_GRANTABLE_FEATURES = FEATURE_CATALOG.filter((f) => !f.adminOnly).map((f) => f.key);

// ── Queries ──

/** feature ที่ user นี้ได้รับ grant (คืนแค่ key) — SUPERADMIN ได้ทุกอย่าง */
export async function grantedFeaturesFor(userId: string, role?: string | null): Promise<string[]> {
  if (role === 'SUPERADMIN') return FEATURE_CATALOG.map((f) => f.key);
  const rows = await prisma.userFeatureGrant.findMany({ where: { user_id: userId }, select: { feature: true } });
  return rows.map((r) => r.feature);
}

/** มีสิทธิ์ feature นี้ไหม? SUPERADMIN ได้เสมอ */
export async function hasFeatureGrant(userId: string, role: string | undefined, feature: string): Promise<boolean> {
  if (role === 'SUPERADMIN') return true;
  const row = await prisma.userFeatureGrant.findUnique({
    where: { user_id_feature: { user_id: userId, feature } },
  });
  return Boolean(row);
}

/** ตั้งสิทธิ์ใหม่ให้สมาชิก (แทนที่ของเดิมทั้งหมด) — กัน feature ที่ไม่รู้จัก / หน้า admin */
export async function setFeatureGrants(
  userId: string,
  features: string[],
  opts: { allowAdmin?: boolean } = {}
): Promise<string[]> {
  const valid = new Set(
    opts.allowAdmin ? FEATURE_CATALOG.map((f) => f.key) : MEMBER_GRANTABLE_FEATURES
  );
  const next = [...new Set(features)].filter((f) => valid.has(f));

  await prisma.$transaction(async (tx) => {
    await tx.userFeatureGrant.deleteMany({ where: { user_id: userId } });
    if (next.length > 0) {
      await tx.userFeatureGrant.createMany({
        data: next.map((feature) => ({ user_id: userId, feature })),
      });
    }
  });
  return next;
}

// ── Express middleware — กันเข้าหน้าที่ไม่มีสิทธิ์ (403) ──
// ใช้ที่ mount router ใน server.ts: ตรวจ grant ตาม req.user
// (router ข้างในเรียก authenticate อีกที — ทำงานซ้ำได้ปลอดภัย)
import type { Request, Response, NextFunction } from 'express';

export function requireFeature(feature: string | string[]) {
  const features = Array.isArray(feature) ? feature : [feature];
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'SUPERADMIN') return next();
    for (const f of features) {
      if (await hasFeatureGrant(req.user.id, req.user.role, f)) return next();
    }
    return res.status(403).json({ error: 'You do not have access to this feature' });
  };
}

// รูปแบบที่ใช้กับ mount: app.use('/api/portfolio', featureGuard('/portfolio'), portfolioRoutes)
// (authenticate ถูกเรียกก่อน requireFeature เพื่อให้ req.user พร้อม)
import { authenticate as authMiddleware } from '../middleware/auth.middleware';
export function featureGuard(feature: string | string[]) {
  return [authMiddleware, requireFeature(feature)];
}
