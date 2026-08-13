import { exec } from 'child_process';
import { promisify } from 'util';
import EventEmitter from 'events';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export const threatEmitter = new EventEmitter();

const execAsync = promisify(exec);

// ── การตั้งค่า (env) ──
const ENABLED = process.env.THREAT_DETECTION_ENABLED !== 'false';
const CHECK_INTERVAL_MS = parseInt(process.env.THREAT_CHECK_INTERVAL_MS || '60000', 10);
const CONNECTION_THRESHOLD = parseInt(process.env.THREAT_CONNECTION_THRESHOLD || '100', 10);
const IP_COOLDOWN_MS = parseInt(process.env.THREAT_IP_COOLDOWN_MS || '600000', 10); // กัน alert ซ้ำ IP เดียว
const BASELINE_WINDOW_MS = parseInt(process.env.THREAT_BASELINE_WINDOW_MS || '3600000', 10); // จำ IP นาน 1 ชม.
const ALLOWLIST = new Set(
  (process.env.THREAT_ALLOWLIST_IPS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
// opt-in: คำสั่ง block IP เช่น `netsh advfirewall firewall add rule name="SovereignBlock" dir=in action=block remoteip={ip}`
// ปล่อยว่าง = ปิด auto-block
const FIREWALL_BLOCK_CMD = process.env.FIREWALL_BLOCK_CMD || '';

/** IP ภายในบ้าน/เครื่อง (ไม่ต้องเตือน) */
function isPrivateIp(ip: string): boolean {
  if (ip.includes(':') && !ip.includes('.')) return true; // IPv6 (นอกจาก allowlist)
  return /^(10\.|192\.168\.|127\.|0\.0\.0\.0|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

/** ดึง token ip:port ทั้งหมดในบรรทัด (รองรับ IPv4 และ [IPv6]) */
function ipPortMatches(line: string): string[] {
  const out: string[] = [];
  const re = /\[([0-9a-fA-F:]+)\]:\d+|\b(\d{1,3}(?:\.\d{1,3}){3}):\d+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] || m[2]);
  return out;
}

/** รายการ foreign IP ที่เชื่อมต่ออยู่ (Windows: netstat / Linux: ss) */
async function listForeignIps(): Promise<string[]> {
  const isWin = process.platform === 'win32';
  try {
    const { stdout } = await execAsync(isWin ? 'netstat -ano' : 'ss -tun state established', {
      timeout: 10000,
    });
    const ips = new Set<string>();
    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isWin) {
        if (!/ESTABLISHED/i.test(line)) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const [ip] = ipPortMatches(parts[2]);
          if (ip) ips.add(ip);
        }
      } else {
        const all = ipPortMatches(line);
        if (all.length >= 2) ips.add(all[all.length - 1]); // peer = token สุดท้าย
      }
    }
    return [...ips];
  } catch (err) {
    console.error('Threat detection: cannot read connections:', err instanceof Error ? err.message : err);
    return [];
  }
}

export class ThreatDetectionService {
  private seen = new Map<string, number>(); // baseline: ip → เวลาที่เห็นครั้งล่าสุด
  private lastAlert = new Map<string, number>(); // cooldown ต่อ IP
  private spikeCooldownUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (!ENABLED) {
      console.log('🛡️ Threat detection disabled (THREAT_DETECTION_ENABLED=false)');
      return;
    }
    this.scanNow().catch(() => {});
    this.timer = setInterval(() => this.scanNow().catch(() => {}), CHECK_INTERVAL_MS);
    console.log(
      `🛡️ Threat detection started (ทุก ${(CHECK_INTERVAL_MS / 1000).toFixed(0)}s, threshold ${CONNECTION_THRESHOLD} connections)`
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** ตรวจครั้งเดียว — คืนเหตุการณ์ที่พบ (ถ้ามี) */
  async scanNow(): Promise<any[]> {
    const events: any[] = [];
    const ips = await listForeignIps();
    const now = Date.now();
    const external = ips.filter((ip) => !isPrivateIp(ip) && !ALLOWLIST.has(ip));

    // 1) IP ภายนอกตัวใหม่ (ไม่เคยเห็นใน baseline)
    for (const ip of external) {
      const known = this.seen.has(ip);
      this.seen.set(ip, now);
      if (known) continue;
      if ((this.lastAlert.get(ip) || 0) + IP_COOLDOWN_MS > now) continue; // cooldown
      this.lastAlert.set(ip, now);
      const evt = await this.recordAnomaly(
        ip,
        `การเชื่อมต่อจาก IP ภายนอกใหม่: ${ip}`,
        'warning',
        { total: ips.length }
      );
      if (evt) events.push(evt);
    }

    // ตัด baseline ที่เก่าเกิน window (ไม่เห็นอีก → ถ้าโผล่ใหม่ถือเป็น "ใหม่")
    for (const [ip, t] of this.seen) {
      if (now - t > BASELINE_WINDOW_MS) this.seen.delete(ip);
    }

    // 2) จำนวนการเชื่อมต่อสูงผิดปกติ (spike)
    if (ips.length > CONNECTION_THRESHOLD && now > this.spikeCooldownUntil) {
      const evt = await this.recordAnomaly(
        null,
        `จำนวนการเชื่อมต่อสูงผิดปกติ: ${ips.length} (> ${CONNECTION_THRESHOLD})`,
        'critical',
        { total: ips.length }
      );
      if (evt) events.push(evt);
      this.spikeCooldownUntil = now + 10 * 60 * 1000; // กันยิงซ้ำถี่เกิน 10 นาที
    }

    return events;
  }

  private async recordAnomaly(
    ip: string | null,
    description: string,
    severity: 'warning' | 'critical',
    raw: any
  ): Promise<any | null> {
    try {
      const event = await prisma.securityEvent.create({
        data: { event_type: 'ANOMALY', severity, source_ip: ip, description, raw_data: raw },
      });
      // Auto-block (opt-in) — เฉพาะ IP ใหม่ภายนอก
      let blocked = false;
      if (FIREWALL_BLOCK_CMD && ip && severity === 'warning') {
        try {
          const cmd = FIREWALL_BLOCK_CMD.replace(/\{ip\}/g, ip);
          await execAsync(cmd, { timeout: 15000 });
          blocked = true;
          console.warn(`🚫 Auto-blocked ${ip}`);
        } catch (err) {
          console.error('Firewall block failed:', err instanceof Error ? err.message : err);
        }
      }
      threatEmitter.emit('threat', { ...event, blocked });
      return { ...event, blocked };
    } catch (err) {
      console.error('Failed to record anomaly:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}

export const threatDetector = new ThreatDetectionService();
