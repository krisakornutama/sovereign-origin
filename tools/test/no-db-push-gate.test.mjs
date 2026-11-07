// tools/test/no-db-push-gate.test.mjs — กันการใช้ `prisma db push` กลับมาใน CI/สคริปต์
//
// ทำไมต้องมี:
//   db push sync schema ตรง ๆ โดยไม่บันทึก history → เคยทำให้ migration chain ตาม schema ไม่ทัน
//   (users.token_version และ UUID หลายตารางไม่เคยเป็น migration) จนต้อง squash เป็น baseline
//   ตอนนี้ทุก environment ใช้ migrate deploy จาก baseline แล้ว — กลับไปใช้ db push = กลับไปสร้าง drift
//
// ขอบเขตที่สแกน: CI workflows, deploy/, tools/, scripts ของ core-api, และ scripts ใน package.json
// ไม่สแกน docs/ (คำอธิบายประวัติ) หรือ migrations_archive/ (ไฟล์ประวัติศาสตร์)
//
// ถ้าจำเป็นต้องมีข้อยกเว้นจริง ๆ ให้ใส่ใน ALLOW พร้อมเหตุผล — และ gate จะฟ้องถ้าข้อยกเว้นนั้นไม่มีอยู่แล้ว
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'tools/test/no-db-push-gate.test.mjs';

// path → เหตุผลที่อนุญาต (ต้องมีอยู่จริง ไม่งั้น gate ฟ้องว่า allowlist ค้าง)
const ALLOW = new Map([]);

const SCAN_DIRS = ['.github/workflows', 'deploy', 'tools', 'sovereign-os/core-api/scripts'];
const SCAN_EXT = new Set(['.yml', '.yaml', '.mjs', '.js', '.sh', '.ps1', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'migrations_archive', 'test-results', 'dist']);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

/** บรรทัดที่เป็นคำสั่งจริง (ไม่ใช่ comment/ข้อความอธิบาย) */
function isCommandLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return !/^(\/\/|#|\*|--|<!--)/.test(trimmed);
}

function findDbPush(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const hits = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return hits;
  }
  text.split(/\r?\n/).forEach((line, index) => {
    if (!isCommandLine(line)) return;
    if (/\bprisma\s+db\s+push\b/.test(line) || /\bdb\s+push\b/.test(line) && /\bprisma\b/.test(line)) {
      hits.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

function packageScriptHits() {
  const files = ['package.json', 'sovereign-os/core-api/package.json'];
  const hits = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      if (/\bprisma\s+db\s+push\b/.test(String(script))) hits.push(`${rel}#scripts.${name}: ${script}`);
    }
  }
  return hits;
}

test('ไม่มีคำสั่ง prisma db push ใน CI, deploy, tools หรือ scripts ของ core-api', () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === SELF || ALLOW.has(rel)) continue;
      hits.push(...findDbPush(file));
    }
  }
  hits.push(...packageScriptHits());

  assert.deepEqual(
    hits,
    [],
    `พบการใช้ prisma db push — ให้เปลี่ยนเป็น "npx prisma migrate deploy" (baseline: 20261107190000)\n${hits.join('\n')}`
  );
});

test('allowlist (ถ้ามี) ยังชี้ไฟล์ที่มีอยู่จริง — กันข้อยกเว้นค้าง', () => {
  for (const rel of ALLOW.keys()) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `allowlist ชี้ไฟล์ที่ไม่มีแล้ว: ${rel}`);
  }
});
