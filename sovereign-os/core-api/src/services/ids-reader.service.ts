import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { threatIntel } from './threat-intel.service';
import { securityStream } from './security-stream.service';

export const prisma = new PrismaClient();

// ── IDS reader (Suricata eve.json) ──
// อ่านท้ายไฟล์ eve.json แล้วแปลง alert เป็น securityEvent (event_type = IDS_ALERT)
// รองรับการ rotate (ไฟล์สั้นลง = อ่านใหม่), dedupe alert ซ้ำตาม signature+source ภายใน 10 นาที

export interface EveAlert {
  signature: string;
  severity: number;
  category: string | null;
  sourceIp: string;
  destIp: string;
  srcPort: number | null;
  destPort: number | null;
  timestamp: string;
}

const STATE_FILE = path.resolve(process.cwd(), 'data', 'ids-eve-offset.txt');

export function parseEveLine(line: string): EveAlert | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || parsed.event_type !== 'alert' || !parsed.alert) return null;
  const src = parsed.src_ip || '';
  const dst = parsed.dest_ip || '';
  return {
    signature: String(parsed.alert.signature || `suricata alert ${parsed.alert.gid || '?'}/${parsed.alert.rev || '?'}`),
    severity: Number(parsed.alert.severity ?? 3),
    category: parsed.alert.category ? String(parsed.alert.category) : null,
    sourceIp: src,
    destIp: dst,
    srcPort: parsed.src_port ?? null,
    destPort: parsed.dest_port ?? null,
    timestamp: String(parsed.timestamp || new Date().toISOString()),
  };
}

export function severityOf(sev: number | null): 'critical' | 'warning' | 'info' {
  if (sev === 1) return 'critical';
  if (sev === 2) return 'warning';
  return 'info';
}

function readOffsetFromDisk(): number {
  try {
    return parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function writeOffsetToDisk(offset: number) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, String(offset), 'utf8');
  } catch {}
}

class IdsReaderService {
  private offset = 0;
  private lastSeenSig = new Map<string, number>(); // signature|src_ip -> timestamp
  private pollTimer: NodeJS.Timeout | null = null;
  private lastPollError: string | null = null;
  private lastReadAt: Date | null = null;

  get configured(): boolean {
    return !!config.nextgen.idsEveLog;
  }

  logExists(): boolean {
    if (!this.configured) return false;
    try {
      return fs.existsSync(config.nextgen.idsEveLog);
    } catch {
      return false;
    }
  }

  fileSize(): number {
    try {
      return fs.statSync(config.nextgen.idsEveLog).size;
    } catch {
      return 0;
    }
  }

  readNewLines(): string[] {
    if (!this.logExists()) return [];
    const file = config.nextgen.idsEveLog;
    try {
      const size = fs.statSync(file).size;
      // rotate — ไฟล์สั้นลง ให้อ่านท้ายสุดเท่าที่จำกัด
      if (size < this.offset) this.offset = Math.max(0, size - config.nextgen.idsTailBytes);
      if (size === this.offset) return [];
      const start = Math.max(this.offset, 0);
      const len = Math.min(config.nextgen.idsTailBytes, size - start);
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      fs.closeSync(fd);
      this.offset = size;
      writeOffsetToDisk(size);
      this.lastReadAt = new Date();
      return buf.toString('utf8').split('\n');
    } catch (err: any) {
      this.lastPollError = err?.message || String(err);
      return [];
    }
  }

  async poll(): Promise<number> {
    if (!this.configured || !this.logExists()) return 0;
    const lines = this.readNewLines();
    let written = 0;
    for (const line of lines) {
      const alert = parseEveLine(line);
      if (!alert) continue;
      const key = `${alert.signature}|${alert.sourceIp}`;
      const now = Date.now();
      const last = this.lastSeenSig.get(key) || 0;
      if (now - last < 10 * 60 * 1000) continue; // dedupe 10 นาที
      this.lastSeenSig.set(key, now);
      if (this.lastSeenSig.size > 2000) {
        const oldest = [...this.lastSeenSig.entries()].sort((a, b) => a[1] - b[1])[0];
        if (oldest) this.lastSeenSig.delete(oldest[0]);
      }
      const severity = severityOf(alert.severity);
      try {
        await prisma.securityEvent.create({
          data: {
            event_type: 'IDS_ALERT',
            severity,
            source_ip: alert.sourceIp || null,
            dest_ip: alert.destIp || null,
            description: `[Suricata] ${alert.signature}${alert.category ? ` (${alert.category})` : ''}`,
            raw_data: { src_port: alert.srcPort, dest_port: alert.destPort, sig: alert.signature, sev: alert.severity },
          },
        });
        written++;
        securityStream.push('IDS_ALERT', {
          signature: alert.signature,
          severity,
          sourceIp: alert.sourceIp || null,
          destIp: alert.destIp || null,
          srcPort: alert.srcPort,
          destPort: alert.destPort,
          category: alert.category,
        });
        // ส่ง IP ต้นทางให้ Threat Intelligence ตรวจเจอเพิ่ม (best effort)
        if (alert.sourceIp && !alert.sourceIp.includes(':')) {
          threatIntel.matchIps([alert.sourceIp]).catch(() => {});
        }
      } catch {}
    }
    return written;
  }

  async recentAlerts(take = 50): Promise<any[]> {
    try {
      return await prisma.securityEvent.findMany({
        where: { event_type: 'IDS_ALERT' },
        orderBy: { timestamp: 'desc' },
        take,
      });
    } catch {
      return [];
    }
  }

  async stats(): Promise<any> {
    return {
      configured: this.configured,
      fileExists: this.logExists(),
      fileSize: this.fileSize(),
      offset: this.offset,
      lastReadAt: this.lastReadAt,
      lastError: this.lastPollError,
      pollIntervalMs: config.nextgen.idsPollIntervalMs,
    };
  }

  start() {
    if (!this.configured || this.pollTimer) return false;
    this.offset = readOffsetFromDisk();
    // ถ้า offset เก่ากว่า tail window มาก ให้เริ่มจากท้ายสุดก่อน (ไม่ flooded ตั้งแต่ boot)
    const size = this.fileSize();
    if (size - this.offset > config.nextgen.idsTailBytes) {
      this.offset = Math.max(0, size - config.nextgen.idsTailBytes);
    }
    this.poll().catch(() => {});
    this.pollTimer = setInterval(() => {
      this.poll().catch(() => {});
    }, config.nextgen.idsPollIntervalMs);
    return true;
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const idsReader = new IdsReaderService();