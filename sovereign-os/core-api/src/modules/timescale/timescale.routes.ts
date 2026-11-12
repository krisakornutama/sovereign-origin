import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// Only allow safe time_bucket intervals – validate before it is interpolated into SQL.
const INTERVAL_PATTERN = /^\d+\s+(second|minute|hour|day|week|month)s?$/i;
const DEFAULT_INTERVAL = '5 minutes';

/**
 * เพดานจำนวนจุดต่อคำขอ — query นี้ GROUP BY bucket (ไม่มี LIMIT)
 * ⇒ จำนวนแถวขึ้นกับ "ช่วงวันที่ ÷ interval" ล้วน ๆ: 1 ปีที่ 5 นาที = ~105,000 จุด
 * เกินเพดาน = 400 พร้อมทางแก้ (interval ใหญ่ขึ้น/แคบช่วง) ไม่ใช่ตัดเงียบ
 */
export const MAX_HISTORY_BUCKETS = 20000;

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2592000,
};

/** วินาทีต่อหนึ่ง bucket (0 = อ่านไม่ได้) */
export function intervalSeconds(interval: string): number {
  const m = /^(\d+)\s+(second|minute|hour|day|week|month)s?$/i.exec(String(interval || '').trim());
  if (!m) return 0;
  return Number(m[1]) * (UNIT_SECONDS[m[2].toLowerCase()] || 0);
}

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
    const bucketSeconds = intervalSeconds(interval);
    if (bucketSeconds <= 0) {
      return res.status(400).json({ error: 'interval ต้องมากกว่า 0 (เช่น 5 minutes, 1 hour)' });
    }

    // ── เพดานจำนวนจุด: ช่วงวันที่กำหนดจำนวนแถว ไม่ใช่ LIMIT ──────────────────
    if (!RANGE_CONFIG[range]) {
      let fromMs = from ? Date.parse(String(from)) : NaN;
      // to ก่อน from / วันที่ผิดรูป ต้องเป็น 400 ไม่ใช่ปล่อยให้ Postgres โยนแล้วตอบ []
      if (from && Number.isNaN(fromMs)) {
        return res.status(400).json({ error: 'from ต้องเป็นวันที่ที่อ่านได้ (ISO เช่น 2026-01-01T00:00:00Z)' });
      }
      let toMs = to ? Date.parse(String(to)) : NaN;
      if (to && Number.isNaN(toMs)) {
        return res.status(400).json({ error: 'to ต้องเป็นวันที่ที่อ่านได้ (ISO เช่น 2026-01-02T00:00:00Z)' });
      }
      if (!to && from) toMs = Date.now(); // เปิดช่วงถึงปัจจุบัน = ขอบเขตที่คำนวณได้
      if (to && !from) {
        return res.status(400).json({ error: 'ระบุ from ด้วยเมื่อส่ง to (ต้องรู้จุดเริ่มของช่วง)' });
      }
      if (from && to && toMs < fromMs) {
        return res.status(400).json({ error: 'to ต้องมาหลัง from' });
      }
      if (from) {
        const buckets = Math.ceil((toMs - fromMs) / 1000 / bucketSeconds) + 1;
        if (buckets > MAX_HISTORY_BUCKETS) {
          return res.status(400).json({
            error:
              `ช่วงกว้างเกินไปสำหรับ interval "${interval}" — จะได้ ~${buckets.toLocaleString('en-US')} จุด ` +
              `(เพดาน ${MAX_HISTORY_BUCKETS.toLocaleString('en-US')}) ให้ใช้ interval ที่ใหญ่ขึ้นหรือแคบช่วงวันที่`,
          });
        }
      }
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