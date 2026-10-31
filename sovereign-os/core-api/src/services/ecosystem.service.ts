// src/services/ecosystem.service.ts
//
// ── Ecosystem ส่วนตัวของผู้ใช้ ────────────────────────────────────────────────
// เจ้าของ (31/10/69): platform ของตัวเองกระจัดกระจาย — Fiverr · Fastwork · YouTube ·
// Gmail · Facebook · LinkedIn · เว็บไซต์ ฯลฯ — จนพลาดคอมเมนต์/ข้อความลูกค้า
// ⇒ รวม "บัญชีทั้งหมด" ไว้ที่เดียว พร้อมปุ่มเปิดเว็บและที่เก็บรหัสผ่านที่เข้ารหัสจริง
//
// ความปลอดภัย (ห้ามลด):
//   1) password เก็บเป็น enc:v1:... (AES-256-GCM, random IV + auth tag) — ไม่มี plaintext ใน DB
//   2) list/สรุป **ไม่คืนรหัสผ่าน** เด็ดขาด — ต้องเรียก reveal (มี audit log) เท่านั้น
//   3) ทุก query ผูก user_id — บัญชีของคนอื่นตอบ 404 (ไม่บอกว่ามีอยู่)
//   4) URL ที่จะเปิดได้ต้องเป็น http/https เท่านั้น (กัน javascript:/file:/data:)
import { prisma } from '../lib/prisma';
import { encryptField, decryptField } from './field-crypto.service';
import { AuditService } from './audit.service';

export interface EcosystemPlatform {
  id: string;
  name: string;
  category: string;
  /** หน้าเข้าใช้งานเริ่มต้น (ผู้ใช้แก้เป็น URL จริงของตัวเองได้) */
  url: string;
  /** สีแบรนด์ ใช้ทำแถบสี/ป้ายบนการ์ด */
  color: string;
  /** คำใบ้ว่าปกติใช้บัญชีอะไรล็อกอิน */
  hint: string;
}

/**
 * แคตตาล็อก platform ที่เจ้าของใช้จริง + ที่มีโอกาสใช้
 * เพิ่มที่นี่ที่เดียว → หน้าเว็บเห็นทันที (ไม่ต้อง migrate)
 */
export const ECOSYSTEM_PLATFORMS: EcosystemPlatform[] = [
  { id: 'fiverr', name: 'Fiverr', category: 'freelance', url: 'https://www.fiverr.com/', color: '#1dbf73', hint: 'อีเมลหรือ username' },
  { id: 'fastwork', name: 'Fastwork', category: 'freelance', url: 'https://fastwork.co/', color: '#00b14f', hint: 'อีเมลหรือเบอร์โทร' },
  { id: 'upwork', name: 'Upwork', category: 'freelance', url: 'https://www.upwork.com/', color: '#14a800', hint: 'อีเมล' },
  { id: 'youtube', name: 'YouTube Studio', category: 'video', url: 'https://studio.youtube.com/', color: '#ff0000', hint: 'บัญชี Google' },
  { id: 'gmail', name: 'Gmail', category: 'email', url: 'https://mail.google.com/', color: '#ea4335', hint: 'อีเมล @gmail.com' },
  { id: 'facebook', name: 'Facebook', category: 'social', url: 'https://www.facebook.com/', color: '#1877f2', hint: 'อีเมลหรือเบอร์โทร' },
  { id: 'instagram', name: 'Instagram', category: 'social', url: 'https://www.instagram.com/', color: '#e1306c', hint: 'username หรืออีเมล' },
  { id: 'tiktok', name: 'TikTok', category: 'social', url: 'https://www.tiktok.com/', color: '#00f2ea', hint: 'อีเมลหรือเบอร์โทร' },
  { id: 'x', name: 'X (Twitter)', category: 'social', url: 'https://x.com/', color: '#e7e9ea', hint: 'username หรืออีเมล' },
  { id: 'linkedin', name: 'LinkedIn', category: 'social', url: 'https://www.linkedin.com/', color: '#0a66c2', hint: 'อีเมล' },
  { id: 'github', name: 'GitHub', category: 'dev', url: 'https://github.com/', color: '#8b949e', hint: 'username หรืออีเมล' },
  { id: 'stripe', name: 'Stripe', category: 'payments', url: 'https://dashboard.stripe.com/', color: '#635bff', hint: 'อีเมล' },
  { id: 'lemonsqueezy', name: 'Lemon Squeezy', category: 'payments', url: 'https://app.lemonsqueezy.com/', color: '#ffc233', hint: 'อีเมล' },
  { id: 'telegram', name: 'Telegram', category: 'chat', url: 'https://web.telegram.org/', color: '#26a5e4', hint: 'เบอร์โทร' },
  { id: 'line', name: 'LINE', category: 'chat', url: 'https://manager.line.biz/', color: '#06c755', hint: 'อีเมลหรือเบอร์โทร' },
  { id: 'shopee', name: 'Shopee', category: 'commerce', url: 'https://seller.shopee.co.th/', color: '#ee4d2d', hint: 'username หรือเบอร์โทร' },
  { id: 'lazada', name: 'Lazada', category: 'commerce', url: 'https://sellercenter.lazada.co.th/', color: '#0f156d', hint: 'อีเมลหรือเบอร์โทร' },
  { id: 'etsy', name: 'Etsy', category: 'commerce', url: 'https://www.etsy.com/', color: '#f1641e', hint: 'อีเมล' },
  { id: 'website', name: 'เว็บไซต์ของฉัน', category: 'website', url: '', color: '#38bdf8', hint: 'แอดมิน/อีเมล' },
  { id: 'custom', name: 'อื่น ๆ', category: 'custom', url: '', color: '#a78bfa', hint: 'อะไรก็ได้ที่ใช้ล็อกอิน' },
];

const PLATFORM_BY_ID = new Map(ECOSYSTEM_PLATFORMS.map((p) => [p.id, p]));

export const ECOSYSTEM_CATEGORIES = [
  { id: 'freelance', name: 'รับงานฟรีแลนซ์' },
  { id: 'video', name: 'วิดีโอ/คอนเทนต์' },
  { id: 'email', name: 'อีเมล' },
  { id: 'social', name: 'โซเชียล' },
  { id: 'dev', name: 'โค้ด/นักพัฒนา' },
  { id: 'payments', name: 'รับเงิน' },
  { id: 'chat', name: 'แชท' },
  { id: 'commerce', name: 'ร้านค้า' },
  { id: 'website', name: 'เว็บไซต์' },
  { id: 'custom', name: 'อื่น ๆ' },
];

export const ECOSYSTEM_STATUSES = ['active', 'paused', 'archived'] as const;

/** ข้อผิดพลาดที่มี HTTP status ตรงกับสาเหตุ — route แปลงเป็น response ตรง ๆ */
export class EcosystemError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'EcosystemError';
    this.status = status;
    this.code = code;
  }
}

const LIMITS = { label: 80, url: 500, loginId: 200, password: 500, notes: 2000 };

/** URL ที่เปิดได้ต้องเป็น http/https เท่านั้น (กัน javascript:/file:/data:) */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw ?? '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown, max: number, field: string): string | null {
  const v = text(value);
  if (!v) return null;
  if (v.length > max) {
    throw new EcosystemError(400, 'FIELD_TOO_LONG', `${field} ยาวเกิน ${max} ตัวอักษร`);
  }
  return v;
}

function normalizePlatform(value: unknown): string {
  const id = text(value) || 'custom';
  if (!PLATFORM_BY_ID.has(id)) {
    throw new EcosystemError(400, 'UNKNOWN_PLATFORM', `ไม่รู้จัก platform "${id}"`);
  }
  return id;
}

function normalizeStatus(value: unknown, fallback = 'active'): string {
  const v = text(value) || fallback;
  if (!(ECOSYSTEM_STATUSES as readonly string[]).includes(v)) {
    throw new EcosystemError(400, 'BAD_STATUS', `สถานะ "${v}" ไม่ถูกต้อง`);
  }
  return v;
}

export interface EcosystemAccountDto {
  id: string;
  platform: string;
  platformName: string;
  category: string;
  label: string;
  url: string | null;
  loginId: string;
  hasPassword: boolean;
  notes: string;
  status: string;
  lastUsedAt: string | null;
  passwordUpdatedAt: string | null;
  passwordAgeDays: number | null;
  /** บัญชี Gmail หลักที่บัญชีนี้ผูกอยู่ (null = ยังไม่ผูก) */
  primaryAccountId: string | null;
  /** จำนวนบัญชีที่ใช้ Gmail ใบนี้เป็นหลัก */
  linkedCount: number;
  createdAt: string;
  updatedAt: string;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ageDays(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/** แปลงแถว DB → DTO ที่ปลอดภัย (ไม่รวม password_enc เด็ดขาด) */
export function toAccountDto(row: any, linkedCount = 0): EcosystemAccountDto {
  const platform = PLATFORM_BY_ID.get(String(row.platform));
  return {
    id: String(row.id),
    primaryAccountId: row.primary_account_id ? String(row.primary_account_id) : null,
    linkedCount,
    platform: String(row.platform ?? 'custom'),
    platformName: platform?.name ?? String(row.platform ?? 'อื่น ๆ'),
    category: String(row.category || platform?.category || 'custom'),
    label: String(row.label ?? ''),
    url: row.url ? String(row.url) : null,
    loginId: decryptField(row.login_id),
    hasPassword: Boolean(row.password_enc),
    notes: String(row.notes ?? ''),
    status: String(row.status ?? 'active'),
    lastUsedAt: iso(row.last_used_at),
    passwordUpdatedAt: iso(row.password_updated_at),
    passwordAgeDays: ageDays(row.password_updated_at),
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  };
}

export interface EcosystemSummary {
  total: number;
  active: number;
  withPassword: number;
  missingPassword: number;
  platforms: number;
  /** รหัสผ่านที่ไม่ได้เปลี่ยนเกิน 180 วัน — ควรเปลี่ยน */
  stalePasswords: number;
  /** บัญชีที่ผูกกับ Gmail หลักแล้ว / ยังไม่ผูก */
  linked: number;
  unlinked: number;
  byPlatform: Record<string, number>;
}

export function summarizeAccounts(accounts: EcosystemAccountDto[]): EcosystemSummary {
  const byPlatform: Record<string, number> = {};
  let active = 0;
  let withPassword = 0;
  let stalePasswords = 0;
  let linked = 0;
  for (const a of accounts) {
    byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1;
    if (a.status === 'active') active += 1;
    if (a.hasPassword) withPassword += 1;
    if (a.hasPassword && a.passwordAgeDays !== null && a.passwordAgeDays > 180) stalePasswords += 1;
    if (a.primaryAccountId) linked += 1;
  }
  return {
    total: accounts.length,
    active,
    withPassword,
    missingPassword: accounts.length - withPassword,
    platforms: Object.keys(byPlatform).length,
    stalePasswords,
    linked,
    unlinked: accounts.length - linked,
    byPlatform,
  };
}

export function getEcosystemCatalog() {
  return {
    platforms: ECOSYSTEM_PLATFORMS,
    categories: ECOSYSTEM_CATEGORIES,
    statuses: [...ECOSYSTEM_STATUSES],
    /** platform ที่ทำหน้าที่เป็นบัญชีหลักของ Ecosystem */
    primaryPlatform: PRIMARY_PLATFORM,
  };
}

/** รายการบัญชีของผู้ใช้คนนี้ — เรียงตามการใช้งานล่าสุด แล้วค่อยชื่อ */
export async function listAccounts(userId: string): Promise<{
  accounts: EcosystemAccountDto[];
  summary: EcosystemSummary;
}> {
  const rows = await prisma.userEcosystemAccount.findMany({
    where: { user_id: userId },
    orderBy: [{ last_used_at: 'desc' }, { updated_at: 'desc' }],
  });
  // นับบัญชีลูกต่อบัญชีหลัก — การ์ด Gmail ต้องแสดงจำนวน platform ที่ใช้บัญชีนี้
  const counts = new Map<string, number>();
  for (const row of rows) {
    const parent = (row as any).primary_account_id;
    if (parent) counts.set(String(parent), (counts.get(String(parent)) ?? 0) + 1);
  }
  const accounts = rows.map((row) => toAccountDto(row, counts.get(String(row.id)) ?? 0));
  return { accounts, summary: summarizeAccounts(accounts) };
}

function readCreateInput(body: any) {
  const label = text(body?.label);
  if (!label) throw new EcosystemError(400, 'LABEL_REQUIRED', 'ต้องใส่ชื่อบัญชี');
  if (label.length > LIMITS.label) {
    throw new EcosystemError(400, 'FIELD_TOO_LONG', `ชื่อบัญชียาวเกิน ${LIMITS.label} ตัวอักษร`);
  }

  const url = optionalText(body?.url, LIMITS.url, 'URL');
  if (url && !isSafeExternalUrl(url)) {
    throw new EcosystemError(400, 'BAD_URL', 'URL ต้องขึ้นต้นด้วย http:// หรือ https://');
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length > LIMITS.password) {
    throw new EcosystemError(400, 'FIELD_TOO_LONG', `รหัสผ่านยาวเกิน ${LIMITS.password} ตัวอักษร`);
  }

  const platform = normalizePlatform(body?.platform);
  const category = text(body?.category) || PLATFORM_BY_ID.get(platform)?.category || 'custom';

  return {
    platform,
    label,
    url,
    loginId: optionalText(body?.loginId, LIMITS.loginId, 'ชื่อผู้ใช้/อีเมล'),
    password,
    notes: optionalText(body?.notes, LIMITS.notes, 'บันทึก'),
    category,
    status: normalizeStatus(body?.status),
  };
}

// ── บัญชีหลัก = Gmail (31/10/69) ────────────────────────────────────────────
// เจ้าของ: บาง platform สมัครด้วย gmail — อยากให้ gmail เป็นหลักของ Ecosystem
// กติกา (บังคับทุกข้อ — UI ไม่ใช่ด่าน):
//   · เป้าหมายต้องเป็นแถว platform gmail ของผู้ใช้คนเดียวกัน
//   · ผูกได้ชั้นเดียว: Gmail ที่ถูกผูกเป็นลูกแล้วเป็นหลักให้ใครไม่ได้
//   · บัญชีที่เป็นหลักของคนอื่นอยู่ จะถูกนำไปผูกเป็นลูกไม่ได้ (กันวงกลม/สองชั้น)
//   · ห้ามผูกกับตัวเอง
const PRIMARY_PLATFORM = 'gmail';

function normalizeLogin(value: string): string {
  return text(value).toLowerCase();
}

function isPrimaryPlatform(platform: string): boolean {
  return platform === PRIMARY_PLATFORM;
}

/** หา Gmail ที่ยังว่าง (ไม่ถูกผูก) และอีเมลตรงกับที่ให้มา */
async function findMatchingGmail(
  userId: string,
  loginId: string,
  excludeId?: string | null,
): Promise<{ id: string; label: string } | null> {
  const email = normalizeLogin(loginId);
  if (!email || !email.includes('@')) return null;
  const rows = await prisma.userEcosystemAccount.findMany({ where: { user_id: userId } });
  for (const row of rows) {
    if (String(row.platform) !== PRIMARY_PLATFORM) continue;
    if ((row as any).primary_account_id) continue;
    if (excludeId && String(row.id) === excludeId) continue;
    if (normalizeLogin(decryptField(row.login_id)) === email) {
      return { id: String(row.id), label: String(row.label ?? '') };
    }
  }
  return null;
}

async function assertPrimary(userId: string, primaryId: string, selfId?: string | null): Promise<string> {
  if (selfId && primaryId === selfId) {
    throw new EcosystemError(400, 'SELF_LINK', 'ผูกบัญชีเข้ากับตัวเองไม่ได้');
  }
  const rows = await prisma.userEcosystemAccount.findMany({ where: { user_id: userId } });
  const target = rows.find((row) => String(row.id) === primaryId);
  if (!target) throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบบัญชีหลักนี้');
  if (String(target.platform) !== PRIMARY_PLATFORM) {
    throw new EcosystemError(400, 'PRIMARY_MUST_BE_GMAIL', 'บัญชีหลักต้องเป็น Gmail');
  }
  if ((target as any).primary_account_id) {
    throw new EcosystemError(400, 'PRIMARY_ALREADY_LINKED', 'Gmail นี้ถูกผูกเป็นลูกของบัญชีอื่นอยู่ — ต้องถอดก่อน');
  }
  if (selfId) {
    const hasChildren = rows.some((row) => String((row as any).primary_account_id ?? '') === selfId);
    if (hasChildren) {
      throw new EcosystemError(400, 'HAS_LINKED_ACCOUNTS', 'บัญชีนี้เป็นหลักของบัญชีอื่นอยู่ — ถอด/ย้ายบัญชีลูกก่อน');
    }
  }
  return String(target.id);
}

/** undefined = ให้ระบบจับคู่อัตโนมัติ · '' = ตั้งใจไม่ผูก · มีค่า = ผูกตามที่เลือก */
async function resolvePrimaryOnCreate(
  userId: string,
  body: any,
  platform: string,
  loginId: string | null,
): Promise<string | null> {
  if (isPrimaryPlatform(platform)) return null;
  if (body?.primaryAccountId !== undefined) {
    const explicit = text(body.primaryAccountId);
    return explicit ? await assertPrimary(userId, explicit) : null;
  }
  if (!loginId) return null;
  const match = await findMatchingGmail(userId, loginId);
  return match ? match.id : null;
}

export async function createAccount(userId: string, body: any): Promise<EcosystemAccountDto> {
  const input = readCreateInput(body);
  const primaryAccountId = await resolvePrimaryOnCreate(userId, body, input.platform, input.loginId);
  const now = new Date();
  const row = await prisma.userEcosystemAccount.create({
    data: {
      user_id: userId,
      platform: input.platform,
      label: input.label,
      url: input.url,
      login_id: input.loginId ? encryptField(input.loginId) : null,
      password_enc: input.password ? encryptField(input.password) : null,
      password_updated_at: input.password ? now : null,
      notes: input.notes,
      category: input.category,
      status: input.status,
      primary_account_id: primaryAccountId,
    },
  });

  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_ACCOUNT_CREATED',
    payload: { accountId: row.id, platform: input.platform, label: input.label, primaryAccountId },
  });

  return toAccountDto(row);
}

/** หาแถวที่เป็นของ userId เท่านั้น — ไม่เจอ/ของคนอื่น = 404 เหมือนกัน */
async function findOwned(userId: string, id: string) {
  if (!id) throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบบัญชีนี้');
  const row = await prisma.userEcosystemAccount.findFirst({ where: { id, user_id: userId } });
  if (!row) throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบบัญชีนี้');
  return row;
}

export async function updateAccount(userId: string, id: string, body: any): Promise<EcosystemAccountDto> {
  const existing = await findOwned(userId, id);
  const data: Record<string, unknown> = {};

  if (body?.label !== undefined) {
    const label = text(body.label);
    if (!label) throw new EcosystemError(400, 'LABEL_REQUIRED', 'ต้องใส่ชื่อบัญชี');
    if (label.length > LIMITS.label) {
      throw new EcosystemError(400, 'FIELD_TOO_LONG', `ชื่อบัญชียาวเกิน ${LIMITS.label} ตัวอักษร`);
    }
    data.label = label;
  }

  if (body?.platform !== undefined) data.platform = normalizePlatform(body.platform);

  if (body?.url !== undefined) {
    const url = optionalText(body.url, LIMITS.url, 'URL');
    if (url && !isSafeExternalUrl(url)) {
      throw new EcosystemError(400, 'BAD_URL', 'URL ต้องขึ้นต้นด้วย http:// หรือ https://');
    }
    data.url = url;
  }

  if (body?.loginId !== undefined) {
    const loginId = optionalText(body.loginId, LIMITS.loginId, 'ชื่อผู้ใช้/อีเมล');
    data.login_id = loginId ? encryptField(loginId) : null;
  }

  if (body?.notes !== undefined) data.notes = optionalText(body.notes, LIMITS.notes, 'บันทึก');
  if (body?.category !== undefined) data.category = text(body.category) || null;
  if (body?.status !== undefined) data.status = normalizeStatus(body.status);

  // รหัสผ่าน: ไม่ส่งมา = คงเดิม · ส่ง '' = คงเดิม (ฟอร์มแก้ไขไม่โชว์รหัส) · ส่งค่าจริง = เปลี่ยน
  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length > LIMITS.password) {
      throw new EcosystemError(400, 'FIELD_TOO_LONG', `รหัสผ่านยาวเกิน ${LIMITS.password} ตัวอักษร`);
    }
    data.password_enc = encryptField(body.password);
    data.password_updated_at = new Date();
  }
  if (body?.removePassword === true) {
    data.password_enc = null;
    data.password_updated_at = null;
  }

  // ── บัญชีหลัก: primaryAccountId=''/null = ถอดการผูก · ไม่ส่ง = คงเดิมหรือจับคู่อัตโนมัติ ──
  const platformAfter = String(data.platform ?? existing.platform);
  if (body?.primaryAccountId !== undefined) {
    const explicit = text(body.primaryAccountId);
    data.primary_account_id = explicit ? await assertPrimary(userId, explicit, String(existing.id)) : null;
  } else if (isPrimaryPlatform(platformAfter)) {
    // Gmail ต้องเป็นศูนย์กลางเสมอ — เป็นลูกของใครไม่ได้
    if ((existing as any).primary_account_id) data.primary_account_id = null;
  } else if (!(existing as any).primary_account_id && (body?.loginId !== undefined || body?.platform !== undefined)) {
    // จับคู่ใหม่เฉพาะเมื่อ "อีเมล/platform เปลี่ยน" — แก้ฟิลด์อื่นต้องไม่ผูกกลับให้เอง (ผู้ใช้อาจตั้งใจถอด)
    const loginAfter =
      data.login_id !== undefined
        ? data.login_id === null
          ? ''
          : decryptField(String(data.login_id))
        : decryptField(existing.login_id);
    const match = await findMatchingGmail(userId, String(loginAfter ?? ''), String(existing.id));
    if (match) data.primary_account_id = match.id;
  }

  if (Object.keys(data).length === 0) {
    const rows = await prisma.userEcosystemAccount.findMany({ where: { user_id: userId } });
    const linkedCount = rows.filter(
      (row) => String((row as any).primary_account_id ?? '') === String(existing.id),
    ).length;
    return toAccountDto(existing, linkedCount);
  }

  const row = await prisma.userEcosystemAccount.update({ where: { id: existing.id }, data });

  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_ACCOUNT_UPDATED',
    payload: { accountId: existing.id, fields: Object.keys(data) },
  });

  return toAccountDto(row);
}

export async function deleteAccount(userId: string, id: string): Promise<void> {
  const existing = await findOwned(userId, id);
  await prisma.userEcosystemAccount.delete({ where: { id: existing.id } });
  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_ACCOUNT_DELETED',
    payload: { accountId: existing.id, platform: existing.platform, label: existing.label },
  });
}

/** คืนรหัสผ่านจริง — ทางเดียวที่รหัสจะออกจาก DB · ทุกครั้งถูกบันทึก audit */
export async function revealPassword(userId: string, id: string): Promise<string> {
  const row = await findOwned(userId, id);
  if (!row.password_enc) {
    throw new EcosystemError(409, 'PASSWORD_NOT_SET', 'บัญชีนี้ยังไม่ได้บันทึกรหัสผ่าน');
  }
  const password = decryptField(row.password_enc);
  if (!password) {
    throw new EcosystemError(409, 'PASSWORD_UNREADABLE', 'ถอดรหัสไม่ได้ (key เปลี่ยน) — กรุณาตั้งรหัสใหม่');
  }
  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_PASSWORD_REVEALED',
    payload: { accountId: row.id, platform: row.platform, label: row.label },
  });
  return password;
}

/**
 * ผูกบัญชีที่ยังไม่ผูกทั้งหมดให้อัตโนมัติ (ใช้ครั้งเดียวกับบัญชีที่เพิ่มไว้ก่อนมีฟีเจอร์นี้)
 * เงื่อนไขเดียวกับตอนสร้าง: อีเมลที่ใช้สมัครตรงกับ Gmail ที่มีอยู่และยังว่าง
 */
export async function autoLinkAccounts(userId: string): Promise<{ linked: number; checked: number }> {
  const rows = await prisma.userEcosystemAccount.findMany({ where: { user_id: userId } });
  let linked = 0;
  let checked = 0;
  for (const row of rows) {
    if (String(row.platform) === PRIMARY_PLATFORM) continue;
    if ((row as any).primary_account_id) continue;
    checked += 1;
    const match = await findMatchingGmail(userId, decryptField(row.login_id), String(row.id));
    if (!match) continue;
    await prisma.userEcosystemAccount.update({
      where: { id: String(row.id) },
      data: { primary_account_id: match.id },
    });
    linked += 1;
  }
  if (linked > 0) {
    await AuditService.logAction({
      userId,
      actionType: 'ECOSYSTEM_AUTO_LINKED',
      payload: { linked, checked },
    });
  }
  return { linked, checked };
}

/** กด "เปิดเว็บ" — ตรวจ URL แล้วบันทึกว่าเพิ่งใช้ (ใช้จัดลำดับการ์ด) */
export async function openAccount(userId: string, id: string): Promise<{ url: string }> {
  const row = await findOwned(userId, id);
  const url = String(row.url ?? '').trim();
  if (!url) throw new EcosystemError(400, 'URL_REQUIRED', 'บัญชีนี้ยังไม่ได้ใส่ URL');
  if (!isSafeExternalUrl(url)) {
    throw new EcosystemError(400, 'BAD_URL', 'URL ต้องขึ้นต้นด้วย http:// หรือ https://');
  }
  await prisma.userEcosystemAccount.update({
    where: { id: row.id },
    data: { last_used_at: new Date() },
  });
  return { url };
}
