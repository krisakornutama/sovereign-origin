// learning-engine.service.ts — ระบบเรียนรู้เอง: Ollama qwen3:8b + heuristic fallback, เรียนรู้ต่อจาก actual
import { prisma } from '../lib/prisma';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const DEFAULT_MODEL = process.env.LEARNING_MODEL || 'qwen3:8b';

async function ollamaGenerate(prompt: string, model = DEFAULT_MODEL): Promise<string | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.3, num_predict: 400 } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j.response || null;
  } catch { return null; }
}

// ── Sensor trend predictor (Engine A) — linear regression 7วัน → ทำนาย 7วันข้างหน้า ──
async function fetchMetricSeries(metric: string, days = 7): Promise<{ t: number; v: number }[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(EPOCH FROM time) as t, value as v FROM sensor_telemetry WHERE metric = $1 AND time > NOW() - INTERVAL '${days} days' ORDER BY time ASC LIMIT 500`,
      metric
    );
    return rows.map(r => ({ t: Number(r.t), v: Number(r.v) }));
  } catch { return []; }
}
function linearForecast(series: { t: number; v: number }[], horizonSec: number): { slope: number; forecast: number | null; trend: string } {
  if (series.length < 3) return { slope: 0, forecast: null, trend: 'insufficient' };
  const n = series.length;
  const sumT = series.reduce((s, p) => s + p.t, 0);
  const sumV = series.reduce((s, p) => s + p.v, 0);
  const sumTT = series.reduce((s, p) => s + p.t * p.t, 0);
  const sumTV = series.reduce((s, p) => s + p.t * p.v, 0);
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return { slope: 0, forecast: series[series.length - 1].v, trend: 'flat' };
  const slope = (n * sumTV - sumT * sumV) / denom; // v per sec
  const last = series[series.length - 1];
  const forecast = last.v + slope * horizonSec;
  const trend = slope > 1e-6 ? 'up' : slope < -1e-6 ? 'down' : 'flat';
  return { slope, forecast, trend };
}
const SENSOR_THRESHOLDS: Record<string, { low?: number; high?: number; unit: string; label: string }> = {
  water_level_cm: { low: 30, unit: 'cm', label: 'ระดับน้ำ' },
  battery_soc: { low: 30, unit: '%', label: 'แบตเตอรี่' },
  battery_voltage: { low: 11.5, unit: 'V', label: 'แรงดันแบต' },
  soil_moisture: { low: 30, unit: '%', label: 'ความชื้นดิน' },
  temperature: { high: 38, unit: '°C', label: 'อุณหภูมิ' },
};
export async function predictSensorTrends(): Promise<any[]> {
  const out: any[] = [];
  for (const [metric, cfg] of Object.entries(SENSOR_THRESHOLDS)) {
    const series = await fetchMetricSeries(metric, 7);
    if (series.length < 3) continue;
    const { slope, forecast, trend } = linearForecast(series, 7 * 86400);
    if (forecast == null) continue;
    let risk = 0.2;
    let advice = 'ปกติ';
    if (cfg.low != null && forecast < cfg.low) { risk = 0.85; advice = `${cfg.label} จะต่ำกว่า ${cfg.low}${cfg.unit} ใน 7 วัน (คาด ${forecast.toFixed(1)}${cfg.unit}) — เตรียมเติม/ชาร์จ`; }
    else if (cfg.high != null && forecast > cfg.high) { risk = 0.8; advice = `${cfg.label} จะสูงกว่า ${cfg.high}${cfg.unit} — เฝ้าระวัง`; }
    else if (trend === 'down' && cfg.low != null) { risk = 0.4; advice = `${cfg.label} แนวโน้มลดลง`; }
    else if (trend === 'up' && cfg.high != null) { risk = 0.4; advice = `${cfg.label} แนวโน้มเพิ่มขึ้น`; }
    const lastVal = series[series.length - 1].v;
    out.push({ metric, label: cfg.label, unit: cfg.unit, last: Number(lastVal.toFixed(2)), forecast: Number(forecast.toFixed(2)), slope: Number((slope * 86400).toFixed(4)), trend, risk, advice, samples: series.length });
  }
  return out;
}

// ทำนายต่อ domain: ส่ง features → Ollama → parse JSON
export async function predict(domain: string, features: Record<string, any>): Promise<{ output: any; confidence: number; model: string }> {
  // Engine A: sensor ใช้ trend predictor ผสม Ollama
  if (domain === 'sensor' && !features.water_level_cm) {
    const trends = await predictSensorTrends();
    if (trends.length > 0) {
      const maxRisk = Math.max(...trends.map(t => t.risk));
      const top = trends.find(t => t.risk === maxRisk);
      return { output: { risk: maxRisk, advice: top?.advice || 'เฝ้าระวัง', trends, confidence: 0.65 }, confidence: 0.65, model: 'trend-linear' };
    }
  }
  const history = await prisma.learningSnapshot.findMany({ where: { domain }, orderBy: { capturedAt: 'desc' }, take: 5 });
  const prompt = `คุณคือ AI ทำนาย ${domain} ของบ้านพึ่งพาตัวเอง
ข้อมูลปัจจุบัน: ${JSON.stringify(features).slice(0, 1500)}
ประวัติ 5 ครั้งล่าสุด: ${JSON.stringify(history.map(h=>h.features)).slice(0, 1500)}
ให้ตอบเป็น JSON เท่านั้น: {"risk": 0-1, "advice": "คำแนะนำสั้นๆ 1 ประโยค", "confidence": 0-1}
ห้ามตอบอย่างอื่น`;

  const raw = await ollamaGenerate(prompt);
  if (raw) {
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        return { output: j, confidence: Number(j.confidence) || 0.7, model: DEFAULT_MODEL };
      }
    } catch {}
  }
  // fallback heuristic
  let risk = 0.3;
  if (domain === 'sensor' && features.water_level_cm && Number(features.water_level_cm.avg) < 20) risk = 0.8;
  if (domain === 'health' && features.readings > 5) risk = 0.6;
  return { output: { risk, advice: 'เฝ้าระวังต่อ (heuristic fallback)', confidence: 0.5 }, confidence: 0.5, model: 'heuristic' };
}

export async function createPrediction(domain: string, features: Record<string, any>, snapshotId?: string) {
  const { output, confidence, model } = await predict(domain, features);
  const pred = await prisma.learningPrediction.create({
    data: { domain, model, input: features as any, output: output as any, confidence, snapshotId: snapshotId || null },
  });
  return pred;
}

// เมื่อความจริงมาถึง: ประเมินว่า correct ไหม → อัปเดต accuracy
export async function evaluatePrediction(predictionId: string, actual: Record<string, any>): Promise<void> {
  const pred: any = await prisma.learningPrediction.findUnique({ where: { id: predictionId } });
  if (!pred) return;
  const output = pred.output as any;
  let correct: boolean | null = null;
  if (output && typeof output.risk === 'number' && typeof actual.risk === 'number') {
    correct = Math.abs(output.risk - actual.risk) < 0.3;
  } else if (output && actual) {
    correct = JSON.stringify(output).slice(0, 50) === JSON.stringify(actual).slice(0, 50);
  }
  await prisma.learningPrediction.update({ where: { id: predictionId }, data: { actual: actual as any, correct, evaluatedAt: new Date() } });
  // อัปเดต LearningModelState
  const all = await prisma.learningPrediction.findMany({ where: { domain: pred.domain, correct: { not: undefined } }, take: 100, orderBy: { createdAt: 'desc' } });
  const evaluated = all.filter((p: any) => p.correct !== null && p.correct !== undefined);
  const correctCount = evaluated.filter((p: any) => p.correct).length;
  const accuracy = evaluated.length ? correctCount / evaluated.length : null;
  await prisma.learningModelState.upsert({
    where: { domain: pred.domain },
    create: { domain: pred.domain, model: pred.model, accuracy, stats: { total: evaluated.length, correct: correctCount } as any },
    update: { accuracy, stats: { total: evaluated.length, correct: correctCount } as any, trainedAt: new Date() },
  });
}

export async function getModelState(domain?: string) {
  if (domain) return prisma.learningModelState.findUnique({ where: { domain } });
  return prisma.learningModelState.findMany();
}

export async function nightlyLearn(): Promise<{ snapshots: number; predictions: number }> {
  const snapshots = await (await import('./data-lake.service')).collectDailySnapshots();
  let predictions = 0;
  const recent = await prisma.learningSnapshot.findMany({ orderBy: { capturedAt: 'desc' }, take: 10 });
  for (const s of recent.slice(0, 3)) {
    try {
      await createPrediction(s.domain, s.features as any, s.id);
      predictions++;
    } catch {}
  }
  return { snapshots, predictions };
}
