// knowledge-page-budget-truth — pages/knowledge.tsx เกินเพดาน 800 ต้องย้ายก้อน "AI สอนลูก" ออก (FE-002)
//
// เหตุผล: pages/knowledge.tsx 806 บรรทัด > เพดาน page 800
// วิธีแก้: ย้ายก้อน "AI สอนลูก" (12 state + handler สร้าง/เก็บ/เปิดบทเรียน + quiz +
//   effect บันทึกคะแนนอัตโนมัติ + โหลดโมเดล Ollama) ไปเป็น hook components/knowledge/use-teach.ts
//   ตาม precedent ของ use-kid-home.ts (กลุ่มเดียวกัน) — หน้า destructure ชื่อเดิมคืน
//   ทำให้ JSX/props ของ panel ทุกตัวไม่เปลี่ยน และ logic ย้าย verbatim
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = path.join(ROOT, 'sovereign-frontend', 'src', 'pages', 'knowledge.tsx');
const HOOK = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'knowledge', 'use-teach.ts');

test('pages/knowledge.tsx ต้องจัดขนาดลง ≤ 800 บรรทัด (เพดาน pages)', () => {
  const n = readFileSync(PAGE, 'utf8').split('\n').length;
  assert.ok(n <= 800, `knowledge.tsx = ${n} บรรทัด > เพดาน 800 — ย้ายก้อน AI สอนลูกไป hook useTeach`);
});

test('hook use-teach.ts ต้องมีอยู่และครอบ logic บทเรียน/quiz/บันทึกคะแนนครบ (ย้ายตามเดิม)', () => {
  assert.ok(existsSync(HOOK), 'components/knowledge/use-teach.ts ยังไม่มี — ต้องสร้างตาม precedent use-kid-home');
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /export function useTeach/, 'ต้อง export useTeach');
  for (const fn of ['loadOllamaModels', 'loadSavedLessons', 'runTeachGenerate', 'saveGeneratedLesson', 'openSavedLesson', 'pickQuizOption', 'resetQuiz']) {
    assert.match(src, new RegExp(`\\b${fn}\\b`), `hook ต้องมี ${fn}`);
  }
  assert.match(src, /teach\/kids\/\$\{activeKidId\}\/progress/, 'effect บันทึกคะแนนอัตโนมัติ (POST progress) ต้องย้ายมาอยู่ใน hook');
  assert.match(src, /kidRecordedRef/, 'guard กันบันทึกคะแนนซ้ำ (kidRecordedRef) ต้องย้ายมาอยู่ใน hook ด้วย');
});

test('หน้าห้ามมีก้อน teach เดิมค้าง — state/handler/effect ต้องย้ายไป hook หมด', () => {
  const src = readFileSync(PAGE, 'utf8');
  assert.doesNotMatch(src, /useState\('6-8'\)/, 'state teachAge ยังค้างอยู่ในหน้า — ต้องอยู่ใน hook');
  assert.doesNotMatch(src, /teach\/generate/, 'handler สร้างบทเรียน (teach/generate) ยังค้างอยู่ในหน้า');
  assert.doesNotMatch(src, /kidRecordedRef/, 'guard บันทึกคะแนนยังค้างอยู่ในหน้า — ต้องอยู่ใน hook');
  assert.match(src, /import \{ useTeach \}/, 'หน้าต้อง import useTeach');
});

test('hook ต้องคืนค่าครบชุดที่หน้า/panel ใช้ (destructure ชื่อเดิม = JSX props ไม่เปลี่ยน)', () => {
  const src = readFileSync(HOOK, 'utf8');
  const i = src.lastIndexOf('return {');
  assert.ok(i >= 0, 'hook ต้องมี return คืนค่าท้ายฟังก์ชัน');
  const ret = src.slice(i);
  for (const k of [
    'teachTopic', 'setTeachTopic', 'teachAge', 'setTeachAge', 'teachQuizCount', 'setTeachQuizCount',
    'teachModel', 'setTeachModel', 'ollamaModels', 'teaching', 'teachError', 'setTeachError',
    'lesson', 'setLesson', 'lessonUsedKnowledge', 'savedLessons', 'lessonSaving', 'quizAnswers',
    'runTeachGenerate', 'saveGeneratedLesson', 'openSavedLesson', 'pickQuizOption', 'resetQuiz',
  ]) {
    assert.match(ret, new RegExp(`\\b${k}\\b`), `hook ต้องคืน ${k}`);
  }
});
