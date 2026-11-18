// RBAC single source of truth — static guard
//
// ปัญหาจริงที่เจอ (16/11/69): ชุด role ถูกประกาศซ้ำ 14 ที่ (ชื่อต่างกัน: WRITE_ROLES,
// RELAY_WRITE_ROLES, EVENT_WRITE_ROLES, DELETE_ROLES, DEVICE_WRITE_ROLES, VALID_ROLES)
// และมี requireRole('SUPERADMIN') เขียนสด 128 จุด ⇒ แต่ละโมดูลมีสิทธิ์ของตัวเองแบบเงียบ ๆ
// ซึ่งเป็นรากของ SEC-047 (device PUT ไม่มี role gate) และ SEC-048 (actuation เปิด SITE_ADMIN)
//
// เทสต์นี้เป็น "ตาข่าย" ไม่ใช่ unit test ของฟังก์ชัน: มันอ่านซอร์สจริงทั้ง src/ แล้วล้ม
// ทันทีที่โมดูลกลับไปประกาศ role array เอง หรือเขียน requireRole(...) ด้วย literal
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROLES,
  SUPERADMIN_ONLY,
  ADMIN_ROLES,
  WRITE_ROLES,
  SITE_WRITE_ROLES,
  ASSIGNABLE_ROLES,
} from '../src/lib/roles';

const SRC = path.join(process.cwd(), 'src');
const ROLES_FILE = path.join(SRC, 'lib', 'roles.ts');
const ROLE_NAME_RE = /^'[A-Z][A-Z_]*'$/;

export interface Finding {
  file: string;
  line: number;
  kind: 'declaration' | 'inline-requireRole';
  code: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * หา "role array ที่ประกาศเอง" และ "requireRole ที่เขียน literal สด"
 * รับรายการไฟล์เข้ามาเพื่อให้เทสต์ป้อนของปลอมได้ (พิสูจน์ว่าตัวจับไม่ตาบอด)
 */
export function findRoleDuplicates(files: Array<{ file: string; text: string }>): Finding[] {
  const findings: Finding[] = [];
  for (const { file, text } of files) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // ประกาศ array ของ role ในไฟล์โมดูล (เช่น const WRITE_ROLES = ['SUPERADMIN', ...])
      const decl = line.match(/(?:^|\s)(?:export\s+)?const\s+\w*ROLES?\s*(?::[^=\n]*)?=\s*\[([^\]\n]*)\]/);
      if (decl) {
        const tokens = [...decl[1].matchAll(/'[^']*'/g)].map((m) => m[0]);
        const looksLikeRoles = tokens.length > 0 && tokens.every((t) => ROLE_NAME_RE.test(t));
        if (looksLikeRoles) findings.push({ file, line: i + 1, kind: 'declaration', code: line.trim() });
      }
      // requireRole('A', 'B') — ต้องเป็น requireRole(...CONST) เท่านั้น
      if (/requireRole\(\s*'[A-Z][A-Z_]*'/.test(line)) {
        findings.push({ file, line: i + 1, kind: 'inline-requireRole', code: line.trim() });
      }
    });
  }
  return findings;
}

test('ไม่มีโมดูลไหนประกาศ role array เอง — ทุกอย่างมาจาก src/lib/roles', () => {
  const files = walk(SRC)
    .filter((f) => f !== ROLES_FILE)
    .map((file) => ({ file: path.relative(SRC, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }));
  const findings = findRoleDuplicates(files);
  const report = findings.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.code}`).join('\n');
  assert.equal(findings.length, 0, `พบ role ที่ประกาศเอง/เขียนสด ${findings.length} จุด:\n${report}`);
});

test('ตัวจับต้องไม่ตาบอด — ไฟล์ปลอมที่ประกาศ role array ต้องถูกจับ', () => {
  const findings = findRoleDuplicates([
    { file: 'fake.routes.ts', text: "const WRITE_ROLES = ['SUPERADMIN', 'OPERATOR'];" },
    { file: 'fake2.routes.ts', text: "router.post('/', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), h);" },
  ]);
  assert.equal(findings.filter((f) => f.kind === 'declaration').length, 1);
  assert.equal(findings.filter((f) => f.kind === 'inline-requireRole').length, 1);
});

test('ตัวจับไม่กล่าวหาของที่ไม่ใช่ role (array ของ object ยังผ่าน)', () => {
  const findings = findRoleDuplicates([
    { file: 'ok.ts', text: "const DEFAULT_ROLES = [{ name: 'ผู้ดูแล', emoji: '💧' }];" },
    { file: 'ok2.ts', text: "const SPECIES = ['POULTRY', 'SWINE'];" },
    { file: 'ok3.ts', text: "router.post('/', authenticate, requireRole(...WRITE_ROLES), h);" },
  ]);
  assert.deepEqual(findings, []);
});

test('ชุด role กลางมีสมาชิกตามที่ตกลง (WRITE_ROLES = SUPERADMIN/NODE_ADMIN/OPERATOR)', () => {
  assert.deepEqual([...SUPERADMIN_ONLY], ['SUPERADMIN']);
  assert.deepEqual([...ADMIN_ROLES], ['SUPERADMIN', 'NODE_ADMIN']);
  assert.deepEqual([...WRITE_ROLES], ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR']);
  assert.deepEqual([...SITE_WRITE_ROLES], ['SUPERADMIN', 'NODE_ADMIN', 'SITE_ADMIN', 'OPERATOR']);
  assert.deepEqual([...ASSIGNABLE_ROLES], ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN']);
});

test('SITE_ADMIN ต้องไม่อยู่ใน WRITE_ROLES (บทเรียน SEC-048)', () => {
  assert.equal((WRITE_ROLES as readonly string[]).includes('SITE_ADMIN'), false);
  assert.equal((SITE_WRITE_ROLES as readonly string[]).includes('SITE_ADMIN'), true);
});

test('ROLES ตรงกับ Prisma enum Role (ไม่มี role ที่หลุดจาก schema)', () => {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    assert.ok(true, 'ไม่มี prisma/schema.prisma ในที่นี้ — ข้าม');
    return;
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const block = schema.match(/enum\s+Role\s*\{([^}]*)\}/);
  assert.ok(block, 'ต้องมี enum Role ใน schema.prisma');
  const enumRoles = block![1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
  assert.deepEqual([...enumRoles].sort(), [...ROLES].sort());
});
