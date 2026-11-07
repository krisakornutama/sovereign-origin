// stage-release — ต้องคัดเฉพาะ artifact ของเวอร์ชันที่กำลังจัด
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectArtifacts } from '../stage-release.mjs';

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
