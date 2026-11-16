#!/usr/bin/env node
// preflight — รัน "ด่านหลัก" ในเครื่องให้เทียบเท่า CI ก่อน push
//
// ทำไมต้องมี: 16/11/69 ผม push ขึ้น main แล้วเจอ `audit` แดงเพราะคำไทยในคิว
// (และเคยเจอวินาทีที่ต้องรอ CI ทั้งชุด) — ด่านที่รันในเครื่องได้ในหลักวินาที
// ไม่ควรถูกค้นพบครั้งแรกบน GitHub หลัง push ไปแล้ว
//
// ลำดับขั้น (เหมือน CI เท่าที่รันในเครื่องได้):
//   1. copy      — portfolio/scripts/check-copy.mjs (คำไทย/มาร์กอัป ใน docs + หน้าโชว์)
//   2. secrets    — สแกนคีย์ใน diff แบบ "นับอย่างเดียว" (ไม่พิมพ์ค่าลง log/terminal)
//   3. arch-gate  — tools/arch-gate.mjs
//   4. frontend-gate — tools/frontend-gate.mjs
//   5. host-smoke — tools/host-smoke.mjs (READ-ONLY)
//   6. promote-web --check — chunk 404 บน prod (ข้ามอัตโนมัติถ้า prod ไม่ตอบ)
//
// ใช้:
//   node tools/preflight.mjs                 # ทั้งหมด (range = origin/main..HEAD ถ้ามี)
//   node tools/preflight.mjs --only copy,secrets
//   node tools/preflight.mjs --skip frontend-gate
//   node tools/preflight.mjs --range origin/main..HEAD
//   node tools/preflight.mjs --no-prod       # ไม่แตะ prod เลย
//   node tools/preflight.mjs --quiet
//
// exit code เดียว: 0 = ผ่านทุกขั้น · 1 = มีขั้นล้ม · 2 = ใช้คำสั่งผิด
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** pattern ความลับ — "นับอย่างเดียว" ห้ามพิมพ์ค่าที่ match */
export const SECRET_PATTERNS = {
  stripe_live: /sk_live_[A-Za-z0-9]{20,}/g,
  stripe_test: /sk_test_[A-Za-z0-9]{20,}/g,
  github_pat: /ghp_[A-Za-z0-9]{30,}/g,
  slack_bot: /xoxb-[A-Za-z0-9-]{20,}/g,
  aws_key_id: /AKIA[0-9A-Z]{16}/g,
  private_key: /BEGIN [A-Z ]*PRIVATE KEY/g,
};

/** นับจำนวนที่เจอต่อชนิด (ไม่คืนค่า ไม่คืนตำแหน่ง) */
export function countSecrets(text) {
  const out = {};
  for (const [name, re] of Object.entries(SECRET_PATTERNS)) {
    const m = String(text).match(re);
    out[name] = m ? m.length : 0;
  }
  return out;
}

export function totalSecrets(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** สรุปผลแบบปลอดภัย: มีแต่ชื่อชนิดกับจำนวน ไม่มีค่าคีย์ */
export function formatSecretReport(counts) {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}=${n}`);
  return parts.length ? parts.join(' ') : 'ไม่พบ';
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error,
  };
}

/**
 * นับความลับใน "บรรทัดที่เพิ่มเข้ามา" ของ diff (ขึ้นต้นด้วย + แต่ไม่ใช่ +++) เท่านั้น
 * — บรรทัดที่ถูกลบไม่ควรทำให้ gate ล้ม (คีย์ถูกลบออกไปแล้ว) แต่ยังเห็นใน log ของ commit นั้น
 * ทำไมต้องเป็น line-based: pattern อย่าง private_key ถูกแบ่งได้ถ้าอ่านทีละ chunk
 */
export function countSecretsInDiffText(text) {
  const counts = Object.fromEntries(Object.keys(SECRET_PATTERNS).map((k) => [k, 0]));
  for (const rawLine of String(text).split('\n')) {
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
    for (const [name, re] of Object.entries(SECRET_PATTERNS)) {
      const m = rawLine.match(re);
      if (m) counts[name] += m.length;
    }
  }
  return counts;
}

/**
 * นับความลับใน git log แบบ stream — จำเป็นเพราะ `git log -p HEAD` ทั้ง repo ใหญ่เกิน
 * maxBuffer ของ spawnSync (เจอจริง 16/11/69: 124 MB → ENOBUFS → อ่าน range ไม่ได้)
 */
export function countSecretsInGitLog(range, { cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', ['log', '-p', '--no-color', range], { cwd });
    const counts = Object.fromEntries(Object.keys(SECRET_PATTERNS).map((k) => [k, 0]));
    let pending = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const buf = pending + chunk;
      const lines = buf.split('\n');
      pending = lines.pop() ?? ''; // เก็บบรรทัดที่ยังไม่จบไว้รอ chunk ถัดไป
      const part = countSecretsInDiffText(lines.join('\n'));
      for (const [k, n] of Object.entries(part)) counts[k] += n;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => resolve({ counts, code: 1, error: e.message }));
    child.on('close', (code) => {
      if (pending) {
        const part = countSecretsInDiffText(pending);
        for (const [k, n] of Object.entries(part)) counts[k] += n;
      }
      resolve({ counts, code: code ?? 1, error: stderr.trim().slice(0, 200) });
    });
  });
}

/** สเต็ปทั้งหมด — แต่ละตัวคืน { ok, note } */
export function buildSteps(range, { prod = true } = {}) {
  return [
    {
      name: 'copy',
      async run() {
        const r = run(process.execPath, ['scripts/check-copy.mjs'], { cwd: path.join(ROOT, 'portfolio') });
        const line = (r.stdout + r.stderr)
          .split('\n')
          .filter((l) => l.trim())
          .slice(-1)[0];
        return { ok: r.code === 0, note: line || '' };
      },
    },
    {
      name: 'secrets',
      async run() {
        const g = await countSecretsInGitLog(range);
        if (g.code !== 0) return { ok: false, note: `อ่าน git range ไม่ได้: ${g.error || `git exit ${g.code}`}` };
        const total = totalSecrets(g.counts);
        return { ok: total === 0, note: formatSecretReport(g.counts) };
      },
    },
    {
      name: 'arch-gate',
      async run() {
        const r = run(process.execPath, ['tools/arch-gate.mjs']);
        return { ok: r.code === 0, note: lastLine(r) };
      },
    },
    {
      name: 'frontend-gate',
      async run() {
        const r = run(process.execPath, ['tools/frontend-gate.mjs']);
        return { ok: r.code === 0, note: lastLine(r) };
      },
    },
    {
      name: 'host-smoke',
      async run() {
        const r = run(process.execPath, ['tools/host-smoke.mjs']);
        return { ok: r.code === 0, note: lastLine(r) };
      },
    },
    {
      name: 'promote-web',
      async run() {
        if (!prod) return { ok: true, skipped: 'ข้ามตาม --no-prod' };
        const r = run(process.execPath, ['tools/promote-web.mjs', '--check']);
        // เครื่องที่ไม่มี prod รันอยู่ = ข้าม (ไม่ใช่ความล้มเหลวของโค้ด)
        if (/ตรวจไม่สำเร็จ/.test(r.stderr) || /fetch failed|ECONNREFUSED/i.test(r.stderr)) {
          return { ok: true, skipped: 'prod ไม่ตอบ — ข้ามขั้นนี้' };
        }
        return { ok: r.code === 0, note: lastLine(r) };
      },
    },
  ];
}

function lastLine(r) {
  const all = (r.stdout + '\n' + r.stderr)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return all.slice(-1)[0] || '';
}

function parseArgs(argv) {
  const opts = { only: null, skip: [], range: null, prod: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip') opts.skip = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--range') opts.range = String(argv[++i] || '');
    else if (a === '--no-prod') opts.prod = false;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else return { error: `ไม่รู้จัก argument: ${a}` };
  }
  return opts;
}

function defaultRange() {
  const has = run('git', ['rev-parse', '--verify', '--quiet', 'origin/main']);
  if (has.code === 0) return 'origin/main..HEAD';
  return 'HEAD';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`✗ ${opts.error}`);
    console.error('ใช้: node tools/preflight.mjs [--only a,b] [--skip a,b] [--range X..Y] [--no-prod] [--quiet]');
    process.exit(2);
  }
  if (opts.help) {
    console.log('ใช้: node tools/preflight.mjs [--only a,b] [--skip a,b] [--range X..Y] [--no-prod] [--quiet]');
    process.exit(0);
  }

  const range = opts.range || defaultRange();
  let steps = buildSteps(range, { prod: opts.prod });
  if (opts.only) steps = steps.filter((s) => opts.only.includes(s.name));
  if (opts.skip.length) steps = steps.filter((s) => !opts.skip.includes(s.name));
  if (steps.length === 0) {
    console.error('✗ ไม่มีขั้นให้รัน (ตรวจ --only/--skip)');
    process.exit(2);
  }

  if (!opts.quiet) console.log(`▶ preflight (range ${range}) — ${steps.length} ขั้น\n`);

  const results = [];
  const started = Date.now();
  for (const step of steps) {
    const t0 = Date.now();
    let r;
    try {
      r = await step.run();
    } catch (e) {
      r = { ok: false, note: e?.message || String(e) };
    }
    const ms = Date.now() - t0;
    results.push({ name: step.name, ...r, ms });
    if (!opts.quiet) {
      const mark = r.skipped ? '○' : r.ok ? '✅' : '✗';
      console.log(`${mark} ${step.name} (${ms}ms)${r.note ? ` — ${r.note}` : ''}${r.skipped ? ` — ${r.skipped}` : ''}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  const totalMs = Date.now() - started;
  if (!opts.quiet) {
    console.log(
      `\nผลรวม: ${results.length - failed.length - skipped.length}/${results.length - skipped.length} ผ่าน` +
        `${skipped.length ? ` · ข้าม ${skipped.length}` : ''} · ${totalMs}ms`,
    );
    if (failed.length) console.log(`ขั้นที่ล้ม: ${failed.map((f) => f.name).join(', ')}`);
  }
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error('✗ preflight ล้มไม่คาดคิด:', e?.message || e);
    process.exit(1);
  });
}
