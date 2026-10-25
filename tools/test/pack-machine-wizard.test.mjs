#!/usr/bin/env node
/* ── PACK-MACHINE.cmd: "ดับเบิลคลิก → ตอบไม่กี่คำถาม → ได้ชุดติดตั้ง" ─────────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้
   1) คำสั่งจริงยาวและจำยาก (`--name=.. --full --out=..`) ⇒ เจ้าของต้องเปิด PowerShell เอง
      พิมพ์ผิดนิดเดียว/ลืม flag ก็ต้องเริ่มใหม่ทั้งกระบวนการ
   2) ทุกเครื่องเคยเขียนชุดติดตั้งลงโฟลเดอร์เดียวกัน (`dist-machine-setup`) ⇒ แพ็กเครื่องที่ 2
      ทับชุดของเครื่องแรกที่ยังไม่ได้ก็อปไปเครื่องปลายทาง (ประตูตายที่ต้องเดินผ่านทุกครั้ง)
   3) ชื่อชนกับเครื่องที่เคยออนไลน์แล้ว = จบด้วย error ⇒ ผู้ใช้ต้องเริ่มใหม่
   4) ไฟล์ .cmd ต้องเป็น ASCII ล้วน + CRLF + มี pause ทุกเส้นทาง (กติกาเดียวกับ SETUP-MACHINE.cmd
      ที่เคยพังจริงเพราะข้อความไทยอยู่ก่อนบรรทัด chcp 65001)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  NAME_ERRORS,
  outDirFor,
  runWizard,
  safeFolderName,
  validateMachineName,
} from '../agent-pack/pack-machine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** ที่พักชั่วคราวต้องอยู่บนไดรฟ์โปรเจ็ก (AGENTS.md ข้อ 7) */
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp');
const OUT_ROOT = path.join(TMP_ROOT, 'wizard-out');

/** คำตอบที่เตรียมไว้ให้ `ask` — ถามเกินจำนวน = ผิดสัญญา ให้เทสต์ล้มทันที */
function scripted(answers) {
  const queue = [...answers];
  const ask = async () => {
    if (!queue.length) throw new Error('ถามเกินจำนวนคำตอบที่เตรียมไว้ (ลำดับคำถามเปลี่ยน?)');
    return queue.shift();
  };
  ask.left = () => queue.length;
  return ask;
}

/** pack ปลอมที่สำเร็จ — เก็บ opts ไว้ตรวจ */
function okPack(calls) {
  return async (opts) => {
    calls.push(opts);
    return { exitCode: 0, code: 'ok', report: `  (แพ็ก ${opts.name} แล้ว)`, bundleDir: opts.outDir };
  };
}

const wizard = (over = {}) =>
  runWizard({
    hostname: 'HUB-PC',
    hubUrl: 'http://192.168.1.101:3000',
    outRoot: OUT_ROOT,
    ...over,
  });

// ─────────────────────────────────────────────────────────────────────────────
describe('safeFolderName: ชื่อเครื่อง → ชื่อโฟลเดอร์ที่ Windows ใช้ได้', () => {
  test('คงภาษาไทยไว้ (ชื่อเครื่องจริงเป็นไทย)', () => {
    assert.equal(safeFolderName('เครื่องที่-4'), 'เครื่องที่-4');
    assert.equal(safeFolderName('คอมเครื่องที่ 2'), 'คอมเครื่องที่ 2');
  });

  test('แทนอักขระต้องห้ามของ Windows ด้วย - (ไม่ทำให้แพ็กพัง)', () => {
    const out = safeFolderName('a/b\\c:d*e?f"g<h>i|j');
    assert.equal(/[<>:"/\\|?*]/.test(out), false, `ยังมีอักขระต้องห้าม: ${out}`);
    assert.match(out, /^a-b-c-d-e-f-g-h-i-j$/);
  });

  test('ตัดช่องว่าง/จุดหัวท้าย (Windows สร้างโฟลเดอร์ที่ลงท้ายด้วยจุดไม่ได้)', () => {
    assert.equal(safeFolderName('  เครื่อง 4 . .  '), 'เครื่อง 4');
    assert.equal(safeFolderName('...'), 'machine');
  });

  test('ชื่อว่าง/มีแต่ช่องว่าง = machine (ไม่คืนค่าว่างให้ path.join กลายเป็นรากโฟลเดอร์)', () => {
    assert.equal(safeFolderName(''), 'machine');
    assert.equal(safeFolderName('   '), 'machine');
    assert.equal(safeFolderName(null), 'machine');
  });

  test('ชื่อสงวนของ Windows (CON/PRN/COM1) ต้องไม่ถูกใช้ตรง ๆ', () => {
    assert.equal(safeFolderName('CON'), 'CON-machine');
    assert.equal(safeFolderName('com1'), 'com1-machine');
  });

  test('จำกัดความยาว (path ทั้งเส้นต้องไม่เกินเพดาน Windows)', () => {
    const out = safeFolderName('ก'.repeat(300));
    assert.ok(out.length <= 80, `ยาว ${out.length}`);
  });
});

describe('validateMachineName: ชื่อที่ยอมรับ', () => {
  test('ตัดช่องว่างหัวท้าย + ยุบช่องว่างซ้ำ', () => {
    assert.deepEqual(validateMachineName('  เครื่องที่-5   ใหม่ '), { ok: true, name: 'เครื่องที่-5 ใหม่' });
  });

  test('ว่าง = ไม่ผ่าน พร้อมเหตุผลที่อ่านรู้เรื่อง', () => {
    const r = validateMachineName('   ');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'empty');
    assert.equal(typeof NAME_ERRORS.empty, 'string');
  });

  test('ยาวเกิน 64 = ไม่ผ่าน', () => {
    assert.equal(validateMachineName('ก'.repeat(65)).error, 'too_long');
    assert.equal(validateMachineName('ก'.repeat(64)).ok, true);
  });

  test('อักขระควบคุม (เช่น \\u0000) = ไม่ผ่าน — กันชื่อที่พิมพ์ออกมาแล้วอ่านไม่รู้เรื่อง', () => {
    assert.equal(validateMachineName('เครื่อง\u0000ลับ').error, 'control');
  });
});

describe('outDirFor: เครื่องแต่ละเครื่องได้โฟลเดอร์ของตัวเอง', () => {
  test('ไม่ระบุ --out = <ที่เขียนได้>/<ชื่อเครื่อง>', () => {
    assert.equal(outDirFor({ name: 'เครื่องที่-4', outRoot: OUT_ROOT }), path.join(OUT_ROOT, 'เครื่องที่-4'));
  });

  test('ระบุ --out = ใช้พาธนั้นตรง ๆ (ผู้ใช้สั่งเอง)', () => {
    assert.equal(
      outDirFor({ name: 'เครื่องที่-4', outRoot: OUT_ROOT, explicitOut: 'E:\\ชุดติดตั้ง' }),
      path.resolve('E:\\ชุดติดตั้ง'),
    );
  });

  test('ไม่มีที่เขียนได้เลย = คืนค่าว่าง (ให้ pack.mjs ตัดสินใจเอง ไม่เดาพาธ)', () => {
    assert.equal(outDirFor({ name: 'เครื่องที่-4', outRoot: '' }), '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runWizard: ตอบคำถามแล้วจบ', () => {
  test('เส้นสุข: ถามชื่อ → ถาม Ollama → ยืนยัน → แพ็กชุดเต็มลงโฟลเดอร์ของเครื่องนั้น', async () => {
    const calls = [];
    const logs = [];
    const opened = [];
    const ask = scripted(['เครื่องที่-4', 'n', 'y']);
    const res = await wizard({
      ask,
      pack: okPack(calls),
      openFolder: (dir) => opened.push(dir),
      log: (m) => logs.push(m),
    });

    assert.equal(res.exitCode, 0);
    assert.equal(res.machineName, 'เครื่องที่-4');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'เครื่องที่-4');
    assert.equal(calls[0].fullKit, true, 'ค่าเริ่มต้นต้องเป็นชุดเต็ม (เจ้าของสั่ง "ติดตั้งทุกฟังก์ชั่น")');
    assert.equal(calls[0].withOllama, false, 'ไม่ตอบอะไร = ไม่รวม Ollama (~20GB)');
    assert.equal(calls[0].outDir, path.join(OUT_ROOT, 'เครื่องที่-4'));
    assert.equal(calls[0].hubUrl, 'http://192.168.1.101:3000');
    assert.equal(calls[0].force, false, 'ต้องไม่ force เองโดยไม่ถาม');
    assert.deepEqual(opened, [path.join(OUT_ROOT, 'เครื่องที่-4')], 'เสร็จแล้วต้องเปิดโฟลเดอร์ให้');
    assert.equal(ask.left(), 0, 'คำตอบที่เตรียมไว้ต้องถูกใช้ครบ (ไม่มีคำถามเกิน)');
  });

  test('กด Enter ที่ช่องชื่อ = ใช้ชื่อเครื่องนี้ (ไม่ต้องพิมพ์)', async () => {
    const calls = [];
    await wizard({ ask: scripted(['', 'n', '']), pack: okPack(calls), openFolder: () => {}, log: () => {} });
    assert.equal(calls[0].name, 'HUB-PC');
  });

  test('ตอบไม่ (n) ที่ขั้นยืนยัน = ยกเลิก ไม่แตะ DB/ไม่เขียนไฟล์', async () => {
    const calls = [];
    const res = await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'n']),
      pack: okPack(calls),
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(res.code, 'canceled');
    assert.equal(res.exitCode, 0);
    assert.equal(calls.length, 0);
  });

  test('Ctrl+C ระหว่างถามชื่อ = ยกเลิกอย่างสุภาพ (ไม่ throw)', async () => {
    const calls = [];
    const res = await wizard({ ask: scripted([null]), pack: okPack(calls), openFolder: () => {}, log: () => {} });
    assert.equal(res.code, 'canceled');
    assert.equal(calls.length, 0);
  });

  test('ชื่อชนกับเครื่องที่เคยออนไลน์ = ถามชื่อใหม่ต่อทันที (ไม่จบด้วย error)', async () => {
    const calls = [];
    let n = 0;
    const pack = async (opts) => {
      calls.push(opts);
      n += 1;
      if (n === 1) return { exitCode: 1, code: 'name_conflict', report: '  ✘ ชื่อซ้ำ' };
      return { exitCode: 0, code: 'ok', report: 'ok', bundleDir: opts.outDir };
    };
    const res = await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'y', 'เครื่องที่-5', 'y']),
      pack,
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(res.exitCode, 0, 'สุดท้ายต้องสำเร็จ');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'เครื่องที่-4');
    assert.equal(calls[1].name, 'เครื่องที่-5');
    assert.equal(calls[1].outDir, path.join(OUT_ROOT, 'เครื่องที่-5'));
  });

  test('โฟลเดอร์เดิมมีอยู่ = ถามก่อนทับ แล้วส่ง force ไป (ไม่ทับเงียบ ๆ)', async () => {
    const calls = [];
    let n = 0;
    const pack = async (opts) => {
      calls.push(opts);
      n += 1;
      if (n === 1) return { exitCode: 1, code: 'out_exists', report: '  ✘ มีอยู่แล้ว' };
      return { exitCode: 0, code: 'ok', report: 'ok', bundleDir: opts.outDir };
    };
    const res = await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'y', 'y']),
      pack,
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(calls[1].force, true);
  });

  test('โฟลเดอร์เดิมมีอยู่ + ตอบไม่ทับ = จบด้วยรหัส 1 พร้อมบอกทางออก', async () => {
    const calls = [];
    const res = await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'y', 'n']),
      pack: async (opts) => {
        calls.push(opts);
        return { exitCode: 1, code: 'out_exists', report: '  ✘ มีอยู่แล้ว' };
      },
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(res.exitCode, 1);
    assert.equal(res.code, 'out_exists');
    assert.equal(calls.length, 1);
  });

  test('โหมดอัตโนมัติ (--yes + --name) = ไม่ถามอะไรเลย และไม่เปิด Explorer', async () => {
    const calls = [];
    const res = await wizard({
      ask: async () => {
        throw new Error('โหมด --yes ต้องไม่ถาม');
      },
      presetName: 'เครื่องที่-9',
      assumeYes: true,
      outRoot: OUT_ROOT,
      pack: okPack(calls),
      openFolder: () => {
        throw new Error('โหมดอัตโนมัติต้องไม่เปิด Explorer');
      },
      log: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'เครื่องที่-9');
  });

  test('dry-run = ส่ง dryRun ต่อ ไม่เปิดโฟลเดอร์', async () => {
    const calls = [];
    const opened = [];
    const res = await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'y']),
      dryRun: true,
      pack: okPack(calls),
      openFolder: (d) => opened.push(d),
      log: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(calls[0].dryRun, true);
    assert.deepEqual(opened, []);
  });

  test('ไม่พิมพ์ token/ความลับออกหน้าจอ', async () => {
    const logs = [];
    const calls = [];
    await wizard({
      ask: scripted(['เครื่องที่-4', 'n', 'y']),
      pack: okPack(calls),
      openFolder: () => {},
      log: (m) => logs.push(m),
    });
    const all = logs.join('\n');
    // ตรวจรูปแบบความลับจริง (ไม่ใช่คำว่า "token" ทั่วไป — ข้อความอธิบายต้องพูดถึง token ได้)
    assert.doesNotMatch(all, /tok-[A-Za-z0-9]|MACHINE_TOKEN\s*=/i, `ห้ามพิมพ์ token: ${all}`);
  });

  test('ไม่พบ IP ในวง LAN = เตือนว่าเครื่องปลายทางจะต่อ HUB ไม่ได้', async () => {
    const logs = [];
    await wizard({
      hostname: 'HUB-PC',
      hubUrl: 'http://127.0.0.1:3000',
      ask: scripted(['เครื่องที่-4', 'n', 'y']),
      pack: okPack([]),
      openFolder: () => {},
      log: (m) => logs.push(m),
    });
    assert.match(logs.join('\n'), /LAN|--hub-url/, 'ต้องบอกทางแก้ ไม่ปล่อยให้แพ็กแล้วพบปัญหาที่เครื่องลูก');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PACK-MACHINE.cmd: ไฟล์ที่ดับเบิลคลิกได้จริง', () => {
  const cmdPath = path.join(ROOT, 'PACK-MACHINE.cmd');
  const text = fs.existsSync(cmdPath) ? fs.readFileSync(cmdPath, 'utf8') : '';

  test('อยู่ที่รากโปรเจ็ก (ผู้ใช้หาเจอ ไม่ต้องไล่โฟลเดอร์)', () => {
    assert.ok(text.length > 0, 'ต้องมี PACK-MACHINE.cmd ที่รากโปรเจ็ก');
  });

  test('ASCII ล้วน + CRLF ทั้งไฟล์ (กติกา .cmd ที่เคยพังจริง)', () => {
    const raw = fs.readFileSync(cmdPath);
    const loneLf = raw.toString('utf8').split('\n').filter((line, i, all) => !(i === all.length - 1) && !line.endsWith('\r'));
    assert.deepEqual(loneLf, [], 'ทุกบรรทัดต้องจบด้วย CRLF');
    assert.equal(/[^\x00-\x7F]/.test(text), false, 'ข้อความในไฟล์ .cmd ต้องเป็น ASCII ล้วน (ข้อความไทยให้ .mjs พิมพ์)');
  });

  test('ตั้ง chcp 65001 ก่อนบรรทัดอื่น เพื่อให้ข้อความไทยจาก .mjs แสดงถูก', () => {
    assert.match(text.split(/\r?\n/)[0], /chcp\s+65001/i);
  });

  test('เรียก pack-machine.mjs จากโฟลเดอร์ของตัวเอง (ไม่ขึ้นกับ cwd ของผู้ใช้)', () => {
    assert.match(text, /cd\s+\/d\s+"%~dp0"/i);
    assert.ok(text.includes('tools\\agent-pack\\pack-machine.mjs'), 'ต้องเรียกตัว .mjs ที่ถือตรรกะจริง');
  });

  test('มี pause ทุกเส้นทาง + exit /b เดียว (หน้าต่างไม่ปิดหนี)', () => {
    assert.equal((text.match(/exit\s+\/b/gi) ?? []).length, 1, 'ต้องมีทางออกเดียว');
    const pauseAt = text.toLowerCase().lastIndexOf('pause');
    const exitAt = text.toLowerCase().lastIndexOf('exit /b');
    assert.ok(pauseAt > 0 && exitAt > pauseAt, 'pause ต้องอยู่ก่อน exit');
    assert.match(text, /^:end\b/im, 'ทุกเส้นทางต้อง goto มาที่ :end');
  });

  test('ทุก goto มี label รองรับ (ไม่มี "goto หาที่ลงไม่ได้")', () => {
    const targets = [...text.matchAll(/goto\s+:?(\w+)/gi)].map((m) => m[1].toLowerCase());
    const labels = [...text.matchAll(/^:(\w+)/gim)].map((m) => m[1].toLowerCase());
    assert.ok(targets.length >= 2, 'ต้องมี goto อย่างน้อย 2 จุด (ไม่มี node / จบงาน)');
    for (const t of targets) assert.ok(labels.includes(t), `goto ${t} ไม่มี label รองรับ`);
  });

  // กับดักจริง: โฟลเดอร์ tools/agent-pack ถูก gitignore แบบ allow-list
  // ⇒ ไฟล์ใหม่ที่ลืมเติม !... จะไม่ถูก commit แล้ว .cmd บนเครื่องอื่นเรียกไฟล์ที่ไม่มี = พังเงียบ
  test('ไฟล์ที่ .cmd เรียกต้องไม่ถูก gitignore (allow-list ต้องมี pack-machine.mjs)', () => {
    const lines = fs
      .readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim());
    assert.ok(lines.includes('tools/agent-pack/*'), 'กฎ allow-list ของ tools/agent-pack หายไป — ตรวจ .gitignore');
    assert.ok(
      lines.includes('!tools/agent-pack/pack-machine.mjs'),
      'ต้องมี !tools/agent-pack/pack-machine.mjs ใน .gitignore ไม่งั้นไฟล์นี้ไม่ถูก commit',
    );
  });

  test('รันจริงผ่าน cmd แบบไม่ถาม (--name/--yes/--dry-run): exit 0 + พิมพ์แผน', { skip: process.platform !== 'win32' }, () => {
    // ไม่ส่งพาธที่มีช่องว่างผ่าน cmd ในเคสนี้ — cmd.exe ตัด arg ที่มีช่องว่างถ้าไม่ครอบ quote เอง
    const res = spawnSync('cmd', ['/c', cmdPath, '--name=Test-PC', '--yes', '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
      input: '',
    });
    assert.equal(res.status, 0, `ต้องออก 0 (ได้ ${res.status}) · stdout: ${res.stdout} · stderr: ${res.stderr}`);
    assert.match(res.stdout, /dry-run/);
    assert.match(res.stdout, /Test-PC/);
  });

  test('ชื่อไทย + พาธที่มีช่องว่าง: dry-run ต้องไม่สร้างโฟลเดอร์', { skip: process.platform !== 'win32' }, () => {
    const outDir = path.join(TMP_ROOT, `pack-machine-dry-${process.pid}`);
    const res = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'tools', 'agent-pack', 'pack-machine.mjs'),
        '--name=เครื่องทดสอบ-1',
        '--yes',
        '--dry-run',
        `--out=${outDir}`,
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(res.status, 0, `ต้องออก 0 (ได้ ${res.status}) · stdout: ${res.stdout} · stderr: ${res.stderr}`);
    assert.match(res.stdout, /เครื่องทดสอบ-1/);
    assert.equal(fs.existsSync(outDir), false, 'dry-run ต้องไม่สร้างโฟลเดอร์');
  });
});
