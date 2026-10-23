#!/usr/bin/env node
// กัน migration พังเงียบจาก UTF-8 BOM
// เคสจริง 23/10/69: migration 20261023150000_fleet_persisted_model ถูกเขียนด้วย
// PowerShell `-Encoding UTF8` (มี BOM) → PostgreSQL ตอบ syntax error ที่ตำแหน่ง 1
// ก่อน SQL บรรทัดแรกจะรัน และ Prisma ต้อง resolve rolled-back ก่อน deploy ใหม่
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = path.join(ROOT, 'sovereign-os', 'core-api', 'prisma', 'migrations');
const BOM = [0xef, 0xbb, 0xbf];

function migrationSqlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...migrationSqlFiles(abs));
    else if (entry.isFile() && entry.name === 'migration.sql') out.push(abs);
  }
  return out.sort();
}

test('migration SQL ห้ามเริ่มด้วย UTF-8 BOM', () => {
  const files = migrationSqlFiles(MIGRATIONS);
  assert.ok(files.length > 0, `ไม่พบ migration.sql ใต้ ${MIGRATIONS}`);
  for (const file of files) {
    const head = [...fs.readFileSync(file).subarray(0, 3)];
    assert.notDeepEqual(
      head,
      BOM,
      `${path.relative(ROOT, file)} เริ่มด้วย UTF-8 BOM — PostgreSQL จะ syntax error ก่อน SQL บรรทัดแรก; ` +
        'เขียนไฟล์ใหม่แบบ UTF-8 without BOM',
    );
  }
});
