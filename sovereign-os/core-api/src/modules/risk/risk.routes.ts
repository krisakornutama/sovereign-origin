import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { PrismaClient } from '@prisma/client';
import { riskEmitter } from '../../services/risk-monitor.service';
import { classifyDefcon, type DefconLevel } from '../../services/defcon-engine.service';
import {
  generateScenarios,
  forecastHistory,
  latestForecast,
  FORECAST_FOCUSES,
} from '../../services/scenario-forecast.service';

const router = Router();
const prisma = new PrismaClient();

const VALID_CATEGORIES = ['war', 'banking', 'energy', 'inflation'];

// ── Overview: threat index ล่าสุด + DEFCON + ข่าวล่าสุด ──

// GET /api/risk-monitor/overview
router.get('/overview', authenticate, async (req, res) => {
  try {
    const [latestThreat, recentHeadlines, defconEngine] = await Promise.all([
      prisma.threatIndex.findFirst({ orderBy: { timestamp: 'desc' } }),
      prisma.riskHeadline.findMany({ orderBy: { published: 'desc' }, take: 20 }),
      Promise.resolve((req.app.locals as { defconEngine?: { getLevel: () => DefconLevel } }).defconEngine),
    ]);
    const categories =
      latestThreat && typeof latestThreat.categories === 'object'
        ? (latestThreat.categories as Record<string, number>)
        : {};
    res.json({
      threatIndex: latestThreat
        ? {
            overall: latestThreat.overall,
            categories,
            summary: latestThreat.summary,
            timestamp: latestThreat.timestamp,
            model: latestThreat.model,
          }
        : null,
      defconLevel: defconEngine ? defconEngine.getLevel() : classifyDefcon(latestThreat?.overall ?? 0),
      headlines: recentHeadlines,
    });
  } catch (err) {
    console.error('Risk overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// GET /api/risk-monitor/headlines — ข่าวทั้งหมด (filter ได้)
router.get('/headlines', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const category = (req.query.category as string) || '';
    const where = category && VALID_CATEGORIES.includes(category) ? { category } : {};
    const rows = await prisma.riskHeadline.findMany({ where, orderBy: { published: 'desc' }, take: limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load headlines' });
  }
});

// GET /api/risk-monitor/history — ประวัติ Threat Index
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 60, 500);
    const rows = await prisma.threatIndex.findMany({ orderBy: { timestamp: 'desc' }, take: limit });
    res.json(
      rows.map((r) => ({
        timestamp: r.timestamp,
        overall: r.overall,
        categories: r.categories,
        headline_count: r.headline_count,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to load threat history' });
  }
});

// POST /api/risk-monitor/refresh — ดึง RSS + วิเคราะห์ทันที
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const { riskWorker } = req.app.locals as { riskWorker?: { runOnce: () => Promise<Record<string, unknown>> } };
    if (!riskWorker) return res.status(503).json({ error: 'Risk worker not running (RISK_MONITOR_ENABLED=false?)' });
    const result = await riskWorker.runOnce();
    res.json({ success: true, ...(result as object) });
  } catch (err) {
    console.error('Risk refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh risk data' });
  }
});

// ── Stress Test Simulator ──

// POST /api/risk-monitor/stress-test — ให้ Ollama จำลองสถานการณ์วิกฤต
router.post('/stress-test', authenticate, async (req, res) => {
  try {
    const { scenario } = req.body || {};
    if (!scenario || typeof scenario !== 'string') {
      return res.status(400).json({ error: 'scenario (string) is required' });
    }
    const { analyzeWithOllama } = await import('../../services/risk-monitor.service');
    const rows = await prisma.riskHeadline.findMany({ orderBy: { published: 'desc' }, take: 10 });
    const result = await analyzeWithOllama(
      [{ title: `[STRESS TEST] ${scenario}`, summary: 'Simulated scenario for impact assessment.' }],
      process.env.RISK_MODEL || 'gemma3:4b'
    );
    res.json({
      scenario,
      result,
      relatedHeadlines: rows.map((r) => r.title),
    });
  } catch (err) {
    console.error('Stress test error:', err);
    res.status(500).json({ error: 'Failed to run stress test' });
  }
});

// ── Scenario Forecast — สร้างสถานการณ์ที่เป็นไปได้ (อดีต+ปัจจุบัน → โอกาสเกิด %)
// ใช้ร่วมกับ AI Command Center (/ai) — integrade เข้ากับ Risk Monitor โดยตรง

// POST /api/risk-monitor/scenarios { focus?, horizonDays? } — วิเคราะห์ทันที
router.post('/scenarios', authenticate, async (req, res) => {
  try {
    const focus = String(req.body?.focus || 'general');
    const horizonDays = Number(req.body?.horizonDays) || 90;
    if (!FORECAST_FOCUSES.includes(focus as any)) {
      return res.status(400).json({ error: `invalid focus (${FORECAST_FOCUSES.join('|')})` });
    }
    const result = await generateScenarios({ focus: focus as any, horizonDays });
    res.json(result);
  } catch (err) {
    console.error('Scenario forecast error:', err);
    res.status(500).json({ error: 'Scenario forecast failed' });
  }
});

// GET /api/risk-monitor/scenarios/history?limit= — ประวัติคำพยากรณ์ (อดีต)
router.get('/scenarios/history', authenticate, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    res.json(await forecastHistory(limit));
  } catch (err) {
    console.error('Scenario history error:', err);
    res.status(500).json({ error: 'Failed to load scenario history' });
  }
});

// GET /api/risk-monitor/scenarios/latest — คำพยากรณ์ล่าสุด (สำหรับการ์ดสรุป)
router.get('/scenarios/latest', authenticate, async (req, res) => {
  try {
    res.json(await latestForecast());
  } catch (err) {
    console.error('Latest scenario error:', err);
    res.status(500).json({ error: 'Failed to load latest scenario' });
  }
});

// ── DEFCON status ──

// GET /api/risk-monitor/defcon — ระดับปัจจุบัน + เกณฑ์ + ประวัติเหตุการณ์
router.get('/defcon', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const [latestThreat, events, defconEngine] = await Promise.all([
      prisma.threatIndex.findFirst({ orderBy: { timestamp: 'desc' } }),
      prisma.defconEvent.findMany({ orderBy: { timestamp: 'desc' }, take: limit }),
      Promise.resolve((req.app.locals as { defconEngine?: { getLevel: () => DefconLevel } }).defconEngine),
    ]);
    res.json({
      currentLevel: defconEngine ? defconEngine.getLevel() : classifyDefcon(latestThreat?.overall ?? 0),
      thresholds: { level3: 50, level2: 75, level1: 90 },
      latestOverall: latestThreat?.overall ?? null,
      events: events.map((e) => ({
        timestamp: e.timestamp,
        level: e.level,
        action: e.action,
        detail: e.detail,
      })),
    });
  } catch (err) {
    console.error('DEFCON status error:', err);
    res.status(500).json({ error: 'Failed to load DEFCON status' });
  }
});

export { riskEmitter };
export default router;
