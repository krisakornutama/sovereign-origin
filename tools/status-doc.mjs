#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// status-doc.mjs — สร้าง STATUS.md สั้น ๆ จาก "ข้อมูลจริง" ที่ระบบเขียนอยู่แล้ว
//
// ปัญหาเดิม: STATUS.md เป็น journal 460 บรรทัด/372 KB (บันทึกถึง 22/10/69)
// เปิดมาดู "ตอนนี้ระบบเป็นยังไง" ไม่ได้ ต้องอ่านประวัติทั้งก้อน
//
// แหล่งข้อมูล (อ่านอย่างเดียว — ไม่คำนวณซ้ำ ไม่ยิงเน็ต ไม่แตะ DB):
//   sovereign-os/core-api/data/system-truth.json   ← ผล npm run verify ล่าสุด
//   logs/nightly/status.json                        ← ผล nightly รอบล่าสุด
//   sovereign-os/core-api/data/ops-status.json      ← task scheduler + เครื่อง
//   sovereign-os/core-api/data/nightly-history.json ← แนวโน้ม 30 วัน
//
// ใช้:
//   node tools/status-doc.mjs --check     # ค่าดีฟอลต์: อ่านเท่านั้น · ไฟล์เก่า/หาย = exit 1
//   node tools/status-doc.mjs --write     # เขียน STATUS.md
//   node tools/status-doc.mjs --print     # พิมพ์ที่หน้าจอ
//   ... --out=<path> --root=<dir> --generated-at=<iso> --quiet
//
// หลักการ: --check ใช้ "สร้างเมื่อ" ที่อยู่ในไฟล์เดิมเป็นฐาน → เวลาผ่านไปเฉย ๆ
// ไม่ทำให้ไฟล์ถูกหาว่าเก่า · เก่าเมื่อ "ข้อมูลจริง" เปลี่ยนเท่านั้น
// ────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const REPO = join(SELF, '..', '..');

export const STATUS_PATH = 'STATUS.md';
export const ARCHIVE_PATH = 'docs/history/status-journal-2026-10.md';

/** ไฟล์ต้นทางทั้งหมด — path สัมพันธ์กับ root ของรีโป */
export const SOURCES = {
  truth: 'sovereign-os/core-api/data/system-truth.json',
  nightly: 'logs/nightly/status.json',
  ops: 'sovereign-os/core-api/data/ops-status.json',
  history: 'sovereign-os/core-api/data/nightly-history.json',
};

const MISSING = '— ยังไม่มีข้อมูล';

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** อ่านข้อมูลจริงทั้ง 4 ไฟล์ — ไฟล์หาย/JSON เสีย = null (ไม่ throw) */
export function buildState(root = REPO) {
  return {
    truth: readJson(join(root, SOURCES.truth)),
    nightly: readJson(join(root, SOURCES.nightly)),
    ops: readJson(join(root, SOURCES.ops)),
    history: readJson(join(root, SOURCES.history)),
  };
}

/** เวลาไทย (UTC+7 คงที่ ไม่มี DST) → 'YYYY-MM-DD HH:mm' */
export function fmtBkk(value) {
  const d = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(d.getTime())) return '—';
  const iso = new Date(d.getTime() + 7 * 3_600_000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const arr = (value) => (Array.isArray(value) ? value : []);
const icon = (value) => (value === true ? '✅' : value === false ? '❌' : '—');
const gb = (value) => (Number.isFinite(Number(value)) ? `${Number(value)} GB` : '—');

function gateFacts(truth) {
  if (!truth || typeof truth !== 'object') return null;
  const steps = arr(truth.steps).filter((s) => s && typeof s === 'object');
  return {
    ok: truth.ok === true,
    steps,
    total: steps.length,
    passed: steps.filter((s) => s.ok === true && !s.skipped).length,
    at: truth.writtenAt,
  };
}

function nightlyFacts(nightly) {
  if (!nightly || typeof nightly !== 'object') return null;
  const extras = arr(nightly.failedExtras).map(String);
  const failedSteps = arr(nightly.steps).filter((s) => s?.ok === false).map((s) => String(s.name));
  const gaps = arr(nightly.historyGaps).map(String);
  return {
    ok: nightly.ok === true && extras.length === 0,
    extras,
    failed: [...failedSteps, ...extras],
    gaps,
    steps: arr(nightly.steps),
    skipped: arr(nightly.skipped),
    at: nightly.finishedAt,
    durationMin: nightly.durationMin,
    lastGateOk: nightly.lastGateOk ?? null,
    codeMatch: nightly.codeMatch ?? null,
    migrationHead: nightly.migrationHead ?? '',
    consentSmoke: nightly.consentSmoke ?? null,
  };
}

function machineFacts(state) {
  const ops = state.ops && typeof state.ops === 'object' ? state.ops.machine : null;
  if (ops && typeof ops === 'object') {
    const info = ops.info && typeof ops.info === 'object' ? ops.info : {};
    return {
      ok: ops.ok ?? null,
      problems: arr(ops.problems),
      ramFreeGB: info.ramFreeGB ?? null,
      diskFreeGB: info.diskFreeGB ?? null,
      at: state.ops?.checkedAt,
    };
  }
  const n = state.nightly?.machine;
  if (n && typeof n === 'object') {
    return {
      ok: n.ok ?? null,
      problems: arr(n.problems),
      ramFreeGB: n.ramFreeGB ?? null,
      diskFreeGB: n.diskFreeGB ?? null,
      at: state.nightly?.finishedAt,
    };
  }
  return null;
}

function taskFacts(state) {
  const tasks = state.ops && typeof state.ops === 'object' ? state.ops.tasks : null;
  if (!Array.isArray(tasks)) return null;
  return {
    tasks: tasks.filter((t) => t && typeof t === 'object'),
    at: state.ops?.checkedAt,
  };
}

function summaryLines({ gate, nightly, machine, tasks }) {
  const lines = [];

  if (!gate) lines.push(`- Quality gate: ${MISSING}`);
  else if (gate.ok) lines.push(`- Quality gate: ✅ ผ่าน ${gate.passed}/${gate.total} — ${fmtBkk(gate.at)}`);
  else lines.push(`- Quality gate: ❌ ไม่ผ่าน (${gate.passed}/${gate.total}) — ${fmtBkk(gate.at)}`);

  if (!nightly) lines.push(`- Nightly: ${MISSING}`);
  else {
    const detail = nightly.failed.length ? ` — ${nightly.failed.join(', ')}` : '';
    lines.push(`- Nightly: ${nightly.ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}${detail} — ${fmtBkk(nightly.at)}`);
  }

  if (!nightly) lines.push(`- ประวัติ nightly: ${MISSING}`);
  else if (nightly.gaps.length) {
    lines.push(`- ประวัติ nightly: ⚠️ ขาด ${nightly.gaps.length} วัน — ${nightly.gaps.join(', ')}`);
  } else lines.push('- ประวัติ nightly: ✅ ครบ 7 วัน');

  if (!machine) lines.push(`- เครื่อง: ${MISSING}`);
  else if (machine.ok === false) {
    lines.push(`- เครื่อง: ❌ มีปัญหา ${machine.problems.length} ข้อ${machine.problems.length ? ` — ${machine.problems.map((p) => p?.message ?? p).join(' · ')}` : ''}`);
  } else if (machine.ok === true) {
    lines.push(`- เครื่อง: ✅ ปกติ — แรมว่าง ${gb(machine.ramFreeGB)} · ดิสก์ว่าง ${gb(machine.diskFreeGB)}`);
  } else lines.push(`- เครื่อง: — ไม่ทราบสถานะ — แรมว่าง ${gb(machine.ramFreeGB)} · ดิสก์ว่าง ${gb(machine.diskFreeGB)}`);

  if (!tasks) lines.push(`- Task scheduler: ${MISSING}`);
  else {
    const failed = tasks.tasks.filter((t) => t.result?.ok === false);
    if (failed.length) {
      lines.push(`- Task scheduler: ❌ ล้ม ${failed.length} งาน — ${failed.map((t) => t.label || t.name).join(', ')}`);
    } else lines.push(`- Task scheduler: ✅ ปกติ (${tasks.tasks.length} งาน)`);
  }

  return lines;
}

function gateSection(gate) {
  const out = ['## Quality gate — `npm run verify`', ''];
  if (!gate) {
    out.push(`${MISSING} — ยังไม่เคยรันหรือไฟล์ \`${SOURCES.truth}\` หาย`, '');
    return out;
  }
  out.push(`ผลล่าสุด: ${icon(gate.ok)} ${gate.ok ? 'ผ่าน' : 'ไม่ผ่าน'} · ${gate.passed}/${gate.total} ขั้น · ${fmtBkk(gate.at)}`, '');
  if (!gate.total) {
    out.push('ยังไม่มีรายการขั้น (results ว่าง — ไม่ถือว่าผ่าน)', '');
    return out;
  }
  out.push('| ขั้น | ผล |', '| --- | --- |');
  for (const s of gate.steps) {
    const mark = s.skipped ? '⏭ ข้าม' : s.ok === true ? '✅' : '❌';
    out.push(`| ${s.name ?? '—'} | ${mark} |`);
  }
  out.push('');
  return out;
}

function nightlySection(nightly) {
  const out = ['## Nightly — รอบล่าสุด', ''];
  if (!nightly) {
    out.push(`${MISSING} — ยังไม่เคยรัน nightly หรือไฟล์ \`${SOURCES.nightly}\` หาย`, '');
    return out;
  }
  out.push(`- ผล: ${nightly.ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}${Number.isFinite(Number(nightly.durationMin)) ? ` (${nightly.durationMin} นาที)` : ''}`);
  out.push(`- เวลา: ${fmtBkk(nightly.at)}`);
  out.push(`- เกตในรอบนั้น: ${icon(nightly.lastGateOk)} · โค้ดตรงกับ dist: ${icon(nightly.codeMatch)}`);
  if (nightly.migrationHead) out.push(`- migration head: \`${nightly.migrationHead}\``);
  if (nightly.extras.length) out.push(`- ขั้นเสริมที่ล้ม: ${nightly.extras.join(', ')}`);
  if (nightly.consentSmoke) {
    out.push(`- consent smoke: ${nightly.consentSmoke.skipped ? '⏭ ข้าม' : icon(nightly.consentSmoke.ok)} ${nightly.consentSmoke.last ?? ''}`.trim());
  }
  if (nightly.gaps.length) out.push(`- ประวัติ nightly ขาด: ${nightly.gaps.join(', ')}`);
  if (nightly.skipped.length) {
    out.push(`- ขั้นที่ข้าม: ${nightly.skipped.map((s) => s?.name ?? s).filter(Boolean).join(', ')}`);
  }
  out.push('');
  return out;
}

function historySection(history) {
  const out = ['## ประวัติ nightly — 7 วันล่าสุด', ''];
  const list = arr(history).filter((e) => e && typeof e.day === 'string');
  if (!list.length) {
    out.push(`${MISSING} — \`${SOURCES.history}\` ยังไม่มีหรือเสีย`, '');
    return out;
  }
  const recent = list.slice(-7);
  out.push('| วัน | ผล | นาที |', '| --- | --- | --- |');
  for (const e of recent) {
    out.push(`| ${e.day} | ${icon(e.ok)} | ${Number.isFinite(Number(e.durationMin)) ? e.durationMin : '—'} |`);
  }
  out.push('');
  return out;
}

function machineSection(machine) {
  const out = ['## เครื่อง', ''];
  if (!machine) {
    out.push(`${MISSING} — ต้องมี \`${SOURCES.nightly}\` หรือ \`${SOURCES.ops}\``, '');
    return out;
  }
  out.push(`- สถานะ: ${icon(machine.ok)} ${machine.ok === true ? 'ปกติ' : machine.ok === false ? 'มีปัญหา' : 'ไม่ทราบ'}`);
  out.push(`- แรมว่าง: ${gb(machine.ramFreeGB)} · ดิสก์ว่าง: ${gb(machine.diskFreeGB)}`);
  out.push(`- วัดเมื่อ: ${fmtBkk(machine.at)}`);
  out.push('- ปัญหา: ' + (machine.problems.length ? machine.problems.map((p) => p?.message ?? p).join(' · ') : '—'));
  out.push('');
  return out;
}

function taskSection(tasks) {
  const out = ['## Task scheduler', ''];
  if (!tasks) {
    out.push(`${MISSING} — รัน \`node tools/ops-status.mjs --snapshot\` เพื่อสร้าง \`${SOURCES.ops}\``, '');
    return out;
  }
  if (!tasks.tasks.length) {
    out.push('ยังไม่มีรายการ task ใน snapshot', '');
    return out;
  }
  out.push('| งาน | ล่าสุด | ผล |', '| --- | --- | --- |');
  for (const t of tasks.tasks) {
    out.push(`| ${t.label || t.name || '—'} | ${t.lastRun ?? '—'} | ${icon(t.result?.ok)} ${t.result?.text ?? ''} |`.trimEnd());
  }
  out.push('');
  return out;
}

function watchSection(state) {
  const watch = arr(state.ops?.watch).map(String);
  if (!watch.length) return [];
  return [`## ต้องดู (${watch.length})`, '', ...watch.map((w) => `- ${w}`), ''];
}

function sourcesSection({ gate, nightly, machine, tasks, history }) {
  const rows = [
    ['Quality gate', gate ? fmtBkk(gate.at) : '—', SOURCES.truth],
    ['Nightly', nightly ? fmtBkk(nightly.at) : '—', SOURCES.nightly],
    ['เครื่อง / task', machine || tasks ? fmtBkk(tasks?.at ?? machine?.at) : '—', SOURCES.ops],
    ['ประวัติ nightly', arr(history).length ? String(arr(history).at(-1)?.day ?? '—') : '—', SOURCES.history],
  ];
  return [
    '## ที่มา',
    '',
    '| ข้อมูล | เวลา | ไฟล์ |',
    '| --- | --- | --- |',
    ...rows.map(([name, at, file]) => `| ${name} | ${at} | \`${file}\` |`),
    '',
  ];
}

/**
 * ประกอบ STATUS.md — pure function (ไม่แตะไฟล์/เวลา ถ้าไม่ส่ง generatedAt)
 * @param {{truth?: object|null, nightly?: object|null, ops?: object|null, history?: array|null}} state
 */
export function renderStatus(state = {}, { generatedAt = new Date().toISOString(), archivePath = ARCHIVE_PATH } = {}) {
  const gate = gateFacts(state.truth);
  const nightly = nightlyFacts(state.nightly);
  const machine = machineFacts(state);
  const tasks = taskFacts(state);
  const history = Array.isArray(state.history) ? state.history : [];

  return [
    '# STATUS — สถานะปัจจุบัน',
    '',
    '> ไฟล์นี้สร้างโดย `node tools/status-doc.mjs --write` — **ห้ามแก้มือ** (แก้ที่ข้อมูลต้นทางแล้ว gen ใหม่)',
    `> สร้างเมื่อ: ${generatedAt}`,
    `> ประวัติงานย้อนหลัง: [${archivePath}](${archivePath})`,
    '> คิวงาน / สิ่งที่ต้องทำต่อ: [QUEUE.md](QUEUE.md)',
    '',
    '## สรุป',
    ...summaryLines({ gate, nightly, machine, tasks }),
    '',
    ...gateSection(gate),
    ...nightlySection(nightly),
    ...historySection(history),
    ...machineSection(machine),
    ...taskSection(tasks),
    ...watchSection(state),
    ...sourcesSection({ gate, nightly, machine, tasks, history }),
    '---',
    '_snapshot นี้ไม่ใช่ real-time — ตัวเลขสดอยู่ที่หน้า `/system-health` · อัปเดตด้วย `node tools/status-doc.mjs --write`_',
    '',
  ].join('\n');
}

/** อ่าน "สร้างเมื่อ" จาก STATUS.md เดิม (คืน '' ถ้าไม่มี) */
export function readGeneratedAt(markdown) {
  const m = String(markdown ?? '').match(/^> สร้างเมื่อ:\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

const normalize = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '\n');

/**
 * เทียบไฟล์จริงกับข้อมูลจริง — อ่านเท่านั้น
 * @returns {{ok:boolean, reason:'ok'|'missing'|'stale', expected:string, generatedAt:string}}
 */
export function checkStatusDoc(state, actualText, { generatedAt = '' } = {}) {
  const actual = String(actualText ?? '');
  if (!actual.trim()) {
    return { ok: false, reason: 'missing', expected: '', generatedAt: '' };
  }
  const at = generatedAt || readGeneratedAt(actual) || new Date().toISOString();
  const expected = renderStatus(state, { generatedAt: at });
  return {
    ok: normalize(actual) === normalize(expected),
    reason: normalize(actual) === normalize(expected) ? 'ok' : 'stale',
    expected,
    generatedAt: at,
  };
}

function parseArgs(argv = []) {
  const out = { mode: '', out: '', root: REPO, generatedAt: '', quiet: false, unknown: [] };
  for (const a of argv) {
    if (a === '--write') out.mode = 'write';
    else if (a === '--check') out.mode = 'check';
    else if (a === '--print') out.mode = 'print';
    else if (a === '--quiet') out.quiet = true;
    else if (a.startsWith('--out=')) out.out = a.slice(6).trim();
    else if (a.startsWith('--root=')) out.root = a.slice(7).trim() || REPO;
    else if (a.startsWith('--generated-at=')) out.generatedAt = a.slice(15).trim();
    else if (a === '--help' || a === '-h') out.mode = 'help';
    else out.unknown.push(a);
  }
  if (!out.mode) out.mode = 'check';
  return out;
}

const USAGE = [
  'ใช้: node tools/status-doc.mjs --check | --write | --print',
  '     [--out=<path>] [--root=<dir>] [--generated-at=<iso>] [--quiet]',
  '',
  '  --check  (ค่าดีฟอลต์) อ่านเท่านั้น · ไฟล์หาย/ข้อมูลเปลี่ยน = exit 1',
  '  --write  เขียน STATUS.md จากข้อมูลจริง',
  '  --print  พิมพ์ markdown ที่จะเขียนออกหน้าจอ',
].join('\n');

function main(argv) {
  const args = parseArgs(argv);
  if (args.unknown.length) {
    console.error(`ไม่รู้จักธง: ${args.unknown.join(', ')}\n${USAGE}`);
    return 2;
  }
  if (args.mode === 'help') {
    console.log(USAGE);
    return 0;
  }

  const state = buildState(args.root);
  const outPath = args.out ? (args.out.match(/^[A-Za-z]:|^[\\/]/) ? args.out : join(args.root, args.out)) : join(args.root, STATUS_PATH);
  const label = args.out || STATUS_PATH;

  if (args.mode === 'print') {
    process.stdout.write(renderStatus(state, { generatedAt: args.generatedAt || new Date().toISOString() }));
    return 0;
  }

  if (args.mode === 'write') {
    const text = renderStatus(state, { generatedAt: args.generatedAt || new Date().toISOString() });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, 'utf8');
    if (!args.quiet) console.log(`เขียน ${label} แล้ว (${text.split('\n').length - 1} บรรทัด)`);
    return 0;
  }

  const actual = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  const result = checkStatusDoc(state, actual, { generatedAt: args.generatedAt });
  if (result.reason === 'missing') {
    if (!args.quiet) console.error(`ยังไม่มี ${label} — รัน \`node tools/status-doc.mjs --write\` เพื่อสร้าง`);
    return 1;
  }
  if (result.reason === 'stale') {
    if (!args.quiet) console.error(`${label} เก่า — ข้อมูลจริงเปลี่ยนแล้ว · รัน \`node tools/status-doc.mjs --write\` เพื่ออัปเดต`);
    return 1;
  }
  if (!args.quiet) console.log(`${label} ตรงกับข้อมูลจริง (สร้างเมื่อ ${result.generatedAt})`);
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SELF).href;
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error('status-doc error:', err instanceof Error ? err.stack : String(err));
    process.exitCode = 2;
  }
}
