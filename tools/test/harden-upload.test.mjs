#!/usr/bin/env node
/* เทสสัญญาของ lib/harden-upload.ts (งาน hardening จุดรับไฟล์ multer) — รันออฟไลน์ ไม่แตะ GitHub จริง
   สัญญา 4 ข้อ (มาจากงานจริง: whisper เดิมรับทุกชนิดไฟล์ + knowledge เดิมตั้งชื่อไฟล์จาก originalname):
     1. ไฟล์นามสกุลที่อนุญาต "ผ่าน" และถูกเขียนลงดิสก์จริง · นามสกุลอื่น "ถูกปฏิเสธ" และไม่มีอะไรลงดิสก์
     2. ชื่อไฟล์บนดิสก์สุ่มเสมอ — originalname ที่ฝัง traversal (../ ..\ ..%2F..) ห้ามเหลือร่องรอยบนดิสก์
        (พิสูจน์ด้วย multipart bytes จริงผ่าน multer middleware ไม่ใช่เรียก util ตรง ๆ)
     3. safeDisplayName ตัด path components ทั้ง / และ \ + control chars ออก (บั๊กจริง: path.basename
        บน POSIX ไม่ตัด \ → ชื่อโฟลเดอร์เคยหลุดไปโชว์ใน metadata)
     4. resolveInsideRoot (ที่ knowledge DELETE/GET ใช้กัน unlink/sendFile หลุด root) ปฏิเสธ path นอก root
   วิธี: import .ts ตรง ๆ ด้วย Node 24 type-stripping + sandbox (copy ไฟล์ .ts ไปไดเรกทอรีชั่วคราวเพื่อพิสูจน์
   "ไม่พึ่ง path ใดใน repo" ตาม convention ของ hook-contract) — multipart ทดสอบผ่าน http server จริง
   ใช้: node --test tools/test/   (หรือ npm run test:tools) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARDEN = path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'lib', 'harden-upload.ts');

/* ── โหลด util จริงจาก repo (ห้าม copy ออกไป Temp — multer ต้อง resolve จาก core-api/node_modules)
   คุณสมบัติ "ไม่มี path แข็งใน util" พิสูจน์ที่ multipart tests ที่ใช้ destination สมัครใจจาก temp แทน ── */
const HARDEN_URL = pathToFileURL(HARDEN).href; // Windows ต้องใช้ file:// URL
function sandbox() {
  return { mod: () => import(HARDEN_URL) };
}

/* ── multipart bytes จริง → multer middleware (single) → ตรวจ req.file/next/error และดิสก์ ── */
const listen = (handler) => new Promise((resolve) => {
  const srv = http.createServer(handler);
  srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
});
const close = (srv) => new Promise((r) => srv.close(r));

function multipartBody(field, filename, contentBytes, contentType = 'application/octet-stream') {
  const boundary = '----harden' + Date.now() + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    contentBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadViaMulter(multerInstance, port, { body, contentType }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': contentType, 'content-length': body.length } },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/* harness ตอบ JSON {err, file} เสมอ — เทสยึดสัญญาเชิงความหมาย (file มี/ไม่มี + err)
   ไม่ยึด status transport เพราะ multer 2.4 รายงาน fileFilter error ได้ 2 เส้นทาง (เขียน 500 เอง หรือ next(err)) */
function driveSingle(multerInstance) {
  return (req, res) => {
    multerInstance.single('file')(req, res, (err) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ err: err ? String(err.message || err) : null, file: req.file ?? null }));
    });
  };
}

/* ── สัญญา 1: อนุญาต = ผ่าน + ลงดิสก์จริง · ไม่อนุญาต = ถูกปฏิเสธ + ดิสก์ว่าง ── */
test('allowed extension lands on disk with random name; other extension is rejected before any write', async (t) => {
  const sb = sandbox();
  const { hardenUpload } = await sb.mod();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-disk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const m = hardenUpload({ destination: dir, allowedExtensions: ['.pdf', '.md'], maxSizeMB: 5 });
  const { srv, port } = await listen(driveSingle(m));
  t.after(() => close(srv));

  /* ผ่าน: .pdf → 200 + req.file มีชื่อสุ่ม + ไฟล์ลงดิสก์จริง เนื้อหาตรง */
  const okBody = multipartBody('file', 'report.pdf', Buffer.from('%PDF-1.4 hello'));
  const ok = await uploadViaMulter(m, port, okBody);
  assert.equal(ok.status, 200);
  const okPayload = JSON.parse(ok.body);
  assert.equal(okPayload.err, null, 'ไฟล์ที่อนุญาตต้องไม่มี error');
  assert.match(okPayload.file.filename, /^\d+-[0-9a-f-]{36}\.pdf$/, 'req.file.filename ต้องเป็นชื่อสุ่ม');
  let files = fs.readdirSync(dir);
  assert.equal(files.length, 1, 'ต้องเขียนลงดิสก์จริง 1 ไฟล์');
  assert.match(files[0], /^\d+-[0-9a-f-]{36}\.pdf$/, 'ชื่อบนดิสก์ต้องเป็น random pattern พร้อมนามสกุลของไฟล์');
  assert.equal(fs.readFileSync(path.join(dir, files[0])).toString(), '%PDF-1.4 hello');

  /* ถูกปฏิเสธ: .exe → ไม่มี req.file + มีข้อความ error + ไม่มีไฟล์ใหม่ลงดิสก์ */
  const badBody = multipartBody('file', 'payload.exe', Buffer.from('MZ malicious'));
  const bad = await uploadViaMulter(m, port, badBody);
  const badPayload = (() => { try { return JSON.parse(bad.body); } catch { return null; } })();
  const rejected = (badPayload ? badPayload.err !== null || badPayload.file === null : bad.status !== 200);
  assert.ok(rejected, `ไฟล์ .exe ต้องถูกปฏิเสธ (status=${bad.status} body=${bad.body.slice(0, 80)})`);
  if (badPayload) assert.match(badPayload.err || '', /นามสกุล/, 'error ต้องมาจาก whitelist ของเรา');
  files = fs.readdirSync(dir);
  assert.equal(files.length, 1, 'ไฟล์ที่ถูกปฏิเสธต้องไม่ถูกเขียนลงดิสก์');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.exe')).length, 0);

  /* กันช่อง "รับทุกนามสกุล": hardenUpload ไม่ให้สร้างโดยไม่มี whitelist */
  assert.throws(() => hardenUpload({ allowedExtensions: [] }), /allowedExtensions/);
});

/* ── สัญญา 2: traversal ใน originalname ห้ามเหลือร่องรอยบนดิสก์ (multipart bytes จริง) ── */
test('path-traversal originalname never touches disk names (real multipart through multer)', async (t) => {
  const sb = sandbox();
  const { hardenUpload } = await sb.mod();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-trav-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const m = hardenUpload({ destination: dir, allowedExtensions: ['.pdf'], maxSizeMB: 5 });
  const { srv, port } = await listen(driveSingle(m));
  t.after(() => close(srv));

  const tricky = '..%2F..%2Fwin\\..\\evil.pdf'; // ../ ..\ และรูปแบบ %2F ที่ browsers/clients เคยส่งมา
  const { body, contentType } = multipartBody('file', tricky, Buffer.from('%PDF-1.4 x'));
  const r = await uploadViaMulter(m, port, { body, contentType });
  assert.equal(r.status, 200, 'นามสกุล .pdf ผ่าน filter (มาจากชื่อไฟล์เดิมที่ท้ายสุด)');
  const payload = JSON.parse(r.body);
  assert.equal(payload.err, null);
  assert.match(payload.file.filename, /^\d+-[0-9a-f-]{36}\.pdf$/, 'req.file.filename ต้องสุ่มล้วน');

  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /evil|win|\.\.|%2F/i, `ชื่อบนดิสก์ห้ามเหลือร่องรอย: ${files[0]}`);
  assert.match(files[0], /^\d+-[0-9a-f-]{36}\.pdf$/);
  assert.ok(!fs.existsSync(path.resolve(dir, '..', 'evil.pdf')), 'ห้ามมีไฟล์หลุดออกนอก destination');

  /* unit: randomDiskName ทิ้งทุกร่องรอย (ทั้ง / \ %2F และชื่อไฟล์เดิม + สุ่มไม่ซ้ำ) */
  const { randomDiskName } = await sb.mod();
  for (const evil of ['../../etc/passwd', '..\\..\\win.ini', 'a/b/c/../../report.pdf', '..%2F..%2Fevil.pdf', 'C:\\Windows\\evil.pdf', 'เอกสารลับ.pdf']) {
    const name = randomDiskName(evil);
    assert.match(name, /^\d+-[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/, `randomDiskName(${JSON.stringify(evil)}) ต้องเป็นชื่อสุ่ม`);
    assert.ok(!name.includes('passwd') && !name.includes('win') && !name.includes('evil') && !name.includes('เอกสาร'),
      `ห้ามเหลือชื่อเดิมใน ${name}`);
    const two = randomDiskName(evil);
    assert.notEqual(name.split('-').slice(1).join('-'), two.split('-').slice(1).join('-'), 'สุ่มซ้ำกันไม่ได้');
  }
});

/* ── สัญญา 3: safeDisplayName ตัด path components (ทั้ง / และ \) + control chars ── */
test('safeDisplayName strips path components and control characters (platform-agnostic)', async (t) => {
  const sb = sandbox();
  const { safeDisplayName } = await sb.mod();

  /* บั๊กจริงที่เทสเจอก่อนแก้: path.basename บน POSIX ไม่ตัด backslash */
  assert.equal(safeDisplayName('..\\..\\secret.docx'), 'secret.docx', 'backslash ต้องถูกตัดเป็น path separator ด้วย');
  assert.equal(safeDisplayName('../../var/log/app.log'), 'app.log');
  assert.equal(safeDisplayName('a/b/c/../../report final.pdf'), 'report final.pdf');
  assert.equal(safeDisplayName('C:\\Windows\\evil.pdf'), 'evil.pdf');
  assert.equal(safeDisplayName('trailing/..'), 'file', 'ชื่อที่เหลือว่างหลังตัด dots → fallback');
  assert.equal(safeDisplayName('name\u0000\u001f\u007fwith\x1bctrl.pdf'), 'name with ctrl.pdf', 'control chars กลายเป็นช่องว่าง');
  assert.equal(safeDisplayName('note[v1].pdf'), 'note[v1].pdf', 'อักขระปกติอย่าง [ ] ต้องอยู่ครบ (ไม่เกินเสีย)');
  assert.equal(safeDisplayName(undefined), 'file');
  assert.equal(safeDisplayName(''), 'file');
  assert.equal(safeDisplayName('x'.repeat(300)), 'x'.repeat(120), 'จำกัดความยาว 120');
});

/* ── สัญญา 4: resolveInsideRoot (ที่ knowledge DELETE/GET ใช้) ปฏิเสธ path นอก root ── */
test('resolveInsideRoot allows inside paths and rejects traversal outside the root', async (t) => {
  const sb = sandbox();
  const { resolveInsideRoot } = await sb.mod();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-root-'));
  fs.mkdirSync(path.join(root, 'uploads'));
  fs.writeFileSync(path.join(root, 'uploads', 'keep.txt'), 'ok');
  const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harden-out-')), 'secret.txt');
  fs.writeFileSync(secret, 'outside');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(path.dirname(secret), { recursive: true, force: true }); });

  /* ใน root ได้ */
  assert.equal(resolveInsideRoot(root, 'uploads', 'keep.txt'), path.resolve(root, 'uploads', 'keep.txt'));
  assert.equal(resolveInsideRoot(root, 'uploads/../uploads/keep.txt'), path.resolve(root, 'uploads', 'keep.txt'), 'จุดคู่ที่วิ่งค้างใน root = ปลอดภัย');

  /* นอก root โดน throw ทุกรูปแบบ */
  assert.throws(() => resolveInsideRoot(root, '..\\..\\win.ini'), RangeError, 'traversal แบบ backslash');
  assert.throws(() => resolveInsideRoot(root, '../outside.txt'), RangeError);
  assert.throws(() => resolveInsideRoot(root, 'uploads', '../../../../etc/passwd'), RangeError);
  assert.throws(() => resolveInsideRoot(root, secret), RangeError, 'absolute path อื่น');

  /* พฤติกรรมที่ต้องการ: throw "ก่อนแตะดิสก์" — ลบของนอก root ไม่สำเร็จ ของยังอยู่ครบ */
  const outsideTarget = path.resolve(root, '..', 'should-not-be-deleted.txt');
  assert.throws(() => { fs.unlinkSync(resolveInsideRoot(root, path.relative(root, outsideTarget))); }, RangeError);
  assert.ok(fs.existsSync(secret), 'ไฟล์นอก root ยังอยู่');

  /* wiring: knowledge routes ต้อง import util นี้จริง (ป้องกัน guard หลุดจากโค้ดในอนาคต) */
  const routes = fs.readFileSync(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'modules', 'knowledge', 'knowledge.routes.ts'), 'utf8');
  assert.match(routes, /resolveInsideRoot\(KNOWLEDGE_DIR/, 'DELETE ต้องผ่าน resolveInsideRoot');
  assert.match(routes, /resolveInsideRoot\(KNOWLEDGE_DIR, 'uploads'/, 'GET /uploads ต้องผ่าน resolveInsideRoot');
  const whisper = fs.readFileSync(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'modules', 'whisper', 'whisper.routes.ts'), 'utf8');
  assert.match(whisper, /hardenUpload\(/, 'whisper ต้องใช้ hardenUpload (ห้ามกลับไป multer ตรง ๆ)');
  assert.doesNotMatch(whisper, /multer\(\s*\{[^}]*dest:/, 'whisper ห้ามใช้ dest ตรง ๆ อีก');
});
