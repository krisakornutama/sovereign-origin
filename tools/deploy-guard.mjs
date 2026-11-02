#!/usr/bin/env node
/* deploy-guard — ด่าน "ห้าม migrate/deploy โดยไม่มี backup ที่สดพอ"
   (คิว P0 หลังรอบ PDPA: บังคับ backup ก่อน deploy ทุกครั้ง)

   ใช้: node tools/deploy-guard.mjs [--json] [--dump-dir=…] [--migrations-dir=…]
                                   [--now=<ISO>] [--max-age-hours=24]

   กติกา (ล็อกด้วย tools/test/deploy-guard.test.mjs):
     · ไม่มีไฟล์ .dump เลย            → หยุด (no_dump)
     · dump เก่ากว่า migration ล่าสุด → หยุด (dump_older_than_migration)
     · dump ใหม่กว่า แต่เก่าเกิน N ชม. → หยุด (dump_too_old)
     · ผ่าน                          → คืนข้อมูล dump/migration ให้สคริปต์ deploy ใช้ต่อได้

   ทำไมใช้ mtime ของไฟล์ migration เป็นตัวเทียบ: ไม่ต้องต่อ DB ก็รู้ว่า
   "schema เปลี่ยนล่าสุดเมื่อไร" — dump ที่เกิดก่อนการเปลี่ยน schema คือ dump ที่
   กู้กลับมาแล้วไม่ตรงกับโค้ดที่กำลังจะรัน (เคยเกิดจริง 03/11/69: migrate ก่อน backup)

   โมดูลนี้เป็น "ตรรกะล้วน" (อ่านไฟล์เท่านั้น) — ไม่แตะ DB/container จึงใช้ในเทสต์ได้
   ตัวที่รันของจริงคือ tools/deploy-db.mjs ซึ่งเรียก assessDeployBackup() เป็นด่านแรก */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOLS_DIR, '..');
// worktree (.freebuff) ไม่มี backups/ — ให้ชี้โฟลเดอร์หลักของ MAIN เหมือน backup-restore-check
const MAIN_ROOT = (() => {
  const i = ROOT.indexOf('.freebuff');
  return i > 3 ? ROOT.slice(0, i).replace(/[\\/]+$/, '') : ROOT;
})();

export const DEFAULT_DUMP_DIR = process.env.BACKUP_DIR || path.join(MAIN_ROOT, 'backups', 'postgres');
export const DEFAULT_MIGRATIONS_DIR = path.join(ROOT, 'sovereign-os', 'core-api', 'prisma', 'migrations');
/** อายุสูงสุดที่ยอมรับได้ (ชม.) — backup รายวัน + เผื่อคาบ */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** คำสั่งที่ทำให้ด่านผ่าน — ต้องเป็นคำสั่งจริงที่รันได้ (ไม่ใช่คำแนะนำลอย ๆ) */
export const BACKUP_COMMAND = 'powershell -NoProfile -ExecutionPolicy Bypass -File tools\\backup-db.ps1';

const HOUR_MS = 3_600_000;

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** ไฟล์ .dump ทั้งหมด เรียงใหม่ → เก่า (ใช้ mtime เป็นเวลา backup) */
export function listDumps(dumpDir = DEFAULT_DUMP_DIR) {
  const st = statSafe(dumpDir);
  if (!st || !st.isDirectory()) return [];
  return fs
    .readdirSync(dumpDir)
    .filter((f) => f.toLowerCase().endsWith('.dump'))
    .map((f) => {
      const p = path.join(dumpDir, f);
      const s = statSafe(p);
      return s && s.isFile() ? { name: f, path: p, mtime: s.mtimeMs, size: s.size } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

export function latestDump(dumpDir = DEFAULT_DUMP_DIR) {
  return listDumps(dumpDir)[0] ?? null;
}

/** ไฟล์ล่าสุดในโฟลเดอร์ migrations = เวลาที่ schema ถูกแก้ล่าสุด */
export function latestMigration(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const s = statSafe(p);
        if (s) found.push({ path: p, mtime: s.mtimeMs });
      }
    }
  };
  walk(migrationsDir);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ?? null;
}

const migrationName = (p) => path.basename(path.dirname(p));

/**
 * ตรวจว่ามี backup ที่ใช้ deploy ได้หรือยัง
 * @param {{dumpDir?: string, migrationsDir?: string, now?: number|string|Date, maxAgeHours?: number}} opts
 */
export function assessDeployBackup(opts = {}) {
  const dumpDir = opts.dumpDir || DEFAULT_DUMP_DIR;
  const migrationsDir = opts.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const maxAgeHours = Number(opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS);
  const nowRaw = opts.now ?? Date.now();
  const at = nowRaw instanceof Date ? nowRaw.getTime() : typeof nowRaw === 'number' ? nowRaw : Date.parse(String(nowRaw));
  if (!Number.isFinite(at)) throw new Error(`--now ไม่ใช่วันที่ที่อ่านได้: ${String(nowRaw)}`);

  const base = {
    dumpDir,
    migrationsDir,
    maxAgeHours,
    checkedAt: new Date(at).toISOString(),
    remediation: BACKUP_COMMAND,
    latestDump: null,
    latestMigration: null,
    ageHours: null,
  };

  const dump = latestDump(dumpDir);
  if (!dump) {
    return {
      ...base,
      ok: false,
      code: 'no_dump',
      message: `ไม่พบไฟล์ .dump ใน ${dumpDir} — ยังไม่มี backup ของฐานข้อมูลปัจจุบัน`,
    };
  }

  const ageHours = Math.max(0, (at - dump.mtime) / HOUR_MS);
  const migration = latestMigration(migrationsDir);
  const result = {
    ...base,
    latestDump: {
      path: dump.path,
      name: dump.name,
      mtime: new Date(dump.mtime).toISOString(),
      size: dump.size,
    },
    latestMigration: migration
      ? { path: migration.path, name: migrationName(migration.path), mtime: new Date(migration.mtime).toISOString() }
      : null,
    ageHours: Math.round(ageHours * 100) / 100,
  };

  // ⚠️ เช็ค migration ก่อนอายุ: dump ที่เก่ากว่า schema ล่าสุดใช้ไม่ได้แม้จะเพิ่งสร้าง
  if (migration && migration.mtime > dump.mtime) {
    const mins = Math.round((migration.mtime - dump.mtime) / 60_000);
    return {
      ...result,
      ok: false,
      code: 'dump_older_than_migration',
      message:
        `dump ล่าสุด (${dump.name}) เก่ากว่า migration ล่าสุด (${migrationName(migration.path)}) ${mins} นาที — ` +
        'กู้ dump นี้กลับมาจะได้ schema ไม่ตรงกับโค้ดที่กำลังจะรัน',
    };
  }

  if (ageHours > maxAgeHours) {
    return {
      ...result,
      ok: false,
      code: 'dump_too_old',
      message: `dump ล่าสุด ${dump.name} เก่า ${Math.round(ageHours)} ชม. (เกินเพดาน ${maxAgeHours} ชม.)`,
    };
  }

  return {
    ...result,
    ok: true,
    code: 'ok',
    message: `backup พร้อม: ${dump.name} (อายุ ${result.ageHours} ชม.)`,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const val = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
  const JSON_OUT = argv.includes('--json');

  let verdict;
  try {
    verdict = assessDeployBackup({
      dumpDir: val('dump-dir', DEFAULT_DUMP_DIR),
      migrationsDir: val('migrations-dir', DEFAULT_MIGRATIONS_DIR),
      now: val('now', '') || Date.now(),
      maxAgeHours: val('max-age-hours', String(DEFAULT_MAX_AGE_HOURS)),
    });
  } catch (err) {
    console.error(`❌ deploy-guard: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 2;
    verdict = null;
  }

  if (verdict) {
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
    } else {
      const line = (k, v) => console.log(`  ${k.padEnd(16)}: ${v}`);
      console.log('═══ deploy-guard (ด่าน backup ก่อน deploy) ═══');
      line('dump dir', verdict.dumpDir);
      line('migrations dir', verdict.migrationsDir);
      line('dump ล่าสุด', verdict.latestDump ? `${verdict.latestDump.name} · ${verdict.ageHours} ชม.` : '— ไม่มี —');
      line(
        'migration ล่าสุด',
        verdict.latestMigration ? `${verdict.latestMigration.name} · ${verdict.latestMigration.mtime}` : '— ไม่มี —'
      );
      line('ผล', verdict.ok ? '✅ ผ่าน' : `❌ หยุด (${verdict.code})`);
      line('เหตุผล', verdict.message);
      if (!verdict.ok) {
        line('ทางแก้', verdict.remediation);
        line('', 'แล้วรัน deploy ใหม่ (อย่าข้ามด่านนี้)');
      }
    }
    process.exitCode = verdict.ok ? 0 : 1;
  }
}
