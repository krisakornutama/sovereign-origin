// เทสต์ของตัวบันทึก log ขั้นที่พังใน verify
//
// เหตุผล: `tools/verify.mjs` เดิมกลืน stdout/stderr ของขั้นที่พัง (พิมพ์แค่ "พัง (exit 1)")
// เคสจริง 17/11/69: `tools: unit tests` ล้มครั้งแรกติดกัน 3 verify run แล้วผ่านตอน flake guard
// แต่ไม่มีใครรู้ว่าชั้นไหนล้มเพราะอะไร ⇒ ต้องมีตัวเขียน log + พิมพ์ท้าย output ทุกครั้งที่พัง
//
// เทสต์นี้ล็อกพฤติกรรม 4 ข้อ:
//   1. เขียน output เต็ม (stdout+stderr) ลงไฟล์
//   2. พิมพ์เฉพาะท้าย (≤ 40 บรรทัด) ออกจอ ไม่ท่วม terminal
//   3. ตั้งชื่อไฟล์ตามชื่อขั้น (อ่านง่าย) และไม่ทับกันเมื่อพังหลายครั้ง
//   4. ห้าม throw แม้เขียนไฟล์ไม่ได้ (ด่านที่กำลังจะรายงานผลต้องไม่ล้มเพราะ log)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dumpVerifyFailure } from '../verify-fail-log.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fail-'));
}

test('เขียน output เต็มลงไฟล์ และพิมพ์แค่ 40 บรรทัดท้าย', () => {
  const dir = tmpDir();
  const lines = Array.from({ length: 120 }, (_, i) => `line-${i + 1}`);
  const printed = [];
  const file = dumpVerifyFailure(
    { name: 'tools: unit tests (node --test)', stdout: lines.join('\n'), stderr: 'stderr-ท้าย' },
    { dir, now: 1_700_000_000_000, log: (s) => printed.push(s) }
  );

  assert.ok(file, 'ต้องคืน path ของ log');
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(saved.includes('line-1\n'), 'ต้องเก็บ output ตั้งแต่บรรทัดแรก');
  assert.ok(saved.includes('line-120'), 'ต้องเก็บ output ถึงบรรทัดสุดท้าย');
  assert.ok(saved.includes('stderr-ท้าย'), 'ต้องเก็บ stderr ด้วย');

  const text = printed.join('\n');
  assert.ok(text.includes('line-120'), 'ต้องพิมพ์ท้าย output ออกจอ');
  assert.ok(!text.includes('line-1\n'), 'ต้องไม่พิมพ์ทั้งหมด (เอาท้ายเท่านั้น)');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ชื่อไฟล์บอกขั้นที่พัง และไม่ทับกันเมื่อพังซ้ำ', () => {
  const dir = tmpDir();
  const a = dumpVerifyFailure({ name: 'backend: test', stdout: 'a' }, { dir, now: 1, log: () => {} });
  const b = dumpVerifyFailure({ name: 'backend: test', stdout: 'b' }, { dir, now: 2, log: () => {} });
  assert.notEqual(a, b, 'พังซ้ำต้องได้ไฟล์ใหม่ ไม่ทับของเดิม');
  assert.match(path.basename(a), /backend-test/, 'ชื่อไฟล์ต้องบอกชื่อขั้น');
  assert.ok(fs.existsSync(a) && fs.existsSync(b));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('สร้างโฟลเดอร์ให้เองถ้ายังไม่มี', () => {
  const base = tmpDir();
  const dir = path.join(base, 'nested', 'logs');
  const file = dumpVerifyFailure({ name: 'x', stdout: 'y' }, { dir, now: 3, log: () => {} });
  assert.ok(fs.existsSync(file), 'ต้องสร้างโฟลเดอร์และเขียนไฟล์ได้');
  fs.rmSync(base, { recursive: true, force: true });
});

test('เก็บ metadata ของขั้นที่พังไว้ด้วย (cmd/status/signal/error) — เคส log 0 ไบต์', () => {
  const dir = tmpDir();
  const meta = [
    '# step: tools: unit tests (node --test)',
    '# cmd: npm run test:tools',
    '# status=1 signal=- error=-',
    '# output: stdout=0B stderr=0B',
  ].join('\n');
  const file = dumpVerifyFailure(
    { name: 'tools: unit tests (node --test)', stdout: '', stderr: '', meta },
    { dir, now: 5, log: () => {} }
  );
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(saved.includes('# status=1'), 'ต้องเก็บ status ไว้ดู');
  assert.ok(saved.includes('# output: stdout=0B stderr=0B'), 'ต้องบอกขนาด output (0 ไบต์ = spawn ล้ม ไม่ใช่เทสต์พัง)');
  assert.ok(saved.includes('# cmd: npm run test:tools'), 'ต้องเก็บคำสั่งที่รัน');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('เขียนไฟล์ไม่ได้ก็ต้องไม่ throw (คืน null) และยังพิมพ์ให้เห็น', () => {
  const printed = [];
  // dir ชี้ไปที่ path ของ "ไฟล์" ไม่ใช่โฟลเดอร์ → mkdirSync/writeFileSync ต้องล้ม
  const base = tmpDir();
  const blocker = path.join(base, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const res = dumpVerifyFailure(
    { name: 'boom', stdout: 'hello' },
    { dir: path.join(blocker, 'sub'), now: 4, log: (s) => printed.push(s) }
  );
  assert.equal(res, null, 'เขียนไม่ได้ต้องคืน null ไม่ใช่โยน error');
  assert.ok(printed.join('\n').includes('hello'), 'ยังต้องพิมพ์ท้าย output ให้เห็น');
  fs.rmSync(base, { recursive: true, force: true });
});
