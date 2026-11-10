// "IP ของผู้เรียก" ในโมดูล agent-machines — ต้องปลอมไม่ได้
//
// callerIp() เดิมอ่าน x-forwarded-for ตัวแรกเอง (split(',')[0]) ซึ่งเป็นค่าที่ client
// ใส่เข้ามาได้เสมอ ไม่ว่าจะมี proxy จริงหรือไม่ ⇒ IP ที่โชว์ในหน้า HUB ปลอมได้ และ
// ตัวนับล้มเหลวของ POST /enroll ก็ไปกองที่ "IP" ที่ผู้โจมตีเลือก (สลับค่า = ไม่ถูกนับ)
// · เมื่อผู้ดูแลตั้ง TRUST_PROXY แล้ว Express เลือก hop ที่ควรเชื่อให้อยู่แล้ว
//   การหยิบตัวแรกซ้ำจึงผิดทั้งความหมายและความปลอดภัย
//
// สัญญาใหม่: ใช้ req.ip (หรือ peer ของ socket) แล้ว normalize รูป ::ffff: ออก
// — อ่าน header ตรง ๆ ไม่มีอีก
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { callerIp } from '../src/modules/agent-machines/agent-machines.shared';

function fakeReq(ip: string | undefined, headers: Record<string, string> = {}): Request {
  return { headers, ip, socket: { remoteAddress: ip } } as unknown as Request;
}

test('X-Forwarded-For ที่ client ใส่เองต้องไม่มีผล', () => {
  const req = fakeReq('203.0.113.9', { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' });
  assert.equal(callerIp(req), '203.0.113.9');
});

test('ไม่มี header เลยก็ยังคืน IP ของ peer', () => {
  assert.equal(callerIp(fakeReq('198.51.100.7')), '198.51.100.7');
});

test('ตัดรูป ::ffff: ให้เหลือ IPv4 อ่านง่าย', () => {
  assert.equal(callerIp(fakeReq('::ffff:192.0.2.44')), '192.0.2.44');
});

test('ไม่มี IP เลยคืนค่าว่าง ไม่ใช่ "undefined"', () => {
  assert.equal(callerIp(fakeReq(undefined)), '');
});

test('โค้ดของ callerIp ไม่อ่าน header x-forwarded-for อีก (ด่าน static)', () => {
  const file = path.resolve(__dirname, '../src/modules/agent-machines/agent-machines.shared.ts');
  const src = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  assert.ok(!src.includes("x-forwarded-for"), 'ห้ามอ่าน header นี้เอง');
  assert.ok(src.includes('normalizePeerAddress('), 'ต้อง normalize ผ่าน helper กลาง');
});
