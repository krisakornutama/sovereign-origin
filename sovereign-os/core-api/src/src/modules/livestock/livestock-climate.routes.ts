// livestock-climate.routes.ts — เสา 2: Microclimate & Utility Fail-Safe — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { actuationService } from '../../services/actuation.service';
import { computeTHI, thiStatus, shouldRunFan } from '../../services/livestock-vet-ai.service';
import { ClimateSample, climateHistory, MAX_CLIMATE_HISTORY, fanStates, notify } from './livestock-shared';

const router = Router();

// ═══════════ เสา 2: Microclimate & Utility Fail-Safe ═══════════

// POST /api/livestock/climate — telemetry อุณหภูมิ/ความชื้น → THI → สั่งเปิดพัดลมจริง + Telegram CRITICAL (>84)
router.post('/climate', authenticate, async (req, res) => {
  try {
    const { tempC, rhPct, houseCode } = req.body || {};
    const temp = Number(tempC);
    const rh = Number(rhPct);
    if (!Number.isFinite(temp) || !Number.isFinite(rh) || temp < -40 || temp > 60 || rh < 0 || rh > 100)
      return res.status(400).json({ error: 'tempC (-40..60) and rhPct (0..100) required' });
    const thi = computeTHI(temp, rh);
    const { level, label, actions } = thiStatus(thi);
    const sample: ClimateSample = {
      houseCode: houseCode || null,
      tempC: temp,
      rhPct: rh,
      thi,
      status: label as ClimateSample['status'],
      at: new Date().toISOString(),
    };
    climateHistory.push(sample);
    if (climateHistory.length > MAX_CLIMATE_HISTORY) climateHistory.shift();

    // Fail-safe จริง: เปิดที่ THI ≥ 74 / ปิดที่ THI ≤ 70 (dead-band + cooldown 5 นาที กัน anti-flapping)
    // sandbox = บันทึก state, real = MQTT — ผ่าน interlock (kill-switch/ปุ่มฉุกเฉินระงับ automation)
    const fanKey = sample.houseCode || 'default';
    const fan = fanStates.get(fanKey) || { on: false, lastToggleAt: 0 };
    const decision = shouldRunFan(thi, fan.on, fan.lastToggleAt);
    let failSafe: { ok: boolean; action: string; reason?: string } | null = null;
    if (decision.turnOn || decision.turnOff) {
      failSafe = await actuationService.executeCommand({
        actuatorId: 'load-1',
        desiredState: decision.turnOn ? 'on' : 'off',
        actor: 'system',
        reason: `LIVESTOCK THI=${thi.toFixed(1)} — ${decision.reason}`,
      });
      if (failSafe.ok) {
        fan.on = decision.turnOn;
        fan.lastToggleAt = Date.now();
        fanStates.set(fanKey, fan);
      }
    }

    // เก็บประวัติลง hypertable (Timescale) — พ้นความตายเมื่อ restart server
    try {
      await prisma.$queryRawUnsafe(
        `INSERT INTO livestock_climate_logs (id, "houseCode", "tempC", "rhPct", thi, status, at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::timestamptz)`,
        sample.houseCode || null,
        temp,
        rh,
        thi,
        label,
        sample.at
      );
    } catch (dbErr) {
      console.error('Livestock climate persist error:', dbErr);
    }

    // วิกฤตแล้วแต่พัดลมเปิดอยู่แล้ว → แจ้งสถานะ fail-safe ว่าปกป้องอยู่ (ไม่ต้องสั่งซ้ำ)
    if (level === 'critical' && !decision.turnOn && fan.on) {
      failSafe = { ok: true, action: 'on', reason: 'CRITICAL THI — พัดลมเปิดอยู่แล้ว (fail-safe คุ้มครองต่อ)' };
    }
    if (level === 'critical') {
      await notify(`🚨 LIVESTOCK CRITICAL: THI=${thi.toFixed(1)} (>84) — เปิดน้ำ/พัดลมทุกทางด่วน!`, 'critical', `thi-${houseCode || ''}`);
    }
    res.json({ thi, level, label, actions: actions.map((a) => a.action), failSafe, fanState: { on: fan.on, lastToggleAt: fan.lastToggleAt, decision }, sample });
  } catch (err) {
    console.error('Livestock climate error:', err);
    res.status(500).json({ error: 'Failed to record climate' });
  }
});

// GET /api/livestock/climate — ประวัติ THI (อ่านจาก hypertable 48 จุดล่าสุด)
router.get('/climate', authenticate, async (_req, res) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "houseCode" AS "houseCode", "tempC" AS "tempC", "rhPct" AS "rhPct", thi, status, at
       FROM livestock_climate_logs
       ORDER BY at DESC
       LIMIT 48`
    );
    const history = rows.map((r) => ({
      houseCode: r.houseCode,
      tempC: r.tempC,
      rhPct: r.rhPct,
      thi: r.thi,
      status: r.status,
      at: new Date(r.at).toISOString(),
    })).reverse();
    res.json({ history, latest: history[history.length - 1] || null });
  } catch (err) {
    console.error('Livestock climate history error:', err);
    res.status(500).json({ error: 'Failed to load climate history' });
  }
});

// POST /api/livestock/utility — สถานะไฟหลัก/เครื่องปั่นไฟ/ATS → fail-safe (BLACKOUT + FAIL = วิกฤต)
router.post('/utility', authenticate, async (req, res) => {
  try {
    const { houseCode, gridPowerState, generatorState } = req.body || {};
    const grid = String(gridPowerState || 'NORMAL').toUpperCase();
    const gen = String(generatorState || 'OFF').toUpperCase();
    if (!houseCode || String(houseCode).trim().length === 0)
      return res.status(400).json({ error: 'houseCode is required' });
    if (!['NORMAL', 'BLACKOUT'].includes(grid) || !['OFF', 'RUNNING', 'FAIL'].includes(gen))
      return res.status(400).json({ error: 'Invalid gridPowerState / generatorState' });

    const alert = await prisma.utilityAlertLog.create({
      data: { houseCode: String(houseCode), gridPowerState: grid, generatorState: gen },
    });

    let anomaly: 'NONE' | 'WARN' | 'CRITICAL' = 'NONE';
    if (grid === 'BLACKOUT' && gen === 'RUNNING') anomaly = 'WARN';
    if (grid === 'BLACKOUT' && gen === 'FAIL') anomaly = 'CRITICAL';
    if (grid === 'BLACKOUT' && gen === 'OFF') anomaly = 'CRITICAL';

    if (anomaly !== 'NONE') {
      const text =
        anomaly === 'CRITICAL'
          ? `🚨 ATS FAIL-SAFE: ${houseCode} ไฟดับ + เครื่องปั่น FAIL — เปิดพัดลมฉุกเฉิน/แบตสำรองทันที`
          : `⚠️ ${houseCode} ไฟดับ — เครื่องปั่นทำงานแล้ว`;
      await notify(text, anomaly === 'CRITICAL' ? 'critical' : 'warn', `ats-${houseCode}-${grid}-${gen}`);
    }
    res.json({ alert, anomaly });
  } catch (err) {
    console.error('Livestock utility error:', err);
    res.status(500).json({ error: 'Failed to record utility alert' });
  }
});

export default router;
