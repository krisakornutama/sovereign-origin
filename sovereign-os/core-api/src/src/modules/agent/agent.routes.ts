import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  listAgentRoles,
  createAgentRole,
  updateAgentRole,
  deleteAgentRole,
  seedDefaultRoles,
  runAgentJob,
  listAgentJobs,
  getAgentJob,
  cancelAgentJob,
  deleteAgentJob,
  processAgentQueue,
} from '../../services/agent-team.service';

const router = Router();

// GET /api/agent/roles — รายการบทบาททีม agent
router.get('/roles', authenticate, async (_req, res) => {
  try {
    const roles = await listAgentRoles();
    res.json({ success: true, roles });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดบทบาทไม่สำเร็จ') });
  }
});

// POST /api/agent/roles/seed — คืนค่าเริ่มต้น (เฉพาะเมื่อตารางว่าง)
router.post('/roles/seed', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const count = await seedDefaultRoles();
    res.json({ success: true, seeded: count });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'seed ไม่สำเร็จ') });
  }
});

// POST /api/agent/roles — สร้างบทบาทใหม่
router.post('/roles', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const item = await createAgentRole(req.body || {});
    res.status(201).json({ success: true, role: item });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สร้างบทบาทไม่สำเร็จ') });
  }
});

// PUT /api/agent/roles/:id — แก้ไขบทบาท (จำนวน agent, เปิด/ปิด)
router.put('/roles/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await updateAgentRole(req.params.id, req.body || {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'แก้ไขบทบาทไม่สำเร็จ') });
  }
});

// DELETE /api/agent/roles/:id — ลบบทบาท
router.delete('/roles/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await deleteAgentRole(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบบทบาทไม่สำเร็จ') });
  }
});

// POST /api/agent/roles/:id/run — สั่งงานบทบาท → รันเบื้องหลัง (ไม่บล็อก) + kick runner
router.post('/roles/:id/run', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const job = await runAgentJob(req.params.id, String((req.body || {}).prompt ?? ''));
    void processAgentQueue().catch((err) => console.error('agent queue error:', err));
    res.status(202).json({ success: true, job });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สั่งงานไม่สำเร็จ') });
  }
});

// GET /api/agent/jobs — รายการงานเบื้องหลัง (ใหม่สุดก่อน)
router.get('/jobs', authenticate, async (_req, res) => {
  try {
    const jobs = await listAgentJobs();
    res.json({ success: true, jobs });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดงานไม่สำเร็จ') });
  }
});

// GET /api/agent/jobs/:id — งานเดียว (poll สถานะ)
router.get('/jobs/:id', authenticate, async (req, res) => {
  try {
    const job = await getAgentJob(req.params.id);
    res.json({ success: true, job });
  } catch (err: any) {
    const msg = String(err?.message || '');
    res.status(/not found/.test(msg) ? 404 : 500).json({ error: msg });
  }
});

// POST /api/agent/jobs/:id/cancel — ยกเลิกงาน (เฉพาะ queued/running)
router.post('/jobs/:id/cancel', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const job = await cancelAgentJob(req.params.id);
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ยกเลิกไม่สำเร็จ') });
  }
});

// DELETE /api/agent/jobs/:id — ลบงานออกจากประวัติ
router.delete('/jobs/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await deleteAgentJob(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบงานไม่สำเร็จ') });
  }
});

export default router;
