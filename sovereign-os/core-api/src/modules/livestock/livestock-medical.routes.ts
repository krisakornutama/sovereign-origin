// livestock-medical.routes.ts — เสา 1: Medical (ยา/ระยะหยุดยา/วัคซีน) — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { computeDrugTotalL, validateDosage } from '../../services/livestock-vet-ai.service';
import { deductStock } from '../../services/inventory.service';
import { WRITE_ROLES, DAY_MS, notify, parseDate } from './livestock-shared';

const router = Router();

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

export default router;
