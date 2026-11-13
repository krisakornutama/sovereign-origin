// desktop-backend-port — แอปต้องไม่คุยกับ API ของคนอื่นโดยไม่รู้ตัว
//
// เคสจริง 12/11/69: sidecar spawn ด้วย PORT=3001 ตายตัว + stdio ignore ⇒ พอร์ตถูก
// คอนเทนเนอร์ image เก่ายึด sidecar ตายเงียบ และแอป v1.3.2 คุยกับ API รุ่นเก่า
// (/api/ota/legacy-clients = 404) โดยไม่มีสัญญาณเตือนใด ๆ
//
// เขียนก่อน implementation (red-first): ไฟล์ ../backend-port.mjs ยังไม่มีตอนรันรอบแรก
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePortOccupant,
  findFreePort,
  parseHealthVersion,
  apiUrlFor,
  applyApiUrl,
} from '../../sovereign-frontend/electron/backend-port.cjs';

test('parseHealthVersion: อ่าน version จาก health ที่เราควบคุมรูปได้ และไม่โยนเมื่อเพี้ยน', () => {
  assert.equal(parseHealthVersion('{"status":"ok","build":{"version":"1.3.2"}}'), '1.3.2');
  assert.equal(parseHealthVersion({ build: { version: '1.3.2' } }), '1.3.2');
  assert.equal(parseHealthVersion({ status: 'ok' }), null, 'build ไม่มี version = null');
  assert.equal(parseHealthVersion('not json'), null);
  assert.equal(parseHealthVersion(''), null);
  assert.equal(parseHealthVersion(null), null);
});

test('evaluatePortOccupant: แยก "ว่าง" / "ของเรา" / "ของคนอื่น" ให้ชัด', () => {
  assert.equal(evaluatePortOccupant({ listening: false, healthVersion: null, bundledVersion: '1.3.2' }), 'free');
  assert.equal(evaluatePortOccupant({ listening: true, healthVersion: '1.3.2', bundledVersion: '1.3.2' }), 'own-api');
  assert.equal(evaluatePortOccupant({ listening: true, healthVersion: '1.2.0', bundledVersion: '1.3.2' }), 'foreign-api');
  // build รุ่นเก่าไม่มี version เลย ⇒ พิสูจน์ไม่ได้ว่าเป็นของเรา ต้องถือว่าของคนอื่น
  assert.equal(evaluatePortOccupant({ listening: true, healthVersion: null, bundledVersion: '1.3.2' }), 'foreign-api');
  // ไม่รู้ version ที่ฝังในตัวแอป ⇒ ห้ามเดาว่าใช่ของเรา
  assert.equal(evaluatePortOccupant({ listening: true, healthVersion: '1.3.2', bundledVersion: null }), 'foreign-api');
});

test('findFreePort: เลือกพอร์ตว่างถัดไป และคืน null เมื่อเต็มช่วง', async () => {
  const taken = new Set([3001, 3002]);
  const free = await findFreePort({ candidates: [3001, 3002, 3003], isFree: async (p) => !taken.has(p) });
  assert.equal(free, 3003);

  const none = await findFreePort({ candidates: [3001, 3002], isFree: async () => false });
  assert.equal(none, null);
});

// ค่าใน localStorage เคยถูกเขียนไว้ครั้งเดียวแล้วไม่มีใครล้าง: รอบที่แอปหันไปพอร์ตสำรอง
// 3011 แล้ว รอบถัดไปถ้าไม่ spawn (หรือกลับมาใช้ 3001) renderer ยังชี้ไปที่ API ที่ตาย
test('apiUrlFor: 3001 = ใช้ค่าเริ่มต้น (ล้าง key), พอร์ตสำรอง = URL เต็ม', () => {
  assert.equal(apiUrlFor(3001), null);
  assert.equal(apiUrlFor(3011), 'http://localhost:3011');
  assert.equal(apiUrlFor(3020), 'http://localhost:3020');
  assert.equal(apiUrlFor(null), null);
});

test('applyApiUrl: พอร์ตสำรองเขียน URL, กลับมา 3001 ต้องล้าง key ที่ค้าง', async () => {
  const calls = [];
  const target = { executeJavaScript: async (js) => { calls.push(js); } };
  await applyApiUrl(target, 3011);
  assert.match(calls[0], /setItem\('sovereign-api-url','http:\/\/localhost:3011'\)/);
  await applyApiUrl(target, 3001);
  assert.match(calls[1], /removeItem\('sovereign-api-url'\)/);
  await applyApiUrl(null, 3011); // ไม่มีหน้าต่าง = ไม่โยน
  await applyApiUrl({}, 3011);
  assert.equal(calls.length, 2);
});
