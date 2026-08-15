// tests/warRoom.test.ts — War Room Activity Gate (ข้อ 3: Event-Driven Simulation หลับ-ตื่น)
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  warRoomActive, warRoomPulse, warRoomSessionOpened, warRoomSessionClosed, warRoomStatus,
  __setClock, __reset,
} from '../src/services/war-room.service';

const GRACE = 10 * 60 * 1000;
let fake = Date.now();

function advance(ms: number): void {
  fake += ms;
  __setClock(() => fake);
}

describe('War Room Activity Gate', () => {
  beforeEach(() => {
    __reset();
    fake = Date.now();
    __setClock(() => fake);
  });

  test('พึ่ง boot: active อยู่ (เพิ่งมี activity)', () => {
    assert.equal(warRoomActive(), true);
  });

  test('ไม่มี activity เกิน grace 10 นาที → หลับ', () => {
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false);
    assert.equal(warRoomStatus().active, false);
  });

  test('pulse (API activity) → ตื่นและ reset idle', () => {
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false);
    warRoomPulse();
    assert.equal(warRoomActive(), true);
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false); // pulse หนึ่งครั้งกันหลับได้แค่ grace
  });

  test('SSE session เปิด → ตื่นทันที แม้ idle เกิน grace', () => {
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false);
    warRoomSessionOpened();
    assert.equal(warRoomActive(), true);
    assert.equal(warRoomStatus().activeSessions, 1);
  });

  test('SSE session ปิด → กลับหลับหลัง grace (session เดียว)', () => {
    advance(GRACE + 1000);
    warRoomSessionOpened();
    assert.equal(warRoomActive(), true);
    warRoomSessionClosed();
    assert.equal(warRoomStatus().activeSessions, 0);
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false);
  });

  test('ปิด session ไม่เกิน 0 (session ไม่ติดลบ)', () => {
    advance(GRACE + 1000);
    warRoomSessionClosed();
    warRoomSessionClosed();
    assert.equal(warRoomStatus().activeSessions, 0);
  });

  test('2 sessions เปิด → ปิด 1 ยังตื่น (มีอีก session อยู่); ปิดครบ → หลับหลัง grace', () => {
    warRoomSessionOpened();
    warRoomSessionOpened();
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), true);
    warRoomSessionClosed();
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), true); // เหลือ 1 session → ยังตื่น
    warRoomSessionClosed();
    advance(GRACE + 1000);
    assert.equal(warRoomActive(), false); // ครบ 2 → หลับหลัง grace
  });

  test('status: idleSeconds เพิ่มตามเวลา', () => {
    advance(30 * 1000);
    const s = warRoomStatus();
    assert.ok(s.idleSeconds >= 30);
    assert.equal(typeof s.lastActivityAt, 'number');
    assert.equal(s.idleGraceMs, GRACE);
  });
});