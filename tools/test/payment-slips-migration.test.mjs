#!/usr/bin/env node
// Payment slips (free-first) — migration/schema guards.
// กันการแก้ migration จนเสีย semantics ที่พิสูจน์แล้วบน schema จริงของ production (24/10/69):
//   • sha256 ของภาพกันสลิปซ้ำ (unique ชั้นเดียว)
//   • (provider, transRef) กันสลิปซ้ำเฉพาะ provider เดียวกัน — transRef NULL ซ้ำได้
//     (สลิปที่กรอกมือไม่มีเลขอ้างอิง; Postgres ถือ NULL ต่างกัน)
//   • ลบร้าน = ลบสลิปตาม (Cascade) แต่ลบออเดอร์/ผู้ใช้ = เก็บสลิปไว้ (SetNull) เพื่อไม่ให้หลักฐานหาย
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const MIGRATIONS_DIR = 'sovereign-os/core-api/prisma/migrations';
const MIGRATION = `${MIGRATIONS_DIR}/20261023170000_payment_slips/migration.sql`;
const SCHEMA = 'sovereign-os/core-api/prisma/schema.prisma';

/** เอาเฉพาะบรรทัดคอลัมน์ใน CREATE TABLE เพื่อตรวจ NOT NULL / ชนิด โดยไม่ชนกับ FK/index */
function columnLine(sql, name) {
  const line = sql
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*"${name}"\\s`).test(l));
  assert.ok(line, `ไม่พบคอลัมน์ "${name}" ใน CREATE TABLE`);
  return line.trim();
}

describe('payment slips — migration', () => {
  test('migration มีอยู่และไม่มี BOM (BOM ทำ migrate ล้มบน Postgres)', () => {
    assert.ok(exists(MIGRATION), `ไม่พบ ${MIGRATION}`);
    const bytes = fs.readFileSync(path.join(ROOT, MIGRATION));
    assert.notEqual(bytes[0], 0xef, 'ห้ามมี UTF-8 BOM');
    assert.ok(bytes.toString('utf8').trimStart().startsWith('--'), 'ควรเริ่มด้วย comment SQL');
  });

  test('สร้างตาราง payment_slips พร้อมคอลัมน์ camelCase ที่ quote ครบ', () => {
    const sql = read(MIGRATION);
    assert.match(sql, /CREATE TABLE "payment_slips" \(/);
    for (const name of [
      'id',
      'businessId',
      'orderId',
      'provider',
      'transRef',
      'amountSatang',
      'currency',
      'status',
      'imageMime',
      'imageSha256',
      'imageSize',
      'imageData',
      'note',
      'uploadedBy',
      'reviewedBy',
      'reviewedAt',
      'reviewNote',
      'createdAt',
      'updatedAt',
    ]) {
      columnLine(sql, name);
    }
  });

  test('ชนิดข้อมูล/ค่า default ตรงกับ Prisma model', () => {
    const sql = read(MIGRATION);
    assert.match(columnLine(sql, 'businessId'), /UUID NOT NULL/);
    assert.match(columnLine(sql, 'amountSatang'), /INTEGER NOT NULL/);
    assert.match(columnLine(sql, 'imageData'), /BYTEA NOT NULL/);
    assert.match(columnLine(sql, 'imageSha256'), /TEXT NOT NULL/);
    assert.match(columnLine(sql, 'updatedAt'), /TIMESTAMPTZ\(6\) NOT NULL/);
    assert.match(columnLine(sql, 'provider'), /DEFAULT 'MANUAL'/);
    assert.match(columnLine(sql, 'currency'), /DEFAULT 'THB'/);
    assert.match(columnLine(sql, 'status'), /DEFAULT 'PENDING'/);
  });

  test('transRef ว่างได้ — ไม่งั้นสลิปที่ไม่มีเลขอ้างอิงจะบันทึกไม่ได้', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(columnLine(sql, 'transRef'), /NOT NULL/);
    assert.doesNotMatch(columnLine(sql, 'orderId'), /NOT NULL/);
  });

  test('unique กันสลิปซ้ำ: sha256 ภาพ + (provider, transRef)', () => {
    const sql = read(MIGRATION);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "payment_slips_imageSha256_key" ON "payment_slips"\("imageSha256"\)/,
      'ภาพเดิมต้องอัปโหลดซ้ำไม่ได้',
    );
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "payment_slips_provider_transRef_key" ON "payment_slips"\("provider", "transRef"\)/,
      'สลิปซ้ำต้องกันที่ระดับ provider + transRef',
    );
    // index ที่ service ใช้ filter ต้องมี ไม่งั้นรายการสลิปร้านจะสแกนทั้งตาราง
    assert.match(sql, /CREATE INDEX "payment_slips_businessId_status_createdAt_idx"/);
    assert.match(sql, /CREATE INDEX "payment_slips_orderId_idx"/);
  });

  test('FK: ลบร้าน = ลบสลิป (Cascade) แต่ลบออเดอร์/ผู้ใช้ = เก็บสลิป (SetNull)', () => {
    const sql = read(MIGRATION);
    assert.match(
      sql,
      /"payment_slips_businessId_fkey"[\s\S]*?REFERENCES "businesses"\("id"\) ON DELETE CASCADE/,
      'businessId ต้อง Cascade',
    );
    assert.match(
      sql,
      /"payment_slips_orderId_fkey"[\s\S]*?REFERENCES "business_orders"\("id"\) ON DELETE SET NULL/,
      'orderId ต้อง SetNull (หลักฐานการจ่ายต้องไม่หายตามออเดอร์)',
    );
    assert.match(
      sql,
      /"payment_slips_uploadedBy_fkey"[\s\S]*?REFERENCES "users"\("id"\) ON DELETE SET NULL/,
    );
    assert.match(
      sql,
      /"payment_slips_reviewedBy_fkey"[\s\S]*?REFERENCES "users"\("id"\) ON DELETE SET NULL/,
    );
  });

  test('ไม่แตะตาราง/ดัชนีของโมดูลอื่น', () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /DROP\s+(TABLE|CONSTRAINT|INDEX)\s+"(?!payment_slips)/i, 'ห้าม drop ของโมดูลอื่น');
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"(?!payment_slips")/i, 'ห้าม ALTER ตารางอื่น');
  });

  test('มี migration เดียวที่สร้าง payment_slips (กันสร้างซ้ำจน migrate deploy ล้ม)', () => {
    const dirs = fs
      .readdirSync(path.join(ROOT, MIGRATIONS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => name !== 'migration_lock.toml');
    const creators = dirs.filter((dir) => {
      const file = path.join(ROOT, MIGRATIONS_DIR, dir, 'migration.sql');
      if (!fs.existsSync(file)) return false;
      return /CREATE TABLE "payment_slips"/.test(fs.readFileSync(file, 'utf8'));
    });
    assert.deepEqual(creators, ['20261023170000_payment_slips']);
  });
});

describe('payment slips — Prisma schema', () => {
  test('model PaymentSlip ผูกกับตาราง payment_slips และมี unique ตรงกับ migration', () => {
    const schema = read(SCHEMA);
    assert.match(schema, /model\s+PaymentSlip\s*\{/);
    const model = schema.slice(schema.indexOf('model PaymentSlip'));
    const body = model.slice(0, model.indexOf('\n}') + 2);
    assert.match(body, /@@map\("payment_slips"\)/);
    assert.match(body, /@@unique\(\[provider, transRef\]\)/);
    assert.match(body, /imageSha256\s+String\s+@unique/);
    assert.match(body, /transRef\s+String\?/, 'transRef ต้องเป็น optional');
    assert.match(body, /onDelete: Cascade/);
    assert.match(body, /onDelete: SetNull/, 'order/uploader/reviewer ต้อง SetNull');
  });

  test('บริการ/เส้นทางสลิปอ้างชื่อตารางและ adapter แบบ MANUAL เท่านั้น (free-first)', () => {
    const service = read('sovereign-os/core-api/src/services/payment-slip.service.ts');
    assert.match(service, /MANUAL/, 'ต้องมี adapter MANUAL');
    assert.doesNotMatch(
      service,
      /slipok|slip\.ok|easyslip|ndid/i,
      'ยังไม่ถึงรอบผู้ให้บริการเสียเงิน — ห้ามต่อ شبکهกับผู้ให้บริการอ่านสลิป',
    );
    assert.match(service, /imageSha256|sha256/, 'ต้องแฮชภาพเพื่อ dedupe');
  });
});
