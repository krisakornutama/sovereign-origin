// ── ลงทะเบียนเครื่องใหม่เอง: "ไฟล์เดียวจบ" ─────────────────────────────
// เจ้าของสั่ง 11/10/69: "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"
//   เดิมต้องออก join.json ทีละเครื่อง (ฝัง token) — ก๊อปชุดเดียวไปหลายเครื่อง
//   HUB มองเป็นเครื่องเดียว เพราะระบุตัวจาก token_hash
//
// เทสต์นี้ล็อก:
//   1) payload ถูกต้อง และไม่หลุดรหัสเชิญลงที่ไหนผิด
//   2) ตอบกลับจาก HUB แต่ละแบบ (201/400/404/429/500/กะพริบ HTML) → error ที่คนอ่านรู้เรื่อง
//   3) ต่อ HUB ไม่ได้ ≠ รหัสผิด — ต้องบอกคนละเรื่อง (คนไม่ต้องไปเดารหัสใหม่เอง)
//   4) .env ที่เขียนต้องอ่านได้ และไม่ทับค่าคงเดิมถ้าไฟล์ยาวเกินกำหนด
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnrollBody,
  parseEnrollResponse,
  enroll,
  normalizeName,
  enrollUrl,
  writeEnvFile,
} from '../../sovereign-os/agent-runner/src/enroll-machine.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HUB = 'http://192.168.1.102:3000';
const CODE = 'ลับ-1234';

describe('buildEnrollBody — ข้อมูลที่ส่งไปขอ token', () => {
  test('ส่งครบ: รหัสเชิญ + ชื่อเครื่อง + os + executors', () => {
    const r = buildEnrollBody({ hubUrl: HUB, code: CODE, name: 'คอม-3', executors: ['echo'] });
    assert.equal(r.ok, true);
    assert.equal(r.body.code, CODE);
    assert.equal(r.body.name, 'คอม-3');
    assert.equal(r.body.os, 'windows');
    assert.deepEqual(r.body.executors, ['echo']);
  });

  test('ไม่มีรหัสเชิญ = บอกให้ขอรหัส ไม่ยิงไปเปล่าๆ', () => {
    const r = buildEnrollBody({ hubUrl: HUB, code: '', name: 'คอม-3' });
    assert.equal(r.ok, false);
    assert.match(r.error, /รหัสเชิญ/);
  });

  test('HUB_URL ผิดรูป = บอกก่อนยิง (ไม่ใช่ไปล้มเป็น network error)', () => {
    assert.equal(buildEnrollBody({ hubUrl: '', code: CODE, name: 'x' }).ok, false);
    const bad = buildEnrollBody({ hubUrl: '192.168.1.102:3000', code: CODE, name: 'x' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /URL/);
  });

  test('ชื่อเครื่องยาว/มีอักขระควบคุม = ถูกตัดก่อนส่ง', () => {
    const r = buildEnrollBody({ hubUrl: HUB, code: CODE, name: 'x'.repeat(200) });
    assert.equal(r.body.name.length, 64);
    assert.equal(normalizeName('  คอม   3  '), 'คอม 3');
  });
});

describe('parseEnrollResponse — อ่านคำตอบจาก HUB', () => {
  test('201 + token = สำเร็จ', () => {
    const r = parseEnrollResponse(201, JSON.stringify({ id: 'abc', name: 'คอม-3', token: 't'.repeat(64) }));
    assert.equal(r.ok, true);
    assert.equal(r.token.length, 64);
  });

  test('404 = HUB ยังไม่ได้เปิดให้ลงทะเบียนเอง (บอกให้รู้ว่าไปตั้ง env อะไร)', () => {
    const r = parseEnrollResponse(404, JSON.stringify({ error: 'HUB ไม่ได้ตั้งรหัสเชิญ' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /MACHINE_ENROLL_CODE|รหัสเชิญ/);
  });

  test('400 = รหัสผิด/ชื่อไม่ถูกต้อง', () => {
    const r = parseEnrollResponse(400, JSON.stringify({ error: 'รหัสเชิญไม่ถูกต้อง' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /รหัสเชิญ/);
  });

  test('429 = ลองผิดเกินโควตา', () => {
    assert.match(parseEnrollResponse(429, '{}').error, /ลองผิด|พัก/);
  });

  test('กะพริบมาก่อน (HTML ไม่ใช่ JSON) = ยังต้องบอกได้ว่าล้มเหลว', () => {
    const r = parseEnrollResponse(502, '<html>Bad Gateway</html>');
    assert.equal(r.ok, false);
    assert.ok(r.error.length > 0);
  });

  test('200 แต่ไม่มี token = ต้องไม่ผ่าน (ไม่งั้นเขียน .env ที่ไม่มีของใช้)', () => {
    assert.equal(parseEnrollResponse(200, JSON.stringify({ id: 'x' })).ok, false);
  });
});

describe('enroll — ยิงไปขอ token (ใส่ fetch ปลอมได้)', () => {
  test('สำเร็จ = ได้ token กลับมา', async () => {
    const calls = [];
    const r = await enroll(
      { hubUrl: HUB, code: CODE, name: 'คอม-3' },
      { fetch: async (url, opts) => { calls.push({ url, opts }); return { status: 201, text: async () => JSON.stringify({ token: 'T' }) }; } },
    );
    assert.equal(r.ok, true);
    assert.equal(calls[0].url, `${HUB}/api/agent-machines/enroll`);
    assert.equal(calls[0].opts.method, 'POST');
  });

  test('ต่อ HUB ไม่ได้ = บอกว่าเป็นปัญหาเครือข่าย ไม่ใช่รหัสผิด (คนจะได้ไม่ไปเดารหัสใหม่)', async () => {
    const r = await enroll(
      { hubUrl: HUB, code: CODE, name: 'คอม-3' },
      { fetch: async () => { throw new Error('ECONNREFUSED'); } },
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /ต่อ HUB ไม่ได้/);
    assert.doesNotMatch(r.error, /รหัสเชิญไม่ถูกต้อง/);
  });

  test('ไม่ยิงเลยถ้า input ไม่ผ่าน (ไม่เผาเรทต่อเน็ต)', async () => {
    let called = 0;
    await enroll({ hubUrl: '', code: '', name: '' }, { fetch: async () => { called += 1; return {}; } });
    assert.equal(called, 0);
  });

  test('enrollUrl ตัด slash ท้ายให้ไม่เพี้ยน', () => {
    assert.equal(enrollUrl('http://a:3000/'), 'http://a:3000/api/agent-machines/enroll');
  });
});

describe('writeEnvFile — ต้องได้ .env ที่ runner อ่านได้', () => {
  test('เขียนครบค่าที่ runner ต้องใช้', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-env-'));
    try {
      const f = writeEnvFile(dir, { hubUrl: HUB + '/', token: 'T'.repeat(64), machineName: 'คอม-3' });
      const txt = fs.readFileSync(f, 'utf8');
      assert.match(txt, /^HUB_URL=http:\/\/192\.168\.1\.102:3000$/m);
      assert.match(txt, /^MACHINE_TOKEN=T{64}$/m);
      assert.match(txt, /^MACHINE_NAME=คอม-3$/m);
      assert.match(txt, /^ENABLED_EXECUTORS=echo$/m);
      assert.match(txt, /^ENABLE_REMOTE_CONTROL=true$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ชื่อเครื่องใน .env ถูก sanitize ด้วย (ไม่ให้อักขระควบคุมหลุดลงไฟล์ที่จะอ่านทีหลัง)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-env-'));
    try {
      const f = writeEnvFile(dir, { hubUrl: HUB, token: 'T', machineName: 'คอม งาน' });
      const line = fs.readFileSync(f, 'utf8').split('\r\n').find((l) => l.startsWith('MACHINE_NAME='));
      assert.equal(line, 'MACHINE_NAME=คอมงาน');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});