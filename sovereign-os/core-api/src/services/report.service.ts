import cron from 'node-cron';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { sendTelegram, sendTelegramPhoto } from '../modules/telegram/telegram.routes';
import { buildReportPng } from './chart-snapshot.service';

export const prisma = new PrismaClient();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
const MODEL = process.env.AI_MODEL || 'gemma3:4b';

// metric ที่ส่งกราฟแนวโน้มไป Telegram ด้วย (เฉพาะที่มีข้อมูลจริง)
const REPORT_CHART_METRICS = ['temperature', 'humidity', 'battery_soc', 'power_kw', 'water_level_cm', 'rainfall'];

interface Stats {
  latest: Record<string, number>;
  agg: Record<string, { min: number; avg: number; max: number }>;
  alertsToday: number;
  devices: { total: number; online: number };
  securityEvents: number;
}

/** ดึงข้อมูล 24 ชม. ที่ผ่านมา (หรือตามช่วง) จาก TimescaleDB */
async function gatherStats(hours: number): Promise<Stats> {
  const since = `NOW() - INTERVAL '${hours} hours'`;

  // ค่าล่าสุดของทุก metric
  const latestRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT DISTINCT ON (metric) metric, value
     FROM sensor_telemetry
     WHERE time >= ${since}
     ORDER BY metric, time DESC`
  );

  // min / avg / max ต่อ metric
  const aggRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT metric,
            MIN(value) AS min_value,
            ROUND(AVG(value)::numeric, 1) AS avg_value,
            MAX(value) AS max_value
     FROM sensor_telemetry
     WHERE time >= ${since}
     GROUP BY metric ORDER BY metric`
  );

  const latest: Record<string, number> = {};
  for (const r of latestRows) latest[r.metric] = r.value;

  const agg: Record<string, { min: number; avg: number; max: number }> = {};
  for (const r of aggRows) {
    agg[r.metric] = {
      min: Number(r.min_value),
      avg: Number(r.avg_value),
      max: Number(r.max_value),
    };
  }

  // จำนวน alert + อุปกรณ์ออนไลน์ + security events
  const sinceDate = new Date(Date.now() - hours * 3600 * 1000);
  const [alertsToday, devicesRows, securityEvents] = await Promise.all([
    prisma.automationAlert.count({ where: { timestamp: { gte: sinceDate } } }),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE last_heartbeat >= NOW() - INTERVAL '5 minutes') AS online
       FROM devices`
    ),
    prisma.securityEvent.count({ where: { timestamp: { gte: sinceDate } } }),
  ]);

  return {
    latest,
    agg,
    alertsToday,
    devices: { total: Number(devicesRows[0]?.total || 0), online: Number(devicesRows[0]?.online || 0) },
    securityEvents,
  };
}

/** เรียก Ollama ให้สรุปข้อมูลเป็นภาษาไทย (ถ้า offline → null) */
async function summarizeWithAI(type: string, stats: Stats): Promise<string | null> {
  try {
    const rangeText = type === 'weekly' ? '7 วันที่ผ่านมา' : '24 ชั่วโมงที่ผ่านมา';
    const prompt = `คุณคือผู้ช่วยรายงานของระบบ Sovereign OS (ระบบเฝ้าระวังบ้าน/ฟาร์มอัจฉริยะ)
จงสรุปข้อมูลเซ็นเซอร์ของ${rangeText}เป็นภาษาไทย ให้กระชับและอ่านง่าย

ข้อมูล (ค่าล่าสุด / ค่าเฉลี่ย / ต่ำสุด-สูงสุด):
${JSON.stringify(stats, null, 2)}

รูปแบบคำตอบ:
1. บรรทัดแรก: สรุปภาพรวม 1-2 ประโยค
2. ตามด้วย bullet 3-5 ข้อ ที่เน้นจุดสำคัญ/ผิดปกติ (แบตเตอรี่ต่ำ, อุณหภูมิสูง, ฝนตก, อุปกรณ์ออฟไลน์, เหตุการณ์ความปลอดภัย)
3. บรรทัดสุดท้าย: คำแนะนำ 1 ประโยค

ห้ามแต่งข้อมูลเกินจากที่ให้มา หากไม่มีข้อมูลให้บอกว่า "ยังไม่มีข้อมูลเซ็นเซอร์ในระบบ"`;

    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model: MODEL, prompt, stream: false, options: { temperature: 0.3 }, keep_alive: OLLAMA_KEEP_ALIVE },
      { timeout: 120000 }
    );
    const text = (response.data?.response || '').trim();
    return text || null;
  } catch (err) {
    console.error('Report AI summarize error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** สร้าง fallback summary แบบข้อความล้วน (กรณี Ollama offline) */
function buildFallbackSummary(stats: Stats): string {
  const lines: string[] = [];
  const interesting = ['battery_soc', 'water_level_cm', 'temperature', 'humidity', 'rainfall', 'power_kw', 'soil_moisture'];
  for (const m of interesting) {
    const a = stats.agg[m];
    if (a) lines.push(`• ${m}: เฉลี่ย ${a.avg}, ช่วง ${a.min}-${a.max}`);
  }
  lines.push(
    `• อุปกรณ์: ออนไลน์ ${stats.devices.online}/${stats.devices.total}`,
    `• การแจ้งเตือน: ${stats.alertsToday} ครั้ง`,
    `• เหตุการณ์ความปลอดภัย: ${stats.securityEvents} ครั้ง`
  );
  return lines.join('\n') || 'ยังไม่มีข้อมูลเซ็นเซอร์ในระบบ';
}

class ReportService {
  start() {
    // ทุกเช้า 06:00 → รายงานประจำวัน
    cron.schedule('0 6 * * *', () => {
      this.generateNow('daily').catch((err) => console.error('Daily report error:', err));
    });
    // ทุกวันอาทิตย์ 07:00 → รายงานประจำสัปดาห์
    cron.schedule('0 7 * * 0', () => {
      this.generateNow('weekly').catch((err) => console.error('Weekly report error:', err));
    });
    console.log('📊 Report Service started (daily 06:00, weekly Sun 07:00)');
  }

  async generateNow(type: 'daily' | 'weekly'): Promise<any> {
    const hours = type === 'weekly' ? 24 * 7 : 24;
    const stats = await gatherStats(hours);

    const title =
      type === 'weekly'
        ? `📅 รายงานสรุปประจำสัปดาห์ (${new Date().toLocaleDateString('th-TH')})`
        : `🌅 รายงานสรุปประจำวัน (${new Date().toLocaleDateString('th-TH')})`;

    const aiSummary = await summarizeWithAI(type, stats);
    const summary = aiSummary || buildFallbackSummary(stats);

    const report = await prisma.dailyReport.create({
      data: { type, title, summary },
    });

    // ส่ง Telegram (ถ้ามีการตั้งค่า)
    const telegramText = `${title}\n\n${summary}\n\n— Sovereign OS`;
    await sendTelegram(telegramText);

    // ส่งกราฟรวมหลาย metric ในภาพเดียว ตามหลังข้อความ (เฉพาะที่มีข้อมูล)
    const periodText = type === 'weekly' ? '7 วัน' : '24 ชม.';
    const bucketMinutes = type === 'weekly' ? 60 : 10;
    try {
      const png = await buildReportPng(REPORT_CHART_METRICS, hours, bucketMinutes);
      if (png) {
        const caption = `📈 แนวโน้ม ${REPORT_CHART_METRICS.length} metric ย้อนหลัง ${periodText} (สีตาม legend)`;
        await sendTelegramPhoto(png, caption);
      } else {
        console.warn('Report chart skipped (no telemetry data)');
      }
    } catch (err) {
      console.error('Failed to send report chart:', err instanceof Error ? err.message : err);
    }

    console.log(`📊 ${type} report generated (${report.id})${aiSummary ? ' (AI)' : ' (fallback — Ollama offline)'}`);
    return report;
  }

  async list(limit = 50) {
    return prisma.dailyReport.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(limit, 200) });
  }
}

export const reportService = new ReportService();
