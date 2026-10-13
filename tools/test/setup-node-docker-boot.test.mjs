#!/usr/bin/env node
/* ── เปิด Docker Desktop ให้เองหลัง winget ติดตั้งเสร็จ ────────────────────
   เคสจริง 12/10/69: winget ติดตั้ง Docker Desktop เสร็จก็จบ แต่โปรแกรมยังไม่ถูกเปิด
     ⇒ `docker info` ล้มทันที ⇒ ตัวติดตั้งบอก "ยังขาด Docker Desktop"
       ทั้งที่เพิ่งติดตั้งเสร็จ → คนต้องเดาเองว่าไปเปิดแล้วรันซ้ำ

   เทสต์นี้ล็อก:
     1) Docker ตอบอยู่แล้ว = ไม่ต้องแตะอะไร
     2) รุ่นใหม่ (มี docker desktop start) = ใช้คำสั่งนั้น
     3) รุ่นเก่า (ไม่มีคำสั่ง) = ต้องรอและลองใหม่ ไม่ใช่ตัดสินว่าล้มทันที
     4) รอไม่เกินเวลาที่กำหนด แล้วบอกคนว่าจะทำอะไรต่อ (ไม่ใช่ล้มเงียบๆ)
     5) runSetup ต้องเรียกมันหลังติดตั้ง docker เสร็จ
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDockerDesktop, runSetup, REQUIRED_TOOLS } from '../setup-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** exec จำลอง: docker info ตอบตามที่ตั้ง · บันทึกว่าถูกเรียกอะไรบ้าง */
function fakeExec({ readyAfter = 0, cliStartWorks = true } = {}) {
  const calls = [];
  let infoCalls = 0;
  return {
    calls,
    exec: async (cmd, args = []) => {
      const key = `${cmd} ${args.join(' ')}`;
      calls.push(key);
      if (key === 'docker info') {
        infoCalls += 1;
        return { code: infoCalls > readyAfter ? 0 : 1, stdout: '', stderr: '' };
      }
      if (key === 'docker desktop start') {
        return cliStartWorks
          ? { code: 0, stdout: 'started', stderr: '' }
          : { code: 1, stdout: '', stderr: 'unknown command' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

describe('startDockerDesktop', () => {
  test('Docker ตอบอยู่แล้ว = ไม่สั่งอะไรเปล่า', async () => {
    const f = fakeExec({ readyAfter: 0 });
    const r = await startDockerDesktop({ exec: f.exec, log: () => {}, sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.match(r.reason, /อยู่แล้ว/);
    assert.deepEqual(f.calls, ['docker info'], 'ต้องไม่ไป start ถ้าใช้ได้อยู่แล้ว');
  });

  test('ยังไม่ตอบ = ใช้ `docker desktop start` (รุ่นใหม่) แล้วรอ', async () => {
    const f = fakeExec({ readyAfter: 1 });
    const r = await startDockerDesktop({ exec: f.exec, log: () => {}, sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.ok(f.calls.includes('docker desktop start'), 'ต้องสั่งเปิด Docker');
  });

  test('รุ่นเก่าไม่มีคำสั่งนั้น = ต้องยังรอลองใหม่ ไม่ใช่ตัดสินว่าล้มทันที', async () => {
    const f = fakeExec({ readyAfter: 2, cliStartWorks: false });
    const r = await startDockerDesktop({ exec: f.exec, log: () => {}, sleep: async () => {} });
    assert.equal(r.ok, true, 'ต้องรอจนกว่า Docker จะตอบ ไม่ใช่ล้มทันทีที่คำสั่ง start ใช้ไม่ได้');
    assert.ok(f.calls.filter((c) => c === 'docker info').length >= 3, 'ต้องวนตรวจซ้ำ');
  });

  test('รอไม่เกินเวลาที่กำหนด แล้วบอกว่าจะทำอะไรต่อ (ไม่ล้มเงียบๆ)', async () => {
    const f = fakeExec({ readyAfter: 999 });
    const r = await startDockerDesktop({
      exec: f.exec,
      log: () => {},
      waitMs: 0,
      pollMs: 1,
      sleep: async () => {},
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /เปิด Docker Desktop ด้วยมือ/, 'ต้องบอกคนว่าจะทำอะไรต่อ');
  });

  test('ต้องเตือนก่อนว่าจะรอนาน (คนเห็นหน้าจอนิ่งแล้วคิดว่าค้าง)', async () => {
    const f = fakeExec({ readyAfter: 1 });
    const said = [];
    await startDockerDesktop({ exec: f.exec, log: (m) => said.push(m), sleep: async () => {} });
    assert.ok(said.some((m) => /รอ Docker Desktop ตอบ/.test(m)), `ไม่ได้เตือน: ${said.join('|')}`);
  });
});

describe('runSetup ต้องเปิด Docker ให้หลังติดตั้ง', () => {
  test('โค้ดต้องเรียก startDockerDesktop หลังติดตั้ง docker', () => {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'setup-node.mjs'), 'utf8');
    // ตอนนี้มีพารามิเตอร์ step เพิ่ม: installTool(t, exec, step)
    const at = src.indexOf('await installTool(t, exec');
    assert.ok(at > 0, 'ต้องมีการติดตั้งเครื่องมือ');
    const after = src.slice(at, at + 700);
    assert.match(after, /startDockerDesktop/, 'ต้องเปิด Docker ต่อทันทีหลังติดตั้ง');
    assert.match(after, /t\.id === 'docker'/, 'ต้องทำเฉพาะตัว docker');
  });

  test('ข้อความล้มต้องบอกว่าจะเปิด Docker ด้วยมือ (ไม่ใช่ "ติดตั้งเองแล้วรันซ้ำ")', () => {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'setup-node.mjs'), 'utf8');
    assert.match(src, /เปิด Docker Desktop ด้วยมือ แล้วรอจนไอคอนเป็นเขียว/);
  });

  test('docker เป็นเครื่องมือที่ต้องมีจริง (อย่าแตะ REQUIRED_TOOLS แล้วลืม docker)', () => {
    assert.ok(REQUIRED_TOOLS.some((t) => t.id === 'docker'));
    assert.ok(REQUIRED_TOOLS.some((t) => t.id === 'node'));
  });
});