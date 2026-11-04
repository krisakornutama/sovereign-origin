// tools/test/test-env-isolation.test.mjs
//
// ── กันเทสต์เขียน DB จริง (เหตุการณ์ 04/11/69) ───────────────────────────────
// อาการที่เจอจริง: `alert_events` มีแถวขยะ 688 แถวต่อ key (`x`, `k`, `warn once`,
// `same text`, `synthetic-streak-critical`) เพราะ test file ไม่ได้ import
// `./setup-env` ⇒ Prisma ใช้ DATABASE_URL จริงจาก .env แล้วเขียนลง DB ของ production
//
// `setup-env` คือด่านเดียวที่สลับ Prisma เป็น no-op ตอนรันเทสต์ (RUN_DB_TESTS != 1)
// เทสต์นี้จึงบังคับกฎ: **ไฟล์เทสต์ที่แตะ Prisma ต้อง import './setup-env' ก่อนอย่างอื่น**
//
// ข้อยกเว้นเดียว: ไฟล์ที่ใช้ `./db-harness` (เทสต์ real-DB ที่ตั้งใจรันกับ DB จริง
// เฉพาะเมื่อ RUN_DB_TESTS=1 + TEST_DATABASE_URL — setup-env จะทับ DATABASE_URL ของมัน)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TESTS_DIR = path.join(ROOT, 'sovereign-os', 'core-api', 'tests');
const DB_MODULES = ['src/lib/prisma.ts', 'src/services/alert-store.service.ts'];
const SETUP_IMPORT = "import './setup-env'";

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function staticDeps(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const resolved = resolveRelative(file, m[1] || m[2]);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** ไฟล์นี้ (หรือโมดูลที่ import ต่อ ๆ ไป) แตะ Prisma ไหม */
function reachesDb(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const normalized = file.replace(/\\/g, '/');
  if (DB_MODULES.some((suffix) => normalized.endsWith(suffix))) return true;
  return staticDeps(file).some((dep) => reachesDb(dep, seen));
}

/** ตำแหน่ง import './setup-env' เทียบกับ import ตัวแรก — ต้องมาก่อนเสมอ */
function setupEnvOrder(src) {
  const setupAt = src.search(/import\s+['"]\.\/setup-env['"]\s*;?/);
  if (setupAt < 0) return { present: false, first: false };
  const importRe = /^\s*import\s/m;
  const firstAny = src.search(importRe);
  return { present: true, first: setupAt <= firstAny };
}

function testFiles() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.join(TESTS_DIR, f));
}

/** ไฟล์ที่ใช้ db-harness = เทสต์ real-DB โดยเจตนา (ยกเว้นการบังคับ setup-env) */
function usesDbHarness(src) {
  return /from\s+['"]\.\/db-harness['"]/.test(src);
}

test('ไฟล์เทสต์ที่แตะ Prisma ต้อง import ./setup-env ก่อนอย่างอื่น', () => {
  const offenders = [];
  for (const file of testFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    if (usesDbHarness(src)) continue; // real-DB gated โดย RUN_DB_TESTS
    const touchesDb = reachesDb(file) || /(?:await\s+import|require)\(\s*['"]\.\.\/src\//.test(src);
    if (!touchesDb) continue;
    const order = setupEnvOrder(src);
    if (!order.present) {
      offenders.push(`${path.basename(file)} (ไม่มี import './setup-env')`);
    } else if (!order.first) {
      offenders.push(`${path.basename(file)} (setup-env ไม่ได้อยู่ก่อน import อื่น)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'เทสต์ที่แตะ Prisma ต้อง import ./setup-env เป็นบรรทัด import แรก ' +
      'ไม่งั้นจะเขียนลง DB จริง:\n  ' + offenders.join('\n  ')
  );
});

test('เคสที่เคยเขียน DB จริง (telegramAlert / syntheticStreak) ต้องมี setup-env ตลอดไป', () => {
  for (const name of ['telegramAlert.test.ts', 'syntheticStreak.test.ts']) {
    const src = fs.readFileSync(path.join(TESTS_DIR, name), 'utf8');
    assert.equal(
      setupEnvOrder(src).present,
      true,
      `${name} ต้อง import './setup-env' — เคยทำให้ alert_events มีแถวขยะ 688 แถว`
    );
  }
});
