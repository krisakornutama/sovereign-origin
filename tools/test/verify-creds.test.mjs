// tools/test/verify-creds.test.mjs
//
// ── secret ต้องอ่านจากจุดเดียว ─────────────────────────────────────────────
// H3: JWT_SECRET ถูกอ่านซ้ำ 3 ที่ (full-system-check / security-audit / ui-sweep)
// ด้วยโค้ดเดียวกันที่ "พังเงียบ": `.find(...)` คืน undefined → `.slice` โยน TypeError
// ที่อ่านไม่ออกว่าอะไรหาย · และไม่มีที่ไหนบอกว่าไฟล์ที่อ่านคือไฟล์ไหน
// กติกาที่ล็อก:
//   · parseEnvText อ่าน .env ได้ถูก (quote/CRLF/export/ค่าเว้นวรรค/เครื่องหมาย = ในค่า)
//   · ไฟล์หาย/คีย์หาย = คืน '' ไม่ throw (ผู้เรียกตัดสินใจ), requireSecret = throw ที่บอกทางแก้
//   · สคริปต์ทั้ง 3 ใช้โมดูลกลาง ไม่มีสำเนาโค้ดอ่าน secret เหลืออยู่
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MissingSecretError,
  maskSecret,
  parseEnvText,
  readEnvFile,
  readSecret,
  requireJwtSecret,
  requireSecret,
} from '../verify/creds.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function tempEnv(text) {
  const dir = mkdtempSync(join(tmpdir(), 'sovereign-creds-'));
  const file = join(dir, '.env');
  writeFileSync(file, text, 'utf8');
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('parseEnvText: quote / CRLF / export / ช่องว่าง / = ในค่า', () => {
  const env = parseEnvText(
    [
      '# comment',
      'JWT_SECRET=plain-secret',
      'QUOTED="two words"',
      "SINGLE='x y'",
      'export EXPORTED=yes',
      'DATABASE_URL=postgresql://u:p@h:5432/db?schema=smoke_a',
      'SPACED = not-a-key',
      'lower=ignored',
      '',
    ].join('\r\n'),
  );
  assert.equal(env.JWT_SECRET, 'plain-secret');
  assert.equal(env.QUOTED, 'two words');
  assert.equal(env.SINGLE, 'x y');
  assert.equal(env.EXPORTED, 'yes');
  assert.equal(env.DATABASE_URL, 'postgresql://u:p@h:5432/db?schema=smoke_a');
  assert.equal(env.SPACED, undefined, 'คีย์ที่มีช่องว่างหน้า = ไม่ใช่คีย์ที่ถูกต้อง');
  assert.equal(env.lower, undefined, 'คีย์ต้องเป็นตัวใหญ่ตามที่ core-api ใช้');
});

test('parseEnvText: คีย์ซ้ำ = ค่าสุดท้ายชนะ (พฤติกรรมเดิมของ telegram-creds)', () => {
  assert.equal(parseEnvText('A=1\nA=2\n').A, '2');
});

test('readEnvFile: ไฟล์หาย = {} ไม่ throw', () => {
  assert.deepEqual(readEnvFile(join(ROOT, 'ไม่มีไฟล์นี้แน่นอน.env')), {});
});

test('readEnvFile/readSecret: อ่านค่าจากไฟล์จริงบนดิสก์', () => {
  const t = tempEnv('JWT_SECRET="จากไฟล์"\nOTHER=1\n');
  try {
    assert.equal(readEnvFile(t.file).OTHER, '1');
    assert.equal(readSecret('JWT_SECRET', { file: t.file }), 'จากไฟล์');
    assert.equal(readSecret('ไม่มีคีย์นี้', { file: t.file }), '');
    assert.equal(requireJwtSecret({ file: t.file }), 'จากไฟล์');
  } finally {
    t.cleanup();
  }
});

test('requireSecret: คีย์หาย = error ที่บอกชื่อคีย์ + ไฟล์ (ไม่ใช่ TypeError)', () => {
  const t = tempEnv('OTHER=1\n');
  try {
    assert.throws(
      () => requireJwtSecret({ file: t.file }),
      (err) => {
        assert.ok(err instanceof MissingSecretError);
        assert.match(err.message, /JWT_SECRET/);
        assert.match(err.message, /\.env|infra/);
        return true;
      },
    );
    assert.throws(() => requireSecret('TELEGRAM_BOT_TOKEN', { file: t.file }), /TELEGRAM_BOT_TOKEN/);
  } finally {
    t.cleanup();
  }
});

test('requireSecret: preferEnv=true อ่านจาก env ก่อน (CI/override) แต่ค่าดีฟอลต์คือไฟล์', () => {
  const t = tempEnv('JWT_SECRET=from-file\n');
  try {
    const env = { JWT_SECRET: 'from-env' };
    assert.equal(requireSecret('JWT_SECRET', { file: t.file, env }), 'from-file');
    assert.equal(requireSecret('JWT_SECRET', { file: t.file, env, preferEnv: true }), 'from-env');
  } finally {
    t.cleanup();
  }
});

test('maskSecret ไม่พิมพ์ค่าจริง (ใช้ใน log ได้)', () => {
  const masked = maskSecret('super-long-secret-value');
  assert.ok(!masked.includes('super-long-secret-value'));
  assert.match(masked, /••••/);
  assert.equal(maskSecret(''), '(ว่าง)');
  assert.equal(maskSecret(null), '(ว่าง)');
});

test('ของจริงบนเครื่องนี้: อ่าน JWT_SECRET ได้ (ถ้ามี infra/.env)', () => {
  const infra = join(ROOT, 'sovereign-os', 'infra', '.env');
  if (!existsSync(infra)) return; // clone ใหม่/CI ไม่มี .env = ข้ามตามสภาพแวดล้อม
  assert.ok(requireJwtSecret().length >= 8, 'JWT_SECRET ที่อ่านได้ต้องไม่สั้นผิดปกติ');
});

test('สคริปต์ทั้ง 3 ใช้โมดูลกลาง ไม่เหลือสำเนาอ่าน secret', () => {
  for (const rel of [
    'tools/verify/full-system-check.mjs',
    'tools/verify/security-audit.mjs',
    'tools/verify/ui-sweep.mjs',
  ]) {
    const src = read(rel);
    assert.match(src, /from '\.\/creds\.mjs'/, `${rel}: ต้อง import จาก creds.mjs`);
    assert.match(src, /requireJwtSecret\(/, `${rel}: ต้องใช้ requireJwtSecret()`);
    assert.doesNotMatch(src, /startsWith\('JWT_SECRET='\)/, `${rel}: ยังมีโค้ดอ่าน secret ซ้ำ`);
  }
});
