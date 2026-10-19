#!/usr/bin/env node
/* ── เมนูรวมศูนย์ (19/10/69) ───────────────────────────────────────────────
   เจ้าของสั่ง: "ลดปุ่มที่ไม่จำเป็น ควบรวมปุ่มให้น้อยลงและกระชับขึ้น"
   − ร้านอาหาร + การลงทุน: พับเก็บได้
   − วิจัยพันธุ์ข้าว → ตามรอยผลผลิต
   − Self-Check 32 + MBTI → ตรวจสุขภาพ
   − พยากรณ์/จำลองการปกครอง/เรียนรู้เอง/เฝ้าระวังความเสี่ยง/แผนที่ทรัพย์สิน/
     ประวัติแจ้งเตือน/คลังความรู้/รายงาน AI → ศูนย์บัญชาการ AI
   − โครงสร้างพื้นฐาน/พลังงาน/อัตโนมัติ/รีเลย์ → ระบบพื้นฐาน
   − สุขภาพระบบ + ความจริงระบบ → ระบบ
   − สำรองข้อมูล + เปลี่ยนรหัสผ่าน → ตั้งค่า

   เทสต์นี้ล็อก "ผลลัพธ์เชิงโครงสร้าง" ไม่ใช่หน้าตา:
   1) หน้าเหล่านี้ต้องไม่อยู่ในเมนูหลักซ้ำอีก (เหลือทางเดียว = แท็บในศูนย์นั้น)
   2) ต้องยังค้นเจอใน CommandPalette (ALL_PAGES ต้องรวมแท็บ)
   3) Sidebar ต้องพับ/กางได้จริงและจำสถานะ
   4) PageHeader ต้องแสดงแท็บตามเส้นทาง
   ถ้าวันหน้าวีโก้กลับไปเพิ่มเมนูซ้ำ เทสต์นี้จะแดงทันที
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NAV = read('sovereign-frontend/src/lib/navigation.ts');
// เมนูหลัก = ทุกอย่างก่อนบล็อก SECTIONS (กันนับ href ในแท็บปนกัน)
const NAV_ONLY = NAV.split('export const SECTIONS')[0];
const SECTIONS = NAV.slice(NAV.indexOf('export const SECTIONS'));
const SIDEBAR = read('sovereign-frontend/src/components/layout/Sidebar.tsx');
const MOBILE = read('sovereign-frontend/src/components/layout/MobileNav.tsx');
const HEADER = read('sovereign-frontend/src/components/ui/PageHeader.tsx');

const hrefCount = (href) => NAV_ONLY.split(`href: '${href}'`).length - 1;
const inSections = (href) => SECTIONS.includes(`href: '${href}'`);

describe('เมนูรวม — หน้าเดิมต้องเหลือทางเดียว', () => {
  test('ศูนย์บัญชาการ AI รวม 8 หน้า และไม่โผล่ในเมนูหลัก', () => {
    const merged = ['/predictive', '/governance-sim', '/learning', '/risk-monitor', '/property', '/alerts', '/knowledge', '/reports'];
    for (const href of merged) {
      assert.equal(hrefCount(href), 0, `${href} ยังอยู่ในเมนูหลัก (ต้องย้ายไปแท็บของ /ai)`);
      assert.ok(inSections(href), `${href} หายไปจาก SECTIONS — ผู้ใช้จะเปิดไม่ได้`);
    }
    assert.equal(hrefCount('/ai'), 1, '/ai ต้องเหลือเมนูหลักรายการเดียว');
    assert.ok(SECTIONS.includes("id: 'ai'"), 'ต้องมี section id ai');
  });

  test('วิจัยพันธุ์ข้าว + Self-Check + MBTI ถูกควบเข้าเจ้าบ้านของตัวเอง', () => {
    assert.equal(hrefCount('/research/rice'), 0, '/research/rice ยังเป็นเมนูแยก');
    assert.ok(inSections('/research/rice'), 'ต้องมีแท็บวิจัยพันธุ์ข้าวใน /trace');

    assert.equal(hrefCount('/health/self-check'), 0, 'Self-Check ยังเป็นเมนูแยก');
    assert.equal(hrefCount('/mbti'), 0, 'MBTI ยังเป็นเมนูแยก');
    assert.ok(inSections('/health/self-check') && inSections('/mbti'), 'ต้องมีแท็บใน /health');
  });

  test('ระบบพื้นฐานรวม 4 หน้า และระบบรวมความจริงระบบ', () => {
    for (const href of ['/energy', '/automation', '/relay']) {
      assert.equal(hrefCount(href), 0, `${href} ยังเป็นเมนูแยก`);
      assert.ok(inSections(href), `${href} ต้องอยู่ในแท็บระบบพื้นฐาน`);
    }
    assert.equal(hrefCount('/system-health'), 0, '/system-health ยังเป็นเมนูแยก');
    assert.ok(inSections('/system-health'), 'ต้องมีแท็บความจริงระบบใน /system');
  });

  test('สำรองข้อมูล + เปลี่ยนรหัสผ่าน ย้ายเข้า /settings', () => {
    assert.equal(hrefCount('/backup'), 0, '/backup ยังเป็นเมนูแยก');
    assert.equal(hrefCount('/change-password'), 0, '/change-password ยังเป็นเมนูแยก');
    assert.ok(inSections('/backup') && inSections('/change-password'), 'ต้องมีแท็บใน /settings');
  });
});

describe('เมนูพับได้ + ค้นหาได้', () => {
  test('ร้านอาหารและการลงทุนเปิดโหมดพับเก็บ', () => {
    const at = NAV_ONLY.indexOf("href: '/restaurant'");
    assert.notEqual(at, -1, 'ไม่พบเมนูร้านอาหาร');
    assert.match(NAV_ONLY.slice(at, at + 1200), /collapsible: true/, 'ร้านอาหารต้องพับได้');

    const t = NAV_ONLY.indexOf("href: '/treasury'");
    assert.notEqual(t, -1, 'ไม่พบเมนูคลัง & ลงทุน');
    assert.match(NAV_ONLY.slice(t, t + 1200), /collapsible: true/, 'การลงทุนต้องพับได้');
  });

  test('ไม่มี href ซ้ำในเมนูหลัก', () => {
    const hrefs = [...NAV_ONLY.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
    const dup = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
    assert.deepEqual([...new Set(dup)], [], `เมนูซ้ำ: ${[...new Set(dup)].join(', ')}`);
  });

  test('ทุกแท็บถูกใส่ใน ALL_PAGES เพื่อให้ CommandPalette ยังค้นเจอ', () => {
    assert.match(NAV, /SECTIONS\.flatMap/, 'ALL_PAGES ต้องรวมแท็บจาก SECTIONS');
    assert.match(NAV, /dedupe|new Set|Set\(/, 'ต้องกันแท็บซ้ำกับเมนูหลัก');
  });

  test('Sidebar รองรับพับ/กางและจำสถานะ', () => {
    assert.match(SIDEBAR, /collapsible/, 'Sidebar ต้องอ่าน flag collapsible');
    assert.match(SIDEBAR, /chevron-(down|right)/, 'ต้องมีลูกศรบอกสถานะพับ');
    assert.match(SIDEBAR, /sovereign:nav-open/, 'ต้องจำสถานะที่ผู้ใช้พับไว้');
    assert.match(SIDEBAR, /aria-expanded/, 'ปุ่มพับต้องบอก screen reader');
    assert.match(SIDEBAR, /sectionForPath/, 'ต้องรู้ว่าเส้นทางลูกอยู่ในศูนย์ไหน');
  });

  test('MobileNav + PageHeader ใช้แผนที่ศูนย์เดียวกัน', () => {
    assert.match(MOBILE, /sectionForPath/, 'MobileNav ต้องไฮไลต์เมนูแม่เมื่ออยู่แท็บลูก');
    assert.match(HEADER, /SectionTabs/, 'PageHeader ต้องแสดงแท็บของศูนย์');
  });
});
