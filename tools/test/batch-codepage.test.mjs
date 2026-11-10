#!/usr/bin/env node
/* ── ไฟล์ .cmd/.bat: ข้อความไทยต้องอยู่ "หลัง" บรรทัด chcp 65001 เท่านั้น ─────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (ของจริง 10/10/69):
   cmd.exe อ่านไฟล์ batch ทีละบรรทัดด้วย codepage ของคอนโซล ⇒ ถ้าไฟล์มีข้อความไทยก่อน
   บรรทัด `chcp 65001` ไบต์ไทยถูกตีความด้วย codepage เดิม แล้วเศษข้อความกลายเป็นคำสั่ง:
       'ง)' is not recognized as an internal or external command
       '...โฟลเดอร์โปรเจ็กไม่ได้' is not recognized as an internal or external command
   ไฟล์ทำอะไรไม่สำเร็จตั้งแต่บรรทัดแรก (เจอกับ tools\install\install.cmd, SETUP-MACHINE.cmd)
   ⇒ เทสต์นี้สแกนทุก .cmd/.bat ของโปรเจ็ก และทดสอบตัวแก้ (tools/fix-batch-codepage.mjs)
*/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBatchFiles, inspectBatch, planFix } from '../batch-codepage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp'); // ที่พักชั่วคราวต้องอยู่บนไดรฟ์โปรเจ็ก (AGENTS ข้อ 7)

const THAI = 'echo      กำลังติดตั้งเครื่องนี้ ...';

let sandbox;
beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'batch-cp-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const write = (name, text) => {
  const p = path.join(sandbox, name);
  fs.writeFileSync(p, text);
  return p;
};

describe('กติกา chcp ก่อนข้อความไทย', () => {
  test('ไฟล์ ASCII ล้วน = ผ่าน', () => {
    const p = write('ascii.cmd', '@echo off\r\nnode tools\\x.mjs\r\n');
    const r = inspectBatch(p);
    assert.equal(r.ok, true);
    assert.equal(r.hasNonAscii, false);
  });

  test('chcp 65001 มาก่อนข้อความไทย = ผ่าน', () => {
    const p = write('good.cmd', `@echo off\r\nchcp 65001 >nul\r\n${THAI}\r\n`);
    assert.equal(inspectBatch(p).ok, true);
  });

  test('ข้อความไทยก่อน chcp = ไม่ผ่าน และตัวแก้ต่อ chcp หลัง @echo off ให้', () => {
    const p = write('bad-before.cmd', `@echo off\r\n${THAI}\r\nchcp 65001 >nul\r\n`);
    const before = inspectBatch(p);
    assert.equal(before.ok, false);
    assert.equal(before.line, 2);

    const plan = planFix(p);
    assert.equal(plan.mode, 'inline');
    plan.apply();

    const after = inspectBatch(p);
    assert.equal(after.ok, true);
    const text = fs.readFileSync(p, 'utf8');
    assert.match(text.split(/\r?\n/)[0], /@echo off & chcp 65001 >nul/);
    assert.equal(text.includes(`\r\nchcp 65001 >nul\r\n`), false, 'บรรทัด chcp ซ้ำต้องถูกตัดออก');
    assert.ok(text.includes('กำลังติดตั้งเครื่องนี้'), 'ข้อความไทยเดิมต้องยังอยู่ครบ');
  });

  test('ไฟล์ที่ไม่มี chcp เลย = ตัวแก้เติมให้โดยคง EOL เดิม (CRLF)', () => {
    const p = write('no-chcp.cmd', `@echo off\r\nrem งานค้าง ${THAI}\r\nnode x.mjs\r\n`);
    assert.equal(inspectBatch(p).ok, false);
    planFix(p).apply();
    assert.equal(inspectBatch(p).ok, true);
    const text = fs.readFileSync(p, 'utf8');
    assert.match(text.split(/\r?\n/)[0], /@echo off & chcp 65001 >nul/);
    assert.equal(text.includes('\r\n'), true, 'ต้องไม่ทับ EOL ของไฟล์');
    assert.equal(text.includes('\n\n'), false);
  });

  test('แผนแก้ไม่ทำอะไรกับไฟล์ที่ผ่านแล้ว (idempotent)', () => {
    const p = write('good2.cmd', `@echo off\r\nchcp 65001 >nul\r\n${THAI}\r\n`);
    assert.equal(planFix(p), null);
  });
});

describe('ไฟล์ .cmd/.bat จริงในโปรเจ็ก', () => {
  const files = findBatchFiles(ROOT);

  test('สแกนเจอไฟล์ .cmd/.bat (ไม่ตายเปล่า)', () => {
    assert.ok(files.length > 0, 'ต้องเจอไฟล์ .cmd/.bat อย่างน้อยหนึ่งไฟล์');
  });

  for (const f of files) {
    const name = rel(f);
    test(name, () => {
      // cmd.exe อ่านไฟล์ batch ทีละบรรทัด — ไฟล์ต้องเป็น CRLF เท่านั้น (กติกา .gitattributes: *.cmd/*.bat eol=crlf)
      // ของจริง 11/10/69: INSTALL-DESKTOP.cmd หลุดมาเป็น LF ล้วน → cmd ตีความข้อความไทยเป็นคำสั่ง
      // ('…์' is not recognized) ⇒ ชุดติดตั้งแอปเดสก์ท็อปติดตั้งไม่สำเร็จตั้งแต่บรรทัดแรก
      const raw = fs.readFileSync(f, 'utf8');
      const lfOnly = (raw.match(/(?<!\r)\n/g) || []).length;
      assert.equal(lfOnly, 0, `${name}: พบ ${lfOnly} บรรทัดที่จบด้วย LF เดี่ยว — ไฟล์ .cmd/.bat ต้องเป็น CRLF ทั้งไฟล์`);
      const r = inspectBatch(f);
      if (!r.hasNonAscii) return;
      assert.ok(
        r.ok,
        `${name}: ข้อความไทยอยู่ก่อนบรรทัด chcp 65001 (บรรทัด ${r.line}) `
        + '⇒ cmd.exe ตีความไบต์ไทยเป็นคำสั่ง ไฟล์จะพังตั้งแต่บรรทัดแรก · '
        + 'แก้ด้วย: node tools/fix-batch-codepage.mjs --apply',
      );
    });
  }
});

describe('launcher .cmd ที่แปลงแล้ว: บรรทัดเดียว ASCII ไม่มี label', () => {
  // ไฟล์เหล่านี้เคยมีตรรกะ/ข้อความไทยอยู่ในตัว .cmd เอง (พังได้ทั้งด้วย codepage และ EOL)
  // ตอนนี้เหลือแค่ตัวเรียก: ตรรกะอยู่ใน .mjs/.ps1 ที่อ่าน/แก้ได้ และเทสต์ได้
  const ONE_LINE_LAUNCHERS = [
    'nightly-gate-task.cmd',
    'security-digest-task.cmd',
    'sovereign-offsite-task.cmd',
    'tools/install/install.cmd',
    'tools/cleanup-finish.cmd',
    'tools/repair-shell.cmd',
  ];

  for (const name of ONE_LINE_LAUNCHERS) {
    test(name, (t) => {
      const file = path.join(ROOT, name);
      // tools/* ถูก gitignore ⇒ launcher ที่ติดตั้งในเครื่องเจ้าของไม่มีใน clone
      // ข้ามเฉพาะไฟล์ที่ยังไม่ถูกติดตั้ง; ไฟล์ที่มีอยู่ต้องผ่านทุกข้อบังคับเดิม
      if (!fs.existsSync(file)) {
        t.skip(`${name} ยังไม่ถูกติดตั้งบนเครื่องนี้ (gitignore: tools/*)`);
        return;
      }
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      assert.equal(lines.length, 1, `${name}: launcher ต้องเหลือบรรทัดเดียว (พบ ${lines.length})`);
      assert.equal(/[^\x00-\x7F]/.test(text), false, `${name}: launcher ต้องเป็น ASCII ล้วน`);
      assert.match(text, /\.(mjs|ps1)\b/, `${name}: ต้องเรียกไฟล์ .mjs/.ps1 ที่ถือตรรกะไว้จริง`);
      assert.equal(/^\s*:|goto\s/i.test(text), false, `${name}: ห้ามมี label/goto (พังกับ EOL ผิด)`);
    });
  }

  test('launcher ที่คนดับเบิลคลิกเองต้องมี pause ให้อ่านผลก่อนหน้าต่างปิด', (t) => {
    // ตัวที่ Task Scheduler เรียก (nightly/security/offsite/visitor) ไม่ต้อง pause — ห้ามค้างในรอบอัตโนมัติ
    const launchers = ['tools/install/install.cmd', 'tools/cleanup-finish.cmd', 'tools/repair-shell.cmd']
      .map((name) => path.join(ROOT, name))
      .filter((file) => fs.existsSync(file));
    if (launchers.length === 0) {
      t.skip('ยังไม่มี launcher ที่ติดตั้งบนเครื่องนี้ (gitignore: tools/*)');
      return;
    }
    for (const file of launchers) {
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /\bpause\b/i, `${path.basename(file)}: ต้องมี pause`);
    }
  });
});
