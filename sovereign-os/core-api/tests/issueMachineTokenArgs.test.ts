// sovereign-os/core-api/tests/issueMachineTokenArgs.test.ts
//
// ── ด่านของสคริปต์ออก token (ใช้โดย PACK-MACHINE) ──────────────────────────────
// เทสต์นี้ไม่ต้องมี DB: ตรวจว่า "คำสั่งที่ผิดรูป" ถูกปฏิเสธก่อนแตะฐานข้อมูล
// (ถ้าไปตรวจหลังต่อ DB ผู้ใช้จะเห็น error เชื่อมต่อฐานข้อมูลแทนเหตุผลจริง)
import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..');
const TSX = path.join(CORE, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runScript(args: string[]) {
  return spawnSync(process.execPath, [TSX, 'scripts/issue-machine-token.ts', ...args], {
    cwd: CORE,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      // ตั้งใจให้ต่อไม่ได้ — ถ้าสคริปต์แตะ DB ก่อนตรวจ arg เทสต์จะล้มด้วย error เชื่อมต่อ
      DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nowhere',
    },
  });
}

describe('issue-machine-token: คำสั่งผิดรูปต้องถูกปฏิเสธก่อนแตะ DB', () => {
  test('ไม่มี --name = exit 2', { skip: !fs.existsSync(TSX) }, () => {
    const r = runScript(['--json']);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(String(r.stderr), /--name/);
  });

  test('--confirm-lan เดี่ยว ๆ (ไม่มี --owner) = exit 2 + รหัสให้เครื่องอ่าน', { skip: !fs.existsSync(TSX) }, () => {
    const r = runScript(['--name=ทดสอบ-guard', '--confirm-lan', '--json']);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    const line = String(r.stdout)
      .split(/\r?\n/)
      .find((l) => l.startsWith('{'));
    assert.ok(line, `ต้องมี JSON ใน stdout — ได้: ${r.stdout}`);
    assert.equal(JSON.parse(line!).error, 'confirm_lan_without_owner');
  });
});
