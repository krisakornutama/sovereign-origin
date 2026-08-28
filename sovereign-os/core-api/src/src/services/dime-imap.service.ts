// ─────────────────────────────────────────────────────────────────────────────
// Dime! IMAP — ดึงสเตตเมนต์ PDF จากอีเมล (imapflow)
//
// - อ่านเฉพาะ unread ใน window ย้อนหลัง (DIME_LOOKBACK_DAYS) — ไม่รื้อกล่องจดหมาย
// - เฉพาะอีเมลจาก @dime.co.th หรือ subject มี "dime" → ค้น attachment PDF
//   (walk bodyStructure → download เฉพาะ part นั้น — ไม่ต้องโหลดทั้งอีเมล)
// - เจอแล้ว mark \Seen (อ่านแล้ว) — เจอหลายฉบับเอาใบแรก
// - Credentials จาก env ผ่าน loadDimeImapConfig — ไม่ hardcode ในโค้ด
// ─────────────────────────────────────────────────────────────────────────────
import { ImapFlow, type FetchMessageObject } from 'imapflow';

// โครงสร้าง bodyStructure ที่เราใช้ (ส่วนย่อยของ imapflow — ประกาศเองเพื่อไม่พึ่ง type ที่แล้วแต่เวอร์ชัน)
//
// หมายเหตุจากของจริง (Gmail): imapflow คืนเป็น
//   { part: '2', type: 'application/octet-stream', parameters: { name: 'xxx.pdf' }, disposition: 'attachment' }
// — type เป็น "media/subtype" แบบรวม, parameters ไม่พ่วง index, disposition เป็น string
// ทิ้ง mediaType/subtype + disposition object ไว้เข้ากันได้กับเทสต์/เครื่องมืออื่น
export interface BodyStructurePart {
  part?: string;
  type?: string; // imapflow จริง: "application/octet-stream", "text/html"
  mediaType?: string; // เข้ากันได้กับ shape เดิม
  subtype?: string;
  parameters?: { name?: string; charset?: string; boundary?: string };
  disposition?: string | { type?: string; params?: { filename?: string } };
  childNodes?: BodyStructurePart[];
}

export interface DimeImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
  mailbox: string;
  lookbackDays: number;
}

export function loadDimeImapConfig(env: NodeJS.ProcessEnv = process.env): DimeImapConfig {
  return {
    host: env.DIME_IMAP_HOST?.trim() ?? '',
    port: Number(env.DIME_IMAP_PORT ?? '993'),
    user: env.DIME_IMAP_USER?.trim() ?? '',
    pass: env.DIME_IMAP_PASS ?? '',
    tls: (env.DIME_IMAP_TLS ?? 'true') !== 'false',
    mailbox: env.DIME_IMAP_MAILBOX?.trim() || 'INBOX',
    lookbackDays: Number(env.DIME_LOOKBACK_DAYS ?? '45'),
  };
}

export function isDimeConfigured(cfg: DimeImapConfig): boolean {
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

/** ใช่สเตตเมนต์ของ Dime หรือไม่: sender โดเมน dime.co.th หรือ subject มีคำว่า dime */
export function isDimeEmail(envelope: FetchMessageObject['envelope'], subject: string): boolean {
  const from = envelope?.from?.[0]?.address ?? '';
  const fromDomain = from.split('@')[1]?.toLowerCase() ?? '';
  return fromDomain.endsWith('dime.co.th') || /dime/i.test(subject);
}

/** หา part ของ PDF ใน bodyStructure (แบบ recursive) — คืน part id เช่น "1.2" */
export function findPdfPart(bs: BodyStructurePart | undefined | null): string | null {
  if (!bs) return null;
  const fname =
    (typeof bs.disposition === 'object' ? (bs.disposition?.params?.filename ?? '') : '') ||
    (bs.parameters?.name ?? '');
  const mime =
    bs.type || (bs.mediaType && bs.subtype ? `${bs.mediaType}/${bs.subtype}` : '');
  const isPdfMime = /^application\/pdf$/i.test(mime);
  const nameIsPdf = /\.pdf$/i.test(fname);
  const dispAttachment =
    bs.disposition === 'attachment' ||
    (typeof bs.disposition === 'object' && bs.disposition?.type === 'attachment');
  // Gmail มักส่งเป็น application/octet-stream + parameters.name="....pdf" + disposition "attachment"
  if (isPdfMime || (nameIsPdf && (dispAttachment || /octet-stream/i.test(mime)))) {
    return bs.part ?? null;
  }
  for (const child of bs.childNodes ?? []) {
    const p = findPdfPart(child);
    if (p) return p;
  }
  return null;
}

/** subject ใช่สเตตเมนต์รายเดือน (สรุปข้อมูลการลงทุน / Monthly Statement) หรือไม่ */
export function isMonthlyStatementSubject(subject: string): boolean {
  return /monthly statement|สรุปข้อมูลการลงทุน/i.test(subject);
}

export interface DimeEmailPdf {
  messageId: string;
  subject: string;
  date: Date;
  pdf: Buffer;
}

export interface DimeFetchDeps {
  connect: () => Promise<ImapFlow>;
}

/**
 * ดึงสเตตเมนต์ PDF ฉบับที่ตรงที่สุดจากอีเมลยังไม่ได้อ่าน — null ถ้าไม่มี
 *
 * เจอเฉพาะสเตตเมนต์รายเดือน (Monthly Statement) — ใบอื่น (Confirmation Note ฯลฯ)
 * ไม่ถูกดึง/ไม่ถูก mark seen; เลือกฉบับเก่าสุดก่อน (catch-up ต้องเรียงตามเวลา
 * กันพอร์ตย้อนหลัง — upsert เป็น absolute snapshot)
 * ผ่าน deps.connect() เพื่อให้เทสต์ inject fake client ได้
 */
export async function fetchDimeStatementPdf(
  cfg: DimeImapConfig,
  deps: DimeFetchDeps = {
    connect: () =>
      Promise.resolve(
        new ImapFlow({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.tls,
          auth: { user: cfg.user, pass: cfg.pass },
        })
      ),
  }
): Promise<DimeEmailPdf | null> {
  const client = await deps.connect();
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try {
      const since = new Date(Date.now() - (cfg.lookbackDays || 45) * 24 * 60 * 60 * 1000);
      const candidates: Array<{ uid: number; subject: string; messageId: string; date: Date; part: string }> = [];
      for await (const msg of client.fetch({ seen: false, since }, { envelope: true, uid: true, internalDate: true, bodyStructure: true })) {
        const subject = msg.envelope?.subject ?? '';
        if (!isDimeEmail(msg.envelope, subject)) continue;
        if (!isMonthlyStatementSubject(subject)) continue; // เฉพาะสเตตเมนต์รายเดือน
        const part = findPdfPart(msg.bodyStructure as unknown as BodyStructurePart | undefined);
        if (!part) continue;
        candidates.push({
          uid: msg.uid,
          subject,
          messageId: msg.envelope?.messageId ?? `uid:${msg.uid}`,
          date: new Date(msg.internalDate ?? Date.now()),
          part,
        });
      }
      if (candidates.length === 0) return null;

      // สเตตเมนต์เก่าสุดก่อน (catch-up เรียงตามเวลา)
      candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
      const pick = candidates[0];

      const dl = await client.download(pick.uid, pick.part, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of dl.content) chunks.push(chunk as Buffer);
      const pdf = Buffer.concat(chunks);
      if (pdf.length === 0) return null;

      await client.messageFlagsAdd(pick.uid, ['\\Seen'], { uid: true });
      return {
        messageId: pick.messageId,
        subject: pick.subject,
        date: pick.date,
        pdf,
      };
    } finally {
      await lock.release();
    }
  } finally {
    await client.logout();
  }
  return null;
}
