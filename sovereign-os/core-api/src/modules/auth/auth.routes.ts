import { Router } from 'express';
import { authenticate, authenticatePartial, requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { AuthService, prisma } from '../../services/auth.service';
import { AuditService } from '../../services/audit.service';

const router = Router();

// Brute-force protection: max 10 attempts per 15 min per IP per endpoint.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later',
});

// Per-account lockout: แยก bucket ตาม username ที่กรอก — brute-force ต่อบัญชี
// (จากหลาย IP) ก็โดนบล็อก ไม่ต้องรอเตือน IP เดียวก่อน  + เขียน audit log ทุกครั้งที่โดน 429
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // ต่ำกว่า per-IP (10) — credential stuffing จาก few IPs ต้องโดนชั้นบัญชีก่อน
  message: 'Too many login attempts for this account, please try again later',
  keyBy: (req) => String(req.body?.username ?? '').trim(), // ว่าง → limiter ตกไปใช้ IP เอง
  onBlock: (username, req) => {
    // AuditLog.user_id เป็น FK → ต้อง resolve username เป็น id ก่อน
    // (username ที่ไม่มีในระบบเขียน audit ไม่ได้ — ข้าม)
    void prisma.user
      .findUnique({ where: { username }, select: { id: true } })
      .then((user) => {
        if (!user) return;
        return AuditService.logAction({
          userId: user.id,
          actionType: 'RATE_LIMIT_BLOCK',
          payload: { endpoint: '/api/auth/login', username, ip: req.ip },
        });
      })
      .catch(() => {});
  },
});

// Per-account ที่ขั้น verify-mfa: bucket ตาม userId ของ partial token
const mfaAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // ต่ำกว่า per-IP (10) — เหตุผลเดียวกับ accountLimiter
  message: 'Too many MFA attempts for this account, please try again later',
  keyBy: (req) => String(req.user?.id ?? ''),
  onBlock: (userId, req) => {
    void AuditService.logAction({
      userId,
      actionType: 'RATE_LIMIT_BLOCK',
      payload: { endpoint: '/api/auth/verify-mfa', ip: req.ip },
    });
  },
});

const MFA_WINDOW_MS = 15 * 60 * 1000;
const MFA_MAX = 10;
const MFA_MAX_BLOCK_MS = 24 * 60 * 60 * 1000; // cap 24 ชม.
// MFA limiter พร้อม exponential backoff:
// เกิน 10 ครั้ง/15 นาที → บล็อก 15 นาที; ทุกครั้งที่ retry ขณะโดนบล็อก
// ระยะรอเพิ่ม 2 เท่า (15m → 30m → 1h … สูงสุด 24h)
const mfaLimiter = rateLimit({
  windowMs: MFA_WINDOW_MS,
  max: MFA_MAX,
  backoff: true,
  maxBlockMs: MFA_MAX_BLOCK_MS,
  message: 'Too many MFA attempts, please try again later',
});

// กัน abuse ของ endpoint ล้าง rate limit เอง
const clearLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many clear attempts, please try again later',
});

// เปลี่ยนรหัสผ่าน — จำกัดจำนวนครั้ง กัน brute-force ของรหัสปัจจุบัน
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password change attempts, please try again later',
});

// POST /api/auth/login (ไม่ต้องใช้ middleware แต่มี rate-limit ทั้ง per-IP และ per-account)
router.post('/login', loginLimiter, accountLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await AuthService.login(username, password);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// POST /api/auth/verify-mfa (ใช้ authenticatePartial + rate-limit per-IP และ per-account)
// หมายเหตุ: accountLimiter ต้องไปหลัง authenticatePartial เพื่อให้ req.user พร้อมใช้เป็น key
router.post('/verify-mfa', mfaLimiter, authenticatePartial, mfaAccountLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    const token = await AuthService.verifyMfa(req.user!.id, code);
    res.json({ token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/change-password — เปลี่ยนรหัสผ่านด้วยตัวเอง (ต้องรู้รหัสปัจจุบัน)
// ใช้ได้กับทุกบทบาทรวมถึงสมาชิก — สมาชิกที่เพิ่งได้บัญชี (must_change_password=true)
// จะถูกบังคับให้เปลี่ยนที่หน้านี้ก่อนเข้าหน้าอื่น
// ใช้ authenticatePartial (ไม่ใช่ authenticate) เพราะ user ที่โดนบังคับเปลี่ยนรหัส
// (must_change_password) ยังไม่ผ่าน authenticate — นี่คือหน้าทางออกของ flow นั้น
router.post('/change-password', changePasswordLimiter, authenticatePartial, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required' });
    }
    if (typeof newPassword !== 'string' || !newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }
    const { token } = await AuthService.changePassword(req.user!.id, currentPassword, newPassword);
    res.json({ token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── MFA management (flow ปลอดภัย: enroll → สแกน QR → confirm ด้วยรหัสจากแอป) ──

// POST /api/auth/mfa/enroll — ขั้น 1: สร้าง secret ใหม่ (ยังไม่ activate)
// คืน QR + คีย์ base32 ให้สแกน/กรอกในแอป Authenticator
router.post('/mfa/enroll', authenticate, async (req, res) => {
  try {
    const { qrCode, secret } = await AuthService.enrollMfa(req.user!.id);
    res.json({ qrCode, secret });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/mfa/confirm — ขั้น 2: ยืนยันด้วยรหัสจากแอป (สแกน QR แล้ว)
// ตรวจตรงกับ pending secret ก่อน → activate เป็น MFA จริง
router.post('/mfa/confirm', authenticate, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'code must be 6 digits' });
    }
    const result = await AuthService.confirmMfa(req.user!.id, code.trim());
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/mfa/disable — ปิด MFA ชั่วคราว (เข้าได้ด้วยรหัสผ่านอย่างเดียว)
router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    const result = await AuthService.disableMfa(req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/mfa/backup-codes — รหัสสำรองชุดใหม่ (ทับชุดเก่า; ต้องผ่าน MFA แล้วเท่านั้น)
router.post('/mfa/backup-codes', authenticate, async (req, res) => {
  try {
    const result = await AuthService.regenerateBackupCodes(req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/mfa/status — MFA เปิด/ปิด หรือมี pending enrollment
router.get('/mfa/status', authenticate, async (req, res) => {
  try {
    res.json(await AuthService.mfaStatus(req.user!.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/rate-limit-status — ดูสถานะ MFA rate limit (per-IP + per-account)
// (ต้อง SUPERADMIN + ผ่าน MFA แล้ว)
router.get('/rate-limit-status', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const now = Date.now();
  const toClient = (key: string, state: { count: number; windowResetAt: number; blockedUntil: number; blockLevel: number }) => ({
    key,
    attempts: state.count,
    windowResetInSec: Math.max(0, Math.ceil((state.windowResetAt - now) / 1000)),
    blocked: state.blockedUntil > now,
    blockedForSec: state.blockedUntil > now ? Math.ceil((state.blockedUntil - now) / 1000) : 0,
    blockLevel: state.blockLevel,
  });
  res.json({
    limiter: {
      windowMs: MFA_WINDOW_MS,
      max: MFA_MAX,
      backoff: true,
      maxBlockMs: MFA_MAX_BLOCK_MS,
    },
    clients: mfaLimiter.store.all().map(({ ip, state }) => toClient(ip, state)),
    accounts: mfaAccountLimiter.store.all().map(({ ip, state }) => toClient(ip, state)),
  });
});

// POST /api/auth/rate-limit/clear — ล้าง MFA rate limit ของ IP/account ที่ระบุ (หรือทั้งหมด)
// ใช้ authenticatePartial (แค่พิสูจน์รหัสผ่าน) เพื่อให้ใช้เป็น recovery path
// ตอน user ถูกล็อกที่ขั้น MFA — ยังต้องมี role SUPERADMIN + ถูก audit log
// body: { ip?: string, username?: string } — ไม่ส่งอะไรเลย = ล้างทั้งหมด
router.post('/rate-limit/clear', clearLimiter, authenticatePartial, requireRole('SUPERADMIN'), async (req, res) => {
  const { ip, username } = req.body || {};
  let cleared = 0;
  if (typeof username === 'string' && username) {
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (user) cleared += mfaAccountLimiter.store.clear(user.id).length;
  } else if (typeof ip === 'string' && ip) {
    cleared += mfaLimiter.store.clear(ip).length;
  } else {
    cleared += mfaLimiter.store.clear().length + mfaAccountLimiter.store.clear().length;
  }
  res.json({ cleared });
});

export default router;