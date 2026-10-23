// src/services/fleet-enrollment.service.ts
//
// ── รหัสเชิญเครื่องใหม่แบบองค์กร (Fleet Enrollment Tokens) ───────────────────
// ระบบเดิมใช้ MACHINE_ENROLL_CODE ตัวเดียวร่วมกันทั้งฝ่าย:
//   • ไม่รู้ว่าใครใช้ ใช้ไปกี่เครื่อง
//   • เพิกถอนรายเครื่อง/รายสาขาไม่ได้
//   • เปลี่ยนรหัส = เครื่องที่ยังไม่ติดตั้งใช้ไม่ได้ทั้งหมด
//
// ที่นี่เพิ่ม "รหัสเชิญหลายใบ" โดยไม่ต้อง migrate DB:
//   • เก็บเฉพาะ sha256 ของรหัส (เหมือน machine token)
//   • แสดงรหัสจริงครั้งเดียวตอนสร้าง (route คืนให้ครั้งเดียว)
//   • กำหนดวันหมดอายุ / จำนวนเครื่องสูงสุด / ป้ายชื่อ (สาขา/ผู้รับผิดชอบ)
//   • เพิกถอนรายใบได้ทันที
//
// ความเข้ากันได้: /enroll ยังรับ MACHINE_ENROLL_CODE เดิมได้เสมอ
//   ⇒ เครื่องที่ติดตั้งไปแล้ว/ชุดติดตั้งเก่าไม่พัง
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import {
  createLock,
  fleetFile,
  isSafeKey,
  readJsonFile,
  sanitizeText,
  writeJsonAtomic,
} from './fleet-store.service';

const STORE_FILE = 'enrollment-tokens.json';
const TOKEN_PREFIX = 'enr_';
const TOKEN_BYTES = 24;
const TOKEN_RE = /^enr_[a-f0-9]{48}$/;
const MAX_LABEL = 64;
const MAX_USES = 1000;
const MAX_EXPIRY_HOURS = 24 * 365;
const DEFAULT_EXPIRY_HOURS = 24 * 7;

export interface FleetEnrollTokenRecord {
  id: string;
  label: string;
  tokenHash: string;
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
  lastUsedAt: string | null;
  lastMachineId: string | null;
  lastMachineName: string | null;
  revokedAt: string | null;
}

export interface FleetEnrollTokenStore {
  version: 1;
  updatedAt: string;
  tokens: FleetEnrollTokenRecord[];
}

export interface FleetEnrollTokenPublic {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
  usesRemaining: number;
  lastUsedAt: string | null;
  lastMachineId: string | null;
  lastMachineName: string | null;
  revokedAt: string | null;
  expired: boolean;
  usable: boolean;
}

export type EnrollTokenConsumeReason = 'invalid' | 'revoked' | 'expired' | 'exhausted';

export type EnrollTokenConsumeResult =
  | { ok: true; tokenId: string; label: string; usesRemaining: number }
  | { ok: false; reason: EnrollTokenConsumeReason };

const storeLock = createLock();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeHashEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function normalizeRecord(raw: unknown): FleetEnrollTokenRecord | null {
  if (!isPlainObject(raw)) return null;
  if (!isSafeKey(raw.id)) return null;
  const label = sanitizeText(raw.label, MAX_LABEL);
  if (!label) return null;
  if (typeof raw.tokenHash !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.tokenHash)) return null;
  const prefix = typeof raw.prefix === 'string' ? raw.prefix.slice(0, 20) : TOKEN_PREFIX;
  const createdAt = normalizeIso(raw.createdAt) ?? new Date(0).toISOString();
  const expiresAt = normalizeIso(raw.expiresAt);
  const revokedAt = normalizeIso(raw.revokedAt);
  // ค่าที่มีอยู่แต่แปลงไม่ได้ = ไฟล์ถูกแก้/เสีย → ทิ้ง record (fail-closed)
  // (ห้ามตีความเป็น "ไม่หมดอายุ"/"ไม่ถูกเพิกถอน" เพราะจะเปิดรหัสที่ควรปิด)
  if (raw.expiresAt != null && expiresAt === null) return null;
  if (raw.revokedAt != null && revokedAt === null) return null;
  const maxUses = Number(raw.maxUses);
  const usedCount = Number(raw.usedCount);
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > MAX_USES) return null;
  if (!Number.isFinite(usedCount) || usedCount < 0) return null;
  return {
    id: raw.id,
    label,
    tokenHash: String(raw.tokenHash).toLowerCase(),
    prefix,
    createdAt,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : null,
    expiresAt,
    maxUses: Math.round(maxUses),
    usedCount: Math.round(usedCount),
    lastUsedAt: normalizeIso(raw.lastUsedAt),
    lastMachineId: isSafeKey(raw.lastMachineId) ? raw.lastMachineId : null,
    lastMachineName: sanitizeText(raw.lastMachineName, MAX_LABEL),
    revokedAt,
  };
}

export function readEnrollTokenStore(root?: string): FleetEnrollTokenStore {
  const raw = readJsonFile<unknown>(fleetFile(STORE_FILE, root), null);
  if (!isPlainObject(raw) || !Array.isArray(raw.tokens)) {
    return { version: 1, updatedAt: new Date(0).toISOString(), tokens: [] };
  }
  const tokens: FleetEnrollTokenRecord[] = [];
  for (const row of raw.tokens) {
    const record = normalizeRecord(row);
    if (record) tokens.push(record);
  }
  return {
    version: 1,
    updatedAt: normalizeIso(raw.updatedAt) ?? new Date(0).toISOString(),
    tokens,
  };
}

function writeStore(store: FleetEnrollTokenStore, root?: string): void {
  writeJsonAtomic(fleetFile(STORE_FILE, root), {
    ...store,
    version: 1,
    updatedAt: new Date().toISOString(),
  });
}

function isExpired(record: FleetEnrollTokenRecord, now = Date.now()): boolean {
  if (!record.expiresAt) return false;
  const at = Date.parse(record.expiresAt);
  return Number.isFinite(at) && at <= now;
}

function isUsable(record: FleetEnrollTokenRecord, now = Date.now()): boolean {
  return !record.revokedAt && !isExpired(record, now) && record.usedCount < record.maxUses;
}

export function toPublicEnrollToken(record: FleetEnrollTokenRecord, now = Date.now()): FleetEnrollTokenPublic {
  return {
    id: record.id,
    label: record.label,
    prefix: record.prefix,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
    maxUses: record.maxUses,
    usedCount: record.usedCount,
    usesRemaining: Math.max(0, record.maxUses - record.usedCount),
    lastUsedAt: record.lastUsedAt,
    lastMachineId: record.lastMachineId,
    lastMachineName: record.lastMachineName,
    revokedAt: record.revokedAt,
    expired: isExpired(record, now),
    usable: isUsable(record, now),
  };
}

/** legacy/file-backed — tests/backfill เท่านั้น */
export function listEnrollTokens(root?: string, now = Date.now()): FleetEnrollTokenPublic[] {
  return readEnrollTokenStore(root).tokens.map((record) => toPublicEnrollToken(record, now));
}

function uuidOf(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function recordFromDb(row: {
  id: string;
  label: string;
  prefix: string;
  token_hash: string;
  created_at: Date;
  created_by: string | null;
  expires_at: Date | null;
  max_uses: number;
  used_count: number;
  last_used_at: Date | null;
  last_machine_id: string | null;
  last_machine_name: string | null;
  revoked_at: Date | null;
}): FleetEnrollTokenRecord {
  const isoOrNull = (value: Date | null): string | null =>
    value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return {
    id: row.id,
    label: row.label,
    tokenHash: row.token_hash,
    prefix: row.prefix,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    expiresAt: isoOrNull(row.expires_at),
    maxUses: row.max_uses,
    usedCount: row.used_count,
    lastUsedAt: isoOrNull(row.last_used_at),
    lastMachineId: row.last_machine_id,
    lastMachineName: row.last_machine_name,
    revokedAt: isoOrNull(row.revoked_at),
  };
}

/** production (Phase 2) — อ่านจาก DB */
export async function listEnrollTokensDb(now = Date.now()): Promise<FleetEnrollTokenPublic[]> {
  const rows = await prisma.fleetEnrollmentToken.findMany({ orderBy: { created_at: 'desc' } });
  return rows.map((row) => toPublicEnrollToken(recordFromDb(row), now));
}

export interface EnrollTokenSummary {
  total: number;
  usable: number;
  exhausted: number;
  expired: number;
  revoked: number;
}

export function enrollTokenSummary(root?: string, now = Date.now()): EnrollTokenSummary {
  const tokens = readEnrollTokenStore(root).tokens;
  const out: EnrollTokenSummary = { total: tokens.length, usable: 0, exhausted: 0, expired: 0, revoked: 0 };
  for (const token of tokens) {
    if (token.revokedAt) out.revoked += 1;
    else if (isExpired(token, now)) out.expired += 1;
    else if (token.usedCount >= token.maxUses) out.exhausted += 1;
    else out.usable += 1;
  }
  return out;
}

/** production (Phase 2) — สรุปจาก DB */
export async function enrollTokenSummaryDb(now = Date.now()): Promise<EnrollTokenSummary> {
  const tokens = await listEnrollTokensDb(now);
  const out: EnrollTokenSummary = { total: tokens.length, usable: 0, exhausted: 0, expired: 0, revoked: 0 };
  for (const token of tokens) {
    if (token.revokedAt) out.revoked += 1;
    else if (token.expired) out.expired += 1;
    else if (token.usedCount >= token.maxUses) out.exhausted += 1;
    else out.usable += 1;
  }
  return out;
}

/** รูปแบบรหัสที่ระบบยอมรับ — ใช้แยกก่อนจะพยายามหาในทะเบียน */
export function isEnrollTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** สร้างรหัสจริง (แสดงครั้งเดียว) + hash สำหรับเก็บ */
export function generateEnrollToken(): { token: string; tokenHash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('hex')}`;
  return { token, tokenHash: hashToken(token), prefix: token.slice(0, 12) };
}

export type CreateEnrollTokenResult =
  | { ok: true; token: string; record: FleetEnrollTokenPublic }
  | { ok: false; error: string };

export interface CreateEnrollTokenInput {
  label?: unknown;
  maxUses?: unknown;
  expiresInHours?: unknown;
}

/**
 * สร้างรหัสเชิญ
 *   maxUses: 1–1000 (default 1)
 *   expiresInHours: 1–8760 (default 168 = 7 วัน) · null = ไม่หมดอายุ (ไม่แนะนำ)
 */
export async function createEnrollToken(
  input: CreateEnrollTokenInput,
  actor: string | null,
  root?: string,
): Promise<CreateEnrollTokenResult> {
  const label = sanitizeText(input.label, MAX_LABEL);
  if (!label || label.length < 2) return { ok: false, error: 'ต้องระบุชื่อรหัส (2–64 ตัวอักษร)' };

  const maxUsesRaw = input.maxUses == null ? 1 : Number(input.maxUses);
  if (!Number.isInteger(maxUsesRaw) || maxUsesRaw < 1 || maxUsesRaw > MAX_USES) {
    return { ok: false, error: `maxUses ต้องเป็นจำนวนเต็ม 1–${MAX_USES}` };
  }

  let expiresInHours: number | null = DEFAULT_EXPIRY_HOURS;
  if (input.expiresInHours === null) {
    expiresInHours = null;
  } else if (input.expiresInHours !== undefined) {
    const n = Number(input.expiresInHours);
    if (!Number.isInteger(n) || n < 1 || n > MAX_EXPIRY_HOURS) {
      return { ok: false, error: `expiresInHours ต้องเป็นจำนวนเต็ม 1–${MAX_EXPIRY_HOURS} หรือ null` };
    }
    expiresInHours = n;
  }

  const generated = generateEnrollToken();
  const now = Date.now();
  const expiresAt = expiresInHours == null ? null : new Date(now + expiresInHours * 3_600_000);

  if (root) {
    return storeLock(() => {
      const store = readEnrollTokenStore(root);
      const record: FleetEnrollTokenRecord = {
        id: crypto.randomUUID(),
        label,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        createdAt: new Date(now).toISOString(),
        createdBy: actor,
        expiresAt: expiresAt?.toISOString() ?? null,
        maxUses: maxUsesRaw,
        usedCount: 0,
        lastUsedAt: null,
        lastMachineId: null,
        lastMachineName: null,
        revokedAt: null,
      };
      store.tokens.push(record);
      writeStore(store, root);
      return { ok: true, token: generated.token, record: toPublicEnrollToken(record, now) };
    });
  }

  const created = await prisma.fleetEnrollmentToken.create({
    data: {
      label,
      prefix: generated.prefix,
      token_hash: generated.tokenHash,
      created_by: uuidOf(actor),
      expires_at: expiresAt,
      max_uses: maxUsesRaw,
    },
  });
  return { ok: true, token: generated.token, record: toPublicEnrollToken(recordFromDb(created), now) };
}

export type RevokeEnrollTokenResult =
  | { ok: true; record: FleetEnrollTokenPublic }
  | { ok: false; reason: 'not_found' };

/** เพิกถอนรหัส — ทำซ้ำได้ (idempotent) และไม่คืนรหัสจริง */
export async function revokeEnrollToken(
  id: string,
  root?: string,
  reason?: string,
): Promise<RevokeEnrollTokenResult> {
  if (root) {
    return storeLock(() => {
      const store = readEnrollTokenStore(root);
      const record = store.tokens.find((row) => row.id === id);
      if (!record) return { ok: false, reason: 'not_found' as const };
      if (!record.revokedAt) record.revokedAt = new Date().toISOString();
      writeStore(store, root);
      return { ok: true, record: toPublicEnrollToken(record) };
    });
  }

  if (!uuidOf(id)) return { ok: false, reason: 'not_found' };
  const existing = await prisma.fleetEnrollmentToken.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: 'not_found' };
  const row = existing.revoked_at
    ? existing
    : await prisma.fleetEnrollmentToken.update({
        where: { id },
        data: {
          revoked_at: new Date(),
          revoke_reason: sanitizeText(reason, 200) ?? null,
        },
      });
  return { ok: true, record: toPublicEnrollToken(recordFromDb(row)) };
}

/**
 * ผูก machine id จริงเข้ากับรหัสที่เพิ่งใช้ — เรียกหลัง registerMachine สำเร็จ
 * (ตอน consume ยังไม่รู้ id เพราะเครื่องยังไม่ถูกสร้าง)
 */
export async function markEnrollTokenMachine(
  tokenId: string,
  machineId: string,
  machineName: string,
  root?: string,
): Promise<boolean> {
  if (root) {
    return storeLock(() => {
      const store = readEnrollTokenStore(root);
      const record = store.tokens.find((row) => row.id === tokenId);
      if (!record) return false;
      record.lastMachineId = isSafeKey(machineId) ? machineId : null;
      record.lastMachineName = sanitizeText(machineName, MAX_LABEL);
      writeStore(store, root);
      return true;
    });
  }

  if (!uuidOf(tokenId)) return false;
  return prisma.$transaction(async (tx) => {
    const row = await tx.fleetEnrollmentToken.findUnique({ where: { id: tokenId } });
    if (!row) return false;
    await tx.fleetEnrollmentToken.update({
      where: { id: tokenId },
      data: {
        last_machine_id: isSafeKey(machineId) ? machineId : null,
        last_machine_name: sanitizeText(machineName, MAX_LABEL),
      },
    });
    const use = await tx.fleetEnrollmentUse.findFirst({
      where: { token_id: tokenId, released_at: null },
      orderBy: { used_at: 'desc' },
    });
    if (use) {
      await tx.fleetEnrollmentUse.update({
        where: { id: use.id },
        data: {
          machine_id: isSafeKey(machineId) ? machineId : null,
          machine_name: sanitizeText(machineName, MAX_LABEL),
        },
      });
    }
    return true;
  });
}

/**
 * คืนสิทธิ์การใช้รหัส เมื่อ registerMachine ล้มเหลว
 * — ไม่ให้รหัสถูกเผาเปล่าเพราะ DB ล่มชั่วคราว
 */
export async function releaseEnrollTokenUse(tokenId: string, root?: string): Promise<boolean> {
  if (root) {
    return storeLock(() => {
      const store = readEnrollTokenStore(root);
      const record = store.tokens.find((row) => row.id === tokenId);
      if (!record || record.usedCount <= 0) return false;
      record.usedCount -= 1;
      if (record.usedCount === 0) {
        record.lastUsedAt = null;
        record.lastMachineId = null;
        record.lastMachineName = null;
      }
      writeStore(store, root);
      return true;
    });
  }

  if (!uuidOf(tokenId)) return false;
  return prisma.$transaction(async (tx) => {
    const row = await tx.fleetEnrollmentToken.findUnique({ where: { id: tokenId } });
    if (!row || row.used_count <= 0) return false;
    const use = await tx.fleetEnrollmentUse.findFirst({
      where: { token_id: tokenId, released_at: null },
      orderBy: { used_at: 'desc' },
    });
    if (use) {
      await tx.fleetEnrollmentUse.update({ where: { id: use.id }, data: { released_at: new Date() } });
    }
    const remaining = Math.max(0, row.used_count - 1);
    await tx.fleetEnrollmentToken.update({
      where: { id: tokenId },
      data: remaining === 0
        ? { used_count: 0, last_used_at: null, last_machine_id: null, last_machine_name: null }
        : { used_count: remaining },
    });
    return true;
  });
}

/**
 * ใช้รหัสเชิญหนึ่งครั้ง — atomic ภายในโปรเซส
 * คืน reason แบบไม่เปิดเผยข้อมูลอื่น (ผู้เรียกที่มีรหัสผิดเห็นแค่ invalid)
 */
export async function consumeEnrollToken(
  rawToken: string,
  machine: { id?: string | null; name?: string | null },
  root?: string,
): Promise<EnrollTokenConsumeResult> {
  if (!isEnrollTokenFormat(rawToken)) return { ok: false, reason: 'invalid' };
  const hash = hashToken(rawToken);
  const now = Date.now();
  const nowDate = new Date(now);

  if (root) {
    return storeLock(() => {
      const store = readEnrollTokenStore(root);
      const record = store.tokens.find((row) => safeHashEqual(row.tokenHash, hash));
      if (!record) return { ok: false, reason: 'invalid' as const };
      if (record.revokedAt) return { ok: false, reason: 'revoked' as const };
      if (isExpired(record, now)) return { ok: false, reason: 'expired' as const };
      if (record.usedCount >= record.maxUses) return { ok: false, reason: 'exhausted' as const };

      record.usedCount += 1;
      record.lastUsedAt = nowDate.toISOString();
      record.lastMachineId = isSafeKey(machine.id) ? machine.id : null;
      record.lastMachineName = sanitizeText(machine.name, MAX_LABEL);
      writeStore(store, root);
      return {
        ok: true as const,
        tokenId: record.id,
        label: record.label,
        usesRemaining: Math.max(0, record.maxUses - record.usedCount),
      };
    });
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.fleetEnrollmentToken.findUnique({ where: { token_hash: hash } });
    if (!row) return { ok: false, reason: 'invalid' as const };
    if (row.revoked_at) return { ok: false, reason: 'revoked' as const };
    if (row.expires_at && row.expires_at.getTime() <= now) return { ok: false, reason: 'expired' as const };
    if (row.used_count >= row.max_uses) return { ok: false, reason: 'exhausted' as const };

    const updated = await tx.fleetEnrollmentToken.updateMany({
      where: {
        id: row.id,
        used_count: { lt: row.max_uses },
        revoked_at: null,
        OR: [{ expires_at: null }, { expires_at: { gt: nowDate } }],
      },
      data: {
        used_count: { increment: 1 },
        last_used_at: nowDate,
        last_machine_id: isSafeKey(machine.id) ? machine.id : null,
        last_machine_name: sanitizeText(machine.name, MAX_LABEL),
      },
    });
    if (!updated.count) {
      const latest = await tx.fleetEnrollmentToken.findUnique({ where: { id: row.id } });
      if (latest?.revoked_at) return { ok: false, reason: 'revoked' as const };
      if (latest?.expires_at && latest.expires_at.getTime() <= now) return { ok: false, reason: 'expired' as const };
      return { ok: false, reason: 'exhausted' as const };
    }

    await tx.fleetEnrollmentUse.create({
      data: {
        token_id: row.id,
        machine_id: isSafeKey(machine.id) ? machine.id : null,
        machine_name: sanitizeText(machine.name, MAX_LABEL),
      },
    });
    return {
      ok: true as const,
      tokenId: row.id,
      label: row.label,
      usesRemaining: Math.max(0, row.max_uses - (row.used_count + 1)),
    };
  });
}
