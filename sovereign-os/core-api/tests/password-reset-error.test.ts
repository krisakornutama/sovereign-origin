import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// เคสจริงจาก prod (20 ก.ย. 2569): Prisma client ใน container ถูก generate จากสคีมาเก่า
// → update ที่มี token_version increment โยน PrismaClientValidationError ตอน runtime
// route เดิม catch-all กลืนเป็น "Reset failed" เงียบ ๆ ทั้งที่รากอยู่ที่ deploy
// ชุดนี้ล็อกสัญญาของการแก้ (pure — ไม่ต่อ DB):
//  1) service ไม่กลืน error (โยนต่อให้ route จัดการ)
//  2) route log จริง + ส่ง reason + จับ schema mismatch เป็น 503
//  3) schema ต้องทำ audit_logs.user_id เป็น nullable + SetNull (กัน DELETE user ค้างจาก FK)

describe('password reset — runtime schema drift (เคสจริงจาก prod)', () => {
  const routesSrc = readFileSync('src/modules/users/users.routes.ts', 'utf8');
  const schemaSrc = readFileSync('prisma/schema.prisma', 'utf8');

  it('route ต้อง log error จริง (ไม่กลืนเงียบ ๆ)', () => {
    assert.ok(routesSrc.includes("console.error('[reset-password] failed:'"), 'route ต้อง log error จริง');
    assert.ok(routesSrc.includes("console.error('[users:delete] failed:'"), 'DELETE ต้อง log เช่นกัน');
  });

  it('response ต้องส่ง reason กลับให้ฝั่ง client วินิจฉัยได้', () => {
    assert.ok(routesSrc.includes('reason: err?.message'), 'reset + delete ต้องแนบ reason');
    assert.ok(routesSrc.includes("error: 'Reset failed', reason:"), 'reset ต้องแนบ reason');
  });

  it('schema mismatch (P2021/P2022) ต้องตอบ 503 บอกว่าเป็นฝั่งระบบ', () => {
    assert.ok(routesSrc.includes('P2021') && routesSrc.includes('P2022'), 'ต้องจับ P2021/P2022');
    assert.ok(routesSrc.includes('schema mismatch'), 'ต้องตอบเป็น 503');
  });

  it('audit_logs.user_id ต้อง nullable + SetNull (DELETE user ต้องไม่ค้างจาก FK)', () => {
    assert.match(schemaSrc, /model AuditLog \{[\s\S]*?user_id\s+String\?/);
    assert.match(schemaSrc, /onDelete:\s*SetNull/);
  });

  it('ensure-prisma-client.sh ต้องถูกเรียกก่อน boot (กัน client/schema ไม่ตรง)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.match(pkg.scripts.dev, /ensure-prisma-client/);
  });
});
