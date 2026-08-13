import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// Only allow safe time_bucket intervals – never interpolate user input into SQL.
const INTERVAL_PATTERN = /^\d+\s+(second|minute|hour|day|week|month)s?$/i;
const DEFAULT_INTERVAL = '5 minutes';

// ช่วงเวลาสำเร็จรูป 24h/7d/30d -> bucket size อัตโนมัติ (กันกราฟมีจุดเยอะเกินไป)
// interval/sql เป็นค่าคงที่ในโค้ด ไม่รับจาก user input -> ปลอดภัยต่อ SQL injection
const RANGE_CONFIG: Record<string, { interval: string; sql: string }> = {
  '24h': { interval: '5 minutes', sql: `AND time >= NOW() - INTERVAL '24 hours'` },
  '7d': { interval: '1 hour', sql: `AND time >= NOW() - INTERVAL '7 days'` },
  '30d': { interval: '1 day', sql: `AND time >= NOW() - INTERVAL '30 days'` },
};

// GET /api/timescale/history?metric=xxx&from=ISO&to=ISO&interval=5m
router.get('/history', authenticate, async (req, res) => {
  try {
    const { metric, from, to } = req.query;
    const range = (req.query.range as string | undefined) || '';
    let interval = (req.query.interval as string | undefined) || DEFAULT_INTERVAL;
    // ถ้าเป็นช่วงสำเร็จรูป (24h/7d/30d) ใช้ bucket size ที่เหมาะกับช่วงนั้นแทน
    if (RANGE_CONFIG[range]) interval = RANGE_CONFIG[range].interval;
    if (!metric) return res.status(400).json({ error: 'metric required' });
    if (!INTERVAL_PATTERN.test(interval)) {
      return res.status(400).json({ error: 'Invalid interval format (e.g. 5 minutes, 1 hour, 1 day)' });
    }

    let query = `
      SELECT time_bucket('${interval}', time) AS bucket,
             metric,
             AVG(value) AS avg_value,
             MIN(value) AS min_value,
             MAX(value) AS max_value
      FROM sensor_telemetry
      WHERE metric = $1
    `;
    const params: any[] = [metric];

    if (RANGE_CONFIG[range]) {
      // ช่วงสำเร็จรูป: คำนวณเวลาจาก server (NOW()) ไม่ต้องส่ง from/to
      query += ` ${RANGE_CONFIG[range].sql}`;
    } else {
      if (from) {
        query += ` AND time >= $${params.length + 1}`;
        params.push(from);
      }
      if (to) {
        query += ` AND time <= $${params.length + 1}`;
        params.push(to);
      }
    }

    query += ` GROUP BY bucket, metric ORDER BY bucket ASC`;

    const result = await prisma.$queryRawUnsafe<Array<any>>(query, ...params);
    res.json(result);
  } catch (err) {
    console.error('Timescale history error:', err);
    res.status(500).json([]);
  }
});

// GET /api/timescale/metrics – รายชื่อ metric ทั้งหมด
router.get('/metrics', authenticate, async (req, res) => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT metric FROM sensor_telemetry ORDER BY metric`
    );
    res.json(result.map((r: any) => r.metric));
  } catch (err) {
    res.json([]);
  }
});

export default router;