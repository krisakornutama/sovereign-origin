import { Router } from 'express';
import os from 'os';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { agentActions } from '../../services/agent-actions.service';
import { listProcesses } from '../../services/system-processes.service';
import { getDiskInfo } from '../../services/system-monitor.service';
import { getWanState, checkWanNow, rebootRouter, checkRouterNow, scanLanDevices, runSpeedtest } from '../../services/wan-monitor.service';
import { fetchRouterSimData, setAdminPassword } from '../../services/tplink-mr505.service';

// ────────────────────────────────────────────────────────────────────────────
// System — ย้ายมาจาก inline routes ใน server.ts
// livenessRouter: GET /healthz (ไม่มี auth — Docker healthcheck + watchdog)
// systemApiRouter (mount ที่ /api/system):
//   GET  /health           สุขภาพเครื่อง (uptime/cpu/mem/disk)
//   GET  /processes        รายการ process ที่รันอยู่
//   POST /processes/kill   kill ผ่าน guard + autonomy เดียวกับ AI agent
// ────────────────────────────────────────────────────────────────────────────

export const livenessRouter = Router();

livenessRouter.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

const router = Router();

// System Health
router.get('/health', authenticate, async (_req, res) => {
  const uptime = os.uptime();
  const cpuUsage = (os.loadavg()[0] / os.cpus().length * 100).toFixed(1) + '%';
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memory = ((totalMem - freeMem) / totalMem * 100).toFixed(1) + '%';
  let disk = 'N/A';
  try {
    const info = await getDiskInfo();
    if (info) disk = `${info.usedPct}% เต็ม · เหลือ ${(info.freeMb / 1024).toFixed(1)} GB / ${(info.totalMb / 1024).toFixed(1)} GB`;
  } catch {
    // ไม่ได้ข้อมูลดิสก์ = แสดง N/A
  }
  res.json({
    uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
    cpuUsage,
    memory,
    disk
  });
});

// GET /api/system/processes - รายการ process ที่รันอยู่ (สำหรับปุ่ม killProcess)
router.get('/processes', authenticate, async (_req, res) => {
  try {
    res.json(await listProcesses());
  } catch (err) {
    console.error('List processes error:', err);
    res.status(500).json({ error: 'Failed to list processes' });
  }
});

// POST /api/system/processes/kill - kill ผ่าน guard + autonomy เดียวกับ AI agent
// 200 = สำเร็จ, 202 = รออนุมัติ (โหมด suggest), 403 = ถูกปฏิเสธ (view / guard)
router.post('/processes/kill', authenticate, async (req, res) => {
  const { pid, name } = req.body || {};
  const args: any = {};
  if (pid !== undefined && pid !== null && pid !== '') {
    args.pid = Number(pid);
  } else if (typeof name === 'string' && name.trim()) {
    args.name = name.trim();
  } else {
    return res.status(400).json({ error: 'pid or name is required' });
  }

  const result = await agentActions.executeAction('killProcess', args, {
    actor: req.user?.id,
    source: 'system-ui',
    ip: req.ip,
  });
  if (result.status === 'denied') return res.status(403).json(result);
  if (result.status === 'requires_approval') return res.status(202).json(result);
  return res.json(result);
});

// ── WAN Monitor (Archer MR505 SIM) ──
// GET /api/system/wan — สถานะเน็ตผ่านซิม ณ ปัจจุบัน
router.get('/wan', authenticate, async (_req, res) => {
  res.json(getWanState());
});

// POST /api/system/wan/check — ตรวจครบทั้ง router + WAN (สด)
router.post('/wan/check', authenticate, async (_req, res) => {
  try {
    await checkRouterNow();
    const wan = await checkWanNow();
    const { classifyWanIssue } = await import('../../services/wan-monitor.service');
    const s = getWanState();
    res.json({ ...wan, router: s.router, issue: classifyWanIssue(s.router.up, wan.up) });
  } catch (err) {
    res.status(500).json({ error: 'WAN check failed' });
  }
});

// GET /api/system/wan/devices — อุปกรณ์ที่ต่อ router ตอนนี้ + สแกนใหม่ทันที
router.get('/wan/devices', authenticate, async (_req, res) => {
  try {
    const devices = await scanLanDevices();
    res.json({ devices, count: devices.length, subnet: getWanState().subnet });
  } catch (err) {
    res.status(500).json({ error: 'LAN scan failed' });
  }
});

// POST /api/system/wan/speedtest — วัดความเร็วซิมจริง (โหลด ~2MB จาก Cloudflare)
router.post('/wan/speedtest', authenticate, async (_req, res) => {
  try {
    res.json(await runSpeedtest());
  } catch (err) {
    res.status(500).json({ error: 'Speedtest failed' });
  }
});

// GET /api/system/wan/sim — ข้อมูลซิมจากใน router (สัญญาณ RSRP/SINR · data usage · clients ครบ)
router.get('/wan/sim', authenticate, async (_req, res) => {
  try {
    res.json(await fetchRouterSimData());
  } catch (err) {
    res.status(500).json({ error: 'Router SIM fetch failed' });
  }
});

// PUT /api/system/wan/admin-password {password} — ตั้งรหัส admin ของ router (SUPERADMIN)
router.put('/wan/admin-password', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const pw = String(req.body?.password || '');
    if (!pw) return res.status(400).json({ error: 'password required' });
    await setAdminPassword(pw);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set password' });
  }
});

// POST /api/system/wan/reboot — รีบูต router (SUPERADMIN, ต้องตั้ง ROUTER_REBOOT_CMD ก่อน)
router.post('/wan/reboot', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const result = await rebootRouter();
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// ── AI Local — ปิดเป็นค่าเริ่มต้น ต้องกดเปิดเอง (consent) ──
router.get('/ai-local/status', authenticate, async (_req, res) => {
  try {
    const { getStatus } = await import('../../services/ai-local.service');
    res.json(await getStatus());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-local/enabled', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { setEnabled } = await import('../../services/ai-local.service');
    const enabled = !!req.body?.enabled;
    const status = await setEnabled(enabled);
    // ถ้าเปิดทันที ให้ลองโหลดโมเดล (ไม่บล็อก response)
    if (enabled) {
      const { loadModel } = await import('../../services/ai-local.service');
      loadModel().then(r => console.log(r.ok ? '🤖 AI Local loaded' : '🤖 AI Local: ' + r.error));
    }
    res.json(status);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-local/auto-start', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { setAutoStart } = await import('../../services/ai-local.service');
    res.json(await setAutoStart(!!req.body?.autoStart));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-local/load', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const { loadModel } = await import('../../services/ai-local.service');
    const r = await loadModel();
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
