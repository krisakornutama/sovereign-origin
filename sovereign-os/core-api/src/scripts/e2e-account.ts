// src/scripts/e2e-account.ts — เปิด/ปิดบัชีสำหรับ e2e เฉพาะช่วงที่เทสต์วิ่ง (2/10/69)
//
// ที่มา: runbook §๖ กำหนดให้ "ปิดบัชี e2e-bot" (SUPERADMIN ที่รหัสอยู่ใน repo) เป็นเส้นตายก่อนเปิดสู่โลก
//   ผลของมัน: nightly verify:full ตั้งแต่นั้นล้มที่ e2e ทุกคืน (API login 401) เพราะบัชีถูกล็อกจริง
//   ทางแก้ที่ยังไว้ความปลอดภัย: ไม่ใช้รหัสที่อยู่ใน repo แต่ "สุ่มรหัสใหม่ตอนเริ่มเทสต์ → ล็อกกลับทันทีหลังจบ"
//   ไม่มีช่วงเวลาใดที่บัญชีนี้เปิดพร้อมรหัสที่คนอื่นรู้
//
//   ใช้:  node dist/scripts/e2e-account.js grant  <username> <password>
//         node dist/scripts/e2e-account.js revoke <username>
//   (ถ้ายังไม่ได้ build ให้รันด้วย tsx: npx tsx src/scripts/e2e-account.ts grant ...)
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// สคริปต์นี้รันนอก server.ts ที่โหลด env ไว้แล้ว → ต้องโหลดเอง (เจอจริงรอบแรก: Prisma บอก
// "Environment variable not found: DATABASE_URL" แล้วเทสต์ทั้งชุดล้ม 401)
// dist/scripts/*.js และ src/scripts/*.ts อยู่ลึกเท่ากันทั้งสองทาง → ../.. คือโฟลเดอร์ core-api
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// bcrypt.compare กับค่าที่ไม่ใช่ hash จะคืน false เสมอ = ล็อกบัญชีโดยไม่ต้องมีคอลัมน์ isActive
const LOCK_SENTINEL = (why: string) => `!disabled:${why}`;

async function main() {
  const [cmd, username] = process.argv.slice(2);
  if (!cmd || !username) {
    console.error('usage: e2e-account <grant|revoke> <username> [password]');
    process.exit(2);
  }

  if (cmd === 'grant') {
    const password = process.argv[4];
    if (!password || password.length < 12) {
      console.error('grant: ต้องมีรหัสผ่านยาว ≥ 12 ตัวอักษร');
      process.exit(2);
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { username },
      update: {
        password_hash: hash,
        must_change_password: false,
        // เพิ่ม token_version = ตัด token เก่าที่อาจยังค้างอยู่ทิ้ง (บัญชีนี้เคยถูกล็อก)
        token_version: { increment: 1 },
      },
      select: { id: true, role: true },
      create: {
        username,
        password_hash: hash,
        role: 'SUPERADMIN',
        must_change_password: false,
      },
    });
    console.log(`granted ${username} (${user.role})`);
    return;
  }

  if (cmd === 'revoke') {
    // ล็อกกลับทันทีหลังเทสต์ — ไม่ลบผู้ใช้ทิ้ง เพื่อไม่ให้ FK ของ audit/visitor พัง
    const r = await prisma.user.updateMany({
      where: { username },
      data: { password_hash: LOCK_SENTINEL(`e2e-revoked-${new Date().toISOString()}`), token_version: { increment: 1 } },
    });
    console.log(`revoked ${username} (${r.count} row)`);
    return;
  }

  console.error(`ไม่รู้จักคำสั่ง: ${cmd}`);
  process.exit(2);
}

main()
  .catch((e) => {
    console.error('e2e-account ล้ม:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
