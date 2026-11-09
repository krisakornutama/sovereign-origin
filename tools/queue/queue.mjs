#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/queue/queue.mjs — คิวงานที่ agent หยิบไปทำได้ (ไม่มี dependency ภายนอก)
//
// หลักคิด: คิวคือไฟล์ markdown ที่ commit ได้ → ประวัติงาน/เจ้าของ/หลักฐานอยู่ใน git
//          ไม่มีฐานข้อมูล ไม่มีเซิร์ฟเวอร์ ไม่มี daemon
//
// สถานะ: todo → doing → done
//                    ↘ blocked
// กติกา: 1 งานมีเจ้าของได้ทีเดียว · done ต้องมี report · done ต้องผ่าน gate มาก่อน
//
// ใช้:
//   node tools/queue/queue.mjs list [--status todo] [--json]
//   node tools/queue/queue.mjs next [--json]
//   node tools/queue/queue.mjs claim <id> --owner agent-name
//   node tools/queue/queue.mjs done <id> --report "gate: npm run verify = 0 · PR #..."
//   node tools/queue/queue.mjs block <id> --reason "..."
//   node tools/queue/queue.mjs validate
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const STATUSES = ['todo', 'doing', 'done', 'blocked'];
export const REQUIRED_FIELDS = ['id', 'title', 'priority', 'status', 'created', 'gate', 'tests_first'];
const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const FIELD_ORDER = [
  'id',
  'title',
  'priority',
  'status',
  'owner',
  'claimed',
  'completed',
  'created',
  'depends_on',
  'gate',
  'tests_first',
  'scope',
];

function coerceValue(value) {
  const text = value.trim();
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((v) => coerceValue(v))
      .filter((v) => v !== '' && v !== null);
  }
  if (/^"(.*)"$/.test(text) || /^'(.*)'$/.test(text)) return text.slice(1, -1);
  return text;
}

function parseFrontMatter(raw) {
  const fields = {};
  let listKey = null;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      fields[listKey].push(coerceValue(item[1]));
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`front-matter อ่านไม่ได้: "${line}"`);
    const [, key, value] = match;
    if (value.trim() === '') {
      listKey = key;
      fields[key] = [];
    } else {
      listKey = null;
      fields[key] = coerceValue(value);
    }
  }
  return fields;
}

export function parseTask(text, filePath = null) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('ไฟล์งานต้องเริ่มด้วย front-matter (---)');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('front-matter ไม่ถูกปิดด้วย ---');

  const fields = parseFrontMatter(normalized.slice(4, end));
  const body = normalized.slice(end + 5).replace(/^\n+/, '');
  return { ...fields, body, path: filePath };
}

function renderScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  const text = String(value);
  const needsQuotes = text === '' || text.includes(': ') || text.includes('#') || /^[\s\-?*&!|>'"%@`]/.test(text);
  return needsQuotes ? `"${text}"` : text;
}

export function serializeTask(task) {
  const keys = [...FIELD_ORDER.filter((k) => k in task), ...Object.keys(task).filter((k) => !FIELD_ORDER.includes(k) && k !== 'body' && k !== 'path').sort()];
  const lines = ['---'];
  for (const key of keys) {
    const value = task[key];
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${renderScalar(item)}`);
      }
      continue;
    }
    lines.push(`${key}: ${renderScalar(value)}`);
  }
  lines.push('---', '');
  const body = String(task.body ?? '').replace(/\s+$/, '');
  return `${lines.join('\n')}${body ? `\n${body}\n` : ''}`;
}

export function tasksDir(root) {
  return path.join(root, 'queue', 'tasks');
}

export function readTasks(root) {
  const dir = tasksDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      return parseTask(readFileSync(full, 'utf8'), full);
    });
}

export function saveTask(task) {
  if (!task.path) throw new Error('task ไม่มี path — อ่านผ่าน readTasks ก่อน');
  writeFileSync(task.path, serializeTask(task), 'utf8');
}

export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99) || String(a.created ?? '').localeCompare(String(b.created ?? '')) || String(a.id).localeCompare(String(b.id))
  );
}

export function findTask(tasks, id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`ไม่พบงาน id="${id}"`);
  return task;
}

/** งานที่หยิบได้: todo + depends_on ปิดครบ */
export function eligibleTasks(tasks) {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  return sortTasks(
    tasks.filter((t) => t.status === 'todo' && (t.depends_on ?? []).every((dep) => done.has(dep)))
  );
}

export function pickNext(tasks) {
  return eligibleTasks(tasks)[0] ?? null;
}

export function claimTask(tasks, id, owner, now = new Date().toISOString()) {
  const task = findTask(tasks, id);
  if (!owner || !String(owner).trim()) throw new Error('ต้องระบุ --owner');
  if (task.status !== 'todo') throw new Error(`งาน ${id} สถานะ ${task.status} — หยิบได้เฉพาะ todo`);
  if (task.owner) throw new Error(`งาน ${id} ถูก ${task.owner} ถืออยู่แล้ว`);
  task.status = 'doing';
  task.owner = String(owner).trim();
  task.claimed = now;
  return task;
}

export function completeTask(tasks, id, report, now = new Date().toISOString()) {
  const task = findTask(tasks, id);
  if (task.status !== 'doing') throw new Error(`งาน ${id} สถานะ ${task.status} — ปิดได้เฉพาะ doing`);
  const text = String(report ?? '').trim();
  if (!text) throw new Error('ต้องระบุ --report (หลักฐานว่า gate ผ่าน + PR/commit)');
  task.status = 'done';
  task.completed = now;
  task.body = `${String(task.body ?? '').trim()}\n\n## Report — ${now}\n\n${text}\n`.trimEnd();
  return task;
}

export function blockTask(tasks, id, reason, now = new Date().toISOString()) {
  const task = findTask(tasks, id);
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('ต้องระบุ --reason');
  task.status = 'blocked';
  task.blockedAt = now;
  task.blockedReason = text;
  task.body = `${String(task.body ?? '').trim()}\n\n## Blocked — ${now}\n\n${text}\n`.trimEnd();
  return task;
}

export function validateTasks(tasks) {
  const errors = [];
  const ids = new Set();
  for (const task of tasks) {
    const label = task.path ? path.basename(task.path) : String(task.id ?? '(no id)');
    for (const field of REQUIRED_FIELDS) {
      if (!(field in task)) errors.push(`${label}: ขาดฟิลด์ ${field}`);
    }
    if (!ID_RE.test(String(task.id ?? ''))) errors.push(`${label}: id ต้องเป็น a-z0-9- (3-64 ตัว)`);
    if (ids.has(task.id)) errors.push(`${label}: id ซ้ำ (${task.id})`);
    ids.add(task.id);
    if (!STATUSES.includes(task.status)) errors.push(`${label}: status ต้องเป็น ${STATUSES.join('/')}`);
    if (!Number.isInteger(task.priority) || task.priority < 1 || task.priority > 5) {
      errors.push(`${label}: priority ต้องเป็นจำนวนเต็ม 1-5`);
    }
    if (typeof task.gate !== 'string' || task.gate.trim() === '') errors.push(`${label}: gate ต้องไม่ว่าง`);
    if (typeof task.tests_first !== 'boolean') errors.push(`${label}: tests_first ต้องเป็น true/false`);
    if (task.depends_on !== undefined && !Array.isArray(task.depends_on)) errors.push(`${label}: depends_on ต้องเป็น list`);
    if (task.scope !== undefined && !Array.isArray(task.scope)) errors.push(`${label}: scope ต้องเป็น list`);
  }
  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      if (dep === task.id) errors.push(`${task.id}: depends_on ตัวเองไม่ได้`);
      else if (!ids.has(dep)) errors.push(`${task.id}: depends_on "${dep}" ไม่มีในคิว`);
    }
  }
  return errors;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return { command, flags, positional };
}

function printTask(task) {
  return `${task.id}  p${task.priority}  ${task.status}${task.owner ? `  @${task.owner}` : ''}  — ${task.title}`;
}

function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));
  const root = path.resolve(flags.root ?? process.cwd());
  const tasks = readTasks(root);

  switch (command) {
    case 'list': {
      const filtered = flags.status ? tasks.filter((t) => t.status === flags.status) : tasks;
      if (flags.json === 'true') process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
      else if (filtered.length === 0) process.stdout.write('(ไม่มีงาน)\n');
      else process.stdout.write(`${sortTasks(filtered).map(printTask).join('\n')}\n`);
      return;
    }
    case 'next': {
      const task = pickNext(tasks);
      if (!task) {
        process.stdout.write('(ไม่มีงานที่หยิบได้ — todo ที่ depends_on ปิดครบ)\n');
        return;
      }
      process.stdout.write(flags.json === 'true' ? `${JSON.stringify(task, null, 2)}\n` : `${printTask(task)}\n`);
      return;
    }
    case 'claim': {
      const id = positional[0];
      if (!id) throw new Error('ต้องระบุ id: queue.mjs claim <id> --owner <name>');
      const task = claimTask(tasks, id, flags.owner);
      saveTask(task);
      process.stdout.write(`✓ ${printTask(task)}\n`);
      return;
    }
    case 'done': {
      const id = positional[0];
      if (!id) throw new Error('ต้องระบุ id: queue.mjs done <id> --report "..."');
      const task = completeTask(tasks, id, flags.report);
      saveTask(task);
      process.stdout.write(`✓ ปิดงาน ${task.id} (${task.completed})\n`);
      return;
    }
    case 'block': {
      const id = positional[0];
      if (!id) throw new Error('ต้องระบุ id: queue.mjs block <id> --reason "..."');
      const task = blockTask(tasks, id, flags.reason);
      saveTask(task);
      process.stdout.write(`✓ บล็อกงาน ${task.id}\n`);
      return;
    }
    case 'validate': {
      const errors = validateTasks(tasks);
      if (errors.length === 0) {
        process.stdout.write(`✓ คิวถูกต้อง ${tasks.length} งาน\n`);
        return;
      }
      process.stderr.write(`✗ พบคิวผิด ${errors.length} จุด:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    case 'new': {
      const dir = tasksDir(root);
      mkdirSync(dir, { recursive: true });
      process.stdout.write(`template → ${path.relative(root, path.join(dir, '<id>.md'))}\n`);
      return;
    }
    default:
      process.stdout.write(
        [
          'queue — คิวงานของ agent',
          '',
          '  list [--status todo|doing|done|blocked] [--json]',
          '  next [--json]',
          '  claim <id> --owner <name>',
          '  done <id> --report "gate: ..."',
          '  block <id> --reason "..."',
          '  validate',
          '',
          '  --root <path>  (ค่าเริ่มต้น = cwd)',
          '',
        ].join('\n')
      );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
const invokedDirectly = invokedPath !== '' && invokedPath === import.meta.url;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
