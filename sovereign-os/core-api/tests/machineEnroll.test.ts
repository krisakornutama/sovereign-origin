// tests/machineEnroll.test.ts — กติกา "ลงทะเบียนเครื่องใหม่เอง" (เจ้าของสั่ง 11/10/69)
//
// ที่มาของงาน: เดิมเพิ่มเครื่องทีละเครื่อง (ออก join.json ที่ฝัง token)
//   เจ้าของสั่ง "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"
//   ⇒ เครื่องใหม่เอา "รหัสเชิญ" ไปขอ token ของตัวเอง
//
// ข้อที่เทสต์นี้ล็อกไว้:
//   1) ไม่ได้ตั้งรหัสเชิญ = ปิดช่องทาง (fail-closed) ไม่ใช่ "อนุญาตทุกคน"
//   2) รหัสผิด = ไม่รับ + นับครั้งล้มเหลว
//   3) รหัสถูก = รับ (แต่ role ที่ DB ให้ยังเป็น USER เสมอ — ดู agent-machine-hub.service)
//   4) ล้มเหลวเกินโควตา = พัก ไม่ใช่ลองต่อไปเรื่อยๆ
//   5) ไม่มีอะไรหลุดออกไปในข้อความ error (รหัสเชิญต้องไม่โผล่ใน log)
//
// ไฟล์นี้เป็นชั้น "ตัดสินใจ" ล้วน (pure) — ไม่ต้องมี DB (แบบ machineAccess.test.ts)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideEnroll,
  decideEnrollAttempt,
  safeEqual,
  sanitizeMachineName,
  normalizeExecutors,
  MAX_NAME_LENGTH,
  DEFAULT_MAX_FAILURES,
} from '../src/services/machine-enroll.service';

const CODE = 'รหัสเชิญลับ-1234';
const ESC = '\u001b';

describe('decideEnroll — ประตูลงทะเบียนเครื่องใหม่', () => {
  it('ไม่ได้ตั้งรหัสเชิญ = ปิด (fail-closed) ไม่ใช่เปิดให้ทุกคน', () => {
    assert.equal(decideEnroll({ expectedCode: '', code: '', name: 'คอม-1' }).decision, 'disabled');
    assert.equal(decideEnroll({ expectedCode: '   ', code: '   ', name: 'คอม-1' }).decision, 'disabled');
    assert.equal(decideEnroll({ expectedCode: null, code: null, name: 'คอม-1' }).decision, 'disabled');
  });

  it('รหัสเชิญถูก = รับ', () => {
    const v = decideEnroll({ expectedCode: CODE, code: CODE, name: 'คอม-3' });
    assert.equal(v.decision, 'accepted');
    assert.equal(v.failures, 0);
  });

  it('รหัสเชิญผิด = ไม่รับ + นับครั้งล้มเหลวเพิ่ม', () => {
    const v = decideEnroll({ expectedCode: CODE, code: 'ผิด', name: 'คอม-3', priorFailures: 2 });
    assert.equal(v.decision, 'bad_code');
    assert.equal(v.failures, 3);
  });

  it('รหัสผิดซ้ำจนเกินโควตา = พัก (rate_limited) ไม่ใช่ลองต่อ', () => {
    const v = decideEnroll({ expectedCode: CODE, code: 'ผิด', name: 'คอม-3', priorFailures: DEFAULT_MAX_FAILURES });
    assert.equal(v.decision, 'rate_limited');
    assert.equal(v.failures, DEFAULT_MAX_FAILURES);
  });

  it('ชื่อเครื่องขาด = คำขอเสีย ไม่ใช่รหัสผิด (ไม่นับเป็นครั้งล้ม)', () => {
    const v = decideEnroll({ expectedCode: CODE, code: CODE, name: '   ', priorFailures: 1 });
    assert.equal(v.decision, 'bad_request');
    assert.equal(v.failures, 1);
  });

  it('ชื่อเครื่องยาวเกินกำหนด = ปฏิเสธ', () => {
    const v = decideEnroll({ expectedCode: CODE, code: CODE, name: 'x'.repeat(MAX_NAME_LENGTH + 1) });
    assert.equal(v.decision, 'bad_request');
  });

  it('รหัสเชิญต้องไม่หลุดออกมาในข้อความ error (ไม่งั้นแวนต่อจาก log)', () => {
    const v = decideEnroll({ expectedCode: CODE, code: 'เดาผิด', name: 'คอม-3' });
    assert.ok(!v.reason.includes(CODE), 'ข้อความห้ามมีรหัสเชิญจริง');
    assert.ok(!v.reason.includes('เดาผิด'), 'ข้อความห้ามเอารหัสที่ผู้ยิงมากลับไป');
  });
});

describe('decideEnrollAttempt — รหัสเดิม + รหัสฝูง', () => {
  const FLEET = `enr_${'a'.repeat(48)}`;

  it('ไม่มีรหัสเดิมและไม่ได้ส่งรหัสฝูง = disabled', () => {
    assert.equal(decideEnrollAttempt({ expectedCode: '', code: 'อะไรก็ได้', name: 'คอม-1' }).action, 'disabled');
    assert.equal(decideEnrollAttempt({ expectedCode: null, code: null, name: 'คอม-1' }).action, 'disabled');
  });

  it('มีแต่รหัสฝูง (ไม่มีรหัสเดิม) = ไปทาง fleet', () => {
    const v = decideEnrollAttempt({
      expectedCode: '',
      code: FLEET,
      name: 'คอม-1',
      fleetTokenFormat: true,
    });
    assert.equal(v.action, 'fleet');
    assert.equal(v.name, 'คอม-1');
    assert.equal(v.failures, 0);
  });

  it('รหัสเดิมถูก = legacy (แม้ส่งรูปแบบ enr_ มาก็ไม่ consume)', () => {
    const v = decideEnrollAttempt({ expectedCode: FLEET, code: FLEET, name: 'คอม-1', fleetTokenFormat: true });
    assert.equal(v.action, 'legacy');
  });

  it('รหัสเดิมผิดและไม่ได้รูปแบบฝูง = bad_code + นับครั้ง', () => {
    const v = decideEnrollAttempt({ expectedCode: CODE, code: 'ผิด', name: 'คอม-1', priorFailures: 2 });
    assert.equal(v.action, 'bad_code');
    assert.equal(v.failures, 3);
  });

  it('เกินโควตาล้มเหลว = rate_limited แม้รหัสฝูงจะถูก', () => {
    const v = decideEnrollAttempt({
      expectedCode: '',
      code: FLEET,
      name: 'คอม-1',
      fleetTokenFormat: true,
      priorFailures: DEFAULT_MAX_FAILURES,
    });
    assert.equal(v.action, 'rate_limited');
    assert.equal(v.failures, DEFAULT_MAX_FAILURES);
  });

  it('ชื่อว่าง/ยาวเกิน = bad_request และไม่นับครั้งล้ม', () => {
    const blank = decideEnrollAttempt({ expectedCode: '', code: FLEET, name: '  ', fleetTokenFormat: true, priorFailures: 2 });
    assert.equal(blank.action, 'bad_request');
    assert.equal(blank.failures, 2);
    const long = decideEnrollAttempt({
      expectedCode: '',
      code: FLEET,
      name: 'x'.repeat(MAX_NAME_LENGTH + 1),
      fleetTokenFormat: true,
    });
    assert.equal(long.action, 'bad_request');
  });

  it('ข้อความ error ห้ามมีรหัสจริง', () => {
    const v = decideEnrollAttempt({ expectedCode: CODE, code: FLEET, name: 'คอม-1', fleetTokenFormat: true });
    assert.ok(!v.reason.includes(CODE));
    assert.ok(!v.reason.includes(FLEET));
  });
});

describe('safeEqual — กันเดาโดยวัดเวลา', () => {
  it('เท่ากัน = ผ่าน / ไม่เท่ากัน = ไม่ผ่าน', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual('abc', ''), false);
  });
});

describe('sanitizeMachineName — ทำความสะอาดชื่อก่อนลง DB', () => {
  it('ตัดอักขระควบคุมที่ทำให้ log/UI พัง (ESC เริ่มสี ANSI)', () => {
    assert.equal(sanitizeMachineName(`คอม${ESC}[31mงาน`), 'คอม[31mงาน');
  });

  it('ยุบช่องว่างซ้ำ + ตัดหัวท้าย', () => {
    assert.equal(sanitizeMachineName('  คอม   เครื่อง   3  '), 'คอม เครื่อง 3');
  });

  it('ตัดความยาวเกินกำหนด', () => {
    assert.equal(sanitizeMachineName('y'.repeat(200)).length, MAX_NAME_LENGTH);
  });
});

describe('normalizeExecutors', () => {
  it('ว่าง = ใช้ echo (runner ไม่มี agent ก็ยังลงทะเบียนได้)', () => {
    assert.deepEqual(normalizeExecutors([]), ['echo']);
    assert.deepEqual(normalizeExecutors(''), ['echo']);
    assert.deepEqual(normalizeExecutors(null), ['echo']);
  });

  it('รับได้ทั้งแบบรายการและแบบคั่นด้วย comma', () => {
    assert.deepEqual(normalizeExecutors(['echo', 'screenshot']), ['echo', 'screenshot']);
    assert.deepEqual(normalizeExecutors('echo, screenshot'), ['echo', 'screenshot']);
  });
});