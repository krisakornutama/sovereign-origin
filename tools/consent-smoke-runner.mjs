#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// consent-smoke-runner.mjs — ทางเดียวที่ปลอดภัยในการรัน consent smoke อัตโนมัติ
//
// ปัญหาเดิม: `sovereign-os/core-api/tools/consent-smoke.mjs` สร้าง/ลบบัญชีจริง
// และค่าเริ่มต้นยิงใส่ http://localhost:3001 (= production) ⇒ ต้องสั่งมือเท่านั้น
// และถ้าสั่งผิดเครื่อง/ผิด DB ก็เขียนลงข้อมูลจริงทันที
//
// แยกเป็น 2 โหมด:
//   --check  (ค่าดีฟอลต์ · nightly ใช้โหมดนี้) อ่านเท่านั้น ไม่แตะ DB:
//            · GET /api/consent/policy = 200 + เวอร์ชัน ISO + หัวข้อ PDPA ครบ
//            · GET /api/consent และ /api/consent/history = 401 เมื่อไม่ส่ง token
//            · เตือน (ไม่ทำให้แดง): เวอร์ชัน runtime ต่างจากโค้ด · ผู้ควบคุมข้อมูลยังว่าง
//   --full   เขียนจริง (สร้างบัญชีชั่วคราว → ยิง API → ลบ) ต้องครบทุกข้อ:
//            · --env=test                        ประกาศว่าเป็นสภาพแวดล้อมทดสอบ
//            · --hub ไม่ใช่ production :3001
//            · --scratch-db=<url>?schema=<ชื่อที่ไม่ใช่ public>
//            · ต้องไม่ใช่ DATABASE_URL ของโปรเจกต์ (--prod-db ไว้เทียบ)
//
// ใช้:
//   node tools/consent-smoke-runner.mjs --check [--hub=http://127.0.0.1:3001] [--json]
//   node tools/consent-smoke-runner.mjs --full --env=test --hub=http://127.0.0.1:3101 \
//        --scratch-db='postgresql://.../sovereign_smoke?schema=smoke_abc' [--prod-db='...']
//
// exit: 0 ผ่าน · 1 ตรวจไม่ผ่าน · 2 ปฏิเสธการรัน (สภาพแวดล้อมไม่ปลอดภัย/ใช้ผิด)
// ────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const REPO = join(SELF, '..', '..');
export const CORE_API = join(REPO, 'sovereign-os', 'core-api');
export const SMOKE_SCRIPT = join(CORE_API, 'tools', 'consent-smoke.mjs');
export const DEFAULT_HUB = 'http://127.0.0.1:3001';

// production = loopback :3001 (เส้นที่ cloudflared → :3000 → rewrite → :3001 ใช้)
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const PROD_PORTS = new Set(['3001']);

// หัวข้อบังคับของนโยบาย (PDPA) — ต้องมีครบก่อนให้คนนอกอ่าน/ยอมรับ
export const REQUIRED_SECTIONS = ['who', 'data', 'purpose', 'rights', 'changes', 'contact'];

export function parseArgs(argv = []) {
  const out = { mode: '', hub: '', env: '', scratchDb: '', prodDbUrl: '', json: false, unknown: [] };
  for (const a of argv) {
    if (a === '--check') out.mode = 'check';
    else if (a === '--full') out.mode = 'full';
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--hub=')) out.hub = a.slice(6).trim();
    else if (a.startsWith('--env=')) out.env = a.slice(6).trim();
    else if (a.startsWith('--scratch-db=')) out.scratchDb = a.slice(13).trim();
    else if (a.startsWith('--prod-db=')) out.prodDbUrl = a.slice(10).trim();
    else out.unknown.push(a);
  }
  if (!out.mode) out.mode = 'check';
  return out;
}

export function inspectHub(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, reason: `hub ต้องเป็น http/https (ได้ ${u.protocol})` };
    }
    const host = u.hostname.toLowerCase();
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return {
      ok: true,
      hub: `${u.protocol}//${u.host}`,
      host,
      port,
      isProduction: LOOPBACK.has(host) && PROD_PORTS.has(port),
    };
  } catch {
    return { ok: false, reason: `hub ไม่ใช่ URL ที่อ่านได้: ${raw}` };
  }
}

export function schemaOf(databaseUrl) {
  try {
    return String(new URL(String(databaseUrl ?? '')).searchParams.get('schema') ?? '').trim();
  } catch {
    return '';
  }
}

function refuse(code, reason, exitCode = 2) {
  return { ok: false, code, reason, exitCode };
}

/**
 * ตัดสินว่าการรันครั้งนี้ปลอดภัยไหม — pure function (เทสต์ได้โดยไม่ต้องมีเซิร์ฟเวอร์)
 */
export function assessTarget({ mode = 'check', env = '', hub = DEFAULT_HUB, scratchDb = '', prodDbUrl = '' } = {}) {
  if (mode !== 'check' && mode !== 'full') {
    return refuse('bad_mode', `โหมดไม่รู้จัก: ${mode} (ใช้ --check หรือ --full)`);
  }
  const h = inspectHub(hub || DEFAULT_HUB);
  if (!h.ok) return refuse('bad_hub', h.reason);

  // อ่านเท่านั้น = ปลอดภัยกับ production (ไม่มีการสร้าง/ลบบัญชี)
  if (mode === 'check') return { ok: true, mode, hub: h.hub, readOnly: true };

  if (env !== 'test') {
    return refuse(
      'need_env_test',
      'โหมด --full สร้างและลบบัญชีจริง — ต้องประกาศ --env=test ให้ชัดเจนก่อน ' +
        '(หรือใช้ --check สำหรับ nightly)',
    );
  }
  if (h.isProduction) {
    return refuse(
      'prod_hub',
      `hub ${h.hub} คือ production (:3001) — --full ห้ามรันใส่ระบบที่ใช้งานจริง ` +
        'ให้สตาร์ท core-api อีกตัวบนพอร์ตอื่นที่ชี้ DB ชั่วคราวก่อน',
    );
  }
  if (!scratchDb) {
    return refuse(
      'need_scratch_db',
      'โหมด --full ต้องมี --scratch-db=<DATABASE_URL>?schema=<ชื่อชั่วคราว> ' +
        'เพื่อไม่ให้เขียนลง schema public ของระบบจริง',
    );
  }
  const schema = schemaOf(scratchDb);
  if (!schema) {
    return refuse(
      'scratch_db_no_schema',
      'scratch DB ต้องมี query ?schema=<ชื่อ> (ไม่มี = Prisma จะใช้ public)',
    );
  }
  if (schema === 'public') {
    return refuse('scratch_db_public', 'scratch DB ห้ามใช้ schema=public — ต้องเป็น schema ชั่วคราวที่ลบทิ้งได้');
  }
  if (prodDbUrl && String(prodDbUrl).trim() === String(scratchDb).trim()) {
    return refuse('scratch_db_is_prod', 'scratch DB ชี้ตัวเดียวกับ DATABASE_URL ของโปรเจกต์');
  }
  return { ok: true, mode, hub: h.hub, readOnly: false, schema };
}

/** เวอร์ชันนโยบายจากโค้ด (แหล่งความจริงเดียว) — ใช้จับ runtime ที่ยังไม่ deploy */
export function readSourcePolicyVersion(root = REPO) {
  try {
    const src = readFileSync(join(root, 'sovereign-os', 'core-api', 'src', 'services', 'consent.service.ts'), 'utf8');
    const m = src.match(/export const CONSENT_POLICY_VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * โหมด --check: อ่านเท่านั้น (GET 3 เส้น) — ไม่มี token ไม่แตะ DB ไม่เขียนอะไร
 */
export async function runCheck({ hub = DEFAULT_HUB, fetchImpl = globalThis.fetch, sourceVersion = '', timeoutMs = 15_000 } = {}) {
  const base = String(hub).replace(/\/+$/, '');
  const checks = [];
  const add = (name, ok, detail = '', severity = 'error') => checks.push({ name, ok, detail, severity });

  const signal = () => (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined);
  const get = async (pathname) => {
    const res = await fetchImpl(`${base}${pathname}`, { signal: signal() });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  };

  // 1) นโยบายต้องอ่านได้ก่อนล็อกอิน (PDPA: ผู้ใช้ต้องเห็นก่อนกดยอมรับ)
  let policy = null;
  try {
    policy = await get('/api/consent/policy');
  } catch (err) {
    add('policy_public_200', false, `เรียกไม่ถึง: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (policy) {
    add('policy_public_200', policy.status === 200, `HTTP ${policy.status}`);
    const version = String(policy.body?.version ?? '');
    const versionOk = /^\d{4}-\d{2}-\d{2}$/.test(version) && Number.isFinite(Date.parse(version));
    add('policy_version_iso', versionOk, version || 'ไม่มี version');

    const ids = Array.isArray(policy.body?.sections) ? policy.body.sections.map((s) => String(s?.id ?? '')) : [];
    const missing = REQUIRED_SECTIONS.filter((id) => !ids.includes(id));
    add(
      'policy_sections',
      ids.length > 0 && missing.length === 0,
      missing.length ? `ขาดหัวข้อ: ${missing.join(', ')}` : `${ids.length} หัวข้อ`,
    );

    const controller = policy.body?.controller ?? {};
    const configured = Boolean(controller.name && controller.email);
    add(
      'controller_configured',
      configured,
      configured ? String(controller.name) : 'ยังไม่ได้ตั้ง PRIVACY_CONTROLLER_* (เจ้าของต้องเติมก่อนเผยแพร่)',
      'warn',
    );

    if (sourceVersion) {
      const match = version === sourceVersion;
      add(
        'policy_version_matches_source',
        match,
        match ? version : `runtime ${version || '—'} ≠ โค้ด ${sourceVersion} (ยังไม่ deploy หรือโค้ดใหม่กว่า)`,
        'warn',
      );
    }
  }

  // 2) เส้นข้อมูลส่วนบุคคลต้องกัน token (401) — ไม่ใช่ 200 ที่แปลว่าความยินยอมรั่ว
  for (const [name, pathname] of [
    ['consent_requires_auth', '/api/consent'],
    ['history_requires_auth', '/api/consent/history'],
  ]) {
    try {
      const r = await get(pathname);
      add(name, r.status === 401, `HTTP ${r.status}`);
    } catch (err) {
      add(name, false, `เรียกไม่ถึง: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const errors = checks.filter((c) => c.severity === 'error' && !c.ok);
  const warnings = checks.filter((c) => c.severity === 'warn' && !c.ok);
  const pass = checks.filter((c) => c.ok).length;
  const ok = errors.length === 0;
  const last = ok
    ? `OK · ${pass}/${checks.length}${warnings.length ? ` · ⚠️ ${warnings.length} คำเตือน` : ''}`
    : `ไม่ผ่าน ${checks.length - pass}/${checks.length}: ${errors.map((c) => c.name).join(', ')}`;

  return { ok, hub: base, checks, errors: errors.map((c) => c.name), warnings: warnings.map((c) => c.name), last };
}

function printChecks(result) {
  for (const c of result.checks) {
    const mark = c.ok ? 'PASS' : c.severity === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${mark} · ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`consent-smoke-check: ${result.last}`);
}

function readProjectDatabaseUrl() {
  try {
    const txt = readFileSync(join(CORE_API, '.env'), 'utf8');
    const m = txt.match(/^DATABASE_URL\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.unknown.length) {
    console.error(`ปฏิเสธการทำงาน: ไม่รู้จักธง ${args.unknown.join(', ')}`);
    console.error('ใช้: node tools/consent-smoke-runner.mjs --check [--json] | --full --env=test --hub=<test-hub> --scratch-db=<url>?schema=<name>');
    return 2;
  }

  const target = assessTarget({
    mode: args.mode,
    env: args.env,
    hub: args.hub || DEFAULT_HUB,
    scratchDb: args.scratchDb,
    prodDbUrl: args.prodDbUrl || readProjectDatabaseUrl(),
  });

  if (!target.ok) {
    console.error(`ปฏิเสธการทำงาน: ${target.reason}`);
    console.error(`   (code: ${target.code})`);
    if (args.json) console.log(JSON.stringify({ ok: false, refused: true, code: target.code, reason: target.reason, last: `ปฏิเสธ: ${target.code}` }));
    return target.exitCode ?? 2;
  }

  if (target.readOnly) {
    const result = await runCheck({ hub: target.hub, sourceVersion: readSourcePolicyVersion() });
    if (args.json) console.log(JSON.stringify(result));
    else printChecks(result);
    return result.ok ? 0 : 1;
  }

  // ── โหมดเขียนจริง: สภาพแวดล้อมผ่านเกตครบแล้ว (test hub + scratch schema) ──
  console.log(`▶ consent smoke (full) · hub=${target.hub} · schema=${target.schema}`);
  const child = spawnSync(
    process.execPath,
    [SMOKE_SCRIPT, '--confirm', `--hub=${target.hub}`],
    {
      cwd: CORE_API,
      windowsHide: true,
      stdio: 'inherit',
      timeout: 10 * 60_000,
      env: { ...process.env, DATABASE_URL: args.scratchDb, CONSENT_SMOKE_ENV: 'test' },
    },
  );
  const code = child.status ?? 1;
  if (args.json) {
    console.log(JSON.stringify({
      ok: code === 0,
      hub: target.hub,
      schema: target.schema,
      last: code === 0 ? 'full: OK' : `full: exit ${code}`,
    }));
  }
  return code;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SELF).href;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error('runner error:', err instanceof Error ? err.stack : String(err));
      process.exitCode = 1;
    });
}
