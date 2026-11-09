// src/services/livestock-executive.service.ts
//
// ── ข้อมูลปศุสัตว์สำหรับหน้าภาพรวมฟาร์ม (เจ้าของตาราง livestock_*) ──────────
// ทำไมต้องมี: /api/farm/executive ต้องใช้กลุ่มสัตว์/ไซโล/THI ล่าสุด ซึ่งเป็น
// ตารางของโมดูล livestock — โมดูล farm จึงต้องเรียกผ่าน service ของเจ้าของ
// ไม่ใช่ยิง prisma.livestockGroup / prisma.feedSilo / SQL เอง (arch-gate)
import { prisma } from '../lib/prisma';

export interface LivestockExecutiveSnapshot {
  groups: Awaited<ReturnType<typeof loadGroups>>;
  silos: Awaited<ReturnType<typeof loadSilos>>;
  climate: { thi: number; status: string } | null;
}

const loadGroups = () =>
  prisma.livestockGroup.findMany({ include: { records: true, schedules: true, dailyLogs: true } });

const loadSilos = () => prisma.feedSilo.findMany();

/** THI ล่าสุด — ตาราง climate เป็น hypertable ที่อ่านผ่าน SQL (เหมือน livestock dashboard) */
async function loadLatestClimate(): Promise<{ thi: number; status: string } | null> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT thi, status FROM livestock_climate_logs ORDER BY at DESC LIMIT 1`
    );
    if (!rows[0]) return null;
    return { thi: Number(rows[0].thi), status: String(rows[0].status) };
  } catch (dbErr) {
    console.error('Farm executive climate error:', dbErr);
    return null;
  }
}

/**
 * โหลดข้อมูลปศุสัตว์ทั้งหมดที่หน้าภาพรวมฟาร์มต้องใช้ในคำขอเดียว
 * (กลุ่มสัตว์ + ไซโลอาหาร + THI ล่าสุด) — เรียกจาก farm-executive route
 */
export async function loadLivestockExecutiveSnapshot(): Promise<LivestockExecutiveSnapshot> {
  const [groups, silos, climate] = await Promise.all([loadGroups(), loadSilos(), loadLatestClimate()]);
  return { groups, silos, climate };
}
