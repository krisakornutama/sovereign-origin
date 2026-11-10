import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { AuditService } from '../../services/audit.service';

// ────────────────────────────────────────────────────────────────────────────
// Audit log viewer (SUPERADMIN only) — ย้ายมาจาก inline routes ใน server.ts
// + export CSV สำหรับส่งต่อผู้ตรวจ (PDPA / e-Tax) โดยไม่ต้องเปิด DB console
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

/** เพดานแถวของไฟล์ export — กันการดึงทั้งตารางโดยไม่ตั้งใจ (ไม่ใช่ทาง backup) */
const EXPORT_MAX_ROWS = 10000;

interface AuditFilters {
  q: string;
  actionPrefix: string;
  from: Date | null;
  to: Date | null;
}

function readFilters(req: any): AuditFilters {
  const fromRaw = typeof req.query?.from === 'string' ? req.query.from : '';
  const toRaw = typeof req.query?.to === 'string' ? req.query.to : '';
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  return {
    q: ((req.query?.q as string) || '').trim(),
    actionPrefix: ((req.query?.actionPrefix as string) || '').trim(),
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  };
}

async function buildWhere(filters: AuditFilters): Promise<Prisma.AuditLogWhereInput> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.actionPrefix) where.action_type = { startsWith: filters.actionPrefix };
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) where.timestamp.gte = filters.from;
    if (filters.to) where.timestamp.lte = filters.to;
  }
  if (filters.q) {
    // payload เป็น JSONB (Prisma filter ยังครอบไม่หมด) → ค้นด้วย ILIKE บน text dump ตรง ๆ
    const hits = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "audit_logs" WHERE action_type ILIKE ${`%${filters.q}%`} OR payload::text ILIKE ${`%${filters.q}%`}`,
    );
    where.id = { in: hits.map((h) => h.id) };
  }
  return where;
}

// ── CSV helpers ──
// RFC 4180 quoting + formula-injection guard: เซลล์ที่ขึ้นต้นด้วย = + - @ (หรือ tab/CR)
// ถ้าเปิดใน Excel ตรง ๆ จะถูกตีความเป็นสูตร → เติม apostrophe ให้เป็นข้อความล้วน
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function payloadField(payload: any, key: string): string {
  const value = payload && typeof payload === 'object' ? payload[key] : '';
  return value === null || value === undefined ? '' : String(value);
}

// GET /api/audit — รายการล่าสุด (ตัวกรองเดิม: q, actionPrefix, limit)
router.get('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await prisma.auditLog.findMany({
      where: await buildWhere(readFilters(req)),
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    });
    res.json(logs);
  } catch (err) {
    console.error('Audit API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/audit/export — ดาวน์โหลด CSV ตามตัวกรองเดียวกับหน้า audit
// ตัว export เองถูกบันทึกเป็น AUDIT_EXPORT (ใครดึงไป จำนวนเท่าไร ตรวจย้อนได้)
router.get('/export', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const filters = readFilters(req);
    const requested = parseInt(req.query.limit as string) || EXPORT_MAX_ROWS;
    const take = Math.max(1, Math.min(requested, EXPORT_MAX_ROWS));

    const logs = await prisma.auditLog.findMany({
      where: await buildWhere(filters),
      orderBy: { timestamp: 'desc' },
      take,
      include: { user: { select: { username: true } } },
    });

    const lines = [csvRow(['timestamp', 'user', 'action', 'ip', 'method', 'path', 'payload'])];
    for (const log of logs as any[]) {
      lines.push(
        csvRow([
          log.timestamp instanceof Date ? log.timestamp.toISOString() : new Date(log.timestamp).toISOString(),
          log.user?.username || '',
          log.action_type,
          payloadField(log.payload, 'ip'),
          payloadField(log.payload, 'method'),
          payloadField(log.payload, 'path'),
          log.payload === null || log.payload === undefined ? '' : JSON.stringify(log.payload),
        ])
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${stamp}.csv"`);
    res.send('\ufeff' + lines.join('\n') + '\n');

    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'AUDIT_EXPORT',
      payload: {
        rows: logs.length,
        q: filters.q || undefined,
        actionPrefix: filters.actionPrefix || undefined,
        from: filters.from?.toISOString(),
        to: filters.to?.toISOString(),
        requestIp: req.ip,
      },
    });
  } catch (err) {
    console.error('Audit export error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
