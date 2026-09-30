// src/services/visitor-tracking.service.ts
//
// VISITOR TRACKING (P10) — เก็บพฤติกรรมผู้มาเยือนหน้าสาธารณะ เพื่อดึงความต้องการผู้ใช้ไปพัฒนาต่อ
// หลักการ:
//  - cookieless · ไม่มี PII — ไม่เก็บชื่อ/อีเมล/IP เปล่า (IP → sha256(ip+salt) 8 ตัว ใช้นับ session เท่านั้น)
//  - beacon ยิงมาอย่างเดียว: kind ต้องอยู่ใน allowlist · ข้อความ/ค่าตอบถูกตัดความยาว
//  - honeypot field `website` (มากับแบบสอบถาม) ถ้าถูกกรอก = bot → ทิ้งเงียบ (ตอบ 202 เหมือนสำเร็จ)
//  - ตอบ 202 เสมอสำหรับ beacon — อุปกรณ์ผู้ใช้ต้องไม่ล้มเพราะระบบสถิติของเรา
import { prisma } from '../lib/prisma';
import { ipHashOf } from './feedback.service';

export const TRACK_KINDS = ['page_view', 'demo_tab', 'time_on_page', 'survey', 'question', 'feedback_open', 'outbound'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export interface TrackInput {
  kind?: string;
  page?: string;
  detail?: string;
  value?: string;
  website?: string; // honeypot — ต้องว่างเสมอ
  ip?: string;
  userAgent?: string;
}

export type TrackResult = { accepted: boolean; reason?: 'honeypot' | 'invalid' };

/** บันทึกเหตุการณ์ผู้เยี่ยมชม — ของเพี้ยน/บอท = ทิ้งเงียบ (accepted:false) */
export async function trackEvent(input: TrackInput): Promise<TrackResult> {
  if (String(input.website ?? '').trim() !== '') return { accepted: false, reason: 'honeypot' };

  const kind = String(input.kind ?? 'page_view');
  if (!(TRACK_KINDS as readonly string[]).includes(kind)) return { accepted: false, reason: 'invalid' };

  const page = String(input.page ?? '/').slice(0, 60);
  if (!page.startsWith('/') || page.length < 1) return { accepted: false, reason: 'invalid' };

  await prisma.visitorEvent.create({
    data: {
      kind,
      page,
      detail: String(input.detail ?? '').trim().slice(0, 120) || null,
      value: String(input.value ?? '').trim().slice(0, 300) || null,
      user_agent: String(input.userAgent ?? '').slice(0, 200) || null,
      ip_hash: input.ip ? ipHashOf(input.ip) : null,
    },
  });
  return { accepted: true };
}

export interface VisitorSummary {
  days: number;
  totalEvents: number;
  pageViews: { page: string; count: number }[];
  demoTabs: { detail: string; count: number }[];
  avgTimeOnPageSec: number | null;
  surveys: { value: string; count: number }[];
  questions: { detail: string; value: string; count: number }[];
  feedbackOpens: number;
  uniqueVisitors: number;
}

/** สรุปพฤติกรรม N วันล่าสุด — ไว้โชว์บนหน้า admin (คัดกรองความต้องการผู้ใช้) */
export async function visitorSummary(days = 7): Promise<VisitorSummary> {
  const since = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 86_400_000);

  const rows = await prisma.visitorEvent.findMany({
    where: { created_at: { gte: since } },
    select: { kind: true, page: true, detail: true, value: true, ip_hash: true },
  });

  const countBy = (pred: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (pred(r) === null || pred(r) === undefined || pred(r) === '') continue;
      m.set(pred(r), (m.get(pred(r)) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, count]) => ({ count, key: k })).sort((a, b) => b.count - a.count);
  };

  const pageViews = countBy((r) => (r.kind === 'page_view' ? r.page : '')).map((e) => ({ page: e.key, count: e.count }));
  const demoTabs = countBy((r) => (r.kind === 'demo_tab' ? r.detail ?? '' : '')).map((e) => ({ detail: e.key, count: e.count }));
  const surveys = countBy((r) => (r.kind === 'survey' ? r.value ?? '' : '')).map((e) => ({ value: e.key, count: e.count }));
  const questions = countBy((r) => (r.kind === 'question' ? `${r.detail ?? ''}|${r.value ?? ''}` : '')).map((e) => {
    const [detail, value] = e.key.split('|');
    return { detail: detail ?? '', value: value ?? '', count: e.count };
  });

  const times = rows.filter((r) => r.kind === 'time_on_page' && r.value).map((r) => Number(r.value)).filter((n) => Number.isFinite(n) && n >= 0);
  const avgTimeOnPageSec = times.length ? Math.round(times.reduce((s, n) => s + n, 0) / times.length) : null;

  const visitors = new Set(rows.map((r) => r.ip_hash).filter(Boolean));
  const feedbackOpens = rows.filter((r) => r.kind === 'feedback_open').length;

  return {
    days,
    totalEvents: rows.length,
    pageViews,
    demoTabs,
    avgTimeOnPageSec,
    surveys,
    questions,
    feedbackOpens,
    uniqueVisitors: visitors.size,
  };
}
