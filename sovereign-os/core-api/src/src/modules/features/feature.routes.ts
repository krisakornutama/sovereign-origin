// src/modules/features/feature.routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// API สิทธิ์ฟังก์ชั่นต่อคน:
//   GET /api/features              — รายการหน้าทั้งหมด + หมวด (สำหรับหน้า Users)
//   GET /api/features/me           — feature ที่ผู้ใช้ปัจจุบันเห็น (SUPERADMIN = ทั้งหมด)
//   GET /api/features/summary      — สรุปสิทธิ์ทั้งครอบครัว (matrix: ทุกคน × ทุกหน้า) (SUPERADMIN)
//   GET /api/features/users/:id    — feature ที่สมาชิกรายนั้นได้รับ (SUPERADMIN)
//   PUT /api/features/users/:id    — ตั้งสิทธิ์ใหม่ { features: string[] } (SUPERADMIN)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { FEATURE_CATALOG, grantedFeaturesFor, setFeatureGrants, prisma } from '../../services/feature-grant.service';

const router = Router();

// GET /api/features — catalog หน้าทั้งหมด (ใช้สร้าง checkbox ในหน้า Users)
router.get('/', authenticate, (_req, res) => {
  res.json({ features: FEATURE_CATALOG });
});

// GET /api/features/me — สิทธิ์ของผู้ใช้ปัจจุบัน
router.get('/me', authenticate, async (req, res) => {
  try {
    const features = await grantedFeaturesFor(req.user!.id, req.user!.role);
    res.json({ features });
  } catch (err) {
    console.error('Features me error:', err);
    res.status(500).json({ error: 'Failed to load features' });
  }
});

// GET /api/features/summary — สรุปสิทธิ์ทั้งครอบครัว มองทีเดียวจบ (SUPERADMIN)
// คืนสมาชิกทุกคน + feature ที่แต่ละคนเห็น (SUPERADMIN = เห็นทั้งหมด)
router.get('/summary', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true },
      orderBy: { username: 'asc' },
    });
    const grants = await prisma.userFeatureGrant.findMany();
    const byUser: Record<string, Set<string>> = {};
    for (const g of grants) {
      (byUser[g.user_id] ||= new Set()).add(g.feature);
    }
    const members = users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      features:
        u.role === 'SUPERADMIN'
          ? FEATURE_CATALOG.map((f) => f.key)
          : Array.from(byUser[u.id] || []),
    }));
    res.json({ catalog: FEATURE_CATALOG, members });
  } catch (err) {
    console.error('Features summary error:', err);
    res.status(500).json({ error: 'Failed to load feature summary' });
  }
});

// GET /api/features/users/:id — สิทธิ์ของสมาชิกคนหนึ่ง (ดูจากหน้า Users)
router.get('/users/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const features = await grantedFeaturesFor(user.id, user.role);
    res.json({ features });
  } catch (err) {
    console.error('Features user error:', err);
    res.status(500).json({ error: 'Failed to load features' });
  }
});

// PUT /api/features/users/:id — ตั้งสิทธิ์ใหม่ (แทนที่ของเดิม) — เฉพาะ SUPERADMIN
router.put('/users/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'SUPERADMIN') {
      return res.status(400).json({ error: 'SUPERADMIN เห็นทุกอย่างอยู่แล้ว — ไม่ต้องตั้งสิทธิ์' });
    }
    const requested = Array.isArray(req.body?.features) ? req.body.features.map(String) : [];
    const saved = await setFeatureGrants(target.id, requested);
    res.json({ success: true, features: saved });
  } catch (err) {
    console.error('Set features error:', err);
    res.status(500).json({ error: 'Failed to set features' });
  }
});

export default router;
