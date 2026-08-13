import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import speakeasy from 'speakeasy';

const prisma = new PrismaClient();

// No hardcoded default password: use SEED_ADMIN_PASSWORD when provided,
// otherwise generate a strong random one and print it once on the console.
function getAdminPassword(): string {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < 12) {
      console.warn('⚠️  SEED_ADMIN_PASSWORD สั้นเกินไป (< 12 ตัวอักษร) — กรุณาใช้รหัสที่แข็งแรงกว่านี้');
    }
    return fromEnv;
  }
  return crypto.randomBytes(12).toString('base64url'); // 16 chars
}

async function main() {
  // สร้าง Node ตัวอย่าง (ถ้ายังไม่มี)
  await prisma.node.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Home Base',
      status: 'active',
    },
  });

  // ── ตั้งรหัสผ่านเฉพาะเมื่อ: ยังไม่มี admin (ครั้งแรก) หรือตั้ง SEED_ADMIN_PASSWORD ไว้ชัดเจน ──
  // กันปัญหาเดิม: seed re-run โดยไม่มี SEED_ADMIN_PASSWORD จะสุ่มรหัสใหม่ทุกครั้ง
  // แล้วทับ hash เก่า → admin ล็อกเอาต์ทันทีโดยไม่รู้รหัสใหม่ (เหมือน mfa_secret ที่ไม่ overwrite)
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });
  const mfaSecret = speakeasy.generateSecret({ name: 'SovereignOS:admin' });
  const adminPassword = getAdminPassword();
  const setPassword = !existingAdmin || !!process.env.SEED_ADMIN_PASSWORD;

  if (setPassword) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: {
        password_hash: hash,
        // สำคัญ: อย่า overwrite mfa_secret ตอน re-run — ถ้า user enroll 2FA ในแอป
        // Authenticator ไปแล้ว การ generate secret ใหม่จะทำให้แอปเดิมใช้ไม่ได้ทันที
        // (เคยเกิดปัญหานี้: seed re-run rotate secret → 2FA ของ user พัง ดู scripts/reset-admin-and-verify.mjs)
        // อยากตั้ง/เปลี่ยน MFA ให้ใช้ /api/auth/setup-mfa แทน
      },
      create: {
        username: 'admin',
        password_hash: hash,
        role: 'SUPERADMIN',
        mfa_secret: mfaSecret.base32,
        assigned_node_id: null,
      },
    });
  } else {
    console.log('ℹ️  admin มีอยู่แล้ว และไม่ได้ตั้ง SEED_ADMIN_PASSWORD — คงรหัสผ่านเดิมไว้ ไม่แตะ');
  }

  console.log('✅ Seed complete');
  if (setPassword) {
    console.log('👤 Admin username: admin');
    console.log('🔑 Admin password:', adminPassword);
  }
  if (existingAdmin?.mfa_secret) {
    // re-run: คง secret เดิมไว้ (ไม่ rotate) — ปริ้นท์ secret ที่อยู่ใน DB จริง ๆ
    // ไม่งั้นคนสแกน QR ที่ปริ้นท์ออกมาจะใช้ไม่ได้ (แอปมี secret เดิมอยู่แล้ว)
    const storedUrl = speakeasy.otpauthURL({
      secret: existingAdmin.mfa_secret,
      label: 'SovereignOS:admin',
      encoding: 'base32', // กัน secret ถูก re-encode ซ้ำ (base32 → ASCII → base32)
    });
    console.log('ℹ️  ผู้ใช้มี MFA อยู่แล้ว — คง secret เดิมไว้ (ไม่ rotate)');
    console.log('📱 MFA Secret (base32):', existingAdmin.mfa_secret);
    console.log('🔑 MFA URL:', storedUrl);
  } else if (setPassword) {
    console.log('📱 MFA Secret (base32):', mfaSecret.base32);
    console.log('🔑 MFA URL:', mfaSecret.otpauth_url);
    // ใช้ MFA URL นี้สร้าง QR Code ในแอป Authenticator (Google/Microsoft)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());