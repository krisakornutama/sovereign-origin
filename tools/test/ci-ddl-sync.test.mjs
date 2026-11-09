// tools/test/ci-ddl-sync.test.mjs — arch-gate: DDL ที่ CI ใช้ต้องตรงกับ Prisma schema
//
// ทำไมต้องมี:
//   `sensor_telemetry` ถูกประกาศ `@@ignore` (hypertable ที่ Prisma จัดการไม่ได้) → `prisma db push`
//   ไม่สร้างให้ CI จึงต้องมี scripts/ci-timescale-ignored.sql
//   ถ้ามีคนแก้ field ใน model SensorTelemetry แล้วลืมแก้ SQL (หรือกลับกัน) เทสต์นี้ต้องพังทันที
//   ไม่ปล่อยให้ CI สร้างตารางคนละหน้าตากับที่ PrismaClient คาดหวัง
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_API = path.join(ROOT, 'sovereign-os', 'core-api');
const SCHEMA_PATH = path.join(CORE_API, 'prisma', 'schema.prisma');
const SQL_PATH = path.join(CORE_API, 'scripts', 'ci-timescale-ignored.sql');
const MODEL = 'SensorTelemetry';
const TABLE = 'sensor_telemetry';

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
]);

// Prisma scalar → PostgreSQL type ที่ใช้ในไฟล์ SQL ของ CI
function pgType({ type, attrs }) {
  if (type === 'DateTime') return 'TIMESTAMPTZ';
  if (type === 'String') return /@db\.Uuid\b/.test(attrs) ? 'UUID' : 'TEXT';
  if (type === 'Float') return 'DOUBLE PRECISION';
  if (type === 'Int') return 'INTEGER';
  if (type === 'Boolean') return 'BOOLEAN';
  if (type === 'Json') return 'JSONB';
  throw new Error(`ยังไม่มี mapping ของ Prisma type "${type}" — เพิ่มใน pgType() ก่อน`);
}

function parseSchemaColumns() {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const block = schema.match(new RegExp(`model ${MODEL} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(block, `ไม่พบ model ${MODEL} ใน prisma/schema.prisma`);

  const columns = new Map();
  for (const rawLine of block[1].split('\n')) {
    const line = rawLine.split('//')[0].trim();
    if (!line || line.startsWith('@@') || line.startsWith('}')) continue;
    const [name, type, ...attrParts] = line.split(/\s+/);
    if (!name || !type) continue;
    // field ที่เป็น relation (เช่น `node Node @relation(...)`) ไม่ใช่คอลัมน์ในตาราง
    if (!SCALARS.has(type)) continue;
    const attrs = attrParts.join(' ');
    const mapped = /@map\("([^"]+)"\)/.exec(attrs);
    columns.set(mapped ? mapped[1] : name, pgType({ type, attrs }));
  }
  return columns;
}

function parseSqlColumns() {
  const sql = readFileSync(SQL_PATH, 'utf8');
  const create = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS "${TABLE}" \\(([\\s\\S]*?)\\n\\);`)
  );
  assert.ok(create, `ไม่พบ CREATE TABLE "${TABLE}" ใน scripts/ci-timescale-ignored.sql`);

  const columns = new Map();
  for (const rawLine of create[1].split('\n')) {
    const line = rawLine.split('--')[0].trim().replace(/,$/, '');
    const match = /^"([^"]+)"\s+([A-Z][A-Z ()0-9]*)$/.exec(line);
    if (!match) continue;
    // ตัด constraint ออก เหลือแค่ชนิดข้อมูล เช่น "TIMESTAMPTZ NOT NULL" → "TIMESTAMPTZ"
    const type = match[2]
      .replace(/\b(NOT NULL|NULL|PRIMARY KEY|UNIQUE)\b/g, '')
      .replace(/\bDEFAULT\b[\s\S]*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    columns.set(match[1], type);
  }
  return columns;
}

test('schema.prisma (SensorTelemetry) กับ scripts/ci-timescale-ignored.sql มีคอลัมน์/types ตรงกัน', () => {
  const fromSchema = parseSchemaColumns();
  const fromSql = parseSqlColumns();

  assert.ok(fromSchema.size > 0, 'parse schema ไม่ได้คอลัมน์เลย');
  assert.deepEqual(
    [...fromSql.keys()].sort(),
    [...fromSchema.keys()].sort(),
    'รายชื่อคอลัมน์ไม่ตรงกัน — แก้ scripts/ci-timescale-ignored.sql ให้ตรงกับ schema.prisma'
  );

  for (const [column, expectedType] of fromSchema) {
    assert.equal(
      fromSql.get(column),
      expectedType,
      `type ของคอลัมน์ "${column}" ไม่ตรง (schema=${expectedType}, sql=${fromSql.get(column)})`
    );
  }
});

test('SQL ของ CI ยังคง TimescaleDB hypertable + FK ไป nodes ไว้ครบ', () => {
  const sql = readFileSync(SQL_PATH, 'utf8');

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS timescaledb;/, 'ต้องสร้าง extension ก่อนใช้ hypertable');
  assert.match(
    sql,
    new RegExp(`create_hypertable\\('${TABLE}', 'time'`),
    'ต้องแปลงตารางเป็น hypertable ตามเวลา'
  );
  assert.match(
    sql,
    new RegExp(`FOREIGN KEY \\("node_id"\\) REFERENCES "nodes"\\("id"\\)`),
    'ต้องมี FK node_id → nodes(id) เหมือน migration เดิม'
  );
});
