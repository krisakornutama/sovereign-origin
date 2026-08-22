import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// ────────────────────────────────────────────────────────────────────────────
// User Management (SUPERADMIN) — ย้ายมาจาก inline routes ใน server.ts
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, assigned_node_id: true, must_change_password: true },
    });
    res.json(users);
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { username, password, role } = req.body;
  const hash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      username,
      password_hash: hash,
      role: role || 'OPERATOR',
      // สมาชิกใหม่ต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก (รหัสแรกเข้าเป็นรหัสชั่วคราว)
      must_change_password: true,
    },
  });
  res.json({ success: true });
});
router.delete('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});
router.put('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { role, assigned_node_id, must_change_password } = req.body;
    const VALID_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const data: any = {};
    if (role !== undefined) data.role = role;
    if (assigned_node_id !== undefined) data.assigned_node_id = assigned_node_id || null;
    // บังคับ/ยกเลิกบังคับเปลี่ยนรหัสผ่าน (เช่น ลืมรหัส → ตั้งรหัสใหม่ + บังคับเปลี่ยน)
    if (must_change_password !== undefined) data.must_change_password = must_change_password === true;
    await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

export default router;
