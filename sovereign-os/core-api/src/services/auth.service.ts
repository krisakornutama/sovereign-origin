import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient();

export class AuthService {
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

    await prisma.user.update({
      where: { id: userId },
      data: { mfa_secret: user.pending_mfa_secret, pending_mfa_secret: null },
    });
    return { enabled: true };
  }

  /** ปิด MFA ชั่วคราว (ยกเลิก enrollment ด้วย) */
  static async disableMfa(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    await prisma.user.update({
      where: { id: userId },
      data: { mfa_secret: null, pending_mfa_secret: null },
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

  /** เปลี่ยนรหัสผ่านด้วยตัวเอง — ต้องกรอกรหัสปัจจุบันถูกต้องก่อน */
  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!valid) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');

    if (typeof newPassword !== 'string' || newPassword === currentPassword) {
      throw new Error('รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม');
    }
    this.validateNewPassword(newPassword);

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hash, must_change_password: false },
    });

    // คืน token ใหม่ (ไม่มี flag บังคับเปลี่ยน) — session ต่อเนื่อง ไม่ต้อง login ใหม่
    return {
      token: this.generateToken({ ...user, password_hash: hash, must_change_password: false }, true),
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
    };
    return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
  }
}