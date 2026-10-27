import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';

/**
 * Idempotency (กลาง) — กัน "งานซ้ำ" ที่เกิดจาก retry/เน็ตหลุด/คิวออฟไลน์
 *
 * ทำไมต้องมีตารางกลาง: ระบบนี้มีจุดที่ทำซ้ำแล้วเสียเงิน/สต็อกเพี้ยน (ออเดอร์, การชำระเงิน,
 * การรับซื้อวัตถุดิบ) หลายโมดูล ถ้าต่างคนต่างทำ จะได้กฎไม่เหมือนกันและตรวจสอบยาก
 *
 * กติกา:
 *   · ฝั่ง client สร้างคีย์ 1 ตัวต่อ "การกระทำของผู้ใช้ 1 ครั้ง" (ไม่ใช่ต่อ request)
 *     แล้วส่งซ้ำคีย์เดิมทุกครั้งที่ retry ⇒ server ตอบผลเดิม ไม่ทำงานซ้ำ
 *   · คีย์เดิม + payload ต่าง = conflict (ไม่ใช่ replay) — กันการเผลอใช้คีย์ซ้ำกับคนละงาน
 *   · คีย์เดิมแต่คนละผู้ใช้ = conflict (ไม่คืนผลของคนอื่น)
 *   · เก็บเฉพาะผล 2xx — 4xx/5xx ต้องลองใหม่ได้ (ลบแถวทิ้งทันที)
 *   · lease สั้น (60 วิ) สำหรับคำขอที่ยังทำงานอยู่, TTL ยาว (24 ชม.) สำหรับผลที่เก็บแล้ว
 *   · ตารางยังไม่ถูกสร้าง (P2021) = "ปิดการกันซ้ำ" แต่ระบบต้องทำงานต่อได้ (fail-open)
 *     ⇒ deploy โค้ดก่อน migrate ได้โดยไม่ทำให้ endpoint ตาย
 */
export const IDEMPOTENCY_HEADERS = ['idempotency-key', 'x-idempotency-key'] as const;
export const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
/** เกินนี้ไม่เก็บผล (กันแถวบวมจาก response ใหญ่) — ปล่อยให้ retry ทำงานใหม่ได้ */
export const MAX_STORED_BODY_CHARS = 64 * 1024;

export type BeginResult =
  | { state: 'started'; id: string }
  | { state: 'replay'; statusCode: number; body: unknown }
  | { state: 'conflict'; reason: 'payload' | 'owner' }
  | { state: 'pending'; retryAfterSec: number };

/** อ่านคีย์จาก header (รองรับทั้งชื่อมาตรฐานและชื่อที่ frontend ส่งมา) */
export function readIdempotencyKey(headers: Record<string, unknown> | undefined): string | null {
  for (const name of IDEMPOTENCY_HEADERS) {
    const raw = headers?.[name];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** JSON ที่เรียง key คงที่ — payload เดียวกันแต่ลำดับต่างต้องได้ hash เดียวกัน */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'number' || type === 'boolean' || type === 'string') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** ลายนิ้วมือของ "คำขอนี้" — ใช้ตัดสินว่า retry คือเรื่องเดียวกันจริงหรือไม่ */
export function fingerprintRequest(input: {
  userId?: string | null;
  method: string;
  path: string;
  body: unknown;
}): string {
  const material = stableStringify({
    v: 1,
    userId: input.userId ?? '',
    method: String(input.method).toUpperCase(),
    path: input.path,
    body: input.body ?? null,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

export function isUniqueError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/** P2021 = ตารางไม่มีจริง (migration ยังไม่ถูก apply) — ต้องแยกจาก DB ล่ม */
export function isMissingTableError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2021';
}

const ms = (value: Date | string): number => new Date(value).getTime();

/**
 * ค่า JSON ที่จะเขียนลงคอลัมน์ Json? — Prisma ไม่รับ literal null
 * (null ของ JS แปลว่า "ไม่ระบุ" ไม่ใช่ "ตั้งเป็น JSON null")
 */
function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

// prune แบบเบา ๆ: ไม่เกินทุก 10 นาที ต่อ process (ไม่ต้องมี cron แยก)
let lastPruneAt = 0;

export async function beginIdempotent(input: {
  scope: string;
  key: string;
  fingerprint: string;
  userId?: string | null;
  now?: Date;
  ttlSec?: number;
  leaseSec?: number;
}): Promise<BeginResult> {
  const now = input.now ?? new Date();
  const leaseMs = Math.max(5, input.leaseSec ?? config.idempotency.leaseSec) * 1000;
  const nowMs = now.getTime();

  if (nowMs - lastPruneAt > 10 * 60_000) {
    lastPruneAt = nowMs;
    void prisma.idempotencyKey
      .deleteMany({ where: { expiresAt: { lt: now } } })
      .catch(() => {
        /* prune เป็นของแถม — ล้มเหลวไม่กระทบคำขอ */
      });
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const created = await prisma.idempotencyKey.create({
        data: {
          scope: input.scope,
          key: input.key,
          fingerprint: input.fingerprint,
          status: 'in_flight',
          userId: input.userId ?? null,
          expiresAt: new Date(nowMs + leaseMs),
        },
      });
      return { state: 'started', id: created.id };
    } catch (err) {
      if (!isUniqueError(err)) throw err;
      const row = await prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope: input.scope, key: input.key } },
      });
      if (!row) {
        // ถูกลบไประหว่างที่เรา create (prune/แทรกแซง) → ลองใหม่ได้อีก 1 ครั้ง
        if (attempt < 1) continue;
        throw err;
      }
      const rowUserId = (row.userId as string | null) ?? null;
      if (rowUserId && input.userId && rowUserId !== input.userId) return { state: 'conflict', reason: 'owner' };
      if (row.fingerprint !== input.fingerprint) return { state: 'conflict', reason: 'payload' };

      const stillValid = ms(row.expiresAt) > nowMs;
      if (row.status === 'done' && stillValid) {
        return {
          state: 'replay',
          statusCode: Number(row.responseCode ?? 200),
          body: (row.responseBody as unknown) ?? null,
        };
      }
      if (row.status !== 'done' && stillValid) {
        return { state: 'pending', retryAfterSec: Math.max(1, Math.ceil((ms(row.expiresAt) - nowMs) / 1000)) };
      }

      // หมดอายุแล้ว (ผลเก่าครบ TTL หรือ lease ตาย) → ใช้แถวเดิมต่อ ไม่สร้างขยะใหม่
      await prisma.idempotencyKey.update({
        where: { id: row.id },
        data: {
          fingerprint: input.fingerprint,
          userId: input.userId ?? null,
          status: 'in_flight',
          responseCode: null,
          responseBody: Prisma.DbNull,
          expiresAt: new Date(nowMs + leaseMs),
        },
      });
      return { state: 'started', id: row.id };
    }
  }
}

/** บันทึกผลสำเร็จเพื่อ replay ครั้งหน้า (ผลใหญ่เกินเพดาน = ไม่เก็บ แล้วปล่อยให้ retry ทำงานใหม่) */
export async function completeIdempotent(
  id: string,
  statusCode: number,
  body: unknown,
  opts: { now?: Date; ttlSec?: number } = {},
): Promise<boolean> {
  let serialized = '';
  try {
    serialized = JSON.stringify(body ?? null);
  } catch {
    await releaseIdempotent(id);
    return false;
  }
  if (serialized.length > MAX_STORED_BODY_CHARS) {
    await releaseIdempotent(id);
    return false;
  }
  const now = opts.now ?? new Date();
  const ttlMs = Math.max(60, opts.ttlSec ?? config.idempotency.ttlSec) * 1000;
  await prisma.idempotencyKey.update({
    where: { id },
    data: {
      status: 'done',
      responseCode: statusCode,
      responseBody: jsonValue(body),
      expiresAt: new Date(now.getTime() + ttlMs),
    },
  });
  return true;
}

/** ปล่อยคีย์ (คำขอที่ล้มเหลว/ไม่ได้ตอบ JSON) เพื่อให้ client ลองใหม่ได้ */
export async function releaseIdempotent(id: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { id } });
}

/** เก็บกวาดแถวหมดอายุ — เรียกจาก worker/cron ได้ (beginIdempotent ก็ prune เป็นรอบ ๆ) */
export async function pruneExpiredIdempotency(now: Date = new Date()): Promise<number> {
  const r = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  return Number(r?.count ?? 0);
}
