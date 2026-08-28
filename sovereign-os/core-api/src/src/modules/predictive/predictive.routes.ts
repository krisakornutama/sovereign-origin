import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  prisma,
  KEY_METRICS,
  METRIC_ALLOWLIST,
  batteryForecastFromHistory,
  detectAnomalies,
  predictiveWorker,
} from '../../services/predictive.service';
import { generateScenarios, FORECAST_FOCUSES } from '../../services/scenario-forecast.service';

const router = Router();

// GET /api/predictive/battery — คาดการณ์แบตจะหมดเมื่อไหร่ (regression 7 วัน)
router.get('/battery', authenticate, async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(String(req.query.hours || '168'), 10) || 168, 24), 720);
    const history = await prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT date_trunc('hour', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
       FROM sensor_telemetry
       WHERE metric = 'battery_soc' AND time >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1 ORDER BY 1 ASC`,
      hours
    );
    const forecast = batteryForecastFromHistory(history || []);
    const series = (history || []).map((h) => Number(h.value)).slice(-72);
    res.json({
      forecast,
      source: { rangeHours: hours, samples: (history || []).length },
      series,
    });
  } catch (err) {
    console.error('Predictive battery route error:', err);
    res.status(500).json({ error: 'Battery forecast failed' });
  }
});

// GET /api/predictive/anomalies?metric=&hours=&window=&threshold=
router.get('/anomalies', authenticate, async (req, res) => {
  const metric = String(req.query.metric || '');
  if (!METRIC_ALLOWLIST.includes(metric as any)) {
    return res.status(400).json({ error: `invalid metric (${METRIC_ALLOWLIST.join('|')})` });
  }
  const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 168);
  const window = Math.min(Math.max(parseInt(String(req.query.window || '60'), 10) || 60, 5), 1440);
  let threshold = Number(req.query.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) threshold = 3;
  try {
    const history = await prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT date_trunc('minute', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
       FROM sensor_telemetry
       WHERE metric = $1 AND time >= NOW() - ($2::int * INTERVAL '1 hour')
       GROUP BY 1 ORDER BY 1 ASC`,
      metric,
      hours
    );
    const anomalies = detectAnomalies(
      (history || []).map((h) => ({ t: new Date(h.time).getTime(), y: Number(h.value) })),
      { window, zThreshold: threshold }
    );
    res.json({ metric, hours, window, threshold, anomalies });
  } catch (err) {
    console.error('Predictive anomalies route error:', err);
    res.status(500).json({ error: 'Anomaly detection failed' });
  }
});

// GET /api/predictive/summary — ข้อมูลรวมสำหรับการ์ดหน้า UI
router.get('/summary', authenticate, async (req, res) => {
  try {
    const batteryHistory = await prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
      `SELECT date_trunc('hour', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
       FROM sensor_telemetry
       WHERE metric = 'battery_soc' AND time >= NOW() - INTERVAL '168 hours'
       GROUP BY 1 ORDER BY 1 ASC`
    );
    const forecast = batteryForecastFromHistory(batteryHistory || []);

    const anomaliesByMetric: Record<string, number> = {};
    for (const metric of KEY_METRICS) {
      try {
        const series = await prisma.$queryRawUnsafe<Array<{ time: string | Date; value: number }>>(
          `SELECT date_trunc('minute', time) AS time, (array_agg(value ORDER BY time DESC))[1] AS value
           FROM sensor_telemetry
           WHERE metric = $1 AND time >= NOW() - INTERVAL '24 hours'
           GROUP BY 1 ORDER BY 1 ASC`,
          metric
        );
        anomaliesByMetric[metric] = detectAnomalies(
          (series || []).map((h) => ({ t: new Date(h.time).getTime(), y: Number(h.value) })),
          { window: 60, zThreshold: 3 }
        ).length;
      } catch {
        anomaliesByMetric[metric] = 0;
      }
    }

    res.json({
      battery: forecast,
      anomaliesByMetric,
      lastWorkerRun: predictiveWorker.lastRunAt,
    });
  } catch (err) {
    console.error('Predictive summary route error:', err);
    res.status(500).json({ error: 'Predictive summary failed' });
  }
});

// GET /api/predictive/world — คาดการณ์สังคม/การเมือง/การปกครอง/สถานการณ์ปัจจุบัน
// (ใช้ scenario-forecast service เดียวกับ Risk Monitor + AI Command Center — ดูประวัติได้ที่ /api/risk-monitor/scenarios)
router.post('/world', authenticate, async (req, res) => {
  try {
    const focus = String(req.body?.focus || 'politics');
    const horizonDays = Number(req.body?.horizonDays) || 90;
    if (!FORECAST_FOCUSES.includes(focus as any)) {
      return res.status(400).json({ error: `invalid focus (${FORECAST_FOCUSES.join('|')})` });
    }
    const result = await generateScenarios({ focus: focus as any, horizonDays });
    res.json(result);
  } catch (err) {
    console.error('World forecast error:', err);
    res.status(500).json({ error: 'World forecast failed' });
  }
});

export default router;