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
