// IP spoofing ผ่าน X-Forwarded-For — "ใครก็เป็น 127.0.0.1 ได้" ถ้า API เปิดตรง
//
// server.ts ตั้ง `trust proxy = 1` ตายตัว ⇒ Express จะเชื่อ X-Forwarded-For ที่ client
// ส่งมาเอง แล้วเอาไปเป็น req.ip. ผลที่ตามมาเมื่อ API เข้าถึงได้ตรง (ชุมชนตั้ง API_BIND=0.0.0.0
// เพราะเบราว์เซอร์ใน LAN ยิง :3001 ตรง — compose ไม่มี reverse proxy คั่น):
//   1) rate limit ที่คิดตาม IP (login / MFA / register) หลบได้ด้วยการสลับ header ทุกครั้ง
//   2) audit log บันทึก IP ปลอม ⇒ ตรวจย้อนไม่ได้
//   3) /api/client-monitor/synthetic-round ที่ให้ผ่านเมื่อ "req.ip เป็น loopback"
//      เปิดให้คนนอกยิงได้โดยไม่ต้องมี SYNTHETIC_ROUND_TOKEN ⇒ ปลอมผล synthetic check
//      (ยัด PASS รัว ๆ เพื่อกลบ FAIL จริง = ปิดปากการเตือน critical)
//
// เทสต์นี้ยึดสัญญา 3 ข้อ:
//   - ค่าเริ่มต้น "ไม่เชื่อ proxy" (trust proxy = false) ⇒ X-Forwarded-For ไม่มีผลกับ req.ip
//   - เปิดเชื่อ proxy ได้เฉพาะเมื่อตั้ง TRUST_PROXY ชัดเจน และค่าที่ไม่รู้จัก = ปิด (fail closed)
//   - ด่าน loopback ของ synthetic-round ตัดสินจาก peer ของ TCP จริง ไม่ใช่ req.ip
//     และเมื่อเปิด trust proxy แล้วจะไม่ถือว่า loopback (เพราะ peer ทุกคนคือ proxy)
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Express, Request } from 'express';
import { createTestServer } from './helpers';
import { isLoopbackClient, isLoopbackPeer, resolveTrustProxy } from '../src/lib/net';

function fakeReq(remoteAddress?: string, forwardedFor?: string): Request {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress },
  } as unknown as Request;
}

test('TRUST_PROXY ที่ไม่ตั้ง/ว่าง = ไม่เชื่อ header (ค่าเริ่มต้นต้องปลอดภัย)', () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(''), false);
  assert.equal(resolveTrustProxy('   '), false);
});

test('ค่าที่ปิด proxy ต้องได้ false (ทั้งแบบที่คนมักเขียน)', () => {
  for (const raw of ['0', 'false', 'off', 'no', 'none']) {
    assert.equal(resolveTrustProxy(raw), false, `TRUST_PROXY=${raw}`);
  }
});

test('ค่าที่ไม่รู้จัก = ปิด (fail closed) ไม่ใช่เชื่อทุก hop', () => {
  // 'true' ใน Express แปลว่า "เชื่อทุก hop" — dangerous ทั้งที่ดูเหมือนเปิดถูกต้อง
  for (const raw of ['true', 'yes', 'all', '*', 'abc', '1.5', '-1']) {
    assert.equal(resolveTrustProxy(raw), false, `TRUST_PROXY=${raw}`);
  }
});

test('จำนวน hop ที่ชัดเจนและ loopback ยังตั้งได้', () => {
  assert.equal(resolveTrustProxy('1'), 1);
  assert.equal(resolveTrustProxy('2'), 2);
  assert.equal(resolveTrustProxy(' loopback '), 'loopback');
  assert.equal(resolveTrustProxy('LOOPBACK'), 'loopback');
});

test('isLoopbackPeer รู้จัก loopback จริงเท่านั้น (รวมรูป ::ffff:)', () => {
  for (const raw of ['127.0.0.1', '::ffff:127.0.0.1', '::1', '127.0.0.5', '::ffff:127.9.9.9']) {
    assert.equal(isLoopbackPeer(raw), true, raw);
  }
  for (const raw of [undefined, '', '203.0.113.9', '::ffff:203.0.113.9', '10.0.0.5', 'localhost']) {
    assert.equal(isLoopbackPeer(raw), false, String(raw));
  }
});

test('ด่าน loopback ไม่รับฟัง header: peer นอก + XFF 127.0.0.1 ต้องไม่ผ่าน', () => {
  const spoofed = fakeReq('203.0.113.9', '127.0.0.1');
  assert.equal(isLoopbackClient(spoofed, false), false);
});

test('ด่าน loopback ผ่านเฉพาะ client ที่มาจาก loopback จริงและไม่ได้อยู่หลัง proxy', () => {
  assert.equal(isLoopbackClient(fakeReq('127.0.0.1'), false), true);
  assert.equal(isLoopbackClient(fakeReq('::ffff:127.0.0.1'), false), true);
  // เปิด proxy เมื่อไร peer ทุกคน = proxy ⇒ ต้องไม่ถือว่าเป็น loopback (บังคับใช้ token)
  assert.equal(isLoopbackClient(fakeReq('127.0.0.1'), 1), false);
  assert.equal(isLoopbackClient(fakeReq('127.0.0.1'), 'loopback'), false);
});

test('ค่าเริ่มต้นของแอป: X-Forwarded-For ปลอมต้องไม่เปลี่ยน req.ip', async () => {
  let seen = '';
  const server = await createTestServer((app: Express) => {
    app.set('trust proxy', resolveTrustProxy(undefined));
    app.get('/whoami', (req, res) => {
      seen = String(req.ip);
      res.json({ ip: req.ip });
    });
  });
  try {
    const res = await fetch(`${server.baseUrl}/whoami`, {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    assert.equal(res.status, 200);
    assert.equal(seen, '127.0.0.1', 'req.ip ต้องเป็น peer จริง ไม่ใช่ค่าจาก header');
  } finally {
    await server.close();
  }
});

test('เมื่อตั้ง TRUST_PROXY=1 อย่างจงใจ แอปจึงเชื่อ header (พฤติกรรมที่ต้องประกาศให้ชัด)', async () => {
  let seen = '';
  const server = await createTestServer((app: Express) => {
    app.set('trust proxy', resolveTrustProxy('1'));
    app.get('/whoami', (req, res) => {
      seen = String(req.ip);
      res.json({ ip: req.ip });
    });
  });
  try {
    await fetch(`${server.baseUrl}/whoami`, { headers: { 'x-forwarded-for': '203.0.113.7' } });
    assert.equal(seen, '203.0.113.7');
  } finally {
    await server.close();
  }
});

test('synthetic-round ต้องไม่ตัดสิน loopback จาก req.ip อีก (ด่าน static กันถดถอย)', () => {
  const file = path.resolve(__dirname, '../src/modules/system/client-monitor.routes.ts');
  // ตัดคอมเมนต์ออกก่อน — คอมเมนต์อธิบายเหตุผลได้ แต่โค้ดต้องไม่อ่าน req.ip
  const src = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    src.includes('isLoopbackClient('),
    'route ต้องใช้ isLoopbackClient() ที่ตัดสินจาก peer ของ socket',
  );
  assert.ok(!src.includes('req.ip'), 'route ต้องไม่อ่าน req.ip อีก (ค่านั้นมาจาก header ได้)');
});
