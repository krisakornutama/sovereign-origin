#!/usr/bin/env node
// Fleet Phase 3B — SITE_ADMIN (site-scoped, read-only) wiring guards.
//
// ทำไมต้องมีเทสต์นี้: พฤติกรรม "เห็นเฉพาะสาขาตัวเอง" อยู่ที่การต่อสายหลายไฟล์
// (schema → migration → middleware → route guard → service) ถ้าใครแก้ไฟล์ใดไฟล์หนึ่ง
// แล้วลืมอีกไฟล์ ผู้ใช้ SITE_ADMIN อาจเห็นทั้งฝูงหรือได้สิทธิ์เขียนโดยไม่มีใครรู้
// เทสต์นี้จึง verifies static wiring ไม่ต้องมี DB:
//   • enum/คอลัมน์/FK/index ใน schema + migration (ON DELETE SET NULL, ไม่มี BOM)
//   • auth middleware อ่าน assigned_site_id จาก DB ทุก request (ทั้ง authenticate/partial)
//   • ทุก route ของ fleet มี guard ชัดเจน และเส้นเขียนเป็น SUPERADMIN เท่านั้น
//   • /overview ถูกกรองด้วย scope, /audit ส่ง machineIds
//   • users.routes ยอมรับ SITE_ADMIN + ตรวจสาขาก่อนผูก + bump token_version
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const BACKEND = 'sovereign-os/core-api';
const SCHEMA = `${BACKEND}/prisma/schema.prisma`;
const MIGRATION = `${BACKEND}/prisma/migrations/20261024130000_site_admin_role/migration.sql`;
const SCOPE = `${BACKEND}/src/services/fleet-scope.service.ts`;
const ROUTES = `${BACKEND}/src/modules/fleet/fleet.routes.ts`;
const AUDIT = `${BACKEND}/src/services/audit.service.ts`;
const AUTH_MW = `${BACKEND}/src/middleware/auth.middleware.ts`;
const USERS = `${BACKEND}/src/modules/users/users.routes.ts`;

function modelBlock(name) {
  const src = read(SCHEMA);
  const start = src.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `ไม่พบ model ${name} ใน schema.prisma`);
  const end = src.indexOf('\n}', start);
  assert.ok(end > start, `อ่าน model ${name} ไม่ครบ`);
  return src.slice(start, end);
}

function enumBlock(name) {
  const src = read(SCHEMA);
  const start = src.indexOf(`enum ${name} {`);
  assert.ok(start >= 0, `ไม่พบ enum ${name} ใน schema.prisma`);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end);
}

/** ตัดเฉพาะเส้นทางหนึ่งจากไฟล์ routes (ถึงเส้นถัดไป) เพื่อไม่ให้ตรวจข้ามเส้น */
function routeSection(source, needle) {
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `ไม่พบเส้น ${needle}`);
  const next = source.indexOf('\nrouter.', start + needle.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('schema + migration — SITE_ADMIN มีของจริงรองรับ', () => {
  test('Role enum มี SITE_ADMIN', () => {
    const block = enumBlock('Role');
    assert.match(block, /^\s*SITE_ADMIN\b/m, 'ต้องประกาศ SITE_ADMIN ใน enum Role');
  });

  test('User มี assigned_site_id + relation แบบ SetNull', () => {
    const user = modelBlock('User');
    assert.match(user, /^\s*assigned_site_id\s+String\?\s+@db\.Uuid/m);
    assert.match(
      user,
      /assigned_site\s+FleetSite\?\s+@relation\("SiteAdmins",\s*fields:\s*\[assigned_site_id\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
      'ลบสาขาแล้วต้อง SetNull (ผู้ใช้หลุดขอบเขต) ไม่ใช่ลบผู้ใช้ตาม',
    );
  });

  test('FleetSite มีปลายทางของ relation (admins)', () => {
    const site = modelBlock('FleetSite');
    assert.match(site, /admins\s+User\[\]\s+@relation\("SiteAdmins"\)/);
  });

  test('migration: ไม่มี BOM, เพิ่ม enum, คอลัมน์, index, FK SET NULL', () => {
    assert.ok(exists(MIGRATION), `ไม่พบ migration ${MIGRATION}`);
    const sql = read(MIGRATION);
    assert.ok(!sql.startsWith('\uFEFF'), 'migration.sql ต้องไม่มี BOM (psql/prisma อ่านพลาดได้)');
    assert.match(sql, /ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SITE_ADMIN';/);
    assert.match(sql, /ALTER TABLE "users" ADD COLUMN "assigned_site_id" UUID;/);
    assert.match(sql, /CREATE INDEX "users_assigned_site_id_idx" ON "users"\("assigned_site_id"\);/);
    assert.match(
      sql,
      /FOREIGN KEY \("assigned_site_id"\) REFERENCES "fleet_sites"\("id"\) ON DELETE SET NULL/,
    );
  });

  test('migration ไม่ใช้ค่า enum ใหม่ในไฟล์เดียวกัน (Postgres ไม่อนุญาตใน transaction เดียว)', () => {
    const sql = read(MIGRATION);
    const uses = sql.split(/\r?\n/).filter(
      (line) => !line.trim().startsWith('--') && /'SITE_ADMIN'/.test(line),
    );
    assert.equal(uses.length, 1, `ใช้ 'SITE_ADMIN' ได้เฉพาะบรรทัด ADD VALUE (พบ ${uses.length} บรรทัด)`);
  });
});

describe('fleet-scope.service — fail closed', () => {
  const src = read(SCOPE);

  test('บทบาทที่ผ่านประตูมีแค่ SUPERADMIN + SITE_ADMIN', () => {
    assert.match(src, /FLEET_READ_ROLES\s*=\s*\['SUPERADMIN',\s*'SITE_ADMIN'\]/);
  });

  test('มีรหัสข้อผิดพลาดแยกกรณี ไม่มีสาขา / สาขาหาย', () => {
    assert.match(src, /'SITE_SCOPE_MISSING'/);
    assert.match(src, /'SITE_SCOPE_UNKNOWN'/);
  });

  test('กรอง overview แล้วคิด summary/channels ใหม่ (ไม่ปล่อยตัวเลขทั้งระบบ)', () => {
    assert.match(src, /export function filterFleetOverviewForScope/);
    assert.match(src, /const summary = \{/);
    assert.match(src, /const channels = overview\.channels\.map/);
  });
});

describe('auth middleware — อ่านสาขาจาก DB ทุก request', () => {
  const mw = read(AUTH_MW);

  test('type ของ req.user มี assigned_site_id', () => {
    assert.match(mw, /assigned_site_id\?: string \| null/);
  });

  test('select assigned_site_id ทั้ง authenticate และ authenticatePartial', () => {
    const selects = mw.match(/assigned_site_id: true/g) ?? [];
    assert.equal(selects.length, 2, 'ต้อง select ในทั้งสองฟังก์ชัน (ไม่งั้น token เก่าจะเห็นข้อมูลเก่า)');
  });

  test('ส่งค่าลง req.user ทั้งสองฟังก์ชัน', () => {
    const assigns = mw.match(/assigned_site_id: dbUser\.assigned_site_id \?\? null/g) ?? [];
    assert.equal(assigns.length, 2);
  });
});

describe('fleet.routes — guard รายเส้น', () => {
  const src = read(ROUTES);

  test('ไม่ใช้ router.use(authenticate, requireRole(...)) ทั้งโมดูลอีก', () => {
    assert.ok(!/router\.use\(\s*authenticate\s*,\s*requireRole/.test(src), 'ต้องแยกสิทธิ์รายเส้น');
    assert.match(src, /router\.use\(authenticate\);/);
  });

  test('ทุก route มี guard readOnly หรือ superOnly', () => {
    const lines = src.split(/\r?\n/).filter((line) => /^router\.(get|post|put|patch|delete)\(/.test(line));
    assert.ok(lines.length >= 10, `คาดว่ามีอย่างน้อย 10 เส้น (พบ ${lines.length})`);
    for (const line of lines) {
      assert.match(line, /\b(readOnly|superOnly)\b/, `route ไม่มี guard: ${line.trim()}`);
    }
  });

  test('เส้นอ่านอนุญาต SITE_ADMIN', () => {
    for (const needle of [
      "router.get('/overview', readOnly",
      "router.get('/policy', readOnly",
      "router.get('/sites', readOnly",
      "router.get('/groups', readOnly",
      "router.get('/audit', readOnly",
    ]) {
      assert.ok(src.includes(needle), `ขาด guard: ${needle}`);
    }
  });

  test('เส้นเขียน/จัดการกุญแจเป็น SUPERADMIN เท่านั้น', () => {
    for (const needle of [
      "router.put('/policy', superOnly",
      "router.get('/enroll-tokens', superOnly",
      "router.post('/enroll-tokens', superOnly",
      "router.post('/enroll-tokens/:id/revoke', superOnly",
      "router.put('/machines/:id', superOnly",
      "router.post('/machines/:id/rotate-token', superOnly",
    ]) {
      assert.ok(src.includes(needle), `ขาด guard: ${needle}`);
    }
  });

  test('/overview ถูกกรองด้วย scope ก่อนตอบ', () => {
    const section = routeSection(src, "router.get('/overview'");
    assert.match(section, /scopeOf\(req, res\)/);
    assert.match(section, /filterFleetOverviewForScope\(/);
  });

  test('/sites และ /groups ใช้รายการที่จำกัดสาขา', () => {
    assert.match(routeSection(src, "router.get('/sites'"), /listFleetSitesScoped\(siteIdOfScope\(scope\)\)/);
    assert.match(routeSection(src, "router.get('/groups'"), /listFleetGroupsScoped\(siteIdOfScope\(scope\)\)/);
  });

  test('/audit ส่ง machineIds ลง service', () => {
    const section = routeSection(src, "router.get('/audit'");
    assert.match(section, /machineIdsForScope\(/);
    assert.match(section, /machineIds,\s*\n\s*\}\);/);
  });

  test('scopeOf ปฏิเสธเมื่อ resolve ไม่ผ่าน และไม่เรียก DB เมื่อเป็น SUPERADMIN', () => {
    assert.match(src, /async function scopeOf[\s\S]*?if \(!resolved\.ok\)[\s\S]*?return null;/);
    assert.match(src, /req\.user\?\.role === 'SITE_ADMIN' && assigned \? await getFleetSiteById\(assigned\) : null/);
  });
});

describe('audit.service — กรองตามเครื่องในขอบเขต', () => {
  const src = read(AUDIT);

  test('รับ machineIds และตีความ [] ว่า "ไม่เห็นอะไร"', () => {
    assert.match(src, /machineIds\?: string\[\] \| null/);
    assert.match(src, /if \(allowed && allowed\.length === 0\) return \[\];/);
  });

  test('ขอเครื่องนอกขอบเขตแล้วตอบว่าง (ไม่ยืนยันว่ามีเครื่องนั้น)', () => {
    assert.match(src, /if \(allowed && requested && !allowed\.includes\(requested\)\) return \[\];/);
  });
});

describe('agent-machines routes — กัน SITE_ADMIN หลุดขอบเขต', () => {
  const AGENT_MACHINES = `${BACKEND}/src/modules/agent-machines/agent-machines.routes.ts`;

  test('SITE_ADMIN ถูกปฏิเสธก่อนถึงเส้นรายการเครื่อง', () => {
    const src = read(AGENT_MACHINES);
    const lines = src.split(/\r?\n/);
    // GET / เปิดให้ทุก role ที่ล็อกอิน (เดิมออกแบบให้ OPERATOR ใช้) — ถ้าไม่กัน SITE_ADMIN
    // บทบาทนี้จะเห็นเครื่อง/IP ของทุกสาขา ซึ่งขัดกับเจตนาของ Phase 3B
    const guard = lines.findIndex((line) => /req\.user\?\.role === 'SITE_ADMIN'/.test(line));
    const listRoute = lines.findIndex((line) => /^router\.get\('\/', authenticate/.test(line));
    assert.ok(guard >= 0, 'ต้องมี guard ปฏิเสธ SITE_ADMIN ในโมดูล agent-machines');
    assert.ok(listRoute >= 0, 'ไม่พบเส้น GET / (รายการเครื่อง)');
    assert.ok(guard < listRoute, 'guard ต้องอยู่ก่อนเส้นรายการเครื่อง (Express เรียงตามลำดับประกาศ)');
    assert.match(src, /SITE_SCOPE_FLEET_ONLY/);
  });
});

describe('users.routes — ผูกสาขาได้อย่างปลอดภัย', () => {
  const src = read(USERS);

  test('ยอมรับ role SITE_ADMIN', () => {
    assert.match(src, /VALID_ROLES = \[[^\]]*'SITE_ADMIN'/);
  });

  test('ตรวจสาขาผ่าน service ของ fleet (ไม่ query ตาราง fleet_* เอง)', () => {
    assert.match(src, /import \{ getFleetSiteById \} from '\.\.\/\.\.\/services\/fleet-persistence\.service';/);
    assert.ok(!/prisma\.fleet(Site|Group|MachineOverride|Setting)/.test(src), 'โมดูล users ต้องไม่แตะตาราง fleet_*');
  });

  test('กำหนดสาขาแล้วต้อง bump token_version (สิทธิ์เก่าตายทันที)', () => {
    const section = routeSection(src, "router.put('/:id'");
    assert.match(section, /assigned_site_id !== undefined/);
    assert.match(section, /data\.token_version = \{ increment: 1 \}/);
  });

  test('รายการผู้ใช้ส่ง assigned_site_id ให้ผู้ดูแลเห็น', () => {
    assert.match(src, /assigned_site_id: true/);
  });
});
