#!/usr/bin/env node
// tools/verify/pitr-drill.mjs — ซ้อม Point-In-Time Recovery เต็มรอบอัตโนมัติ (I1a 28/9/69)
// หลักการ: live DB ถูกแตะเฉพาะ (1) INSERT/DELETE แถว probe ในตารางทดสอบ pitr_probe
//          ทุกอย่างอื่นเกิดบน scratch container ชั่วคราว (ลบทิ้งเมื่อจบ)
// ขั้นตอน: probe → จดเวลาเป้า → pg_basebackup → ลบ probe → รอ archive ครบ →
//          scratch (mount wal-archive read-only) → restore base + recovery.signal
//          (replay ถึงเวลาเป้า) → promote → พิสูจน์แถว probe "กลับมา" = RPO จริง
// ใช้: node tools/verify/pitr-drill.mjs [--keep]  (--keep = ไม่ลบ scratch เผื่อสืบสวน)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// ทำงานกับ runtime จริงเสมอ (wal-archive bind อยู่ที่ MAIN)
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const WAL_ARCHIVE_HOST = path.join(MAIN_ROOT, 'sovereign-os/infra/data/wal-archive');

const KEEP = process.argv.includes('--keep');
const SCRATCH = 'sovereign-pitr-scratch';
const PORT = '127.0.0.1:55433';
const LIVE_BASE_IN_CONTAINER = '/tmp/pitr-base';

const sh = (args, opts = {}) => {
  try { return { ok: true, out: execFileSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 180_000, windowsHide: true, ...opts }) }; }
  catch (e) { return { ok: false, err: String(e?.stderr || e?.message || e).slice(0, 300) }; }
};
const live = (sql) => sh(['docker', 'exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', sql]);
const die = (m) => { console.error('❌ ' + m); process.exit(1); };
// docker cp ระหว่าง container ไม่ได้ (ข้อจำกัด docker) — สองขาผ่าน temp บน host (E: ตามกฎ drive)
const BASE_TMP_HOST = path.join(MAIN_ROOT, 'sovereign-os/infra/data/pitr-base-tmp');
function copyBaseViaHost() {
  fs.rmSync(BASE_TMP_HOST, { recursive: true, force: true });
  fs.mkdirSync(BASE_TMP_HOST, { recursive: true });
  const a = sh(['docker', 'cp', `sovereign-db:${LIVE_BASE_IN_CONTAINER}/.`, BASE_TMP_HOST]);
  if (!a.ok) return a;
  const b = sh(['docker', 'cp', `${BASE_TMP_HOST}/.`, `${SCRATCH}:/var/lib/postgresql/data/`]);
  if (!b.ok) return b;
  return { ok: true, out: 'copied via host' };
}
const sleepSec = (s) => spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', String(s), '/nobreak'] : [String(s)], { shell: true, stdio: 'ignore' });

console.log('── 0) เงื่อนไข ──');
const archiver = live("SELECT archived_count, failed_count FROM pg_stat_archiver");
if (!archiver.ok) die('live DB ติดต่อไม่ได้ — ' + archiver.err);
const [arc, fail] = archiver.out.trim().split('|').map(Number);
console.log(`pg_stat_archiver: archived=${arc} failed=${fail}`);
if (fail > 0) die('archive มี failed — แก้สาย WAL ก่อนซ้อม (machine-health I1c จะจับให้)');
if (!fs.existsSync(WAL_ARCHIVE_HOST)) die(`ไม่พบ wal-archive บน host (${WAL_ARCHIVE_HOST})`);

console.log('── 1) ปัก probe + จดเวลาเป้า ──');
if (!live(`CREATE TABLE IF NOT EXISTS pitr_probe(id int primary key, note text)`).ok) die('สร้างตารางทดสอบไม่ได้');
if (!live(`INSERT INTO pitr_probe VALUES (1,'before-delete') ON CONFLICT (id) DO UPDATE SET note='before-delete'`).ok) die('ใส่ probe ไม่ได้');
const target = live(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.MS')`).out.trim();
console.log(`เวลาเป้า (ก่อนลบ): ${target} UTC`);

console.log('── 2) pg_basebackup → /tmp/pitr-base (ใน container live) ──');
if (!sh(['docker', 'exec', 'sovereign-db', 'rm', '-rf', LIVE_BASE_IN_CONTAINER]).ok) {}
const bb = sh(['docker', 'exec', 'sovereign-db', 'pg_basebackup', '-U', 'sovereign', '-D', LIVE_BASE_IN_CONTAINER, '-Fp', '-Xs', '-c', 'fast']);
if (!bb.ok) die('basebackup ล้ม — ' + bb.err);
console.log('basebackup สำเร็จ');

console.log('── 3) ลบ probe (เหตุการณ์ "ข้อมูลหาย") ──');
live(`DELETE FROM pitr_probe WHERE id=1`);
console.log('หลังลบ: ' + live(`SELECT count(*) FROM pitr_probe WHERE id=1`).out.trim() + ' แถว (ต้องเป็น 0)');

console.log('── 4) รอ archive ครบ (switch segment · สูงสุด 60 วิ) ──');
const arcBefore = Number(live('SELECT archived_count FROM pg_stat_archiver').out.trim());
live('SELECT pg_switch_wal()');
let deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  if (Number(live('SELECT archived_count FROM pg_stat_archiver').out.trim()) >= arcBefore + 1) break;
  sleepSec(3);
}
console.log(`archive รวม ${live('SELECT archived_count FROM pg_stat_archiver').out.trim()} segments (ก่อนซ้อม ${arcBefore})`);

console.log('── 5) scratch container (sleep infinity — เตรียมไฟล์ก่อนค่อยสตาร์ต postgres) ──');
// เหตุผล: docker cp เขียนไฟล์เป็น root → postgres ปฏิเสธ datadir ถ้าเข้าไปตอนบูตเลย
// จึงบูตด้วย sleep infinity → เตรียมไฟล์ + chown ผ่าน exec → สตาร์ต postgres เองด้วย gosu
sh(['docker', 'rm', '-f', SCRATCH]);
const run = sh(['docker', 'run', '-d', '--name', SCRATCH, '-e', 'POSTGRES_PASSWORD=pitrdrill', '-e', 'POSTGRES_USER=sovereign', '-e', 'POSTGRES_DB=sovereign', '-p', `${PORT}:5432`, '-v', `${WAL_ARCHIVE_HOST}:/var/lib/postgresql/wal-archive:ro`, 'timescale/timescaledb:latest-pg15', 'sleep', 'infinity']);
if (!run.ok) die('รัน scratch ไม่ได้ — ' + run.err);
if (!sh(['docker', 'exec', SCRATCH, 'sh', '-c', 'rm -rf /var/lib/postgresql/data/*']).ok) die('เคลียร์ datadir ไม่ได้');
const cp = copyBaseViaHost();
if (!cp.ok) die('คัดลอก base เข้า scratch ไม่ได้ — ' + cp.err);

console.log('── 6) recovery.signal + target_time + สิทธิ์ (heredoc กัน quoting ผ่าน Windows) ──');
// heredoc ต้องมีบรรทัดจริง (join ด้วย \n — ห้าม && ในบรรทัดเดียว)
const recScript = [
  `touch /var/lib/postgresql/data/recovery.signal`,
  `cat > /var/lib/postgresql/data/postgresql.auto.conf <<EOF`,
  `restore_command = 'install -m 600 /var/lib/postgresql/wal-archive/%f %p'`,
  `recovery_target_time = '${target}+00'`,
  `recovery_target_action = 'promote'`,
  `EOF`,
  `chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data`,
].join('\n');
const rec = sh(['docker', 'exec', SCRATCH, 'sh', '-c', recScript]);
if (!rec.ok) die('ตั้ง recovery config ไม่ได้ — ' + rec.err);
// สตาร์ต postgres แบบ daemon ใน container (`sh -c '… &'` → reparent เป็นลูก PID 1)
// ห้าม exec -d: เซสชัน exec ตายพร้อมโปรเซสแม่ (เคสจริง 28/9 — postgres โดนฆ่ากลาง recovery เมื่อสคริปต์จบ)
const startPg = sh(['docker', 'exec', SCRATCH, 'sh', '-c', 'nohup gosu postgres postgres -D /var/lib/postgresql/data > /pg.log 2>&1 & echo started']);
if (!startPg.ok) die('สตาร์ต postgres บน scratch ไม่ได้ — ' + startPg.err);
console.log('scratch กำลัง replay WAL ถึงเวลาเป้า…');

console.log('── 7) รอ recovery จบ (สูงสุด 300 วิ — ตอน replay การเชื่อมต่อถูกปฏิเสธเป็นเรื่องปกติ) ──');
deadline = Date.now() + 300_000;
let recovered = false;
while (Date.now() < deadline) {
  const st = sh(['docker', 'exec', SCRATCH, 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', 'SELECT pg_is_in_recovery()']);
  if (st.ok && st.out.trim() === 'f') { recovered = true; break; }
  sleepSec(5);
}
if (!recovered) {
  const tailLog = sh(['docker', 'exec', SCRATCH, 'sh', '-c', 'tail -6 /pg.log 2>/dev/null || true']);
  die('scratch ไม่ยอม promote — log ล่าสุด:\n' + (tailLog.out || tailLog.err));
}

console.log('── 8) พิสูจน์ ──');
const probe = sh(['docker', 'exec', SCRATCH, 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', 'SELECT note FROM pitr_probe WHERE id=1']);
const users = sh(['docker', 'exec', SCRATCH, 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', 'SELECT count(*) FROM users']);
console.log(`pitr_probe (id=1): ${probe.ok ? probe.out.trim() : 'ERROR ' + probe.err} — ต้องเป็น before-delete`);
console.log(`users: ${users.ok ? users.out.trim() : '?'} แถว`);
const ok = probe.ok && probe.out.trim() === 'before-delete' && users.ok && Number(users.out.trim()) >= 5;
console.log(ok ? '✅ PITR สำเร็จ — ข้อมูลกลับถึงนาทีที่ตั้งเป้า (RPO ระดับนาทีจริง)' : '❌ PITR พัง — ดูข้างบน');

if (!KEEP) {
  sh(['docker', 'rm', '-f', SCRATCH]);
  sh(['docker', 'exec', 'sovereign-db', 'rm', '-rf', LIVE_BASE_IN_CONTAINER]);
  fs.rmSync(BASE_TMP_HOST, { recursive: true, force: true });
  console.log('เก็บกวาด scratch + base แล้ว (--keep เพื่อเก็บไว้ตรวจ)');
} else console.log(`เก็บ scratch ไว้ (${SCRATCH})`);
process.exit(ok ? 0 : 1);
