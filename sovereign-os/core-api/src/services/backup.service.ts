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
      return { enabled: false, time: '02:00' };
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
