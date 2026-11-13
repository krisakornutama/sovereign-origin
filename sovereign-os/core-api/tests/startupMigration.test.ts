// startupMigration — sidecar ต้อง migrate DB ก่อนเริ่มรับ request และต้องบอกความจริงเรื่อง SQLite
//
// เคสจริง 13/11/69: แอปเดสก์ท็อปตั้ง DATABASE_URL = `file:<userData>/data.db` ให้ sidecar
// แต่ Prisma datasource เป็น postgresql ⇒ คิวรี _prisma_migrations ล้มเงียบ ๆ
// health จึงคืน `"db":{"migrationHead":null}` ดูเหมือน "ยังไม่มี migration" ทั้งที่
// จริง ๆ คือ "ต่อ DB ไม่ได้เลย" — และไม่มีใคร migrate อะไรก่อนเสิร์ฟ
//
// เขียนก่อน implementation (red-first): src/services/startup-migration.service.ts ยังไม่มี
import test from 'node:test';
import assert from 'node:assert/strict';

import { runStartupMigrations } from '../src/services/startup-migration.service';

function runner(result) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };
  run.calls = calls;
  return run;
}

test('ไม่รันเมื่อไม่ได้สั่ง (MIGRATE_ON_START ไม่ใช่ 1/true)', () => {
  const run = runner({ status: 0 });
  const res = runStartupMigrations({ env: {}, run });
  assert.equal(res.ran, false);
  assert.equal(res.reason, 'disabled');
  assert.equal(run.calls.length, 0);
});

test('SQLite (file:) = บอกตรง ๆ ว่าใช้ไม่ได้ ไม่ใช่พยายามแล้วล้มเงียบ', () => {
  const run = runner({ status: 0 });
  const res = runStartupMigrations({
    env: { MIGRATE_ON_START: '1', DATABASE_URL: 'file:C:/Users/x/AppData/sovereign-frontend/data.db' },
    run,
  });
  assert.equal(res.ran, false);
  assert.equal(res.reason, 'unsupported-sqlite');
  assert.match(res.detail, /postgresql/);
  assert.equal(run.calls.length, 0, 'ห้าม spawn อะไรกับ URL ที่ใช้ไม่ได้');
});

test('ไม่มี DATABASE_URL = ไม่มีอะไรให้ migrate และต้องบอกเหตุผล', () => {
  const res = runStartupMigrations({ env: { MIGRATE_ON_START: '1' }, run: runner({ status: 0 }) });
  assert.equal(res.ran, false);
  assert.equal(res.reason, 'no-database');
});

test('Postgres + เปิดสวิตช์ = รัน migrate-deploy ด้วย env เดียวกัน', () => {
  const run = runner({ status: 0, stdout: 'No pending migrations' });
  const env = { MIGRATE_ON_START: 'true', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
  const res = runStartupMigrations({
    env, run,
    scriptPath: '/app/dist/scripts/migrate-deploy.js',
    scriptExists: () => true,
    nodePath: 'node',
  });
  assert.equal(res.ran, true);
  assert.equal(res.ok, true);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].cmd, 'node');
  assert.deepEqual(run.calls[0].args, ['/app/dist/scripts/migrate-deploy.js']);
  assert.equal(run.calls[0].opts.env.DATABASE_URL, env.DATABASE_URL);
  // migrate-deploy หา prisma/ จาก cwd — ต้องเป็นราก core-api ไม่ใช่ dist/
  assert.equal(run.calls[0].opts.cwd, '/app');
});

test('migrate ล้ม = ok:false พร้อมท่อนท้ายของ output (ไม่กลืนสาเหตุ)', () => {
  const run = runner({ status: 1, stderr: 'Error: P1001 cannot reach database server\nline2\nline3' });
  const res = runStartupMigrations({
    env: { MIGRATE_ON_START: '1', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
    run,
  });
  assert.equal(res.ran, true);
  assert.equal(res.ok, false);
  assert.match(res.detail, /P1001/);
  assert.ok(res.detail.length <= 600, 'ต้องตัด output ให้สั้นพอใส่ log');
});

test('สคริปต์ migrate หายไป = ok:false ไม่ใช่ถือว่าผ่าน', () => {
  const res = runStartupMigrations({
    env: { MIGRATE_ON_START: '1', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
    run: runner({ status: 0 }),
    scriptPath: '/nope/migrate-deploy.js',
    scriptExists: () => false,
  });
  assert.equal(res.ok, false);
  assert.match(res.detail, /migrate-deploy/);
});
