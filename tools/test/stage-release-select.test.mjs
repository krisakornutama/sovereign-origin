// stage-release — ต้องคัดเฉพาะ artifact ของเวอร์ชันที่กำลังจัด
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectArtifacts } from '../stage-release.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('ตัด artifact รุ่นเก่าออก (1.1.1 ไม่ปนเข้า 1.2.0)', () => {
  const files = [
    'Sovereign-OS-1.1.1-portable.exe',
    'Sovereign-OS-1.2.0-portable.exe',
    'Sovereign OS-1.1.1-win.zip',
    'Sovereign OS-1.2.0-win.zip',
    'builder-debug.yml',
    'win-unpacked',
  ];
  const picked = selectArtifacts(files, '1.2.0');
  assert.deepEqual(picked.portable, ['Sovereign-OS-1.2.0-portable.exe']);
  assert.deepEqual(picked.zips, ['Sovereign OS-1.2.0-win.zip']);
});

test('ไม่-match อะไรเลย = คืนลิสต์ว่าง (ให้ caller ตายพร้อมบอกสาเหตุ)', () => {
  const picked = selectArtifacts(['Sovereign-OS-1.1.1-portable.exe', 'Sovereign OS-1.0.0-win.zip'], '1.2.0');
  assert.equal(picked.portable.length, 0);
  assert.equal(picked.zips.length, 0);
});

test('เวอร์ชันที่ไม่ชนกันแบบ prefix ก็ยังแยกถูก (1.2.0 vs 1.2.1)', () => {
  const picked = selectArtifacts(
    ['Sovereign-OS-1.2.1-portable.exe', 'Sovereign-OS-1.2.0-portable.exe'],
    '1.2.0'
  );
  assert.deepEqual(picked.portable, ['Sovereign-OS-1.2.0-portable.exe']);
});

// ── import ต้องไม่ทำงานทั้งสคริปต์ ───────────────────────────────────────────
// เคสจริง (10 พ.ย. 69): bump version ใน sovereign-frontend/package.json เป็น 1.3.0
//   → เทสต์ชุดนี้ล้มทันที เพราะ importing stage-release.mjs รัน main ทั้งไฟล์
//   แล้ว die() "ไม่พบไฟล์ portable exe" (dist-electron มีแต่ 1.2.0)
// เทสต์ที่ import ฟังก์ชัน pure ไม่ควรพึ่ง artifact ที่ build ไว้ในเครื่อง
test('import โมดูลต้องไม่มี side effect — ไม่รัน main ทั้งสคริปต์', () => {
  const url = pathToFileURL(join(ROOT, 'tools', 'stage-release.mjs')).href;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log('IMPORT_OK', typeof m.selectArtifacts);`],
    { encoding: 'utf8', cwd: ROOT, timeout: 60_000 }
  );
  assert.equal(child.status, 0, `import ต้องไม่ exit ไม่เป็น 0 — stderr: ${child.stderr}`);
  assert.match(child.stdout, /IMPORT_OK function/, 'selectArtifacts ต้องถูก export ใช้ได้');
  assert.doesNotMatch(child.stdout + child.stderr, /stage-release — Sovereign OS|\[stage-release\]/,
    'ห้ามพิมพ์ banner/error ของ main ตอนถูก import');
});
