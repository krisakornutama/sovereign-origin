import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuthService } from '../../services/auth.service';
import { AuditService } from '../../services/audit.service';
import { getFleetSiteById } from '../../services/fleet-persistence.service';
import { disconnectUserSockets } from '../../realtime/io-registry';
import { createInvite } from '../../services/invite.service';

// ────────────────────────────────────────────────────────────────────────────
// User Management (SUPERADMIN) — ย้ายมาจาก inline routes ใน server.ts
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

// role ที่ระบบรองรับ — ที่เดียว (POST และ PUT ต้องตรวจชุดเดียวกัน ไม่งั้นสร้างบัญชี
// ด้วย role ที่ระบบไม่รู้จักได้ แล้ว middleware จะปิดประตูทุกบานให้ user คนนั้น)
const VALID_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN'];
const MAX_USERNAME_LENGTH = 64;

router.get('/', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, assigned_node_id: true, assigned_site_id: true, must_change_password: true, mfa_secret: true },
    });
    // ส่งแค่ว่าเปิด 2FA ไหม — secret/backup hash ไม่เคยออกจากเซิร์ฟเวอร์ (strip ซ้ำอีกชั้นกัน select ถูกแก้ในอนาคต)
    res.json(users.map(({ mfa_secret, ...u }: any) => {
      const { mfa_backup_hash, pending_mfa_secret, ...safe } = u;
      return { ...safe, mfa_enabled: !!mfa_secret };
    }));
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// POST /api/users — สร้างบัญชี (SUPERADMIN)
// ต้องตรวจ input ให้ครบก่อนแตะ bcrypt/prisma: handler นี้เป็น async และ Express 4
// ไม่ส่ง error ออกจาก async handler ⇒ อะไรที่ throw จะกลายเป็น request ที่ **ค้าง**
// ไม่ใช่ 500 (เจอจริง: ไม่ส่ง password → bcrypt.hash(undefined) throw = admin รอไม่จบ;
// username ซ้ำ → Prisma P2002 = ค้างเช่นกัน)
router.post('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = body.password;
    const role = body.role ?? 'OPERATOR';

    if (!username) {
      return res.status(400).json({ error: 'ต้องระบุชื่อผู้ใช้' });
    }
    if (username.length > MAX_USERNAME_LENGTH) {
      return res.status(400).json({ error: `ชื่อผู้ใช้ยาวเกินไป (สูงสุด ${MAX_USERNAME_LENGTH} ตัวอักษร)` });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'สิทธิ์ (role) ไม่ถูกต้อง' });
    }
    try {
      // กฎเดียวกับตอนผู้ใช้ตั้งรหัสเอง — บัญชีใหม่ต้องไม่เริ่มด้วยรหัสที่ระบบจะปฏิเสธภายหลัง
      AuthService.validateNewPassword(password);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'รหัสผ่านไม่ถูกต้อง' });
    }

    const hash = await bcrypt.hash(password, 12);
    const createdUser = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        role,
        // สมาชิกใหม่ต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก (รหัสแรกเข้าเป็นรหัสชั่วคราว)
        must_change_password: true,
      },
      select: { id: true, username: true, role: true },
    });
    // คงสถานะ 200 ไว้ตามเดิม — มีสคริปต์ตรวจ (tools/verify) ที่ยึด 200 อยู่ และ UI ใช้ res.ok
    return res.json({ success: true, user: createdUser });
  } catch (err: any) {
    // P2002 = unique constraint (username ซ้ำ) — 409 อ่านรู้เรื่องกว่า 500
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });
    }
    console.error('[users:create] failed:', err?.code || '', err?.message || err);
    return res.status(500).json({ error: 'สร้างผู้ใช้ไม่สำเร็จ', reason: err?.message || 'unknown' });
  }
});
// DELETE /api/users/:id — ลบบัญชี (SUPERADMIN)
// ต้องกันสามเรื่องก่อนลบจริง ไม่งั้นระบบไม่มีผู้ดูแลเหลือและกู้ได้ด้วย DB console เท่านั้น:
//   1) ลบตัวเอง            2) ลบ SUPERADMIN คนสุดท้าย            3) FK ที่ยังผูกข้อมูลอยู่
// UI ปิดปุ่มของแถวตัวเองไว้แล้ว แต่ API ต้องกันเอง (ปุ่มเป็นแค่ความสะดวก ไม่ใช่ด่าน)
router.delete('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user!.id) {
    return res.status(400).json({ error: 'ลบบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลคนอื่นเป็นผู้ลบ' });
  }
  try {
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้ที่ระบุ' });
    if (target.role === 'SUPERADMIN') {
      const admins = await prisma.user.count({ where: { role: 'SUPERADMIN' } });
      if (admins <= 1) {
        return res.status(400).json({ error: 'ลบไม่ได้ — ต้องเหลือผู้ดูแลสูงสุด (SUPERADMIN) อย่างน้อย 1 คน' });
      }
    }
    await prisma.user.delete({ where: { id: targetId } });
    // ตัด socket ที่ค้างอยู่ทันที — user ที่ถูกลบต้องไม่ได้รับ realtime ต่อ
    disconnectUserSockets(targetId);
    return res.json({ success: true });
  } catch (err: any) {
    // P2003 = ยังมีข้อมูลผูกอยู่ (FK) → 400 อ่านรู้เรื่อง ; P2025 = ถูกลบไปแล้วระหว่างทาง
    if (err?.code === 'P2003') {
      return res.status(400).json({ error: 'ลบไม่ได้ — บัญชีนี้ยังมีข้อมูลผูกอยู่ (โอนย้ายหรือลบข้อมูลก่อน)' });
    }
    if (err?.code === 'P2025') return res.status(404).json({ error: 'ไม่พบผู้ใช้ที่ระบุ' });
    // P2023 = id ไม่ใช่ UUID — 400 ไม่ใช่ 500 (Prisma โยนตอน parse ไม่ใช่ตอน compile)
    if (err?.code === 'P2023') return res.status(400).json({ error: 'รูปแบบ id ของผู้ใช้ไม่ถูกต้อง' });
    // เคสจริง: Prisma error ถูก catch-all กลืนเงียบ ๆ วินิจฉัยไม่ได้ — log เต็ม + ส่ง reason เสมอ
    console.error('[users:delete] failed:', err?.code || '', err?.message || err);
    return res.status(500).json({ error: 'ลบผู้ใช้ไม่สำเร็จ', reason: err?.message || 'unknown' });
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
// POST /api/users/:id/reset-mfa — กู้สมาชิกที่โทรศัพท์ (authenticator) หาย (SUPERADMIN)
// รีเซ็ต 2FA = ลดความแข็งแรงของบัญชี ⇒ audit ทุกครั้ง + token เดิมตายทั้งหมด (bump token_version)
// บัญชีตัวเองต้องใช้หน้า Settings (บังคับยืนยันรหัสผ่าน) — endpoint นี้ไม่ให้ข้ามขั้นนั้น
router.post('/:id/reset-mfa', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: 'รีเซ็ต 2FA ของตัวเองผ่านหน้านี้ไม่ได้ — ใช้หน้าตั้งค่าที่ต้องยืนยันรหัสผ่าน' });
  }
  try {
    const result = await AuthService.adminResetMfa(req.params.id);
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'USER_MFA_RESET_BY_ADMIN',
      payload: { target_user_id: req.params.id, target_username: result.username, had_mfa: result.had_mfa, ip: req.ip },
    });
    disconnectUserSockets(req.params.id);
    return res.json(result);
  } catch (err: any) {
    if (err?.message === 'User not found') return res.status(404).json({ error: 'User not found' });
    console.error('[reset-mfa] failed:', err?.message || err);
    return res.status(500).json({ error: 'Reset MFA failed' });
  }
});
router.put('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { role, assigned_node_id, assigned_site_id, must_change_password } = req.body;
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const targetId = req.params.id;
    // ลดสิทธิ์ SUPERADMIN คนสุดท้าย = ล็อกตัวเองออกจากระบบถาวร (ไม่มีใครอนุมัติ/กู้ได้)
    // UI ปิดช่องนี้ของแถวตัวเอง แต่ API ต้องกันเอง
    if (role !== undefined) {
      const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
      if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้ที่ระบุ' });
      if (target.role === 'SUPERADMIN' && role !== 'SUPERADMIN') {
        const admins = await prisma.user.count({ where: { role: 'SUPERADMIN' } });
        if (admins <= 1) {
          return res.status(400).json({ error: 'ลดสิทธิ์ไม่ได้ — ต้องเหลือผู้ดูแลสูงสุด (SUPERADMIN) อย่างน้อย 1 คน' });
        }
      }
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
    const forcingPasswordChange = must_change_password === true;
    if (must_change_password !== undefined) data.must_change_password = forcingPasswordChange;
    // เปลี่ยนสิทธิ์/โหนด/สาขา หรือ "เพิ่งสั่งบังคับ" เปลี่ยนรหัส = เพิ่ม token_version ทันที
    // token เก่าของ user คนนั้นใช้ไม่ได้อีก (middleware เทียบ version ทุก request)
    //
    // ข้อยกเว้นที่เจอจาก CI: การ "ยกเลิก" บังคับเปลี่ยนรหัส (true → false) ต้องไม่ bump version
    // เพราะ session ที่ยัง live อยู่อาจเป็นทางเดียวที่ user ใช้ทำงานต่อได้ และการยกเลิกไม่ได้
    // ให้สิทธิ์อะไรเพิ่ม — reset-password/change-password bump เองอยู่แล้วเมื่อถึงเวลาจริง
    if (
      role !== undefined ||
      assigned_node_id !== undefined ||
      assigned_site_id !== undefined ||
      forcingPasswordChange
    ) {
      data.token_version = { increment: 1 };
    }
    // ทุก PUT นี้ลง audit อัตโนมัติผ่าน auditStateChange (server.ts) — actionType = "PUT /api/users/:id"
    await prisma.user.update({ where: { id: targetId }, data });
    // role/โหนด/สถานะรหัสเปลี่ยน → token version ใหม่แล้ว; ตัด socket เดิมไม่ให้ค้างสิทธิ์เก่า
    disconnectUserSockets(targetId);
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'ไม่พบผู้ใช้ที่ระบุ' });
    if (err?.code === 'P2023') return res.status(400).json({ error: 'รูปแบบ id ของผู้ใช้ไม่ถูกต้อง' });
    if (err?.code === 'P2003') return res.status(400).json({ error: 'อ้างถึงข้อมูลที่ไม่มีอยู่ (เช่น โหนด/สาขา)' });
    console.error('[users:update] failed:', err?.code || '', err?.message || err);
    return res.status(500).json({ error: 'Update failed' });
  }
});

// ── รหัสเชิญสมัครสมาชิก (self-hosted) ──────────────────────────────────────
// SUPERADMIN เท่านั้น: สร้าง/ดู/เพิกถอน — plaintext ของรหัสเห็นครั้งเดียวตอนสร้าง
router.get('/invites', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const invites = await prisma.inviteCode.findMany({
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true, label: true, role: true, max_uses: true, use_count: true,
        expires_at: true, revoked_at: true, used_at: true, created_at: true, used_by: true,
      },
    });
    res.json(invites);
  } catch (err: any) {
    console.error('[invites:list] failed:', err?.message || err);
    res.status(500).json({ error: 'อ่านรายการรหัสเชิญไม่สำเร็จ' });
  }
});

router.post('/invites', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { role, label, maxUses, expiresInHours } = req.body ?? {};
    const invite = await createInvite({ role, label, maxUses, expiresInHours, createdBy: req.user!.id });
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'INVITE_CREATED',
      payload: { invite_id: invite.id, role: invite.role, max_uses: invite.maxUses, expires_at: invite.expiresAt, ip: req.ip },
    });
    res.status(201).json(invite);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'สร้างรหัสเชิญไม่สำเร็จ' });
  }
});

router.delete('/invites/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await prisma.inviteCode.update({ where: { id: req.params.id }, data: { revoked_at: new Date() } });
    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'INVITE_REVOKED',
      payload: { invite_id: req.params.id, ip: req.ip },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[invites:revoke] failed:', err?.message || err);
    res.status(500).json({ error: 'เพิกถอนรหัสเชิญไม่สำเร็จ' });
  }
});

export default router;
