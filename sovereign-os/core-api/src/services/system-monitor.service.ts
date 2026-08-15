import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { securityStream } from './security-stream.service';
import { sendTelegram } from '../modules/telegram/telegram.routes';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

// ── System Monitor (Survival Pillar) ──
// เฝ้าดิสก์/เมม/CPU — แจ้งเตือนก่อนที่ระบบจะตายเงียบ ๆ (ดิสก์เต็ม หน่วยความจำหมด)
// แจ้งผ่าน SSE + securityEvent + Telegram (ถ้าตั้ง credentials ไว้)

const DISK_FREE_ALERT_MB = parseInt(process.env.DISK_FREE_ALERT_MB || '5120', 10); // เหลือ <5GB
const MEM_USED_ALERT_PCT = parseInt(process.env.MEM_USED_ALERT_PCT || '95', 10);
const CHECK_INTERVAL_MS = parseInt(process.env.SYSTEM_CHECK_INTERVAL_MS || '300000', 10); // ทุก 5 นาที
const ALERT_COOLDOWN_MS = parseInt(process.env.SYSTEM_ALERT_COOLDOWN_MS || '3600000', 10); // ห้ามซ้ำภายใน 1 ชม.

export interface DiskInfo {
  totalMb: number;
  freeMb: number;
  usedPct: number;
}

/** parse บรรทัดผลลัพธ์ของ `df -Pk` (Filesystem 1024-blocks Used Available Capacity Mounted) */
export function parseDfLine(line: string): DiskInfo | null {
  const m = line.trim().split(/\s+/);
  if (m.length < 6) return null;
  const totalMb = Number(m[1]);
  const freeMb = Number(m[3]);
  if (!Number.isFinite(totalMb) || !Number.isFinite(freeMb) || totalMb <= 0) return null;
  return { totalMb, freeMb, usedPct: Math.round(((totalMb - freeMb) / totalMb) * 100) };
}

/** อ่านพื้นที่ดิสก์ของไดรฟ์/เมาท์ที่เก็บข้อมูลจริง — ใช้ data dir ก่อน (bind mount → ดิสก์ host จริง) */
export async function getDiskInfo(): Promise<DiskInfo | null> {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const target = fs.existsSync(dataDir) ? dataDir : process.cwd();
    if (process.platform === 'win32') {
      const drive = path.parse(target).root.replace(':', '');
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-PSDrive -Name '${drive}' | Select-Object @{n="t";e={[math]::Round($_.Used/1MB)}},@{n="f";e={[math]::Round($_.Free/1MB)}} | ConvertTo-Json -Compress`,
        ],
        { timeout: 15000, windowsHide: true }
      );
      const j = JSON.parse(stdout.trim());
      const totalMb = Number(j.t) + Number(j.f);
      const freeMb = Number(j.f);
      if (!Number.isFinite(totalMb) || !Number.isFinite(freeMb) || totalMb <= 0) return null;
      return { totalMb, freeMb, usedPct: Math.round((Number(j.t) / totalMb) * 100) };
    }
    const { stdout } = await execFileAsync('df', ['-Pk', target], { timeout: 15000 });
    const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('Filesystem'));
    if (lines.length === 0) return null;
    return parseDfLine(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

export class SystemMonitor {
  private lastAlertAt: Record<string, number> = {};

  private canAlert(key: string): boolean {
    const now = Date.now();
    if (now - (this.lastAlertAt[key] || 0) < ALERT_COOLDOWN_MS) return false;
    this.lastAlertAt[key] = now;
    return true;
  }

  private async raise(severity: 'warning' | 'critical', eventType: string, text: string): Promise<void> {
    securityStream.push('SYSTEM', { event: eventType, severity, text, at: new Date().toISOString() });
    try {
      await prisma.securityEvent.create({
        data: { event_type: eventType, severity, description: text, raw_data: { source: 'system-monitor' } },
      });
    } catch {
      // DB เข้าไม่ถึง = แจ้งผ่าน SSE ไปแล้ว
    }
    if (process.env.TELEGRAM_BOT_TOKEN) {
      sendTelegram(text).catch(() => {});
    } else {
      console.warn(`🖥️ ${eventType}: ${text}`);
    }
  }

  async check(): Promise<{ disk: DiskInfo | null; memUsedPct: number; cpuLoadPct: number; alerts: string[] }> {
    const alerts: string[] = [];
    const disk = await getDiskInfo();

    if (disk && disk.freeMb < DISK_FREE_ALERT_MB && this.canAlert('disk')) {
      alerts.push('disk-low');
      await this.raise(
        'warning',
        'SYSTEM_DISK_LOW',
        `⚠️ ดิสก์เหลือ ${(disk.freeMb / 1024).toFixed(1)} GB (ใช้ไป ${disk.usedPct}%) — ลบ backup เก่า (retention) หรือเพิ่มพื้นที่ด่วน`
      );
    }

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsedPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;
    if (memUsedPct >= MEM_USED_ALERT_PCT && this.canAlert('mem')) {
      alerts.push('mem-high');
      await this.raise(
        'critical',
        'SYSTEM_MEM_HIGH',
        `🚨 หน่วยความจำเต็ม ${memUsedPct}% (${Math.round(freeMem / 1024 / 1024)} MB เหลือ) — restart container หรือเพิ่ม RAM`
      );
    }

    const cpuLoadPct = Math.round((os.loadavg()[0] / Math.max(os.cpus().length, 1)) * 100);
    return { disk, memUsedPct, cpuLoadPct, alerts };
  }

  start(): void {
    this.check().catch(() => {});
    setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL_MS);
    console.log(`🖥️ System Monitor เริ่ม (disk < ${DISK_FREE_ALERT_MB}MB · mem ≥ ${MEM_USED_ALERT_PCT}% · ทุก ${CHECK_INTERVAL_MS / 1000}s)`);
  }
}

export const systemMonitor = new SystemMonitor();