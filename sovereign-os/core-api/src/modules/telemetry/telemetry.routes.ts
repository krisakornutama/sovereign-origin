import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// GET /api/telemetry/latest?node_id=xxx
router.get('/latest', authenticate, async (req, res) => {
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
  res.json(data);
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
router.get('/history', authenticate, async (req, res) => {
  // ... (implement later)
  res.json([]);
});

export default router;