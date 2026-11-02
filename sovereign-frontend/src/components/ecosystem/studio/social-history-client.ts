// components/ecosystem/studio/social-history-client.ts
// ────────────────────────────────────────────────────────────────────────────
// ลูกค้า API ของ "ประวัติการโพสต์" — คุยกับ /api/ecosystem/social/posts
//
// ทำไมแยกไฟล์: หน้าจอไม่ควรรู้รายละเอียด HTTP และเส้นนี้ต้องถูกเรียกจาก
// ทั้ง TextStudio (บันทึกโพสต์ข้อความ) และ ClipStudio (บันทึกงานลงคลิป)
//
// ⚠ ห้ามส่งรหัสผ่าน/secret ใน payload — ประวัติเก็บเฉพาะเนื้อหางาน
// ────────────────────────────────────────────────────────────────────────────
import { authFetch } from '../../../lib/apiFetch';
import { getApiUrl } from '../../../lib/config';

export type SocialPlatformKey = 'youtube' | 'facebook' | 'instagram' | 'tiktok';
export type SocialPostKind = 'text' | 'clip';
export type SocialTargetStatus = 'pending' | 'posted' | 'skipped';

export interface SocialPostTarget {
  platform: SocialPlatformKey;
  accountId: string | null;
  status: SocialTargetStatus;
  externalUrl: string | null;
  externalId: string | null;
  postedAt: string | null;
}

export interface SocialPost {
  id: string;
  kind: SocialPostKind;
  title: string;
  body: string;
  link: string | null;
  videoName: string | null;
  videoSize: string | null;
  createdAt: string;
  updatedAt: string;
  targets: SocialPostTarget[];
}

export interface SocialPostTargetInput {
  platform: SocialPlatformKey;
  accountId?: string | null;
}

export interface SocialPostInput {
  kind: SocialPostKind;
  title?: string;
  body?: string;
  link?: string;
  videoName?: string;
  videoSize?: number;
  targets: SocialPostTargetInput[];
}

const apiBase = () => `${getApiUrl()}/api/ecosystem/social/posts`;

async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data.error === 'string' ? data.error : `คำขอไม่สำเร็จ (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function listSocialPosts(limit = 20): Promise<SocialPost[]> {
  const res = await authFetch(`${apiBase()}?limit=${encodeURIComponent(String(limit))}`, {
    cache: 'no-store',
  });
  const data = await readJson(res);
  return Array.isArray(data?.posts) ? data.posts : [];
}

export async function createSocialPost(input: SocialPostInput): Promise<SocialPost> {
  const res = await authFetch(apiBase(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await readJson(res);
  if (!data?.post) throw new Error('บันทึกประวัติไม่สำเร็จ — เซิร์ฟเวอร์ไม่ได้คืนข้อมูลโพสต์');
  return data.post as SocialPost;
}

export async function updateSocialPostTarget(
  postId: string,
  platform: SocialPlatformKey,
  patch: { status: SocialTargetStatus; externalUrl?: string; externalId?: string },
): Promise<SocialPost> {
  const res = await authFetch(`${apiBase()}/${encodeURIComponent(postId)}/targets/${encodeURIComponent(platform)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await readJson(res);
  if (!data?.post) throw new Error('อัปเดตสถานะไม่สำเร็จ — เซิร์ฟเวอร์ไม่ได้คืนข้อมูลโพสต์');
  return data.post as SocialPost;
}

export async function deleteSocialPost(postId: string): Promise<void> {
  const res = await authFetch(`${apiBase()}/${encodeURIComponent(postId)}`, { method: 'DELETE' });
  await readJson(res);
}
