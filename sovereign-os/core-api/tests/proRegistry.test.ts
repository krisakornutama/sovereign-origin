// ขั้น A ของการแยก Open-Core: routes ต้องไม่รู้จักโมดูล Pro อีกต่อไป
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRO_MOUNTS, moduleNotAvailable } from '../src/modules/pro/registry';

test('Pro registry มีครบ 8 เส้นตามที่ routes.ts เคยมองเห็น', () => {
  const paths = PRO_MOUNTS.map((m) => m.path);
  assert.deepEqual(paths, [
    '/api/business',
    '/api/fleet',
    '/api/portfolio',
    '/api/treasury',
    '/api/dime',
    '/api/payments/slips',
    '/api/payments',
    '/api/restaurant',
  ]);
});

test('slips ต้องมาก่อน payments (Express จับตามลำดับ)', () => {
  const slips = PRO_MOUNTS.findIndex((m) => m.path === '/api/payments/slips');
  const payments = PRO_MOUNTS.findIndex((m) => m.path === '/api/payments');
  assert.ok(slips >= 0 && payments >= 0);
  assert.ok(slips < payments, 'slips ต้องถูก mount ก่อน');
});

test('ทุกเส้นมีไฟล์ route และ key ไม่ซ้ำ', () => {
  const keys = new Set<string>();
  for (const m of PRO_MOUNTS) {
    assert.ok(m.file.startsWith('../'), `${m.key}: file ต้องอ้างจากโฟลเดอร์ pro/`);
    assert.ok(!keys.has(m.key), `key ซ้ำ: ${m.key}`);
    keys.add(m.key);
  }
});

test('โมดูลที่ไม่มีอยู่ต้องตอบ 404 พร้อมบอกชื่อโมดูล (ไม่ใช่ 500)', () => {
  let status = 0;
  let body: any = null;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: any) { body = payload; return this; },
  } as any;
  moduleNotAvailable('business')({} as any, res);
  assert.equal(status, 404);
  assert.equal(body.module, 'business');
  assert.match(body.error, /Community Edition/);
});
