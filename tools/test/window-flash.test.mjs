#!/usr/bin/env node
/* ── ห้าต่าง console ต้องไม่เด้งเอง ────────────────────────────────────────
   เคสจริง 12/10/69 (เครื่องนี้): เจ้าของเห็นหน้าต่าง node/docker โผล่มาเอง
     ทั้งที่ไม่ได้สั่งอะไร — "จู่ ๆ ก็เด้งขึ้นมาเอง"

   สาเหตุ: Task Scheduler แบบ "Run only when user is logged on" จะเปิด
     หน้าต่าง console จริงทุกครั้งที่งานรัน งานที่เรียก node.exe ตรง ๆ จึงเด้ง
     และมีอยู่ 4 งานที่รันทุกนาที ⇒ เด้งทุกนาที

   ทางแก้: ทุกงานต้องวิ่งผ่าน wscript.exe //B run-hidden.vbs
     (wscript ไม่เปิดหน้าต่าง แต่ยังคืน exit code ให้ Task Scheduler ดูได้)

   เทสต์นี้ล็อก:
     1) ต้องรู้จักว่า action แบบไหน "เปิดหน้าต่าง"
     2) งานที่รันทุกนาทีต้องถูกรวมในรายการที่ต้องซ่อม
     3) คำสั่งที่สร้างต้องวิ่งผ่าน wscript + run-hidden.vbs
     4) .cmd ต้องเป็น ASCII + CRLF + ไม่มี BOM และยกระดับสิทธิ์เอง
     5) ถ้างานในเครื่องจริงยังผิดอยู่ = เทสต์ต้องแดง (ตรวจของจริง ไม่ใช่แค่ตรวจโค้ด)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VISIBLE_TASKS,
  buildCmdLine,
  hiddenAction,
  isVisibleAction,
  buildFixCmd,
  run,
} from '../fix-window-flash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

describe('isVisibleAction — จำแนกงานที่เปิดหน้าต่าง', () => {
  test('node.exe ตรง ๆ = เปิดหน้าต่าง (กรณีจริงที่ทำให้เด้งทุกนาที)', () => {
    assert.equal(
      isVisibleAction('C:\\Program Files\\nodejs\\node.exe E:\\tools\\docker-watchdog.mjs""'),
      true,
    );
    assert.equal(isVisibleAction('cmd.exe /c E:\\x.cmd'), true);
    assert.equal(isVisibleAction('powershell.exe -File E:\\x.ps1'), true);
  });

  test('wscript //B = ไม่เปิดหน้าต่าง (วิธีที่ถูกต้อง)', () => {
    assert.equal(
      isVisibleAction('"C:\\Windows\\System32\\wscript.exe" //B "E:\\tools\\run-hidden.vbs" "E:\\x.cmd"'),
      false,
    );
  });

  test('ไม่มี action = ถือว่ายังต้องตรวจ (อย่าเดาว่าปลอดภัย)', () => {
    assert.equal(isVisibleAction(undefined), false, 'ไม่มี action = ไม่ต้องตรวจซ้ำซ้อน');
    assert.equal(isVisibleAction(''), false);
  });
});

describe('รายการงานที่ต้องซ่อม', () => {
  test('ต้องครอบคลุมงานที่รันทุกนาที (เด้งบ่อยที่สุด = กวนที่สุด)', () => {
    const names = VISIBLE_TASKS.map((t) => t.task);
    assert.ok(names.includes('Sovereign Docker Watch'), 'docker เป็นตัวที่เด้งพร้อม node');
    assert.ok(names.includes('Sovereign Frontend Watch'));
    for (const t of VISIBLE_TASKS) {
      assert.ok(fs.existsSync(path.join(REPO, t.script)), `ไม่พบสคริปต์ ${t.script}`);
      assert.ok(fs.existsSync(path.join(REPO, 'tools', 'run-hidden.vbs')), 'ต้องมีตัวซ่อนหน้าต่าง');
    }
  });

  test('คำสั่งที่สร้างต้องวิ่งผ่าน wscript + run-hidden.vbs', () => {
    for (const t of VISIBLE_TASKS) {
      const a = hiddenAction(t.cmd);
      assert.match(a, /wscript\.exe/i, `${t.task}: ต้องใช้ wscript`);
      assert.match(a, /run-hidden\.vbs/i, `${t.task}: ต้องผ่าน run-hidden.vbs`);
      assert.equal(isVisibleAction(a), false, `${t.task}: คำสั่งที่ได้ยังเปิดหน้าต่างอยู่`);
    }
  });

  test('ไฟล์ .cmd ของแต่ละงานต้องมีอยู่และชี้สคริปต์ถูกตัว', () => {
    for (const t of VISIBLE_TASKS) {
      const abs = path.join(REPO, 'tools', 'hidden-tasks', t.cmd);
      assert.ok(fs.existsSync(abs), `ไม่พบ ${t.cmd} — wscript จะออกด้วยรหัส 2`);
      const body = fs.readFileSync(abs, 'ascii');
      assert.ok(body.includes(t.script.replace(/\//g, '\\')), `${t.cmd} ต้องชี้ ${t.script}`);
    }
  });

  test('buildCmdLine ต้องเรียก node ด้วยพาธเต็ม (พึ่ง PATH = เปราะ)', () => {
    const line = buildCmdLine('tools\\docker-watchdog.mjs');
    assert.match(line, /"[^"]*node\.exe"/i, 'ต้องใช้พาธเต็มของ node');
    assert.match(line, /docker-watchdog\.mjs/);
  });
});

describe('ไฟล์ดับเบิลคลิก', () => {
  const body = buildFixCmd();

  test('ASCII ล้วน (ข้อความไทยใน .cmd ทำให้ cmd.exe พังทั้งไฟล์)', () => {
    const bad = body.split('\r\n').find((l) => /[^\x00-\x7F]/.test(l));
    assert.equal(bad, undefined, `พบ: ${bad ?? ''}`);
  });

  test('CRLF ทุกบรรทัด', () => {
    assert.ok(!body.includes('\n') || !/[^\r]\n/.test(body), 'ต้องไม่มี LF เปล่าๆ');
  });

  test('ต้องยกระดับสิทธิ์เอง (schtasks แก้งานผู้ใช้ไม่ได้ถ้าไม่มีสิทธิ์)', () => {
    assert.ok(body.includes('net session'), 'ต้องตรวจสิทธิ์');
    assert.ok(body.includes('-Verb RunAs'), 'ต้องยกระดับเอง');
    const at = body.indexOf('net session');
    assert.ok(at < body.indexOf('-Verb RunAs'), 'ต้องยกระดับก่อนสั่งงาน');
  });

  test('ต้องเรียกตัวซ่อมจริง', () => {
    assert.ok(body.includes('fix-window-flash.mjs'));
    assert.ok(body.includes('pause'), 'ต้องค้างหน้าต่างไว้ให้เจ้าของอ่านผล');
  });
});

describe('ตรวจของจริงบนเครื่องนี้', () => {
  for (const t of VISIBLE_TASKS) {
    test(`${t.task} ต้องไม่เปิดหน้าต่างแล้ว`, (t2) => {
      const q = run('schtasks.exe', ['/query', '/TN', t.task, '/fo', 'CSV', '/v']);
      if (q.code !== 0 || !q.out.includes(t.task)) {
        t2.skip(`ไม่มีงาน "${t.task}" บนเครื่องนี้`);
        return;
      }
      const m = /"([^"]*?(?:node\.exe|wscript\.exe)[^"]*)"/i.exec(q.out);
      // ห้ามผ่านมั่ว: ถ้าหา action ไม่ได้ = ตรวจไม่ได้ ไม่ใช่ "ผ่าน"
      //   (เคสจริง 12/10/69: regex จับไม่เจอ ⇒ เทสต์เขียวทั้งที่ยังเด้งทุกนาที)
      assert.ok(m, `อ่าน action ของ "${t.task}" ไม่ได้ — ตรวจผ่านไปแบบมั่ว:\n${q.out.slice(0, 300)}`);
      assert.equal(
        isVisibleAction(m[1]),
        false,
        `ยังเปิดหน้าต่างอยู่:\n  ${m[1]}\n  แก้: ดับเบิลคลิก FIX-WINDOW-FLASH.cmd (ต้องสิทธิ์ผู้ดูแล)`,
      );
    });
  }
});
