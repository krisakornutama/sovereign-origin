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
/** เพดานแถวของหน้ารายการ — เกินกว่านี้ให้ใช้ export ไม่ใช่เลื่อนดู */
const LIST_MAX_ROWS = 500;
/** เพดาน offset — กัน deep pagination ที่กิน CPU/IO โดยไม่มีใครได้ประโยชน์ */
const LIST_MAX_OFFSET = 100000;

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
    // ชื่อผู้ใช้อยู่ในตาราง users ไม่ได้อยู่ใน payload (payload เก็บ ip/method/path/body)
    // ถ้าไม่กรองที่ relation นี้ ผู้ใช้จะพิมพ์ชื่อคนในช่องค้นหาแล้วได้ผลว่างเสมอ
    // ทั้งที่ placeholder ของหน้า /audit บอกว่าค้นชื่อได้ — ต้องเป็น OR กับผลของ raw search
    // (ไม่ใช่แทนกัน) และคงตัวกรองอื่นไว้เป็น AND ตามปกติ
    where.OR = [
      { id: { in: hits.map((h) => h.id) } },
      { user: { username: { contains: filters.q, mode: 'insensitive' } } },
    ];
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

// GET /api/audit — รายการล่าสุด (ตัวกรองเดิม: q, actionPrefix, limit) + offset สำหรับแบ่งหน้า
//
// หัวใจของการ "ตรวจย้อนได้": ถ้าเห็นได้แค่ N แถวล่าสุด ผู้ตรวจถามไม่ได้ว่าเมื่อวานเกิดอะไร
// (ต้อง export ทั้งช่วงแทนซึ่งหนักและไม่ตอบคำถาม "ขอดูหน้าถัดไป") ⇒ รองรับ offset/skip
// แต่ไม่นับทั้งตาราง (audit_logs โตไม่จำกัด): ดึง `limit+1` แถวแล้วใช้แถวเกินเป็นสัญญาณ
// "มีต่อ" ที่เชื่อถือได้ ไม่ต้องเดาจากจำนวนที่ได้พอดี
router.get('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 100, LIST_MAX_ROWS));
    const rawOffset = parseInt(req.query.offset as string, 10);
    if (Number.isFinite(rawOffset) && rawOffset > LIST_MAX_OFFSET) {
      // เงียบ ๆ คืนลิสต์ว่างจะอ่านว่า "ไม่มีข้อมูลแล้ว" — ซึ่งเป็นการโกหกอีกแบบ
      return res.status(400).json({ error: `offset เกินเพดาน ${LIST_MAX_OFFSET} — ใช้ export CSV สำหรับช่วงใหญ่` });
    }
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    const fetched = await prisma.auditLog.findMany({
      where: await buildWhere(readFilters(req)),
      orderBy: { timestamp: 'desc' },
      skip: offset,
      take: limit + 1,
      include: { user: { select: { username: true } } },
    });
    const hasMore = fetched.length > limit;
    const logs = hasMore ? fetched.slice(0, limit) : fetched;

    res.setHeader('X-Audit-List-Has-More', hasMore ? 'true' : 'false');
    res.setHeader('X-Audit-List-Offset', String(offset));
    res.setHeader('X-Audit-List-Limit', String(limit));
    res.json(logs);
  } catch (err) {
    console.error('Audit API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/audit/export — ดาวน์โหลด CSV ตามตัวกรองเดียวกับหน้า audit
// ตัว export เองถูกบันทึกเป็น AUDIT_EXPORT (ใครดึงไป จำนวนเท่าไร ตรวจย้อนได้)
//
// ไฟล์ที่ถูกตัดเงียบ ๆ คือหลักฐานที่โกหก: ผู้ตรวจได้ CSV ไปแล้วเชื่อว่าเป็นทั้งช่วง
// ที่ขอ ทั้งที่เพดาน 10,000 แถวตัดไปแล้ว ⇒ ต้องบอกจำนวนที่ได้จริง เทียบกับจำนวน
// ทั้งหมดที่ตรงตัวกรอง (คำถามเดียวกัน) แล้วส่งธง "ถูกตัด" ให้ UI เตือนก่อน/หลังโหลด
router.get('/export', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const filters = readFilters(req);
    const requested = parseInt(req.query.limit as string) || EXPORT_MAX_ROWS;
    const take = Math.max(1, Math.min(requested, EXPORT_MAX_ROWS));

    // where ก้อนเดียวใช้ทั้งสองคำถาม — นับด้วยตัวกรองอื่นไม่ครบเมื่อไร ตัวเลข "ทั้งหมด"
    // จะเกินความจริงทันที (เช่นลืม q ที่เป็น OR ระหว่าง id กับ username)
    const where = await buildWhere(filters);
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        include: { user: { select: { username: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    const truncated = total > logs.length;

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
    // ตัวเลขจริงของไฟล์นี้ — UI อ่านเพื่อเตือนว่า "ไม่ครบทั้งช่วง" (CORS ต้อง expose header)
    res.setHeader('X-Audit-Export-Rows', String(logs.length));
    res.setHeader('X-Audit-Export-Total', String(total));
    res.setHeader('X-Audit-Export-Truncated', truncated ? 'true' : 'false');
    res.send('\ufeff' + lines.join('\n') + '\n');

    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'AUDIT_EXPORT',
      payload: {
        rows: logs.length,
        total,
        truncated,
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
