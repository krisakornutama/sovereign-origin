// src/services/telegram-alert.service.ts
// Telegram Remote Alerts — ชุด 🟡 ข้อ 3
// Dispatcher เกรด production: severity filter → dedup & rate-limit → HTML + dashboard link
// - กัน Telegram spam: dedup ตาม eventKey ใน 5 นาที, critical ข้าม dedup แต่ cap 5 msg/min
// - soft-fail: ไม่มี token / เน็ตตัด = log เงียบ ไม่ทำให้ request หลักชะงัก
import axios from 'axios';
import { config } from '../config';
import { getTelegramCredentials } from './telegram-credentials.service';

export type AlertSeverity = 'critical' | 'warn' | 'info';

export interface TelegramAlertConfig {
  minSeverity: AlertSeverity;
  dedupWindowMs: number;
  criticalRatePerMin: number;
  globalRatePerMin: number;
  dashboardUrl: string;
}

export interface TelegramAlertPayload {
  text: string;
  severity?: AlertSeverity;
  /** key สำหรับ dedup (default: เนื้อหาข้อความ) — ใช้กัน sensor flapping / log loop */
  eventKey?: string;
}

export interface TelegramAlertDeps {
  /** ส่ง HTML ผ่าน Telegram API จริง — inject ได้เพื่อเทสต์ */
  send: (html: string) => Promise<boolean>;
  now?: () => number;
}

// ── Pure: น้ำหนัก + ไอคอน + ตัวกรอง ──
export const ALERT_SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

export const ALERT_SEVERITY_ICON: Record<AlertSeverity, string> = {
  critical: '🚨',
  warn: '⚠️',
  info: 'ℹ️',
};

export function severityWeight(severity: AlertSeverity): number {
  return ALERT_SEVERITY_WEIGHT[severity];
}

export function isSeverityEnabled(severity: AlertSeverity, minSeverity: AlertSeverity): boolean {
  return severityWeight(severity) >= severityWeight(minSeverity);
}

/** จัดรูปแบบเป็น HTML พร้อมไอคอน + ป้ายระดับ + ลิงก์ dashboard (ถ้าตั้ง) */
export function formatTelegramAlert(
  text: string,
  severity: AlertSeverity,
  dashboardUrl = ''
): string {
  const label = severity.toUpperCase();
  const header = `<b>${ALERT_SEVERITY_ICON[severity]} ${label}</b>`;
  const link = dashboardUrl ? `\n\n<a href="${dashboardUrl}">🖥️ Sovereign OS Dashboard</a>` : '';
  return `${header}\n${text}${link}`;
}

export class TelegramAlertDispatcher {
  private dedupMap = new Map<string, number>();
  private criticalTimestamps: number[] = [];
  private allTimestamps: number[] = [];
  private stats = { sent: 0, suppressedDedup: 0, suppressedRate: 0, suppressedSeverity: 0 };

  constructor(
    private deps: TelegramAlertDeps,
    private cfg: TelegramAlertConfig
  ) {
    if (!Number.isFinite(cfg.dedupWindowMs) || cfg.dedupWindowMs <= 0) {
      throw new Error('TELEGRAM_DEDUP_WINDOW_MS must be > 0');
    }
    if (!Number.isFinite(cfg.criticalRatePerMin) || cfg.criticalRatePerMin < 0) {
      throw new Error('TELEGRAM_CRITICAL_RATE_PER_MIN must be >= 0');
    }
    if (!Number.isFinite(cfg.globalRatePerMin) || cfg.globalRatePerMin < 0) {
      throw new Error('TELEGRAM_GLOBAL_RATE_PER_MIN must be >= 0');
    }
    if (!(cfg.minSeverity in ALERT_SEVERITY_WEIGHT)) {
      throw new Error(`TELEGRAM_MIN_SEVERITY must be one of ${Object.keys(ALERT_SEVERITY_WEIGHT).join(', ')}`);
    }
  }

  getStats() {
    return { ...this.stats };
  }

  async send(payload: TelegramAlertPayload): Promise<{ sent: boolean; reason: string }> {
    const severity = payload.severity ?? 'info';
    const now = (this.deps.now ?? Date.now)();

    // 1) Severity filter
    if (!isSeverityEnabled(severity, this.cfg.minSeverity)) {
      this.stats.suppressedSeverity++;
      return { sent: false, reason: `below_min_severity (${severity} < ${this.cfg.minSeverity})` };
    }

    // 2) Dedup — เฉพาะ critical ข้าม dedup (emergency bypass) แต่ยังโดน rate cap
    const key = payload.eventKey ?? payload.text.replace(/\s+/g, ' ').trim();
    const lastSent = this.dedupMap.get(key);
    if (lastSent !== undefined && now - lastSent < this.cfg.dedupWindowMs && severity !== 'critical') {
      this.stats.suppressedDedup++;
      return { sent: false, reason: `dedup (window ${this.cfg.dedupWindowMs}ms)` };
    }

    // 3) Rate limit — critical 5/min + global cap กัน 429
    this.pruneTimestamps(now);
    if (severity === 'critical' && this.criticalTimestamps.length >= this.cfg.criticalRatePerMin) {
      this.stats.suppressedRate++;
      return { sent: false, reason: `critical_rate (${this.cfg.criticalRatePerMin}/min)` };
    }
    if (this.allTimestamps.length >= this.cfg.globalRatePerMin) {
      this.stats.suppressedRate++;
      return { sent: false, reason: `global_rate (${this.cfg.globalRatePerMin}/min)` };
    }

    // 4) ส่งจริง — soft-fail: error = log เงียบ ไม่ throw
    const html = formatTelegramAlert(payload.text, severity, this.cfg.dashboardUrl);
    try {
      const ok = await this.deps.send(html);
      if (!ok) return { sent: false, reason: 'send_returned_false' };
    } catch (err) {
      console.error('Telegram alert send failed:', err instanceof Error ? err.message : err);
      return { sent: false, reason: 'network_error' };
    }

    this.dedupMap.set(key, now);
    this.criticalTimestamps.push(now);
    this.allTimestamps.push(now);
    this.stats.sent++;
    return { sent: true, reason: 'sent' };
  }

  private pruneTimestamps(now: number): void {
    const cutoff = now - 60_000;
    this.criticalTimestamps = this.criticalTimestamps.filter((t) => t >= cutoff);
    this.allTimestamps = this.allTimestamps.filter((t) => t >= cutoff);
    if (this.dedupMap.size > 200) {
      for (const [k, t] of this.dedupMap) {
        if (now - t >= this.cfg.dedupWindowMs) this.dedupMap.delete(k);
      }
    }
  }
}

// ── Singleton สำหรับ wiring ใน app ──
// credential อ่านแบบ dynamic (DB override จากหน้า Settings → env fallback)
// เพื่อให้ตั้งค่า/แก้ token ผ่าน UI ได้โดยไม่ต้อง restart ตัว service

async function defaultSender(html: string): Promise<boolean> {
  const creds = await getTelegramCredentials();
  if (!creds.botToken || !creds.chatId) {
    console.warn('Telegram credentials not set — alert suppressed silently');
    return Promise.resolve(false);
  }
  return axios
    .post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      chat_id: creds.chatId,
      text: html,
      parse_mode: 'HTML',
    })
    .then(() => true)
    .catch((err) => {
      console.error('Telegram send failed:', err instanceof Error ? err.message : err);
      return false;
    });
}

export function createTelegramAlertDispatcher(
  cfg: TelegramAlertConfig,
  deps?: Partial<TelegramAlertDeps>
): TelegramAlertDispatcher {
  return new TelegramAlertDispatcher(
    { send: defaultSender, ...deps },
    cfg
  );
}

// Singleton ตัวเดียวใช้ทั่ว app (server + mesh + actuation) — อ่าน config กลาง
let _dispatcher: TelegramAlertDispatcher | null = null;
export function getTelegramAlertDispatcher(): TelegramAlertDispatcher {
  if (!_dispatcher) {
    _dispatcher = createTelegramAlertDispatcher(config.telegramAlert);
  }
  return _dispatcher;
}

// ── DI (ใช้ในเทสต์) — แทน sender ของ singleton ชั่วคราว แบบเดียวกับ setVisionOllama ──
// ตั้งแล้ว sendTelegramAlert จะสร้าง dispatcher ใหม่ที่ใช้ DI sender (dedup/rate state เริ่มใหม่
// ต่อการตั้งค่าแต่ละครั้ง — กัน state ค้างข้ามชุดเทส) และ "ไม่ยิง network" เพราะไม่ผ่าน defaultSender
export function setTelegramAlertSender(fn: ((html: string) => Promise<boolean>) | null): void {
  diSender = fn;
}
let diSender: ((html: string) => Promise<boolean>) | null = null;

/** ส่ง alert ผ่าน dispatcher (severity gate + dedup + rate-limit) — fire-and-forget ปลอดภัย */
export function sendTelegramAlert(
  payload: TelegramAlertPayload
): Promise<{ sent: boolean; reason: string }> {
  /* DI (เทส): ใช้ dispatcher สดที่ผูก sender ปลอม — ตัดสินจากค่าปัจจุบันของ diSender ทุกครั้ง
     เพื่อให้ setTelegramAlertSender(null) กลับไป singleton จริงได้ทันที */
  const diSenderNow = diSender;
  if (diSenderNow) {
    return createTelegramAlertDispatcher(config.telegramAlert, { send: diSenderNow }).send(payload);
  }
  return getTelegramAlertDispatcher().send(payload);
}