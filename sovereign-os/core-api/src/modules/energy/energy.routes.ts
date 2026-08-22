import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// ความจุแบตเตอรี่ (kWh) — ตั้งได้ผ่าน env ENERGY_CAPACITY_KWH (ค่าเริ่มต้น 5 kWh)
const CAPACITY_KWH = parseFloat(process.env.ENERGY_CAPACITY_KWH || '5');

// GET /api/energy/summary – สรุปพลังงาน: แบตเตอรี่, การใช้ไฟ, เวลาที่เหลือ
router.get('/summary', authenticate, async (req, res) => {
  try {
    // ค่าล่าสุดของ battery_soc / power_kw
    const latestRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT ON (metric) metric, value
       FROM sensor_telemetry
       WHERE metric IN ('battery_soc', 'power_kw')
       ORDER BY metric, time DESC`
    );
    const latest: Record<string, number> = {};
    for (const r of latestRows) latest[r.metric] = Number(r.value);

    // ค่าเฉลี่ยกำลังไฟ 24 ชม. (ติดลบ = ใช้ไฟ, บวก = ผลิตไฟเกิน/ชาร์จ)
    const avgRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT AVG(value) AS avg_power
       FROM sensor_telemetry
       WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
    );
    const avgPower = avgRows[0]?.avg_power != null ? Number(avgRows[0].avg_power) : null;

    const batterySoc = latest.battery_soc != null ? latest.battery_soc : null;
    const powerKwLatest = latest.power_kw != null ? latest.power_kw : null;

    let status: 'no_data' | 'discharging' | 'charging' | 'balanced' = 'no_data';
    let hoursRemaining: number | null = null;

    if (batterySoc != null && avgPower != null) {
      if (avgPower < -0.001) {
        status = 'discharging';
        // เวลาที่เหลือ = (แบตเตอรี่ที่ใช้ได้ / อัตราการใช้ต่อชั่วโมง)
        hoursRemaining = (batterySoc / 100) * CAPACITY_KWH / Math.abs(avgPower);
      } else if (avgPower > 0.001) {
        status = 'charging';
      } else {
        status = 'balanced';
      }
    } else if (batterySoc != null || avgPower != null) {
      status = 'no_data';
    }

    const kwhNet24h = avgPower != null ? avgPower * 24 : null; // signed

    res.json({
      battery_soc: batterySoc != null ? Math.round(batterySoc * 10) / 10 : null,
      power_kw_avg_24h: avgPower != null ? Math.round(avgPower * 100) / 100 : null,
      power_kw_latest: powerKwLatest != null ? Math.round(powerKwLatest * 100) / 100 : null,
      kwh_net_24h: kwhNet24h != null ? Math.round(kwhNet24h * 100) / 100 : null,
      hours_remaining: hoursRemaining != null ? Math.round(hoursRemaining * 10) / 10 : null,
      capacity_kwh: CAPACITY_KWH,
      status,
    });
  } catch (err) {
    console.error('Energy summary error:', err);
    res.status(500).json({ error: 'Failed to load energy summary' });
  }
});

export default router;
