// tools/test/queue.test.mjs — เทสต์คิวงานของ agent
// ครอบ: parse/serialize front-matter · ลำดับหยิบงาน · claim/done/block · validate · CLI จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  claimTask,
  completeTask,
  eligibleTasks,
  parseTask,
  pickNext,
  readTasks,
  serializeTask,
  validateTasks,
} from '../queue/queue.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'tools', 'queue', 'queue.mjs');

function taskText(overrides = {}, body = 'รายละเอียดงาน') {
  const base = {
    id: 'sample-task',
    title: 'งานตัวอย่าง',
    priority: 2,
    status: 'todo',
    owner: null,
    created: '2026-11-09',
    depends_on: [],
    gate: 'npm run verify',
    tests_first: true,
    scope: ['tools/queue/queue.mjs'],
  };
  const merged = { ...base, ...overrides };
  const lines = ['---'];
  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else lines.push(`${key}:`, ...value.map((v) => `  - ${v}`));
    } else {
      lines.push(`${key}: ${value === null ? 'null' : value}`);
    }
  }
  lines.push('---', '', body, '');
  return lines.join('\n');
}

function fixture(tasks) {
  const root = mkdtempSync(path.join(tmpdir(), 'queue-test-'));
  mkdirSync(path.join(root, 'queue', 'tasks'), { recursive: true });
  for (const [file, text] of Object.entries(tasks)) {
    writeFileSync(path.join(root, 'queue', 'tasks', file), text, 'utf8');
  }
  return root;
}

test('parse + serialize: คงฟิลด์และ body เดิม (round-trip)', () => {
  const text = taskText({ depends_on: ['a-task', 'b-task'], scope: ['x.ts'] }, 'body บรรทัดแรก\n\n- bullet');
  const parsed = parseTask(text, 'C:/tmp/sample.md');

  assert.equal(parsed.id, 'sample-task');
  assert.equal(parsed.priority, 2);
  assert.equal(parsed.tests_first, true);
  assert.equal(parsed.owner, null);
  assert.equal(parsed.gate, 'npm run verify');
  assert.deepEqual(parsed.depends_on, ['a-task', 'b-task']);
  assert.deepEqual(parsed.scope, ['x.ts']);
  assert.match(parsed.body, /bullet/);

  const again = parseTask(serializeTask(parsed));
  assert.equal(again.id, parsed.id);
  assert.deepEqual(again.depends_on, parsed.depends_on);
  assert.deepEqual(again.scope, parsed.scope);
  assert.equal(again.body.trim(), parsed.body.trim());
});

test('parse: ไฟล์ที่ไม่มี front-matter หรือปิดไม่ครบ = throw', () => {
  assert.throws(() => parseTask('# ไม่มี front-matter'), /front-matter/);
  assert.throws(() => parseTask('---\nid: x\n'), /front-matter/);
});

test('pickNext: เรียง priority → created → id และข้ามงานที่ depends_on ยังไม่ปิด', () => {
  const tasks = [
    parseTask(taskText({ id: 'later-p1', priority: 1, depends_on: ['gate-task'] })),
    parseTask(taskText({ id: 'first-p1', priority: 1, created: '2026-01-01' })),
    parseTask(taskText({ id: 'gate-task', priority: 3, status: 'doing' })),
    parseTask(taskText({ id: 'already-done', priority: 1, status: 'done' })),
  ];

  assert.equal(pickNext(tasks).id, 'first-p1');
  assert.deepEqual(
    eligibleTasks(tasks).map((t) => t.id),
    ['first-p1']
  );
});

test('pickNext: ไม่มีงานที่หยิบได้ = null', () => {
  assert.equal(pickNext([parseTask(taskText({ id: 'blocked-one', status: 'blocked' }))]), null);
});

test('claim: ตั้ง doing/owner/claimed และกันหยิบซ้ำหรือหยิบงานที่ปิดแล้ว', () => {
  const tasks = [parseTask(taskText())];
  const claimed = claimTask(tasks, 'sample-task', ' agent-a ', '2026-11-09T10:00:00.000Z');

  assert.equal(claimed.status, 'doing');
  assert.equal(claimed.owner, 'agent-a');
  assert.equal(claimed.claimed, '2026-11-09T10:00:00.000Z');

  assert.throws(() => claimTask(tasks, 'sample-task', 'agent-b'), /todo/);
  assert.throws(() => claimTask(tasks, 'no-such-task', 'agent-a'), /ไม่พบงาน/);
  assert.throws(() => claimTask(tasks, 'sample-task', ' '), /owner/);
});

test('done: ต้องมี report และต่อท้าย body ด้วยหลักฐาน', () => {
  const tasks = [parseTask(taskText())];
  claimTask(tasks, 'sample-task', 'agent-a', '2026-11-09T10:00:00.000Z');

  assert.throws(() => completeTask(tasks, 'sample-task', '   '), /report/);

  const done = completeTask(tasks, 'sample-task', 'gate: npm run verify = 0 · PR #99', '2026-11-09T12:00:00.000Z');
  assert.equal(done.status, 'done');
  assert.equal(done.completed, '2026-11-09T12:00:00.000Z');
  assert.match(done.body, /## Report — 2026-11-09T12:00:00.000Z/);
  assert.match(done.body, /PR #99/);

  assert.throws(() => completeTask(tasks, 'sample-task', 'ซ้ำ'), /doing/);
});

test('validate: จับ id ซ้ำ/สถานะผิด/priority นอกช่วง/gate ว่าง/depends_on ไม่มีจริง/อ้างตัวเอง', () => {
  const good = parseTask(taskText());
  assert.deepEqual(validateTasks([good]), []);

  const dupA = parseTask(taskText({ id: 'same-id' }));
  const dupB = parseTask(taskText({ id: 'same-id' }));
  assert.ok(validateTasks([dupA, dupB]).some((e) => /id ซ้ำ/.test(e)));

  assert.ok(validateTasks([parseTask(taskText({ status: 'in-progress' }))]).some((e) => /status/.test(e)));
  assert.ok(validateTasks([parseTask(taskText({ priority: 9 }))]).some((e) => /priority/.test(e)));
  assert.ok(validateTasks([parseTask(taskText({ gate: '""' }))]).some((e) => /gate/.test(e)));
  assert.ok(
    validateTasks([parseTask(taskText({ depends_on: ['ghost-task'] }))]).some((e) => /ghost-task/.test(e))
  );
  assert.ok(
    validateTasks([parseTask(taskText({ depends_on: ['sample-task'] }))]).some((e) => /ตัวเอง/.test(e))
  );
});

test('CLI จริง: next → claim → done เขียนไฟล์กลับ (อ่านซ้ำจากดิสก์ได้)', () => {
  const root = fixture({
    'sample-task.md': taskText(),
    'second-task.md': taskText({ id: 'second-task', priority: 3, created: '2026-11-10' }),
  });

  try {
    const next = spawnSync(process.execPath, [CLI, 'next', '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).id, 'sample-task');

    const claim = spawnSync(
      process.execPath,
      [CLI, 'claim', 'sample-task', '--owner', 'agent-a', '--root', root],
      { encoding: 'utf8' }
    );
    assert.equal(claim.status, 0, claim.stderr);

    const done = spawnSync(
      process.execPath,
      [CLI, 'done', 'sample-task', '--report', 'gate: npm run verify = 0', '--root', root],
      { encoding: 'utf8' }
    );
    assert.equal(done.status, 0, done.stderr);

    const persisted = readTasks(root).find((t) => t.id === 'sample-task');
    assert.equal(persisted.status, 'done');
    assert.equal(persisted.owner, 'agent-a');
    assert.match(readFileSync(path.join(root, 'queue', 'tasks', 'sample-task.md'), 'utf8'), /## Report/);

    const validate = spawnSync(process.execPath, [CLI, 'validate', '--root', root], { encoding: 'utf8' });
    assert.equal(validate.status, 0, validate.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI จริง: done โดยไม่เคย claim = exit 1 และไม่เขียนไฟล์', () => {
  const root = fixture({ 'sample-task.md': taskText() });
  try {
    const result = spawnSync(process.execPath, [CLI, 'done', 'sample-task', '--report', 'x', '--root', root], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /doing/);
    assert.equal(readTasks(root)[0].status, 'todo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
