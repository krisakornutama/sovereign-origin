import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// GET /api/telemetry/latest?node_id=xxx
// ต้องมี try/catch ใน handler เอง — Express 4 ไม่ดัก async throw
// (ถ้า DB ล่มแล้วปล่อยให้โยน คำขอจะค้างจน client timeout ไม่ใช่ 500)
router.get('/latest', authenticate, async (req, res) => {
  try {
    const nodeId = req.query.node_id as string | undefined;
    const user = req.user!;

    // NODE_ADMIN can only see their own node
    if (user.role === 'NODE_ADMIN') {
      if (nodeId && nodeId !== user.assigned_node_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // if no nodeId specified, force to assigned node
      const effectiveNode = nodeId || user.assigned_node_id;
      const data = await fetchLatestTelemetry(effectiveNode || undefined);
      return res.json(data);
    }

    // SUPERADMIN can query any node
    const data = await fetchLatestTelemetry(nodeId);
    return res.json(data);
  } catch (err) {
    console.error('Latest telemetry error:', err);
    return res.status(500).json({
      error: 'อ่านค่าล่าสุดไม่สำเร็จ',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

async function fetchLatestTelemetry(nodeId?: string) {
  const params: any[] = [];
  const whereClause = nodeId ? `WHERE node_id = $1 AND` : 'WHERE';
  if (nodeId) params.push(nodeId);
  const metrics = ['battery_soc', 'water_level_cm', 'power_kw', 'voltage'];
  const result: any = {};
  for (const metric of metrics) {
    const query = `
      SELECT value FROM sensor_telemetry
      ${whereClause} metric = $${params.length + 1}
      ORDER BY time DESC LIMIT 1
    `;
    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params, metric);
    result[metric] = rows.length > 0 ? rows[0].value : null;
  }
  return result;
}

// GET /api/telemetry/history?node_id=xxx&metric=battery_soc&from=...&to=...
// ยังไม่ได้ทำ — **ห้ามตอบ []** เพราะผู้เรียกจะอ่านว่า "ไม่มีข้อมูล" ทั้งที่ไม่เคยมีข้อมูล
// (และไม่รู้ว่ามี endpoint ที่ใช้งานได้จริงอยู่) ⇒ 501 + บอกทางไป
router.get('/history', authenticate, (_req, res) => {
  res.status(501).json({
    error:
      'endpoint นี้ยังไม่ได้ทำ (501) — ประวัติเทเลเมตรีใช้ GET /api/timescale/history?metric=<ชื่อ>&range=24h|7d|30d (มีเพดานจำนวนจุด)',
    implemented: false,
    useInstead: '/api/timescale/history',
  });
});

export default router;
