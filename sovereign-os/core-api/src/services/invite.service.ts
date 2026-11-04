// src/services/invite.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// สมัครสมาชิกแบบมีรหัสเชิญ (Community Edition / self-hosted)
// เหตุผลที่เลือกรหัสเชิญแทนอีเมล: ไม่ต้องมี SMTP, ไม่มี bot สมัครเองถ้าเปิดพอร์ตออกเน็ต
// และ admin เห็นว่าใครได้รับสิทธิ์อะไรก่อนสร้างบัญชี
//
// ความปลอดภัย:
//   · เก็บเฉพาะ sha256 ของรหัส (DB รั่ว = รหัสใช้ไม่ได้)
//   · ใช้ได้ครั้งเดียว/จำกัดจำนวน (max_uses) + หมดอายุ + เพิกถอนได้
//   · การนับใช้ atomic updateMany (กันสอง request แย่งใช้รหัสสุดท้ายพร้อมกัน)
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AuthService } from './auth.service';
import { setConsent } from './consent.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด 0/O/1/I ออก — พิมพ์ผิดยาก
const CODE_PREFIX = 'SG';

export class InviteError extends Error {
  code: 'INVALID_CODE' | 'USERNAME_TAKEN' | 'WEAK_PASSWORD' | 'INVALID_USERNAME';
  status: number;
  constructor(code: InviteError['code'], message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** ตัดอักขระที่คนพิมพ์ติดมา (ขีด/เว้นวรรค/ตัวพิมพ์เล็ก) ก่อน hash — ผู้ใช้พิมพ์ตามที่เห็นได้ */
export function normalizeInviteCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashInviteCode(raw: unknown): string {
  return crypto.createHash('sha256').update(normalizeInviteCode(raw)).digest('hex');
}

/** SG-XXXX-XXXX-XXXX (อ่าน/ปริ้นให้ทีมงานได้) */
function generateCode(): string {
  const bytes = crypto.randomBytes(12);
  let body = '';
  for (let i = 0; i < 12; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return `${CODE_PREFIX}${body}`;
}

export function formatInviteCode(compact: string): string {
  const body = compact.replace(/^SG/, '');
  return `${CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export interface CreateInviteInput {
  role?: string;
  label?: string | null;
  maxUses?: number;
  expiresInHours?: number;
  createdBy?: string | null;
}

const VALID_INVITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN'];

export async function createInvite(input: CreateInviteInput = {}) {
  const role = input.role ?? 'OPERATOR';
  if (!VALID_INVITE_ROLES.includes(role)) throw new Error('บทบาทไม่ถูกต้อง');
  const maxUses = Math.min(Math.max(Number(input.maxUses ?? 1) || 1, 1), 100);
  const hours = Number(input.expiresInHours ?? 0);
  const expires_at = hours > 0 ? new Date(Date.now() + Math.min(hours, 24 * 365) * 3600_000) : null;

  const compact = generateCode();
  const row = await prisma.inviteCode.create({
    data: {
      code_hash: hashInviteCode(compact),
      label: input.label ? String(input.label).slice(0, 120) : null,
      role: role as any,
      max_uses: maxUses,
      expires_at,
      created_by: input.createdBy ?? null,
    },
  });
  // plaintext คืนครั้งเดียวตรงนี้เท่านั้น — ไม่ถูกเก็บที่ไหนอีก
  return { id: row.id, code: formatInviteCode(compact), role, maxUses, expiresAt: expires_at };
}

export type InviteCheck =
  | { valid: true; role: string; usesLeft: number; expiresAt: Date | null }
  | { valid: false; reason: 'INVALID_CODE' | 'EXPIRED' | 'REVOKED' | 'USED_UP' };

function isUsable(invite: any, now = new Date()): InviteCheck {
  if (!invite || invite.revoked_at) return { valid: false, reason: 'REVOKED' };
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= now.getTime()) return { valid: false, reason: 'EXPIRED' };
  if (Number(invite.use_count) >= Number(invite.max_uses)) return { valid: false, reason: 'USED_UP' };
  return {
    valid: true,
    role: invite.role,
    usesLeft: Number(invite.max_uses) - Number(invite.use_count),
    expiresAt: invite.expires_at ?? null,
  };
}

export async function checkInvite(rawCode: unknown): Promise<InviteCheck> {
  const compact = normalizeInviteCode(rawCode);
  if (!compact) return { valid: false, reason: 'INVALID_CODE' };
  const invite = await prisma.inviteCode.findUnique({ where: { code_hash: hashInviteCode(compact) } });
  if (!invite) return { valid: false, reason: 'INVALID_CODE' };
  return isUsable(invite);
}

export interface RegisterInput {
  code: unknown;
  username: unknown;
  password: unknown;
  /** ความยินยอมเพิ่มเติม (ไม่บังคับ) — essential ถูกบันทึกให้อัตโนมัติ */
  consents?: Record<string, boolean>;
  ip?: string | null;
}

export interface RegisterResult {
  token: string;
  user: { id: string; username: string; role: string };
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export async function registerWithInvite(input: RegisterInput): Promise<RegisterResult> {
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (!USERNAME_RE.test(username)) {
    throw new InviteError('INVALID_USERNAME', 'ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ a-z A-Z 0-9 . _ - เท่านั้น');
  }
  AuthService.validateNewPassword(password);

  const compact = normalizeInviteCode(input.code);
  if (!compact) throw new InviteError('INVALID_CODE', 'รหัสเชิญไม่ถูกต้องหรือถูกใช้ไปแล้ว');
  const invite = await prisma.inviteCode.findUnique({ where: { code_hash: hashInviteCode(compact) } });
  const usable = isUsable(invite);
  if (!usable.valid) throw new InviteError('INVALID_CODE', 'รหัสเชิญไม่ถูกต้องหรือถูกใช้ไปแล้ว');

  // กันการแย่งใช้รหัสสุดท้ายพร้อมกัน: นับเฉพาะแถวที่ยังใช้ได้จริง (atomic)
  const claimed = await prisma.inviteCode.updateMany({
    where: {
      id: invite!.id,
      revoked_at: null,
      use_count: { lt: invite!.max_uses },
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    data: { use_count: { increment: 1 }, used_at: new Date() },
  });
  if (claimed.count !== 1) throw new InviteError('INVALID_CODE', 'รหัสเชิญไม่ถูกต้องหรือถูกใช้ไปแล้ว');

  const password_hash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        username,
        password_hash,
        role: invite!.role as any,
        // ผู้สมัครตั้งรหัสเอง ⇒ ไม่ต้องบังคับเปลี่ยน (ต่างจาก admin สร้างบัญชีให้)
        must_change_password: false,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || /unique/i.test(String(err?.message))) {
      throw new InviteError('USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีคนใช้แล้ว', 409);
    }
    throw err;
  }

  await prisma.inviteCode.update({ where: { id: invite!.id }, data: { used_by: user.id } });

  // PDPA: วัตถุประสงค์ "จำเป็นต่อบริการ" บันทึกเป็นหลักฐาน ณ เวลาสมัคร + ที่เลือกเพิ่มได้
  await setConsent({ userId: user.id, purpose: 'essential', granted: true, source: 'register', ip: input.ip ?? null });
  for (const [purpose, granted] of Object.entries(input.consents ?? {})) {
    if (purpose === 'essential') continue;
    if (granted) await setConsent({ userId: user.id, purpose, granted: true, source: 'register', ip: input.ip ?? null });
  }

  return {
    token: AuthService.generateToken(user, true),
    user: { id: user.id, username: user.username, role: String(user.role) },
  };
}
