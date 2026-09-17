// ─────────────────────────────────────────────────────────────────────────────
// Dime! Statement API — /api/dime
//   GET  /status      → config สถานะ (configured/enabled/owner/cron)
//   POST /fetch       → ดึงอีเมล unread → process ตอนนี้ (SUPERADMIN เท่านั้น)
//   POST /import      → อัปโหลด PDF สเตตเมนต์ตรงๆ (ไม่ต้องผ่านอีเมล)
//   GET  /statements  → ประวัติที่ import มา
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { hardenUpload } from '../../lib/harden-upload';
import { dimeProcessor } from '../../services/dime.service';
import { isDimeConfigured, loadDimeImapConfig } from '../../services/dime-imap.service';

const router = Router();
export { prisma };

// harden: memory mode (ไม่ลงดิสก์) + whitelist .pdf + จำกัด 10MB — เหมือนเดิมทุกข้อ
const pdfUpload = hardenUpload({
  mode: 'memory',
  allowedExtensions: ['.pdf'],
  maxSizeMB: 10,
  mimeAllow: new Set(['application/pdf']),
});

// GET /api/dime/status — ตรวจสอบ config (ไม่เปิดเผย credentials)
router.get('/status', authenticate, (_req, res) => {
  const cfg = loadDimeImapConfig();
  res.json({
    success: true,
    data: {
      imapConfigured: isDimeConfigured(cfg),
      imapHost: cfg.host || null,
      imapUser: cfg.user || null,
      enabled: process.env.DIME_ENABLED === 'true',
      fetchCron: process.env.DIME_FETCH_CRON || '0 9 * * *',
      ownerUsername: process.env.DIME_OWNER_USERNAME || null,
      pdfPasswordSet: Boolean(process.env.DIME_PDF_PASSWORD),
    },
  });
});

// POST /api/dime/fetch — ดึงสเตตเมนต์จากอีเมลทันที (สำรองคน นอกจาก cron)
router.post('/fetch', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const result = await dimeProcessor.fetchFromMail();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// POST /api/dime/import — อัปโหลด PDF ตรงๆ (ไม่มี password ในไฟล์นี้ — ใช้ env)
router.post('/import', authenticate, async (req: any, res) => {
  pdfUpload.single('file')(req, res, async (err: unknown) => {
    if (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    if (!req?.file) {
      res.status(400).json({ success: false, error: 'ต้องแนบไฟล์ PDF (field name: file)' });
      return;
    }
    try {
      const result = await dimeProcessor.processPdf(req.file.buffer, {
        source: 'UPLOAD',
        subject: req.file.originalname,
        fileName: req.file.originalname,
      });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e) });
    }
  });
});

// GET /api/dime/statements — ประวัติ (ล่าสุดก่อน)
router.get('/statements', authenticate, async (_req, res) => {
  try {
    const rows = await prisma.dimeStatement.findMany({
      orderBy: { parsed_at: 'desc' },
      take: 50,
      include: { user: { select: { username: true } } },
    });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.user?.username ?? null,
        statementPeriod: r.statement_period,
        source: r.source,
        subject: r.subject,
        assetCount: (r.assets as unknown[]).length,
        skippedCount: Array.isArray(r.skipped) ? (r.skipped as unknown[]).length : 0,
        parsedAt: r.parsed_at,
        contentHash: r.raw_text_hash ? r.raw_text_hash.slice(0, 12) : null,
        // ── สรุปหน้าแรก ──
        accountNo: r.account_no,
        investmentAccountNo: r.investment_account_no,
        taxId: r.tax_id,
        taxInvoiceNo: r.tax_invoice_no,
        branchNo: r.branch_no,
        fxRate: r.fx_rate,
        totalBalanceUsd: r.total_balance_usd,
        totalBalanceThb: r.total_balance_thb,
        cashBalanceUsd: r.cash_balance_usd,
        cashBalanceThb: r.cash_balance_thb,
        totalReturnPct: r.total_return_pct,
        totalReturnUsd: r.total_return_usd,
        sectors: r.sectors,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

export default router;