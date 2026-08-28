// livestock-production.routes.ts — เสา 3: Precision Feed & Production — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  computeFCR,
  computeHD,
  detectMortalitySpike,
  detectWaterDrop,
  detectFcrDeviation,
  detectHDDrop,
  evaluateDailyLog,
  computeMortalityImpact,
  quarantineStatus,
  withdrawalStatus,
  type VetAction,
} from '../../services/livestock-vet-ai.service';
import { deductStock, addStock } from '../../services/inventory.service';
import { WRITE_ROLES, DAY_MS, QUARANTINE_DAYS, ROS, notify, parseDate } from './livestock-shared';

const router = Router();

// ═══════════ เสา 3: Precision Feed & Production ═══════════

// GET /api/livestock/silos — ถังอาหารทั้งหมด + % คงเหลือ
router.get('/silos', authenticate, async (_req, res) => {
  try {
    const silos = await prisma.feedSilo.findMany({ orderBy: { siloCode: 'asc' } });
    res.json({
      silos: silos.map((s) => ({
        ...s,
        fillPct: +(s.capacityKg > 0 ? (s.currentKg / s.capacityKg) * 100 : 0).toFixed(1),
      })),
    });
  } catch (err) {
    console.error('Livestock silos error:', err);
    res.status(500).json({ error: 'Failed to load feed silos' });
  }
});

// POST /api/livestock/silos — ลงทะเบียนถัง (ผูก inventoryItemId ได้ → เบิก/เติม = หัก/เพิ่มคลัง)
router.post('/silos', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { siloCode, capacityKg, currentKg, lastRefillAt, inventoryItemId } = req.body || {};
    if (!siloCode || String(siloCode).trim().length === 0)
      return res.status(400).json({ error: 'siloCode is required' });
    const cap = Number(capacityKg);
    if (!Number.isFinite(cap) || cap <= 0) return res.status(400).json({ error: 'capacityKg must be > 0' });
    const silo = await prisma.feedSilo.create({
      data: {
        siloCode: String(siloCode),
        capacityKg: cap,
        currentKg: currentKg === undefined || currentKg === null ? cap : Number(currentKg),
        lastRefillAt: parseDate(lastRefillAt) === 'invalid' ? new Date() : (parseDate(lastRefillAt) ?? new Date()),
        inventoryItemId: inventoryItemId ? String(inventoryItemId) : null,
      },
    });
    res.json({ silo });
  } catch (err) {
    console.error('Livestock silo create error:', err);
    res.status(500).json({ error: 'Failed to create feed silo' });
  }
});

// PATCH /api/livestock/silos/:id/refill — เติม/เบิกอาหาร → ซิงก์ยอดคงเหลือในคลังอัตโนมัติ
router.patch('/silos/:id/refill', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { deltaKg } = req.body || {};
    const delta = Number(deltaKg);
    if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'deltaKg must be non-zero' });
    const silo = await prisma.feedSilo.findUnique({ where: { id: req.params.id } });
    if (!silo) return res.status(404).json({ error: 'Silo not found' });
    const next = Math.max(0, Math.min(silo.capacityKg, silo.currentKg + delta));
    const updated = await prisma.feedSilo.update({
      where: { id: silo.id },
      data: { currentKg: next, lastRefillAt: delta > 0 ? new Date() : silo.lastRefillAt },
    });
    // Automated Inventory Depletion: เบิกอาหาร (delta < 0) = หักคลัง, เติม (delta > 0) = กลับเข้าคลัง
    let stock = null;
    if (silo.inventoryItemId) {
      stock = delta < 0
        ? await deductStock(prisma, silo.inventoryItemId, Math.abs(delta))
        : await addStock(prisma, silo.inventoryItemId, delta);
      if (delta < 0 && !stock.ok) {
        await notify(`⚠️ คลัง: เบิกอาหาร ${stock.reason} — ตรวจยอดคงเหลือ`, 'warn', `stock-silo-${silo.id}`);
      }
    }
    if (next / silo.capacityKg < 0.15) {
      await notify(`🥣 FEED LOW: ${silo.siloCode} เหลือ ${(next / silo.capacityKg * 100).toFixed(0)}% — เติมอาหาร`, 'warn', `silo-${silo.id}-low`);
    }
    res.json({ silo: updated, stock });
  } catch (err) {
    console.error('Livestock silo refill error:', err);
    res.status(500).json({ error: 'Failed to refill feed silo' });
  }
});

/**
 * เติม VetAction จาก FCR / HD% / วัคซีนครบกำหนด — แล้วส่ง Telegram (dedup ด้วย eventKey)
 */
async function runProductionChecks(
  group: { id: string; code: string; quantity: number; birthDate: Date; species: string },
  logs: {
    logDate: Date;
    mortalityCount: number;
    culledCount?: number;
    feedConsumedKg: number;
    waterConsumedL?: number | null;
    eggCount?: number | null;
    avgWeightGram?: number | null;
  }[],
  schedules: { id: string; vaccineName: string; targetAgeDays: number; isCompleted: boolean }[],
  actions: VetAction[]
): Promise<VetAction[]> {
  // ── FCR vs Standard Curve: สูงกว่า >10% → เตือน ──
  const last = logs[logs.length - 1];
  const fcrStart = logs.find((l) => l.avgWeightGram != null);
  const fcr = computeFCR({
    feedKg: logs.reduce((s, l) => s + l.feedConsumedKg, 0),
    startAvgGram: fcrStart?.avgWeightGram,
    endAvgGram: last?.avgWeightGram,
    quantity: group.quantity,
  });
  const standardFcr = ROS[group.species.toLowerCase() as keyof typeof ROS] ?? 2.0;
  const fcrDev = detectFcrDeviation(fcr.fcr, standardFcr);
  if (fcrDev.dev) {
    actions.push({ severity: 'warn', action: 'FCR_DEVIATION', message: fcrDev.message });
    await notify(`⚠️ ${fcrDev.message} — กลุ่ม ${group.code}`, 'warn', `fcr-${group.id}`);
  }

  // ── HD% ร่วง >5% เทียบวานนี้ → ตรวจโภชนาการ/แสง ──
  const prev = logs[logs.length - 2] || null;
  const yesterdayHd = prev ? computeHD(prev.eggCount ?? 0, group.quantity) : null;
  const todayHd = last ? computeHD(last.eggCount ?? 0, group.quantity) : null;
  const hdDrop = detectHDDrop(todayHd, yesterdayHd);
  if (hdDrop.dropped) {
    actions.push({ severity: 'warn', action: 'HD_DROP', message: hdDrop.message });
    await notify(`⚠️ ${hdDrop.message} — กลุ่ม ${group.code}`, 'warn', `hddrop-${group.id}`);
  }

  // ── วัคซีนครบกำหนดแต่ยังไม่ฉีด (lazy check) ──
  const ageDays = Math.floor((Date.now() - new Date(group.birthDate).getTime()) / DAY_MS);
  for (const s of schedules) {
    if (!s.isCompleted && s.targetAgeDays > 0 && ageDays >= s.targetAgeDays) {
      const msg = `💉 วัคซีน ${s.vaccineName} ครบกำหนดแล้ว (อายุ ${ageDays} วัน) — กลุ่ม ${group.code}`;
      actions.push({ severity: 'warn', action: 'VACCINE_DUE', message: msg });
      await notify(`⚠️ ${msg}`, 'warn', `vaccine-${s.id}`);
    }
  }
  return actions;
}

// POST /api/livestock/groups/:id/daily-logs — บันทึกผลผลิตประจำวัน (upsert ตามวัน) → รัน Vet AI
router.post('/groups/:id/daily-logs', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { logDate, mortalityCount, culledCount, feedConsumedKg, waterConsumedL, eggCount, avgWeightGram } =
      req.body || {};
    const day = parseDate(logDate);
    if (day === 'invalid') return res.status(400).json({ error: 'logDate must be a valid date' });
    const today = (day ?? new Date()).toISOString();

    const log = await prisma.dailyProductionLog.upsert({
      where: { livestockGroupId_logDate: { livestockGroupId: req.params.id, logDate: today } },
      create: {
        livestockGroupId: req.params.id,
        logDate: today,
        mortalityCount: Number(mortalityCount) || 0,
        culledCount: Number(culledCount) || 0,
        feedConsumedKg: Number(feedConsumedKg) || 0,
        waterConsumedL: waterConsumedL === undefined || waterConsumedL === '' ? null : Number(waterConsumedL),
        eggCount: eggCount === undefined || eggCount === '' ? null : Number(eggCount),
        avgWeightGram: avgWeightGram === undefined || avgWeightGram === '' ? null : Number(avgWeightGram),
      },
      update: {
        mortalityCount: Number(mortalityCount) || 0,
        culledCount: Number(culledCount) || 0,
        feedConsumedKg: Number(feedConsumedKg) || 0,
        waterConsumedL: waterConsumedL === undefined || waterConsumedL === '' ? null : Number(waterConsumedL),
        eggCount: eggCount === undefined || eggCount === '' ? null : Number(eggCount),
        avgWeightGram: avgWeightGram === undefined || avgWeightGram === '' ? null : Number(avgWeightGram),
      },
    });

    const group = await prisma.livestockGroup.findUnique({
      where: { id: req.params.id },
      include: {
        dailyLogs: { orderBy: { logDate: 'asc' }, take: 30 },
        schedules: { where: { isCompleted: false } },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const logs = group.dailyLogs;
    const actions = evaluateDailyLog({ logs, currentQuantity: group.quantity });
    await runProductionChecks(group, logs, group.schedules, actions);

    let statusChanged: string | null = null;
    for (const action of actions) {
      if (action.action === 'QUARANTINE' && group.status !== 'QUARANTINE') {
        const endAt = new Date(Date.now() + QUARANTINE_DAYS * DAY_MS);
        await prisma.livestockGroup.update({
          where: { id: group.id },
          data: { status: 'QUARANTINE', quarantineEndAt: endAt },
        });
        statusChanged = 'QUARANTINE';
        await notify(
          `🚨 ${action.message} — กลุ่ม ${group.code} (${group.species}) กักกัน ${QUARANTINE_DAYS} วัน ปลดอัตโนมัติ ${endAt.toISOString().slice(0, 10)}`,
          'critical',
          `quarantine-${group.id}`
        );
      } else if (action.action === 'WATER_DROP') {
        await notify(`⚠️ ${action.message} — กลุ่ม ${group.code}`, 'warn', `waterdrop-${group.id}`);
      }
    }

    const water = detectWaterDrop(logs);
    const last = logs[logs.length - 1];
    const prev = logs[logs.length - 2] || null;
    const yesterdayHd = prev ? computeHD(prev.eggCount ?? 0, group.quantity) : null;
    const todayHd = last ? computeHD(last.eggCount ?? 0, group.quantity) : null;

    res.json({
      log,
      actions,
      statusChanged,
      analysis: {
        hdPct: todayHd,
        hdDropPct:
          todayHd != null && yesterdayHd != null ? +((todayHd - yesterdayHd)).toFixed(1) : null,
        waterDropPct: water.pct,
        mortalityPct: last
          ? +((last.mortalityCount / group.quantity) * 100).toFixed(2)
          : 0,
      },
    });
  } catch (err) {
    console.error('Livestock daily log error:', err);
    res.status(500).json({ error: 'Failed to save daily log' });
  }
});

// GET /api/livestock/groups/:id/metrics — FCR/HD/ตาย/น้ำ/ล็อกยาค้าง — ใช้ในหน้า
router.get('/groups/:id/metrics', authenticate, async (req, res) => {
  try {
    const group = await prisma.livestockGroup.findUnique({
      where: { id: req.params.id },
      include: {
        dailyLogs: { orderBy: { logDate: 'asc' } },
        records: { orderBy: { safeHarvestDate: 'desc' }, take: 1 },
        schedules: { where: { isCompleted: false }, orderBy: { targetAgeDays: 'asc' } },
        batches: { orderBy: { created_at: 'desc' }, take: 1 },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const logs = group.dailyLogs;
    const secondLast = logs.length >= 2 ? logs[logs.length - 2] : null;
    const last = logs[logs.length - 1] || null;
    const fcrStart = logs.find((l) => l.avgWeightGram != null);
    const fcr = computeFCR({
      feedKg: logs.reduce((s, l) => s + l.feedConsumedKg, 0),
      startAvgGram: fcrStart?.avgWeightGram,
      endAvgGram: last?.avgWeightGram,
      quantity: group.quantity,
    });
    const standardFcr = ROS[group.species.toLowerCase() as keyof typeof ROS] ?? 2.0;
    const fcrDev = fcr.fcr != null ? +(((fcr.fcr - standardFcr) / standardFcr) * 100).toFixed(1) : null;
    const hdToday = last ? computeHD(last.eggCount ?? 0, group.quantity) : null;
    const hdPrev = secondLast ? computeHD(secondLast.eggCount ?? 0, group.quantity) : null;
    const spike = detectMortalitySpike(logs, group.quantity);
    const water = detectWaterDrop(logs);
    const lock = group.records[0]
      ? withdrawalStatus(group.records[0].safeHarvestDate)
      : { locked: false, daysLeft: 0 };
    const totalFeed = logs.reduce((s, l) => s + l.feedConsumedKg, 0);
    const totalMortality = logs.reduce((s, l) => s + l.mortalityCount, 0);

    // ── Mortality Financial Impact: สัตว์ที่ตาย × ต้นทุนต่อตัว (เทียบงบชุดเลี้ยง) ──
    const latestBatch = group.batches[0] || null;
    const batchCost = latestBatch
      ? latestBatch.initialAnimalCost + latestBatch.totalFeedCost + latestBatch.totalMedCost + latestBatch.totalUtilityCost
      : 0;
    const unitCostPerAnimal = batchCost > 0 ? batchCost / group.quantity : 0;
    const mortalityFinancial = computeMortalityImpact({
      totalMortality,
      unitCostPerAnimal,
      batchCost: latestBatch ? batchCost : 0,
    });

    res.json({
      metrics: {
        fcr: fcr.fcr,
        standardFcr,
        fcrDeviationPct: fcrDev,
        hdPct: hdToday,
        hdDropPct: hdPrev && hdToday != null ? +((hdToday - hdPrev)).toFixed(1) : null,
        totalFeedKg: +totalFeed.toFixed(1),
        totalMortality,
        mortalityRatePct: spike.ratePct,
        spike,
        waterDropPct: water.pct,
        withdrawalLock: lock,
        pendingVaccines: group.schedules.length,
        mortalityFinancial,
        quarantine: quarantineStatus(group.quarantineEndAt),
      },
    });
  } catch (err) {
    console.error('Livestock metrics error:', err);
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});

export default router;
