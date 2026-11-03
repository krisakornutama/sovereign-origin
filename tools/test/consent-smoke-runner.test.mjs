// tools/test/consent-smoke-runner.test.mjs
//
// ── consent smoke ต้องรันอัตโนมัติได้ โดยไม่มีทางเผลอยิงใส่ production ──────
// ปัญหาเดิม: `sovereign-os/core-api/tools/consent-smoke.mjs` สร้าง/ลบบัญชีจริง
// และค่าเริ่มต้นยิงใส่ http://localhost:3001 (= production) → ต้องสั่งมือเท่านั้น
// และถ้าสั่งมือผิดเครื่อง/ผิด DB ก็เขียนลงข้อมูลจริง
//
// กติกาที่เทสต์นี้ล็อก:
//   · ไม่ระบุโหมด = --check (อ่านเท่านั้น) ⇒ เอาเข้า nightly ได้
//   · --full (เขียนจริง) ต้องมี --env=test + hub ที่ไม่ใช่ production + scratch DB
//     ที่ schema ไม่ใช่ public และไม่ใช่ DATABASE_URL ของโปรเจกต์
//   · --check ตรวจจริงว่า /api/consent (+history) ตอบ 401 เมื่อไม่ส่ง token
//   · nightly เรียกเฉพาะ --check — ห้ามเรียก --full บนเครื่องจริง
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  assessTarget,
  inspectHub,
  schemaOf,
  runCheck,
  readSourcePolicyVersion,
} from '../consent-smoke-runner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const RUNNER = join(ROOT, 'tools', 'consent-smoke-runner.mjs');

const SCRATCH = 'postgresql://sovereign:secret@127.0.0.1:55432/sovereign_smoke?schema=smoke_abc123';
const PROD_DB = 'postgresql://sovereign:secret@127.0.0.1:5432/sovereign?schema=public';

const SECTION_IDS = [
  'who', 'data', 'purpose', 'retention', 'sharing', 'rights', 'security', 'children', 'changes', 'contact',
];

const GOOD_POLICY = {
  version: '2026-11-03',
  effectiveDate: '2026-11-03',
  controller: { name: 'ACME Farm', email: 'dpo@acme.test', address: 'Bangkok' },
  sections: SECTION_IDS.map((id) => ({ id, title: id, paragraphs: ['x'], titleEn: id, paragraphsEn: ['x'] })),
};

// fetch ปลอม: ตอบตามเส้นที่ขอ โดยไม่ต้องมีเซิร์ฟเวอร์จริง
function stubHub({ policy = 200, policyBody = GOOD_POLICY, consent = 401, history = 401 } = {}) {
  const calls = [];
  const reply = (status, body) => ({ status, json: async () => body });
  const fetchImpl = async (url) => {
    const p = new URL(String(url)).pathname;
    calls.push(p);
    if (p === '/api/consent/policy') return reply(policy, policyBody);
    if (p === '/api/consent') return reply(consent, { error: 'unauthorized' });
    if (p === '/api/consent/history') return reply(history, { error: 'unauthorized' });
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

// ── 1) ค่าดีฟอลต์ต้องปลอดภัย ────────────────────────────────────────────────
test('ไม่ระบุโหมด = --check (อ่านเท่านั้น) เอาเข้า nightly ได้', () => {
  const args = parseArgs([]);
  assert.equal(args.mode, 'check');
  const verdict = assessTarget(args);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.readOnly, true);
  assert.equal(verdict.hub, 'http://127.0.0.1:3001');
});

test('hub ต้องเป็น http/https เท่านั้น', () => {
  assert.equal(inspectHub('file:///etc/passwd').ok, false);
  assert.equal(inspectHub('not a url').ok, false);
  assert.equal(inspectHub('http://127.0.0.1:3101').ok, true);
});

// ── 2) --full ต้องปฏิเสธทุกทางที่หลุดไปโดนของจริง ─────────────────────────
test('--full ที่ไม่ได้ประกาศ --env=test = ปฏิเสธ (exit 2)', () => {
  const v = assessTarget({ mode: 'full', env: '', hub: 'http://127.0.0.1:3101', scratchDb: SCRATCH });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'need_env_test');
  assert.equal(v.exitCode, 2);
});

test('--full ชี้ production :3001 = ปฏิเสธ (ทั้ง localhost และ 127.0.0.1)', () => {
  for (const hub of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://127.0.0.1:3001/']) {
    const v = assessTarget({ mode: 'full', env: 'test', hub, scratchDb: SCRATCH });
    assert.equal(v.ok, false, `hub ${hub} ต้องถูกปฏิเสธ`);
    assert.equal(v.code, 'prod_hub');
    assert.equal(v.exitCode, 2);
  }
});

test('--full ที่ไม่มี scratch DB = ปฏิเสธ', () => {
  const v = assessTarget({ mode: 'full', env: 'test', hub: 'http://127.0.0.1:3101', scratchDb: '' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'need_scratch_db');
});

test('scratch DB ต้องมี schema และต้องไม่ใช่ public', () => {
  assert.equal(schemaOf(SCRATCH), 'smoke_abc123');
  assert.equal(schemaOf('postgresql://u:p@h:5432/db'), '');

  const noSchema = assessTarget({
    mode: 'full', env: 'test', hub: 'http://127.0.0.1:3101',
    scratchDb: 'postgresql://u:p@127.0.0.1:55432/smoke',
  });
  assert.equal(noSchema.ok, false);
  assert.equal(noSchema.code, 'scratch_db_no_schema');

  const publicSchema = assessTarget({
    mode: 'full', env: 'test', hub: 'http://127.0.0.1:3101',
    scratchDb: 'postgresql://u:p@127.0.0.1:55432/smoke?schema=public',
  });
  assert.equal(publicSchema.ok, false);
  assert.equal(publicSchema.code, 'scratch_db_public');
});

test('scratch DB ที่ชี้ตัวเดียวกับ DB ของโปรเจกต์ = ปฏิเสธ', () => {
  const v = assessTarget({
    mode: 'full', env: 'test', hub: 'http://127.0.0.1:3101', scratchDb: SCRATCH, prodDbUrl: SCRATCH,
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'scratch_db_is_prod');
});

test('--full ที่ครบเงื่อนไข = ผ่าน และคืน schema ให้ตรวจต่อ', () => {
  const v = assessTarget({
    mode: 'full', env: 'test', hub: 'http://127.0.0.1:3101', scratchDb: SCRATCH, prodDbUrl: PROD_DB,
  });
  assert.equal(v.ok, true);
  assert.equal(v.readOnly, false);
  assert.equal(v.schema, 'smoke_abc123');
  assert.equal(v.hub, 'http://127.0.0.1:3101');
});

// ── 3) --check ต้องจับของจริง ไม่ใช่แค่ยิงแล้วผ่าน ─────────────────────────
test('--check ผ่านเมื่อเส้นสาธารณะทำงานและเส้นส่วนตัวยังกัน token', async () => {
  const { fetchImpl, calls } = stubHub();
  const r = await runCheck({ fetchImpl, sourceVersion: '2026-11-03' });
  assert.equal(r.ok, true, r.last);
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.match(r.last, /^OK/);
  // ต้องไม่แตะ DB/เขียนอะไร: เรียกเฉพาะ GET 3 เส้น
  assert.deepEqual(calls.sort(), ['/api/consent', '/api/consent/history', '/api/consent/policy']);
});

test('--check ไม่ผ่านเมื่อ /api/consent ตอบ 200 โดยไม่ต้องล็อกอิน (ข้อมูลรั่ว)', async () => {
  const { fetchImpl } = stubHub({ consent: 200 });
  const r = await runCheck({ fetchImpl, sourceVersion: '2026-11-03' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('consent_requires_auth'), r.errors.join(','));
});

test('--check ไม่ผ่านเมื่อนโยบายตอบ 500 หรือหัวข้อ PDPA หาย', async () => {
  const down = await runCheck({ fetchImpl: stubHub({ policy: 500 }).fetchImpl, sourceVersion: '2026-11-03' });
  assert.equal(down.ok, false);
  assert.ok(down.errors.includes('policy_public_200'));

  const missing = await runCheck({
    fetchImpl: stubHub({ policyBody: { ...GOOD_POLICY, sections: [{ id: 'who' }] } }).fetchImpl,
    sourceVersion: '2026-11-03',
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes('policy_sections'));
});

test('--check ไม่ผ่านเมื่อเรียกไม่ถึงเซิร์ฟเวอร์ (ไม่ throw ออกมา)', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = await runCheck({ fetchImpl, sourceVersion: '2026-11-03' });
  assert.equal(r.ok, false);
  assert.match(r.last, /ไม่ผ่าน/);
});

test('เวอร์ชัน runtime ต่างจากโค้ด = เตือน ไม่ทำให้ nightly แดง', async () => {
  const r = await runCheck({ fetchImpl: stubHub().fetchImpl, sourceVersion: '2027-01-01' });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.includes('policy_version_matches_source'));
});

test('ผู้ควบคุมข้อมูลยังว่าง = เตือน (เจ้าของต้องเติมก่อนเผยแพร่)', async () => {
  const body = { ...GOOD_POLICY, controller: { name: null, email: null, address: null } };
  const r = await runCheck({ fetchImpl: stubHub({ policyBody: body }).fetchImpl, sourceVersion: '2026-11-03' });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.includes('controller_configured'));
});

test('อ่านเวอร์ชันนโยบายจากโค้ดได้จริง (แหล่งความจริงเดียว)', () => {
  assert.match(readSourcePolicyVersion(ROOT), /^\d{4}-\d{2}-\d{2}$/);
});

// ── 4) CLI ต้องปฏิเสธก่อนแตะอะไร ───────────────────────────────────────────
test('CLI: --full โดยไม่มี --env=test → exit 2 และบอกวิธีที่ถูก', () => {
  const r = spawnSync(process.execPath, [RUNNER, '--full', '--hub=http://127.0.0.1:3101'], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /--env=test/);
});

test('CLI: --check กับ hub ที่ไม่ตอบ → exit 1 (ไม่ใช่ 0 และไม่ใช่ 2)', () => {
  const r = spawnSync(process.execPath, [RUNNER, '--check', '--hub=http://127.0.0.1:9', '--json'], {
    encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop() ?? '{}';
  const parsed = JSON.parse(last);
  assert.equal(parsed.ok, false);
  assert.match(parsed.last, /ไม่ผ่าน/);
});

// ── 5) ของจริงที่ถูกต่อเข้า nightly ────────────────────────────────────────
test('nightly รันเฉพาะ --check (ห้าม --full บนเครื่องที่ production ทำงานอยู่)', () => {
  const src = read('tools/nightly-verify.mjs');
  assert.match(src, /consent-smoke-runner\.mjs/, 'nightly ต้องเรียก runner');
  assert.match(src, /'--check'/, 'nightly ต้องใช้โหมดอ่านเท่านั้น');
  assert.doesNotMatch(src, /'--full'/, 'nightly ห้ามเรียกโหมดเขียนจริง');
});

test('consent-smoke ปฏิเสธการรันนอกสภาพแวดล้อมทดสอบด้วยตัวเอง', () => {
  const src = read('sovereign-os/core-api/tools/consent-smoke.mjs');
  assert.match(src, /CONSENT_SMOKE_ENV/, 'ต้องอ่านธงประกาศสภาพแวดล้อม');
  assert.match(src, /--allow-non-test/, 'ต้องมีทางออกที่ต้องสั่งชัดเจน (ไม่ใช่เงียบ ๆ ผ่าน)');
});
