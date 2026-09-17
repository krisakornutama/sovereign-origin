import './setup-env';
/* Route-level tests ของ harden-upload — boot express app จริง + ยิง HTTP จริง (ย้ายจาก tools/test/*.mjs
   เมื่อ 2026-09-17: import .ts ตรง ๆ ผ่าน tsx แทน harness copy-rewrite ใน Temp)
   ครอบ:
     A. POST /api/knowledge/upload — allowed ลงดิสก์จริง 1 ไฟล์ชื่อสุ่ม · non-allowed ไม่มีทางลงดิสก์
        (นับไฟล์ทั้ง knowledge/ ก่อน-หลัง) · ไฟล์ไม่ผ่าน whitelist ต้อง 400 ไม่ใช่ 500 (บั๊กเดิม)
     B. wiring — ทุกโมดูล multer ต้องผ่าน hardenUpload · ห้ามมี multer({dest|storage}) ตรง ๆ
     C. เมทริกซ์แพลตฟอร์ม — safeDisplayName/resolveInsideRoot ให้สัญญาเดียวกันทั้ง POSIX/Windows
   Real-Postgres lifecycle อยู่อีกไฟล์ (knowledge-db.test.ts — gated RUN_DB_TESTS) */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import type { Express } from 'express';
import type { Server } from 'node:http';

import knowledgeRoutes from '../src/modules/knowledge/knowledge.routes';
import { prisma } from '../src/lib/prisma';
import { mockModel, makeToken, createTestServer, type TestServer } from './helpers';
import { hardenUpload, safeDisplayName, resolveInsideRoot } from '../src/lib/harden-upload';

const CORE_ROOT = path.resolve(__dirname, '..');
const KNOWLEDGE_ROOT = path.join(CORE_ROOT, 'knowledge');

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** multipart body แบบเดียวกับที่ browser ส่ง (filename ฝัง traversal ได้) */
function multipartBody(field: string, filename: string, bytes: Buffer, contentType = 'application/octet-stream') {
  const boundary = '----harness' + Date.now() + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function postUpload(ts: TestServer, token: string, filename: string, bytes: Buffer, contentType?: string) {
  const { body, contentType: ct } = multipartBody('file', filename, bytes, contentType);
  const res = await fetch(`${ts.baseUrl}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': ct },
    body: body,
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** mock ชั้น DB/AV เท่าที่ upload handler แตะ — พฤติกรรมดิสก์/route ยังเป็นของจริงทั้งหมด */
function mockUploadDeps() {
  const created: any[] = [];
  mockModel(prisma, 'knowledgeItem', {
    create: async ({ data }: any) => {
      const row = { id: `kb-${created.length + 1}`, ...data, created_at: new Date(), updated_at: new Date() };
      created.push(row);
      return row;
    },
  });
  mockModel(prisma, 'threatIntelItem', { findFirst: async () => null });
  return created;
}

describe('knowledge upload route (HTTP จริงผ่าน express จริง)', () => {
  const token = makeToken();

  test('allowed ลงดิสก์จริง 1 ไฟล์ชื่อสุ่ม — metadata ใช้ display name ไม่เหลือ path', async () => {
    const created = mockUploadDeps();
    const before = walk(KNOWLEDGE_ROOT);
    const ts = await createTestServer((app: Express) => app.use('/', knowledgeRoutes));
    try {
      const res = await postUpload(ts, token, 'a/b/c/../../business-notes.txt', Buffer.from('ข้อความทดสอบ'), 'text/plain');
      assert.equal(res.status, 201, `body=${JSON.stringify(res.json).slice(0, 200)}`);
      assert.equal(res.json.success, true);
      assert.match(res.json.item.file_path, /^uploads[\\/]\d+-[0-9a-f-]{36}\.txt$/);
      assert.equal(res.json.item.title, 'business notes', 'title ต้องมาจาก safeDisplayName (dash ถูกแปลงเป็นช่องว่างตาม handler)');

      const added = walk(KNOWLEDGE_ROOT).filter((f) => !before.includes(f));
      assert.equal(added.length, 1, `ต้องเขียนลงดิสก์จริง 1 ไฟล์ (ได้ ${added.join(', ')})`);
      assert.match(path.basename(added[0]), /^\d+-[0-9a-f-]{36}\.txt$/, 'ชื่อบนดิสก์สุ่มล้วน');
      assert.doesNotMatch(path.basename(added[0]), /business|notes/, 'ห้ามเหลือชื่อเดิมบนดิสก์');
      assert.ok(fs.readFileSync(added[0]).includes('ข้อความทดสอบ'), 'เนื้อหาตรง');
      fs.rmSync(added[0], { force: true }); // เก็บกวาดไฟล์ทดสอบ
    } finally {
      await ts.close();
    }
  });

  test('non-allowed (.exe) → 400 และไม่มีทางลงดิสก์ (ไฟล์ตกขอบ = 0 ไฟล์ใหม่)', async () => {
    const created = mockUploadDeps();
    assert.equal(created.length, 0);
    const before = walk(KNOWLEDGE_ROOT);
    const ts = await createTestServer((app: Express) => app.use('/', knowledgeRoutes));
    try {
      const res = await postUpload(ts, token, 'x.exe', Buffer.from('MZ stub'));
      assert.equal(res.status, 400, `body=${JSON.stringify(res.json).slice(0, 200)}`);
      assert.match(res.json.error, /นามสกุล/, 'error ต้องมาจาก whitelist ของ hardenUpload');
      assert.equal(created.length, 0, 'ต้องไม่มี row ถูกสร้าง');
      assert.deepEqual(walk(KNOWLEDGE_ROOT), before, 'ไฟล์ตกขอบไม่มีทางลงดิสก์');
    } finally {
      await ts.close();
    }
  });

  test('request ไม่มีไฟล์ → 400 (ผ่าน handledUpload — ห้ามหลุดเป็น 500 ของ Express default handler)', async () => {
    mockUploadDeps();
    const ts = await createTestServer((app: Express) => app.use('/', knowledgeRoutes));
    try {
      const none = await fetch(`${ts.baseUrl}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      assert.equal(none.status, 400);
      assert.match(((await none.json()) as any).error, /file is required/);
    } finally {
      await ts.close();
    }
  });
});

/* ── B. wiring — ทุกจุดรับไฟล์ต้องผ่าน hardenUpload ── */
describe('wiring: ทุกโมดูล multer ผ่าน hardenUpload', () => {
  test('ไม่มี multer({dest|storage}) ตรง ๆ หลงเหลือ + ครบอย่างน้อย 7 โมดูล', () => {
    const modulesDir = path.join(CORE_ROOT, 'src', 'modules');
    const files = fs.readdirSync(modulesDir, { recursive: true }).filter((f) => String(f).endsWith('.routes.ts'));
    let hardenFiles = 0;
    for (const rel of files) {
      const text = fs.readFileSync(path.join(modulesDir, String(rel)), 'utf8');
      const usesMulter = /multer\s*\(/.test(text) || /from 'multer'/.test(text);
      const usesHarden = /hardenUpload\s*\(/.test(text);
      assert.ok(!usesMulter || usesHarden, `${rel}: มี multer แต่ไม่ผ่าน hardenUpload`);
      if (usesHarden) hardenFiles++;
    }
    assert.ok(hardenFiles >= 7, `ต้องมีอย่างน้อย 7 โมดูลผ่าน hardenUpload (เจอ ${hardenFiles})`);
  });

  test('hardenUpload: memory mode กัน misconfig + ต้องมี memoryStorage และ randomDiskName ใน lib', () => {
    const lib = fs.readFileSync(path.join(CORE_ROOT, 'src', 'lib', 'harden-upload.ts'), 'utf8');
    assert.match(lib, /memoryStorage/, 'ต้องมี memory mode สำหรับโมดูลที่ไม่ต้องเก็บไฟล์');
    assert.match(lib, /randomDiskName\(file\.originalname/, 'ชื่อดิสก์ต้องผ่าน randomDiskName เสมอ');
    assert.throws(() => hardenUpload({ mode: 'memory', allowedExtensions: ['.png'], destination: os.tmpdir() }), /memory/);
    assert.throws(() => hardenUpload({ allowedExtensions: [] }), /allowedExtensions/);
  });
});

/* ── C. เมทริกซ์แพลตฟอร์ม — สัญญาเดียวกันทั้ง POSIX/Windows (วิ่งทั้งสอง OS ใน CI) ── */
describe('platform matrix: พฤติกรรม path เหมือนกันทุก OS', () => {
  test('safeDisplayName ตัด separator ทั้ง POSIX/Windows บนทุก OS', () => {
    assert.equal(safeDisplayName('..\\..\\secret.docx'), 'secret.docx', 'backslash ต้องตัดบนทุก OS (บั๊ก POSIX เดิม)');
    assert.equal(safeDisplayName('../../etc/passwd'), 'passwd');
    assert.equal(safeDisplayName('C:\\Users\\com\\a.jpg'), 'a.jpg');
    assert.equal(safeDisplayName('/var/log/app.log'), 'app.log');
    assert.equal(safeDisplayName('a/b\\c/d.txt'), 'd.txt', 'ผสมทั้งสองแบบก็ตัดหมด');
  });

  test('resolveInsideRoot แบน backslash ทุกแพลตฟอร์ม + ปฏิเสธ traversal ของฝั่งตรงข้าม', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-matrix-'));
    fs.writeFileSync(path.join(root, 'ok.txt'), 'x');
    try {
      /* backslash = reject เสมอ (บน POSIX เป็นตัวอักษรปกติ — ปล่อยผ่าน = caller บน Linux พา C:\ เข้ามาได้) */
      assert.throws(() => resolveInsideRoot(root, '..\\..\\win.ini'), RangeError, `${process.platform}: backslash ต้อง reject`);
      assert.throws(() => resolveInsideRoot(root, 'C:\\Windows\\evil.txt'), RangeError, `${process.platform}: absolute Windows ต้อง reject`);
      assert.throws(() => resolveInsideRoot(root, '../outside.txt'), RangeError, `${process.platform}: POSIX traversal ต้อง reject เสมอ`);
      assert.equal(resolveInsideRoot(root, 'ok.txt'), path.resolve(root, 'ok.txt'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
