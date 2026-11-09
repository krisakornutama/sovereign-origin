// tools/test/frontend-network-indicator.test.mjs — ผูกเทสต์ TSX ของ frontend เข้า quality gate
//
// ทำไมต้องมี wrapper:
//   เทสต์จริงอยู่ที่ sovereign-frontend/src/components/nav/NetworkIndicator.test.tsx
//   (presentational badge + networkState — รันได้บน node ผ่าน react-dom/server)
//   wrapper นี้จับ regression ของ transparent offline UX ใน quality gate
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const TSX_TEST = 'src/components/nav/NetworkIndicator.test.tsx';
// ใช้ tsx จาก core-api (มีอยู่แล้ว) โดยไม่ต้องเพิ่ม dependency ฝั่ง frontend
const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('frontend network-indicator suite (tsx)', () => {
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
