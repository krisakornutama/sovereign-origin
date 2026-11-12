import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';
import { normalizeSingleIp } from '../../lib/ip-address';
import { threatDetector } from '../../services/threat-detection.service';
import { agentActions } from '../../services/agent-actions.service';
import { hostConnections } from '../../services/host-connections.service';

const router = Router();
const execAsync = promisify(exec);

// GET /api/security/connections - ดึงการเชื่อมต่อปัจจุบัน (netstat)
// อ่านไม่ได้ = คืน connections ว่าง + degraded: true + เหตุผล — **ห้ามคืนแถวจำลอง**
// (หน้าความปลอดภัยที่โชว์ "การเชื่อมต่อ" ที่ไม่มีจริง = หลักฐานเท็จ)
router.get('/connections', authenticate, async (_req, res) => {
  try {
    const connections = await hostConnections.read();
    res.json({ connections, degraded: false, source: 'netstat' });
  } catch (error) {
    res.json({
      connections: [],
      degraded: true,
      source: 'unavailable',
      reason: 'อ่าน netstat ของโฮสต์ไม่ได้จากสภาพแวดล้อมนี้ (คอนเทนเนอร์/host)',
      detail: String((error as Error)?.message || '').slice(0, 200),
    });
  }
});

// GET /api/security/firewall - สถานะไฟร์วอลล์ (Engine + สถานะ Windows Firewall ของโฮสต์)
router.get('/firewall', authenticate, async (_req, res) => {
  try {
    const { engineStatus } = await import('../../services/firewall-engine.service');
    const [rules, config] = await Promise.all([
      prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] }),
      prisma.firewallConfig.findUnique({ where: { id: 1 } }),
    ]);
    const engine = engineStatus(rules, (config?.default_policy as 'ALLOW' | 'DENY') ?? 'ALLOW');
    // Windows Firewall ของโฮสต์ (best-effort — ใน Docker อาจเข้าถึงไม่ได้)
    let host: { status: string; raw: string } = { status: 'unknown', raw: 'ไม่สามารถเรียก netsh จากคอนเทนเนอร์ได้ — ใช้สคริปต์ host-script รันบนเครื่องจริง' };
    try {
      const { stdout } = await execAsync('netsh advfirewall show allprofiles state');
      host = { status: stdout.includes('ON') ? 'active' : 'inactive', raw: stdout };
    } catch {
      host = { status: 'unknown', raw: 'ไม่สามารถเรียก netsh จากคอนเทนเนอร์ได้ — ใช้สคริปต์ host-script รันบนเครื่องจริง' };
    }
    res.json({ status: engine.engine === 'active' ? 'active' : 'unknown', engine, host });
  } catch (err) {
    res.json({ status: 'unknown', raw: 'Unable to query firewall', error: String((err as Error)?.message || '') });
  }
});

// GET /api/security/firewall/blocks - IP ที่ถูก block ผ่านระบบนี้ + จำนวนคำขออนุมัติ
router.get('/firewall/blocks', authenticate, (req, res) => {
  const pendingApprovals = agentActions.listApprovals().filter((a) => a.status === 'pending').length;
  res.json({ blockedIps: agentActions.listBlockedIps(), pendingApprovals });
});

// POST /api/security/firewall/block - block IP ผ่าน guard + autonomy เดียวกับ AI agent
// 200 = ดำเนินการแล้ว, 202 = ส่งคำขออนุมัติ (โหมด suggest), 403 = ถูกปฏิเสธ (โหมด view / guard)
// รับเฉพาะ IP เดี่ยว — `0.0.0.0/0` = บล็อกทุกทราฟฟิกขาเข้า (ล็อกตัวเองออกจากระบบ)
const SINGLE_IP_ERROR = 'ip ต้องเป็น IP เดี่ยว (IPv4/IPv6) เท่านั้น — ไม่รับ CIDR/ช่วง IP/ชื่อโฮสต์';

router.post('/firewall/block', authenticate, async (req, res) => {
  const ip = normalizeSingleIp(req.body?.ip);
  if (!ip) return res.status(400).json({ error: SINGLE_IP_ERROR });
  try {
    const result = await agentActions.executeAction(
      'blockIP',
      { ip },
      { actor: req.user?.id, source: 'security-ui', ip: req.ip }
    );
    if (result.status === 'denied') return res.status(403).json(result);
    if (result.status === 'requires_approval') return res.status(202).json(result);
    return res.json(result);
  } catch (err) {
    // Express 4 ไม่ดัก async throw — ถ้าไม่จับ คำขอจะค้างจน client timeout
    return res.status(500).json({
      error: 'สั่ง block ไม่สำเร็จ (executor ล้ม)',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

// POST /api/security/firewall/unblock - ยกเลิกการ block IP
router.post('/firewall/unblock', authenticate, async (req, res) => {
  const ip = normalizeSingleIp(req.body?.ip);
  if (!ip) return res.status(400).json({ error: SINGLE_IP_ERROR });
  try {
    const result = await agentActions.executeAction(
      'unblockIP',
      { ip },
      { actor: req.user?.id, source: 'security-ui', ip: req.ip }
    );
    if (result.status === 'denied') return res.status(403).json(result);
    if (result.status === 'requires_approval') return res.status(202).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: 'สั่ง unblock ไม่สำเร็จ (executor ล้ม)',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

// GET /api/security/events - ดึง security events ล่าสุด
// อ่าน DB ไม่ได้ ≠ ไม่มีเหตุการณ์ — ต้องมี degraded flag (หลักฐานความปลอดภัยต้องไม่โกหก)
router.get('/events', authenticate, async (_req, res) => {
  try {
    const events = await prisma.securityEvent.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
    res.json({ events, degraded: false, source: 'db' });
  } catch (err) {
    res.json({
      events: [],
      degraded: true,
      source: 'unavailable',
      reason: 'อ่านเหตุการณ์ความปลอดภัยจากฐานข้อมูลไม่ได้',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

// POST /api/security/events - บันทึก security event ใหม่
// เขียนได้เฉพาะ role ที่เชื่อถือได้ (KID/SYSTEM_AI = ไม่) และค่าต้องถูกตรวจก่อนเก็บ:
// event log ที่ใครก็เขียนได้ = หลักฐานที่ปลอมได้ (และถล่ม 50 แถวล่าสุดจนของจริงหลุดสายตา)
const EVENT_WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'SITE_ADMIN', 'OPERATOR'] as const;
const EVENT_TYPE_PATTERN = /^[A-Za-z0-9_]{2,40}$/;
const EVENT_SEVERITIES = new Set(['info', 'warning', 'critical']);
const MAX_EVENT_DESCRIPTION = 500;
const MAX_IP_LENGTH = 45; // IPv6 สูงสุด 45 ตัวอักษร

function normalizeIp(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > MAX_IP_LENGTH) return { ok: false };
  if (!/^[0-9a-fA-F:.]+$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

router.post('/events', authenticate, requireRole(...EVENT_WRITE_ROLES), async (req, res) => {
  const body = req.body || {};
  const eventType = typeof body.event_type === 'string' ? body.event_type.trim().toUpperCase() : '';
  if (!EVENT_TYPE_PATTERN.test(eventType)) {
    return res.status(400).json({
      error: 'event_type ต้องเป็นตัวอักษร/ตัวเลข/underscore 2-40 ตัว (เช่น INTRUSION, PORT_SCAN)',
    });
  }
  const severity = String(body.severity ?? 'info').trim().toLowerCase();
  if (!EVENT_SEVERITIES.has(severity)) {
    return res.status(400).json({ error: 'severity ต้องเป็น info, warning หรือ critical' });
  }
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return res.status(400).json({ error: 'description ต้องไม่ว่าง' });
  }
  if (description.length > MAX_EVENT_DESCRIPTION) {
    return res.status(400).json({ error: `description ยาวเกิน ${MAX_EVENT_DESCRIPTION} ตัวอักษร` });
  }
  const sourceIp = normalizeIp(body.source_ip);
  const destIp = normalizeIp(body.dest_ip);
  if (!sourceIp.ok || !destIp.ok) {
    return res.status(400).json({ error: `source_ip/dest_ip ต้องเป็น IP ที่ถูกต้อง (ยาวไม่เกิน ${MAX_IP_LENGTH})` });
  }
  const rawData = body.raw_data;
  if (rawData !== undefined && rawData !== null && (typeof rawData !== 'object' || Array.isArray(rawData))) {
    return res.status(400).json({ error: 'raw_data ต้องเป็น object' });
  }

  try {
    const event = await prisma.securityEvent.create({
      data: {
        event_type: eventType,
        severity,
        source_ip: sourceIp.value,
        dest_ip: destIp.value,
        description,
        raw_data: rawData ?? {},
      },
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({
      error: 'บันทึกเหตุการณ์ไม่สำเร็จ',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

// POST /api/security/threats/scan - ตรวจหาภัยคุกคามทันที (ใช้กับปุ่ม "สแกนเลย")
router.post('/threats/scan', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const events = await threatDetector.scanNow();
    res.json({ success: true, found: events.length, events });
  } catch (err) {
    res.status(500).json({ error: 'Threat scan failed' });
  }
});

// ── Firewall Engine — กฎ allow/deny + จำแนก unknown + สร้างสคริปต์ Windows ──

// GET /api/security/firewall/status — สถานะ Engine (แทนค่าฮาร์ดโค้ด unknown)
router.get('/firewall/status', authenticate, async (_req, res) => {
  try {
    const { engineStatus } = await import('../../services/firewall-engine.service');
    const [rules, config] = await Promise.all([
      prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] }),
      prisma.firewallConfig.findUnique({ where: { id: 1 } }),
    ]);
    res.json(engineStatus(rules, config?.default_policy as 'ALLOW' | 'DENY' ?? 'ALLOW'));
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || 'failed') });
  }
});

// GET /api/security/firewall/rules — รายการกฎ
router.get('/firewall/rules', authenticate, async (_req, res) => {
  try {
    const rules = await prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] });
    const config = await prisma.firewallConfig.findUnique({ where: { id: 1 } });
    res.json({ rules, defaultPolicy: config?.default_policy ?? 'ALLOW' });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || 'failed') });
  }
});

// POST /api/security/firewall/rules — เพิ่มกฎ
router.post('/firewall/rules', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.name ?? '').trim()) return res.status(400).json({ error: 'name is required' });
    const rule = await prisma.firewallRule.create({
      data: {
        name: String(b.name).trim().slice(0, 80),
        action: b.action === 'DENY' ? 'DENY' : 'ALLOW',
        direction: ['IN', 'OUT', 'BOTH'].includes(b.direction) ? b.direction : 'BOTH',
        protocol: ['ANY', 'TCP', 'UDP', 'ICMP'].includes(b.protocol) ? b.protocol : 'ANY',
        remote_ip: b.remote_ip ? String(b.remote_ip).trim().slice(0, 60) : null,
        remote_port: b.remote_port ? String(b.remote_port).trim().slice(0, 40) : null,
        local_port: b.local_port ? String(b.local_port).trim().slice(0, 40) : null,
        priority: Math.floor(Number(b.priority) || 10),
        description: b.description ? String(b.description).trim().slice(0, 300) : null,
        enabled: b.enabled !== false,
      },
    });
    res.status(201).json({ success: true, rule });
  } catch (err) {
    res.status(400).json({ error: String((err as Error)?.message || 'เพิ่มกฎไม่สำเร็จ') });
  }
});

// PUT /api/security/firewall/rules/:id — แก้ไข/เปิดปิดกฎ
router.put('/firewall/rules/:id', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  try {
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.name) data.name = String(b.name).trim().slice(0, 80);
    if (b.action) data.action = b.action === 'DENY' ? 'DENY' : 'ALLOW';
    if (b.direction) data.direction = ['IN', 'OUT', 'BOTH'].includes(b.direction) ? b.direction : 'BOTH';
    if (b.protocol) data.protocol = ['ANY', 'TCP', 'UDP', 'ICMP'].includes(b.protocol) ? b.protocol : 'ANY';
    if (b.remote_ip !== undefined) data.remote_ip = b.remote_ip ? String(b.remote_ip).trim().slice(0, 60) : null;
    if (b.remote_port !== undefined) data.remote_port = b.remote_port ? String(b.remote_port).trim().slice(0, 40) : null;
    if (b.local_port !== undefined) data.local_port = b.local_port ? String(b.local_port).trim().slice(0, 40) : null;
    if (b.priority != null) data.priority = Math.floor(Number(b.priority) || 10);
    if (b.description !== undefined) data.description = b.description ? String(b.description).trim().slice(0, 300) : null;
    if (b.enabled !== undefined) data.enabled = Boolean(b.enabled);
    await prisma.firewallRule.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: String((err as Error)?.message || 'อัปเดตกฎไม่สำเร็จ') });
  }
});

// DELETE /api/security/firewall/rules/:id — ลบกฎ
router.delete('/firewall/rules/:id', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  try {
    await prisma.firewallRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: String((err as Error)?.message || 'ลบกฎไม่สำเร็จ') });
  }
});

// PUT /api/security/firewall/policy — ตั้งนโยบายเริ่มต้น (ALLOW | DENY)
router.put('/firewall/policy', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  try {
    const policy = String(req.body?.default_policy || 'ALLOW').toUpperCase();
    if (policy !== 'ALLOW' && policy !== 'DENY') return res.status(400).json({ error: 'policy ต้องเป็น ALLOW หรือ DENY' });
    await prisma.firewallConfig.upsert({ where: { id: 1 }, create: { id: 1, default_policy: policy }, update: { default_policy: policy } });
    res.json({ success: true, defaultPolicy: policy });
  } catch (err) {
    res.status(400).json({ error: String((err as Error)?.message || 'ตั้งนโยบายไม่สำเร็จ') });
  }
});

// POST /api/security/firewall/scan — สแกนการเชื่อมต่อ (netstat) + จำแนก known/unknown
router.post('/firewall/scan', authenticate, async (req, res) => {
  try {
    const { parseNetstat, evaluateConnection } = await import('../../services/firewall-engine.service');
    let raw = String(req.body?.raw || '');
    if (!raw) {
      try {
        const { stdout } = await execAsync('netstat -ano | findstr ESTABLISHED');
        raw = stdout;
      } catch {
        raw = '';
      }
    }
    const conns = raw ? parseNetstat(raw) : [];
    const [rules, config] = await Promise.all([
      prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] }),
      prisma.firewallConfig.findUnique({ where: { id: 1 } }),
    ]);
    const policy = (config?.default_policy as 'ALLOW' | 'DENY') ?? 'ALLOW';
    const classified = conns.map((c) => ({ ...c, ...evaluateConnection(c, rules, policy) }));
    res.json({ connections: classified, defaultPolicy: policy, total: classified.length });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || 'สแกนไม่สำเร็จ') });
  }
});

// POST /api/security/firewall/evaluate — ทดสอบกฎกับ IP/พอร์ตที่ระบุ
router.post('/firewall/evaluate', authenticate, async (req, res) => {
  try {
    const { classifyConnection } = await import('../../services/firewall-engine.service');
    const b = req.body || {};
    const conn = {
      protocol: String(b.protocol || 'TCP').toUpperCase(),
      local: String(b.local || '127.0.0.1:0'),
      remote: String(b.remote || ''),
      state: 'ESTABLISHED',
      pid: 'manual',
    };
    const [rules, config] = await Promise.all([
      prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] }),
      prisma.firewallConfig.findUnique({ where: { id: 1 } }),
    ]);
    const policy = (config?.default_policy as 'ALLOW' | 'DENY') ?? 'ALLOW';
    const r = classifyConnection(conn, rules, policy);
    res.json({ ...r, defaultPolicy: policy });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || 'evaluate ไม่สำเร็จ') });
  }
});

// GET /api/security/firewall/host-script — สร้างสคริปต์ netsh สำหรับบังคับใช้จริง (รันด้วยสิทธิ์ Admin)
router.get('/firewall/host-script', authenticate, async (_req, res) => {
  try {
    const { buildHostScript } = await import('../../services/firewall-engine.service');
    const [rules, config] = await Promise.all([
      prisma.firewallRule.findMany({ orderBy: [{ priority: 'desc' }, { created_at: 'asc' }] }),
      prisma.firewallConfig.findUnique({ where: { id: 1 } }),
    ]);
    const policy = (config?.default_policy as 'ALLOW' | 'DENY') ?? 'ALLOW';
    const script = buildHostScript(rules, policy);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sovereign-firewall.bat"');
    res.send(script);
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message || 'สร้างสคริปต์ไม่สำเร็จ') });
  }
});

// POST /api/security/ai-analyze - ส่งให้ AI วิเคราะห์
router.post('/ai-analyze', authenticate, async (req, res) => {
  // เรียกใช้ aiAgent.processMessage (จะ import ผ่าน server.ts)
  const { question } = req.body;
  // handler จะอยู่ใน server.ts ที่ใช้ aiAgent
  res.status(501).json({ message: 'AI analysis endpoint connected' });
});

export default router;