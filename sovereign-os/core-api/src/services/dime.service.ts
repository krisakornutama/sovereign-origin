// ─────────────────────────────────────────────────────────────────────────────
// Dime! Pipeline — วงจร: PDF → parse → dedupe → upsert พอร์ต + ราคา
//
//   processPdf(buffer, meta)  : เรียกจาก /import (อัปโหลด) หรือจากอีเมล
//   fetchFromMail()          : IMAP → PDF ใบแรกที่ยังไม่ได้อ่าน → processPdf
//   startDimeScheduler()     : cron (DIME_FETCH_CRON) — เปิดเมื่อ DIME_ENABLED
//
// หลัก: ตัวเลขผิด → ข้ามแถว (ไม่หยุดทั้งไฟล์), upsert ตำแหน่งเดียวพลาด → ข้าม
// credentials/รหัส PDF มาจาก env เท่านั้น — ไม่มีอะไร hardcode
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { parseDimeStatementText, type DimeParsedAsset } from './dime-parser.service';
import {
  fetchDimeStatementPdf,
  isDimeConfigured,
  loadDimeImapConfig,
  type DimeImapConfig,
} from './dime-imap.service';
import { sendTelegramAlert } from './telegram-alert.service';

/** หน้าตา pdf.js (bundled ใน pdf-parse) ที่เราใช้ตอนปลดล็อก PDF ใส่รหัสผ่าน */
interface PdfJsLike {
  disableWorker?: boolean;
  disableFontFace?: boolean;
  getDocument(opts: { data: Uint8Array; password: string }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str: string; transform: number[] }> }>;
      }>;
    }>;
  };
}

export interface DimePdfMeta {
  messageId?: string;
  subject?: string;
  source: 'EMAIL' | 'UPLOAD';
  fileName?: string;
}

export interface DimeProcessResult {
  status: 'ok' | 'empty' | 'duplicate' | 'no-section' | 'error';
  reason?: string;
  period: string | null;
  assets: DimeParsedAsset[];
  skippedCount: number;
  upserted: number;
  ownerId: string | null;
  statementId?: string;
  fromEmail?: { messageId: string; subject: string };
}

export interface DimeDeps {
  /** inject ได้ (เทสต์ส่ง fake) — จริงใช้ pdf-parse แบบ lazy import เหมือน knowledge */
  parsePdf: (buf: Buffer, password?: string) => Promise<{ text: string }>;
  findUser: (q: { username?: string; role?: string }) => Promise<{ id: string } | null>;
  findStatement: (where: { message_id?: string; raw_text_hash?: string }) => Promise<{ id: string } | null>;
  createStatement: (data: Record<string, unknown>) => Promise<{ id: string }>;
  findPosition: (where: { user_id: string; symbol: string; type: 'STOCK' }) => Promise<{ id: string } | null>;
  updatePosition: (
    where: { id: string },
    data: {
      quantity: number;
      avg_cost_usd: number;
      company_name?: string | null;
      allocation_pct?: number | null;
      total_return_pct?: number | null;
      total_return_usd?: number | null;
    }
  ) => Promise<void>;
  createPosition: (data: {
    user_id: string;
    symbol: string;
    type: string;
    quantity: number;
    avg_cost_usd: number;
    company_name?: string | null;
    allocation_pct?: number | null;
    total_return_pct?: number | null;
    total_return_usd?: number | null;
  }) => Promise<void>;
  insertPrice: (p: { symbol: string; type: string; price_usd: number; source: string; time: Date }) => Promise<void>;
  log: (msg: string) => void;
}

export function sha1Section(text: string): string {
  return createHash('sha1').update(text.slice(0, 256 * 1024)).digest('hex');
}

// ── Pipeline ──

export function createDimeProcessor(deps: DimeDeps, env: NodeJS.ProcessEnv = process.env) {
  const log = deps.log;

  async function resolveOwner(): Promise<string | null> {
    try {
      const byName = env.DIME_OWNER_USERNAME?.trim();
      if (byName) {
        const u = await deps.findUser({ username: byName });
        if (u) return u.id;
        log(`[dime] DIME_OWNER_USERNAME="${byName}" ไม่พบผู้ใช้ — จะใช้ SUPERADMIN ตัวแรก`);
      }
      const admin = await deps.findUser({ role: 'SUPERADMIN' });
      return admin?.id ?? null;
    } catch (e) {
      log(`[dime] resolveOwner ล้มเหลว: ${String(e)}`);
      return null;
    }
  }

  /** extract + parse ข้อความจาก PDF — พยายามอ่านแบบไม่มีรหัสก่อน, ติดรหัสแล้วค่อยใช้ env */
  async function extractText(buf: Buffer): Promise<{ text: string; usedPassword: boolean }> {
    const password = env.DIME_PDF_PASSWORD;
    try {
      const out = await deps.parsePdf(buf);
      return { text: out.text, usedPassword: false };
    } catch (firstErr) {
      if (password) {
        try {
          const out = await deps.parsePdf(buf, password);
          return { text: out.text, usedPassword: true };
        } catch {
          throw firstErr; // คืน error เดิม (น่าจะเป็นรหัสผ่านผิด/ไฟล์เสีย)
        }
      }
      throw firstErr;
    }
  }

  async function processPdf(
    buf: Buffer,
    meta: DimePdfMeta
  ): Promise<DimeProcessResult> {
    try {
      let text: string;
      try {
        text = (await extractText(buf)).text;
      } catch (e) {
        const reason = `อ่าน PDF ไม่ได้: ${String(e)}`;
        log(`[dime] ${reason}`);
        try { await sendTelegramAlert({ text: `📄 Dime! Statement — ${reason}`, severity: 'warn', eventKey: `dime-pdf-${sha1Section(String(e))}` }); } catch { /* soft-fail */ }
        return { status: 'error', reason, period: null, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
      }

      const parsed = parseDimeStatementText(text, { subject: meta.subject });
      if (!parsed.sectionFound) {
        const reason = 'หา section หุ้น US ไม่เจอในไฟล์นี้';
        log(`[dime] ${reason}`);
        return { status: 'no-section', reason, period: parsed.period, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
      }

      // dedupe 2 ชั้น: message_id (อีเมล) / hash เนื้อหา (ไฟล์ซ้ำ)
      const hash = sha1Section(parsed.sectionText);
      const existing = await deps.findStatement(
        meta.messageId ? { message_id: meta.messageId } : { raw_text_hash: hash }
      );
      if (existing) {
        log(`[dime] duplicate — statement ${meta.messageId ? `msg ${meta.messageId}` : `hash ${hash.slice(0, 12)}`} มีอยู่แล้ว`);
        return { status: 'duplicate', period: parsed.period, assets: parsed.assets, skippedCount: parsed.skipped.length, upserted: 0, ownerId: null, statementId: existing.id };
      }

      const ownerId = await resolveOwner();
      let upserted = 0;
      const failures: string[] = [];
      if (ownerId) {
        for (const a of parsed.assets) {
          try {
            const existingPos = await deps.findPosition({ user_id: ownerId, symbol: a.ticker, type: 'STOCK' });
            const rowExtras = {
              company_name: a.company_name || null,
              allocation_pct: a.allocation_pct ?? null,
              total_return_pct: a.total_return_pct ?? null,
              total_return_usd: a.total_return_usd ?? null,
            };
            if (existingPos) {
              await deps.updatePosition(
                { id: existingPos.id },
                { quantity: a.shares, avg_cost_usd: a.avg_cost, ...rowExtras }
              );
            } else {
              await deps.createPosition({
                user_id: ownerId,
                symbol: a.ticker,
                type: 'STOCK',
                quantity: a.shares,
                avg_cost_usd: a.avg_cost,
                ...rowExtras,
              });
            }
            await deps.insertPrice({ symbol: a.ticker, type: 'STOCK', price_usd: a.current_price, source: 'dime', time: new Date() });
            upserted++;
          } catch (e) {
            failures.push(`${a.ticker}: ${String(e)}`);
          }
        }
        if (failures.length) log(`[dime] upsert พลาด ${failures.length} ตำแหน่ง: ${failures.join(' | ')}`);
      } else {
        log('[dime] หาเจ้าของพอร์ตไม่เจอ — ข้าม upsert (เก็บ statement ไว้เฉยๆ)');
      }

      const statement = await deps.createStatement({
        user_id: ownerId,
        statement_period: parsed.period,
        message_id: meta.messageId ?? null,
        raw_text_hash: hash,
        source: meta.source,
        subject: meta.subject ?? meta.fileName ?? null,
        assets: parsed.assets as unknown as object[],
        skipped: parsed.skipped.length ? (parsed.skipped as unknown as object[]) : undefined,
        // ── สรุปหน้าแรก (ยอดรวม/เงินสด/FX/เลขบัญชี/ผลตอบแทน) — ไม่แตะ balance sheet (user แก้เองได้) ──
        account_no: parsed.summary.account_no,
        investment_account_no: parsed.summary.investment_account_no,
        tax_id: parsed.summary.tax_id,
        tax_invoice_no: parsed.summary.tax_invoice_no,
        branch_no: parsed.summary.branch_no,
        fx_rate: parsed.summary.fx_rate,
        total_balance_usd: parsed.summary.total_balance_usd,
        total_balance_thb: parsed.summary.total_balance_thb,
        cash_balance_usd: parsed.summary.cash_balance_usd,
        cash_balance_thb: parsed.summary.cash_balance_thb,
        total_return_pct: parsed.summary.total_return_pct,
        total_return_usd: parsed.summary.total_return_usd,
        sectors: parsed.summary.sectors.length ? (parsed.summary.sectors as unknown as object[]) : undefined,
      });

      log(`[dime] ${meta.source}: ${parsed.assets.length} ตำแหน่ง (upsert ${upserted}) period=${parsed.period}`);
      return {
        status: 'ok',
        period: parsed.period,
        assets: parsed.assets,
        skippedCount: parsed.skipped.length,
        upserted,
        ownerId,
        statementId: statement.id,
      };
    } catch (e) {
      const reason = `ประมวลผลสเตตเมนต์ล้มเหลว: ${String(e)}`;
      log(`[dime] ${reason}`);
      try { await sendTelegramAlert({ text: `📄 Dime! Statement — ${reason}`, severity: 'warn', eventKey: `dime-proc-${sha1Section(reason)}` }); } catch { /* soft-fail */ }
      return { status: 'error', reason, period: null, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
    }
  }

  async function fetchFromMail(cfg?: DimeImapConfig): Promise<DimeProcessResult> {
    const conf = cfg ?? loadDimeImapConfig(env);
    if (!isDimeConfigured(conf)) {
      return { status: 'empty', reason: 'ยังไม่ได้ตั้ง DIME_IMAP_HOST/USER/PASS', period: null, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
    }
    try {
      const mail = await fetchDimeStatementPdf(conf);
      if (!mail) {
        log('[dime] ไม่มีอีเมลสเตตเมนต์ที่ยังไม่ได้อ่านในหน้าต่างที่กำหนด');
        return { status: 'empty', reason: 'ไม่มีอีเมลใหม่ที่ตรงเกณฑ์', period: null, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
      }
      log(`[dime] เจอสเตตเมนต์จากอีเมล: "${mail.subject}" (${mail.messageId})`);
      const result = await processPdf(mail.pdf, { messageId: mail.messageId, subject: mail.subject, source: 'EMAIL' });
      return { ...result, fromEmail: { messageId: mail.messageId, subject: mail.subject } };
    } catch (e) {
      const reason = `เชื่อมต่อ IMAP ล้มเหลว: ${String(e)}`;
      log(`[dime] ${reason}`);
      try { await sendTelegramAlert({ text: `📄 Dime! IMAP — ${reason}`, severity: 'warn', eventKey: 'dime-imap' }); } catch { /* soft-fail */ }
      return { status: 'error', reason, period: null, assets: [], skippedCount: 0, upserted: 0, ownerId: null };
    }
  }

  return { processPdf, fetchFromMail };
}

export type DimeProcessor = ReturnType<typeof createDimeProcessor>;

// ── Singleton (ใช้งานจริง) ──

export { prisma };

export const dimeProcessor: DimeProcessor = createDimeProcessor(
  {
    parsePdf: async (buf, password) => {
      const pdfParse = (await import('pdf-parse')).default;
      try {
        const data = await pdfParse(buf);
        return { text: String(data.text ?? '') };
      } catch {
        if (!password) throw new Error('PDF อ่านไม่ได้ (อาจใส่รหัสผ่าน)');
      }
      // PDF ใส่รหัสผ่าน — pdf-parse 1.x ไม่รองรับ password → เปิดด้วย pdf.js ที่ bundled มากับ pdf-parse ตรงๆ
      // @ts-ignore — ไฟล์ภายใน pdf-parse ไม่มี declaration (.js แพ็กเกจใน node_modules)
      const pdfMod = (await import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js')) as {
        default?: PdfJsLike;
      } & PdfJsLike;
      const PDFJS = (pdfMod.default ?? pdfMod) as PdfJsLike;
      PDFJS.disableWorker = true;
      PDFJS.disableFontFace = true;
      const doc = await PDFJS.getDocument({ data: new Uint8Array(buf), password }).promise;
      let text = '';
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let lastY: number | null = null;
        for (const item of content.items as Array<{ str: string; transform: number[] }>) {
          if (lastY !== null && item.transform[5] !== lastY) text += '\n';
          text += item.str;
          lastY = item.transform[5];
        }
        text += '\n';
      }
      return { text };
    },
    findUser: (q) =>
      prisma.user.findFirst({
        where: q.username ? { username: q.username } : { role: 'SUPERADMIN' },
        select: { id: true },
      }) as Promise<{ id: string } | null>,
    findStatement: (where) =>
      prisma.dimeStatement.findFirst({
        where: where.message_id ? { message_id: where.message_id } : { raw_text_hash: where.raw_text_hash },
        select: { id: true },
      }) as Promise<{ id: string } | null>,
    createStatement: (data) =>
      prisma.dimeStatement.create({ data: data as never, select: { id: true } }),
    findPosition: (where) =>
      prisma.assetPosition.findFirst({ where, select: { id: true } }) as Promise<{ id: string } | null>,
    updatePosition: async (where, data) => {
      await prisma.assetPosition.update({ where, data: data as never });
    },
    createPosition: async (data) => {
      await prisma.assetPosition.create({
        data: { ...data, strategy_family: 'FUNDAMENTAL' } as never,
      });
    },
    insertPrice: (p) =>
      prisma.assetPrice.create({
        data: {
          symbol: p.symbol,
          type: p.type as never,
          price_usd: p.price_usd,
          source: p.source,
          time: p.time,
        },
      }) as unknown as Promise<void>,
    log: (msg) => console.log(msg),
  },
  process.env
);

// ── Cron scheduler — เปิดเมื่อ DIME_ENABLED=true และตั้ง IMAP ครบ ──

export function startDimeScheduler(
  processor: DimeProcessor = dimeProcessor,
  env: NodeJS.ProcessEnv = process.env
): ReturnType<typeof cron.schedule> | null {
  const cfg = loadDimeImapConfig(env);
  const enabled = env.DIME_ENABLED === 'true';
  if (!enabled || !isDimeConfigured(cfg)) {
    console.log('[dime] cron ปิด (ตั้ง DIME_ENABLED=true + DIME_IMAP_* ใน infra/.env)');
    return null;
  }
  const expr = env.DIME_FETCH_CRON?.trim() || '0 9 * * *';
  const task = cron.schedule(expr, () => {
    processor.fetchFromMail(cfg).catch((e) => console.error('[dime] cron run error:', e));
  });
  console.log(`[dime] cron เปิด: "${expr}" → IMAP ${cfg.user}@${cfg.host}`);
  return task;
}
