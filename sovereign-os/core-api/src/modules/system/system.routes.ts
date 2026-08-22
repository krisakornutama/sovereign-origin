import { Router } from 'express';
import os from 'os';
import { authenticate } from '../../middleware/auth.middleware';
import { agentActions } from '../../services/agent-actions.service';
import { listProcesses } from '../../services/system-processes.service';
import { getDiskInfo } from '../../services/system-monitor.service';

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

export default router;
