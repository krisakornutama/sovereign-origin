// tools/test/scroll-to-top.test.mjs
//
// ── กัน "เปลี่ยนหน้าแล้วยังค้างกลางหน้า" ──
//
// 14/10/69 เจ้าของแจ้ง: กดเข้า "ร้านอาหาร" / "ธุรกิจ" แล้วเนื้อหาไม่อยู่ด้านบน
// ต้องเลื่อนขึ้นไปเองทีละหน้าจึงจะใช้งานได้
//
// รากของปัญหา: ทั้งแอปตั้ง scroll={false} ไว้ทุกลิงก์ (Sidebar · MobileNav ·
// CommandPalette · ลิงก์ในหน้า) = ตั้งใจไม่ให้ Next เลื่อนหน้าเอง
// แต่ไม่มีตัวไหนพากลับขึ้นบนสุด เมื่อเปลี่ยนหน้า
//
// กติกาที่เทสต์นี้ล็อกไว้:
//   1) ต้องมีกลไก scroll กลับบนสุดเมื่อ pathname เปลี่ยน
//   2) ต้องไม่ทับลิงก์ที่มี hash (/treasury#runway ต้องไปที่ anchor ไม่ใช่บนสุด)
//   3) ต้องอยู่ใน Sidebar (ไม่แตะ _app.tsx ที่อยู่ในรายการห้ามแตะ) และครอบคลุมหน้าส่วนใหญ่
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIDEBAR = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'layout', 'Sidebar.tsx');

assert.ok(fs.existsSync(SIDEBAR), `หา Sidebar.tsx ไม่เจอที่ ${SIDEBAR}`);

const src = fs.readFileSync(SIDEBAR, 'utf8');
const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('มีกลไกเลื่อนกลับบนสุดเมื่อเปลี่ยนหน้า', () => {
  assert.match(code, /window\.scrollTo\(\s*0\s*,\s*0\s*\)/, 'Sidebar ต้องมี window.scrollTo(0, 0)');
  assert.match(code, /useEffect\([\s\S]*?pathname/, 'effect ต้องผูกกับ pathname (เปลี่ยนเมื่อเส้นทางเปลี่ยน)');
});

test('เคารพลิงก์ที่มี hash — ต้องไปที่ anchor ไม่ใช่บนสุด', () => {
  assert.match(code, /window\.location\.hash/, 'ต้องตรวจ hash ก่อน scroll');
  // เงื่อนไข "มี hash = ปล่อยให้ Next จัดการ" ต้องอยู่ก่อนคำสั่ง scroll
  const hashAt = code.indexOf('window.location.hash');
  const scrollAt = code.indexOf('window.scrollTo');
  assert.ok(hashAt > -1 && scrollAt > hashAt, 'ตรวจ hash ต้องมาก่อนคำสั่ง scroll');
});

test('Sidebar ครอบคลุมหน้าเกือบทั้งระบบ (ผูกกับ Sidebar = ครอบคลุมอัตโนมัติ)', () => {
  const pagesDir = path.join(ROOT, 'sovereign-frontend', 'src', 'pages');
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  const pages = walk(pagesDir).filter((f) => f.endsWith('.tsx') && !path.basename(f).startsWith('_'));
  const withSidebar = pages.filter((f) => /<Sidebar/.test(fs.readFileSync(f, 'utf8')));
  const ratio = withSidebar.length / pages.length;
  assert.ok(ratio > 0.9, `Sidebar อยู่แค่ ${withSidebar.length}/${pages.length} หน้า (${Math.round(ratio * 100)}%) — กลไกนี้ครอบคลุมไม่ทั่วถึง`);
});

test('ต้องไม่ไปแตะ _app.tsx (อยู่ในรายการห้ามแตะของ AGENTS.md)', () => {
  const app = path.join(ROOT, 'sovereign-frontend', 'src', 'pages', '_app.tsx');
  const appCode = fs.readFileSync(app, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(appCode, /window\.scrollTo\(\s*0\s*,\s*0\s*\)/, 'กลไกนี้ต้องอยู่ที่ Sidebar ไม่ใช่ _app.tsx');
});