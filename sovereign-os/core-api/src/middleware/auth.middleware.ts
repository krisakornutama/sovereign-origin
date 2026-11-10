// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuditService } from '../services/audit.service';
import { verifyJwt } from '../lib/jwt-verify';
import { warRoomPulse } from '../services/war-room.service';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        assigned_node_id?: string | null;
        /** สาขาที่ผูกไว้ — มีผลเฉพาะ role = SITE_ADMIN (อ่านจาก DB ทุก request) */
        assigned_site_id?: string | null;
        mfa_verified: boolean;
        must_change_password?: boolean;
      };
    }
  }
}

/**
 * 1. Verify JWT and MFA status (production mode only, no dev bypass)
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  // Idempotent: a stricter auth step may already have run earlier in the chain
  // (e.g. the 25 MB body parser for /api/clone/import is mounted behind auth).
  // Never skip when only a partial token was verified.
  if (req.user?.mfa_verified) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyJwt(token) as any;
    if (!decoded.mfa_verified) {
      return res.status(403).json({ error: 'MFA verification required' });
    }
    // Token versioning — เทียบเลขใน token กับ DB ทุก request: รหัสผ่านถูกเปลี่ยน/รีเซ็ตเมื่อไหร่
    // token เก่าทุกใบ (อุปกรณ์/session เดิม) หมดอายุ "ทันที" ไม่ต้องรอครบ 24 ชม.
    // DB คือแหล่งความจริงของ role/assigned_node_id ด้วย — ห้ามเชื่อ claims ใน JWT
    // (user ถูกลบ/ถูกลดสิทธิ์แล้ว token เดิมต้องใช้ไม่ได้ทันที)
    let dbUser: any;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          role: true,
          assigned_node_id: true,
          assigned_site_id: true,
          token_version: true,
          must_change_password: true,
        },
      });
    } catch (err: any) {
      // DB ล่ม = ตรวจสิทธิ์ไม่ได้ → ปฏิเสธแบบ 503 ไม่ปล่อยผ่านด้วย claims เก่า
      console.error('[auth] user lookup failed:', err?.message || err);
      return res.status(503).json({ error: 'Authentication temporarily unavailable', code: 'AUTH_UNAVAILABLE' });
    }
    if (!dbUser) {
      return res.status(401).json({ error: 'User no longer exists', code: 'USER_NOT_FOUND' });
    }
    if ((decoded.token_version ?? 0) !== (dbUser.token_version ?? 0)) {
      return res.status(401).json({ error: 'Session expired — password was changed', code: 'TOKEN_VERSION_STALE' });
    }
    // บังคับเปลี่ยนรหัสผ่านให้เป็น server-side (อ่านจาก DB ไม่ใช่ claim ที่อาจค้าง)
    // /api/auth/change-password ใช้ authenticatePartial พอดี จึงยังเป็นทางออกของ flow นี้
    // (เช็คหลัง version — token ที่หมดอายุเพราะรหัสเปลี่ยนต้องบอกว่า "session ตาย" ไม่ใช่ "ต้องเปลี่ยนรหัส")
    if (dbUser.must_change_password === true) {
      return res.status(403).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
    }
    req.user = {
      id: dbUser.id,
      role: dbUser.role,
      assigned_node_id: dbUser.assigned_node_id ?? null,
      assigned_site_id: dbUser.assigned_site_id ?? null,
      mfa_verified: true,
      must_change_password: false,
    };
    warRoomPulse(); // ข้อ 3: ทุก request ที่ผ่าน auth = สัญญาณ "มนุษย์กำลังใช้ War Room"
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * 2. Role‑based guard – pass allowed roles
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

/**
 * 3. Node‑specific access for NODE_ADMIN
 *    To be used on routes that have :nodeId param (e.g. /nodes/:nodeId/devices)
 */
export function ensureNodeAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user!;
    if (user.role === 'SUPERADMIN') {
      return next(); // global access
    }
    if (user.role === 'NODE_ADMIN') {
      const requestedNodeId = req.params.nodeId || req.body.node_id;
      if (!requestedNodeId || requestedNodeId !== user.assigned_node_id) {
        return res.status(403).json({ error: 'You can only access your assigned node' });
      }
      return next();
    }
    // Other roles (OPERATOR, SYSTEM_AI) have no cross-node access
    return res.status(403).json({ error: 'Access denied' });
  };
}

/**
 * 4. Automatic audit logging for state‑changing requests
 */

// Never store secrets in the audit trail – redact any value whose key looks
// sensitive (password, tokens, MFA secrets, WiFi credentials, ...).
//
// แก้ 11/11/69: เดิมปิดเฉพาะ key ชั้นบน ⇒ `{user:{password}}` หลุดลง audit_logs
// เต็ม ๆ (และ array ของบัญชีก็หลุดทั้งชุด) — ตอนนี้ไล่ปิดทุกชั้น + จำกัดขนาด
// เพราะ body ของ `/api/clone/import` รับได้ถึง 25 MB; เก็บทั้งก้อน = audit_logs บวม
// และคัดข้อมูลลูกค้าเข้าสายตรวจสอบโดยไม่ตั้งใจ
const SENSITIVE_KEY_PATTERNS = ['password', 'pass', 'secret', 'token', 'authorization', 'wifi'];
/** เพดานขนาด body ที่เก็บจริง (byte) — เกินกว่านี้เก็บแค่ "โครง" ไม่เก็บเนื้อ */
export const MAX_AUDIT_BODY_BYTES = 4096;
const MAX_AUDIT_DEPTH = 6;
const MAX_AUDIT_ARRAY_ITEMS = 50;

function redactAuditValue(value: any, depth: number): any {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_AUDIT_DEPTH) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_AUDIT_ARRAY_ITEMS).map((v) => redactAuditValue(v, depth + 1));
  }
  const out: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERNS.some((p) => key.toLowerCase().includes(p))
      ? '[REDACTED]'
      : redactAuditValue(child, depth + 1);
  }
  return out;
}

export function sanitizeAuditBody(body: any): any {
  const redacted = redactAuditValue(body, 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted ?? null);
  } catch {
    return '[UNSERIALIZABLE]';
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= MAX_AUDIT_BODY_BYTES) return redacted;
  // เก็บแค่ "ส่ง key อะไรมาบ้าง" — พอสำหรับตรวจย้อนว่ามีการเรียกอะไร ไม่ใช่ก๊อปข้อมูลทั้งก้อน
  const keys =
    redacted && typeof redacted === 'object' && !Array.isArray(redacted)
      ? Object.keys(redacted).slice(0, 20)
      : [];
  return { _truncated: true, _bytes: bytes, _keys: keys };
}

export function auditStateChange(req: Request, res: Response, next: NextFunction) {
  // Only log for methods that modify state
  const auditableMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!auditableMethods.includes(req.method)) {
    return next();
  }
  // เส้น polling ที่ UI เรียกถี่ — บันทึกทุกครั้ง = ขยะ audit หลายพันแถว/วัน ไม่มีคุณค่าเชิงตรวจสอบ (20 ก.ย. 2569)
  if (req.path === '/api/automation/check') {
    return next();
  }

  // Capture the original end to log after response is sent
  const originalEnd = res.end;
  res.end = function (...args: any[]) {
    // Write audit log asynchronously (do not block the response)
    if (req.user) {
      AuditService.logAction({
        userId: req.user.id,
        actionType: `${req.method} ${req.originalUrl}`,
        payload: {
          method: req.method,
          path: req.originalUrl,
          body: sanitizeAuditBody(req.body),
          query: req.query,
          ip: req.ip,
          statusCode: res.statusCode,
        },
      }).catch(console.error);
    }
    return originalEnd.apply(res, args as any);
  };

  next();
}

/**
 * 5. Partial authentication – verify JWT only, skip MFA check.
 *    Used for /verify-mfa where the token has mfa_verified = false.
 */
export async function authenticatePartial(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyJwt(token) as any;
    // Token versioning (เช่น admin รีเซ็ตรหัสซ้ำระหว่าง user ค้างอยู่หน้าบังคับเปลี่ยน)
    // → token ชั่วคราวใบเก่าตายทันที · DB คือแหล่งความจริงของ role/สถานะ user
    let dbUser: any;
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          role: true,
          assigned_node_id: true,
          assigned_site_id: true,
          token_version: true,
          must_change_password: true,
        },
      });
    } catch (err: any) {
      console.error('[auth] partial user lookup failed:', err?.message || err);
      return res.status(503).json({ error: 'Authentication temporarily unavailable', code: 'AUTH_UNAVAILABLE' });
    }
    if (!dbUser) {
      return res.status(401).json({ error: 'User no longer exists', code: 'USER_NOT_FOUND' });
    }
    if ((decoded.token_version ?? 0) !== (dbUser.token_version ?? 0)) {
      return res.status(401).json({ error: 'Session expired — password was changed', code: 'TOKEN_VERSION_STALE' });
    }
    req.user = {
      id: dbUser.id,
      role: dbUser.role,
      assigned_node_id: dbUser.assigned_node_id ?? null,
      assigned_site_id: dbUser.assigned_site_id ?? null,
      mfa_verified: decoded.mfa_verified,   // เก็บสถานะเดิมไว้ (false)
      must_change_password: dbUser.must_change_password === true,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}