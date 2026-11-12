// src/modules/clone/clone.routes.ts
// Export & Clone — ติ๊กเลือกฟังก์ชั่น → ส่งออกแพ็กเกจ → นำเข้าติดตั้งที่เครื่องอื่น
//
// **การถอดแบบทั้งระบบ = SUPERADMIN เท่านั้น**
// export อ่านทุกตารางของโมดูลที่เลือก (รวมข้อมูลเด็ก/สุขภาพ/การเงิน) ออกเป็นไฟล์
// และ import รัน `TRUNCATE TABLE ... CASCADE` กับทุกตารางในแพ็กเกจ — บัญชีระดับ
// OPERATOR/NODE_ADMIN/KID หรือ agent (SYSTEM_AI) สั่งไม่ได้ · และตารางที่นำเข้าได้
// ต้องอยู่ใน MODULE_MANIFEST เท่านั้น (validatePackage บังคับไว้แล้ว)
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  MODULE_MANIFEST,
  buildExportPackage,
  validatePackage,
  applyPackage,
  findUnknownModuleKeys,
} from '../../services/export-clone.service';

const router = Router();

export const CLONE_ROLES = ['SUPERADMIN'] as const;

const CLONE_ROLE_MESSAGE =
  'การถอดแบบ/ติดตั้งทั้งระบบทำได้เฉพาะ SUPERADMIN — export อ่านข้อมูลทุกตารางของโมดูลที่เลือก และ import จะ TRUNCATE ตารางจริงบนเครื่องนี้';

function requireCloneAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (!role) return res.status(401).json({ error: 'Not authenticated' });
  if (!CLONE_ROLES.includes(role as (typeof CLONE_ROLES)[number])) {
    return res.status(403).json({
      error: CLONE_ROLE_MESSAGE,
      requiredRoles: [...CLONE_ROLES],
      role,
    });
  }
  next();
}

// GET /api/clone/manifest — รายการฟังก์ชั่นที่ถอดแบบได้ (ปุ่มติ๊กใน Settings)
// เป็นแค่รายชื่อโมดูล/คำอธิบาย ไม่มีข้อมูลแถว ⇒ อ่านได้ทุก role ที่ล็อกอินแล้ว
router.get('/manifest', authenticate, (_req, res) => {
  res.json({ modules: MODULE_MANIFEST });
});

// POST /api/clone/export { modules: string[] } — สร้างแพ็กเกจ (ดาวน์โหลด JSON)
router.post('/export', authenticate, requireCloneAdmin, async (req, res) => {
  try {
    const keys = Array.isArray(req.body?.modules) ? req.body.modules.map((k: any) => String(k)) : [];
    if (keys.length === 0) return res.status(400).json({ error: 'เลือกฟังก์ชั่นอย่างน้อย 1 รายการ' });
    const unknown = findUnknownModuleKeys(keys);
    if (unknown.length > 0) {
      return res.status(400).json({
        error: `ไม่รู้จักโมดูล: ${unknown.join(', ')} — เลือกจากรายการที่ระบบรองรับเท่านั้น (แพ็กเกจเปล่าไม่ใช่ข้อมูลสำรอง)`,
        unknownModules: unknown,
        availableModules: MODULE_MANIFEST.map((m) => m.key),
      });
    }
    const pkg = await buildExportPackage(keys, { appName: String(req.body?.appName || process.env.APP_NAME || 'SOVEREIGN OS') });
    res.json({ package: pkg });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สร้างแพ็กเกจไม่สำเร็จ') });
  }
});

// POST /api/clone/import { package } — นำเข้าแพ็กเกจ (คืนค่าเหมือนต้นฉบับ)
router.post('/import', authenticate, requireCloneAdmin, async (req, res) => {
  try {
    const pkg = req.body?.package ?? req.body;
    const invalid = validatePackage(pkg);
    if (invalid) return res.status(400).json({ error: invalid });
    const result = await applyPackage(pkg);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, restoredTables: result.restoredTables });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'นำเข้าแพ็กเกจไม่สำเร็จ') });
  }
});

export default router;
