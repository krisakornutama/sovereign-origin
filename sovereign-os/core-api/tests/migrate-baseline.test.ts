// tests/migrate-baseline.test.ts — ตรรกะ baseline ของ migrate deploy (P3005)
// รันด้วย: npx tsx --test tests/migrate-baseline.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { decideMigrateAction, isUnmanagedSchemaError, listMigrationNames } from '../src/lib/migrate-baseline';

const P3005 = `Error: P3005

The database schema is not empty. Read more about how to baseline an existing production database:
https://pris.ly/d/migrate-baseline`;

test('isUnmanagedSchemaError: จับ P3005 และข้อความ "not empty"', () => {
  assert.equal(isUnmanagedSchemaError(P3005), true);
  assert.equal(isUnmanagedSchemaError('The database schema is not empty'), true);
  assert.equal(isUnmanagedSchemaError('P1001: Can\'t reach database server'), false);
  assert.equal(isUnmanagedSchemaError('error: database "sovereign" does not exist'), false);
  assert.equal(isUnmanagedSchemaError(''), false);
});

test('listMigrationNames: เอาเฉพาะโฟลเดอร์ timestamp เรียงตามลำดับ', () => {
  const names = listMigrationNames([
    '20261107190001_non_prisma_objects',
    'migration_lock.toml',
    '20261107190000_baseline',
    '.DS_Store',
    'notes.txt',
  ]);
  assert.deepEqual(names, ['20261107190000_baseline', '20261107190001_non_prisma_objects']);
});

test('decideMigrateAction: deploy ผ่าน = ok', () => {
  assert.equal(decideMigrateAction({ deployOk: true, deployOutput: '' }), 'ok');
});

test('decideMigrateAction: P3005 + drift ว่าง = baseline', () => {
  assert.equal(decideMigrateAction({ deployOk: false, deployOutput: P3005, driftOk: true }), 'baseline');
});

test('decideMigrateAction: P3005 แต่ drift ไม่ว่าง/ตรวจไม่ได้ = fail (ไม่เดาแทน)', () => {
  assert.equal(decideMigrateAction({ deployOk: false, deployOutput: P3005, driftOk: false }), 'fail');
  assert.equal(decideMigrateAction({ deployOk: false, deployOutput: P3005 }), 'fail');
});

test('decideMigrateAction: error อื่น = fail เสมอ', () => {
  assert.equal(
    decideMigrateAction({ deployOk: false, deployOutput: 'P1001: Can\'t reach database server', driftOk: true }),
    'fail'
  );
});
