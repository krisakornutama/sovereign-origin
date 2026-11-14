// log-once: ตอน DB ใช้ไม่ได้ แอปต้องบอกเหตุครั้งเดียว ไม่สแปม stderr ทุกคำขอ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogOnce, installErrorDedupe, oneLine } from '../src/lib/log-once.js';

function harness(windowMs = 300_000) {
  let now = 1_000_000;
  const out: string[] = [];
  const logOnce = createLogOnce({ windowMs, now: () => now, log: (m) => out.push(m) });
  return { out, logOnce, advance: (ms: number) => (now += ms) };
}

test('ครั้งแรกพิมพ์เต็ม ส่วนครั้งต่อไปที่ซ้ำกันถูกกลืน', () => {
  const { out, logOnce } = harness();
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  logOnce('anomaly', 'Failed to record anomaly: table missing');
  assert.equal(out.length, 1);
  assert.equal(out[0], 'Failed to record anomaly: table missing');
});

test('เมื่อผ่านหน้าต่างเวลา ออกสรุปพร้อมจำนวนที่กลืนไป', () => {
  const { out, logOnce, advance } = harness(60_000);
  logOnce('anomaly', 'boom');
  logOnce('anomaly', 'boom');
  logOnce('anomaly', 'boom');
  advance(60_001);
  logOnce('anomaly', 'boom');
  assert.equal(out.length, 2);
  assert.match(out[1], /^boom — ซ้ำ 2 ครั้ง/);
});

test('key ต่างกันนับแยก และสรุปของ key หนึ่งไม่กลืนของอีก key', () => {
  const { out, logOnce } = harness();
  logOnce('a', 'A1');
  logOnce('b', 'B1');
  logOnce('a', 'A1');
  assert.deepEqual(out, ['A1', 'B1']);
});

test('ข้อความที่เปลี่ยนไปภายใต้ key เดียวกันยังถูกกลืน (กันสแปมจาก error ที่มี id)', () => {
  const { out, logOnce } = harness();
  logOnce('anomaly', 'id 1');
  logOnce('anomaly', 'id 2');
  assert.equal(out.length, 1);
});

test('installErrorDedupe: console.error ที่ซ้ำถูกกลืน แต่ข้อความอื่นยังผ่าน', () => {
  const seen: string[] = [];
  const fake = { error: (...args: unknown[]) => seen.push(args.join(' ')) };
  const restore = installErrorDedupe(fake);
  fake.error('Coding queue error: PrismaClientKnownRequestError:', 'table missing');
  fake.error('Coding queue error: PrismaClientKnownRequestError:', 'table missing');
  fake.error('Agent queue error: PrismaClientKnownRequestError:', 'table missing');
  assert.equal(seen.length, 2);
  assert.match(seen[0], /Coding queue error/);
  assert.match(seen[1], /Agent queue error/);
  restore();
  fake.error('Coding queue error: PrismaClientKnownRequestError:', 'again');
  assert.equal(seen.length, 3);
});

test('installErrorDedupe: บรรทัดแรกเหมือนกันแต่รายละเอียดต่างกัน ยังถูกกลืน (Prisma พิมพ์ stack ยาว)', () => {
  const seen: string[] = [];
  const fake = { error: (...args: unknown[]) => seen.push(args.join(' ')) };
  installErrorDedupe(fake);
  fake.error('Power guard: cannot load energy state:\n  relation "sensor_telemetry" does not exist');
  fake.error('Power guard: cannot load energy state:\n  relation "other" does not exist');
  assert.equal(seen.length, 1);
});

test('oneLine: ยุบหลายบรรทัดเป็นบรรทัดเดียว เก็บหัวและท้าย', () => {
  const prisma = [
    '',
    'Invalid `prisma_1.prisma.kidProfile.findMany()` invocation in',
    'E:\\app\\dist\\services\\teach-kids-allowance.js:47:20',
    '',
    '  46 async function payWeeklyAllowances() {',
    '-> 47   const kids = await prisma.kidProfile.findMany(',
    'The table `public.kid_profiles` does not exist in the current database.',
  ].join('\n');
  const out = oneLine(prisma);
  assert.ok(!out.includes('\n'), 'ต้องไม่มีบรรทัดใหม่');
  assert.match(out, /^Invalid/);
  assert.match(out, /public\.kid_profiles/);
  assert.ok(out.length < 300);
});

test('installErrorDedupe: ข้อความหลายบรรทัดถูกส่งออกเป็นบรรทัดเดียว', () => {
  const seen: string[] = [];
  const fake = { error: (...args: unknown[]) => seen.push(args.join(' ')) };
  installErrorDedupe(fake);
  fake.error(
    'Coding queue error:',
    new Error('Invalid `prisma.x` invocation in\nfile.js:1\n\nThe table `public.coding_jobs` does not exist')
  );
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes('\n'));
  assert.match(seen[0], /public\.coding_jobs/);
});
