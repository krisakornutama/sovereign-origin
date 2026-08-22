// livestock-groups.routes.ts — ฐาน: กลุ่มปศุสัตว์ (CRUD) — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { withdrawalStatus, quarantineStatus } from '../../services/livestock-vet-ai.service';
import { WRITE_ROLES, DAY_MS, QUARANTINE_DAYS, SPECIES, GROUP_STATUSES, parseDate } from './livestock-shared';

const router = Router();

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

export default router;
