// appVersion — "/api/health ต้องบอกได้ว่ากำลังตอบด้วยโค้ดรุ่นไหน"
//
// เจอของจริง 12/11/69: พอร์ต 3001 ถูกคอนเทนเนอร์ Docker (image เก่า) ยึดไว้
// ⇒ แอปเดสก์ท็อปที่ติดตั้ง 1.3.2 คุยกับ API รุ่นเก่าโดยไม่มีใครรู้ (/api/ota/legacy-clients = 404)
// health ที่บอกแค่ fingerprint ไม่พอ เพราะเทียบข้ามรุ่นไม่ได้ — ต้องมี version ตรง ๆ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { appVersion, readVersionFromPackageJson } from '../src/lib/app-version';

test('readVersionFromPackageJson: อ่าน version ที่ถูกต้อง และไม่โยนเมื่อข้อมูลเพี้ยน', () => {
  assert.equal(readVersionFromPackageJson('{"version":"1.3.2"}'), '1.3.2');
  assert.equal(readVersionFromPackageJson('{"version":" 1.3.2 "}'), '1.3.2');
  assert.equal(readVersionFromPackageJson('{"name":"x"}'), null);
  assert.equal(readVersionFromPackageJson('{"version":123}'), null);
  assert.equal(readVersionFromPackageJson('not json'), null);
  assert.equal(readVersionFromPackageJson(''), null);
});

test('appVersion: คืน version ของ core-api ที่โปรเซสนี้โหลดอยู่', () => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const expected = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  const got = appVersion();
  assert.equal(got, expected, 'ต้องตรงกับ package.json ของ core-api');
  assert.match(String(got), /^\d+\.\d+\.\d+/);
});
