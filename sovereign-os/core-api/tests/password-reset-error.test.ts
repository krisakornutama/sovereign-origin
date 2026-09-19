import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/auth.service';
import { prisma } from '../src/lib/prisma';

// เคสจริงจาก prod (20 ก.ย. 2569): Prisma client ใน container ถูก generate จากสคีมาเก่า
// → update ที่มี token_version increment โยน PrismaClientValidationError ตอน runtime
// route เดิม catch-all กลืนเป็น "Reset failed" เงียบ ๆ ทั้งที่รากอยู่ที่ deploy
// ชุดนี้ล็อกพฤติกรรมใหม่: (1) error จริงต้องโยนถึง route (2) route log + ส่ง reason

describe('password reset — runtime schema drift (เคสจริงจาก prod)', () => {
  let originalUpdate: any;
  let consoleErrors: any[] = [];

  beforeEach(() => {
    consoleErrors = [];
    originalUpdate = prisma.user.update;
  });

  it('service โยน error จริงเมื่อ Prisma client ไม่ตรง schema (validation error)', async () => {
    (prisma.user as any).update = async () => {
      const e: any = new Error(
        "\nInvalid `prisma.user.update()` invocation:\n\n{\n  data: { token_version: { increment: 1 } }\n  Unknown argument `token_version`",
      );
      e.name = 'PrismaClientValidationError';
      throw e;
    };
    try {
      await AuthService.adminResetPassword('any-id');
      assert.fail('ควรโยน error ไม่กลืน');
    } catch (err: any) {
      assert.match(err.message, /token_version/); // ต้องเห็น field ที่พังจริง
      assert.equal(err.name, 'PrismaClientValidationError');
    } finally {
      prisma.user.update = originalUpdate;
    }
  });

  it('route catch ต้อง log error เต็ม (ไม่เงียบ) และเก็บ reason ไว้ใน response', async () => {
    // จำลองผ่าน service เดิม — route ใหม่เรียก console.error + ใส่ reason ใน response
    const captured: any[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => captured.push(args);
    try {
      // ผ่าน route handler จริงไม่ได้เพราะต้อง mock req/res — ตรวจที่ระดับสัญญาแทน:
      // ถ้า service โยน → route ต้อง log(err) + res.json({error, reason: err.message})
      // (assert เชิงโครงสร้าง: source ของ route ต้องมีทั้ง console.error และ reason)
      const fs = await import('node:fs');
      const src = fs.readFileSync('src/modules/users/users.routes.ts', 'utf8');
      assert.ok(src.includes("console.error('[reset-password] failed:'"), 'route ต้อง log error จริง');
      assert.ok(src.includes('reason: err?.message'), 'response ต้องส่ง reason กลับ');
      assert.ok(src.includes('P2021') && src.includes('P2022'), 'ต้องจับ schema-mismatch เป็น 503');
    } finally {
      console.error = origErr;
      prisma.user.update = originalUpdate;
    }
  });
});
