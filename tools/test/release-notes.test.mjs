// เทสต์ของ tools/attest/release-notes.mjs
//
// ประกาศ fingerprint ใน release notes เป็นช่องทางที่ผู้ใช้เห็นจริง ⇒ ข้อความต้อง
// (1) มี fingerprint และคำสั่งที่คัดลอกไปรันได้ (2) ตอนไม่มีใบรับรองต้องบอกตรง ๆ
// ไม่ปล่อยให้อ่านแล้วคิดว่ามี แต่ไม่มี
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fingerprintOfFile,
  renderReleaseNotes,
  verifyCommand,
} from '../attest/release-notes.mjs';

const FP = '1afcc7d951d822a7dfe384d89209aed2';

test('มี fingerprint ⇒ notes ประกาศ fingerprint + คำสั่งตรวจที่คัดลอกได้', () => {
  const notes = renderReleaseNotes({
    tag: 'v1.3.11',
    fingerprint: FP,
    verifierUrl: 'https://example.test/release-verify.html',
  });
  assert.match(notes, new RegExp(FP));
  assert.match(notes, /--fingerprint=/);
  assert.match(notes, /--dir=\./);
  assert.match(notes, /sovereign-attest\.json/);
  assert.match(notes, /example\.test/);
  assert.ok(notes.includes(verifyCommand(FP)), 'คำสั่งใน notes ต้องตรงกับ verifyCommand');
});

test('ไม่มี fingerprint ⇒ notes บอกตรง ๆ ว่าไม่มีใบรับรอง และไม่มี fingerprint หลงเหลือ', () => {
  const notes = renderReleaseNotes({ tag: 'v1.3.11', fingerprint: null, verifierUrl: 'x' });
  assert.match(notes, /ไม่มี/);
  assert.doesNotMatch(notes, /[0-9a-f]{32}/);
  assert.doesNotMatch(notes, /--fingerprint=/);
});

test('fingerprintOfFile อ่าน fingerprint จากเอกสาร และคืน null เมื่อไม่มีไฟล์', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  try {
    const file = path.join(dir, 'doc.json');
    fs.writeFileSync(file, JSON.stringify({ fingerprint: FP }));
    assert.equal(fingerprintOfFile(file), FP);
    assert.equal(fingerprintOfFile(path.join(dir, 'missing.json')), null);

    fs.writeFileSync(file, JSON.stringify({ v: 1 }));
    assert.equal(fingerprintOfFile(file), null, 'เอกสารไม่มี fingerprint ต้องคืน null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
