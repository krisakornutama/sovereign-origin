// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AuditService } from '../services/audit.service';
import { config } from '../config';
import { warRoomPulse } from '../services/war-room.service';

const JWT_SECRET = config.jwtSecret;

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        assigned_node_id?: string | null;
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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded.mfa_verified) {
      return res.status(403).json({ error: 'MFA verification required' });
    }
    // Token versioning — เทียบเลขใน token กับ DB ทุก request: รหัสผ่านถูกเปลี่ยน/รีเซ็ตเมื่อไหร่
    // token เก่าทุกใบ (อุปกรณ์/session เดิม) หมดอายุ "ทันที" ไม่ต้องรอครบ 24 ชม.
    // DB ล่ม → fail open: token ยัง verify ด้วย secret อยู่ ไม่ล็อกทั้งระบบเพราะ DB ชั่วคราว
    try {
      const dbUser = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { token_version: true } });
      if (dbUser && (decoded.token_version ?? 0) !== (dbUser.token_version ?? 0)) {
        return res.status(401).json({ error: 'Session expired — password was changed', code: 'TOKEN_VERSION_STALE' });
      }
    } catch { /* fail open */ }
    // บังคับเปลี่ยนรหัสผ่านให้เป็น server-side (เดิมฝั่ง client เท่านั้น — เรียก API ตรง ๆ ข้ามได้)
    // /api/auth/change-password ใช้ authenticatePartial พอดี จึงยังเป็นทางออกของ flow นี้
    // (เช็คหลัง version — token ที่หมดอายุเพราะรหัสเปลี่ยนต้องบอกว่า "session ตาย" ไม่ใช่ "ต้องเปลี่ยนรหัส")
    if (decoded.must_change_password === true) {
      return res.status(403).json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' });
    }
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      assigned_node_id: decoded.assigned_node_id,
      mfa_verified: true,
      must_change_password: decoded.must_change_password === true,
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
function sanitizeAuditBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const sensitivePatterns = ['password', 'pass', 'secret', 'token', 'authorization', 'wifi'];
  const sanitized: any = {};
  for (const [key, value] of Object.entries(body)) {
    sanitized[key] = sensitivePatterns.some((p) => key.toLowerCase().includes(p))
      ? '[REDACTED]'
      : value;
  }
  return sanitized;
}

export function auditStateChange(req: Request, res: Response, next: NextFunction) {
  // Only log for methods that modify state
  const auditableMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!auditableMethods.includes(req.method)) {
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
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // Token versioning (เช่น admin รีเซ็ตรหัสซ้ำระหว่าง user ค้างอยู่หน้าบังคับเปลี่ยน)
    // → token ชั่วคราวใบเก่าตายทันที — fail open เมื่อ DB ล่ม เช่นเดียวกับ authenticate
    try {
      const dbUser = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { token_version: true } });
      if (dbUser && (decoded.token_version ?? 0) !== (dbUser.token_version ?? 0)) {
        return res.status(401).json({ error: 'Session expired — password was changed', code: 'TOKEN_VERSION_STALE' });
      }
    } catch { /* fail open */ }
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      assigned_node_id: decoded.assigned_node_id,
      mfa_verified: decoded.mfa_verified,   // เก็บสถานะเดิมไว้ (false)
      must_change_password: decoded.must_change_password === true,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}