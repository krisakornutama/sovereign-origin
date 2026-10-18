// components/business/post/post-model.ts
// ────────────────────────────────────────────────────────────────────────────
// โมเดลของแท็บ "📣 โพสต์" — นิยามแพลตฟอร์ม · เพดาน · ตรวจ URL · ร่างงาน · ประกอบคำอธิบาย
//
// ⚠ ไฟล์นี้เป็น pure logic ล้วน — ห้ามมี value import เด็ดขาด
//   เทสต์ Node เรียกไฟล์นี้ตรง ๆ (tools/test/social-post.test.mjs)
//   ถ้าเขียนเป็น value import ที่ไม่มีนามสกุล Node จะ resolve ไม่ได้ → เทสต์ล้มทั้งชุด
//   (เจอจริง 17/10/69 กับ csv.ts ที่ import './store' → ต้องแยก csv-row-total.ts ออกมา)
//
// ⚠ ทำไมเพดานตัวอักษร/ขนาดไฟล์ต้องอยู่ที่นี่ ไม่ใช่กระจายใน UI:
//   มันคือ "สัญญา" กับแพลตฟอร์ม ถ้าคนแก้ทีหลังเผลอตั้งเลขมั่ว
//   เจ้าของจะอัปโหลดไม่ผ่านโดยไม่รู้สาเหตุ และไม่มีอะไรจับได้
//   → tools/test/social-post.test.mjs ล็อกตัวเลขชุดนี้ไว้
// ────────────────────────────────────────────────────────────────────────────

export type PlatformKey = 'youtube' | 'facebook' | 'tiktok';

export interface PlatformSpec {
  key: PlatformKey;
  label: string;
  emoji: string;
  /** หน้า "อัปโหลด" ของผู้ใช้ทั่วไป (ไม่ใช่ API) — เป็นค่าเริ่มต้น แก้ได้ */
  uploadUrl: string;
  /** โดเมนที่ยอมให้วาง URL เอง — ต้องตรงตัวเท่านั้น (ดู isAllowedUploadUrl) */
  hosts: string[];
  /** เพดานชื่อคลิป (ตัวอักษรจริง ไม่ใช่ UTF-16 code unit) */
  titleMax: number;
  /** เพดานคำอธิบาย (ตัวอักษรจริง) */
  descMax: number;
  /** เพดานขนาดไฟล์วิดีโอ (ไบต์) — ค่าที่แพลตฟอร์มรับจากหน้าเว็บ */
  fileMaxBytes: number;
  /** true = หน้านั้นมี "ช่องชื่อคลิป" แยกจากคำอธิบาย (TikTok ไม่มี — ชื่อกับแฮชแท็กอยู่ในแคปชันเดียวกัน) */
  hasTitleField: boolean;
  /** คำใบ้เฉพาะแพลตฟอร์ม แสดงใต้ช่องกรอก */
  hint: string;
}

const GB = 1024 ** 3;

export const PLATFORMS: PlatformSpec[] = [
  {
    key: 'youtube',
    label: 'YouTube',
    emoji: '▶️',
    uploadUrl: 'https://www.youtube.com/upload',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'studio.youtube.com'],
    titleMax: 100,
    descMax: 5000,
    fileMaxBytes: 128 * GB,
    hasTitleField: true,
    hint: 'ชื่อคลิป 100 ตัวอักษร · แฮชแท็ก 3 อันแรกจะโชว์เหนือชื่อคลิป',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    emoji: '📘',
    // ⚠ Facebook ไม่มีหน้า /upload กลางสำหรับทุกบัญชี (Page มี URL ของตัวเอง)
    //   → ค่าเริ่มต้นคือหน้าแรก แล้วให้เจ้าของวาง URL ของร้าน/เพจตัวเองทับได้ในช่อง "หน้าปลายทาง"
    uploadUrl: 'https://www.facebook.com/',
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'],
    titleMax: 100,
    descMax: 5000,
    fileMaxBytes: 10 * GB,
    hasTitleField: true,
    hint: 'วาง URL เพจ/โปรไฟล์ของตัวเองในช่องหน้าปลายทาง เพื่อเปิดตรงไปที่นั้น',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    emoji: '🎵',
    uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload',
    hosts: ['tiktok.com', 'www.tiktok.com'],
    titleMax: 100,
    descMax: 2200,
    fileMaxBytes: 4 * GB,
    hasTitleField: false,
    hint: 'แคปชัน 2,200 ตัวอักษร — ใส่แฮชแท็กได้เยอะกว่าแพลตฟอร์มอื่น',
  },
];

export const PLATFORM_KEYS: PlatformKey[] = PLATFORMS.map((p) => p.key);

export function platformByKey(key: string): PlatformSpec | null {
  const k = String(key ?? '');
  return PLATFORMS.find((p) => p.key === k) ?? null;
}

/**
 * ตรวจว่า URL ที่ผู้ใช้แก้เองชี้ไปโดเมนของแพลตฟอร์มนั้นจริง
 * ⚠ ต้องเทียบ hostname "ตรงตัว" — ห้ามใช้ regex/substring
 *   ไม่งั้น https://youtube.com.evil.com/ จะผ่านด่านไปได้ (กับดักคลาสสิก)
 */
export function isAllowedUploadUrl(key: string, raw: string): boolean {
  const spec = platformByKey(key);
  if (!spec) return false;
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return spec.hosts.includes(u.hostname.toLowerCase());
}

/**
 * URL ที่จะเปิดจริง — คืน null เมื่อ "แก้เองแล้วไม่ผ่าน" เพื่อให้ UI เตือนได้
 * (ห้ามเงียบ ๆ แล้วคืนค่าเริ่มต้น ไม่งั้นเจ้าของจะคิดว่าเปิดหน้าที่ตั้งไว้แล้ว)
 */
export function effectiveUploadUrl(key: PlatformKey, override?: string): string | null {
  const spec = platformByKey(key);
  if (!spec) return null;
  const raw = String(override ?? '').trim();
  if (!raw) return spec.uploadUrl;
  return isAllowedUploadUrl(key, raw) ? raw : null;
}

// ── นับ/ตัดตัวอักษรแบบที่แพลตฟอร์มนับ (code point ไม่ใช่ UTF-16 code unit) ──
// อีโมจิ 1 ตัว = 1 ตัวอักษร ไม่ใช่ 2 — ถ้าใช้ .length ตรง ๆ เจ้าของจะโดนตัดก่อนถึงเพดานจริง
export function textStatus(text: string, max: number): { len: number; over: number; ok: boolean } {
  const len = [...String(text ?? '')].length;
  const cap = Number(max) > 0 ? Number(max) : 0;
  return { len, over: Math.max(0, len - cap), ok: len <= cap };
}

export function clipToLimit(text: string, max: number): string {
  const cap = Number(max) > 0 ? Number(max) : 0;
  return [...String(text ?? '')].slice(0, cap).join('');
}

// ── ร่างงาน ────────────────────────────────────────────────────────────────
export interface PostDraft {
  /** ชื่อคลิป — ใช้ร่วมทุกแพลตฟอร์ม (เจ้าของขอช่องเดียว) */
  title: string;
  /** พาธไฟล์จริง — มีเฉพาะเมื่อรันในแอปเดสก์ท็อป (เบราว์เซอร์ไม่ให้พาธ) */
  videoPath: string;
  videoName: string;
  videoSize: number;
  /** แพลตฟอร์มที่จะโพสต์ (เรียงตาม PLATFORM_KEYS เสมอ) */
  targets: PlatformKey[];
  /** คำอธิบายแยกต่อแพลตฟอร์ม (เจ้าของขอแยกแก้ — TikTok ใส่แฮชแท็กเยอะกว่า) */
  captions: Record<PlatformKey, string>;
  /** ชุดแฮชแท็กแยกต่อแพลตฟอร์ม */
  hashtags: Record<PlatformKey, string>;
  /** URL หน้าปลายทางที่เจ้าของแก้เอง ('' = ใช้ค่าเริ่มต้นของแพลตฟอร์ม) */
  uploadUrls: Record<PlatformKey, string>;
}

export const DRAFT_KEY = 'sovereign-post-draft-v1';

/**
 * ทำให้ร่าง "มีรูปร่างครบเสมอ" ไม่ว่าจะมาจาก localStorage เวอร์ชันเก่า/ไฟล์เพี้ยน/ค่าที่ถูกแก้มือ
 * ⚠ ห้าม throw เด็ดขาด — หน้านี้เปิดมาควรใช้ได้เสมอ ดีกว่างานหายเพราะไฟล์ร่างเสีย
 * keys รับเข้ามาเป็นพารามิเตอร์เพราะไฟล์นี้ห้าม import ค่าจากไฟล์อื่น (ดูหัวไฟล์)
 */
export function normalizeDraft(raw: unknown, keys: readonly PlatformKey[]): PostDraft {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const perKey = (v: unknown): Record<PlatformKey, string> => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const out = {} as Record<PlatformKey, string>;
    for (const k of keys) out[k] = str(o[k]);
    return out;
  };
  const rawTargets = Array.isArray(src.targets) ? src.targets : [];
  // วนตาม keys (ซึ่งไม่ซ้ำอยู่แล้ว) ⇒ ได้ทั้ง "เรียงคงที่" "ตัดตัวซ้ำ" และ "ตัดค่าที่ไม่รู้จัก"
  // (ผู้ใช้อาจแก้ localStorage เอง — ห้ามเชื่อว่าเป็นแพลตฟอร์มที่รู้จัก)
  const targets = keys.filter((k) => rawTargets.includes(k));
  const size = Number(src.videoSize);
  return {
    title: str(src.title),
    videoPath: str(src.videoPath),
    videoName: str(src.videoName),
    videoSize: Number.isFinite(size) && size > 0 ? size : 0,
    targets,
    captions: perKey(src.captions),
    hashtags: perKey(src.hashtags),
    uploadUrls: perKey(src.uploadUrls),
  };
}

export function emptyDraft(keys: readonly PlatformKey[]): PostDraft {
  return normalizeDraft({}, keys);
}

/** ชุดแฮชแท็ก: ตัด # ที่ซ้ำ/ช่องว่างเกิน แล้วเติม # ให้ทุกคำ */
export function normalizeHashtags(raw: string): string {
  return String(raw ?? '')
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ');
}

/** ข้อความที่จะถูกคัดลอกไปวางบนแพลตฟอร์มนั้น = คำอธิบาย + แฮชแท็กของแพลตฟอร์มนั้น */
export function buildCaption(draft: PostDraft, key: PlatformKey): string {
  const desc = String(draft?.captions?.[key] ?? '').trim();
  const tags = normalizeHashtags(String(draft?.hashtags?.[key] ?? ''));
  if (!desc) return tags;
  if (!tags) return desc;
  return `${desc}\n\n${tags}`;
}
