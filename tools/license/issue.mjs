#!/usr/bin/env node
// tools/license/issue.mjs — shim ให้ใช้ CLI ได้โดยไม่ต้องมี tsx global
// แหล่งความจริงเดียวอยู่ที่ tools/license/issue.ts (import license.service.ts)
// ใช้ tsx ที่ติดตั้งใน sovereign-os/core-api (ตัวเดียวกับที่เทสต์ใช้)
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_API = path.join(ROOT, 'sovereign-os', 'core-api');
const requireFromCoreApi = createRequire(path.join(CORE_API, 'package.json'));

let tsxCli;
try {
  tsxCli = requireFromCoreApi.resolve('tsx/cli');
} catch {
  process.stderr.write(
    '✗ ไม่พบ tsx — รัน `npm ci` ใน sovereign-os/core-api ก่อน (ต้องมี devDependency tsx)\n'
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsxCli, path.join('tools', 'license', 'issue.ts'), ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status ?? 1);
