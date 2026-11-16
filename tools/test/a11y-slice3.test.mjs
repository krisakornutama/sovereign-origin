#!/usr/bin/env node
// a11y Slice 3 — dashboard / security / sensors (docs/UXUI-PLAN.md §Slice 3)
//
// เหตุผลที่ต้องมีไฟล์นี้: สามหน้านี้คือหน้าที่ใช้บ่อยที่สุด แต่ปุ่มไอคอนล้วน
// (ถังขยะ, กากบาทยกเลิก block) ไม่มีชื่อให้ screen reader อ่าน, ปุ่ม/หัวข้อใน
// modal สร้างโค้ดยัง hardcode อังกฤษ, แบนเนอร์ข้อมูลขาดบอก API ว่า "มีอะไรขึ้น"
// และมีข้อความสีเทาเข้ม (gray-600) ที่คอนทราสต์ต่ำกว่า 4.5:1 บนพื้นดำ
//
// ตรวจแบบ static (อ่าน JSX) — ไม่ต้องมีบัญชี/เซิร์ฟเวอร์ และจับ regression ได้ทันที
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRaw = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ตัดคอมเมนต์ก่อนตรวจ (คำอธิบายในคอมเมนต์ไม่ควรทำให้เทสต์ผ่าน)
const stripComments = (src) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const read = (p) => stripComments(readRaw(p));

const FILES = {
  dashboard: 'sovereign-frontend/src/pages/dashboard.tsx',
  security: 'sovereign-frontend/src/pages/security.tsx',
  deviceCard: 'sovereign-frontend/src/components/sensors/DeviceCard.tsx',
  generateModal: 'sovereign-frontend/src/components/sensors/GenerateCodeModal.tsx',
  sensorsHub: 'sovereign-frontend/src/components/sensors/SensorsHub.tsx',
};

describe('a11y — โฟกัสริงต้องไม่ถูกปิด', () => {
  test('ไม่มี outline-none ใน 3 หน้าหลัก (ใช้ริงจาก globals.css)', () => {
    for (const [name, file] of Object.entries(FILES)) {
      assert.doesNotMatch(read(file), /outline-none/, `${name} ต้องไม่ปิด outline`);
    }
  });

  test('globals.css มีกฎ :focus-visible กลาง', () => {
    assert.match(readRaw('sovereign-frontend/src/styles/globals.css'), /:focus-visible\s*\{/);
  });
});

describe('a11y — คอนทราสต์ข้อความ', () => {
  test('ไม่ใช้ text-gray-600 (ต่ำกว่า 4.5:1 บนพื้นดำ) ใน 3 หน้าหลัก', () => {
    for (const [name, file] of Object.entries(FILES)) {
      assert.doesNotMatch(read(file), /text-gray-600/, `${name} ยังมี text-gray-600`);
    }
  });
});

describe('a11y — sensors: ปุ่มไอคอนต้องมีชื่อ', () => {
  const card = read(FILES.deviceCard);

  test('ปุ่มลบอุปกรณ์ (ไอคอนถังขยะล้วน) มี aria-label พร้อมชนิดอุปกรณ์', () => {
    assert.match(card, /onDelete\(device\.id\)[\s\S]{0,400}?aria-label=/);
  });

  test('ปุ่ม Generate Code ใช้คีย์ i18n และมีชื่อบอกอุปกรณ์', () => {
    assert.match(card, /sensorsHub\.generateCode/);
    assert.doesNotMatch(card, />\s*Generate Code\s*</, 'ห้าม hardcode "Generate Code"');
    assert.match(card, /onGenerate\(device\)[\s\S]{0,400}?aria-label=/);
  });
});

describe('a11y — modal สร้างโค้ด', () => {
  const modal = read(FILES.generateModal);

  test('มีบทบาท dialog + ประกาศชื่อจากหัวข้อ', () => {
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-labelledby=/);
    assert.match(modal, /id="(sensors|generate)[\w-]*"[^>]*>/, 'หัวข้อต้องมี id ให้ aria-labelledby ชี้');
  });

  test('ข้อความ error ถูกประกาศ (role="alert")', () => {
    assert.match(modal, /\{error &&[\s\S]{0,200}?role="alert"/);
  });

  test('ปุ่ม Generate / Close ใช้ i18n ไม่ hardcode', () => {
    assert.doesNotMatch(modal, />\s*Generate\s*</);
    assert.doesNotMatch(modal, />\s*Close\s*</);
    assert.match(modal, /sensorsHub\.generateNow/);
    assert.match(modal, /common\.close/);
  });
});

describe('a11y — security: ปุ่มไอคอนล้วนต้องมีชื่อ', () => {
  test('ปุ่มยกเลิก block (ไอคอน x ล้วน) มี aria-label', () => {
    assert.match(
      read(FILES.security),
      /sendBlockAction\('unblock'[\s\S]{0,400}?aria-label=/,
      'ปุ่มไอคอนต้องมี aria-label ไม่ใช่แค่ title',
    );
  });
});

describe('a11y — dashboard: แบนเนอร์ข้อมูลต้องถูกประกาศ', () => {
  const dash = read(FILES.dashboard);

  test('แบนเนอร์ "ข้อมูลบางส่วนโหลดไม่ได้" มี role/aria-live', () => {
    assert.match(dash, /data-health/);
    assert.match(
      dash,
      /degraded\.length > 0[\s\S]{0,400}?(role="(status|alert)"|aria-live=)/,
      'ต้องประกาศให้ screen reader รู้ว่าข้อมูลไม่ครบ',
    );
  });
});
