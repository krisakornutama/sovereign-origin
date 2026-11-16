#!/usr/bin/env node
// `docker restart sovereign-core-api` + ตราประทับ build + ยืนยันว่า health ตรงกับ HEAD
//
// ทำไมต้องมี: คอนเทนเนอร์ไม่มี .git ⇒ `/api/health` รู้ commit ได้จาก
// `core-api/data/build-info.json` เท่านั้น ถ้าลืมเขียนไฟล์นั้นก่อน restart
// prod จะรายงาน commit เก่า (หรือ null) ทั้งที่โค้ดใหม่ขึ้นแล้ว — เงียบสนิท
// (เคสจริง 16/11/69: restart ไปแล้วได้ `commit: null`)
//
// ใช้:
//   node tools/deploy-core-api.mjs                 # เขียน stamp → restart → รอ health ตรง HEAD
//   node tools/deploy-core-api.mjs --dry-run       # เขียน stamp + พิมพ์คำสั่ง แต่ไม่ restart
//   node tools/deploy-core-api.mjs --container x --health http://127.0.0.1:3001/api/health
//   node tools/deploy-core-api.mjs --timeout 240   # วินาที
// exit: 0 = health รายงาน commit ตรง HEAD · 1 = restart/ยืนยันไม่ผ่าน (rollback คือ docker ของเดิม)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, DEFAULT_STAMP, writeStamp } from './write-build-info.mjs';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readHealthCommit(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, commit: body?.build?.commit ?? null, builtAt: body?.build?.builtAt ?? null, loadedDir: body?.build?.loadedDir ?? null };
  } catch (err) {
    return { ok: false, reason: err?.name === 'TimeoutError' ? 'timeout' : err?.message || String(err) };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const container = argValue(argv, '--container') || 'sovereign-core-api';
  const healthUrl = argValue(argv, '--health') || 'http://127.0.0.1:3001/api/health';
  const timeoutSec = Number(argValue(argv, '--timeout') || 180);
  const stampFile = argValue(argv, '--stamp') || DEFAULT_STAMP;
  const head = argValue(argv, '--head') || git(['rev-parse', 'HEAD']);

  const stamp = writeStamp(stampFile, head ? { commitFull: head } : {});
  console.log(`✓ build-info: ${path.relative(ROOT, stampFile)} — commit ${stamp.commit ?? 'ไม่ทราบ'}${stamp.dirty ? ' (dirty)' : ''}`);

  console.log(`→ docker restart ${container}`);
  if (dryRun) {
    console.log(`DRY-RUN: ไม่ได้รันจริง (จะรอ ${healthUrl} รายงาน commit ${String(head).slice(0, 12)})`);
    return 0;
  }

  try {
    execFileSync('docker', ['restart', container], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`✗ docker restart ${container} ล้ม: ${err?.stderr || err?.message || err}`);
    return 1;
  }

  const want = String(head).slice(0, 12);
  const deadline = Date.now() + timeoutSec * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const h = await readHealthCommit(healthUrl);
    if (!h.ok) {
      last = h.reason;
      await sleep(3000);
      continue;
    }
    last = `commit=${h.commit ?? 'null'} builtAt=${h.builtAt ?? 'null'} (${h.loadedDir ?? '?'})`;
    // health พร้อมแล้วแต่ commit ยังไม่ตรง = ยังไม่บูตเสร็จ/สแตมป์ผิด — รอต่อจนครบเวลา
    if (h.commit && String(h.commit).startsWith(want.slice(0, String(h.commit).length))) {
      console.log(`✅ health ตรงกับ HEAD — ${last}`);
      return 0;
    }
    await sleep(3000);
  }

  console.error(`✗ ยืนยันไม่ผ่านภายใน ${timeoutSec}s — ล่าสุด: ${last || 'ไม่มีคำตอบ'}`);
  console.error(`  ตรวจเอง: curl -s ${healthUrl}`);
  console.error('  ถ้าโค้ดใหม่พัง: docker restart ด้วย build เดิม / ตามขั้นตอน rollback ใน docs/PRODUCTION-GO-LIVE.md');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
