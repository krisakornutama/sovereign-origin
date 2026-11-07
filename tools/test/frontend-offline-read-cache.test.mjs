// tools/test/frontend-offline-read-cache.test.mjs — ผูกเทสต์ TS ของ frontend เข้า quality gate
//
// ทำไมต้องมี wrapper:
//   `npm run test:tools` รัน node --test เฉพาะ tools/test/**/*.test.mjs
//   แต่เทสต์จริงอยู่ที่ sovereign-frontend/src/lib/offline/read-cache.test.ts
//   (ผู้ใช้กำหนด path นี้) และต้องรันด้วย tsx เพราะ frontend ไม่มี test runner ในตัว
//   wrapper นี้ทำให้ `npm run verify` จับ regression ของ offline read cache ด้วย
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const TSX_TEST = 'src/lib/offline/read-cache.test.ts';
// ใช้ tsx จาก core-api (มีอยู่แล้ว) โดยไม่ต้องเพิ่ม dependency ฝั่ง frontend
const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('frontend offline read-cache suite (tsx)', () => {
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
