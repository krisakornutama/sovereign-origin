// coding-ide-budget-truth — CodingIde.tsx เกินเพดาน component 400 ต้องแยก hook + component (FE-007)
//
// เหตุผล: components/coding/CodingIde.tsx 791 บรรทัด > เพดาน component 400 — เกิน 391 (ก้อนสุดท้าย)
// วิธีแก้: state/handlers → hook 3 ตัว (jobs / workspace / terminal)
//   JSX → component 4 ตัว (Toolbar / MainPane / Drawer / Terminal) ใน components/coding/coding-ide/
//   ย้าย verbatim — CodingIde คงเป็น shell (หน้า ai-agent.tsx ไม่ต้องแก้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODING = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'coding');
const IDE = path.join(CODING, 'CodingIde.tsx');
const DIR = path.join(CODING, 'coding-ide');

const HOOKS = ['use-coding-jobs.ts', 'use-coding-workspace.ts', 'use-coding-terminal.ts'];
const COMPONENTS = ['CodingToolbar.tsx', 'CodingMainPane.tsx', 'CodingDrawer.tsx', 'CodingTerminal.tsx'];

test('CodingIde.tsx ต้องจัดขนาดลง ≤ 400 บรรทัด (เพดาน components)', () => {
  const n = readFileSync(IDE, 'utf8').split('\n').length;
  assert.ok(n <= 400, `CodingIde.tsx = ${n} บรรทัด > เพดาน 400 — แยก hook/component ตาม FE-007`);
});

test('hook 3 ไฟล์ต้องมีอยู่ ≤ 400 และถือ handler เดิมครบ', () => {
  const expect = [
    ['use-coding-jobs.ts', ['loadModels', 'loadCodingJobs', 'startCoding', 'applyCodingJob', 'deleteCodingJob', 'fetchSuggestions', 'fileToBase64', 'api/coding/jobs']],
    ['use-coding-workspace.ts', ['loadSettings', 'listDir', 'loadNotes', 'savePath', 'openFile', 'addNote', 'deleteNote', 'api/coding/workspace']],
    ['use-coding-terminal.ts', ['runTerm', 'termEndRef', 'api/coding/terminal']],
  ];
  for (const [file, keys] of expect) {
    const p = path.join(DIR, file);
    assert.ok(existsSync(p), `coding-ide/${file} ยังไม่มี`);
    const src = readFileSync(p, 'utf8');
    const n = src.split('\n').length;
    assert.ok(n <= 400, `${file} = ${n} บรรทัด > เพดาน 400`);
    for (const k of keys) assert.ok(src.includes(k), `${file} ต้องมี ${k}`);
  }
});

test('component JSX 4 ไฟล์ต้องมีอยู่ ≤ 400 และถือโซนเดิมครบ', () => {
  const expect = [
    ['CodingToolbar.tsx', ['coding-model', 'EFFORT_LEVELS', 'AUTONOMY_LEVELS', 'coding-ide-image-input']],
    ['CodingMainPane.tsx', ['aiAgent.coding.title', 'selectedJob.status', 'applyCodingJob', 'fetchSuggestions', 'CodeView']],
    ['CodingDrawer.tsx', ['drawerTab', 'SkillQueuePanel', 'aiAgent.workspace', 'deleteNote']],
    ['CodingTerminal.tsx', ['termOpen', 'runTerm', 'termEndRef']],
  ];
  for (const [file, keys] of expect) {
    const p = path.join(DIR, file);
    assert.ok(existsSync(p), `coding-ide/${file} ยังไม่มี`);
    const src = readFileSync(p, 'utf8');
    const n = src.split('\n').length;
    assert.ok(n <= 400, `${file} = ${n} บรรทัด > เพดาน 400`);
    for (const k of keys) assert.ok(src.includes(k), `${file} ต้องมี ${k}`);
  }
});

test('shell ต้องไม่เหลือ handler/JSX เดิมค้าง + ต้องเรียก hook/component ครบ', () => {
  const src = readFileSync(IDE, 'utf8');
  for (const sig of ['const startCoding', 'const loadCodingJobs', 'const runTerm', 'const savePath', 'const addNote', '<SkillQueuePanel', 'id="coding-model"', '<div ref={termEndRef} />']) {
    assert.ok(!src.includes(sig), `"${sig}" ยังค้างใน CodingIde — ต้องอยู่ใน hook/component`);
  }
  for (const name of ['useCodingJobs', 'useCodingWorkspace', 'useCodingTerminal', 'CodingToolbar', 'CodingMainPane', 'CodingDrawer', 'CodingTerminal']) {
    assert.match(src, new RegExp(`\\b${name}\\b`), `shell ต้องเรียก ${name}`);
  }
  assert.match(src, /export default function CodingIde/, 'ต้องคง default export ชื่อเดิม');
});
