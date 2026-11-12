// tools/test/frontend-queue-sync-truth.test.mjs — ผูก "ข้อความ sync ต้องตรงกับคิวจริง" เข้า quality gate
//
// 1) รันเทสต์ TS ของตรรกะข้อความ (sovereign-frontend/src/lib/offline/sync-summary.test.ts) ด้วย tsx
// 2) ตรวจซอร์สของ panel: ต้องใช้ syncOutcomeMessage และต้องไม่ประกาศ "sync ทั้งหมดสำเร็จ"
//    แบบตายตัว (นั่นคือบั๊กเดิม — คิวที่ถูกพักไว้ยังอยู่แต่ผู้ใช้ถูกบอกว่าจบแล้ว)
// 3) ตรวจว่าคีย์ใหม่มีครบทั้ง th และ en — ไม่งั้นโหมดอังกฤษจะอ่านข้อความไทย
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const TSX_TEST = 'src/lib/offline/sync-summary.test.ts';
const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

test('frontend sync-summary suite (tsx)', () => {
  const result = spawnSync(process.execPath, [TSX_CLI, TSX_TEST], {
    cwd: FRONTEND,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
  });

  assert.equal(
    result.status,
    0,
    `${TSX_TEST} ล้ม (exit ${String(result.status)}):\n${result.stdout || ''}\n${result.stderr || ''}`
  );
});

test('panel ต้องคิดข้อความจากจำนวนที่เหลือ ไม่ใช่ประกาศสำเร็จตายตัว', () => {
  const panel = fs.readFileSync(path.join(FRONTEND, 'src/components/system/OfflineQueuePanel.tsx'), 'utf8');
  assert.match(panel, /syncOutcomeMessage/, 'panel ต้องใช้ syncOutcomeMessage');
  assert.ok(
    !panel.includes('sync ทั้งหมดสำเร็จ'),
    'panel ต้องไม่ประกาศ "sync ทั้งหมดสำเร็จ" แบบตายตัว — ต้องเทียบของที่เหลือในคิวก่อน'
  );
});

test('คีย์ข้อความใหม่ต้องมีทั้ง th และ en', () => {
  for (const lang of ['th', 'en']) {
    const src = fs.readFileSync(
      path.join(FRONTEND, `src/i18n/${lang}/pages/settings.ts`),
      'utf8'
    );
    for (const key of ['syncAllPartial', 'syncAllNone']) {
      assert.ok(src.includes(`${key}:`), `${lang}/settings.ts ขาดคีย์ ${key}`);
    }
  }
});
