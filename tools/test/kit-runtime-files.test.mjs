#!/usr/bin/env node
/* ── ทุกไฟล์ที่ตัวติดตั้งเรียกตอนรันจริง ต้องมีอยู่จริง ──────────────────
   เคสจริง 12/10/69: setup-node.mjs ตรวจ `sovereign-os/agent-runner/setup-machine.mjs`
     ซึ่งไม่เคยมีในโครงการ (อยู่ที่ tools/agent-pack) → มองไม่เห็นตอนอ่านโค้ด
     พังตอนรันบนเครื่องจริง หลังดึง Docker หลาย GB เสร็จแล้ว = เสียเวลาคนทั้งวัน

   เทสต์นี้ล็อก:
     1) RUNTIME_FILES ทุกตัวต้องมีอยู่ในโครงการจริง
     2) และต้องอยู่ในชุดที่ build-node-kit ประกอบ (ไม่งั้นเครื่องใหม่จะไม่มี)
     3) ต้องมีในชุดที่แตกจริงด้วย (ไฟล์จริงใน .freebuff/node-kit-test ถ้ามี)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES } from '../setup-node.mjs';
import { collectKitFiles } from '../build-node-kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const ENTRIES = Object.entries(RUNTIME_FILES);

describe('ไฟล์ที่ตัวติดตั้งเรียกตอนรันจริง', () => {
  test('ประกาศครบ (ถ้าเพิ่มขั้นใหม่ ต้องเพิ่มชื่อไฟล์มาด้วย)', () => {
    assert.ok(ENTRIES.length >= 5, `ควรมีอย่างน้อย 5 รายการ แต่ได้ ${ENTRIES.length}`);
  });

  for (const [key, rel] of ENTRIES) {
    test(`${key} → ${rel} มีอยู่จริงในโครงการ`, () => {
      assert.ok(fs.existsSync(path.join(REPO, rel)), `ไม่พบ ${rel} — โค้ดจะล้มตอนรันจริงบนเครื่องใหม่`);
    });
  }
});

describe('ไฟล์ที่ติดตั้งต้อง ต้องติดมากับชุดด้วย', () => {
  test('build-node-kit เก็บไฟล์ครบทุกตัว (ไม่งั้นเครื่องใหม่ได้ชุดที่ติดตั้งไม่ได้)', () => {
    const { files } = collectKitFiles(REPO);
    const set = new Set(files.map((f) => f.rel));
    for (const [key, rel] of ENTRIES) {
      assert.ok(set.has(rel.replace(/\\/g, '/')), `${key}: ${rel} ไม่ได้อยู่ในชุดที่จะดาวน์โหลด`);
    }
  });
});

describe('ชุดที่แตกจริง (ถ้ามีอยู่) ต้องมีไฟล์ครบ', () => {
  const EXTRACTED = path.join(REPO, '.freebuff', 'node-kit-test');

  test('ไฟล์ครบในโฟลเดอร์ที่แตกจาก HUB จริง', (t) => {
    if (!fs.existsSync(EXTRACTED)) {
      t.skip('ยังไม่ได้แตกชุดไว้ (รัน installer ก่อนแล้วเทสต์นี้จะเช็คอัตโนมัติ)');
      return;
    }
    for (const [key, rel] of ENTRIES) {
      assert.ok(fs.existsSync(path.join(EXTRACTED, rel)), `${key}: ไม่พบ ${rel} ในชุดที่แตกจริง`);
    }
  });
});