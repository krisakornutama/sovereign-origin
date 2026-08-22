import { PrismaClient } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────────────
// PrismaClient singleton กลางของทั้งระบบ
//
// ก่อนหน้านี้ทุก module/service สร้าง `new PrismaClient()` ของตัวเอง (73 จุด)
// → 73 connection pool แยกกัน เปลือง connection ของ Postgres และทำให้ test
// ที่ mock ผ่าน mockModel() ต้องรู้ว่า instance ไหนถูกใช้ตรงไหน
//
// ตอนนี้ทุกไฟล์ import `prisma` จากที่นี่แทน (module ที่เคย export prisma
// ยัง re-export ชื่อเดิมต่อ — call site เดิมไม่ต้องแก้)
//
// globalThis cache: กัน tsx watch / dev-mode ที่ reload module แล้วสร้าง
// client ใหม่ทุกรอบจนหมด connection (pattern มาตรฐานของ Prisma + Next.js)
// ────────────────────────────────────────────────────────────────────────────
const globalForPrisma = globalThis as unknown as { __sovereignPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__sovereignPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__sovereignPrisma = prisma;
}

export default prisma;
