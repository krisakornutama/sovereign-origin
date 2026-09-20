// tools/verify/db-doctor.mjs — ตรวจสุขภาพ DB config ทั้งระบบ (stateless, อ่านอย่างเดียว)
// บทเรียนจริงที่ script นี้กัน:
//   1) restore ทับฐานแล้ว app ชี้ชื่ออื่น → ใคร query ฐานผิดก็ตกใจว่า "ข้อมูลหาย" (เคส 20 ก.ย.)
//   2) ฐานขยะ/restore ตกค้างวางอยู่ใน cluster โดยไม่มีใครรู้
//   3) Prisma client/โค้ดอ้างคอลัมน์ที่ DB ไม่มี → runtime error กลางงาน
//   4) สคริปต์ backup hardcode ชื่อฐานที่ไม่ตรงกับที่ app ใช้
// ผลลัพธ์: OK/NOTE/WARN ต่อข้อ · exit 0 ถ้าไม่มี WARN, exit 1 ถ้ามี
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INFRA = path.join(ROOT, 'sovereign-os/infra');
const ENV_FILE = path.join(INFRA, '.env');
const SCHEMA = path.join(ROOT, 'sovereign-os/core-api/prisma/schema.prisma');
const BACKUP_PS1 = path.join(ROOT, 'tools/backup-db.ps1');
const KNOWN = new Set(['postgres', 'template0', 'template1', 'sovereign_test']); // sovereign_test = ฐานของ tools/verify

const sh = (cmd, cwd) => { try { return execSync(cmd, { encoding: 'utf8', cwd }).trim(); } catch (e) { return e.stdout?.toString().trim() ?? ''; } };
const psql = (sql, db) => sh(`docker exec sovereign-db psql -U sovereign -d ${db} -t -A -c "${sql.replace(/"/g, '\\"')}"`);
const die = (msg) => { console.error(`FATAL ${msg}`); process.exit(2); };

let warns = 0;
const ok = (m) => console.log(`OK    ${m}`);
const note = (m) => console.log(`NOTE  ${m}`);
const warn = (m) => { console.log(`WARN  ${m}`); warns++; };

// ── 0) อ่านค่าจริงจากทั้งสามแหล่ง ──
if (!fs.existsSync(ENV_FILE)) die(`ไม่พบ ${ENV_FILE}`);
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const appDb = env.POSTGRES_DB || 'sovereign';                       // ฐานที่ app ใช้ตาม env
// ห้าม pipe/redirect ใน execSync บน Windows (cmd.exe ไม่รู้จัก /dev/null) — parse ใน JS แทน
const composeCfg = sh('docker compose config core-api', INFRA);
const composeUrlLine = composeCfg.split(/\r?\n/).find(l => l.trim().startsWith('DATABASE_URL:'))?.split('DATABASE_URL:')[1]?.trim();
if (!composeUrlLine) die('อ่าน DATABASE_URL จาก docker compose config ไม่ได้ — เช็คว่ารันจาก checkout ที่มี sovereign-os/infra/.env (gitignored, อยู่เฉพาะเครื่อง)');
let composeHost, composeDb;
try { const u = new URL(composeUrlLine); composeHost = u.hostname; composeDb = u.pathname.slice(1); } catch { die(`DATABASE_URL จาก compose parse ไม่ได้: ${composeUrlLine}`); }
const containerEnv = sh('docker inspect sovereign-core-api --format "{{range .Config.Env}}{{println .}}{{end}}"').split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length);
let runningDb;
try { runningDb = containerEnv && new URL(containerEnv).pathname.slice(1); } catch { runningDb = null; }

// ── 1) ความสอดคล้อง env ↔ compose ↔ container ที่รันอยู่ ──
composeDb === appDb ? ok(`compose DATABASE_URL ชี้ฐาน "${composeDb}" ตรงกับ POSTGRES_DB ใน infra/.env`)
  : warn(`compose ชี้ฐาน "${composeDb}" แต่ POSTGRES_DB ใน .env เป็น "${appDb}" — มีคน override ไม่ตรงกัน`);
appDb === 'sovereign' ? ok('POSTGRES_DB ใช้ default ของ compose (sovereign)')
  : note(`POSTGRES_DB override เป็น "${appDb}" — ตั้งใจใน infra/.env (documented)`);
runningDb ? (runningDb === appDb ? ok('container ที่รันอยู่ใช้ฐานเดียวกับ config') : warn(`container รันด้วยฐาน "${runningDb}" แต่ config ชี้ "${appDb}" — ต้อง recreate`))
  : warn('container sovereign-core-api ไม่มี DATABASE_URL หรือไม่รันอยู่');
composeHost === 'timescaledb' ? ok('host ใน DATABASE_URL = timescaledb (docker network)') : warn(`host ใน DATABASE_URL เป็น "${composeHost}" (คาด timescaledb)`);

// ── 2) ฐานที่ใช้จริง reachable ──
const reachable = psql('SELECT 1', appDb) === '1';
reachable ? ok(`ฐาน "${appDb}" ตอบสนอง (psql ผ่าน container sovereign-db)`) : warn(`ต่อฐาน "${appDb}" ไม่ได้`);

// ── 3) ฐานแปลกปลอมใน cluster ──
const dbs = psql("SELECT datname FROM pg_database WHERE NOT datistemplate", 'postgres').split('\n').map(s => s.trim()).filter(Boolean);
const strangers = dbs.filter(d => !KNOWN.has(d) && d !== appDb);
strangers.length === 0 ? ok('ไม่มีฐานแปลกปลอมใน cluster')
  : strangers.forEach(d => { const sz = psql(`SELECT pg_size_pretty(pg_database_size('${d}'))`, 'postgres'); warn(`ฐานไม่รู้จัก "${d}" (${sz}) วางอยู่ใน cluster — ยืนยันแล้ว drop หรือ rename ให้ชัด`); });

// ── 4) schema drift: ทุก scalar field ใน model AuditLog ต้องมีคอลัมน์จริงในฐาน (ข้าม @relation/@@map/comment) ──
const auditBlock = fs.readFileSync(SCHEMA, 'utf8').match(/model AuditLog \{([\s\S]*?)\n\}/)?.[1];
if (!auditBlock) die('อ่าน model AuditLog จาก schema.prisma ไม่ได้');
const expectCols = auditBlock.split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('//') && !l.startsWith('@@') && !/@relation/.test(l))
  .map(l => { const f = l.split(/\s+/)[0]; const m = l.match(/@map\("(\w+)"\)/); return m ? m[1] : f.replace(/[A-Z]/g, c => '_' + c.toLowerCase()); });
const actualCols = new Set(psql("SELECT column_name FROM information_schema.columns WHERE table_name='audit_logs'", appDb).split('\n'));
const missing = expectCols.filter(c => c && !actualCols.has(c));
missing.length === 0 ? ok(`schema AuditLog ↔ ฐาน "${appDb}" ตรงกัน (${expectCols.length} คอลัมน์)`)
  : warn(`ฐาน "${appDb}" ขาดคอลัมน์ที่โค้ดใช้: ${missing.join(', ')} — push schema ก่อน (เคส "token_version" เคยระเบิดตรงนี้)`);

// ── 5) สคริปต์ backup ต้อง dump ฐานเดียวกับที่ app ใช้ ──
const backupDb = fs.readFileSync(BACKUP_PS1, 'utf8').match(/DbName\s*=\s*'([^']+)'/)?.[1];
backupDb ? (backupDb === appDb ? ok(`tools/backup-db.ps1 สำรองฐาน "${backupDb}" ตรงกับที่ app ใช้`) : warn(`backup-db.ps1 สำรองฐาน "${backupDb}" แต่ app ใช้ "${appDb}" — backup ผิดตัว!`)) : note('อ่านชื่อฐานจาก backup-db.ps1 ไม่ได้');

console.log(`\n${warns === 0 ? '✔ สุขภาพดี' : '✖ ต้องแก้'} — ${warns} warning(s)`);
process.exit(warns ? 1 : 0);
