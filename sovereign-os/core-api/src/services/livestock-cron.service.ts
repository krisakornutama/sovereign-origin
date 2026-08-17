// ═════════════════════════════════════════════════════════════
// Livestock Cron — งานรักษาระบบรายวัน (รันอัตโนมัติเมื่อ server เริ่ม)
//   06:00 น. (เซิร์ฟเวอร์) → ปลดล็อก withdrawal + เตือนวัคซีนครบกำหนด
// ═════════════════════════════════════════════════════════════
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendTelegramAlert } from './telegram-alert.service';

export const prisma = new PrismaClient();
const DAY_MS = 86_400_000;

/** งานหลัก: ปลดล็อก withdrawal + เตือนวัคซีน — export ไว้ test ได้โดยตรง */
export async function runDailyLivestockMaintenance() {
  const now = new Date();

  // ── 1) ปลดล็อกขาย: กลุ่ม LOCKED_WITHDRAWAL ที่พ้นระยะหยุดยาแล้ว → ACTIVE ──
  const locked = await prisma.livestockGroup.findMany({
    where: { status: 'LOCKED_WITHDRAWAL' },
    include: { records: { select: { safeHarvestDate: true } } },
  });
  for (const g of locked) {
    const latest = g.records.reduce((mx, m) => Math.max(mx, new Date(m.safeHarvestDate).getTime()), 0);
    if (latest <= now.getTime()) {
      await prisma.livestockGroup.update({ where: { id: g.id }, data: { status: 'ACTIVE' } });
      await sendTelegramAlert({
        text: `🔓 ปลดล็อกขายอัตโนมัติ: ${g.code} — พ้นระยะหยุดยาแล้ว`,
        severity: 'info',
        eventKey: `withdrawal-unlock-${g.id}`,
      });
    }
  }

  // ── 2) วัคซีนครบกำหนดแต่ยังไม่ฉีด → เตือน (dedup ต่อตัววัคซีน) ──
  const groups = await prisma.livestockGroup.findMany({
    where: { status: { in: ['ACTIVE', 'QUARANTINE'] } },
    include: {
      schedules: { where: { isCompleted: false } },
    },
  });
  for (const g of groups) {
    const ageDays = Math.floor((now.getTime() - new Date(g.birthDate).getTime()) / DAY_MS);
    for (const s of g.schedules) {
      if (s.targetAgeDays > 0 && ageDays >= s.targetAgeDays) {
        await sendTelegramAlert({
          text: `⚠️ วัคซีนครบกำหนด: ${s.vaccineName} (อายุ ${ageDays} วัน) — กลุ่ม ${g.code} ยังไม่ฉีด`,
          severity: 'warn',
          eventKey: `vaccine-due-${s.id}`,
        });
      }
    }
  }
}

const CRON_MAINTENANCE = process.env.LIVESTOCK_CRON || '0 6 * * *';

// start เมื่อ import (สไตล์เดียวกับ backup.service / mesh-lite.service)
// export task ไว้ให้ test เรียก .stop()/.destroy() เพื่อไม่ค้าง interval
export const livestockMaintenanceTask = cron.schedule(CRON_MAINTENANCE, () => {
  runDailyLivestockMaintenance().catch((err) => {
    console.error('Livestock daily maintenance error:', err);
  });
});

export const livestockCronStarted = true;