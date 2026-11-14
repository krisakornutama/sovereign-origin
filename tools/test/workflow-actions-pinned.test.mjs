// ด่านกัน "workflow อ้าง action ด้วย tag/branch" — tag ถูกย้ายได้ (supply chain)
// ถ้าไม่ pin เป็น commit SHA ทั้งที่ workflow ถือ secret (PAGES_TOKEN / GITHUB_TOKEN)
// เท่ากับให้เจ้าของ action เปลี่ยนโค้ดที่รันใน CI ได้โดยเราไม่เห็น
//
// กติกา:
//   - `uses: owner/repo@<40-hex SHA>` = ผ่าน
//   - `uses: ./local/path` หรือ `docker://` = ผ่าน (ไม่ได้มาจาก marketplace)
//   - `uses: owner/repo@v4` / `@main` = **fail**
// และห้ามใช้ trigger ที่ให้โค้ดจาก fork ได้สิทธิ์ secret (`pull_request_target`, `workflow_run`)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

function readWorkflow(file) {
  return fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
}

test('ทุก uses: ใน workflow ต้อง pin เป็น commit SHA 40 hex', () => {
  const files = workflowFiles();
  assert.ok(files.length > 0, 'ต้องมี workflow อย่างน้อย 1 ไฟล์');

  const unpinned = [];
  for (const file of files) {
    readWorkflow(file)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (/^\s*#/.test(line)) return; // คอมเมนต์ทั้งบรรทัด
        const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/.exec(line);
        if (!m) return;
        const ref = m[1];
        if (ref.startsWith('./') || ref.startsWith('docker://')) return;
        if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(ref)) return;
        unpinned.push(`${file}:${index + 1} ${ref}`);
      });
  }

  assert.deepEqual(unpinned, [], `ต้อง pin เป็น SHA (ไม่ใช่ tag/branch):\n${unpinned.join('\n')}`);
});

test('ห้ามใช้ trigger ที่ให้ secret แก่โค้ดจาก fork', () => {
  const offenders = [];
  for (const file of workflowFiles()) {
    const yml = readWorkflow(file)
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    for (const bad of ['pull_request_target', 'workflow_run']) {
      if (new RegExp(`^\\s*${bad}:`, 'm').test(yml)) offenders.push(`${file} → ${bad}`);
    }
  }
  assert.deepEqual(offenders, [], 'trigger เหล่านี้ให้สิทธิ์ secret กับโค้ดที่ยังไม่ merge');
});
