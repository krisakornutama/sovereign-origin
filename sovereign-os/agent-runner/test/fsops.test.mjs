import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_FILE_BYTES,
  isAllowedPath,
  listDir,
  looksBinary,
  makeDir,
  readFile,
  removePath,
  renamePath,
  resolveAllowedRoots,
  runFsCommand,
  writeFile,
} from '../src/fsops.mjs';

// ── ไฟล์บนเครื่องที่ 2 ────────────────────────────────────────────────────────
//
// ขอบเขตที่เจ้าของเลือก: อ่าน-เขียนได้ทั้งไดรฟ์ (คุมสิทธิ์ที่ HUB เป็น SUPERADMIN)
// ⇒ เทสต์ชุดนี้จึงเน้นด่านที่กัน "อุบัติเหตุ" ซึ่งเหลืออยู่ฝั่งเครื่อง:
//   · เพดานขนาด (ไฟล์ยักษ์ต้องไม่ทำหน่วยความจำระเบิด)
//   · ลบโฟลเดอร์ต้องสั่ง recursive ชัด ๆ
//   · ห้ามลบรากของไดรฟ์
//   · ข้อผิดพลาดต้องเป็นข้อความที่ผู้ใช้อ่านรู้เรื่อง ไม่ใช่ stack trace
//
// เทสต์ใช้โฟลเดอร์ชั่วคราวข้างไฟล์เทสต์เอง (ไม่แตะไฟล์จริงของโปรเจกต์/ผู้ใช้)
const here = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.join(here, '.tmp-fsops');

before(async () => {
  await fsp.rm(SANDBOX, { recursive: true, force: true });
  await fsp.mkdir(SANDBOX, { recursive: true });
});

after(async () => {
  await fsp.rm(SANDBOX, { recursive: true, force: true });
});

describe('fsops — อ่าน/เขียน', () => {
  test('เขียนแล้วอ่านกลับได้เหมือนเดิม (ข้อความไทย)', async () => {
    const file = path.join(SANDBOX, 'hello.txt');
    const written = await writeFile(file, { text: 'สวัสดี ชาวโลก\n' });
    assert.equal(written.ok, true);
    assert.equal(written.bytes, Buffer.byteLength('สวัสดี ชาวโลก\n'));

    const read = await readFile(file);
    assert.equal(read.ok, true);
    assert.equal(read.text, 'สวัสดี ชาวโลก\n');
    assert.equal(read.binary, false);
    assert.equal(read.size, written.bytes);
  });

  test('เขียนไฟล์ที่โฟลเดอร์พ่อยังไม่มี → สร้างให้เอง', async () => {
    const file = path.join(SANDBOX, 'deep', 'nested', 'a.txt');
    const written = await writeFile(file, { text: 'ok' });
    assert.equal(written.ok, true);
    assert.equal((await readFile(file)).text, 'ok');
  });

  test('เขียนด้วย base64 แล้วอ่านเป็นไบนารีได้', async () => {
    const file = path.join(SANDBOX, 'bin.dat');
    const raw = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
    await writeFile(file, { base64: raw.toString('base64') });

    const read = await readFile(file);
    assert.equal(read.ok, true);
    assert.equal(read.binary, true, 'มี NUL ⇒ ต้องรายงานเป็นไบนารี');
    assert.deepEqual(Buffer.from(read.base64, 'base64'), raw);
  });

  test('บังคับอ่านเป็นข้อความได้แม้ไฟล์จะเป็นไบนารี', async () => {
    const file = path.join(SANDBOX, 'bin2.dat');
    await writeFile(file, { base64: Buffer.from([0x41, 0x00, 0x42]).toString('base64') });
    const read = await readFile(file, { encoding: 'text' });
    assert.equal(read.binary, false);
    assert.equal(typeof read.text, 'string');
  });

  test('ไม่ส่ง text หรือ base64 มา → ปฏิเสธ', async () => {
    const out = await writeFile(path.join(SANDBOX, 'x.txt'), {});
    assert.equal(out.ok, false);
    assert.match(out.error, /text|base64/);
  });

  test('ไฟล์ใหญ่เกินเพดาน → ปฏิเสธพร้อมบอกขนาด (ไม่ทำหน่วยความจำระเบิด)', async () => {
    const file = path.join(SANDBOX, 'big.bin');
    await fsp.writeFile(file, Buffer.alloc(1024));
    const out = await readFile(file, { maxBytes: 512 });
    assert.equal(out.ok, false);
    assert.match(out.error, /ใหญ่/);
    assert.match(out.error, /1024/);

    const wrote = await writeFile(path.join(SANDBOX, 'big2.bin'), { text: 'x'.repeat(MAX_FILE_BYTES + 1) });
    assert.equal(wrote.ok, false);
  });

  test('อ่านไฟล์ที่ไม่มี → ข้อความบอกว่าไม่พบ ไม่ใช่ stack trace', async () => {
    const out = await readFile(path.join(SANDBOX, 'nope.txt'));
    assert.equal(out.ok, false);
    assert.match(out.error, /ไม่พบ/);
    assert.equal(out.error.includes('ENOENT'), false, 'ห้ามหลุดรหัส error ดิบมาให้ผู้ใช้');
  });

  test('อ่านโฟลเดอร์เป็นไฟล์ → ปฏิเสธ', async () => {
    const out = await readFile(SANDBOX);
    assert.equal(out.ok, false);
    assert.match(out.error, /โฟลเดอร์/);
  });

  test('ไม่ระบุ path → ปฏิเสธทุกคำสั่ง', async () => {
    for (const fn of [() => readFile(''), () => writeFile(null, { text: 'x' }), () => makeDir(undefined), () => removePath('')]) {
      const out = await fn();
      assert.equal(out.ok, false);
    }
  });
});

describe('fsops — รายการในโฟลเดอร์', () => {
  test('เรียงโฟลเดอร์ก่อน แล้วตามด้วยชื่อ และบอก parent', async () => {
    const dir = path.join(SANDBOX, 'list');
    await fsp.mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'b.txt'), { text: 'b' });
    await writeFile(path.join(dir, 'a.txt'), { text: 'a' });
    await fsp.mkdir(path.join(dir, 'zsub'), { recursive: true });

    const out = await listDir(dir);
    assert.equal(out.ok, true);
    assert.equal(out.parent, SANDBOX);
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ['zsub', 'a.txt', 'b.txt'],
    );
    assert.equal(out.entries[0].isDir, true);
    assert.equal(out.entries[2].size, 1);
    assert.ok(out.entries[2].mtime, 'ต้องมีเวลาที่แก้ไขล่าสุด');
  });

  test('โฟลเดอร์ที่ไม่มี → ข้อความบอกว่าไม่พบ', async () => {
    const out = await listDir(path.join(SANDBOX, 'ghost'));
    assert.equal(out.ok, false);
    assert.match(out.error, /ไม่พบ/);
  });

  test('รากของไดรฟ์ → parent เป็น null (ไม่ให้หน้าเว็บไล่ขึ้นไปไม่จบ)', async () => {
    const root = path.parse(SANDBOX).root;
    const out = await listDir(root);
    assert.equal(out.ok, true);
    assert.equal(out.parent, null);
  });
});

describe('fsops — สร้าง/ลบ/ย้าย', () => {
  test('สร้างโฟลเดอร์ซ้อนหลายชั้นได้', async () => {
    const dir = path.join(SANDBOX, 'mk', 'a', 'b');
    assert.equal((await makeDir(dir)).ok, true);
    const st = await fsp.stat(dir);
    assert.equal(st.isDirectory(), true);
  });

  test('ลบไฟล์', async () => {
    const file = path.join(SANDBOX, 'del.txt');
    await writeFile(file, { text: 'bye' });
    const out = await removePath(file);
    assert.equal(out.ok, true);
    assert.equal(out.removed, 'file');
    assert.equal((await readFile(file)).ok, false);
  });

  test('ลบโฟลเดอร์ที่ไม่ว่างโดยไม่ส่ง recursive → ปฏิเสธ (กันพิมพ์ผิดแล้วลบทั้งต้นไม้)', async () => {
    const dir = path.join(SANDBOX, 'keepme');
    await writeFile(path.join(dir, 'inner.txt'), { text: 'x' });
    const out = await removePath(dir);
    assert.equal(out.ok, false);
    assert.match(out.error, /ไม่ว่าง|recursive/);
    assert.equal((await fsp.stat(dir)).isDirectory(), true, 'ต้องไม่ถูกลบไปเลย');
  });

  test('ลบโฟลเดอร์ที่ไม่ว่างด้วย recursive: true → ลบทั้งต้น', async () => {
    const dir = path.join(SANDBOX, 'killme');
    await writeFile(path.join(dir, 'deep', 'inner.txt'), { text: 'x' });
    const out = await removePath(dir, { recursive: true });
    assert.equal(out.ok, true);
    await assert.rejects(() => fsp.stat(dir));
  });

  test('ลบโฟลเดอร์ว่างได้โดยไม่ต้อง recursive', async () => {
    const dir = path.join(SANDBOX, 'emptydir');
    await makeDir(dir);
    const out = await removePath(dir);
    assert.equal(out.ok, true);
  });

  test('ห้ามลบรากของไดรฟ์', async () => {
    const root = path.parse(SANDBOX).root;
    const out = await removePath(root, { recursive: true });
    assert.equal(out.ok, false);
    assert.match(out.error, /ราก/);
  });

  test('ย้าย/เปลี่ยนชื่อ', async () => {
    const from = path.join(SANDBOX, 'ren-a.txt');
    const to = path.join(SANDBOX, 'ren-b.txt');
    await writeFile(from, { text: 'move me' });
    const out = await renamePath(from, to);
    assert.equal(out.ok, true);
    assert.equal((await readFile(to)).text, 'move me');
    assert.equal((await readFile(from)).ok, false);
  });

  test('ย้ายไปทับไฟล์ที่มีอยู่แล้วไม่ได้', async () => {
    const a = path.join(SANDBOX, 't1.txt');
    const b = path.join(SANDBOX, 't2.txt');
    await writeFile(a, { text: 'a' });
    await writeFile(b, { text: 'b' });
    const out = await renamePath(a, b);
    assert.equal(out.ok, false);
    assert.equal((await readFile(b)).text, 'b', 'ไฟล์ปลายทางต้องไม่ถูกทับ');
  });

  test('ย้ายไฟล์ที่ไม่มี → ข้อความบอกว่าไม่พบ', async () => {
    const out = await renamePath(path.join(SANDBOX, 'ghost.txt'), path.join(SANDBOX, 'x.txt'));
    assert.equal(out.ok, false);
    assert.match(out.error, /ไม่พบ/);
  });

  test('ไม่ระบุ from/to → ปฏิเสธ', async () => {
    assert.equal((await renamePath('', 'x')).ok, false);
    assert.equal((await renamePath('x', '')).ok, false);
  });
});

describe('fsops — เบรกมือ REMOTE_FS_ROOTS', () => {
  test('ไม่มีค่าใน env → อนุญาตทั้งหมด (ตามที่เจ้าของเลือกไว้)', () => {
    assert.deepEqual(resolveAllowedRoots({}), []);
    assert.deepEqual(resolveAllowedRoots({ REMOTE_FS_ROOTS: '   ' }), []);
    assert.equal(isAllowedPath('E:\\anything\\here', []), true);
  });

  test('คั่นหลายโฟลเดอร์ด้วย ; และตัดช่องว่างหัวท้าย', () => {
    const roots = resolveAllowedRoots({ REMOTE_FS_ROOTS: ` ${SANDBOX} ; C:\\Temp ` });
    assert.equal(roots.length, 2);
    assert.equal(roots[0], path.resolve(SANDBOX));
  });

  test('อนุญาตในขอบเขต และปฏิเสธนอกขอบเขต (รวมถึงโฟลเดอร์ที่ชื่อขึ้นต้นเหมือนกัน)', () => {
    const roots = [path.join(SANDBOX, 'allowed')];
    assert.equal(isAllowedPath(path.join(SANDBOX, 'allowed', 'a.txt'), roots), true);
    assert.equal(isAllowedPath(path.join(SANDBOX, 'allowed'), roots), true);
    // 'allowed-อื่น' ต้องไม่ผ่าน แม้จะขึ้นต้นด้วยคำเดียวกัน
    assert.equal(isAllowedPath(path.join(SANDBOX, 'allowed-elsewhere', 'x'), roots), false);
    assert.equal(isAllowedPath(path.join(SANDBOX, 'other'), roots), false);
  });

  test('คำสั่งไฟล์ที่อยู่นอกขอบเขตถูกปฏิเสธก่อนแตะดิสก์', async () => {
    const roots = [path.join(SANDBOX, 'allowed')];
    await makeDir(path.join(SANDBOX, 'allowed'));
    const inside = await writeFile(path.join(SANDBOX, 'allowed', 'ok.txt'), { text: 'hi', roots });
    assert.equal(inside.ok, true);

    const outside = await writeFile(path.join(SANDBOX, 'outside.txt'), { text: 'no', roots });
    assert.equal(outside.ok, false);
    assert.match(outside.error, /ขอบเขต/);
    await assert.rejects(() => fsp.stat(path.join(SANDBOX, 'outside.txt')), 'ต้องไม่ถูกสร้างเลย');
  });
});

describe('fsops — ตัวจัดการคำสั่งจาก HUB', () => {
  test('ส่งคำสั่งถูกชนิด → ทำงานจริง', async () => {
    const file = path.join(SANDBOX, 'cmd.txt');
    assert.equal((await runFsCommand({ type: 'fs.write', payload: { path: file, text: 'via-cmd' } })).ok, true);
    const read = await runFsCommand({ type: 'fs.read', payload: { path: file } });
    assert.equal(read.text, 'via-cmd');
    const list = await runFsCommand({ type: 'fs.list', payload: { path: SANDBOX } });
    assert.ok(list.entries.some((e) => e.name === 'cmd.txt'));
  });

  test('คำสั่งที่ไม่อยู่ในรายการ → ปฏิเสธ (ไม่มีทางรันอย่างอื่นผ่านช่องนี้)', async () => {
    const out = await runFsCommand({ type: 'fs.exec', payload: { path: 'x' } });
    assert.equal(out.ok, false);
    assert.match(out.error, /ไม่รู้จัก/);
  });

  test('คำสั่งเปล่า/ไม่มี type → ปฏิเสธ ไม่ throw', async () => {
    assert.equal((await runFsCommand({})).ok, false);
    assert.equal((await runFsCommand(null)).ok, false);
  });

  test('recursive ต้องเป็น true เท่านั้นจึงจะลบต้นไม้ได้ (ค่าอื่นถือว่าไม่ใช่)', async () => {
    const dir = path.join(SANDBOX, 'treepass');
    await writeFile(path.join(dir, 'inner.txt'), { text: 'x' });
    const withString = await runFsCommand({ type: 'fs.delete', payload: { path: dir, recursive: 'true' } });
    assert.equal(withString.ok, false, 'สตริง "true" ต้องไม่ถูกตีความว่าใช่');
    const withBool = await runFsCommand({ type: 'fs.delete', payload: { path: dir, recursive: true } });
    assert.equal(withBool.ok, true);
  });
});

describe('fsops — ตัวช่วยตัดสินไบนารี', () => {
  test('NUL ในช่วงต้น = ไบนารี · ข้อความล้วน = ไม่ใช่', () => {
    assert.equal(looksBinary(Buffer.from('hello world')), false);
    assert.equal(looksBinary(Buffer.from([0x68, 0x00, 0x69])), true);
    assert.equal(looksBinary(Buffer.alloc(0)), false);
    // NUL ที่อยู่ไกลเกินช่วงที่ตรวจ (8KB) ถือว่าไม่นับ — กันไฟล์ใหญ่ถูกสแกนทั้งก้อน
    const far = Buffer.concat([Buffer.alloc(9000, 0x41), Buffer.from([0x00])]);
    assert.equal(looksBinary(far), false);
  });
});
