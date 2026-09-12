// src/modules/business/business.routes.ts
//
// BUSINESS PLATFORM routes — ทุก endpoint ตรวจสิทธิ์ฝั่ง server ผ่าน hasBusinessAccess
// (UI ซ่อนปุ่มเป็นแค่ UX — กติกาจริงอยู่ที่นี่)
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { hasBusinessAccess, BUSINESS_POSITIONS } from '../../lib/business';
import * as svc from '../../services/business.service';

const router = Router();

/** helper: ตรวจสิทธิ์แล้วคืน position หรือส่ง 403/404 เอง */
async function guard(req: any, res: any, min: string): Promise<string | null> {
  const user = (req as any).user;
  const position = await hasBusinessAccess(req.params.businessId, user.id, user.role, min as any);
  if (!position) {
    res.status(403).json({ error: 'คุณไม่มีสิทธิ์ในธุรกิจนี้' });
    return null;
  }
  return position;
}

// ── Businesses ──
router.get('/', authenticate, async (req, res) => {
  try {
    res.json(await svc.listBusinesses((req as any).user.id, (req as any).user.role));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// สร้างธุรกิจ — ใคร login ก็สร้างได้ (เป็น OWNER ของธุรกิจตัวเอง)
router.post('/', authenticate, async (req, res) => {
  try {
    const biz = await svc.createBusiness((req as any).user.id, req.body);
    // seed ผู้ช่วย AI ทันที (ผู้ใช้ไม่ต้องกดเอง)
    await svc.seedBusinessAgents(biz.id, biz.name);
    res.status(201).json(biz);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// สร้างธุรกิจพร้อม seed agents ใหม่ (กดซ้ำได้ ถ้า seed ไม่สำเร็จครั้งก่อน)
router.post('/:businessId/agents/seed', authenticate, async (req, res) => {
  try {
    if (!(await guard(req, res, 'OWNER'))) return;
    const biz = await prisma.business.findUnique({ where: { id: req.params.businessId } });
    const created = await svc.seedBusinessAgents(req.params.businessId, biz?.name ?? 'ธุรกิจ');
    res.json({ created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Members ──
router.get('/:businessId/members', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listMembers(req.params.businessId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/members', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'OWNER'))) return;
  try {
    const member = await svc.addMember(req.params.businessId, req.body);
    res.status(201).json(member);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:businessId/members/:memberId', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'OWNER'))) return;
  try {
    await svc.removeMember(req.params.businessId, req.params.memberId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Products ──
router.get('/:businessId/products', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listProducts(req.params.businessId, req.query.all === '1'));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/products', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'STOCK_KEEPER'))) return;
  try {
    res.status(201).json(await svc.createProduct(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:businessId/products/:id', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'STOCK_KEEPER'))) return;
  try {
    res.json(await svc.updateProduct(req.params.businessId, req.params.id, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Customers ──
router.get('/:businessId/customers', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listCustomers(req.params.businessId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/customers', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'SALES'))) return;
  try {
    res.status(201).json(await svc.createCustomer(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Orders ──
router.get('/:businessId/orders', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listOrders(req.params.businessId, req.query.status as string | undefined));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:businessId/orders/:id', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.getOrder(req.params.businessId, req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// เปิดใบเสนอราคา/ออเดอร์ — SALES ขึ้นไป
router.post('/:businessId/orders', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'SALES'))) return;
  try {
    res.status(201).json(await svc.createOrder(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// state machine — MANAGER ขึ้นไป (confirm/deliver/cancel), SALES ทำ mark-paid ไม่ได้ตามแผน
const ORDER_ACTIONS = ['confirm', 'mark-paid', 'deliver', 'cancel'] as const;
router.post('/:businessId/orders/:id/transition', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'MANAGER'))) return;
  const action = String(req.body?.action || '') as (typeof ORDER_ACTIONS)[number];
  if (!ORDER_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' });
  try {
    res.json(await svc.transitionOrder(req.params.businessId, req.params.id, action));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Payments — SALES รับเงินได้ ──
router.post('/:businessId/orders/:id/payments', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'SALES'))) return;
  try {
    res.status(201).json(await svc.addPayment(req.params.businessId, req.params.id, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Installations ──
router.get('/:businessId/installations', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listInstallations(req.params.businessId, req.query.status as string | undefined));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// เปิดงานติดตั้ง — MANAGER ขึ้นไป
router.post('/:businessId/installations', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'MANAGER'))) return;
  try {
    res.status(201).json(await svc.createInstallation(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// เปลี่ยนสถานะงานติดตั้ง — TECHNICIAN ขึ้นไป (ช่างกดเองได้)
const INSTALL_ACTIONS = ['start', 'complete'] as const;
router.post('/:businessId/installations/:id/transition', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'TECHNICIAN'))) return;
  const action = String(req.body?.action || '') as (typeof INSTALL_ACTIONS)[number];
  if (!INSTALL_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' });
  try {
    res.json(await svc.transitionInstallation(req.params.businessId, req.params.id, action));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Ledger ──
router.get('/:businessId/ledger', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'ACCOUNTANT'))) return;
  try {
    res.json(await svc.listLedger(req.params.businessId, req.query.take ? Number(req.query.take) : 200));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/ledger', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'MANAGER'))) return;
  try {
    res.status(201).json(await svc.addLedgerEntry(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// สรุปการเงิน — ACCOUNTANT ขึ้นไป (เห็นตัวเลขเงิน)
router.get('/:businessId/summary', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'ACCOUNTANT'))) return;
  try {
    res.json(await svc.businessSummary(req.params.businessId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Suppliers & Purchase Orders ──
router.get('/:businessId/suppliers', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listSuppliers(req.params.businessId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/suppliers', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'STOCK_KEEPER'))) return;
  try {
    res.status(201).json(await svc.createSupplier(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:businessId/purchase-orders', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    res.json(await svc.listPurchaseOrders(req.params.businessId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:businessId/purchase-orders', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'STOCK_KEEPER'))) return;
  try {
    res.status(201).json(await svc.createPurchaseOrder(req.params.businessId, req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// รับของเข้า — STOCK_KEEPER ขึ้นไป
router.post('/:businessId/purchase-orders/:id/receive', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'STOCK_KEEPER'))) return;
  try {
    res.json(await svc.receivePurchaseOrder(req.params.businessId, req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Business Agents (ผู้ช่วย AI) ──
router.get('/:businessId/agents', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    const agents = await svc.listBusinessAgents(req.params.businessId);
    // ดึง job ล่าสุดของแต่ละ role มาโชว์ (จากระบบ AgentJob เดิม)
    const roleIds = agents.map((a: any) => a.roleId);
    const jobs = roleIds.length
      ? await prisma.agentJob.findMany({ where: { role_id: { in: roleIds } }, orderBy: { created_at: 'desc' }, take: 40 })
      : [];
    const latestByRole = new Map<string, any>();
    for (const j of jobs) if (!latestByRole.has(j.role_id)) latestByRole.set(j.role_id, j);
    res.json(agents.map((a: any) => ({ ...a, latestJob: latestByRole.get(a.roleId) ?? null })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// สั่งงานผู้ช่วย — MANAGER ขึ้นไป (รันบน Ollama เดิม)
router.post('/:businessId/agents/:agentId/run', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'MANAGER'))) return;
  try {
    const agent = await prisma.businessAgent.findUnique({ where: { id: req.params.agentId } });
    if (!agent || agent.businessId !== req.params.businessId) throw new Error('agent not found');
    if (!agent.enabled) throw new Error('agent disabled');
    const prompt = String(req.body?.prompt ?? '').trim().slice(0, 2000);
    if (!prompt) throw new Error('prompt is required');
    // สร้าง AgentJob แบบเดียวกับระบบทีม AI เดิม — context ธุรกิจฉีดตอน execute
    const role = await prisma.agentRole.findUnique({ where: { id: agent.roleId } });
    if (!role) throw new Error('role not found');
    const job = await prisma.agentJob.create({
      data: { role_id: role.id, role_name: role.name, prompt, status: 'queued', progress: 0 },
    });
    // kick runner แบบ fire-and-forget (หลัง inject context ธุรกิจ)
    const { runBusinessAgentJob } = await import('../../services/business-agent-executor.service');
    void runBusinessAgentJob(job.id, agent.key, req.params.businessId).catch(() => {});
    res.status(202).json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// เปิด/ปิดผู้ช่วย — OWNER เท่านั้น
router.post('/:businessId/agents/:agentId/enabled', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'OWNER'))) return;
  try {
    await svc.setBusinessAgentEnabled(req.params.businessId, req.params.agentId, Boolean(req.body?.enabled));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// งาน agent ที่รันไปแล้วของธุรกิจนี้ (ดึงจากระบบ AgentJob เดิม)
router.get('/:businessId/agent-jobs', authenticate, async (req, res) => {
  if (!(await guard(req, res, 'VIEWER'))) return;
  try {
    const agents = await prisma.businessAgent.findMany({ where: { businessId: req.params.businessId } });
    const roleIds = agents.map((a) => a.roleId);
    const jobs = roleIds.length
      ? await prisma.agentJob.findMany({ where: { role_id: { in: roleIds } }, orderBy: { created_at: 'desc' }, take: 30 })
      : [];
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── รายชื่อ user สำหรับเพิ่มสมาชิก (OWNER เท่านั้น) ──
router.get('/user-lookup', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, username: true, role: true }, orderBy: { username: 'asc' } });
  res.json(users);
});

export default router;
