// tools/test/frontend-sensor-delete-outcome.test.mjs — ผูกเทสต์ "ข้อความลบข้อมูลต้องตรงกับผลจาก server" เข้า quality gate
//
// เทสต์จริงอยู่ที่ sovereign-frontend/src/lib/sensors/delete-outcome.test.ts
// ต้องรันด้วย tsx (ของ core-api) เพราะ frontend ไม่มี test runner ในตัว
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const TSX_TEST = 'src/lib/sensors/delete-outcome.test.ts';
const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('frontend sensor delete-outcome suite (tsx)', () => {
  const result = spawnSync(process.execPath, [TSX_CLI, TSX_TEST], {
    cwd: FRONTEND,
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
