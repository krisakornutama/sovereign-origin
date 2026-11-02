#!/usr/bin/env node
/* deploy-db — ทาง deploy เดียวของ core-api: ด่าน backup → build → migrate → รีสตาร์ท → poll /healthz
   (คิว P0 หลังรอบ PDPA: บังคับ backup ก่อน deploy/migrate ทุกครั้ง)

   ใช้: node tools/deploy-db.mjs --yes [--dump-dir=…] [--migrations-dir=…] [--now=<ISO>]
                                  [--max-age-hours=24] [--dry-run] [--skip-migrate] [--skip-build]

   ทำไมต้องมีสคริปต์เดียว:
     · ลำดับที่ถูกคือ "backup → build ผ่าน → migrate → รีสตาร์ท → health 200" แต่ของจริง
       เคยข้าม backup และเคยบูตคอนเทนเนอร์ก่อน build ผ่าน (tsc ล้มในคอนเทนเนอร์ = API ล่มทั้งตัว)
     · ด่าน backup อยู่ในโค้ด ไม่ใช่ในหัวคน ⇒ ลืมไม่ได้ (ดู tools/deploy-guard.mjs)

   ความปลอดภัย:
     · ไม่มี --yes = แสดงแผนแล้วจบ (ไม่แตะ DB/container)
     · --dry-run = เหมือนกัน แต่บอกชัดว่าไม่มีอะไรถูกเรียกจริง
     · ด่านไม่ผ่าน = exit 1 ก่อนถึงขั้น build/migrate/บูต container ทุกกรณี */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessDeployBackup,
  BACKUP_COMMAND,
  DEFAULT_DUMP_DIR,
  DEFAULT_MIGRATIONS_DIR,
  DEFAULT_MAX_AGE_HOURS,
} from './deploy-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'sovereign-os', 'core-api');
const CONTAINER = process.env.API_CONTAINER || 'sovereign-core-api';
const HEALTH_URL = process.env.API_HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const HEALTH_TIMEOUT_MS = Number(process.env.API_HEALTH_TIMEOUT_MS || 120_000);

const argv = process.argv.slice(2);
const val = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const YES = argv.includes('--yes');
const DRY_RUN = argv.includes('--dry-run');
const SKIP_MIGRATE = argv.includes('--skip-migrate');
const SKIP_BUILD = argv.includes('--skip-build');

const log = (s = '') => console.log(s);

function run(label, cmd, args, opts = {}) {
  log(`▶ ${label}: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell: opts.shell ?? false,
    timeout: opts.timeout ?? 900_000,
  });
  if (res.error) throw new Error(`${label} เรียกไม่สำเร็จ: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${label} ล้ม (exit ${res.status})`);
}

function printPlan() {
  log('  แผนที่จะรัน (ตามลำดับ):');
  if (!SKIP_BUILD) log('    1) npm run build                 (ใน sovereign-os/core-api — ต้องผ่านก่อน restart)');
  if (!SKIP_MIGRATE) log('    2) npx prisma migrate deploy     (จากโฟลเดอร์ core-api)');
  else log('    2) ข้าม migrate (--skip-migrate)');
  log(`    3) docker restart ${CONTAINER}`);
  log(`    4) poll ${HEALTH_URL} จนได้ 200`);
}

async function waitHealthy() {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const secs = Math.round((Date.now() - started) / 1000);
        log(`✅ health 200 หลัง ${secs} วิ — deploy เสร็จ`);
        return;
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `health ไม่กลับมาเป็น 200 ภายใน ${Math.round(HEALTH_TIMEOUT_MS / 1000)} วิ (ล่าสุด: ${last}) — ` +
      `ดู log: docker logs --tail 80 ${CONTAINER}`
  );
}

async function main() {
  const verdict = assessDeployBackup({
    dumpDir: val('dump-dir', DEFAULT_DUMP_DIR),
    migrationsDir: val('migrations-dir', DEFAULT_MIGRATIONS_DIR),
    now: val('now', '') || Date.now(),
    maxAgeHours: val('max-age-hours', String(DEFAULT_MAX_AGE_HOURS)),
  });

  log('═══ deploy-db (ด่าน backup → build → migrate → restart) ═══');
  log(`  dump ล่าสุด      : ${verdict.latestDump ? `${verdict.latestDump.name} (${verdict.ageHours} ชม.)` : '— ไม่มี —'}`);
  log(`  migration ล่าสุด : ${verdict.latestMigration ? verdict.latestMigration.name : '— ไม่มี —'}`);
  log(`  ด่าน backup      : ${verdict.ok ? '✅ ผ่าน' : `❌ หยุด (${verdict.code})`}`);
  log(`  ${verdict.message}`);

  if (!verdict.ok) {
    console.error('');
    console.error('❌ ไม่ deploy — backup ยังไม่พร้อม (ด่านนี้ข้ามไม่ได้)');
    console.error(`   ทางแก้: ${BACKUP_COMMAND}`);
    console.error('   แล้วรันคำสั่ง deploy ใหม่');
    process.exitCode = 1;
    return;
  }

  printPlan();

  if (DRY_RUN || !YES) {
    log('');
    if (DRY_RUN) log('🧪 โหมด --dry-run: ไม่มีอะไรถูกเรียกจริง (will not run anything)');
    else log('ℹ️  ยังไม่รันจริง — เติม --yes เพื่อยืนยัน (ไม่มีอะไรถูกเรียกจริง)');
    process.exitCode = 0;
    return;
  }

  log('');
  if (!SKIP_BUILD) run('build', 'npm', ['run', 'build'], { cwd: API_DIR, shell: true });
  if (!SKIP_MIGRATE) run('migrate deploy', 'npx', ['prisma', 'migrate', 'deploy'], { cwd: API_DIR, shell: true });
  run('restart', 'docker', ['restart', CONTAINER]);
  await waitHealthy();
}

main().catch((err) => {
  console.error('');
  console.error(`❌ deploy ล้ม: ${err instanceof Error ? err.message : err}`);
  console.error('   ระบบอาจยังไม่ healthy — ตรวจก่อนใช้งาน: docker ps + docker logs --tail 80 ' + CONTAINER);
  process.exitCode = 1;
});
