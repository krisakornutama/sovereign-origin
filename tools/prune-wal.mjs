// prune-wal.mjs — ตัด WAL เก่าของ PostgreSQL ทิ้ง เพื่อไม่ให้ดิสก์เต็ม
//
// ปัญหาที่แก้ (ค้นพบ 11/10/69): wal-archive โต 3.04 GB/วัน และไม่มีอะไรมาลบ
//   เพราะ docker-compose.yml มีแต่ archive_command ที่ "คัดลอก" ไม่มีการลบ
//   ผลคือ 44.9 GB สะสม ดิสก์ E: เหลือ 17.5 GB และจะเต็มใน ~6 วัน
//   ถ้าดิสก์เต็ม archive_command จะล้ม → Postgres อาจหยุดรับการเขียน = ระบบล่ม
//
// ทำไมลบได้ (ไม่กระทบฐานข้อมูลที่รันอยู่):
//   · Postgres อ่าน/เขียนของตัวเองที่ pg_wal — โฟลเดอร์ wal-archive มีไว้
//     ให้ restore_command ตอนกู้คืนเท่านั้น ไม่เกี่ยวกับการทำงานปกติ
//   · การกู้คืนจริงตอนนี้ใช้ logical dump รายวัน (backups/ + offsite/) ซึ่งมีครบ
//   · PITR ต้องมี base backup เป็นจุดเริ่ม — ตรวจแล้วไม่มี /tmp/pitr-base
//     ⇒ WAL ก่อนหน้านี้ไม่มี base มาเริ่ม replay อยู่แล้ว = เป็นข้อมูลตาย
//
// กติกาความปลอดภัย (ห้ามตัดออก — ทุกข้อกันพลาดจริง):
//   1) ลบเฉพาะชื่อที่หน้าตาเป็น WAL segment จริง (^[0-9A-F]{24}$) เท่านั้น
//      → ไฟล์ .backup / .partial / ไฟล์อื่น ไม่ถูกแตะ
//   2) เก่ากว่า N วันเท่านั้น → segment ที่กำลังถูกเขียนอยู่ไม่โดน
//   3) เช็คก่อนว่าไม่มี container กำลังกู้คืน/ซ้อมอยู่ → ถ้ามี ข้ามรอบนั้นไป
//   4) --dry-run ได้ ไม่ลบจริง
//
// ใช้: node tools/prune-wal.mjs [--days=7] [--dry-run] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const valueOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const DAYS = Math.max(1, Number(valueOf('days', '7')) || 7);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');

// --dir= ให้ชี้โฟลเดอร์อื่น (ใช้ตอนเทสต์ — ของจริงคือ wal-archive ของ HUB)
const ARCHIVE = path.resolve(ROOT, valueOf('dir', path.join('sovereign-os', 'infra', 'data', 'wal-archive')));

const say = (m = '') => console.log(m);
const gb = (n) => (n / 1024 / 1024 / 1024).toFixed(2);

/** ชื่อ WAL segment ของ PostgreSQL = 24 หลักฐาน 16 (ตัวพิมพ์ใหญ่) */
const SEGMENT_NAME = /^[0-9A-F]{24}$/;

/** มี container กำลังกู้คืน/ซ้อมอยู่ไหม — ถ้ามีห้ามลบ WAL (มันอาจต้องใช้) */
function restoreInProgress() {
  const r = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (r.status !== 0) return []; // docker ไม่ตอบ = ถือว่าไม่มี (แต่ไม่ตาย)
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((n) => n && /pitr|scratch|restore/i.test(n));
}

say('═══════════════════════════════════════════');
say('  ตัด WAL เก่า (เก็บย้อนหลัง ' + DAYS + ' วัน)');
say('═══════════════════════════════════════════');
say(`  โฟลเดอร์ : ${ARCHIVE}`);

if (!fs.existsSync(ARCHIVE)) {
  say('  ไม่พบโฟลเดอร์ wal-archive — ข้ามรอบนี้ (ยังไม่ได้เปิด archive_mode?)');
  process.exit(0);
}

// วันที่แบบ ค.ศ. ชัดเจน — ห้ามใช้ toLocaleString('th-TH') เพราะได้ พ.ศ. (2569)
//   แล้วเทียบกับ "เก่ากว่า 7 วัน" ของคนอ่านโดยตรงจะงง
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const busy = restoreInProgress();
if (busy.length) {
  say('');
  say(`  ⛔ ข้ามรอบนี้ — พบ container ที่อาจกู้คืนอยู่: ${busy.join(', ')}`);
  say('     (การลบ WAL ระหว่างมี restore ทำงาน = กู้คืนไม่สำเร็จ)');
  process.exit(0);
}

const cutoff = new Date(Date.now() - DAYS * 86400_000);
let all = [];
try {
  all = fs.readdirSync(ARCHIVE, { withFileTypes: true });
} catch (e) {
  say(`  อ่านโฟลเดอร์ไม่ได้: ${e.message}`);
  process.exit(1);
}

const segments = [];
const others = [];
for (const e of all) {
  if (!e.isFile()) continue;
  const full = path.join(ARCHIVE, e.name);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    continue;
  }
  (SEGMENT_NAME.test(e.name) ? segments : others).push({ name: e.name, full, mtime: st.mtime, size: st.size });
}

const old = segments.filter((s) => s.mtime < cutoff);
const keep = segments.filter((s) => s.mtime >= cutoff);
const bytes = old.reduce((a, s) => a + s.size, 0);

say('');
say(`  ทั้งหมด        : ${segments.length + others.length} ไฟล์ · ${gb(segments.reduce((a, s) => a + s.size, 0))} GB (เฉพาะ segment)`);
say(`  จะลบ (เก่ากว่า ${fmtDate(cutoff)}) : ${old.length} ไฟล์ · ${gb(bytes)} GB`);
say(`  จะเก็บไว้     : ${keep.length} ไฟล์ · ${gb(keep.reduce((a, s) => a + s.size, 0))} GB`);
if (others.length) say(`  ไม่แตะ (ไม่ใช่ segment) : ${others.length} ไฟล์`);

if (!old.length) {
  say('');
  say('  ✔ ไม่มีอะไรต้องลบ — ข้ามรอบนี้');
  process.exit(0);
}

if (DRY) {
  say('');
  say('  [--dry-run] ไม่ได้ลบจริง');
  process.exit(0);
}

let failed = 0;
for (const f of old) {
  try {
    fs.unlinkSync(f.full);
  } catch {
    failed += 1;
  }
}

say('');
say(`  ลบสำเร็จ ${old.length - failed} ไฟล์ · ผิดพลาด ${failed} · คืนพื้นที่ ${gb(bytes - failed * 0)} GB`);

// ยืนยันว่า archiving ยังเดินอยู่ (ถ้าลบแล้ว archiving ล้ม = สัญญาณว่ามีอะไรผิด)
const q = spawnSync(
  'docker',
  ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-t', '-A', '-F', '|',
    '-c', 'SELECT failed_count, last_archived_wal FROM pg_stat_archiver'],
  { windowsHide: true, encoding: 'utf8' },
);
const line = (q.stdout || '').split('\n').find((l) => /\|/.test(l));
if (line) {
  const [failedArch, lastWal] = line.split('|');
  const bad = Number(failedArch) > 0;
  say(`  archiving: ${bad ? '⚠ ล้ม ' + failedArch + ' ครั้ง' : 'ปกติ'} · segment ล่าสุด ${lastWal}`);
  if (bad && !FORCE) {
    say('  (มี archive failure — ดู log ของ container ก่อน ถ้าเพิ่งเพิ่งเกิดให้รอสักครู่แล้วรันซ้ำ)');
  }
}