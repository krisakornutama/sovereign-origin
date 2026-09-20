import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// เคสจริงจาก prod: Prisma client ใน container ถูก generate จากสคีมาเก่า (ก่อนมี token_version)
// → reset พังตอน runtime และ route กลืนเป็น "Reset failed" เงียบ ๆ / ลบ user ติด FK ค้าง
// ชุดนี้ล็อกสัญญาของการแก้ (pure — ไม่ต่อ DB):
//  1) route log จริง + ส่ง reason 2) schema: audit_logs.user_id nullable + SetNull 3) hook ก่อน boot

describe('password reset — runtime schema drift (เคสจริงจาก prod)', () => {
  const routesSrc = readFileSync('src/modules/users/users.routes.ts', 'utf8');
  const schemaSrc = readFileSync('prisma/schema.prisma', 'utf8');

  it('route log error จริง + แนบ reason ใน response (reset และ delete)', () => {
    assert.ok(routesSrc.includes("console.error('[reset-password] failed:'"));
    assert.ok(routesSrc.includes("console.error('[users:delete] failed:'"));
    assert.ok(routesSrc.includes('reason: err?.message'));
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
