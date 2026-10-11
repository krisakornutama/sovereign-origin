#!/usr/bin/env node
/* ── ติดตั้งเครื่องลูกแบบโนดเต็ม: กันพลาดก่อนยัดทุกอย่างลงเครื่องลูก ────────────
   เคสจริง 11/10/69:
     · เจ้าของมีพื้นที่ว่าง 40 GB ที่เครื่องใหม่ → ต้องรู้ตัวเลขจริงก่อนติดตั้ง
     · เครื่องนี้เจอดิสก์เต็มจริง (Docker vhdx 86 GB + WAL 44.9 GB)
       ⇒ ถ้าปล่อยไว้ซ้ำต้องเสียอีก และคราวนี้มีหลายเครื่อง
     · ชุดติดตั้งเดิม "แค่ก๊อปไฟล์" ไม่ได้ติดตั้งอะไรเลย → แอปค้างที่กำลังเริ่ม

   เทสต์นี้ล็อก:
     1) พื้นที่ไม่พอ = หยุด พร้อมบอกตัวเลข (ไม่ใช่ "ล้มแบบงงๆ")
     2) อ่านพื้นที่ไม่ได้ = หยุด ไม่เดาว่าพอ (fail-closed)
     3) จำกัดขนาด log ของ Docker โดยไม่ทับคีย์เดิมของเครื่องนั้น
     4) ตรวจเครื่องมือทีละตัว — ตัวหนึ่งขาดไม่ทำให้ตัวอื่นหาย
     5) ไฟล์ Docker config เพี้ยน = ไม่ทับทิ้ง
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkSpace,
  totalRequiredGb,
  mergeDaemonConfig,
  writeDockerDaemonConfig,
  checkTools,
  installTool,
  MIN_FREE_GB,
  REQUIRED_TOOLS,
} from '../setup-node.mjs';

describe('checkSpace — กันเครื่องเต็มก่อนยัดของ', () => {
  test('งบที่ต้องใช้ = ผลรวมทุกหัวข้อ (ตัวเลขต้องโปร่งใส ไม่ใช่เลขลอยๆ)', () => {
    const need = totalRequiredGb();
    assert.ok(need > 10 && need < 15, `งบรวมควรอยู่ราว 10-15 GB แต่ได้ ${need}`);
  });

  test('40 GB (เครื่องเครื่องใหม่ของเจ้าของ) = ผ่าน', () => {
    const r = checkSpace(40);
    assert.equal(r.ok, true);
    assert.match(r.reason, /พอ/);
  });

  test('พื้นที่น้อยกว่างบ = หยุด พร้อมบอกตัวเลขทั้งสองข้าง', () => {
    const r = checkSpace(9);
    assert.equal(r.ok, false);
    assert.match(r.reason, /GB/);
    assert.ok(r.need > 0 && r.free === 9);
  });

  test('ต่ำกว่าเกณฑ์ขั้นต่ำ = หยุด แม้ยังมากกว่างบก็ไม่ผ่าน (ต้องเหลือของเดิมด้วย)', () => {
    const r = checkSpace(MIN_FREE_GB - 0.1);
    assert.equal(r.ok, false);
    assert.match(r.reason, /ขั้นต่ำ/);
  });

  test('อ่านพื้นที่ไม่ได้/ได้ค่ามหึมา = หยุด ไม่เดาว่าพอ', () => {
    assert.equal(checkSpace(undefined).ok, false);
    assert.equal(checkSpace(-5).ok, false);
    assert.match(checkSpace(undefined).reason, /อ่านพื้นที่ว่างไม่ได้/);
  });
});

describe('Docker log — กันบันทึกบวมจนดิสก์เต็ม', () => {
  test('ค่าเริ่มต้น = จำกัดขนาดและจำนวนไฟล์', () => {
    const c = mergeDaemonConfig({});
    assert.equal(c['log-driver'], 'json-file');
    assert.equal(c['log-opts']['max-size'], '10m');
    assert.equal(c['log-opts']['max-file'], '3');
  });

  test('ไม่ทับคีย์เดิมของเครื่องนั้น (เช่น registry mirror ที่เจ้าของตั้งไว้)', () => {
    const c = mergeDaemonConfig({ 'registry-mirrors': ['https://x'], features: { a: true } });
    assert.deepEqual(c['registry-mirrors'], ['https://x']);
    assert.deepEqual(c.features, { a: true });
    assert.equal(c['log-driver'], 'json-file');
  });

  test('คีย์เดิมของ log-opts ยังอยู่', () => {
    const c = mergeDaemonConfig({ 'log-opts': { 'max-size': '50m' } });
    assert.equal(c['log-opts']['max-file'], '3');
  });

  test('เขียนไฟล์จริงแล้วอ่านกลับได้', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-'));
    try {
      const p = path.join(dir, 'sub', 'daemon.json');
      const r = writeDockerDaemonConfig(p, '');
      assert.ok(fs.existsSync(p));
      assert.equal(JSON.parse(fs.readFileSync(p, 'utf8'))['log-driver'], 'json-file');
      assert.equal(r.config['log-opts']['max-size'], '10m');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ไฟล์เพี้ยน = ไม่ทับทิ้ง (อาจมีคีย์สำคัญของเครื่องนั้น)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-'));
    try {
      const p = path.join(dir, 'daemon.json');
      fs.writeFileSync(p, '{ นี่ไม่ใช่ JSON');
      assert.throws(() => writeDockerDaemonConfig(p, '{ นี่ไม่ใช่ JSON'), /JSON|ทับ/);
      assert.equal(fs.readFileSync(p, 'utf8'), '{ นี่ไม่ใช่ JSON', 'ไฟล์เดิมต้องไม่ถูกแก้');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checkTools — ตรวจทีละตัว', () => {
  test('ครบ = ทุกตัว ok', async () => {
    const r = await checkTools(REQUIRED_TOOLS, async () => ({ code: 0, stdout: 'v20.0.0', stderr: '' }));
    assert.equal(r.length, 2);
    assert.ok(r.every((t) => t.ok));
  });

  test('ขาดตัวเดียว = ไม่ทำให้ตัวอื่นหาย (ต้องเห็นทั้งสองสถานะ)', async () => {
    const r = await checkTools(REQUIRED_TOOLS, async (bin) =>
      bin === 'docker' ? { code: 1, stdout: '', stderr: 'no' } : { code: 0, stdout: 'v20.0.0', stderr: '' },
    );
    assert.equal(r.length, 2);
    assert.equal(r.find((t) => t.id === 'node').ok, true);
    assert.equal(r.find((t) => t.id === 'docker').ok, false);
  });
});

describe('installTool — ไม่เดาวิธีติดตั้ง', () => {
  test('มี winget + ติดตั้งสำเร็จ = ok', async () => {
    const calls = [];
    const exec = async (bin, args) => { calls.push([bin, ...args]); return { code: 0, stdout: 'done', stderr: '' }; };
    const r = await installTool(REQUIRED_TOOLS[0], exec);
    assert.equal(r.ok, true);
    assert.ok(calls.some((c) => c[0] === 'winget' && c.includes('OpenJS.NodeJS.LTS')));
  });

  test('ไม่มี winget = บอกให้ติดตั้งเอง ไม่ใช่พยายามเงียบๆ', async () => {
    const exec = async (bin) => (bin === 'where' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' });
    const r = await installTool(REQUIRED_TOOLS[0], exec);
    assert.equal(r.ok, false);
    assert.match(r.reason, /winget/);
  });

  test('winget ล้ม = รายงาน exit code จริง ไม่อ้างว่าสำเร็จ', async () => {
    const exec = async (bin) => (bin === 'where' ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: 'no network', stderr: '' });
    const r = await installTool(REQUIRED_TOOLS[0], exec);
    assert.equal(r.ok, false);
    assert.match(r.reason, /ล้ม/);
  });
});