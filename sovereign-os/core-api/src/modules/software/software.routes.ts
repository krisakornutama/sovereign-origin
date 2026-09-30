// src/modules/software/software.routes.ts
//
// SOFTWARE CATALOG ROUTES (P8) — ขายซอฟต์แวร์แยกชิ้น
//  - GET /api/software/scan      — ข้อมูลฟังก์ชันจริงทุกโมดูล + ราคาแนะนำ (admin)
//  - GET /api/software/listing   — รวมของที่ publish แล้ว (admin)
//  - POST /api/software/publish  — เปิดขายโมดูล (กำหนดราคาเอง หรือใช้ suggested) (admin)
//  - POST /api/software/unpublish — ปิดขาย (admin)
//  หน้าร้านสาธารณะดึงผ่าน /api/shop เดิม — ไม่เพิ่มเส้นสาธารณะใหม่ (WAF ไม่ต้องแตะ)
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';
import { softwareCatalog, publishModule, unpublishModule } from '../../services/software-catalog.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production

const router = Router();

// GET /api/software/scan — สแกนข้อมูลจริง + ราคาแนะนำ + ของที่ publish แล้ว (admin)
router.get('/scan', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    res.json(await softwareCatalog());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/software/listing — alias เดียวกับ scan (ชื่อสื่อความหมายใน UI)
router.get('/listing', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    res.json(await softwareCatalog());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/software/publish — เปิดขายโมดูล { moduleKey, name?, specs?, salePrice?, costPrice? }
router.post('/publish', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const moduleKey = String(req.body?.moduleKey ?? '').trim();
    if (!/^[a-z0-9-]{1,60}$/i.test(moduleKey)) return res.status(400).json({ error: 'moduleKey is required (a-z0-9-)' });
    const user = (req as any).user;
    const row = await publishModule(moduleKey, {
      name: req.body?.name ? String(req.body.name) : undefined,
      specs: req.body?.specs ? String(req.body.specs) : undefined,
      salePrice: req.body?.salePrice != null ? Number(req.body.salePrice) : undefined,
      costPrice: req.body?.costPrice != null ? Number(req.body.costPrice) : undefined,
      ownerId: String(user?.id ?? ''),
    });
    res.status(201).json(row);
  } catch (err: any) {
    if (/not found/.test(String(err.message))) return res.status(404).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /api/software/unpublish — ปิดขายโมดูล { moduleKey }
router.post('/unpublish', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const moduleKey = String(req.body?.moduleKey ?? '').trim();
    if (!moduleKey) return res.status(400).json({ error: 'moduleKey is required' });
    await unpublishModule(moduleKey);
    res.json({ ok: true, moduleKey });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
