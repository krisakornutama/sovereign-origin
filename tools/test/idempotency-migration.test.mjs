#!/usr/bin/env node
// Idempotency keys (central) — migration/schema guards.
// กันการแก้ schema จนเสีย semantics ที่ออกแบบไว้ (27/10/69):
//   • 1 แถว = 1 คีย์ของ 1 scope · unique (scope, key) เป็นด่านกันซ้ำชั้นสุดท้าย
//     (ถ้าหลุดด่านนี้ = เน็ตหลุดแล้วขายซ้ำ ได้ของซ้ำ/เงินซ้ำ)
//   • ไม่มี FK ไป users — ลบผู้ใช้ต้องไม่ทำให้ "ผลที่ replay ได้" หายไป
//     (userId เป็น TEXT เพราะ id ใน test/ระบบอื่นอาจไม่ใช่ uuid)
//   • expiresAt ต้องมี index — prune วิ่งทุกครั้งที่เริ่มทำงาน
//   • migration ต้องไม่มี BOM (Postgres syntax error → migrate deploy ค้าง)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const MIGRATIONS_DIR = 'sovereign-os/core-api/prisma/migrations';
// migration chain เดิมถูก squash เป็น baseline (20261107190000) — ไฟล์ต้นทางเก็บไว้ที่ migrations_archive
const ARCHIVE_DIR = 'sovereign-os/core-api/prisma/migrations_archive';
const MIGRATION = `${ARCHIVE_DIR}/20261027120000_idempotency_keys/migration.sql`;
const SCHEMA = 'sovereign-os/core-api/prisma/schema.prisma';
const OWNERS = 'tools/module-owners.json';

/** บรรทัดคอลัมน์ใน CREATE TABLE (ไม่ชนกับ index/constraint) */
function columnLine(sql, name) {
  const line = sql
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*"${name}"\\s`).test(l));
  assert.ok(line, `ไม่พบคอลัมน์ "${name}" ใน CREATE TABLE`);
  return line.trim();
}

/** ชื่อคอลัมน์ทั้งหมดใน CREATE TABLE (แถวที่ขึ้นต้นด้วย "..." และย่อหน้า 4 ช่องว่าง) */
function migrationColumns(sql) {
  const table = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');', sql.indexOf('CREATE TABLE')) + 2);
  return [...table.matchAll(/^\s{4}"([A-Za-z0-9_]+)"\s/gm)].map((m) => m[1]).sort();
}

/** ฟิลด์ทั้งหมดของ model (ตัด @@block และ relation-only ออกด้วยการเทียบกับ migration) */
function modelFields(schemaText, modelName) {
  const start = schemaText.indexOf(`model ${modelName}`);
  assert.ok(start >= 0, `ไม่พบ model ${modelName}`);
  const body = schemaText.slice(start, schemaText.indexOf('\n}', start) + 2);
  const fields = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*\/\//.test(line) || /^\s*@@/.test(line)) continue;
    const m = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s+[A-Za-z]/);
    if (m) fields.push(m[1]);
  }
  return { body, fields: fields.sort() };
}

describe('idempotency — migration', () => {
  test('migration มีอยู่ ไม่มี BOM และเริ่มด้วย comment SQL', () => {
    assert.ok(exists(MIGRATION), `ไม่พบ ${MIGRATION} — ต้อง commit ไฟล์ SQL (ห้ามรอ migrate dev สร้างให้)`);
    const bytes = fs.readFileSync(path.join(ROOT, MIGRATION));
    assert.notEqual(bytes[0], 0xef, 'ห้ามมี UTF-8 BOM');
    assert.ok(bytes.toString('utf8').trimStart().startsWith('--'), 'ควรเริ่มด้วย comment SQL');
  });

  test('สร้างตาราง idempotency_keys พร้อมคอลัมน์ camelCase ที่ quote ครบ', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /CREATE TABLE "idempotency_keys" \(/);
    for (const name of [
      'id',
      'scope',
      'key',
      'fingerprint',
      'status',
      'responseCode',
      'responseBody',
      'userId',
      'createdAt',
      'updatedAt',
      'expiresAt',
    ]) {
      columnLine(sql, name);
    }
  });

  test('ชนิดข้อมูล/default ตรงกับ Prisma model', () => {
    const sql = read(MIGRATION);
    assert.match(columnLine(sql, 'id'), /UUID NOT NULL/);
    assert.match(columnLine(sql, 'scope'), /TEXT NOT NULL/);
    assert.match(columnLine(sql, 'key'), /TEXT NOT NULL/);
    assert.match(columnLine(sql, 'fingerprint'), /TEXT NOT NULL/);
    assert.match(columnLine(sql, 'status'), /TEXT NOT NULL DEFAULT 'in_flight'/);
    assert.match(columnLine(sql, 'responseBody'), /JSONB/);
    assert.match(columnLine(sql, 'userId'), /TEXT/, 'userId = TEXT ไม่ใช่ UUID (id จาก test/ระบบอื่นอาจไม่ใช่ uuid)');
    assert.match(columnLine(sql, 'createdAt'), /TIMESTAMPTZ\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    assert.match(columnLine(sql, 'updatedAt'), /TIMESTAMPTZ\(6\) NOT NULL/);
    assert.match(columnLine(sql, 'expiresAt'), /TIMESTAMPTZ\(6\) NOT NULL/);
  });

  test('ผลลัพธ์/ผู้ใช้/รหัสผล ว่างได้ (แถว in_flight ยังไม่มีผล)', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(columnLine(sql, 'responseCode'), /NOT NULL/);
    assert.doesNotMatch(columnLine(sql, 'responseBody'), /NOT NULL/);
    assert.doesNotMatch(columnLine(sql, 'userId'), /NOT NULL/);
  });

  test('unique (scope, key) + index expiresAt ตรงชื่อที่ Prisma คาด', () => {
    const sql = read(MIGRATION);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"\("scope", "key"\)/,
      'unique ชั้นสุดท้าย — ถ้าหลุด ด่านกันซ้ำจะพังเงียบ ๆ',
    );
    assert.match(
      sql,
      /CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"\("expiresAt"\)/,
      'prune ต้องไม่สแกนทั้งตาราง',
    );
  });

  test('ไม่มี FOREIGN KEY — ลบผู้ใช้/ตารางอื่นต้องไม่ทำให้ผลที่ replay ได้หาย', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /FOREIGN KEY|REFERENCES/i);
    assert.doesNotMatch(sql, /ON DELETE/i);
  });

  test('ไม่แตะตาราง/ดัชนีของโมดูลอื่น', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /DROP\s+(TABLE|CONSTRAINT|INDEX|SCHEMA)\s+/i, 'ห้าม drop อะไรเลยใน migration ใหม่');
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+/i, 'ห้าม ALTER ตารางอื่น');
    assert.doesNotMatch(sql, /UPDATE\s+"?[a-z_]+"?\s+SET/i, 'ไม่ต้อง backfill');
  });

  test('มี migration เดียวที่สร้าง idempotency_keys (กัน migrate deploy ล้มเพราะสร้างซ้ำ)', () => {
    const dirs = fs
      .readdirSync(path.join(ROOT, MIGRATIONS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const creators = dirs.filter((dir) => {
      const file = path.join(ROOT, MIGRATIONS_DIR, dir, 'migration.sql');
      if (!fs.existsSync(file)) return false;
      return /CREATE TABLE "idempotency_keys"/.test(fs.readFileSync(file, 'utf8'));
    });
    // migration ที่ถูก apply จริงต้องมีตัวเดียวที่สร้างตารางนี้ (ของเดิมอยู่ใน archive แล้ว ไม่นับ)
    assert.equal(
      creators.length,
      1,
      `ต้องมี migration ที่ apply อยู่เพียงตัวเดียวที่สร้าง idempotency_keys (พบ ${creators.join(', ') || 'ไม่มี'})`
    );
  });
});

describe('idempotency — Prisma schema', () => {
  test('model IdempotencyKey ผูกตาราง + unique/index ตรงกับ migration', () => {
    const schema = read(SCHEMA);
    const { body } = modelFields(schema, 'IdempotencyKey');
    assert.match(body, /@@map\("idempotency_keys"\)/);
    assert.match(body, /@@unique\(\[scope, key\]\)/);
    assert.match(body, /@@index\(\[expiresAt\]\)/);
    assert.match(body, /status\s+String\s+@default\("in_flight"\)/);
    assert.match(body, /responseCode\s+Int\?/);
    assert.match(body, /responseBody\s+Json\?/);
    assert.match(body, /userId\s+String\?/);
    assert.match(body, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
  });

  test('คอลัมน์ใน migration ตรงกับฟิลด์ใน model (กัน drift สองทาง)', () => {
    const sql = read(MIGRATION);
    const { fields } = modelFields(read(SCHEMA), 'IdempotencyKey');
    assert.deepEqual(
      migrationColumns(sql),
      fields,
      'เจอความต่างระหว่าง schema.prisma กับ migration.sql — แก้ให้ตรงกันก่อน migrate',
    );
  });

  test('schema ไม่ประกาศ relation ไป User (ห้าม FK)', () => {
    const { body } = modelFields(read(SCHEMA), 'IdempotencyKey');
    assert.doesNotMatch(body, /@relation|references:/);
  });
});

describe('idempotency — module ownership', () => {
  test('idempotency_keys เป็นตาราง cross-cutting (ทุกโมดูลใช้ร่วมได้ ไม่ทำให้ arch-gate แดง)', () => {
    const owners = JSON.parse(read(OWNERS));
    assert.ok(
      (owners.sharedTables ?? []).includes('idempotency_keys'),
      'ต้องอยู่ใน tools/module-owners.json sharedTables — middleware กลางถูกเรียกจากหลายโมดูล',
    );
  });
});

describe('idempotency — service contract', () => {
  const SERVICE = 'sovereign-os/core-api/src/services/idempotency.service.ts';

  test('service แยก "ตารางหาย" (P2021) ออกจาก "DB ล่ม" — deploy ก่อน migrate ได้', () => {
    const service = read(SERVICE);
    assert.match(service, /P2021/);
    assert.match(service, /isMissingTableError/);
    assert.match(service, /isUniqueError/);
    assert.match(service, /P2002/);
  });

  test('ไม่ผูกกับผู้ให้บริการเสียเงิน (free-first)', () => {
    const service = read(SERVICE);
    assert.doesNotMatch(service, /\b(stripe|omise|slipok|easyslip)\b/i, 'ยังไม่ต่อผู้ให้บริการเสียเงิน');
  });
});
