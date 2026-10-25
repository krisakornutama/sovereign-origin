#!/usr/bin/env node
/* ── "เลือกฟังก์ชั่นที่จะติดตั้ง" ──────────────────────────────────────────────
   เจ้าของสั่ง 25/10/69: "ก็อปปี้เป็นไฟล์ใหญ่เลย ทั้งระบบ เป็นตัวติดตั้ง ให้เลือก
   ฟังก์ชั่นที่จะติดตั้ง เช่น IOT ระบบเลี้ยงดูลูก"

   เทสต์ชุดนี้ล็อกกติกาของ "แคตตาล็อกฟังก์ชั่น" (tools/agent-pack/modules.mjs):
   1) เลือกด้วย "ตัวเลข" หรือ "ชื่อรหัส" ก็ได้ (คนพิมพ์ไม่เก่งใช้เลข, สคริปต์ใช้รหัส)
   2) กด Enter เฉย ๆ = ชุดที่แนะนำ (ต้องไม่ใช่ "ว่าง" จนเครื่องลูกไม่มีอะไรทำงาน)
   3) `a` / `all` = ทุกฟังก์ชั่น
   4) รหัสที่ไม่มีในแคตตาล็อก = ปฏิเสธทั้งชุด (ไม่ใช่เงียบ ๆ ตกหล่นข้อนั้น)
   5) ฟังก์ชั่นที่ `required` ติดมาทุกครั้ง แม้ผู้ใช้จะไม่ได้เลือก
   6) ชื่อโมดูลที่ส่งให้ backend (ENABLED_MODULES) ต้องเป็นชื่อที่ backend รู้จักจริง
      (AVAILABLE_MODULES = inventory|farm|vision|documents|restaurant) — ส่งชื่อมั่ว
      ไป backend จะเตือนแล้วเงียบ ⇒ หน้าฟาร์ม/ร้านอาหารยังขึ้น empty state ทั้งที่เลือกแล้ว
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKEND_MODULES,
  MODULE_CATALOG,
  enabledModulesFor,
  parseModuleSelection,
  recommendedIds,
  renderModuleMenu,
  summarizeModules,
} from '../agent-pack/modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** ฟังก์ชั่นที่เจ้าของเอ่ยถึงตรง ๆ — ต้องมีในแคตตาล็อกเสมอ */
const MUST_HAVE = ['iot', 'kids'];

describe('MODULE_CATALOG: แคตตาล็อกฟังก์ชั่นติดตั้ง', () => {
  test('มีฟังก์ชั่นที่เจ้าของสั่งไว้ (IoT, เลี้ยงดูลูก)', () => {
    const ids = MODULE_CATALOG.map((m) => m.id);
    for (const id of MUST_HAVE) assert.ok(ids.includes(id), `ขาดฟังก์ชั่น "${id}"`);
  });

  test('id ไม่ซ้ำ และเป็น ascii ตัวเล็ก (ใช้เป็นชื่อในไฟล์ .env ได้)', () => {
    const seen = new Set();
    for (const m of MODULE_CATALOG) {
      assert.match(m.id, /^[a-z][a-z0-9-]*$/, `id "${m.id}" ต้องเป็น ascii ตัวเล็ก`);
      assert.ok(!seen.has(m.id), `id "${m.id}" ซ้ำ`);
      seen.add(m.id);
    }
  });

  test('ทุกฟังก์ชั่นมีชื่อไทย + คำอธิบาย + หน้าเว็บที่ไม่ซ้ำกันข้ามฟังก์ชั่น', () => {
    const pages = new Map();
    for (const m of MODULE_CATALOG) {
      assert.ok(String(m.label ?? '').trim(), `${m.id} ไม่มีชื่อ`);
      assert.ok(String(m.desc ?? '').trim(), `${m.id} ไม่มีคำอธิบาย`);
      assert.ok(Array.isArray(m.pages), `${m.id} ต้องมี pages เป็น array`);
      for (const p of m.pages) {
        assert.match(p, /^\//, `${m.id}: หน้า "${p}" ต้องเริ่มด้วย /`);
        assert.ok(!pages.has(p), `หน้า "${p}" อยู่ทั้ง ${pages.get(p)} และ ${m.id} — ต้องมีเจ้าของเดียว`);
        pages.set(p, m.id);
      }
    }
  });

  test('มี "ระบบหลัก" ที่ required เสมอ (เครื่องลูกต้องมีตัวรันงาน + ต่อ HUB ได้)', () => {
    const required = MODULE_CATALOG.filter((m) => m.required);
    assert.equal(required.length, 1, 'ต้องมี required เดียว (core)');
    assert.equal(required[0].id, 'core');
  });

  test('enabledModules อ้างชื่อที่ backend รู้จักเท่านั้น', () => {
    for (const m of MODULE_CATALOG) {
      for (const name of m.enabledModules ?? []) {
        assert.ok(BACKEND_MODULES.includes(name), `${m.id}: "${name}" ไม่ใช่โมดูลที่ backend รู้จัก`);
      }
    }
  });

  test('ทุกหน้าที่อ้างในแคตตาล็อกมีอยู่จริง (กันสัญญาหน้าที่กลายเป็น 404)', () => {
    const pagesDir = path.join(ROOT, 'sovereign-frontend', 'src', 'pages');
    for (const m of MODULE_CATALOG) {
      for (const route of m.pages) {
        const rel = route.replace(/^\//, '');
        const flat = path.join(pagesDir, `${rel}.tsx`);
        const nested = path.join(pagesDir, rel, 'index.tsx');
        assert.ok(fs.existsSync(flat) || fs.existsSync(nested), `${m.id}: ไม่มีหน้า "${route}" ใน sovereign-frontend/src/pages`);
      }
    }
  });

  test('BACKEND_MODULES ตรงกับของจริงในโค้ด backend (กันชื่อเพี้ยนแบบเงียบ)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'config', 'index.ts'), 'utf8');
    const m = /export const AVAILABLE_MODULES = \[([^\]]+)\]/.exec(src);
    assert.ok(m, 'ไม่พบ AVAILABLE_MODULES ใน config/index.ts — ย้ายที่แล้วต้องอัปเดตเทสต์นี้');
    const real = [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
    assert.deepEqual([...BACKEND_MODULES].sort(), real.sort());
  });
});

describe('parseModuleSelection: อ่านคำตอบของผู้ใช้', () => {
  test('Enter เฉย ๆ = ชุดที่แนะนำ (ไม่ว่าง)', () => {
    const r = parseModuleSelection('', MODULE_CATALOG);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ids, recommendedIds(MODULE_CATALOG));
    assert.ok(r.ids.length >= 2);
  });

  test('ตัวเลข 1,3 = ฟังก์ชั่นที่ 1 และ 3 ตามลำดับที่โชว์', () => {
    const r = parseModuleSelection('1,3', MODULE_CATALOG);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ids, [MODULE_CATALOG[0].id, MODULE_CATALOG[2].id]);
  });

  test('ชื่อรหัสก็ได้ และตัดช่องว่าง/ตัวพิมพ์ใหญ่ได้', () => {
    const r = parseModuleSelection(' IoT , kids ', MODULE_CATALOG);
    assert.equal(r.ok, true);
    // core ตามมาเสมอ (required) — เรียงตามลำดับเมนู
    assert.deepEqual(r.ids, ['core', 'iot', 'kids']);
  });

  test('a / all = ทุกฟังก์ชั่น (เรียงตามแคตตาล็อก ไม่ซ้ำ)', () => {
    for (const input of ['a', 'all', 'ALL', '*']) {
      const r = parseModuleSelection(input, MODULE_CATALOG);
      assert.equal(r.ok, true, `"${input}" ต้องใช้ได้`);
      assert.deepEqual(r.ids, MODULE_CATALOG.map((m) => m.id));
    }
  });

  test('required ติดมาทุกครั้ง แม้เลือกแค่ฟังก์ชั่นเดียว', () => {
    const r = parseModuleSelection('kids', MODULE_CATALOG);
    assert.deepEqual(r.ids, ['core', 'kids']);
  });

  test('รหัสที่ไม่รู้จัก = ปฏิเสธทั้งชุด พร้อมบอกว่าคืออันไหน', () => {
    const r = parseModuleSelection('iot,ยานอวกาศ', MODULE_CATALOG);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'unknown');
    assert.equal(r.token, 'ยานอวกาศ');
    assert.equal(r.ids, undefined, 'ห้ามคืนรายการครึ่ง ๆ กลาง ๆ');
  });

  test('เลขที่ไม่มีในเมนู = ปฏิเสธ (ไม่ใช่เลือกตัวแรกให้)', () => {
    const r = parseModuleSelection('99', MODULE_CATALOG);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'out_of_range');
  });

  test('เลข 0 / ติดลบ = ปฏิเสธ', () => {
    for (const input of ['0', '-1']) {
      const r = parseModuleSelection(input, MODULE_CATALOG);
      assert.equal(r.ok, false);
    }
  });

  test('ช่องว่างล้วน / เครื่องหมายคั่นล้วน = ใช้ชุดแนะนำ (ไม่ล้ม)', () => {
    for (const input of ['   ', ',,', ' , ']) {
      const r = parseModuleSelection(input, MODULE_CATALOG);
      assert.equal(r.ok, true);
      assert.deepEqual(r.ids, recommendedIds(MODULE_CATALOG));
    }
  });
});

describe('enabledModulesFor: ชื่อที่ต้องเขียนลง ENABLED_MODULES', () => {
  test('รวมเฉพาะชื่อที่ backend รู้จัก และไม่ซ้ำ', () => {
    const ids = ['core', 'farm', 'restaurant', 'iot'];
    const names = enabledModulesFor(ids, MODULE_CATALOG);
    assert.deepEqual(names, [...names].filter((n, i) => names.indexOf(n) === i));
    for (const n of names) assert.ok(BACKEND_MODULES.includes(n));
    assert.ok(names.includes('farm') && names.includes('restaurant'));
  });

  test('ไม่เลือกฟังก์ชั่นที่มีประตู backend = ไม่มีชื่อนั้น (ปิดจริง ไม่ใช่แค่ซ่อนเมนู)', () => {
    const names = enabledModulesFor(['core', 'iot'], MODULE_CATALOG);
    assert.deepEqual(names, []);
  });
});

describe('renderModuleMenu / summarizeModules: ข้อความที่ผู้ใช้เห็น', () => {
  test('เมนูมีเลขกำกับทุกบรรทัด และบอกว่า Enter = ชุดแนะนำ', () => {
    const text = renderModuleMenu(MODULE_CATALOG, ['core', 'iot']);
    const lines = text.split('\n');
    MODULE_CATALOG.forEach((m, i) => {
      const line = lines.find((l) => l.includes(m.label));
      assert.ok(line, `เมนูขาด "${m.label}"`);
      assert.ok(line.includes(`${i + 1})`), `บรรทัดของ ${m.id} ไม่มีเลข ${i + 1})`);
    });
    assert.match(text, /Enter/);
  });

  test('ฟังก์ชั่นที่เลือกมีเครื่องหมาย ✔ (เห็นได้ว่ากดอะไรไป)', () => {
    const text = renderModuleMenu(MODULE_CATALOG, ['core', 'iot']);
    const iotLine = text.split('\n').find((l) => l.includes('IoT'));
    const kidsLine = text.split('\n').find((l) => l.includes('เลี้ยงดูลูก'));
    assert.match(iotLine, /✔/);
    assert.doesNotMatch(kidsLine, /✔/);
  });

  test('สรุปเป็นบรรทัดเดียว อ่านออกว่าเลือกอะไร (ใช้ในหน้า confirm + ไฟล์โปรไฟล์)', () => {
    const s = summarizeModules(['core', 'iot', 'kids'], MODULE_CATALOG);
    assert.match(s, /IoT/);
    assert.match(s, /เลี้ยงดูลูก/);
    assert.ok(s.length < 200, 'สรุปยาวเกินไปสำหรับบรรทัดเดียว');
  });
});
