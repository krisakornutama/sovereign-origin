// TDD: Coding Agent — ผู้ใช้พิมพ์ภาพรวมครั้งเดียว → วางแผน → เขียนโค้ด → ตรวจงาน → เสนอทางต่อ
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlanJson,
  parseSuggestionsJson,
  buildPlanPrompt,
  buildCodePrompt,
  validatePlan,
} from '../src/services/coding-agent.service';

test('parsePlanJson extracts title/files from fenced JSON', () => {
  const raw = `นี่คือแผนงาน:
\`\`\`json
{"title": "เพิ่มปุ่มดาวน์โหลด", "files": [{"path": "src/utils/download.ts", "purpose": "จัดการดาวน์โหลดไฟล์"}]}
\`\`\``;
  const plan = parsePlanJson(raw);
  assert.equal(plan.title, 'เพิ่มปุ่มดาวน์โหลด');
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].path, 'src/utils/download.ts');
});

test('parsePlanJson handles un-fenced JSON with trailing text', () => {
  const plan = parsePlanJson('{"title":"ท","files":[]} ขอบคุณครับ');
  assert.equal(plan.title, 'ท');
});

test('parsePlanJson falls back gracefully on garbage', () => {
  const plan = parsePlanJson('ขอโทษครับ ไม่เข้าใจ');
  assert.ok(plan.files.length === 0);
});

test('parseSuggestionsJson returns 2-4 options in Thai', () => {
  const raw = 'ต่อไปอยากทำอะไร? ["เพิ่มการทดสอบ", "เพิ่ม UI แสดงสถานะ", "เพิ่ม API docs"]';
  const opts = parseSuggestionsJson(raw);
  assert.ok(opts.length >= 2 && opts.length <= 4);
  assert.ok(opts[0].length > 0);
});

test('validatePlan rejects empty plans so a job never finishes done with 0 files', () => {
  assert.ok(validatePlan({ title: 'x', files: [] }));
  assert.ok(validatePlan({ title: '', files: [] }));
  assert.ok(validatePlan({ title: 'x', files: [{ path: '', purpose: '' }] }));
  assert.equal(validatePlan({ title: 'x', files: [{ path: 'src/a.ts', purpose: 'คำนวณ' }] }), null);
});


test('buildPlanPrompt includes the task description', () => {
  const p = buildPlanPrompt('เพิ่มระบบแจ้งเตือน LINE');
  assert.ok(p.includes('เพิ่มระบบแจ้งเตือน LINE'));
});

test('buildCodePrompt includes file path and purpose', () => {
  const p = buildCodePrompt({ path: 'src/x.ts', purpose: 'คำนวณราคา' }, 'สร้างฟังก์ชันคำนวณ');
  assert.ok(p.includes('src/x.ts'));
  assert.ok(p.includes('คำนวณราคา'));
});
