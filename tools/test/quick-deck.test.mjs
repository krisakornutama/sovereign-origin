#!/usr/bin/env node
/* ── QuickDeck — ทางลัดงานประจำบนแดชบอร์ด (กราฟิก + ใช้งานเร็ว) ─────────────
   เจ้าของสั่ง 21/10/69: "ทำกราฟิก พร้อมกับปรับปรุง ทำให้ใช้งานได้เร็วเข้า"
   เทสต์นี้ล็อกสิ่งที่ทำให้เร็ว/ไม่พัง:
   1) deck อยู่ใน components/ui (layer เดียวกับ GlassSurface ที่อนุญาต — ไม่ชน import-layers)
      และใช้ Liquid Glass แบบ SVG — ห้ามลาก WebGL เข้าหน้าจริง
   2) ทุกทางลัดชี้ไปหน้าที่มีไฟล์จริง (กันลิงก์ตาย)
   3) จำนวนทางลัด 4–5 ปุ่ม (กติกา "fewer buttons")
   4) แดชบอร์ดวาง deck ก่อนกริดวิดเจ็ต — เห็นทันทีโดยไม่ต้องเลื่อน
   5) AiChatPanel/VoiceCommand โหลดแบบ lazy (ssr:false) — ลด JS ตอนเปิดหน้า
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend', 'src');
const PAGES = path.join(FRONTEND, 'pages');
const DECK = path.join(FRONTEND, 'components', 'ui', 'QuickDeck.tsx');
const LAZY = path.join(FRONTEND, 'components', 'dashboard', 'lazy-widgets.tsx');
const AICHAT = path.join(FRONTEND, 'components', 'dashboard', 'AiChatPanel.tsx');
const DASH = path.join(PAGES, 'dashboard.tsx');
const read = (p) => fs.readFileSync(p, 'utf8');

describe('QuickDeck — ทางลัดงานประจำ', () => {
  test('อยู่ชั้น ui + ใช้ GlassSurface และไม่ลาก WebGL เข้าหน้าจริง', () => {
    assert.ok(fs.existsSync(DECK), 'ต้องมี sovereign-frontend/src/components/ui/QuickDeck.tsx');
    const src = read(DECK);
    assert.match(src, /from '\.\.\/glass\/GlassSurface'/, 'deck ต้องใช้ GlassSurface');
    assert.doesNotMatch(
      src,
      /@react-three|ShaderGradientScene|GlassOrbScene|from 'three'/,
      'ห้ามใช้ WebGL บนหน้าจริง (J8g) — ให้อยู่ที่ /hover-cards เท่านั้น',
    );
  });

  test('ทุกทางลัดชี้ไปหน้าที่มีไฟล์จริง', () => {
    const src = read(DECK);
    const hrefs = [...src.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 4 && hrefs.length <= 5, `ควรมี 4–5 ทางลัด (พบ ${hrefs.length})`);
    for (const href of hrefs) {
      const rel = href.replace(/^\//, '').split('?')[0].split('#')[0];
      const candidates = [path.join(PAGES, `${rel}.tsx`), path.join(PAGES, rel, 'index.tsx')];
      assert.ok(candidates.some((f) => fs.existsSync(f)), `ทางลัด ${href} ไม่มีไฟล์หน้าจริง`);
    }
  });

  test('สองภาษา + เข้าถึงได้ด้วยคีย์บอร์ด/เครื่องอ่านหน้าจอ', () => {
    const src = read(DECK);
    assert.match(src, /t\('quickdeck\./, 'ต้องใช้ t() กับข้อความ (th/en)');
    assert.match(src, /aria-label/, 'ต้องมี aria-label ของกลุ่มทางลัด');
  });

  test('แดชบอร์ดวาง QuickDeck ก่อนกริดวิดเจ็ต', () => {
    const src = read(DASH);
    const deck = src.indexOf('<QuickDeck');
    const grid = src.indexOf('grid grid-cols-12 gap-2.5');
    assert.ok(deck > 0, 'dashboard ต้องเรนเดอร์ <QuickDeck />');
    assert.ok(grid > 0 && deck < grid, 'QuickDeck ต้องอยู่บนกริด — เห็นทันทีโดยไม่ต้องเลื่อน');
  });

  test('widget หนักถูกโหลดแบบ lazy (ssr:false) และไม่ถูก import ตรง', () => {
    const dash = read(DASH);
    const lazy = read(LAZY);

    assert.doesNotMatch(dash, /^import AiChatPanel from/m, 'ห้าม static import AiChatPanel ใน dashboard');
    assert.doesNotMatch(dash, /^import VoiceCommand from/m, 'ห้าม static import VoiceCommand ใน dashboard');
    assert.match(
      dash,
      /from '\.\.\/components\/dashboard\/lazy-widgets'/,
      'dashboard ต้อง import จาก lazy-widgets',
    );
    assert.match(lazy, /^"use client";/m, 'lazy-widgets ต้องเป็น client module');
    assert.match(
      lazy,
      /dynamic\(\(\)\s*=>\s*import\('\.\/AiChatPanel'\)/,
      'AiChatPanel ต้องโหลดผ่าน next/dynamic',
    );
    assert.match(
      lazy,
      /dynamic\(\(\)\s*=>\s*import\('\.\/VoiceCommand'\)/,
      'VoiceCommand ต้องโหลดผ่าน next/dynamic',
    );
    assert.match(lazy, /ssr:\s*false/, 'ต้องปิด SSR สำหรับ widget ที่ไม่จำเป็นต่อ first paint');
  });

  test('แชทเลื่อนในกล่องตัวเอง — ไม่ลากหน้า dashboard กระโดด', () => {
    const src = read(AICHAT);
    assert.doesNotMatch(
      src,
      /\.scrollIntoView\s*\(/,
      'ห้ามเรียก scrollIntoView — มันเลือก scrollable ancestor ตัวนอกสุดและลากทั้งหน้า',
    );
    assert.match(
      src,
      /scrollTo\(\{\s*top:\s*el\.scrollHeight/,
      'ต้องเลื่อน scrollTop ของกล่องข้อความแชทโดยตรง',
    );
  });
});
