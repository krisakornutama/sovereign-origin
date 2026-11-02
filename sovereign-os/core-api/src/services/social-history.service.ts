// src/services/social-history.service.ts
//
// ── ประวัติการโพสต์ของ Social Studio ────────────────────────────────────────
// ทำไมต้องมี:
//   สตูดิโอเดิมคัดลอกข้อความ/เปิดหน้าเว็บแล้วจบ — ไม่มีอะไรจำว่าแพลตฟอร์มไหน
//   "โพสต์แล้ว" ⇒ ปิดแอปแล้วลืม, โพสต์ซ้ำ, หรืออัปโหลด YouTube ซ้ำ (กินโควตา)
//
// กติกา:
//   · ทุก query ผูก user_id — ของคนอื่น = 404 (ไม่ยืนยันว่ามีอยู่)
//   · เก็บเฉพาะเนื้อหาที่ผู้ใช้เห็นอยู่แล้ว — ห้ามเก็บรหัสผ่าน/secret
//   · URL ปลายทางเป็น http/https เท่านั้น
//   · ตาราง social_posts / social_post_targets เป็นของโมดูล ecosystem
import { prisma } from '../lib/prisma';
import { AuditService } from './audit.service';
import { EcosystemError, isSafeExternalUrl } from './ecosystem.service';

export const SOCIAL_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialPostKind = 'text' | 'clip';
export type SocialTargetStatus = 'pending' | 'posted' | 'skipped';

const KINDS: readonly SocialPostKind[] = ['text', 'clip'];
const STATUSES: readonly SocialTargetStatus[] = ['pending', 'posted', 'skipped'];
const LIMITS = {
  title: 200,
  body: 100_000, // เผื่อข้อความ Facebook 63,206 + คำอธิบายคลิป
  link: 500,
  videoName: 255,
  videoSize: 20,
  externalUrl: 500,
  externalId: 200,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SocialPostTargetDto {
  platform: SocialPlatform;
  accountId: string | null;
  status: SocialTargetStatus;
  externalUrl: string | null;
  externalId: string | null;
  postedAt: string | null;
}

export interface SocialPostDto {
  id: string;
  kind: SocialPostKind;
  title: string;
  body: string;
  link: string | null;
  videoName: string | null;
  videoSize: string | null;
  createdAt: string;
  updatedAt: string;
  targets: SocialPostTargetDto[];
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

function normalizeKind(value: unknown): SocialPostKind {
  const v = text(value) || 'text';
  if (!(KINDS as readonly string[]).includes(v)) {
    throw new EcosystemError(400, 'BAD_KIND', `ชนิดโพสต์ "${v}" ไม่ถูกต้อง`);
  }
  return v as SocialPostKind;
}

function normalizeStatus(value: unknown): SocialTargetStatus {
  const v = text(value);
  if (!(STATUSES as readonly string[]).includes(v)) {
    throw new EcosystemError(400, 'BAD_STATUS', `สถานะ "${v}" ไม่ถูกต้อง`);
  }
  return v as SocialTargetStatus;
}

function normalizePlatform(value: unknown): SocialPlatform {
  const v = text(value);
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(v)) {
    throw new EcosystemError(400, 'BAD_PLATFORM', `ไม่รู้จักแพลตฟอร์ม "${v}"`);
  }
  return v as SocialPlatform;
}

function normalizeVideoSize(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : text(value);
  if (!/^\d{1,20}$/.test(raw)) {
    throw new EcosystemError(400, 'BAD_VIDEO_SIZE', 'ขนาดไฟล์วิดีโอไม่ถูกต้อง');
  }
  return raw;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sortTargets<T extends { platform: string }>(targets: T[]): T[] {
  const order = new Map<string, number>(SOCIAL_PLATFORMS.map((p, i) => [p, i]));
  return [...targets].sort((a, b) => (order.get(a.platform) ?? 99) - (order.get(b.platform) ?? 99));
}

/** แปลงแถว DB → DTO — ไม่มีฟิลด์ลับใด ๆ หลุดออกไป */
export function toSocialPostDto(row: any): SocialPostDto {
  return {
    id: String(row.id),
    kind: normalizeKind(row.kind),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    link: row.link ? String(row.link) : null,
    videoName: row.video_name ? String(row.video_name) : null,
    videoSize: row.video_size ? String(row.video_size) : null,
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    targets: sortTargets(Array.isArray(row.targets) ? row.targets : []).map((t: any) => ({
      platform: String(t.platform) as SocialPlatform,
      accountId: t.account_id ? String(t.account_id) : null,
      status: String(t.status ?? 'pending') as SocialTargetStatus,
      externalUrl: t.external_url ? String(t.external_url) : null,
      externalId: t.external_id ? String(t.external_id) : null,
      postedAt: iso(t.posted_at),
    })),
  };
}

interface TargetInput {
  platform: SocialPlatform;
  accountId: string | null;
}

function readTargets(value: unknown): TargetInput[] {
  if (!Array.isArray(value)) {
    throw new EcosystemError(400, 'TARGETS_REQUIRED', 'ต้องเลือกอย่างน้อยหนึ่งแพลตฟอร์ม');
  }
  const seen = new Set<string>();
  const out: TargetInput[] = [];
  for (const raw of value) {
    const platform = normalizePlatform((raw as any)?.platform);
    if (seen.has(platform)) continue; // ติ๊กซ้ำ = เก็บอันแรก
    seen.add(platform);
    const accountId = text((raw as any)?.accountId) || null;
    if (accountId && !UUID_RE.test(accountId)) {
      throw new EcosystemError(400, 'BAD_ACCOUNT', 'รหัสบัญชีปลายทางไม่ถูกต้อง');
    }
    out.push({ platform, accountId });
  }
  if (out.length === 0) {
    throw new EcosystemError(400, 'TARGETS_REQUIRED', 'ต้องเลือกอย่างน้อยหนึ่งแพลตฟอร์ม');
  }
  return out;
}

/**
 * ตรวจว่าบัญชีปลายทางเป็นของผู้ใช้คนนี้จริงและ platform ตรงกัน
 * — กันการอ้าง id ของบัญชีคนอื่น (แม้ไม่คืนข้อมูลก็ไม่ควรบันทึกได้)
 */
async function assertAccountsBelong(userId: string, targets: TargetInput[]): Promise<void> {
  const wanted = targets.filter((t) => t.accountId);
  if (wanted.length === 0) return;
  const rows = await prisma.userEcosystemAccount.findMany({ where: { user_id: userId } });
  const byId = new Map<string, string>(rows.map((r: any) => [String(r.id), String(r.platform)]));
  for (const t of wanted) {
    const platform = byId.get(String(t.accountId));
    if (!platform || platform !== t.platform) {
      throw new EcosystemError(400, 'BAD_ACCOUNT', 'บัญชีปลายทางไม่ใช่ของผู้ใช้หรือไม่ตรงกับแพลตฟอร์ม');
    }
  }
}

export async function createSocialPost(userId: string, body: any): Promise<SocialPostDto> {
  const kind = normalizeKind(body?.kind);
  const title = optionalText(body?.title, LIMITS.title, 'ชื่อโพสต์') ?? '';
  const content = text(body?.body);
  if (content.length > LIMITS.body) {
    throw new EcosystemError(400, 'FIELD_TOO_LONG', `เนื้อหายาวเกิน ${LIMITS.body} ตัวอักษร`);
  }
  const link = optionalText(body?.link, LIMITS.link, 'ลิงก์');
  if (link && !isSafeExternalUrl(link)) {
    throw new EcosystemError(400, 'BAD_URL', 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
  }
  const videoName = optionalText(body?.videoName, LIMITS.videoName, 'ชื่อไฟล์วิดีโอ');
  const videoSize = normalizeVideoSize(body?.videoSize);
  const targets = readTargets(body?.targets);
  await assertAccountsBelong(userId, targets);

  const row = await prisma.socialPost.create({
    data: {
      user_id: userId,
      kind,
      title,
      body: content,
      link,
      video_name: videoName,
      video_size: videoSize,
      targets: {
        create: targets.map((t) => ({ platform: t.platform, account_id: t.accountId })),
      },
    },
    include: { targets: true },
  });

  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_SOCIAL_POST_CREATED',
    payload: { postId: row.id, kind, platforms: targets.map((t) => t.platform) },
  });

  return toSocialPostDto(row);
}

export async function listSocialPosts(userId: string, limit = 20): Promise<SocialPostDto[]> {
  const take = Math.max(1, Math.min(50, Math.round(Number(limit) || 20)));
  const rows = await prisma.socialPost.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take,
    include: { targets: true },
  });
  return rows.map(toSocialPostDto);
}

async function findOwnedPost(userId: string, postId: string) {
  // id ผิดรูปแบบต้องตอบ 404 เหมือน "ไม่มีอยู่" — ไม่ปล่อยให้ Prisma โยน P2023 เป็น 500
  if (!UUID_RE.test(String(postId ?? ''))) {
    throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบโพสต์นี้');
  }
  const row = await prisma.socialPost.findFirst({
    where: { id: postId, user_id: userId },
    include: { targets: true },
  });
  if (!row) throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบโพสต์นี้');
  return row;
}

export async function updateSocialPostTarget(
  userId: string,
  postId: string,
  platformRaw: string,
  body: any,
): Promise<SocialPostDto> {
  const platform = normalizePlatform(platformRaw);
  const status = normalizeStatus(body?.status);
  const existing = await findOwnedPost(userId, postId);
  const targets = Array.isArray((existing as any).targets) ? (existing as any).targets : [];
  if (!targets.some((t: any) => String(t.platform) === platform)) {
    throw new EcosystemError(404, 'TARGET_NOT_FOUND', 'ไม่พบปลายทางนี้ในโพสต์');
  }

  const externalUrl = optionalText(body?.externalUrl, LIMITS.externalUrl, 'ลิงก์ปลายทาง');
  if (externalUrl && !isSafeExternalUrl(externalUrl)) {
    throw new EcosystemError(400, 'BAD_URL', 'ลิงก์ปลายทางต้องขึ้นต้นด้วย http:// หรือ https://');
  }
  const externalId = optionalText(body?.externalId, LIMITS.externalId, 'รหัสโพสต์ปลายทาง');

  const data: Record<string, unknown> = {
    status,
    // เปลี่ยนสถานะกลับ = ต้องไม่ค้างเวลาที่เคยโพสต์ไว้
    posted_at: status === 'posted' ? new Date() : null,
  };
  if (externalUrl !== null) data.external_url = externalUrl;
  if (externalId !== null) data.external_id = externalId;

  const result = await prisma.socialPostTarget.updateMany({
    where: { post_id: String((existing as any).id), platform },
    data,
  });
  if (!result || result.count === 0) {
    throw new EcosystemError(404, 'TARGET_NOT_FOUND', 'ไม่พบปลายทางนี้ในโพสต์');
  }

  if (status === 'posted') {
    await AuditService.logAction({
      userId,
      actionType: 'ECOSYSTEM_SOCIAL_TARGET_POSTED',
      payload: { postId: String((existing as any).id), platform, externalId },
    });
  }

  const updated = await prisma.socialPost.findFirst({
    where: { id: postId, user_id: userId },
    include: { targets: true },
  });
  if (!updated) throw new EcosystemError(404, 'NOT_FOUND', 'ไม่พบโพสต์นี้');
  return toSocialPostDto(updated);
}

export async function deleteSocialPost(userId: string, postId: string): Promise<void> {
  const existing = await findOwnedPost(userId, postId);
  await prisma.socialPost.delete({ where: { id: String((existing as any).id) } });
  await AuditService.logAction({
    userId,
    actionType: 'ECOSYSTEM_SOCIAL_POST_DELETED',
    payload: { postId: String((existing as any).id), kind: String((existing as any).kind) },
  });
}
