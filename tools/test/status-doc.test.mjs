// tools/test/status-doc.test.mjs
//
// ── STATUS.md ต้องเป็น "สถานะปัจจุบัน" ที่ gen ใหม่ได้ ไม่ใช่ journal ────────
// ปัญหาเดิม: STATUS.md โต 460 บรรทัด/372 KB เป็นบันทึกย้อนหลังถึง 22/10/69
// ⇒ คนที่เปิดไฟล์เพื่อดูว่า "ตอนนี้ระบบเป็นยังไง" ต้องอ่านทั้งประวัติ
//
// กติกาที่ล็อก:
//   · renderStatus() ประกอบจากข้อมูลจริง 4 ไฟล์ (system-truth / nightly status /
//     ops-status / nightly-history) — ข้อมูลหาย = บอกว่าไม่มีข้อมูล ไม่ throw
//   · ผลลัพธ์ deterministic เมื่อกำหนด generatedAt (เทสต์ได้)
//   · --check = อ่านเท่านั้น · ไฟล์หาย/เนื้อไม่ตรง = exit 1 (ใช้เป็น gate ได้)
//   · --check ไม่ฟ้อง "เก่า" แค่เวลาผ่าน — ใช้ generatedAt เดิมในไฟล์เป็นฐาน
//   · --write เขียนไฟล์ (สร้างโฟลเดอร์ให้) · --out= เขียนที่อื่นได้
//   · STATUS.md ในรีโปต้องสั้น + มี marker ว่า gen จากเครื่องมือ (กันกลับไปเป็น journal)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildState,
  checkStatusDoc,
  readGeneratedAt,
  renderStatus,
} from '../status-doc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SCRIPT = join(ROOT, 'tools', 'status-doc.mjs');

const TRUTH = {
  writtenAt: '2026-11-03T15:54:12.946Z', // 22:54 น. เวลาไทย
  ok: true,
  steps: [
    { name: 'backend: clean dist (stale-output sweep)', ok: true, skipped: false },
    { name: 'frontend: typecheck (tsc)', ok: true, skipped: false },
    { name: 'tools: unit tests (node --test)', ok: true, skipped: false },
    { name: 'backend: build (tsc)', ok: true, skipped: false },
    { name: 'frontend: build (next)', ok: true, skipped: false },
    { name: 'backend: test', ok: true, skipped: false },
  ],
};

const NIGHTLY = {
  ok: false,
  gateOk: true,
  failedExtras: ['consent smoke'],
  durationMin: 7,
  finishedAt: '2026-11-02T19:00:41.391Z', // 02:00 น. เวลาไทย ของ 3/11
  lastGateOk: true,
  codeMatch: true,
  migrationHead: '20261103120000_add_user_consents',
  steps: [],
  skipped: [{ name: 'IndexNow', why: 'สคริปต์ไม่คืนผลลัพธ์' }],
  consentSmoke: { ok: false, last: 'ไม่ผ่าน 1/7: consent_requires_auth', warnings: [] },
  historyGaps: ['2026-11-03'],
  machine: { ok: true, problems: [], ramFreeGB: 4.6, diskFreeGB: 50 },
};

const OPS = {
  checkedAt: '2026-11-03T15:53:51.421Z',
  watch: ['nightly verify พัง: consent smoke', 'task "ShipShop 23:59" 0x00000001'],
  tasks: [
    { name: 'Sovereign DB Backup', label: 'DB Backup 03:00', lastRun: '3/11/2569 03:00:00', result: { ok: true, text: 'OK' } },
    { name: 'ShipShop3000', label: 'ShipShop 23:59', lastRun: '2/11/2569 23:59:59', result: { ok: false, text: '0x00000001' } },
    { name: 'Sovereign Nightly Verify', label: 'Verify 02:00', lastRun: '3/11/2569 02:00:00', result: { ok: false, text: '0x00000001' } },
  ],
  machine: { ok: true, problems: [], info: { ramFreeGB: 4.6, diskFreeGB: 50 } },
};

const HISTORY = [
  { day: '2026-11-01', ok: true, durationMin: 6 },
  { day: '2026-11-02', ok: false, durationMin: 1 },
];

const FULL = { truth: TRUTH, nightly: NIGHTLY, ops: OPS, history: HISTORY };

function tempRoot(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sovereign-status-doc-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── 1) render จากข้อมูลครบ ─────────────────────────────────────────────────
test('render เต็ม: สรุปทุกสาย + เวลาไทย + ขั้นที่ล้ม/ขาด ครบ', () => {
  const out = renderStatus(FULL, { generatedAt: '2026-11-03T16:00:00.000Z' });
  assert.match(out, /^# STATUS — สถานะปัจจุบัน/);
  assert.match(out, /node tools\/status-doc\.mjs --write/, 'ต้องมี marker ว่า gen จากเครื่องมือ');

  // สรุป 5 บรรทัด: gate / nightly / history / เครื่อง / task
  assert.match(out, /Quality gate: ✅ ผ่าน 6\/6 — 2026-11-03 22:54/);
  assert.match(out, /Nightly: ❌ ไม่ผ่าน — consent smoke — 2026-11-03 02:00/);
  assert.match(out, /ประวัติ nightly: ⚠️ ขาด 1 วัน — 2026-11-03/);
  assert.match(out, /เครื่อง: ✅ ปกติ — แรมว่าง 4\.6 GB · ดิสก์ว่าง 50 GB/);
  assert.match(out, /Task scheduler: ❌ ล้ม 2 งาน — ShipShop 23:59, Verify 02:00/);

  // รายละเอียดที่ต้องเห็น ไม่ใช่แค่สรุป
  assert.match(out, /ขั้นเสริมที่ล้ม: consent smoke/);
  assert.match(out, /migration head: `20261103120000_add_user_consents`/);
  assert.match(out, /2026-11-02 \| ❌/);
  assert.match(out, /ต้องดู \(2\)/);
});

test('render: gate ล้ม = บอกจำนวนขั้นที่ผ่านจริง ไม่ใช่แค่ "ไม่ผ่าน"', () => {
  const truth = {
    ...TRUTH,
    ok: false,
    steps: [
      { name: 'frontend: typecheck (tsc)', ok: true },
      { name: 'backend: test', ok: false },
    ],
  };
  const out = renderStatus({ ...FULL, truth }, { generatedAt: '2026-11-03T16:00:00.000Z' });
  assert.match(out, /Quality gate: ❌ ไม่ผ่าน \(1\/2\)/);
  assert.match(out, /\| backend: test \| ❌/);
});

test('render: ขั้นที่ถูกข้ามต้องแสดงว่าข้าม ไม่ใช่นับเป็นผ่าน', () => {
  const truth = {
    ...TRUTH,
    steps: [
      { name: 'frontend: build (next)', ok: true },
      { name: 'e2e: Playwright (headless)', ok: false, skipped: true },
    ],
  };
  const out = renderStatus({ ...FULL, truth }, { generatedAt: '2026-11-03T16:00:00.000Z' });
  assert.match(out, /\| e2e: Playwright \(headless\) \| ⏭ ข้าม/);
});

// ── 2) ข้อมูลหาย/เสีย ต้องไม่ throw และไม่โกหกว่าปกติ ──────────────────────
test('ข้อมูลว่างทั้งหมด: บอก "ยังไม่มีข้อมูล" ทุกสาย ไม่ใช่ผ่านโดยปริยาย', () => {
  const out = renderStatus({}, { generatedAt: '2026-11-03T16:00:00.000Z' });
  assert.match(out, /^# STATUS — สถานะปัจจุบัน/);
  assert.match(out, /Quality gate: — ยังไม่มีข้อมูล/);
  assert.match(out, /Nightly: — ยังไม่มีข้อมูล/);
  assert.match(out, /เครื่อง: — ยังไม่มีข้อมูล/);
  assert.match(out, /Task scheduler: — ยังไม่มีข้อมูล/);
  assert.doesNotMatch(out, /✅ ผ่าน/);
});

test('buildState: ไฟล์หายหรือ JSON เสีย = null (ไม่ throw) และอ่านไฟล์ที่ดีได้', () => {
  const t = tempRoot({
    'sovereign-os/core-api/data/system-truth.json': TRUTH,
    'logs/nightly/status.json': '{ ไฟล์เสีย',
    'sovereign-os/core-api/data/ops-status.json': '',
  });
  try {
    const state = buildState(t.dir);
    assert.equal(state.truth.ok, true);
    assert.equal(state.nightly, null);
    assert.equal(state.ops, null);
    assert.equal(state.history, null);
    const out = renderStatus(state, { generatedAt: '2026-11-03T16:00:00.000Z' });
    assert.match(out, /Quality gate: ✅ ผ่าน 6\/6/);
    assert.match(out, /Nightly: — ยังไม่มีข้อมูล/);
  } finally {
    t.cleanup();
  }
});

test('nightly ok=true แต่มี failedExtras = ยังต้องรายงานว่าไม่ผ่าน', () => {
  const nightly = { ...NIGHTLY, ok: true, failedExtras: ['backup restore-check'], historyGaps: [] };
  const out = renderStatus({ ...FULL, nightly }, { generatedAt: '2026-11-03T16:00:00.000Z' });
  assert.match(out, /Nightly: ❌ ไม่ผ่าน — backup restore-check/);
});

// ── 3) determinism + --check ───────────────────────────────────────────────
test('render deterministic เมื่อกำหนด generatedAt (เทสต์/check ได้)', () => {
  const a = renderStatus(FULL, { generatedAt: '2026-11-03T16:00:00.000Z' });
  const b = renderStatus(FULL, { generatedAt: '2026-11-03T16:00:00.000Z' });
  const c = renderStatus(FULL, { generatedAt: '2026-11-04T16:00:00.000Z' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(readGeneratedAt(a), '2026-11-03T16:00:00.000Z');
});

test('--check: ไฟล์หาย = ไม่ผ่าน พร้อมบอกเหตุผล', () => {
  const t = tempRoot({});
  try {
    const r = checkStatusDoc(FULL, '', { out: join(t.dir, 'STATUS.md') });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing');
  } finally {
    t.cleanup();
  }
});

test('--check: เนื้อไม่ตรงกับข้อมูลจริง = stale (exit 1)', () => {
  const stale = renderStatus(FULL, { generatedAt: '2026-11-03T16:00:00.000Z' })
    .replace('Nightly: ❌ ไม่ผ่าน', 'Nightly: ✅ ผ่าน');
  const r = checkStatusDoc(FULL, stale, { out: 'STATUS.md' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale');
  assert.match(r.expected, /Nightly: ❌ ไม่ผ่าน/);
});

test('--check: เวลาผ่านไปไม่ทำให้ไฟล์เก่า (ใช้ generatedAt เดิมในไฟล์)', () => {
  const text = renderStatus(FULL, { generatedAt: '2020-01-01T00:00:00.000Z' });
  const r = checkStatusDoc(FULL, text, { out: 'STATUS.md' });
  assert.equal(r.ok, true);
});

// ── 4) CLI จริง ────────────────────────────────────────────────────────────
function seedRoot(dir) {
  mkdirSync(join(dir, 'sovereign-os', 'core-api', 'data'), { recursive: true });
  mkdirSync(join(dir, 'logs', 'nightly'), { recursive: true });
  writeFileSync(join(dir, 'sovereign-os', 'core-api', 'data', 'system-truth.json'), JSON.stringify(TRUTH), 'utf8');
  writeFileSync(join(dir, 'logs', 'nightly', 'status.json'), JSON.stringify(NIGHTLY), 'utf8');
  writeFileSync(join(dir, 'sovereign-os', 'core-api', 'data', 'ops-status.json'), JSON.stringify(OPS), 'utf8');
  writeFileSync(join(dir, 'sovereign-os', 'core-api', 'data', 'nightly-history.json'), JSON.stringify(HISTORY), 'utf8');
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
}

test('CLI: --check บนไฟล์ที่ไม่มี = exit 1 · --write แล้ว --check = exit 0', () => {
  const t = tempRoot({});
  try {
    seedRoot(t.dir);
    const out = join(t.dir, 'STATUS.md');
    const before = run(['--check', `--root=${t.dir}`, `--out=${out}`]);
    assert.equal(before.status, 1, `${before.stdout}${before.stderr}`);
    assert.match(`${before.stdout}${before.stderr}`, /ยังไม่มี|missing/i);

    const wrote = run(['--write', `--root=${t.dir}`, `--out=${out}`]);
    assert.equal(wrote.status, 0, `${wrote.stdout}${wrote.stderr}`);
    assert.ok(existsSync(out));

    const after = run(['--check', `--root=${t.dir}`, `--out=${out}`]);
    assert.equal(after.status, 0, `${after.stdout}${after.stderr}`);
  } finally {
    t.cleanup();
  }
});

test('CLI: --write สร้างโฟลเดอร์ปลายทางให้เอง และ --out= เขียนที่อื่นได้', () => {
  const t = tempRoot({});
  try {
    seedRoot(t.dir);
    const nested = join(t.dir, 'docs', 'generated', 'STATUS.md');
    const wrote = run(['--write', `--root=${t.dir}`, `--out=${nested}`]);
    assert.equal(wrote.status, 0, `${wrote.stdout}${wrote.stderr}`);
    assert.ok(existsSync(nested));
    assert.match(readFileSync(nested, 'utf8'), /ShipShop 23:59/);
    assert.equal(existsSync(join(t.dir, 'STATUS.md')), false, 'ห้ามเขียนทับไฟล์ดีฟอลต์เมื่อระบุ --out');
  } finally {
    t.cleanup();
  }
});

test('CLI: --check เป็นค่าดีฟอลต์ (ไม่ระบุโหมด = อ่านเท่านั้น)', () => {
  const t = tempRoot({});
  try {
    seedRoot(t.dir);
    const out = join(t.dir, 'STATUS.md');
    const r = run([`--root=${t.dir}`, `--out=${out}`]);
    assert.equal(r.status, 1, 'ยังไม่มีไฟล์ = 1 และต้องไม่สร้างไฟล์เอง');
    assert.equal(existsSync(out), false);
  } finally {
    t.cleanup();
  }
});

// ── 5) สภาพจริงในรีโป: STATUS.md ต้องสั้นและเป็น snapshot ───────────────────
test('STATUS.md ในรีโปเป็น snapshot สั้น ๆ ที่ gen จากเครื่องมือ (ไม่ใช่ journal)', () => {
  const status = join(ROOT, 'STATUS.md');
  assert.ok(existsSync(status), 'ต้องมี STATUS.md');
  const text = readFileSync(status, 'utf8');
  const lines = text.split('\n').length;
  assert.ok(lines <= 120, `STATUS.md ต้องสั้น (ตอนนี้ ${lines} บรรทัด) — ประวัติย้ายไป docs/history/`);
  assert.match(text, /node tools\/status-doc\.mjs --write/, 'ต้องมี marker ว่า gen จากเครื่องมือ');
  assert.match(text, /docs\/history\/status-journal-2026-10\.md/, 'ต้องลิงก์ไปประวัติเดิม');
  assert.match(text, /Quality gate:/);
  assert.match(text, /Nightly:/);
});

test('journal เดิมถูกย้ายไป docs/history/ ครบ (ไม่ใช่ถูกตัดทิ้ง)', () => {
  const archive = join(ROOT, 'docs', 'history', 'status-journal-2026-10.md');
  assert.ok(existsSync(archive), 'ต้องมี docs/history/status-journal-2026-10.md');
  const size = statSync(archive).size;
  assert.ok(size > 100_000, `ประวัติเดิมต้องอยู่ครบ (ตอนนี้ ${size} ไบต์)`);
  assert.match(readFileSync(archive, 'utf8'), /STATUS/, 'ต้องเป็น journal เดิม');
});
