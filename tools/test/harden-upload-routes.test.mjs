#!/usr/bin/env node
/* เทส route-level ของ harden-upload — boot express app จริง (tsx) แล้วยิง HTTP จริง
   พิสูจน์ 3 เรื่องที่ unit test ชั้น util ครอบไม่ได้:
     A. เส้นทางจริง POST /api/knowledge/upload ผ่าน auth (JWT ปลอมแบบเดียวกับเทส backend)
        → ไฟล์ที่อนุญาต "ลงดิสก์จริง" ใน knowledge/uploads · ไฟล์นอก whitelist
          "ถูกปฏิเสธและไม่มีทางลงดิสก์" (นับไฟล์ทุกไฟล์ทั้งพาธ ก่อน-หลัง ต้องเท่ากัน)
     B. wiring ทุกโมดูล multer (knowledge/whisper/documents/vision/dime/treasury/security)
        ต้องผ่าน hardenUpload — ไม่มี multer({dest|storage}) ตรง ๆ หลงเหลือ
     C. เมทริกซ์แพลตฟอร์ม: สัญญาเดียวกันทั้ง POSIX/Windows —
        safeDisplayName ตัด separator ทั้งสองแบบบนทุก OS · resolveInsideRoot
        ปฏิเสธ traversal แบบ slash ของฝั่งตรงข้ามเสมอ (Windows ปฏิเสธ ../.. , Linux ปฏิเสธ ..\\..\\)
   ใช้: npm run test:tools  (node --test tools/test/*.test.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = path.join(ROOT, 'sovereign-os', 'core-api');
const UPLOAD_DIR = path.join(CORE, 'knowledge', 'uploads');
const ROUTES = path.join(CORE, 'src', 'modules', 'knowledge', 'knowledge.routes.ts');

/* ── A. route-level: boot express จริงผ่าน tsx + ยิง multipart จริง ── */
const HARNESS = path.join(os.tmpdir(), `harden-routes-${process.pid}`);
fs.mkdirSync(HARNESS, { recursive: true });
fs.writeFileSync(path.join(HARNESS, 'server.mjs'), `
/* harness: express app จริง + knowledge route จริง — mock เฉพาะชั้น DB/AV เท่าที่ handler แตะ */
process.env.JWT_SECRET = 'harness-secret-0123456789abcdef';
process.env.DATABASE_URL = 'postgresql://harness:harness@127.0.0.1:5432/harness';
process.env.HASH_QUARANTINE_DIR = ${JSON.stringify(HARNESS)};
import { pathToFileURL } from 'node:url';
const pkg = (name) => pathToFileURL(${JSON.stringify(path.join(CORE, 'node_modules'))} + '/' + name).href;
const { prisma } = await import(pathToFileURL(${JSON.stringify(path.join(CORE, 'src', 'lib', 'prisma.ts'))}).href);
prisma.knowledgeItem = {
  create: async ({ data }) => ({ id: 'kb-test-1', ...data, created_at: new Date(), updated_at: new Date() }),
};
prisma.threatIntelItem = { findFirst: async () => null }; // Lite AV: hash ไม่ติด threat intel
const require2 = (await import('node:module')).createRequire;
const express = require2(${JSON.stringify(path.join(CORE, 'src', 'lib', 'harden-upload.ts'))})('express');
const { default: knowledgeRoutes } = await import('./routes.ts');
const app = express();
app.use(express.json());
app.use('/api/knowledge', knowledgeRoutes); /* ชื่อเดียวกับที่ main app mount */
/* เซ็น JWT จริง (mfa_verified = true — ผ่าน authenticate แบบเดียวกับโปรดักชัน) */
const jwt = require2(${JSON.stringify(path.join(CORE, 'src', 'lib', 'harden-upload.ts'))})('jsonwebtoken');
const token = jwt.sign({ userId: 'harness-user', role: 'SUPERADMIN', assigned_node_id: null, mfa_verified: true }, process.env.JWT_SECRET);
console.log('TOKEN ' + token);
const server = app.listen(0, '127.0.0.1', () => console.log('READY ' + server.address().port));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`);

/* copy ของ routes ที่ rewrite ทุก import ให้ resolve ได้จาก Temp:
   - relative (./ ../) → file:// URL ของไฟล์ .ts จริงใน src (tsx strip types ให้)
   - bare (express/axios) → file:// URL เข้า node_modules ของ core-api โดยตรง
   (ไฟล์จริงที่โดน import ต่อ เช่น harden-upload.ts ยัง resolve node_modules จากตำแหน่งเดิมของมันเอง) */
const nm = (name) => pathToFileURL(path.join(CORE, 'node_modules', name)).href;
const src = fs.readFileSync(ROUTES, 'utf8').replace(/from '([^']+)'/g, (m, spec) => {
  if (spec.startsWith('.')) return `from '${pathToFileURL(path.resolve(path.dirname(ROUTES), spec) + '.ts').href}'`;
  if (spec === 'express') return `from '${nm('express/index.js')}'`;
  if (spec === 'axios') return `from '${nm('axios/index.js')}'`;
  return m; // node builtins (fs/path) ปล่อยเดิม
});
fs.writeFileSync(path.join(HARNESS, 'routes.ts'), src);

function driveUpload(port, token, filename, bytes, contentType) {
  const boundary = '----harness' + Date.now() + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`http://127.0.0.1:${port}/api/knowledge/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
}

test('A: route-level — knowledge upload ผ่าน HTTP จริง: allowed ลงดิสก์, non-allowed ไม่มีทางลงดิสก์', async (t) => {
  const proc = spawn(process.execPath, ['--import', 'tsx', path.join(HARNESS, 'server.mjs')], {
    cwd: CORE, /* cwd = core-api เพื่อให้ `--import tsx` resolve จาก node_modules ของมัน */
  });
  let bootLog = '';
  proc.stdout.on('data', (d) => (bootLog += d));
  let errLog = '';
  proc.stderr.on('data', (d) => (errLog += d));
  t.after(() => { try { proc.kill('SIGKILL'); } catch { /* จบไปแล้ว */ } });

  /* รอบรรทัด READY <port> + TOKEN <jwt> — ถ้า process ตายก่อนขึ้น เด้งทันทีพร้อม log */
  const { port, token } = await new Promise((resolve, reject) => {
    proc.on('exit', (code) => reject(new Error(`harness ตายก่อน READY (code=${code}) err=${errLog.slice(-800)}`)));
    const iv = setInterval(() => {
      const m = bootLog.match(/READY (\d+)/);
      const tk = bootLog.match(/TOKEN (\S+)/);
      if (m && tk) { clearInterval(iv); clearTimeout(to); resolve({ port: Number(m[1]), token: tk[1] }); }
    }, 100);
    const to = setTimeout(() => { clearInterval(iv); reject(new Error(`harness ไม่ขึ้นใน 45s err=${errLog.slice(-800)}`)); }, 45_000);
  });
  /* เดินต้นไม้ knowledge/ ทั้งก้อน — ไม่เดาโครงสร้าง (knowledgeDir() เลือก nested/flat เองตอน runtime) */
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const KNOWLEDGE_ROOT = path.join(CORE, 'knowledge');
  try {
    const before = walk(KNOWLEDGE_ROOT);

    /* ผ่าน: .txt (ชื่อฝัง traversal) → 201 + row จาก mock + ไฟล์อยู่บนดิสก์จริง (ชื่อสุ่ม) + metadata ใช้ display name
       (ชื่อไทยใน filename โดน busboy latin1 charset — เป็นข้อจำกัดของ multipart spec ไม่ใช่สัญญาความปลอดภัย จึงใช้ชื่อ ASCII) */
    const ok = await driveUpload(port, token, 'a/b/c/../../business-notes.txt', Buffer.from('ข้อความทดสอบ'), 'text/plain');
    assert.equal(ok.status, 201, `body=${ok.text.slice(0, 300)}`);
    const okJson = JSON.parse(ok.text);
    assert.equal(okJson.success, true);
    assert.match(okJson.item.file_path, /^uploads[\\/]?\d+-[0-9a-f-]{36}\.txt$/);
    assert.equal(okJson.item.title, 'business notes', 'title ต้องมาจาก safeDisplayName (ไม่มี path เหลือ — dash ถูกแปลงเป็นช่องว่างตาม handler)');
    const after = walk(KNOWLEDGE_ROOT);
    const added = after.filter((f) => !before.includes(f));
    assert.equal(added.length, 1, `ต้องเขียนลงดิสก์จริง 1 ไฟล์ (ได้ ${added.join(', ')})`);
    assert.match(path.basename(added[0]), /^\d+-[0-9a-f-]{36}\.txt$/, 'ชื่อบนดิสก์สุ่มล้วน');
    assert.doesNotMatch(path.basename(added[0]), /business|notes/, 'ห้ามเหลือชื่อเดิมบนดิสก์');
    assert.ok(fs.readFileSync(added[0]).includes('ข้อความทดสอบ'), 'เนื้อหาตรง');

    /* ถูกปฏิเสธ: .exe — traversal ใน originalname ด้วย — ไม่มีไฟล์ใหม่ทั้ง knowledge/ (และไม่หลุดที่อื่น) */
    const bad = await driveUpload(port, token, 'x.exe', Buffer.from('MZ stub'), 'application/octet-stream');
    assert.equal(bad.status, 400, `body=${bad.text.slice(0, 300)}`);
    assert.deepEqual(walk(KNOWLEDGE_ROOT), after, 'ไม่มีไฟล์ใหม่ทั้ง knowledge/ — ไฟล์ตกขอบไม่มีทางลงดิสก์');
  } finally {
    proc.kill('SIGTERM');
  }
}, { timeout: 90_000 });

/* ── B. wiring: ทุกจุดรับไฟล์ต้องผ่าน hardenUpload ── */
test('B: โมดูล multer ทั้งหมดใช้ hardenUpload — ไม่มี multer({dest|storage}) ตรง ๆ เหลืออยู่', async () => {
  const modulesDir = path.join(CORE, 'src', 'modules');
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
  /* hardenUpload เองห้ามมีเส้นทางเขียนดิสก์ที่ไม่ผ่าน randomDiskName */
  const lib = fs.readFileSync(path.join(CORE, 'src', 'lib', 'harden-upload.ts'), 'utf8');
  assert.match(lib, /memoryStorage/, 'ต้องมี memory mode สำหรับโมดูลที่ไม่ต้องเก็บไฟล์');
  assert.match(lib, /randomDiskName\(file\.originalname/, 'ชื่อดิสก์ต้องผ่าน randomDiskName เสมอ');
});

/* ── C. เมทริกซ์แพลตฟอร์ม — import .ts ตรง ๆ (Node 24 type-stripping) ── */
const HARDEN_URL = pathToFileURL(path.join(CORE, 'src', 'lib', 'harden-upload.ts')).href;
const harden = () => import(HARDEN_URL);

test('C-matrix: safeDisplayName ตัด separator ทั้ง POSIX/Windows บนทุก OS', async () => {
  const { safeDisplayName } = await harden();
  assert.equal(safeDisplayName('..\\..\\secret.docx'), 'secret.docx', 'backslash ต้องตัดบนทุก OS (บั๊ก POSIX เดิม)');
  assert.equal(safeDisplayName('../../etc/passwd'), 'passwd', 'slash ต้องตัดบนทุก OS');
  assert.equal(safeDisplayName('C:\\Users\\com\\a.jpg'), 'a.jpg');
  assert.equal(safeDisplayName('/var/log/app.log'), 'app.log');
  assert.equal(safeDisplayName('a/b\\c/d.txt'), 'd.txt', 'ผสมทั้งสองแบบก็ตัดหมด');
});

test('C-matrix: resolveInsideRoot ปฏิเสธ traversal ของฝั่งตรงข้ามเสมอ + backslash แบนทุกแพลตฟอร์ม', async () => {
  const { resolveInsideRoot } = await harden();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harden-matrix-${process.platform}-`));
  fs.writeFileSync(path.join(root, 'ok.txt'), 'x');
  try {
    /* สัญญาเดียวกันทั้งสองแพลตฟอร์ม: แบ็กสแลชใน segments = reject เสมอ (บน POSIX เป็นตัวอักษรปกติ
       แต่ปล่อยผ่าน = caller บน Linux อาจพา C:\ เข้ามาได้) */
    assert.throws(() => resolveInsideRoot(root, '..\\..\\win.ini'), RangeError, `${process.platform}: backslash ต้อง reject`);
    assert.throws(() => resolveInsideRoot(root, 'C:\\Windows\\evil.txt'), RangeError, `${process.platform}: absolute Windows ต้อง reject`);
    assert.throws(() => resolveInsideRoot(root, '../outside.txt'), RangeError, `${process.platform}: POSIX traversal ต้อง reject เสมอ`);
    assert.equal(resolveInsideRoot(root, 'ok.txt'), path.resolve(root, 'ok.txt'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('C-matrix: hardenUpload — memory mode กัน misconfig + mimeAllow ทำงานจริง', async () => {
  const { hardenUpload } = await harden();
  assert.throws(() => hardenUpload({ mode: 'memory', allowedExtensions: ['.png'], destination: os.tmpdir() }), /memory/, 'memory+destination = ต้อง throw');
  assert.throws(() => hardenUpload({ allowedExtensions: [] }), /allowedExtensions/);

  /* mimeAllow: ผ่านเมื่อ MIME ตรง whitelist, โดนปฏิเสธเมื่อไม่ตรง — รันเป็นไฟล์ชั่วคราว (ไม่ใช่ -e)
     เพราะ multer middleware ต้องการ req stream จริง + เขียนผลลงไฟล์กัน log ปนผล */
  const OUT = path.join(HARNESS, 'memmode-result.json');
  fs.writeFileSync(path.join(HARNESS, 'memmode.mjs'), `
import { hardenUpload, IMAGE_MIME } from ${JSON.stringify(HARDEN_URL)};
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
const multer = createRequire(${JSON.stringify(path.join(CORE, 'src', 'lib', 'harden-upload.ts'))})('multer');
const m = hardenUpload({ mode: 'memory', allowedExtensions: ['.png', '.jpg'], mimeAllow: IMAGE_MIME, maxSizeMB: 5 });
const tryUpload = (mime, name, buf) => new Promise((resolve) => {
  const b = Buffer.concat([
    Buffer.from('--b\\r\\nContent-Disposition: form-data; name="image"; filename="' + name + '"\\r\\nContent-Type: ' + mime + '\\r\\n\\r\\n'),
    buf, Buffer.from('\\r\\n--b--\\r\\n'),
  ]);
  const req = Object.assign(Readable.from([b]), { headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(b.length) } });
  const res = {
    headers: {}, setHeader() {},
    status() { return this; },
    json(x) { resolve('REJECTED:' + JSON.stringify(x).slice(0, 80)); },
    end(s) { resolve('NO-FILE ' + String(s ?? '')); },
  };
  m.single('image')(req, res, (err) => {
    if (err) return resolve('REJECTED:' + String(err.message || err).slice(0, 80));
    resolve(req.file && req.file.buffer && req.file.buffer.length ? 'ACCEPTED' : 'NO-FILE');
  });
});
const png = await tryUpload('image/png', 'shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const txt = await tryUpload('text/plain', 'note.txt', Buffer.from('hello'));
fs.writeFileSync(${JSON.stringify(OUT)}, JSON.stringify({ png, txt: txt.startsWith('REJECTED') ? 'REJECTED' : txt }));
process.exit(0); /* busboy ค้าง event loop — ปิดเองหลังเขียนผล */
`);
  const run = spawnSync(process.execPath, ['memmode.mjs'], {
    cwd: HARNESS,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(path.join(CORE, 'node_modules', 'tsx', 'dist', 'cli.mjs')).href}` },
  });
  assert.ok(fs.existsSync(OUT), `subprocess ต้องเขียนผล (stderr=${(run.stderr || '').slice(0, 400)})`);
  const parsed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.equal(parsed.png, 'ACCEPTED', 'image/png ต้องผ่าน memory mode');
  assert.equal(parsed.txt, 'REJECTED', 'text/plain ต้องโดน mimeAllow ปฏิเสธ');
});
