import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { piHole } from './pihole.service';
import { threatIntel } from './threat-intel.service';

// ── AI Analyst (Pillar 3 — ความฉลาดรวมศูนย์) ──
// รวมสถานะ (security events + IDS alerts + threat intel + Pi-hole) → ส่ง Ollama
// วิเคราะห์เป็นภาษาไทย → เก็บผลล่าสุด + แจ้งเตือนผ่าน Telegram (ไม่บังคับ)

export const prisma = new PrismaClient();

const LAST_REPORT_FILE = path.resolve(process.cwd(), 'data', 'ai-analyst-last.json');

export interface AnalystReport {
  generatedAt: string;
  summary: string;
  stats: { events24h: number; alerts24h: number; intelTotal: number; blockedDomains: number };
  recommendations: string[];
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';

async function sendTelegram(text: string): Promise<boolean> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
    return true;
  } catch {
    return false;
  }
}

export function extractRecommendations(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•\d.、】]/.test(l) && l.length > 8 && l.length < 300);
  return lines.slice(0, 8);
}

class AiAnalystService {
  private timer: NodeJS.Timeout | null = null;
  lastReport: AnalystReport | null = null;
  lastError: string | null = null;
  lastRunAt: Date | null = null;

  async analyzeNow(): Promise<AnalystReport> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [events, alerts, intel, piholeSummary] = await Promise.all([
      prisma.securityEvent.findMany({ where: { timestamp: { gte: since } }, orderBy: { timestamp: 'desc' }, take: config.nextgen.aiAnalystMaxEvents }),
      prisma.securityEvent.findMany({ where: { event_type: 'IDS_ALERT', timestamp: { gte: since } }, orderBy: { timestamp: 'desc' }, take: config.nextgen.aiAnalystMaxEvents }),
      threatIntel.stats(),
      piHole.getSummary().catch(() => null),
    ]);

    const stats = {
      events24h: events.length,
      alerts24h: alerts.length,
      intelTotal: intel.total,
      blockedDomains: intel.byType?.DOMAIN || 0,
    };

    const eventLines = events.slice(0, 15).map((e) => `- [${e.timestamp.toISOString().slice(0, 16)}] ${e.event_type} (${e.severity}) ${e.description} ${e.source_ip || ''}->${e.dest_ip || ''}`);
    const dnsLine = piholeSummary
      ? `Pi-hole: ${piholeSummary.dnsQueriesToday} queries, ${piholeSummary.adsBlockedToday} blocked (${piholeSummary.adsPercentageToday}%), ${piholeSummary.domainsBeingBlocked} domains in blocking list`
      : 'Pi-hole: ไม่เชื่อมต่อ';

    const prompt = `คุณคือนักวิเคราะห์ความปลอดภัยไซเบอร์ประจำบ้าน (Sovereign OS) วิเคราะห์สถานการณ์ล่าสุด 24 ชม. แล้วตอบเป็นภาษาไทย กระชับ

ข้อมูล (24 ชม.):
- เหตุการณ์รวม: ${stats.events24h} เหตุการณ์, IDS alerts: ${stats.alerts24h}
- ฐานข้อมูลภัยคุกคาม (Threat Intel): ${intel.total} รายการ (IP ${intel.byType?.IP || 0}, โดเมน ${intel.byType?.DOMAIN || 0}), จำแนก: ${JSON.stringify(intel.byCategory)}
- ${dnsLine}
- เหตุการณ์ล่าสุด:
${eventLines.join('\n') || '- ไม่มีเหตุการณ์'}

ตอบ:
1) สรุปสั้น 3-5 บรรทัดว่าสถานการณ์ปกติหรือต้องกังวล
2) รายการความเสี่ยง/ข้อควรระวัง (ถ้ามี)
3) ข้อแนะนำป้องกัน 3 ข้อ (เรียงเป็น - คำแนะนำ)`;

    let summary = '';
    try {
      const resp = await axios.post(
        `${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/generate`,
        { model: config.nextgen.aiAnalystModel, prompt, stream: false, keep_alive: OLLAMA_KEEP_ALIVE },
        { timeout: 180000 }
      );
      summary = String(resp?.data?.response || '').trim();
    } catch (err: any) {
      this.lastError = `Ollama ไม่ออก: ${err?.message || err}`;
      summary = `AI ไม่พร้อมใช้งาน (${this.lastError}) — สรุปจากข้อมูลดิบ:\n${eventLines.slice(0, 8).join('\n') || 'ไม่มีเหตุการณ์'}`;
    }

    const report: AnalystReport = {
      generatedAt: new Date().toISOString(),
      summary,
      stats,
      recommendations: extractRecommendations(summary),
    };
    this.lastReport = report;
    this.lastRunAt = new Date();
    this.lastError = null;
    try {
      fs.mkdirSync(path.dirname(LAST_REPORT_FILE), { recursive: true });
      fs.writeFileSync(LAST_REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    } catch {}
    if (config.nextgen.aiAnalystTelegram) {
      const alertLevel = events.some((e) => e.severity === 'critical') ? '🚨' : events.length > 0 ? '⚠️' : '✅';
      const msg = `<b>${alertLevel} AI Security Analyst</b>\n${summary.slice(0, 3500)}`;
      sendTelegram(msg).catch(() => {});
    }
    return report;
  }

  async last(): Promise<AnalystReport | null> {
    if (this.lastReport) return this.lastReport;
    try {
      return JSON.parse(fs.readFileSync(LAST_REPORT_FILE, 'utf8')) as AnalystReport;
    } catch {
      return null;
    }
  }

  start() {
    if (!config.nextgen.aiAnalystEnabled || this.timer) return false;
    const ms = Math.max(1, config.nextgen.aiAnalystIntervalMin) * 60 * 1000;
    this.timer = setInterval(() => {
      this.analyzeNow().catch((err) => {
        this.lastError = String(err?.message || err);
      });
    }, ms);
    this.analyzeNow().catch(() => {}); // รันทันทีตอน boot (ถ้าเปิด)
    return true;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const aiAnalyst = new AiAnalystService();