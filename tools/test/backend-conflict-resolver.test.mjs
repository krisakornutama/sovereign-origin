// tools/test/backend-conflict-resolver.test.mjs — ผูกเทสต์ Conflict Resolver เข้า quality gate
//
// ทำไมต้องมี wrapper:
//   `npm test` ของ core-api glob เฉพาะ tests/*.test.ts
//   แต่เทสต์ของ resolver อยู่ที่ src/modules/sync/conflict-resolver.test.ts
//   (ผู้ใช้กำหนด path นี้) ⇒ ต้องรันด้วย tsx --test และผูกเข้า `npm run verify`
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_API = path.join(ROOT, 'sovereign-os', 'core-api');
const TSX_TEST = 'src/modules/sync/conflict-resolver.test.ts';
const requireFromCoreApi = createRequire(path.join(CORE_API, 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('backend conflict resolver suite (tsx --test)', () => {
  const result = spawnSync(process.execPath, [TSX_CLI, '--test', TSX_TEST], {
    cwd: CORE_API,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
  });

  assert.equal(
    result.status,
    0,
    `${TSX_TEST} ล้ม (exit ${String(result.status)}):\n${result.stdout || ''}\n${result.stderr || ''}`
  );
});
