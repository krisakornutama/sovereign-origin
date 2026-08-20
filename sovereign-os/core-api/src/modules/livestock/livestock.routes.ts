// ═════════════════════════════════════════════════════════════
// Sovereign Livestock Engine — 6 Operational Pillars:
// 1) Medical & Biosecurity Gate  2) Microclimate & Ventilation Fail-Safe
// 3) Precision Feed & Production 4) Reproductive & Breeding Cycle
// 5) Biosecurity Access Control  6) Batch Financial Engine
// Mount: /api/livestock (featureGuard('/livestock'))
// ═════════════════════════════════════════════════════════════
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { sendTelegramAlert } from '../../services/telegram-alert.service';
import { actuationService } from '../../services/actuation.service';
import {
  computeTHI,
  thiStatus,
  computeFCR,
  computeHD,
  computeDrugTotalL,
  detectMortalitySpike,
  detectWaterDrop,
  detectFcrDeviation,
  detectHDDrop,
  computeHatchability,
  withdrawalStatus,
  gateCheck,
  evaluateDailyLog,
  GATE_SANITIZE_MIN_SEC,
  shouldRunFan,
  validateDosage,
  computeMortalityImpact,
  quarantineStatus,
  parseLivestockVisionResponse,
  LIVESTOCK_VISION_PROMPT,
  type VetAction,
} from '../../services/livestock-vet-ai.service';
import { deductStock, addStock } from '../../services/inventory.service';
import { callVision, VISION_ENABLED, VISION_MODEL } from '../../services/vision.service';

const router = Router();
export const prisma = new PrismaClient();

const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];
const DAY_MS = 86_400_000;
// ระยะกักกันอัตโนมัติ (วัน) — นับจากวันที่เข้ากักกัน → cron ปลดเอง
const QUARANTINE_DAYS = parseInt(process.env.LIVESTOCK_QUARANTINE_DAYS || '14', 10);
const SPECIES = ['POULTRY_BROILER', 'POULTRY_LAYER', 'DUCK', 'SWINE', 'CATTLE'];
const GROUP_STATUSES = ['ACTIVE', 'QUARANTINE', 'HARVESTED', 'LOCKED_WITHDRAWAL'];
const BREED_STATUSES = ['PREGNANT', 'LITTERED', 'FAILED', 'ABORTED'];
// FCR standard curve ตามชนิดพันธุ์ (kg อาหารต่อ kg น้ำหนักเพิ่ม)
const ROS = {
  broiler: 1.9,
  layer: 2.0,
  duck: 2.2,
  swine: 3.0,
  cattle: 7.0,
};

interface ClimateSample {
  houseCode?: string;
  tempC: number;
  rhPct: number;
  thi: number;
  status: 'COMFORT' | 'HEAT_WARNING' | 'CRITICAL';
  at: string;
}
// ประวัติ climate ถูกเก็บลง hypertable (livestock_climate_logs) แล้ว —
// ในหน่วยความจำใช้เป็น cache เล็กๆ เฉพาะ session นี้เท่านั้น
const climateHistory: ClimateSample[] = [];
const MAX_CLIMATE_HISTORY = 500;

// สถานะพัดลมต่อเล้า (Hysteresis & Anti-Flapping) — จำ on/off + เวลาสั่งครั้งสุดท้าย
// เพื่อกัน "ตัด-ต่อ" ถี่ๆ ตอน THI ก้ำกึ่ง threshold (เปิด 74 / ปิด 70 + cooldown 5 นาที)
const fanStates = new Map<string, { on: boolean; lastToggleAt: number }>();

const notify = (text: string, severity: 'info' | 'warn' | 'critical', eventKey?: string) =>
  sendTelegramAlert({ text, severity, eventKey });

const parseDate = (v: unknown): Date | null | 'invalid' => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};

// ═══════════ ฐาน: กลุ่มปศุสัตว์ (CRUD) ═══════════

// GET /api/livestock/groups?species=&status=
router.get('/groups', authenticate, async (req, res) => {
  try {
    const { species, status } = req.query;
    const where: Record<string, unknown> = {};
    if (species && SPECIES.includes(String(species))) where.species = String(species);
    if (status && GROUP_STATUSES.includes(String(status))) where.status = String(status);
    const groups = await prisma.livestockGroup.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { records: true, dailyLogs: true } },
      },
    });
    res.json({ groups });
  } catch (err) {
    console.error('Livestock groups list error:', err);
    res.status(500).json({ error: 'Failed to load livestock groups' });
  }
});

// POST /api/livestock/groups — สร้างกลุ่ม (species/quantity/birthDate/houseCode)
router.post('/groups', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { code, name, species, quantity, birthDate, houseCode, status, notes } = req.body || {};
    if (!code || String(code).trim().length === 0) return res.status(400).json({ error: 'code is required' });
    if (!species || !SPECIES.includes(String(species)))
      return res.status(400).json({ error: `Invalid species — ใช้ได้: ${SPECIES.join(', ')}` });
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be > 0' });
    const born = parseDate(birthDate);
    if (born === 'invalid') return res.status(400).json({ error: 'birthDate must be a valid date' });
    const groupStatus = status ? String(status) : 'ACTIVE';
    if (!GROUP_STATUSES.includes(groupStatus))
      return res.status(400).json({ error: `Invalid status — ใช้ได้: ${GROUP_STATUSES.join(', ')}` });

    const group = await prisma.livestockGroup.create({
      data: {
        code: String(code),
        name: name || null,
        species: String(species),
        quantity: qty,
        birthDate: born ?? new Date(),
        houseCode: houseCode || null,
        status: groupStatus,
        quarantineEndAt: groupStatus === 'QUARANTINE' ? new Date(Date.now() + QUARANTINE_DAYS * DAY_MS) : null,
        notes: notes || null,
      },
    });
    res.json({ group });
  } catch (err) {
    console.error('Livestock group create error:', err);
    res.status(500).json({ error: 'Failed to create livestock group' });
  }
});

// PATCH /api/livestock/groups/:id — แก้/เปลี่ยนสถานะ (QUARANTINE → ACTIVE ด้วยมือ หลังสัตวบาลเคลียร์)
router.patch('/groups/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, quantity, houseCode, status, notes } = req.body || {};
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name || null;
    if (quantity !== undefined) data.quantity = Number(quantity);
    if (houseCode !== undefined) data.houseCode = houseCode || null;
    if (status !== undefined) {
      if (!GROUP_STATUSES.includes(String(status)))
        return res.status(400).json({ error: `Invalid status — ใช้ได้: ${GROUP_STATUSES.join(', ')}` });
      data.status = String(status);
      // เข้ากักกัน → ตั้งเวลาปลดอัตโนมัติ / ออกจากกักกัน → ล้างเวลา (Quarantine Cooldown)
      if (String(status) === 'QUARANTINE') {
        data.quarantineEndAt = new Date(Date.now() + QUARANTINE_DAYS * DAY_MS);
      } else {
        data.quarantineEndAt = null;
      }
    }
    if (notes !== undefined) data.notes = notes || null;
    const group = await prisma.livestockGroup.update({ where: { id }, data });
    res.json({ group });
  } catch (err) {
    console.error('Livestock group update error:', err);
    res.status(500).json({ error: 'Failed to update livestock group' });
  }
});

// DELETE /api/livestock/groups/:id
router.delete('/groups/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.livestockGroup.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Livestock group delete error:', err);
    res.status(500).json({ error: 'Failed to delete livestock group' });
  }
});

// GET /api/livestock/groups/:id — รายละเอียด + ประวัติทั้งหมด (ยา/วัคซีน/log/ผสมเทียม/Batch)
router.get('/groups/:id', authenticate, async (req, res) => {
  try {
    const group = await prisma.livestockGroup.findUnique({
      where: { id: req.params.id },
      include: {
        records: { orderBy: { administeredAt: 'desc' } },
        schedules: { orderBy: { targetAgeDays: 'asc' } },
        dailyLogs: { orderBy: { logDate: 'asc' } },
        breedings: { orderBy: { inseminatedAt: 'desc' } },
        batches: true,
        visions: { orderBy: { created_at: 'desc' }, take: 10 },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const latestSafe =
      group.records.length > 0
        ? group.records.reduce((latest, m) => {
            const t = new Date(m.safeHarvestDate).getTime();
            return t > latest ? t : latest;
          }, 0)
        : 0;
    const lock = withdrawalStatus(new Date(latestSafe || Date.now()));
    const quarantine = quarantineStatus(group.quarantineEndAt);
    res.json({ group, withdrawalLock: lock, quarantine });
  } catch (err) {
    console.error('Livestock group detail error:', err);
    res.status(500).json({ error: 'Failed to load livestock group' });
  }
});

// ═══════════ เสา 1: Medical — บันทึกยา + ระยะหยุดยา + ล็อกขาย + วัคซีน ═══════════

// POST /api/livestock/groups/:id/medical — บันทึกยา → safeHarvestDate = วันนี้ + withdrawalDays
router.post('/groups/:id/medical', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { drugName, dosageMgKg, withdrawalDays, administeredAt, inventoryItemId } = req.body || {};
    if (!drugName || String(drugName).trim().length === 0)
      return res.status(400).json({ error: 'drugName is required' });
    const dose = Number(dosageMgKg);
    if (!Number.isFinite(dose) || dose < 0) return res.status(400).json({ error: 'dosageMgKg must be >= 0' });
    const days = Number(withdrawalDays);
    if (!Number.isFinite(days) || days < 0) return res.status(400).json({ error: 'withdrawalDays must be >= 0' });

    // ── Dosage Sanity Checker (Guardrail กันยาเกินขนาด) ──
    // ยาเกิน hard-cap → ปฏิเสธทันที (AI hallucination กันไม่ได้ให้เข้า DB)
    const dosageVerdict = validateDosage({ drugName: String(drugName), doseMgPerKg: dose, withdrawalDays: days });
    if (!dosageVerdict.ok) {
      return res.status(400).json({ error: dosageVerdict.reason, cap: dosageVerdict });
    }

    const givenAt = parseDate(administeredAt);
    if (givenAt === 'invalid') return res.status(400).json({ error: 'administeredAt must be a valid date' });
    const base = (givenAt ?? new Date()).getTime();
    const safeHarvestDate = new Date(base + days * DAY_MS);

    // Drug Dosage AI: รวมลิตรน้ำยาเมื่อผสมน้ำ (ถ้าส่ง avgWeightKg + drugConcentrationMgPerL)
    const record = await prisma.medicalRecord.create({
      data: {
        livestockGroupId: req.params.id,
        drugName: String(drugName),
        dosageMgKg: dose,
        administeredAt: new Date(base),
        withdrawalDays: days,
        safeHarvestDate,
        inventoryItemId: inventoryItemId ? String(inventoryItemId) : null,
      },
    });

    // ── Automated Inventory Depletion: บันทึกยา = หักยอดคงเหลือในคลัง 1 โดส ──
    let stock = null;
    if (inventoryItemId) {
      stock = await deductStock(prisma, String(inventoryItemId), 1);
      if (!stock.ok) {
        await notify(`⚠️ คลัง: หักสต็อกยา ${stock.reason} — ยา "${String(drugName)}" บันทึกแล้วแต่คลังไม่พอ`, 'warn', `stock-medical-${record.id}`);
      }
    }

    // ยาบางตัวทำให้ขายไม่ได้: LOCKED_WITHDRAWAL อัตโนมัติจนพ้นระยะ
    let group = await prisma.livestockGroup.findUnique({ where: { id: req.params.id } });
    if (group && days > 0 && group.status === 'ACTIVE') {
      group = await prisma.livestockGroup.update({
        where: { id: group.id },
        data: { status: 'LOCKED_WITHDRAWAL' },
      });
      await notify(
        `💊 LOCKED_WITHDRAWAL: ${group.code} — ${drugName} ระยะหยุดยา ${days} วัน (ปลดล็อก ${safeHarvestDate.toISOString().slice(0, 10)})`,
        'warn',
        `withdrawal-${group.id}-${drugName}`
      );
    }

    const drugTotalL =
      typeof req.body.avgWeightKg === 'number' && typeof req.body.drugConcentrationMgPerL === 'number'
        ? computeDrugTotalL(
            Number(req.body.avgWeightKg),
            group?.quantity ?? 0,
            dose,
            Number(req.body.drugConcentrationMgPerL)
          )
        : null;
    res.json({ record, groupLocked: days > 0, drugTotalL, stock, dosageChecked: { ok: true, known: dosageVerdict.known, maxMgPerKg: dosageVerdict.maxMgPerKg } });
  } catch (err) {
    console.error('Livestock medical create error:', err);
    res.status(500).json({ error: 'Failed to create medical record' });
  }
});

// POST /api/livestock/groups/:id/vaccines — เพิ่มแผนวัคซีน (targetAgeDays นับจาก birthDate)
router.post('/groups/:id/vaccines', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { vaccineName, targetAgeDays, inventoryItemId } = req.body || {};
    if (!vaccineName || String(vaccineName).trim().length === 0)
      return res.status(400).json({ error: 'vaccineName is required' });
    const age = Number(targetAgeDays);
    if (!Number.isFinite(age) || age < 0) return res.status(400).json({ error: 'targetAgeDays must be >= 0' });
    const schedule = await prisma.vaccineSchedule.create({
      data: {
        livestockGroupId: req.params.id,
        vaccineName: String(vaccineName),
        targetAgeDays: age,
        inventoryItemId: inventoryItemId ? String(inventoryItemId) : null,
      },
    });
    res.json({ schedule });
  } catch (err) {
    console.error('Livestock vaccine create error:', err);
    res.status(500).json({ error: 'Failed to create vaccine schedule' });
  }
});

// PATCH /api/livestock/vaccines/:id — ฉีดแล้ว (isCompleted + completedAt) → หักสต็อกวัคซีนอัตโนมัติ
router.patch('/vaccines/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { isCompleted } = req.body || {};
    const schedule = await prisma.vaccineSchedule.update({
      where: { id: req.params.id },
      data: {
        isCompleted: !!isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
    });
    let stock = null;
    if (isCompleted && schedule.inventoryItemId) {
      stock = await deductStock(prisma, schedule.inventoryItemId, 1);
      if (!stock.ok) {
        await notify(`⚠️ คลัง: หักสต็อกวัคซีน ${stock.reason} — ฉีดแล้วแต่คลังไม่พอ`, 'warn', `stock-vaccine-${schedule.id}`);
      }
    }
    res.json({ schedule, stock });
  } catch (err) {
    console.error('Livestock vaccine update error:', err);
    res.status(500).json({ error: 'Failed to update vaccine schedule' });
  }
});

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

// ═══════════ เสา 4: Reproductive & Breeding Cycle ═══════════

// POST /api/livestock/groups/:id/breeding — บันทึกผสมเทียม/กกไข่
router.post('/groups/:id/breeding', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { inseminatedAt, expectedBirthAt, eggSetCount } = req.body || {};
    const ins = parseDate(inseminatedAt);
    if (ins === 'invalid') return res.status(400).json({ error: 'inseminatedAt must be a valid date' });
    const rec = await prisma.breedingRecord.create({
      data: {
        livestockGroupId: req.params.id,
        inseminatedAt: ins ?? new Date(),
        expectedBirthAt: (() => {
          const e = parseDate(expectedBirthAt);
          if (e === 'invalid') throw new Error('bad date');
          return e ?? new Date((ins ?? new Date()).getTime() + 21 * DAY_MS);
        })(),
        eggSetCount: eggSetCount === undefined || eggSetCount === '' ? null : Number(eggSetCount),
      },
    });
    res.json({ record: rec });
  } catch (err) {
    console.error('Livestock breeding create error:', err);
    res.status(500).json({ error: 'Failed to create breeding record' });
  }
});

// PATCH /api/livestock/breeding/:id — อัปเดตผล (คลอด/ฟัก/แท้ง) → hatchability
router.patch('/breeding/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { actualBirthAt, litterSize, hatchedCount, status } = req.body || {};
    const data: Record<string, unknown> = {};
    const birth = parseDate(actualBirthAt);
    if (birth === 'invalid') return res.status(400).json({ error: 'actualBirthAt must be a valid date' });
    if (birth) data.actualBirthAt = birth;
    if (litterSize !== undefined) data.litterSize = Number(litterSize);
    if (hatchedCount !== undefined) data.hatchedCount = Number(hatchedCount);
    if (status !== undefined) {
      if (!BREED_STATUSES.includes(String(status)))
        return res.status(400).json({ error: `Invalid status — ใช้ได้: ${BREED_STATUSES.join(', ')}` });
      data.status = String(status);
    }
    const rec = await prisma.breedingRecord.update({ where: { id: req.params.id }, data });
    res.json({
      record: rec,
      hatchabilityPct: computeHatchability(rec.hatchedCount, rec.eggSetCount),
    });
  } catch (err) {
    console.error('Livestock breeding update error:', err);
    res.status(500).json({ error: 'Failed to update breeding record' });
  }
});

// ═══════════ เสา 5: Biosecurity Access Control ═══════════

// POST /api/livestock/biosecurity — ลงบันทึกเข้าฟาร์ม → gateCheck (ฉีดพ่น ≥180s)
router.post('/biosecurity', authenticate, async (req, res) => {
  try {
    const { visitorName, vehiclePlate, sanitizedSec } = req.body || {};
    if (!visitorName || String(visitorName).trim().length === 0)
      return res.status(400).json({ error: 'visitorName is required' });
    const sec = Number(sanitizedSec);
    if (!Number.isFinite(sec) || sec < 0) return res.status(400).json({ error: 'sanitizedSec must be >= 0' });
    const gate = gateCheck(sec);
    const entry = await prisma.biosecurityLog.create({
      data: {
        visitorName: String(visitorName),
        vehiclePlate: vehiclePlate || null,
        sanitizedSec: sec,
        passedGate: gate.passed,
      },
    });
    if (!gate.passed) {
      await notify(`🚧 GATE DENIED: ${visitorName} ฉีดพ่น ${sec}s (<${GATE_SANITIZE_MIN_SEC}s) — ห้ามเข้าฟาร์ม`, 'warn');
    }
    res.json({ entry, gate });
  } catch (err) {
    console.error('Livestock biosecurity error:', err);
    res.status(500).json({ error: 'Failed to record biosecurity log' });
  }
});

// GET /api/livestock/biosecurity — ประวัติเข้า-ออก (รวมคนที่ยังอยู่ในฟาร์ม)
router.get('/biosecurity', authenticate, async (_req, res) => {
  try {
    const logs = await prisma.biosecurityLog.findMany({
      orderBy: { entryTime: 'desc' },
      take: 100,
    });
    const denied = logs.filter((l) => !l.passedGate).length;
    const inside = logs.filter((l) => l.passedGate && !l.exitTime).length;
    res.json({ logs, summary: { total: logs.length, denied, inside } });
  } catch (err) {
    console.error('Livestock biosecurity list error:', err);
    res.status(500).json({ error: 'Failed to load biosecurity logs' });
  }
});

// POST /api/livestock/biosecurity/:id/exit — ลงเวลาออกฟาร์ม (ครบรอบเข้า-ออก)
router.post('/biosecurity/:id/exit', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const entry = await prisma.biosecurityLog.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Biosecurity log not found' });
    if (entry.exitTime) return res.status(400).json({ error: 'บันทึกเวลาออกแล้ว' });
    const exited = await prisma.biosecurityLog.update({
      where: { id: entry.id },
      data: { exitTime: new Date() },
    });
    res.json({ entry: exited, durationMs: new Date(exited.exitTime!).getTime() - new Date(entry.entryTime).getTime() });
  } catch (err) {
    console.error('Livestock biosecurity exit error:', err);
    res.status(500).json({ error: 'Failed to record biosecurity exit' });
  }
});

// ═══════════ เสา 6: Batch Financial Engine ═══════════

// POST /api/livestock/batches — ปิดงวดบัญชีหรือสร้างงวดใหม่ → netProfit อัตโนมัติ
router.post('/batches', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { batchCode, livestockGroupId, initialAnimalCost, totalFeedCost, totalMedCost, totalUtilityCost, totalRevenue } =
      req.body || {};
    if (!batchCode || String(batchCode).trim().length === 0)
      return res.status(400).json({ error: 'batchCode is required' });
    const netProfit =
      (Number(totalRevenue) || 0) -
      (Number(initialAnimalCost) || 0) -
      (Number(totalFeedCost) || 0) -
      (Number(totalMedCost) || 0) -
      (Number(totalUtilityCost) || 0);
    const batch = await prisma.batchFinancialLog.create({
      data: {
        batchCode: String(batchCode),
        livestockGroupId: livestockGroupId || null,
        initialAnimalCost: Number(initialAnimalCost) || 0,
        totalFeedCost: Number(totalFeedCost) || 0,
        totalMedCost: Number(totalMedCost) || 0,
        totalUtilityCost: Number(totalUtilityCost) || 0,
        totalRevenue: Number(totalRevenue) || 0,
        netProfit,
      },
    });
    res.json({ batch });
  } catch (err) {
    console.error('Livestock batch create error:', err);
    res.status(500).json({ error: 'Failed to create financial batch' });
  }
});

// PATCH /api/livestock/batches/:id — อัปเดต/ปิดงวด (closedAt เมื่อมี totalRevenue สุดท้าย)
router.patch('/batches/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const current = await prisma.batchFinancialLog.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Batch not found' });
    const data: Record<string, unknown> = {};
    for (const k of ['initialAnimalCost', 'totalFeedCost', 'totalMedCost', 'totalUtilityCost', 'totalRevenue'] as const) {
      if (req.body[k] !== undefined) data[k] = Number(req.body[k]);
    }
    if (req.body.closedAt !== undefined) {
      const c = parseDate(req.body.closedAt);
      if (c === 'invalid') return res.status(400).json({ error: 'closedAt must be a valid date' });
      data.closedAt = c;
    }
    const netProfit =
      (Number(data.totalRevenue ?? current.totalRevenue) || 0) -
      (Number(data.initialAnimalCost ?? current.initialAnimalCost) || 0) -
      (Number(data.totalFeedCost ?? current.totalFeedCost) || 0) -
      (Number(data.totalMedCost ?? current.totalMedCost) || 0) -
      (Number(data.totalUtilityCost ?? current.totalUtilityCost) || 0);
    data.netProfit = netProfit;
    const batch = await prisma.batchFinancialLog.update({ where: { id: req.params.id }, data });
    res.json({ batch });
  } catch (err) {
    console.error('Livestock batch update error:', err);
    res.status(500).json({ error: 'Failed to update financial batch' });
  }
});

// GET /api/livestock/batches?livestockGroupId= — งบทั้งหมด
router.get('/batches', authenticate, async (req, res) => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.livestockGroupId) where.livestockGroupId = String(req.query.livestockGroupId);
    const batches = await prisma.batchFinancialLog.findMany({ where, orderBy: { created_at: 'desc' } });
    res.json({ batches });
  } catch (err) {
    console.error('Livestock batches list error:', err);
    res.status(500).json({ error: 'Failed to load financial batches' });
  }
});

// ═══════════ Multimodal Vision Ingestion — ภาพอาการป่วย → Qwen2-VL → JSON สรุป ═══════════

// POST /api/livestock/groups/:id/vision — ส่งภาพ (ผื่นผิวหนัง/อุจจาระ/รอยโรค) → VL model → สรุปอาการ
router.post('/groups/:id/vision', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { imageBase64, prompt } = req.body || {};
    if (!imageBase64 || String(imageBase64).length < 100)
      return res.status(400).json({ error: 'imageBase64 is required (data URL หรือ base64 ของภาพ)' });
    if (!VISION_ENABLED)
      return res.status(400).json({ error: 'Vision AI disabled (VISION_ENABLED=false)' });
    const group = await prisma.livestockGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const b64 = String(imageBase64).replace(/^data:image\/[^;]+;base64,/, '').trim();
    const text = await callVision(b64, prompt || LIVESTOCK_VISION_PROMPT);
    const parsed = parseLivestockVisionResponse(text);

    const report = await prisma.livestockVisionReport.create({
      data: {
        livestockGroupId: group.id,
        model: VISION_MODEL,
        severity: parsed.severity,
        summary: parsed.summary || 'ไม่สามารถสกัดอาการได้',
        symptomsJson: JSON.stringify({ symptoms: parsed.symptoms, recommendation: parsed.recommendation }),
      },
    });

    // อาการผิดปกติ → แจ้งสัตวบาลผ่าน Telegram ทันที (dedup ต่อรายงาน)
    if (parsed.severity !== 'info') {
      await notify(
        `🐄 VISION(${group.code}): ${(parsed.summary || 'พบความผิดปกติ').slice(0, 220)}`,
        parsed.severity === 'critical' ? 'critical' : 'warn',
        `vision-${group.id}-${report.id}`
      );
    }
    res.json({ report, analysis: parsed });
  } catch (err) {
    console.error('Livestock vision ingestion error:', err);
    res.status(500).json({ error: 'Failed to analyze livestock image' });
  }
});

// GET /api/livestock/groups/:id/vision — ประวัติวิเคราะห์ภาพ
router.get('/groups/:id/vision', authenticate, async (req, res) => {
  try {
    const reports = await prisma.livestockVisionReport.findMany({
      where: { livestockGroupId: req.params.id },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({ reports });
  } catch (err) {
    console.error('Livestock vision history error:', err);
    res.status(500).json({ error: 'Failed to load vision reports' });
  }
});

// ═══════════ Dashboard สรุปรวม ═══════════

// GET /api/livestock/dashboard — ตัวเลขรวม: กลุ่ม/ควอรันไทน์/ยาค้าง/ถังต่ำ/THI ล่าสุด/โต๊ะบัญชี
router.get('/dashboard', authenticate, async (_req, res) => {
  try {
    const [groups, silos, batches] = await Promise.all([
      prisma.livestockGroup.findMany({ include: { records: true, dailyLogs: true } }),
      prisma.feedSilo.findMany(),
      prisma.batchFinancialLog.findMany(),
    ]);

    let locked = 0;
    let quarantine = 0;
    let harvested = 0;
    for (const g of groups) {
      if (g.status === 'QUARANTINE') quarantine++;
      if (g.status === 'HARVESTED') harvested++;
      const latest = g.records.reduce((mx, m) => Math.max(mx, new Date(m.safeHarvestDate).getTime()), 0);
      if (latest > Date.now()) locked++;
    }
    const lowSilos = silos.filter((s) => s.capacityKg > 0 && s.currentKg / s.capacityKg < 0.15).length;
    const totalRevenue = batches.reduce((s, b) => s + b.totalRevenue, 0);
    const totalCost = batches.reduce((s, b) => s + b.initialAnimalCost + b.totalFeedCost + b.totalMedCost + b.totalUtilityCost, 0);
    let latestClimate: any = null;
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT thi, status, at FROM livestock_climate_logs ORDER BY at DESC LIMIT 1`
      );
      if (rows[0]) {
        latestClimate = {
          thi: rows[0].thi,
          status: rows[0].status,
          at: new Date(rows[0].at).toISOString(),
        };
      }
    } catch (dbErr) {
      console.error('Livestock dashboard climate error:', dbErr);
    }

    res.json({
      summary: {
        groups: groups.length,
        quarantine,
        harvested,
        lockedWithdrawal: locked,
        silos: silos.length,
        lowSilos,
        revenue: +totalRevenue.toFixed(2),
        cost: +totalCost.toFixed(2),
        netProfit: +(totalRevenue - totalCost).toFixed(2),
        latestThi: latestClimate?.thi ?? null,
        latestClimate,
      },
      regimes: [
        { code: 'POULTRY_BROILER', label: 'ไก่เนื้อ' },
        { code: 'POULTRY_LAYER', label: 'ไก่ไข่' },
        { code: 'DUCK', label: 'เป็ด' },
        { code: 'SWINE', label: 'สุกร' },
        { code: 'CATTLE', label: 'โค' },
      ],
      standards: ROS,
    });
  } catch (err) {
    console.error('Livestock dashboard error:', err);
    res.status(500).json({ error: 'Failed to load livestock dashboard' });
  }
});

export default router;