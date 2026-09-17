import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import cron from 'node-cron';
import axios from 'axios';
import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import { BACKUP_DIR } from './backup.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import { securityStream } from './security-stream.service';
import { sendTelegramAlert } from './telegram-alert.service';
import { prisma } from '../lib/prisma';

const execFile = promisify(execFileCb);

// ── Sovereign Mesh Lite: สำรองข้อมูลนอกสถานที่แบบเข้ารหัส (AES-256-GCM) ──
// หลักการ: ทุกครั้งที่มี backup ใหม่ (DB dump + state bundle) → เข้ารหัสด้วย key เฉพาะเครื่อง
// แล้วส่งออกนอกเครื่องผ่านช่องทางที่ตั้งไว้:
//   1) MESH_OUTPUT_DIR  — local mount (NAS/SMB/NFS/USB) — copy + retention ที่ปลายทาง
//   2) MESH_PUSH_URL    — remote server ผ่าน HTTP POST (bundle .enc.json)
//   3) MESH_RSYNC_TARGET — rsync ไป remote/local (เช่น user@host:/path หรือ /mnt/nas)
//   4) MESH_SCP_TARGET   — scp ไป remote (user@host:/path)
// ปลายทางต้องได้ key ไปถอดรหัสเอง (คัดลอกมือ ห้ามส่งผ่าน network)

export const MESH_DIR = process.env.MESH_DIR || path.join(BACKUP_DIR, 'mesh');
export const MESH_KEY_FILE = process.env.MESH_KEY_FILE || path.resolve(process.cwd(), 'data', 'mesh-key');
const MESH_ENABLED = process.env.MESH_ENABLED !== 'false';
const MESH_RETAIN = parseInt(process.env.MESH_RETAIN || '30', 10);
const OFFSITE_RETAIN = parseInt(process.env.OFFSITE_RETAIN || String(MESH_RETAIN), 10);
const MESH_MIN_INTERVAL_MS = parseInt(process.env.MESH_MIN_INTERVAL_MS || (15 * 60 * 1000).toString(), 10);
const MESH_OUTPUT_DIR = process.env.MESH_OUTPUT_DIR || null;
const MESH_PUSH_URL = process.env.MESH_PUSH_URL || null;
const MESH_PUSH_TOKEN = process.env.MESH_PUSH_TOKEN || null;
const MESH_RSYNC_TARGET = process.env.MESH_RSYNC_TARGET || null;
const MESH_SCP_TARGET = process.env.MESH_SCP_TARGET || null;
const MESH_PUSH_TIMEOUT_MS = parseInt(process.env.MESH_PUSH_TIMEOUT_MS || '60000', 10);
const STATE_FILE = path.resolve(process.cwd(), 'data', 'mesh-lite.json');

export interface MeshBundleInfo {
  file: string;
  createdAt: string;
  keyFingerprint: string;
  payloadSize: number;
  dbFile: string;
  dbSha256: string;
  dbSize: number;
  stateFile: string | null;
  stateSha256: string | null;
  stateSize: number | null;
}

export interface MeshStatus {
  enabled: boolean;
  keyFileExists: boolean;
  keyFingerprint: string | null;
  lastReplicateAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  bundles: MeshBundleInfo[];
  outputDir: string | null;
  pushUrl: string | null;
  rsyncTarget: string | null;
  scpTarget: string | null;
  offsiteRetain: number;
  pending: boolean;
}

interface MeshState {
  lastReplicateAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/** สร้าง key file 32 ไบต์สุ่ม (ถ้ายังไม่มี) — ปลายทางต้องได้ key นี้ไปถอดรหัส (คัดลอกมือ ห้ามส่งผ่าน network) */
export function ensureMeshKey(keyFile: string): string {
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return hex;
  }
  const hex = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, hex + '\n', { mode: 0o600 });
  return hex;
}

/** fingerprint ของ key (sha256 16 ตัวแรก) — ใช้ยืนยันตัวตน key ได้โดยไม่เปิดเผย key */
export function meshKeyFingerprint(keyHex: string): string {
  return crypto.createHash('sha256').update(keyHex).digest('hex').slice(0, 16);
}

/** AES-256-GCM encrypt → base64(iv | tag | ciphertext) */
export function meshEncrypt(buf: Buffer, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** ถอดรหัสจาก meshEncrypt — GCM ตรวจความถูกต้องเอง (ปลอม/เสียหาย → throw) */
export function meshDecrypt(blob: string, keyHex: string): Buffer {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < 28) throw new Error('mesh blob ผิดรูปแบบ');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function sha256Buf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function latestOf(dir: string, suffix: string): { file: string; path: string; size: number } | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix) && !f.includes('..'))
    .map((f) => {
      const p = path.join(dir, f);
      return { file: f, path: p, size: fs.statSync(p).size, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

/** ลบ .enc.json ที่เก่าที่สุดใน dir เก็บ retain รายการล่าสุด — ใช้กับทั้ง meshDir และปลายทาง offsite */
export function pruneEncBundles(dir: string, retain: number): void {
  if (!dir || !fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.enc.json') && !f.includes('..'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of files.slice(retain)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      // ข้าม
    }
  }
}

export class MeshLiteService {
  private backupDir: string;
  private meshDir: string;
  private keyFile: string;
  private stateFile: string;
  private outputDir: string | null;
  private pushUrl: string | null;
  private pushToken: string | null;
  private rsyncTarget: string | null;
  private scpTarget: string | null;
  private offsiteRetain: number;
  private enabled: boolean;
  private minIntervalMs: number;
  private state: MeshState;

  constructor(opts?: {
    backupDir?: string;
    meshDir?: string;
    keyFile?: string;
    stateFile?: string;
    outputDir?: string | null;
    pushUrl?: string | null;
    pushToken?: string | null;
    rsyncTarget?: string | null;
    scpTarget?: string | null;
    offsiteRetain?: number;
    enabled?: boolean;
    minIntervalMs?: number;
  }) {
    this.backupDir = opts?.backupDir || BACKUP_DIR;
    this.meshDir = opts?.meshDir || MESH_DIR;
    this.keyFile = opts?.keyFile || MESH_KEY_FILE;
    this.stateFile = opts?.stateFile || STATE_FILE;
    this.outputDir = opts?.outputDir !== undefined ? opts.outputDir : MESH_OUTPUT_DIR;
    this.pushUrl = opts?.pushUrl !== undefined ? opts.pushUrl : MESH_PUSH_URL;
    this.pushToken = opts?.pushToken !== undefined ? opts.pushToken : MESH_PUSH_TOKEN;
    this.rsyncTarget = opts?.rsyncTarget !== undefined ? opts.rsyncTarget : MESH_RSYNC_TARGET;
    this.scpTarget = opts?.scpTarget !== undefined ? opts.scpTarget : MESH_SCP_TARGET;
    this.offsiteRetain = opts?.offsiteRetain !== undefined ? opts.offsiteRetain : OFFSITE_RETAIN;
    this.enabled = opts?.enabled !== undefined ? opts.enabled : MESH_ENABLED;
    this.minIntervalMs = opts?.minIntervalMs !== undefined ? opts.minIntervalMs : MESH_MIN_INTERVAL_MS;
    this.state = this.loadState();
  }

  private loadState(): MeshState {
    const { ok, data, rot } = readJsonVerified<MeshState>(this.stateFile);
    if (rot) console.warn('📡 mesh-lite state bit-rot — ใช้ค่าเริ่มต้น (ไฟล์ถูก quarantine แล้ว)');
    if (ok && data) {
      return {
        lastReplicateAt: data.lastReplicateAt || null,
        lastSuccessAt: data.lastSuccessAt || null,
        lastError: data.lastError || null,
      };
    }
    return { lastReplicateAt: null, lastSuccessAt: null, lastError: null };
  }

  private saveState(): void {
    try {
      saveJsonAtomic(this.stateFile, this.state);
    } catch {
      // state file เขียนไม่ได้ = ข้าม
    }
  }

  /** backup ใหม่กว่า bundle ล่าสุดหรือยัง? (สำหรับ cron ตัดสินใจ replicate) */
  hasPendingBackup(): boolean {
    const latestSql = latestOf(this.backupDir, '.sql.gz');
    if (!latestSql) return false;
    const newest = this.latestBundle();
    if (!newest) return true;
    return newest.dbFile !== latestSql.file;
  }

  /** สร้าง encrypted bundle จาก backup ล่าสุด (DB dump + state bundle) */
  createBundle(): MeshBundleInfo | null {
    const sql = latestOf(this.backupDir, '.sql.gz');
    if (!sql) {
      this.state.lastError = 'ยังไม่มี backup (.sql.gz) ให้ replicate';
      this.saveState();
      return null;
    }
    const state = latestOf(this.backupDir, '.json.gz');
    const keyHex = ensureMeshKey(this.keyFile);
    const dbBuf = fs.readFileSync(sql.path);
    const dbB64 = dbBuf.toString('base64');
    const stateB64 = state ? fs.readFileSync(state.path).toString('base64') : null;
    const payload = gzipSync(
      JSON.stringify({
        format: 'sovereign-mesh-v1',
        createdAt: new Date().toISOString(),
        db: { file: sql.file, data: dbB64 },
        state: state ? { file: state.file, data: stateB64 } : null,
      }),
      { level: 9 }
    );
    const now = new Date();
    // เติม suffix สุ่มกันชนชื่อ: เครื่องเร็ว (Linux CI) สร้างหลาย bundle ใน ms เดียวได้
    // — ชื่อซ้ำจะ overwrite กันเองจน retention นับไม่ครบ (จับได้จากเทสบน ubuntu)
    const file = `sovereign_mesh_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds())}_${crypto.randomUUID().slice(0, 8)}.enc.json`;
    const info: MeshBundleInfo = {
      file,
      createdAt: now.toISOString(),
      keyFingerprint: meshKeyFingerprint(keyHex),
      payloadSize: payload.length,
      dbFile: sql.file,
      dbSha256: sha256Buf(dbBuf),
      dbSize: dbBuf.length,
      stateFile: state?.file || null,
      stateSha256: state ? sha256Buf(fs.readFileSync(state.path)) : null,
      stateSize: state?.size || null,
    };
    const bundle = {
      format: 'sovereign-mesh-v1',
      createdAt: info.createdAt,
      keyFingerprint: info.keyFingerprint,
      payload: meshEncrypt(payload, keyHex),
      manifest: {
        dbFile: info.dbFile,
        dbSha256: info.dbSha256,
        dbSize: info.dbSize,
        stateFile: info.stateFile,
        stateSha256: info.stateSha256,
        stateSize: info.stateSize,
      },
    };
    fs.mkdirSync(this.meshDir, { recursive: true });
    fs.writeFileSync(path.join(this.meshDir, file), JSON.stringify(bundle));
    this.applyRetention();
    console.log(`📡 Mesh bundle: ${file} (${(info.payloadSize / 1024).toFixed(1)} KB encrypted)`);
    return info;
  }

  private applyRetention(): void {
    pruneEncBundles(this.meshDir, MESH_RETAIN);
  }

  /** ลบ bundle เก่าที่ปลายทาง (เก็บ 1 รายการแยกต่อโฟลเดอร์) */
  private applyOffsiteRetention(dir: string): void {
    pruneEncBundles(dir, this.offsiteRetain);
  }

  private async hasBinary(name: string): Promise<boolean> {
    try {
      await execFile('which', [name]);
      return true;
    } catch {
      return false;
    }
  }

  private async pushRsync(src: string, target: string): Promise<void> {
    await execFile('rsync', ['-az', '--quiet', '--timeout=60', src, target], { timeout: MESH_PUSH_TIMEOUT_MS });
  }

  private async pushScp(src: string, target: string): Promise<void> {
    await execFile(
      'scp',
      ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=30', src, target],
      { timeout: MESH_PUSH_TIMEOUT_MS }
    );
  }

  listBundles(): MeshBundleInfo[] {
    if (!fs.existsSync(this.meshDir)) return [];
    return fs
      .readdirSync(this.meshDir)
      .filter((f) => f.endsWith('.enc.json'))
      .map((f) => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(this.meshDir, f), 'utf8'));
          const m = raw.manifest || {};
          return {
            file: f,
            createdAt: raw.createdAt || fs.statSync(path.join(this.meshDir, f)).mtime.toISOString(),
            keyFingerprint: raw.keyFingerprint || '',
            payloadSize: raw.payload ? raw.payload.length : 0,
            dbFile: m.dbFile || '',
            dbSha256: m.dbSha256 || '',
            dbSize: m.dbSize || 0,
            stateFile: m.stateFile || null,
            stateSha256: m.stateSha256 || null,
            stateSize: m.stateSize || null,
          };
        } catch {
          return null;
        }
      })
      .filter((b): b is MeshBundleInfo => !!b)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  latestBundle(): MeshBundleInfo | null {
    return this.listBundles()[0] || null;
  }

  /** อ่าน bundle ล่าสุด (payload เต็ม — สำหรับ pull / push) */
  readLatestBundle(): { file: string; bundle: any } | null {
    const info = this.latestBundle();
    if (!info) return null;
    try {
      const bundle = JSON.parse(fs.readFileSync(path.join(this.meshDir, info.file), 'utf8'));
      return { file: info.file, bundle };
    } catch {
      return null;
    }
  }

  private async raise(event: string, data: any, severity: 'info' | 'warning' | 'critical' = 'info', telegram = false): Promise<void> {
    securityStream.push('MESH', { event, ...data, at: new Date().toISOString() });
    if (severity === 'critical' || telegram) {
      try {
        await prisma.securityEvent.create({
          data: {
            event_type: `MESH_${event.toUpperCase()}`,
            severity,
            description: `📡 [MESH] ${data.text || ''}`,
            raw_data: data,
          },
        });
      } catch {
        // DB เข้าไม่ถึง = แจ้งผ่าน SSE แล้ว
      }
      sendTelegramAlert({
        text: data.text || event,
        severity: severity === 'critical' ? 'critical' : severity === 'warning' ? 'warn' : 'info',
        eventKey: `mesh:${event}`,
      }).catch(() => {});
    }
  }

  /** replicate รอบเดียว: สร้าง bundle → ส่งไปทุกปลายทางที่ตั้งไว้ → retention → audit log */
  async replicate(): Promise<{ ok: boolean; reason?: string; info?: MeshBundleInfo }> {
    if (!this.enabled) return { ok: false, reason: 'Mesh Lite ถูกปิด (MESH_ENABLED=false)' };
    if (!this.outputDir && !this.pushUrl && !this.rsyncTarget && !this.scpTarget) {
      return { ok: false, reason: 'ยังไม่ได้ตั้งปลายทาง (MESH_OUTPUT_DIR / MESH_PUSH_URL / MESH_RSYNC_TARGET / MESH_SCP_TARGET)' };
    }
    const info = this.createBundle();
    if (!info) return { ok: false, reason: this.state.lastError || 'สร้าง bundle ไม่สำเร็จ' };

    this.state.lastReplicateAt = new Date().toISOString();
    const src = path.join(this.meshDir, info.file);
    const attempts: Array<{ target: string; ok: boolean; detail?: string }> = [];

    // 1) local mount (NAS/SMB/NFS/USB) — copy + retention ที่ปลายทาง
    if (this.outputDir) {
      try {
        fs.mkdirSync(this.outputDir, { recursive: true });
        fs.copyFileSync(src, path.join(this.outputDir, info.file));
        this.applyOffsiteRetention(this.outputDir);
        attempts.push({ target: `dir:${this.outputDir}`, ok: true });
        console.log(`📡 Staged to ${this.outputDir}/${info.file}`);
      } catch (err) {
        attempts.push({ target: `dir:${this.outputDir}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    // 2) rsync → remote/local
    if (this.rsyncTarget) {
      try {
        if (!(await this.hasBinary('rsync'))) throw new Error('ไม่พบ rsync ใน container (เพิ่ม rsync ใน Dockerfile)');
        await this.pushRsync(src, this.rsyncTarget);
        attempts.push({ target: `rsync:${this.rsyncTarget}`, ok: true });
        console.log(`📡 rsync → ${this.rsyncTarget}`);
      } catch (err) {
        attempts.push({ target: `rsync:${this.rsyncTarget}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    // 3) scp → remote
    if (this.scpTarget) {
      try {
        if (!(await this.hasBinary('scp'))) throw new Error('ไม่พบ scp ใน container (เพิ่ม openssh-client ใน Dockerfile)');
        await this.pushScp(src, this.scpTarget);
        attempts.push({ target: `scp:${this.scpTarget}`, ok: true });
        console.log(`📡 scp → ${this.scpTarget}`);
      } catch (err) {
        attempts.push({ target: `scp:${this.scpTarget}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    // 4) HTTP push → remote server
    if (this.pushUrl) {
      try {
        const latest = this.readLatestBundle();
        if (!latest) throw new Error('bundle หายหลังสร้าง');
        await axios.post(this.pushUrl, latest.bundle, {
          headers: this.pushToken ? { Authorization: `Bearer ${this.pushToken}` } : {},
          timeout: MESH_PUSH_TIMEOUT_MS,
          maxBodyLength: 1024 * 1024 * 1024,
          maxContentLength: 1024 * 1024 * 1024,
        });
        attempts.push({ target: `http:${this.pushUrl}`, ok: true });
        console.log(`📡 Pushed to ${this.pushUrl} (${info.file})`);
      } catch (err) {
        attempts.push({ target: `http:${this.pushUrl}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    const failed = attempts.filter((a) => !a.ok);
    if (failed.length > 0) {
      this.state.lastError = failed.map((a) => `${a.target}: ${a.detail}`).join('; ');
      this.state.lastSuccessAt = null;
      this.saveState();
      await this.raise(
        'failed',
        { text: `Replication ล้มเหลว: ${this.state.lastError}`, file: info.file, errors: failed },
        'critical',
        true
      );
      await this.recordOffsiteEvent('FAILED', {
        text: `Offsite replication ล้มเหลว: ${this.state.lastError}`,
        file: info.file,
        attempts: failed,
      });
      return { ok: false, reason: this.state.lastError, info };
    }

    this.state.lastSuccessAt = this.state.lastReplicateAt;
    this.state.lastError = null;
    this.saveState();
    await this.raise('ok', { text: `Replicated ${info.file} (${(info.payloadSize / 1024).toFixed(1)} KB)`, file: info.file });
    await this.recordOffsiteEvent('SUCCESS', {
      text: `Offsite replication สำเร็จ: ${info.file}`,
      file: info.file,
      attempts,
    });
    return { ok: true, info };
  }

  /** บันทึกผลลง Security Audit Log (ตาราง securityEvent — ดูในหน้า Security) */
  private async recordOffsiteEvent(
    event: 'SUCCESS' | 'FAILED',
    data: { text: string; file: string; attempts: Array<{ target: string; ok: boolean; detail?: string }> }
  ): Promise<void> {
    try {
      await prisma.securityEvent.create({
        data: {
          event_type: `OFFSITE_SYNC_${event}`,
          severity: event === 'FAILED' ? 'critical' : 'info',
          description: `🔐 [OFFSITE] ${data.text}`,
          raw_data: data,
        },
      });
    } catch {
      // DB เข้าไม่ถึง = แจ้งผ่าน SSE แล้ว
    }
  }

  status(): MeshStatus {
    const keyHex = fs.existsSync(this.keyFile) ? fs.readFileSync(this.keyFile, 'utf8').trim() : null;
    return {
      enabled: this.enabled,
      keyFileExists: !!keyHex,
      keyFingerprint: keyHex ? meshKeyFingerprint(keyHex) : null,
      lastReplicateAt: this.state.lastReplicateAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastError: this.state.lastError,
      bundles: this.listBundles(),
      outputDir: this.outputDir,
      pushUrl: this.pushUrl,
      rsyncTarget: this.rsyncTarget,
      scpTarget: this.scpTarget,
      offsiteRetain: this.offsiteRetain,
      pending: this.hasPendingBackup(),
    };
  }

  start() {
    cron.schedule('* * * * *', () => {
      this.checkSchedule().catch((err) => console.error('📡 Mesh scheduler error:', err));
    });
    console.log(`📡 Mesh Lite started (dir=${this.meshDir}, key=${fs.existsSync(this.keyFile) ? 'ready' : 'จะสร้างเมื่อ replicate ครั้งแรก'})`);
  }

  private async checkSchedule(): Promise<void> {
    if (!this.enabled) return;
    const last = this.state.lastReplicateAt ? Date.parse(this.state.lastReplicateAt) : 0;
    if (Date.now() - last < this.minIntervalMs) return;
    if (!this.hasPendingBackup()) return;
    await this.replicate();
  }
}

export const meshLiteService = new MeshLiteService();