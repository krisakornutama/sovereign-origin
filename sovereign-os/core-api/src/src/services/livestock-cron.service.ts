// ═════════════════════════════════════════════════════════════
// Livestock Cron — งานรักษาระบบรายวัน (รันอัตโนมัติเมื่อ server เริ่ม)
//   06:00 น. (เซิร์ฟเวอร์) →
//   1) ปลดล็อก withdrawal ที่พ้นระยะแล้ว
//   2) เตือนวัคซีนครบกำหนด (due) + ใกล้ถึงกำหนด (ล่วงหน้า VACCINE_UPCOMING_DAYS วัน)
//   3) เตือนระยะหยุดยาใกล้สิ้นสุดก่อนจับขาย (ล่วงหน้า WITHDRAW_WARN_DAYS วัน)
//   4) ปลดล็อกกักกันอัตโนมัติเมื่อพ้น QUARANTINE_DAYS
// ═════════════════════════════════════════════════════════════
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { sendTelegramAlert } from './telegram-alert.service';

export { prisma };
const DAY_MS = 86_400_000;

// ล่วงหน้าที่จะแจ้งเตือน (วัน) — ตั้งผ่าน env ได้
const WITHDRAW_WARN_DAYS = parseInt(process.env.LIVESTOCK_WITHDRAW_WARN_DAYS || '3', 10);
const VACCINE_UPCOMING_DAYS = parseInt(process.env.VACCINE_UPCOMING_DAYS || '3', 10);

/** งานหลัก: ปลดล็อก withdrawal + เตือนวัคซีน + เตือนระยะหยุดยา + ปลดกักกัน — export ไว้ test ได้โดยตรง */
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

  // ── 1b) เตือนระยะหยุดยาใกล้สิ้นสุด (ก่อนจับขาย X วัน) — withdrawal tracker ──
  const warnMs = now.getTime() + WITHDRAW_WARN_DAYS * DAY_MS;
  for (const g of locked) {
    const latest = g.records.reduce((mx, m) => Math.max(mx, new Date(m.safeHarvestDate).getTime()), 0);
    if (latest > now.getTime() && latest <= warnMs) {
      const daysLeft = Math.ceil((latest - now.getTime()) / DAY_MS);
      await sendTelegramAlert({
        text: `🗓️ ${g.code} ใกล้พ้นระยะหยุดยา: เหลือ ${daysLeft} วัน (${new Date(latest).toISOString().slice(0, 10)}) — วางแผนจับขายได้`,
        severity: 'warn',
        eventKey: `withdrawal-soon-${g.id}`,
      });
    }
  }

  // ── 2) วัคซีน: ครบกำหนด (due) + ใกล้ถึงกำหนดล่วงหน้า VACCINE_UPCOMING_DAYS วัน ──
  const groups = await prisma.livestockGroup.findMany({
    where: { status: { in: ['ACTIVE', 'QUARANTINE'] } },
    include: {
      schedules: { where: { isCompleted: false } },
    },
  });
  for (const g of groups) {
    const ageDays = Math.floor((now.getTime() - new Date(g.birthDate).getTime()) / DAY_MS);
    for (const s of g.schedules) {
      if (s.targetAgeDays <= 0) continue;
      const daysToTarget = s.targetAgeDays - ageDays;
      if (daysToTarget <= 0) {
        await sendTelegramAlert({
          text: `⚠️ วัคซีนครบกำหนด: ${s.vaccineName} (อายุ ${ageDays} วัน) — กลุ่ม ${g.code} ยังไม่ฉีด`,
          severity: 'warn',
          eventKey: `vaccine-due-${s.id}`,
        });
      } else if (daysToTarget <= VACCINE_UPCOMING_DAYS) {
        // Scheduled Cron Dispatcher: สแกนล่วงหน้า 1-3 วัน → เตือนทุกเช้า
        await sendTelegramAlert({
          text: `💉 วัคซีนจะถึงกำหนดใน ${daysToTarget} วัน: ${s.vaccineName} (อายุ ${ageDays} วัน) — กลุ่ม ${g.code} เตรียมวัคซีน`,
          severity: 'info',
          eventKey: `vaccine-upcoming-${s.id}`,
        });
      }
    }
  }

  // ── 3) ปลดล็อกกักกันอัตโนมัติเมื่อพ้นกำหนด (Quarantine Cooldown) ──
  const quarantined = await prisma.livestockGroup.findMany({
    where: { status: 'QUARANTINE' },
  });
  for (const g of quarantined) {
    if (!g.quarantineEndAt || new Date(g.quarantineEndAt) > now) continue;
    await prisma.livestockGroup.update({
      where: { id: g.id },
      data: { status: 'ACTIVE', quarantineEndAt: null },
    });
    await sendTelegramAlert({
      text: `🟢 ปลดกักกันอัตโนมัติ: ${g.code} — ครบระยะกักกันแล้ว กลับเข้าสู่การเลี้ยงปกติ`,
      severity: 'info',
      eventKey: `quarantine-released-${g.id}`,
    });
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