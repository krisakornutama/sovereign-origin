// เทสต์สัญญา "เขียน JSON + sidecar .sha256" ของ host tools
//
// ทำไมต้องมี: data-integrity.service.ts สแกน data/*.json ทุก boot + ทุกสัปดาห์
// ถ้า sidecar ไม่ตรงกับเนื้อไฟล์ → ระบบตีเป็น BIT_ROT (critical) + quarantine สำเนา
// เจอจริง 276 ไฟล์ .corrupt-* เพราะ tools เขียน JSON ตรง ๆ (nightly/ops-status/system-truth)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonWithChecksum } from '../json-checksum.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-checksum-'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

describe('writeJsonWithChecksum — sidecar ต้องตรงกับเนื้อไฟล์เป๊ะ', () => {
  test('เขียนไฟล์ + sidecar ที่ hash ตรงกับเนื้อจริง (ผู้อ่าน core-api ตรวจผ่าน)', () => {
    const file = path.join(dir, 'state.json');
    const data = { ok: true, steps: [{ name: 'a', ok: true }], n: 3 };
    const body = writeJsonWithChecksum(file, data);

    assert.ok(fs.existsSync(file));
    assert.ok(fs.existsSync(`${file}.sha256`), 'ต้องมี sidecar');
    assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8').trim(), sha(body));
    assert.equal(fs.readFileSync(file, 'utf8'), body, 'body ที่คืนค่าต้องเป็นไบต์เดียวกับที่เขียน');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
  });

  test('pretty=false → JSON แถวเดียว แต่ sidecar ยังตรง', () => {
    const file = path.join(dir, 'one-line.json');
    const body = writeJsonWithChecksum(file, { a: 1 }, { pretty: false });
    assert.ok(!body.includes('\n'));
    assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8').trim(), sha(body));
  });

  test('เขียนทับไฟล์เดิมได้ และไม่มี .tmp ค้าง', () => {
    const file = path.join(dir, 'rewrite.json');
    writeJsonWithChecksum(file, { v: 1 });
    const body = writeJsonWithChecksum(file, { v: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 2 });
    assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8').trim(), sha(body));
    assert.equal(fs.existsSync(`${file}.tmp`), false, 'ต้อง rename ทิ้ง tmp');
  });

  test('เนื้อไฟล์ที่ถูกแก้ทีหลังโดยไม่อัปเดต sidecar = จับได้ (ไม่กลืน bit rot)', () => {
    const file = path.join(dir, 'rot.json');
    writeJsonWithChecksum(file, { value: 1 });
    const expected = fs.readFileSync(`${file}.sha256`, 'utf8').trim();
    fs.writeFileSync(file, '{"value":0}');
    assert.notEqual(sha(fs.readFileSync(file, 'utf8')), expected, 'checksum ต้องไม่ตรง = ตรวจ rot ได้');
  });
});
