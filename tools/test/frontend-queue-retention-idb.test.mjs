// tools/test/frontend-queue-retention-idb.test.mjs — ผูกเทสต์ retention บน IndexedDB จริงเข้า quality gate
//
// `npm run test:tools` รัน node --test เฉพาะ tools/test/**/*.test.mjs
// เทสต์จริงอยู่ที่ sovereign-frontend/src/lib/offline/offlineQueue.idb.test.ts
// ใช้ fake-indexeddb (devDependency ของ frontend) + tsx (ของ core-api) เป็นตัวรัน
// arch-gate ติดตั้ง deps ของ frontend (มี cache) ก่อนขั้นนี้ — ถ้า job ไม่ได้ติดตั้ง เทสต์จะแดง
// ไม่ใช่ข้ามเงียบ ๆ (npm run verify ก็รันชุดนี้ผ่าน test:tools)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const TSX_TEST = 'src/lib/offline/offlineQueue.idb.test.ts';
const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('frontend queue-retention IDB suite (tsx)', () => {
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
