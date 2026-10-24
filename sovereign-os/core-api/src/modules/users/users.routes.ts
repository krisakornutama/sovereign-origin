import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuthService } from '../../services/auth.service';
import { AuditService } from '../../services/audit.service';
import { getFleetSiteById } from '../../services/fleet-persistence.service';
import { disconnectUserSockets } from '../../realtime/io-registry';

// ────────────────────────────────────────────────────────────────────────────
// User Management (SUPERADMIN) — ย้ายมาจาก inline routes ใน server.ts
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, assigned_node_id: true, assigned_site_id: true, must_change_password: true },
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
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    // ตัด socket ที่ค้างอยู่ทันที — user ที่ถูกลบต้องไม่ได้รับ realtime ต่อ
    disconnectUserSockets(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    // เคสจริง: Prisma error ถูก catch-all กลืนเงียบ ๆ วินิจฉัยไม่ได้ — log เต็ม + ส่ง reason เสมอ
    console.error('[users:delete] failed:', err?.code || '', err?.message || err);
    res.status(500).json({ error: 'ลบผู้ใช้ไม่สำเร็จ', reason: err?.message || 'unknown' });
  }
});

// POST /api/users/:id/reset-password — กู้ลืมรหัส / สงสัยรั่ว (SUPERADMIN)
// server สุ่มรหัสชั่วคราวให้ (admin ไม่ตั้งเอง → ไม่รู้รหัสจริงของ user) + บังคับเปลี่ยนตอน login ครั้งหน้า
// + bump token_version → token เดิมทุกอุปกรณ์ตายทันที และลง audit log ทุกครั้ง
router.post('/:id/reset-password', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { temporaryPassword, targetUsername } = await AuthService.adminResetPassword(req.params.id);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'USER_PASSWORD_RESET_BY_ADMIN',
      payload: { target_user_id: req.params.id, target_username: targetUsername, ip: req.ip },
    });
    disconnectUserSockets(req.params.id);
    res.json({ temporaryPassword });
  } catch (err: any) {
    // เคสจริง: PrismaClientValidationError จาก client ไม่ตรง schema ถูกกลืนเป็น "Reset failed" เงียบ ๆ
    console.error('[reset-password] failed:', err?.code || '', err?.message || err);
    if (err?.message === 'User not found') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Reset failed', reason: err?.message || 'unknown' });
  }
});
router.put('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { role, assigned_node_id, assigned_site_id, must_change_password } = req.body;
    const VALID_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const data: any = {};
    if (role !== undefined) data.role = role;
    if (assigned_node_id !== undefined) data.assigned_node_id = assigned_node_id || null;
    // สาขาของ SITE_ADMIN — ตรวจว่ามีสาขานี้จริงก่อนเขียน (FK จะกันอยู่แล้ว แต่ 400 อ่านง่ายกว่า 500)
    // ใช้ service ของ fleet ไม่ query ตาราง fleet_* จากโมดูลนี้ (module-boundary)
    if (assigned_site_id !== undefined) {
      if (assigned_site_id === null || assigned_site_id === '') {
        data.assigned_site_id = null;
      } else {
        const site = await getFleetSiteById(String(assigned_site_id));
        if (!site) return res.status(400).json({ error: 'ไม่พบสาขาที่ระบุ' });
        data.assigned_site_id = site.id;
      }
    }
    // บังคับ/ยกเลิกบังคับเปลี่ยนรหัสผ่าน (เช่น ลืมรหัส → ตั้งรหัสใหม่ + บังคับเปลี่ยน)
    if (must_change_password !== undefined) data.must_change_password = must_change_password === true;
    // เปลี่ยนสิทธิ์/โหนด/สาขา/สถานะบังคับรหัส = เพิ่ม token_version ทันที
    // token เก่าของ user คนนั้นใช้ไม่ได้อีก (middleware เทียบ version ทุก request)
    if (
      role !== undefined ||
      assigned_node_id !== undefined ||
      assigned_site_id !== undefined ||
      must_change_password !== undefined
    ) {
      data.token_version = { increment: 1 };
    }
    // ทุก PUT นี้ลง audit อัตโนมัติผ่าน auditStateChange (server.ts) — actionType = "PUT /api/users/:id"
    await prisma.user.update({ where: { id: req.params.id }, data });
    // role/โหนด/สถานะรหัสเปลี่ยน → token version ใหม่แล้ว; ตัด socket เดิมไม่ให้ค้างสิทธิ์เก่า
    disconnectUserSockets(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

export default router;
