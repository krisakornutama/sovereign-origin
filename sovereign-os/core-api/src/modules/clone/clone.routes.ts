// src/modules/clone/clone.routes.ts
// Export & Clone — ติ๊กเลือกฟังก์ชั่น → ส่งออกแพ็กเกจ → นำเข้าติดตั้งที่เครื่องอื่น
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  MODULE_MANIFEST,
  buildExportPackage,
  validatePackage,
  applyPackage,
} from '../../services/export-clone.service';

const router = Router();

// GET /api/clone/manifest — รายการฟังก์ชั่นที่ถอดแบบได้ (ปุ่มติ๊กใน Settings)
router.get('/manifest', authenticate, (_req, res) => {
  res.json({ modules: MODULE_MANIFEST });
});

// POST /api/clone/export { modules: string[] } — สร้างแพ็กเกจ (ดาวน์โหลด JSON)
router.post('/export', authenticate, async (req, res) => {
  try {
    const keys = Array.isArray(req.body?.modules) ? req.body.modules.map((k: any) => String(k)) : [];
    if (keys.length === 0) return res.status(400).json({ error: 'เลือกฟังก์ชั่นอย่างน้อย 1 รายการ' });
    const pkg = await buildExportPackage(keys, { appName: String(req.body?.appName || process.env.APP_NAME || 'SOVEREIGN OS') });
    res.json({ package: pkg });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สร้างแพ็กเกจไม่สำเร็จ') });
  }
});

// POST /api/clone/import { package } — นำเข้าแพ็กเกจ (คืนค่าเหมือนต้นฉบับ)
router.post('/import', authenticate, async (req, res) => {
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
