// src/services/alert-store.service.ts
//
// Alert Store — ที่เก็บประวัติ alert ทั้งหมดของระบบ (Phase 3: ช่องทางแจ้งเตือนที่ 2 นอกจาก Telegram)
// เจตนา: Telegram = ช่องทางรับด้วยตา แต่ถ้า token หมด/เน็ตตัด/คนไม่ดู → ต้องยังมีบันทึกในระบบให้ย้อนดูได้
// ทุก alert ที่ผ่าน dispatcher (ส่งสำเร็จ, ถูก dedup, ถูก rate-limit) จะถูกจดไว้ที่นี่
// หลักการ: soft-fail เหมือน dispatcher — DB พัง = log เงียบ ไม่ทำให้สายเรียกหลักชะงัก

import { prisma } from '../lib/prisma';

export interface AlertEventInput {
  severity: 'critical' | 'warn' | 'info';
  eventKey: string;
  title: string;
  detail: string;
  sent: boolean;
  suppressed?: string | null;
  source?: string;
}

/** จด alert ลงตาราง alert_events — fire-and-forget ปลอดภัย (soft-fail) */
export function recordAlertEvent(input: AlertEventInput): void {
  void prisma.alertEvent
    .create({
      data: {
        severity: input.severity,
        event_key: input.eventKey.slice(0, 200),
        title: input.title.slice(0, 200),
        detail: input.detail.slice(0, 4000),
        sent: input.sent,
        suppressed: input.suppressed ?? null,
        source: input.source ?? 'dispatcher',
      },
    })
    .catch((err: unknown) => {
      console.error(
        'alert-store: จด alert ไม่สำเร็จ (ข้าม — soft-fail):',
        err instanceof Error ? err.message : err
      );
    });
}

/** รายการล่าสุด (ให้ route GET /api/telegram/alerts) */
export async function listAlertEvents(limit = 100, severity?: string) {
  const take = Math.min(Math.max(limit, 1), 500); // เพดานกันหนักเกิน
  return prisma.alertEvent.findMany({
    where: severity ? { severity } : undefined,
    orderBy: { created_at: 'desc' },
    take,
  });
}

/** สถิติย่อสำหรับหัวหน้าหน้า (จำนวนตาม severity ใน 24 ชม.) */
export async function alertStats24h() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.alertEvent.groupBy({
    by: ['severity'],
    where: { created_at: { gte: since } },
    _count: { _all: true },
  });
  const out: Record<string, number> = { critical: 0, warn: 0, info: 0 };
  for (const r of rows) out[r.severity] = r._count._all;
  return out;
}
