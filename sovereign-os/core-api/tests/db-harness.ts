import './setup-env';
import path from 'node:path';
/* Real-DB test harness — ใช้ร่วมกันโดยชุดเทส lifecycle จริงบน Postgres (gated RUN_DB_TESTS)
   สิ่งที่ทุกไฟล์เทสชุดนี้ต้องทำเหมือนกัน:
     - ตั้ง DATABASE_URL จาก TEST_DATABASE_URL ก่อน dynamic import แช่น prisma (primeDbEnv)
     - user ทดสอบจริงใน DB — ตารางส่วนใหญ่มี FK → User (inventory_items / transfer_orders)
       mock ทดแทนไม่ได้ ต้องมี row จริง + teardown ลบทิ้ง (FK cascade)
     - mock เฉพาะชั้นภายนอก (AI vision / threat-intel / MQTT broker / whisper CLI)
       — DB และดิสก์เป็นของจริงทั้งวงจร
   ห้าม static-import โมดูลจาก src ที่นี่ — เทสต้อง dynamic import เองหลัง primeDbEnv() */

export const RUN_DB = process.env.RUN_DB_TESTS === '1' && !!process.env.TEST_DATABASE_URL;
export const SKIP_REASON = 'ต้องการ RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI ubuntu job)';

/** ตั้ง env ให้ prisma จาก TEST_DATABASE_URL + quarantine ชั่วคราว — เรียกใน describe body ก่อน test แรก */
export function primeDbEnv(): void {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL as string;
  process.env.HASH_QUARANTINE_DIR = path.join(process.env.TEST_TMPDIR ?? '.', 'quarantine');
}

export interface CoreCtx {
  prisma: any;
  makeToken: (role?: string, overrides?: Record<string, unknown>) => string;
  createTestServer: (mount: (app: import('express').Express) => void) => Promise<any>;
  userId: string;
}

/** เชื่อม DB จริง + upsert user ทดสอบ + ล้างข้อมูลเศษจากรอบก่อนของ user นั้น */
export async function setupCore(): Promise<CoreCtx> {
  const { prisma } = await import('../src/lib/prisma');
  const { makeToken, createTestServer } = await import('./helpers');
  await prisma.$connect();
  await prisma.$executeRawUnsafe('SELECT 1');

  /* user จริงใน DB — username คงที่เพื่อ reuse ได้ทั้งรันท้องถิ่นและ CI (DB สดทุกรอบใน CI) */
  const username = 'db-upload-test';
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, password_hash: 'not-a-real-login' },
  });

  /* ล้างเศษจากรอบก่อน (CI รอบแรกไม่มีอยู่แล้ว) — ครอบเฉพาะตารางที่ชุดเทสนี้เขียน */
  await prisma.inventoryItem.deleteMany({ where: { user_id: user.id } });
  await prisma.transferOrder.deleteMany({ where: { user_id: user.id } });
  await prisma.treasuryEvent.deleteMany({ where: { user_id: user.id } });

  return { prisma, makeToken, createTestServer, userId: user.id };
}

/** teardown — ลบ user ทดสอบ (FK cascade ลบ inventory/transfer ที่เหลือ) + ปิด connection */
export async function teardownCore(ctx: CoreCtx): Promise<void> {
  await ctx.prisma.user.delete({ where: { id: ctx.userId } }).catch(() => {});
  await ctx.prisma.$disconnect();
}

/** ประกอบ multipart/form-data body จริง (form fields + ไฟล์ 1 ช่อง) — แบบเดียวกับที่เบราว์เซอร์ส่ง */
export function multipart(
  fields: Record<string, string>,
  fileField: string,
  filename: string,
  mime: string,
  bytes: Buffer
): { headers: Record<string, string>; body: Buffer } {
  const boundary = '----updb' + Date.now() + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) };
}

/** PNG 1×1 จริง — magic bytes ผ่าน whitelist MIME/นามสกุลของโมดูลภาพ (documents/treasury) */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** ไฟล์เสียง stub — เนื้อหาไม่สำคัญ (CLI ถูก mock) แต่ต้องผ่าน whitelist นามสกุลของ whisper */
export const WAV_STUB = Buffer.concat([Buffer.from('RIFF....WAVEfmt '), Buffer.from('sovereign-whisper-dbtest')]);
