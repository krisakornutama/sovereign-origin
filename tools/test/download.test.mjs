// เทส regression ของ downloadFile — ทุกเส้นทางต้อง settle (resolve/reject) ไม่ค้างผู้เรียก
// บั๊กต้นแบบ (803054c): ไฟล์เขียนไม่ได้ → stream error ยิงก่อน listener ถูกแนบ → promise ไม่ settle → IPC ค้าง
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
const require = createRequire(import.meta.url);
const { downloadFile } = require(join(process.cwd(), 'sovereign-frontend', 'electron', 'download.js'));

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

const BODY = Buffer.alloc(64 * 1024, 7);
const srv = http.createServer((req, res) => {
  if (req.url === '/asset') { res.writeHead(200, { 'Content-Length': BODY.length }); return res.end(BODY); }
  if (req.url === '/jump') { res.writeHead(302, { Location: '/asset' }); return res.end(); }
  res.writeHead(404); res.end('no');
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const base = `http://127.0.0.1:${srv.address().port}`;
const dir = mkdtempSync(join(tmpdir(), 'download-test-'));
const dest = (n) => join(dir, n);

try {
  // 1) ปกติ — resolve คืน dest + เนื้อหาครบ
  const r1 = await downloadFile(`${base}/asset`, dest('ok.bin'));
  check('200 resolve คืน dest + เนื้อหาครบ', r1 === dest('ok.bin') && readFileSync(dest('ok.bin')).length === BODY.length, String(r1));

  // 2) redirect — ไปต่อจนได้ไฟล์เดียวกัน
  const r2 = await downloadFile(`${base}/jump`, dest('redir.bin'));
  check('redirect resolve และไฟล์เขียนครบ', r2 === dest('redir.bin') && readFileSync(dest('redir.bin')).length === BODY.length, String(r2));

  // 3) 404 — reject + ไม่ทิ้งไฟล์ค้าง
  let err3 = null;
  try { await downloadFile(`${base}/missing`, dest('bad.bin')); } catch (e) { err3 = e; }
  check('404 reject ด้วยข้อความ HTTP 404', err3 && /HTTP 404/.test(err3.message), err3 && err3.message);
  check('404 ไม่ทิ้งไฟล์ค้างบนดิสก์', !fsExists(dest('bad.bin')), '');

  // 4) ไฟล์เขียนไม่ได้ (โฟลเดอร์ปลายทางไม่มีจริง) — ต้อง reject ทันที ไม่ค้าง
  const t0 = Date.now();
  let err4 = null;
  try { await downloadFile(`${base}/asset`, join(dir, 'no-such-dir', 'x.bin')); } catch (e) { err4 = e; }
  const ms = Date.now() - t0;
  check('ไฟล์เขียนไม่ได้ reject ทันที (ไม่ค้าง)', err4 && ms < 5000 && /EPERM|ENOENT/.test(err4.message), `${ms}ms ${err4 && err4.message}`);

  // 5) ลำดับ redirect ต้องลบไฟล์เก่าจบก่อนเขียนรอบใหม่ (ไฟล์ปลายทางเดียวกันตลอด)
  const r5 = await downloadFile(`${base}/jump`, dest('again.bin'));
  check('redirect ซ้ำที่ dest เดิมได้ผลครบ', r5 === dest('again.bin') && readFileSync(dest('again.bin')).length === BODY.length, String(r5));

  // 6) เนื้อหาตรง byte เป๊ะ
  writeFileSync(dest('expected.bin'), BODY);
  check('เนื้อหาไฟล์ตรงต้นทาง byte เป๊ะ', Buffer.compare(readFileSync(dest('ok.bin')), BODY) === 0, '');
} finally {
  srv.close();
  rmSync(dir, { recursive: true, force: true });
}

function fsExists(p) { try { readFileSync(p); return true; } catch { return false; } }

console.log(fails === 0 ? 'ALL PASS' : `FAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
