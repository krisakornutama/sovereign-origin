// e2e/helpers/core-script.ts — เรียกสคริปต์ฝั่ง core-api จาก global setup/teardown
//
// ทำไมต้องมี helper นี้ (เคสจริง CI 8–9 พ.ย. 69):
//   - `execFileSync('npx', ...)` บน Windows หาไฟล์ไม่เจอ (`spawnSync npx ENOENT`) เพราะต้องเรียก npx.cmd
//   - บน Linux การเรียก `src/scripts/*.ts` ตรง ๆ ล้ม `ERR_MODULE_NOT_FOUND` เมื่อ runner ไม่มี tsx ใน PATH
//   แก้ที่ราก: รันด้วย `process.execPath` (node ตัวเดียวกับที่รันเทสต์) และเลือกไฟล์ที่ "มีจริง" ก่อน
//   → ไม่พึ่ง PATH และไม่พึ่ง shell ของ OS ใด ๆ
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** โฟลเดอร์ core-api (worktree กับ main มีโครงสร้างเดียวกัน) */
const CORE_API = path.resolve('..', 'sovereign-os', 'core-api');

function run(script: string, args: string[], timeoutMs: number): string {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: CORE_API,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  }).trim();
}

/**
 * รันสคริปต์ใน `core-api/src/scripts/<name>.ts`
 * - มี dist (build แล้ว) → รัน `dist/scripts/<name>.js` (เร็ว ไม่ต้องแปลง TS)
 * - ไม่มี dist แต่มี tsx ใน core-api → รัน tsx cli ผ่าน node (ไม่ใช้ npx)
 * - ไม่มีทั้งคู่ → error ที่บอกทางแก้ ไม่ใช่ ENOENT/ERR_MODULE_NOT_FOUND ดิบ ๆ
 */
export function runCoreScript(name: string, args: string[], timeoutMs = 180_000): string {
  const dist = path.join(CORE_API, 'dist', 'scripts', `${name}.js`);
  if (existsSync(dist)) return run(dist, args, timeoutMs);

  const src = path.join(CORE_API, 'src', 'scripts', `${name}.ts`);
  if (!existsSync(src)) {
    throw new Error(`ไม่พบสคริปต์ ${name} ทั้ง dist และ src (คาดที่ ${src})`);
  }

  const tsxCli = path.join(CORE_API, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) {
    throw new Error(`ยังไม่ได้ build core-api และไม่พบ tsx — รัน npm run build ใน sovereign-os/core-api ก่อน (ต้องการ ${dist})`);
  }
  return run(tsxCli, [src, ...args], timeoutMs);
}
