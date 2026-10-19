// เทสต์ behavi: system-truth ต้องถูกเขียน "แม้เกตล้ม" และต้องไม่โกหกว่าผ่าน
//
// เคสจริง 19/10/69: verify เขียน system-truth เฉพาะตอนจบสำเร็จ → tools test ล้มครั้งเดียว
// = ไฟล์ไม่ถูกเขียนเลย → nightly อ่าน lastGateOk = null ติดกัน 11 รอบ (5–18 ต.ค.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTruth, writeSystemTruth } from '../verify-truth.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-truth-'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

// dist ปลอมสำหรับ fingerprint (ต้องมีไฟล์จริง)
const dist = path.join(dir, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'server.js'), 'console.log(1)\n');

describe('system-truth — ผลเกตล่าสุดต้องลงดิสก์ทุกเส้นทาง', () => {
  test('results ว่าง = ok:false (ไม่ใช่ผ่านโดยปริยาย) + เขียนไฟล์/ sidecar ครบ', () => {
    const truthPath = path.join(dir, 'empty.json');
    const data = writeSystemTruth({ results: [], truthPath, deployDist: dist });

    assert.equal(data.ok, false, 'ยังไม่ได้รันอะไร = ต้องไม่ผ่าน');
    assert.deepEqual(data.steps, []);
    assert.ok(fs.existsSync(truthPath));
    const body = fs.readFileSync(truthPath, 'utf8');
    assert.equal(fs.readFileSync(`${truthPath}.sha256`, 'utf8').trim(), sha(body));
    assert.equal(JSON.parse(body).ok, false);
    assert.equal(typeof data.prodTruth.diskFingerprint, 'string');
  });

  test('ทุก step ผ่าน = ok:true', () => {
    const data = buildTruth({
      results: [{ name: 'a', ok: true }, { name: 'b', ok: true, skipped: true }],
      truthPath: path.join(dir, 'none.json'),
      deployDist: dist,
    });
    assert.equal(data.ok, true);
    assert.deepEqual(data.steps, [
      { name: 'a', ok: true, skipped: false },
      { name: 'b', ok: true, skipped: true },
    ]);
  });

  test('step ใดล้ม = ok:false และเก็บรายละเอียด step ไว้', () => {
    const data = buildTruth({
      results: [{ name: 'arch', ok: true }, { name: 'tools', ok: false }],
      truthPath: path.join(dir, 'fail.json'),
      deployDist: dist,
    });
    assert.equal(data.ok, false);
    assert.equal(data.steps.length, 2);
    assert.equal(data.steps[1].ok, false);
  });

  test('เขียนทับไฟล์เดิม: _prevProdTruth เก็บค่า prodTruth รอบก่อน', () => {
    const truthPath = path.join(dir, 'carry.json');
    writeSystemTruth({ results: [{ name: 'x', ok: true }], truthPath, deployDist: dist });
    const first = JSON.parse(fs.readFileSync(truthPath, 'utf8'));

    const second = writeSystemTruth({ results: [{ name: 'x', ok: false }], truthPath, deployDist: dist });
    assert.equal(second.ok, false);
    assert.deepEqual(second._prevProdTruth, first.prodTruth, 'ต้องพกค่าเดิมไว้ให้ตรวจย้อนหลัง');
  });

  test('deployDist ไม่มี = ไม่ throw และ fingerprint เป็น null', () => {
    const data = buildTruth({
      results: [{ name: 'x', ok: true }],
      truthPath: path.join(dir, 'nodist.json'),
      deployDist: path.join(dir, 'missing-dist'),
    });
    assert.equal(data.ok, true);
    assert.equal(data.prodTruth.diskFingerprint, null);
    assert.equal(data.prodTruth.diskFiles, null);
  });
});
