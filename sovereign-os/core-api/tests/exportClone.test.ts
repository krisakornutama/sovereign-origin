// TDD: Export & Clone — เลือกฟังก์ชั่นที่อยากถอดแบบ → ส่งออกแพ็กเกจ → นำเข้าเครื่องอื่น
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_MANIFEST,
  resolveModules,
  dumpModuleData,
  applyPackage,
  buildExportPackage,
  validatePackage,
} from '../src/services/export-clone.service';

test('MODULE_MANIFEST lists all cloneable modules', () => {
  assert.ok(MODULE_MANIFEST.length >= 8);
  const keys = MODULE_MANIFEST.map((m) => m.key);
  for (const k of ['knowledge', 'kids', 'vision', 'agent', 'farm', 'property', 'firewall', 'automation']) {
    assert.ok(keys.includes(k), `manifest ควรมี ${k}`);
  }
  assert.ok(MODULE_MANIFEST.every((m) => m.tables.length > 0));
});

test('resolveModules maps checkbox keys to manifest entries', () => {
  const all = resolveModules(['knowledge', 'vision']);
  assert.equal(all.length, 2);
});

test('dumpModuleData collects rows per table with type preservation', async () => {
  const prismaLike = {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('"knowledge_items"')) return [{ id: 'k1', title: 'คู่มือ', created_at: new Date('2026-08-01') }];
      if (sql.includes('"known_faces"')) return [{ id: 'f1', name: 'พ่อ' }];
      return [];
    },
  };
  const data = await dumpModuleData(['knowledge', 'vision'], prismaLike as any);
  const knowledge = data.find((m) => m.key === 'knowledge');
  assert.ok(knowledge);
  const items = knowledge.tables.find((t) => t.table === 'knowledge_items');
  assert.ok(items && items.rows.length === 1);
  assert.equal(items.rows[0].title, 'คู่มือ');
});

test('buildExportPackage wraps version, generatedAt, modules, appInfo', async () => {
  const pkg = await buildExportPackage(['firewall'], { appName: 'SOVEREIGN OS' });
  assert.equal(pkg.version, 1);
  assert.ok(pkg.generatedAt);
  assert.equal(pkg.appInfo.appName, 'SOVEREIGN OS');
  assert.ok(Array.isArray(pkg.modules));
  assert.ok(pkg.modules[0].key === 'firewall');
});

test('validatePackage rejects packages with wrong version or missing modules', () => {
  assert.equal(validatePackage({ version: 1, modules: [] } as any), null);
  assert.ok(validatePackage({ version: 99, modules: [] } as any)?.includes('เวอร์ชัน'));
  assert.ok(validatePackage(null as any)?.length > 0);
});

test('applyPackage restores rows into the target DB', async () => {
  const calls: string[] = [];
  const prismaLike = {
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return 1; },
    $queryRawUnsafe: async (sql: string) =>
      sql.includes('information_schema')
        ? [{ column_name: 'id' }, { column_name: 'name' }, { column_name: 'action' }]
        : [],
  };
  const pkg = {
    version: 1,
    modules: [
      {
        key: 'firewall',
        tables: [
          { table: 'firewall_rules', rows: [{ id: 'r1', name: 'block-x', action: 'DENY' }] },
        ],
      },
    ],
  };
  const result = await applyPackage(pkg, prismaLike as any);
  assert.ok(result.ok);
  assert.equal(result.restoredTables, 1);
  assert.ok(calls.some((c) => c.includes('TRUNCATE')));
  assert.ok(calls.some((c) => c.includes('INSERT')));
});

test('applyPackage rejects table identifiers that are not safe (SQL injection guard)', async () => {
  const calls: string[] = [];
  const prismaLike = {
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return 1; },
    $queryRawUnsafe: async () => [],
  };
  const evil = {
    version: 1,
    modules: [
      {
        key: 'x',
        tables: [{ table: 'users"; DROP TABLE kid_profiles; --', rows: [{ id: '1' }] }],
      },
    ],
  };
  const result = await applyPackage(evil, prismaLike as any);
  assert.equal(result.ok, false);
  assert.equal(result.restoredTables, 0);
  assert.equal(calls.length, 0, 'ต้องไม่มีการรัน SQL ใด ๆ เลย');
});

test('applyPackage rejects unsafe column names from row keys', async () => {
  const calls: string[] = [];
  const prismaLike = {
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return 1; },
    $queryRawUnsafe: async () => [],
  };
  const evil = {
    version: 1,
    modules: [
      {
        key: 'x',
        tables: [{ table: 'firewall_rules', rows: [{ 'id"; DROP TABLE users; --': '1' }] }],
      },
    ],
  };
  const result = await applyPackage(evil, prismaLike as any);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('applyPackage on an older-schema target restores only existing columns (no wipe-and-fail)', async () => {
  const calls: string[] = [];
  const prismaLike = {
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return 1; },
    $queryRawUnsafe: async () => [{ column_name: 'id' }], // เป้าหมาย schema เก่า มีแค่ id
  };
  const pkg = {
    version: 1,
    modules: [
      {
        key: 'firewall',
        tables: [
          { table: 'firewall_rules', rows: [{ id: 'r1', name: 'block-x', action: 'DENY' }] },
        ],
      },
    ],
  };
  const result = await applyPackage(pkg, prismaLike as any);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.restoredTables, 1);
  const insert = calls.find((c) => c.includes('INSERT'));
  assert.ok(insert && insert.includes('"id"'), 'INSERT ต้องใช้เฉพาะคอลัมน์ที่มีอยู่จริง');
  assert.ok(insert && !insert.includes('"name"'), 'ต้องไม่ใส่คอลัมน์ที่เป้าหมายไม่มี');
});

test('applyPackage skips tables missing on the target (no truncate, no error)', async () => {
  const calls: string[] = [];
  const prismaLike = {
    $executeRawUnsafe: async (sql: string) => { calls.push(sql); return 1; },
    $queryRawUnsafe: async () => [],
  };
  const pkg = {
    version: 1,
    modules: [
      {
        key: 'x',
        tables: [{ table: 'not_yet_migrated_table', rows: [{ id: '1' }] }],
      },
    ],
  };
  const result = await applyPackage(pkg, prismaLike as any);
  assert.ok(result.ok);
  assert.equal(result.restoredTables, 0);
  assert.equal(calls.length, 0);
});
