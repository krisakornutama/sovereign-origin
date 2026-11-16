#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   prod-build-check — "prod รัน build เก่ากว่าที่ควรหรือเปล่า"

   ทำไมต้องมี: โค้ดขึ้น main แล้วแต่คอนเทนเนอร์ยังไม่ restart ⇒ /api/health ยังรายงาน
   commit เก่า (หรือ null) และไม่มีใครรู้จนของพัง · ตัวนี้เทียบ `health.build.commit`
   กับ HEAD ของ checkout แล้วบอกตรง ๆ ว่า prod ตามหลังอยู่กี่รุ่น
   (ทำงานคู่กับ `tools/deploy-core-api.mjs` ที่เขียน stamp + restart + ยืนยันให้)

   ใช้:
     node tools/prod-build-check.mjs                  # exit 1 ถ้า prod เก่ากว่า HEAD
     node tools/prod-build-check.mjs --warn           # เตือนอย่างเดียว (exit 0) — สำหรับ preflight
     node tools/prod-build-check.mjs --json
     node tools/prod-build-check.mjs --url http://127.0.0.1:3001/api/health --head <sha>
     node tools/prod-build-check.mjs --timeout 5000

   exit: 0 = ตรงกับ HEAD หรือข้อมูลไม่พอ (unknown) · 1 = prod เก่ากว่า (stale) · 2 = prod ไม่ตอบ
   ───────────────────────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_HEALTH_URL = process.env.SMOKE_API
  ? `${process.env.SMOKE_API.replace(/\/+$/, '')}/api/health`
  : 'http://127.0.0.1:3001/api/health';

/**
 * เทียบ commit ที่ prod กำลังรันกับ HEAD
 * @returns {'match'|'stale'|'unknown'} unknown = ข้อมูลไม่พอ (health เก่าที่ไม่มี commit)
 */
export function compareBuildCommit(prodCommit, head) {
  const prod = String(prodCommit ?? '').trim();
  const current = String(head ?? '').trim();
  if (!prod || !current) return 'unknown';
  if (prod === current) return 'match';
  // stamp เก็บ 12 ตัวแรก — HEAD อาจเป็น 40 ตัว
  if (current.startsWith(prod) || prod.startsWith(current.slice(0, prod.length))) return 'match';
  return 'stale';
}

/**
 * ตัดสินจาก payload ของ /api/health
 * - stale ⇒ ok:false + บอกทางแก้ (รัน deploy-core-api)
 * - unknown ⇒ ok:true แต่ต้องเห็นว่า "ตรวจไม่ได้" ไม่ใช่ "ผ่าน"
 */
export function judgeProdBuild(healthBody, head) {
  const prodCommit = healthBody?.build?.commit ?? null;
  const builtAt = healthBody?.build?.builtAt ?? null;
  const loadedDir = healthBody?.build?.loadedDir ?? '?';
  const status = compareBuildCommit(prodCommit, head);
  const want = String(head ?? '').slice(0, 12);

  if (status === 'match') {
    return { status, ok: true, detail: `prod ${String(prodCommit).slice(0, 12)} ตรงกับ HEAD · build ${builtAt || '?'} (${loadedDir})` };
  }
  if (status === 'stale') {
    return {
      status,
      ok: false,
      detail:
        `prod รัน ${String(prodCommit).slice(0, 12)} แต่ HEAD คือ ${want} (build ${builtAt || '?'}) — ` +
        'รัน `node tools/deploy-core-api.mjs`',
    };
  }
  return {
    status,
    ok: true,
    detail:
      'health ไม่มี build.commit (build เก่ากว่า CI-003 หรือยังไม่ได้เขียน stamp) — ' +
      'ตรวจไม่ได้ว่า prod ตามหลังไหม; รัน `node tools/deploy-core-api.mjs` เพื่อให้ตอบได้',
  };
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function fetchHealth(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: err?.name === 'TimeoutError' ? 'timeout' : err?.message || String(err) };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const warnOnly = argv.includes('--warn');
  const json = argv.includes('--json');
  const url = argValue(argv, '--url') || DEFAULT_HEALTH_URL;
  const head = argValue(argv, '--head') || git(['rev-parse', 'HEAD']);
  const timeoutMs = Number(argValue(argv, '--timeout') || 5000);

  const res = await fetchHealth(url, timeoutMs);
  if (res.status !== 200 || !res.body) {
    const why = res.status ? `HTTP ${res.status}` : res.error || 'ไม่มีคำตอบ';
    if (json) console.log(JSON.stringify({ status: 'unreachable', url, head: head || null, reason: why }));
    else console.error(`⚠ ตรวจ prod build ไม่ได้ (${url}: ${why}) — ข้าม`);
    return 2;
  }

  const verdict = judgeProdBuild(res.body, head);
  if (json) {
    console.log(JSON.stringify({ url, head: head || null, ...verdict }));
  } else if (verdict.status === 'match') {
    console.log(`✅ prod build ตรงกับ HEAD — ${verdict.detail}`);
  } else if (verdict.status === 'stale') {
    console.error(`${warnOnly ? '⚠' : '✗'} prod รัน build เก่า — ${verdict.detail}`);
  } else {
    console.log(`⚠ ${verdict.detail}`);
  }

  if (verdict.status === 'stale') return warnOnly ? 0 : 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // ตั้ง exitCode แทน process.exit() — กัน libuv assertion บน Windows (ดู deploy-core-api.mjs)
  main().then((code) => {
    process.exitCode = code;
  });
}
