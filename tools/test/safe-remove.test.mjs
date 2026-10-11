#!/usr/bin/env node
/* ── ด่านกันลบของที่ระบบยังพึ่งพา ────────────────────────────────────────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (ของจริง 10/10/69): สคริปต์คัดของลบ tools\Git จนเหลือครึ่งเดียว
   ⇒ เครื่องนี้ไม่มี git เหลือเลย และ terminal ของแอปตายทั้งตัว (shell resolve ไปที่
   tools\Git\bin\bash.exe) · เทสต์นี้พิสูจน์ว่าเครื่องมือ *ปฏิเสธ* เมื่อปลายทางยังถูกอ้างถึง
   และเมื่อลบจริงจะเป็นการย้ายเข้า archive เสมอ (ไม่มีการลบตรง ๆ)
*/
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencedByPathEnv, removalVerdict, removeOrArchive, isInside } from '../safe-remove.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp'); // ที่พักชั่วคราวต้องอยู่บนไดรฟ์โปรเจ็ก (AGENTS ข้อ 7)

let sandbox;
let victim;

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'safe-remove-'));
  victim = path.join(sandbox, 'Git');
  fs.mkdirSync(path.join(victim, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(victim, 'bin', 'bash.exe'), 'fake shell');
  fs.writeFileSync(path.join(victim, 'bin', 'git.exe'), 'fake git');
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const envWith = (...dirs) => ({ PATH: ['C:\\Windows\\System32', ...dirs].join(path.delimiter) });

describe('referencedByPathEnv', () => {
  test('จับได้เมื่อ PATH ชี้ตรงที่โฟลเดอร์นั้น', () => {
    const hits = referencedByPathEnv(victim, envWith(victim));
    assert.equal(hits.length, 1);
    assert.match(hits[0], /PATH/);
  });

  test('จับได้เมื่อ PATH ชี้ที่โฟลเดอร์ย่อย (เคสจริง: PATH ชี้ tools\\Git\\bin)', () => {
    const hits = referencedByPathEnv(victim, envWith(path.join(victim, 'bin')));
    assert.equal(hits.length, 1);
    assert.match(hits[0], /โฟลเดอร์ย่อย/);
  });

  test('ไม่จับมั่ว — PATH ที่ไม่เกี่ยวข้องคืนค่าว่าง', () => {
    assert.deepEqual(referencedByPathEnv(victim, envWith(path.join(sandbox, 'อื่น'))), []);
  });

  test('เทียบแบบไม่สนตัวพิมพ์ (Windows)', () => {
    const hits = referencedByPathEnv(victim, envWith(victim.toUpperCase()));
    assert.equal(hits.length, 1);
  });
});

describe('removalVerdict: ปฏิเสธเมื่อยังถูกอ้างถึง', () => {
  const safe = { lockProbe: () => false, alternatives: ['C:\\Program Files\\Git\\cmd\\git.exe'], env: {} };

  test('ยังถูกอ้างโดย PATH/โฟลเดอร์ย่อย = ห้ามลบ', () => {
    const v = removalVerdict(victim, { ...safe, env: envWith(path.join(victim, 'bin')) });
    assert.equal(v.allowed, false);
    assert.ok(v.blocked.some((b) => b.includes('โฟลเดอร์ย่อย')));
  });

  test('ยังถูกอ้างโดยผู้เรียกระบุเอง (terminal ของแอป) = ห้ามลบ', () => {
    const v = removalVerdict(victim, {
      ...safe,
      references: [{ what: 'terminal ของแอป', detail: 'shell resolve ไปที่ bin\\bash.exe' }],
    });
    assert.equal(v.allowed, false);
    assert.ok(v.blocked.some((b) => b.includes('terminal ของแอป')));
  });

  test('ไม่มีของใช้แทน = ห้ามลบ (ลบแล้วระบบขาดความสามารถนั้น)', () => {
    const v = removalVerdict(victim, { lockProbe: () => false, alternatives: [], env: {} });
    assert.equal(v.allowed, false);
    assert.ok(v.blocked.some((b) => b.includes('ไม่มีของใช้แทนได้') || b.includes('ไม่พบของใช้แทนได้')));
  });

  test('มีไฟล์ถูกล็อกอยู่ = ห้ามลบ (กันลบได้ครึ่ง ๆ กลาง ๆ)', () => {
    const v = removalVerdict(victim, { ...safe, lockProbe: () => true });
    assert.equal(v.allowed, false);
    assert.ok(v.blocked.some((b) => b.includes('ถูก process เปิดอยู่')));
  });

  test('เคสจริง: tools\\Git ที่มี bash.exe อยู่ใน PATH ของเครื่อง = ห้ามลบ ถึงตอบ y ก็ห้าม', () => {
    const v = removalVerdict(victim, {
      env: envWith(path.join(victim, 'bin')),
      references: [{ what: 'terminal ของแอป Freebuff', detail: 'tools\\Git\\bin\\bash.exe' }],
      alternatives: [],
      lockProbe: () => false,
    });
    assert.equal(v.allowed, false);
    assert.ok(v.blocked.length >= 3, `ต้องปฏิเสธหลายเหตุผล (ได้ ${v.blocked.length})`);
  });

  test('ไม่มีการอ้างถึง + มีของใช้แทน = ผ่าน', () => {
    const v = removalVerdict(victim, safe);
    assert.equal(v.allowed, true);
    assert.deepEqual(v.blocked, []);
  });
});

describe('removeOrArchive: ย้ายเข้า archive ไม่ลบตรง ๆ', () => {
  const allowed = { lockProbe: () => false, alternatives: ['C:\\git\\git.exe'], env: {} };

  test('ผ่านด่าน → ต้นทางหาย แต่ของยังอยู่ครบใน archive', () => {
    const archiveRoot = path.join(sandbox, 'SovereignArchive');
    const r = removeOrArchive(victim, { archiveRoot, label: 'tools-Git', ...allowed });

    assert.equal(r.removed, true);
    assert.equal(fs.existsSync(victim), false);
    assert.ok(r.archivedTo && fs.existsSync(r.archivedTo), 'ต้องมีสำเนาใน archive');
    assert.equal(fs.readFileSync(path.join(r.archivedTo, 'bin', 'bash.exe'), 'utf8'), 'fake shell');
  });

  test('ไม่ผ่านด่าน → ไม่แตะอะไรเลย', () => {
    const archiveRoot = path.join(sandbox, 'SovereignArchive');
    const r = removeOrArchive(victim, {
      archiveRoot,
      label: 'tools-Git',
      lockProbe: () => false,
      alternatives: [],
      env: envWith(path.join(victim, 'bin')),
    });

    assert.equal(r.removed, false);
    assert.equal(r.archivedTo, null);
    assert.equal(fs.existsSync(path.join(victim, 'bin', 'git.exe')), true, 'ของเดิมต้องยังอยู่');
    assert.equal(fs.existsSync(archiveRoot), false, 'ต้องไม่สร้าง archive เลย');
  });

  test('path ที่ไม่มีอยู่ = ไม่ทำอะไร ไม่ throw', () => {
    const r = removeOrArchive(path.join(sandbox, 'ไม่มีอยู่'), { archiveRoot: path.join(sandbox, 'a') });
    assert.equal(r.removed, false);
    assert.equal(r.verdict.exists, false);
  });
});

describe('isInside', () => {
  test('ลูก/ตัวเอง = true · พี่น้อง/คนละที่ = false', () => {
    assert.equal(isInside(victim, path.join(victim, 'bin')), true);
    assert.equal(isInside(victim, victim), true);
    assert.equal(isInside(victim, path.join(sandbox, 'อื่น')), false);
  });
});
