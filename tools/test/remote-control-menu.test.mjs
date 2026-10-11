#!/usr/bin/env node
/* ── เมนู "ควบคุมระยะไกล" + หน้าที่รับคำสั่งอัปเดตจาก HUB ─────────────────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (เจ้าของสั่ง 11/10/69):
   "เปิดแอปแล้วต้องเห็นเมนูควบคุมระยะไกล และเครื่องนี้ต้องเห็นเครื่อง 2 3 4 พร้อมสั่งอัปเดตได้"

   เทสต์นี้เฝ้า 4 อย่างที่เคยพัง/เคยหายได้:
   1) กลุ่มเมนู "ควบคุมระยะไกล" ต้องมีอยู่จริงใน navigation.ts (แหล่งเดียวของเมนูทั้งแอป)
      และต้องมีคอนโซลเครื่อง · คิวเอเจนต์ · อัปเดตเครื่อง อยู่ในกลุ่มนั้น
   2) href ของสามหน้านี้ต้องไม่ซ้ำสองกลุ่ม (ซ้ำแล้วผู้ใช้เห็นเมนูขัดกัน) — นับจากไฟล์จริง
   3) หน้าคอนโซลเครื่องต้องมีปุ่มสั่งอัปเดตจาก HUB จริง และโชว์ IP ของเครื่อง
      (ถ้าวันหนึ่งมีคนลบปุ่ม/ลบ IP ทิ้ง เมนูจะพาไปหน้าที่สั่งงานไม่ได้ = ฟีเจอร์หายเงียบ)
   4) ทุกหน้าต้องมี <Sidebar /> ตามกฎเลย์เอาต์ของโปรเจ็ก
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NAV = 'sovereign-frontend/src/lib/navigation.ts';
const CONSOLE_PAGE = 'sovereign-frontend/src/pages/machine-console.tsx';

/** ตัดเฉพาะบล็อกของกลุ่มเมนูที่ต้องการ — จาก title (มีไอคอน) ของกลุ่มถึง title ของกลุ่มถัดไป */
function groupBlock(source, titleKey) {
  const at = source.indexOf(titleKey);
  assert.notEqual(at, -1, `ไม่พบกลุ่มเมนู ${titleKey} ใน ${NAV}`);
  const start = source.lastIndexOf('title:', at);
  const next = source.indexOf('title:', at + titleKey.length);
  return source.slice(start === -1 ? at : start, next === -1 ? source.length : next);
}

describe('เมนูควบคุมระยะไกล (navigation.ts)', () => {
  const nav = read(NAV);

  test('มีกลุ่ม "ควบคุมระยะไกล"', () => {
    const block = groupBlock(nav, 'common.nav.group.remote');
    assert.match(block, /ควบคุมระยะไกล/, 'ชื่อกลุ่มต้องอ่านออกว่าเป็นงานควบคุมเครื่องระยะไกล');
    assert.match(block, /🖥️/, 'ต้องมีไอคอนให้กวาดตาเห็นใน Sidebar');
  });

  test('ในกลุ่มมีคอนโซลเครื่อง · คิวเอเจนต์ · อัปเดตเครื่อง (OTA)', () => {
    const block = groupBlock(nav, 'common.nav.group.remote');
    for (const href of ['/machine-console', '/agent-queue', '/ota']) {
      assert.ok(block.includes(`href: '${href}'`), `${href} ต้องอยู่ในกลุ่มควบคุมระยะไกล`);
    }
  });

  test('สามหน้านี้ไม่ถูกใส่ซ้ำในกลุ่มอื่น (เมนูซ้ำ = ผู้ใช้สับสน)', () => {
    for (const href of ['/machine-console', '/agent-queue', '/ota']) {
      const hits = nav.split(`href: '${href}'`).length - 1;
      assert.equal(hits, 1, `${href} ต้องปรากฏในเมนูครั้งเดียว (พบ ${hits})`);
    }
  });

  test('คำค้นในช่อง CommandPalette หา "ระยะไกล" แล้วเจอคอนโซลเครื่อง', () => {
    const block = groupBlock(nav, 'common.nav.group.remote');
    assert.match(block, /ระยะไกล/);
    assert.match(block, /ip/, 'พิมพ์ ip ต้องเจอ (เจ้าของหาด้วยคำว่า ip ของเครื่อง)');
  });
});

describe('หน้าคอนโซลเครื่อง — ที่ที่คำสั่งอัปเดตถูกยิงจริง', () => {
  const page = read(CONSOLE_PAGE);

  test('มีปุ่มสั่งอัปเดตจาก HUB และปุ่มตรวจเวอร์ชัน', () => {
    assert.match(page, /สั่งอัปเดตจาก HUB/);
    assert.match(page, /ตรวจเวอร์ชัน/);
    assert.match(page, /update\.apply/);
    assert.match(page, /update\.check/);
  });

  test('ยิงคำสั่งผ่านช่องควบคุมของ HUB (machine-control) ไม่ใช่ที่อื่น', () => {
    assert.match(page, /\/api\/machine-control\/command/);
  });

  test('แสดง IP ของแต่ละเครื่อง (เจ้าของต้องเห็นเครื่อง 2 3 4 อยู่ที่ไหนในวง)', () => {
    assert.match(page, /ip\?: string \| null/);
    assert.match(page, /IP \{m\.ip\}/);
  });

  test('มี <Sidebar /> ตามกฎเลย์เอาต์ของทุกหน้า', () => {
    assert.match(page, /<Sidebar \/>/);
  });
});
