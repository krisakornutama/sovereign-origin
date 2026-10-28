#!/usr/bin/env node
// C4 — onboarding ผู้ใช้ใหม่: หน้าตา "/start" ที่บอกว่าเริ่มใช้ระบบยังไง
//
// เหตุผลที่ต้องมีไฟล์นี้: คนในบ้านล็อกอินครั้งแรกแล้วเจอ dashboard ที่มี 40 เมนู
// ไม่รู้ว่าจะเริ่มตรงไหน ⇒ ต้องมีหน้าเริ่มใช้งานที่ (1) มีขั้นตอนจริง (2) ลิงก์ไปหน้าที่ทำได้จริง
// (3) จำได้ว่าทำอะไรแล้ว (4) ข้ามได้ และ (5) ล็อกอินครั้งแรกพาไปที่นั่นครั้งเดียว
//
// ตรวจแบบ static + เรียกฟังก์ชันจริง (Node 24 รัน .ts ได้) — ไม่ต้องมี server/บัญชี
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_RUN_KEY, FIRST_RUN_STEPS_KEY, nextPathAfterLogin } from '../../sovereign-frontend/src/lib/firstRun.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const START_PAGE = 'sovereign-frontend/src/pages/start.tsx';

describe('firstRun — ล็อกอินครั้งแรกต้องพาไปหน้าเริ่มใช้งาน', () => {
  test('ยังไม่เคยเห็น → /start', () => {
    assert.equal(nextPathAfterLogin({ mustChangePassword: false, firstRunSeen: false }), '/start');
  });

  test('เคยเห็นแล้ว → /dashboard (ไม่วนซ้ำ)', () => {
    assert.equal(nextPathAfterLogin({ mustChangePassword: false, firstRunSeen: true }), '/dashboard');
  });

  test('ต้องเปลี่ยนรหัสก่อน → /change-password ชนะทุกกรณี', () => {
    assert.equal(nextPathAfterLogin({ mustChangePassword: true, firstRunSeen: false }), '/change-password');
    assert.equal(nextPathAfterLogin({ mustChangePassword: true, firstRunSeen: true }), '/change-password');
  });

  test('คีย์ที่ใช้จำต้องมีชื่อชัดและไม่ชนกับของเดิม', () => {
    assert.match(FIRST_RUN_KEY, /^sovereign\./);
    assert.match(FIRST_RUN_STEPS_KEY, /^sovereign\./);
    assert.notEqual(FIRST_RUN_KEY, FIRST_RUN_STEPS_KEY);
  });

  test('หน้า login (ปกติ + OTP 2 ทาง) ใช้ตัวตัดสินใจกลาง ไม่ push /dashboard เอง', () => {
    for (const f of [
      'sovereign-frontend/src/components/auth/LoginForm.tsx',
      'sovereign-frontend/src/components/auth/MfaInput.tsx',
    ]) {
      const src = read(f);
      assert.match(src, /loginLandingPath\(/, `${f} ต้องเรียก loginLandingPath()`);
      assert.doesNotMatch(
        src,
        /router\.push\([^)]*'\/(dashboard|change-password)'/,
        `${f} ยัง push path เองอยู่ — ต้องใช้ตัวกลางตัวเดียว`,
      );
    }
  });
});

describe('หน้า /start — ขั้นตอนเริ่มใช้งานที่ทำได้จริง', () => {
  test('มีไฟล์หน้า และมี Sidebar ตามกฎ layout', () => {
    assert.ok(exists(START_PAGE), 'ต้องมี src/pages/start.tsx');
    assert.match(read(START_PAGE), /import Sidebar from/);
  });

  test('มีอย่างน้อย 5 ขั้นตอน และทุกขั้นชี้ไปหน้าที่มีอยู่จริง', () => {
    const src = read(START_PAGE);
    const hrefs = [...src.matchAll(/href="(\/[a-z0-9-]*)"/g)].map((m) => m[1]);
    const stepHrefs = [...new Set(hrefs)].filter((h) => h !== '/dashboard');
    assert.ok(stepHrefs.length >= 5, `ต้องมีขั้นตอน ≥5 (พบ ${stepHrefs.length}: ${stepHrefs.join(', ')})`);
    for (const href of stepHrefs) {
      const rel = href.slice(1);
      const candidates = [`sovereign-frontend/src/pages/${rel}.tsx`, `sovereign-frontend/src/pages/${rel}/index.tsx`];
      assert.ok(candidates.some(exists), `ลิงก์ ${href} ไม่มีหน้าจริงรองรับ`);
    }
  });

  test('ทุกขั้นมี checkbox "ทำแล้ว" ที่ผูก label กับช่องจริง (a11y)', () => {
    const src = read(START_PAGE);
    assert.ok([...src.matchAll(/type="checkbox"/g)].length >= 1, 'ต้องมี checkbox ให้ทำเครื่องหมายว่าทำแล้ว');
    // label ต้องผูกกับ checkbox ตัวเดียวกันจริง (prefix เดียวกัน) ไม่ปล่อย label ลอย
    assert.match(src, /htmlFor=\{`step-\$\{/, 'label ต้องมี htmlFor ที่ผูกกับ checkbox');
    assert.match(src, /id=\{`step-\$\{/, 'checkbox ต้องมี id ที่ตรงกับ htmlFor');
  });

  test('จำความคืบหน้าไว้ใน localStorage ผ่านคีย์กลาง และบอกความคืบหน้าเป็นตัวเลข', () => {
    const src = read(START_PAGE);
    const lib = read('sovereign-frontend/src/lib/firstRun.ts');
    assert.match(src, /readDoneSteps\(/, 'ต้องอ่านความคืบหน้าผ่าน helper กลาง');
    assert.match(src, /writeDoneSteps\(/, 'ต้องบันทึกความคืบหน้าผ่าน helper กลาง');
    assert.match(lib, /localStorage/, 'helper กลางต้องเก็บใน localStorage');
    assert.match(lib, /FIRST_RUN_STEPS_KEY/, 'helper กลางต้องใช้คีย์กลาง');
    assert.doesNotMatch(src, /localStorage\.setItem\(\s*'sovereign\./, 'ห้ามตั้งคีย์เองในหน้า');
    assert.match(src, /\{done\.length\}/, 'ต้องแสดงความคืบหน้าเป็นตัวเลข');
  });

  test('ข้ามได้ และพาไป dashboard (ไม่ขังผู้ใช้)', () => {
    const src = read(START_PAGE);
    assert.match(src, /markFirstRunSeen\(/, 'การข้ามต้องจำว่าเห็นแล้ว');
    assert.match(src, /'\/dashboard'|\"\/dashboard\"/, 'ต้องมีทางไป dashboard');
  });

  test('มีข้อความสองภาษา (th/en) ครบชุดเดียวกัน', async () => {
    const th = (await import('../../sovereign-frontend/src/i18n/th/pages/start.ts')).default;
    const en = (await import('../../sovereign-frontend/src/i18n/en/pages/start.ts')).default;
    const keys = (o, prefix = '') =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    assert.deepEqual(keys(en).sort(), keys(th).sort(), 'คีย์ th/en ต้องตรงกัน');
    assert.ok(keys(th).length >= 15, 'ต้องมีคีย์พอสมควรสำหรับหน้าเริ่มใช้งาน');
  });

  test('i18n ของหน้า /start ถูก import เข้า dictionary จริง (ไม่ใช่ไฟล์ลอย)', () => {
    for (const lang of ['th', 'en']) {
      const idx = read(`sovereign-frontend/src/i18n/${lang}/index.ts`);
      assert.match(idx, /from '\.\/pages\/start'/, `${lang}/index.ts ต้อง import pages/start`);
      assert.match(idx, /^\s*start,\s*$/m, `${lang}/index.ts ต้องใส่ start ใน dictionary`);
    }
  });
});

describe('แถบ "เชื่อมต่อไม่ได้" — ต้องบอกให้รู้ว่าตรวจอะไร', () => {
  test('ApiConnectionBanner บอกขั้นตอนตรวจ (docker) ไม่ใช่แค่ "กำลังเชื่อมต่อใหม่"', () => {
    const src = read('sovereign-frontend/src/components/layout/ApiConnectionBanner.tsx')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(src, /docker ps/, 'ต้องบอกคำสั่งที่ใช้ตรวจได้จริง (docker ps)');
    assert.match(src, /sovereign-core-api/, 'ต้องบอกว่าต้องดู container ตัวไหน');
  });
});

describe('error ของหน้าที่คนในบ้านใช้ — ต้องบอกทางแก้', () => {
  const WIRED = [
    'sovereign-frontend/src/pages/energy.tsx',
    'sovereign-frontend/src/pages/inventory.tsx',
    'sovereign-frontend/src/pages/system-health.tsx',
  ];

  for (const f of WIRED) {
    test(`${path.basename(f)}: ใช้ ErrorNotice แทนการโชว์ error ดิบ`, () => {
      const src = read(f);
      assert.match(src, /import ErrorNotice from/, `${f} ต้อง import ErrorNotice`);
      assert.match(src, /<ErrorNotice/, `${f} ต้อง render <ErrorNotice`);
      assert.match(src, /onRetry=/, `${f} ต้องให้ผู้ใช้กดลองใหม่ได้`);
    });
  }
});
