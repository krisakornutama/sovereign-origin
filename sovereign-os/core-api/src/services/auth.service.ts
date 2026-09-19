import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import crypto from 'node:crypto';

export { prisma };

export class AuthService {
  // ── MFA backup codes (ใช้ครั้งเดียวทิ้ง กัน lockout ตอนโทรศัพท์หาย) ──
  // เก็บเฉพาะ sha256 hash ใน users.mfa_backup_hash (JSON array) — plaintext แสดงให้ผู้ใช้ครั้งเดียวตอน generate
  static generateBackupCodes(): string[] {
    return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  }

  private static hashCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
  }

  private static async setBackupCodes(userId: string, codes: string[]) {
    const hashes = codes.map((c) => this.hashCode(c));
    await prisma.user.update({ where: { id: userId }, data: { mfa_backup_hash: JSON.stringify(hashes) } });
  }

  static async createUser(username: string, password: string, role: string = 'OPERATOR', nodeId?: string) {
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        role: role as any,
        assigned_node_id: nodeId || null,
        // สมาชิกใหม่ทุกคนต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก (รหัสแรกเข้าเป็นของ admin)
        must_change_password: true,
      },
    });
    return user;
  }

  static async login(username: string, password: string) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error('Invalid credentials');
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error('Invalid credentials');
  
    // ถ้าไม่มี mfa_secret → token เต็ม
    if (!user.mfa_secret) {
      return {
        token: this.generateToken(user, true),
        mfa_required: false,
      };
    }
  
    // มี mfa_secret → token ชั่วคราว + แจ้ง MFA
    return {
      token: this.generateToken(user, false),
      mfa_required: true,
    };
  }

  static async verifyMfa(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfa_secret) throw new Error('MFA not configured');

    const normalized = code.trim().toLowerCase();

    // รหัสสำรอง (10 hex) — ตรงเป๊ะครั้งเดียวแล้วเผาทิ้ง (single-use)
    if (/^[0-9a-f]{10}$/.test(normalized) && user.mfa_backup_hash) {
      const hashes: string[] = JSON.parse(user.mfa_backup_hash);
      const idx = hashes.indexOf(this.hashCode(normalized));
      if (idx === -1) throw new Error('Invalid MFA code');
      hashes.splice(idx, 1);
      await prisma.user.update({
        where: { id: userId },
        data: { mfa_backup_hash: JSON.stringify(hashes) },
      });
      return this.generateToken(user, true);
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!verified) throw new Error('Invalid MFA code');
    return this.generateToken(user, true);
  }

  /**
   * ขั้น 1/2: สร้าง secret ใหม่แต่ยังไม่ activate (เก็บเป็น pending)
   * — ผู้ใช้สแกน QR แล้วกรอกรหัสจากแอปมาขั้น confirm ก่อน ถึงจะเปิดใช้จริง
   * กัน lockout: ถ้าแอปกับ secret ไม่ตรงกัน ระบบจะไม่เปิด MFA ให้
   */
  static async enrollMfa(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const secret = speakeasy.generateSecret({ name: `SovereignOS:${user.username}` });
    await prisma.user.update({
      where: { id: userId },
      data: { pending_mfa_secret: secret.base32 },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);
    return { secret: secret.base32, qrCode: qrCodeDataUrl };
  }

  /**
   * ขั้น 2/2: ผู้ใช้กรอกรหัสจากแอป Authenticator (ที่สแกน QR แล้ว)
   * — ตรวจกับ pending secret ถ้าตรงกัน → activate เป็น mfa_secret ตัวจริง
   */
  static async confirmMfa(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pending_mfa_secret) throw new Error('No pending MFA enrollment — run /auth/mfa/enroll first');

    const verified = speakeasy.totp.verify({
      secret: user.pending_mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!verified) throw new Error('Invalid MFA code — ตรวจสอบว่าแอปแสดงรหัส 6 หลักจากคีย์ที่สแกนใหม่');

    // generate รหัสสำรองใหม่ทุกครั้งที่เปิด MFA (เก็บเฉพาะ hash — ส่ง plaintext กลับครั้งเดียว)
    const backupCodes = this.generateBackupCodes();
    await this.setBackupCodes(userId, backupCodes);

    await prisma.user.update({
      where: { id: userId },
      data: { mfa_secret: user.pending_mfa_secret, pending_mfa_secret: null },
    });
    return { enabled: true, backupCodes };
  }

  /** ปิด MFA ชั่วคราว (ยกเลิก enrollment ด้วย) */
  static async disableMfa(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    await prisma.user.update({
      where: { id: userId },
      data: { mfa_secret: null, pending_mfa_secret: null, mfa_backup_hash: null },
    });
    return { enabled: false };
  }

  static async mfaStatus(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    return {
      enabled: !!user.mfa_secret,
      pending: !!user.pending_mfa_secret,
    };
  }

  /** รหัสสำรองชุดใหม่ (ทับชุดเก่า) — route นี้อยู่หลัง middleware authenticate เสมอ */
  static async regenerateBackupCodes(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfa_secret) throw new Error('MFA not configured');
    const codes = this.generateBackupCodes();
    await this.setBackupCodes(userId, codes);
    return { backupCodes: codes };
  }

  /** เปลี่ยนรหัสผ่านด้วยตัวเอง — ต้องกรอกรหัสปัจจุบันถูกต้องก่อน */
  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
    // forced flow (login ครั้งแรกด้วยรหัสชั่วคราว): ผู้ใช้เพิ่งพิสูจน์ตัวตนแล้ว — ไม่บังคับพิมพ์ซ้ำ
    // (ความสดของ token เช็คอยู่ใน authenticatePartial แล้ว)
    const inForcedFlow = !currentPassword && user.must_change_password === true;
    if (!valid && !inForcedFlow) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');

    if (typeof newPassword !== 'string' || newPassword === currentPassword) {
      throw new Error('รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม');
    }
    this.validateNewPassword(newPassword);

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      // bump token_version → token เก่าทุกอุปกรณ์ตายทันที (เคสสงสัยรหัสรั่ว)
      data: { password_hash: hash, must_change_password: false, token_version: { increment: 1 } },
    });

    // คืน token ใหม่ (ไม่มี flag บังคับเปลี่ยน + เลข version ใหม่) — session ต่อเนื่อง ไม่ต้อง login ใหม่
    return {
      token: this.generateToken({ ...user, password_hash: hash, must_change_password: false, token_version: user.token_version + 1 }, true),
    };
  }

  static validateNewPassword(password: string) {
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
    }
    if (password.length > 128) {
      throw new Error('รหัสผ่านยาวเกินไป (สูงสุด 128 ตัวอักษร)');
    }
    // กันรหัสยอดฮิตที่เดาง่าย
    const WEAK = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'abc12345', 'admin123', 'letmein1', 'welcome1', 'monkey123']);
    if (WEAK.has(password.toLowerCase())) {
      throw new Error('รหัสผ่านนี้อ่อนเกินไป — เลือกรหัสที่คาดเดายากกว่านี้');
    }
  }

  private static generateToken(user: any, mfaVerified: boolean) {
    const payload = {
      userId: user.id,
      role: user.role,
      assigned_node_id: user.assigned_node_id,
      mfa_verified: mfaVerified,
      must_change_password: user.must_change_password === true,
      // token versioning — middleware เทียบกับ DB ทุก request: เปลี่ยน/รีเซ็ตรหัสครั้งไหน
      // token ทุกใบที่มีเลขเก่าตายทันที (ไม่ต้องรอหมดอายุ 24 ชม.)
      token_version: user.token_version,
    };
    return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
  }

  // ── Admin reset password (กู้ลืมรหัส / สงสัยรั่ว) ──
  // สุ่มรหัสชั่วคราวฝั่ง server — admin ไม่ตั้งเอง (ไม่รู้รหัสจริงของ user) และรหัสนี้
  // ถูกบังคับให้ user เปลี่ยนเองตอน login ครั้งหน้า (must_change_password)
  static generateTemporaryPassword(): string {
    // 12 ตัว อ่านง่าย ไม่มี 0/O/1/l/I
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    const arr = crypto.randomBytes(12);
    let p = '';
    for (let i = 0; i < 12; i++) p += chars[arr[i] % chars.length];
    return p;
  }

  /** รีเซ็ตรหัสผ่านให้ user (SUPERADMIN): สุ่มรหัสชั่วคราว + บังคับเปลี่ยน + bump token version
   *  → token เดิมทุกอุปกรณ์ตายทันที (เคส "สงสัยรหัสรั่ว" ปิดจบในคลิกเดียว) */
  static async adminResetPassword(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    const temporaryPassword = AuthService.generateTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: hash,
        must_change_password: true,
        token_version: { increment: 1 },
      },
    });
    return { temporaryPassword, targetUsername: user.username };
  }
}