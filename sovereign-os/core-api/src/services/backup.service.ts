import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { gzipSync, gunzipSync } from 'zlib';
import cron from 'node-cron';

const execFileAsync = promisify(execFile);

// โฟลเดอร์เก็บ backup — ตั้งได้ผ่าน env BACKUP_DIR (ค่าเริ่มต้น: <core-api>/backups)
export const BACKUP_DIR =
  process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');

const SCHEDULE_FILE = path.join(BACKUP_DIR, 'schedule.json');
const DB_URL = process.env.DATABASE_URL || '';
const DB_CONTAINER = process.env.DB_CONTAINER || 'sovereign-db';

// จำนวน backup ต่อชนิดที่เก็บไว้ (ลบไฟล์เก่าอัตโนมัติ) — ตั้งได้ผ่าน env BACKUP_RETAIN
const BACKUP_RETAIN = parseInt(process.env.BACKUP_RETAIN || '30', 10);

// ไฟล์ state (.json.gz) ที่เก็บคู่กับ DB dump — กันการตั้งค่าหายเมื่อ container recreate
// ครอบคลุม: data/*.json (state ทั้งหมด) + .env (secret/config) ถ้าหาเจอ
export function stateBundleName(now: Date): string {
  return `sovereign_state_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.json.gz`;
}

/** รวบรวมไฟล์ state สำหรับ bundle — data/*.json + .env (host หรือที่ mount เข้า container) */
export function collectStateFiles(cwd: string): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  const dataDir = path.join(cwd, 'data');
  try {
    if (fs.existsSync(dataDir)) {
      for (const f of fs.readdirSync(dataDir)) {
        if (!f.endsWith('.json') || f.includes('..')) continue;
        try {
          out.push({ name: `data/${f}`, content: fs.readFileSync(path.join(dataDir, f), 'utf8') });
        } catch {
          // ข้ามไฟล์ที่อ่านไม่ได้
        }
      }
    }
  } catch {
    // data dir ไม่มี = ข้าม
  }
  const envCandidates = [path.join(cwd, 'host-infra.env'), path.join(cwd, '..', 'infra', '.env')];
  for (const envFile of envCandidates) {
    try {
      if (fs.existsSync(envFile)) {
        out.push({ name: 'host-infra.env', content: fs.readFileSync(envFile, 'utf8') });
        break;
      }
    } catch {
      // ข้าม
    }
  }
  return out;
}

/** ลบไฟล์เก่าเกิน BACKUP_RETAIN ตาม suffix (เรียงตาม mtime ใหม่สุดก่อน) */
export function applyRetention(dir: string, suffix: string, keep: number): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  for (const { f } of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, f));
      removed.push(f);
    } catch {
      // ข้ามไฟล์ที่ลบไม่ได้
    }
  }
  return removed;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dbCredentials(): { user: string; db: string } {
  try {
    const u = new URL(DB_URL);
    return {
      user: decodeURIComponent(u.username),
      db: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  } catch {
    return { user: 'sovereign', db: 'sovereign' };
  }
}

function isSafeBackupName(file: string): boolean {
  return !!file && path.basename(file) === file && file.endsWith('.sql.gz') && !file.includes('..');
}

/** dump DB เป็น .sql.gz — พยายามใช้ pg_dump ในเครื่องก่อน ถ้าไม่มีค่อยใช้ docker exec */
async function dumpDatabase(): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync('pg_dump', [DB_URL], {
      maxBuffer: 1024 * 1024 * 1024, // 1GB
      timeout: 180000,
    });
    return gzipSync(stdout);
  } catch (err) {
    console.warn('Local pg_dump failed, trying docker exec:', (err as Error).message);
    const { user, db } = dbCredentials();
    const { stdout } = await execFileAsync(
      'docker',
      ['exec', DB_CONTAINER, 'pg_dump', '-U', user, '-d', db],
      { maxBuffer: 1024 * 1024 * 1024, timeout: 180000 }
    );
    return gzipSync(stdout);
  }
}

/** restore จาก .sql.gz — psql ในเครื่องก่อน ค่อย fallback docker */
async function restoreDatabase(sql: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('psql', [DB_URL], { stdio: ['pipe', 'ignore', 'inherit'] });
      child.stdin.write(sql);
      child.stdin.end();
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql exited with code ${code}`))));
    });
  } catch (err) {
    console.warn('Local psql failed, trying docker exec:', (err as Error).message);
    const { user, db } = dbCredentials();
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', user, '-d', db], {
        stdio: ['pipe', 'ignore', 'inherit'],
      });
      child.stdin.write(sql);
      child.stdin.end();
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`docker psql exited with code ${code}`))));
    });
  }
}

class BackupService {
  listBackups(): { file: string; size: number; date: string }[] {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sql.gz'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, size: st.size, date: st.mtime.toISOString() };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async createBackup(): Promise<{ file: string; size: number }> {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const now = new Date();
    const file = `sovereign_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}.sql.gz`;
    const gz = await dumpDatabase();
    fs.writeFileSync(path.join(BACKUP_DIR, file), gz);
    console.log(`💾 Backup created: ${file} (${(gz.length / 1024 / 1024).toFixed(2)} MB)`);
    await this.createStateBundle();
    return { file, size: gz.length };
  }

  /** bundle ไฟล์ state (data/*.json + .env) เก็บคู่กับ DB dump — กัน state หายเวลา container recreate */
  async createStateBundle(): Promise<{ file: string; size: number } | null> {
    const files = collectStateFiles(process.cwd());
    if (files.length === 0) return null;
    const file = stateBundleName(new Date());
    const gz = gzipSync(
      JSON.stringify({ at: new Date().toISOString(), files }, null, 2),
      { level: 9 }
    );
    fs.writeFileSync(path.join(BACKUP_DIR, file), gz);
    console.log(`🗃️ State bundle: ${file} (${files.length} ไฟล์, ${(gz.length / 1024).toFixed(1)} KB)`);
    const removedSql = applyRetention(BACKUP_DIR, '.sql.gz', BACKUP_RETAIN);
    const removedState = applyRetention(BACKUP_DIR, '.json.gz', BACKUP_RETAIN);
    if (removedSql.length || removedState.length) {
      console.log(`🧹 Retention: ลบไฟล์เก่า ${removedSql.length} sql.gz + ${removedState.length} state (เก็บ ${BACKUP_RETAIN} ล่าสุด)`);
    }
    return { file, size: gz.length };
  }

  async restoreBackup(file: string): Promise<void> {
    if (!isSafeBackupName(file)) throw new Error('Invalid backup file name');
    const filePath = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(filePath)) throw new Error('Backup file not found');
    const sql = gunzipSync(fs.readFileSync(filePath)).toString('utf-8');
    await restoreDatabase(sql);
    console.log(`♻️ Restored from backup: ${file}`);
  }

  deleteBackup(file: string): void {
    if (!isSafeBackupName(file)) throw new Error('Invalid backup file name');
    const filePath = path.join(BACKUP_DIR, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  getSchedule(): { enabled: boolean; time: string } {
    try {
      const raw = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
      return { enabled: !!raw.enabled, time: raw.time || '02:00' };
    } catch {
      // ไม่มี schedule.json = เปิด backup รายวันอัตโนมัติ 02:00 (กันลืมตั้ง)
      return { enabled: true, time: '02:00' };
    }
  }

  setSchedule(enabled: boolean, time: string): void {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify({ enabled, time }, null, 2));
  }

  startScheduler() {
    cron.schedule('* * * * *', () => {
      this.checkSchedule().catch((err) => console.error('Backup scheduler error:', err));
    });
    console.log('💾 Backup Scheduler started (checks every minute)');
  }

  private async checkSchedule(): Promise<void> {
    const sched = this.getSchedule();
    if (!sched.enabled) return;

    const now = new Date();
    const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (sched.time !== current) return;

    // กันการยิงซ้ำภายในวันเดียว
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const marker = path.join(BACKUP_DIR, `last_backup_${today}.marker`);
    if (fs.existsSync(marker)) return;

    await this.createBackup();
    fs.writeFileSync(marker, current);
  }
}

export const backupService = new BackupService();
