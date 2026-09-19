import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuthService } from '../../services/auth.service';
import { AuditService } from '../../services/audit.service';

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

// POST /api/users/:id/reset-password — กู้ลืมรหัส / สงสัยรั่ว (SUPERADMIN)
// server สุ่มรหัสชั่วคราวให้ (admin ไม่ตั้งเอง → ไม่รู้รหัสจริงของ user) + บังคับเปลี่ยนตอน login ครั้งหน้า
// + bump token_version → token เดิมทุกอุปกรณ์ตายทันที และลง audit log ทุกครั้ง
router.post('/:id/reset-password', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { temporaryPassword } = await AuthService.adminResetPassword(req.params.id);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'USER_PASSWORD_RESET_BY_ADMIN',
      payload: { target_user_id: req.params.id, ip: req.ip },
    });
    res.json({ temporaryPassword });
  } catch (err: any) {
    if (err?.message === 'User not found') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Reset failed' });
  }
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
    if (must_change_password !== undefined) {
      data.must_change_password = must_change_password === true;
      // ปิด/เปิดบังคับโดยไม่แตะรหัส → bump version ไม่ตัด session ปัจจุบันของ user คนนั้น
      // (เปลี่ยนบทบาท/node ก็เช่นกัน — เฉพาะ password ops เท่านั้นที่ตัด session)
      await AuditService.logAction({
        userId: req.user!.id,
        actionType: must_change_password ? 'USER_PASSWORD_FORCE_CHANGE' : 'USER_PASSWORD_FORCE_CANCEL',
        payload: { target_user_id: req.params.id, ip: req.ip },
      });
    }
    await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

export default router;
