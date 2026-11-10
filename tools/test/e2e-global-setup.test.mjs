// e2e global setup/teardown — ด่าน static กัน "เรียกสคริปต์ที่ไม่มีอยู่" และ PATH ที่ใช้ได้ OS เดียว
//
// ที่มา (เคสจริง CI 8–9 พ.ย. 69): global-setup เรียก `e2e-fixture.ts` ที่ถูกลบไปตอนแยก CE
//   → Linux: `ERR_MODULE_NOT_FOUND ... src/scripts/e2e-fixture.ts`
//   → Windows: `spawnSync npx ENOENT` (execFileSync หา npx.exe ไม่เจอ ต้อง npx.cmd)
//   ผลคือ seed fixture ล้มทุกครั้งโดยไม่มีใครเห็นว่ามันล้มเพราะไฟล์หาย ไม่ใช่เพราะข้อมูลผิด
//
// เทสต์นี้จึงบังคับสองอย่าง:
//   1) ทุกสคริปต์ที่ global setup/teardown อ้างถึง ต้องมีไฟล์ต้นทางอยู่ใน core-api จริง
//   2) ห้ามเรียกผ่าน `npx` ตรง ๆ — ต้องผ่าน helper ที่รันด้วย process.execPath (มีบนทุก OS)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FE = join(ROOT, 'sovereign-frontend');
const E2E = join(FE, 'e2e');
const CORE_SCRIPTS = join(ROOT, 'sovereign-os', 'core-api', 'src', 'scripts');
const HELPER = join(E2E, 'helpers', 'core-script.ts');

const SETUP_FILES = ['global-setup.ts', 'global-teardown.ts'];

/** ตัด comment ออกก่อนตรวจโค้ด — คอมเมนต์อธิบายบั๊กเดิมได้ (มีคำว่า npx) แต่ไม่ใช่โค้ดที่รันจริง */
function codeOnly(src) {
  return src
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** ชื่อสคริปต์ที่ไฟล์อ้างถึง — จับทั้ง dist/scripts/x.js และ src/scripts/x.ts */
function referencedScripts(src) {
  const names = new Set();
  for (const m of src.matchAll(/scripts['"]?\s*,\s*['"]([a-z0-9-]+)\.(?:js|ts)['"]/gi)) names.add(m[1]);
  for (const m of src.matchAll(/scripts\/([a-z0-9-]+)\.(?:js|ts)/gi)) names.add(m[1]);
  return [...names].sort();
}

test('global setup/teardown อ้างถึงเฉพาะสคริปต์ที่มีไฟล์ต้นทางจริง', () => {
  const missing = [];
  for (const file of SETUP_FILES) {
    const p = join(E2E, file);
    assert.ok(existsSync(p), `ไม่พบ e2e/${file}`);
    for (const name of referencedScripts(readFileSync(p, 'utf8'))) {
      if (!existsSync(join(CORE_SCRIPTS, `${name}.ts`))) missing.push(`${file} → ${name}.ts`);
    }
  }
  assert.deepEqual(missing, [], `อ้างถึงสคริปต์ที่ไม่มีใน sovereign-os/core-api/src/scripts:\n  ${missing.join('\n  ')}`);
});

test('global setup/teardown ไม่เรียก npx ตรง ๆ (Windows หา npx ไม่เจอ)', () => {
  for (const file of SETUP_FILES) {
    const src = readFileSync(join(E2E, file), 'utf8');
    assert.doesNotMatch(codeOnly(src), /execFileSync\(\s*['"]npx['"]/, `${file} ต้องเรียกผ่าน helpers/core-script.ts ไม่ใช่ npx`);
    assert.match(src, /from '\.\/helpers\/core-script'/, `${file} ต้อง import runCoreScript จาก helpers/core-script`);
  }
});

test('helper รันสคริปต์ด้วย process.execPath และเลือกไฟล์ที่มีจริงก่อน', () => {
  assert.ok(existsSync(HELPER), 'ไม่พบ e2e/helpers/core-script.ts');
  const src = readFileSync(HELPER, 'utf8');
  assert.match(src, /execFileSync\(\s*process\.execPath/, 'ต้องรันด้วย process.execPath (ไม่มีปัญหา PATH/npx.cmd)');
  assert.match(src, /dist['"]?,\s*['"]scripts/, 'ต้องลอง dist ก่อน');
  assert.match(src, /node_modules['"]?,\s*['"]tsx/, 'ถ้าไม่มี dist ต้องใช้ tsx ที่ติดตั้งใน core-api (ไม่ใช่ npx)');
  assert.doesNotMatch(codeOnly(src), /execFileSync\(\s*['"]npx['"]/, 'ห้ามเรียก npx');
});
