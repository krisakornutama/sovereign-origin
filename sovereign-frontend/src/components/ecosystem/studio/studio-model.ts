// components/ecosystem/studio/studio-model.ts
// ────────────────────────────────────────────────────────────────────────────
// โมเดลของ Social Studio — งาน "โพสต์ข้อความ" (Facebook) แยกจาก "ลงคลิปวิดีโอ"
//
// ⚠ pure logic ล้วน — ห้ามมี value import (เทสต์ Node เรียกไฟล์นี้ตรง ๆ)
// ⚠ ทำไมต้องมีไฟล์นี้แยกจาก post-model.ts:
//   post-model = สัญญาของ "คลิปวิดีโอ" (เพดานไฟล์/ชื่อ/คำอธิบาย)
//   studio-model = สัญญาของ "โพสต์ข้อความ" + การดึงบัญชีที่ผูกไว้บนเครื่องมาแสดง
//   สองงานนี้แยกกันจริงตามที่เจ้าของสั่ง — ห้ามยัดรวมกันจนอ่านไม่ออกว่าอันไหนคุมอะไร
// ────────────────────────────────────────────────────────────────────────────

/** บัญชีขั้นต่ำที่สตูดิโอต้องใช้ — รับ EcosystemAccount เต็มก้อนได้โดยไม่ผูก type */
export interface StudioAccountLike {
  id: string;
  platform: string;
  label: string;
  loginId: string;
  status: string;
}

export interface StudioAccountOption {
  id: string;
  platform: string;
  label: string;
  loginId: string;
  /** สิ่งที่ผู้ใช้เห็นเป็น "โพสต์ในนาม" — อีเมลที่ผูกไว้ ถ้าไม่มีใช้ชื่อบัญชี */
  display: string;
}

/** เพดานข้อความของแต่ละแพลตฟอร์ม (ตัวอักษรจริง) */
export const TEXT_LIMITS = {
  facebook: 63_206,
} as const;

/** คีย์ร่างโพสต์ข้อความ — แยกจากร่างคลิปโดยเด็ดขาด (ปิดแอปแล้วกลับมาไม่ปนกัน) */
export const TEXT_DRAFT_KEY = 'sovereign-social-text-v1';

export interface TextDraft {
  text: string;
  link: string;
  accountId: string;
}

export const EMPTY_TEXT_DRAFT: TextDraft = { text: '', link: '', accountId: '' };

/** ทำให้ร่างที่อ่านจาก localStorage มีรูปร่างครบเสมอ — ห้าม throw */
export function normalizeTextDraft(raw: unknown): TextDraft {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    text: str(src.text),
    link: str(src.link),
    accountId: str(src.accountId),
  };
}

/**
 * บัญชีของแพลตฟอร์มนั้นที่ "ใช้งานได้" — ตัดบัญชีที่เก็บถาวรออก
 * เรียงตามลำดับที่ Ecosystem ส่งมา (บัญชีที่ผูก Gmail ไว้จะอยู่ต้น ๆ อยู่แล้ว)
 */
export function accountsForPlatform(
  accounts: readonly StudioAccountLike[] | null | undefined,
  platform: string,
): StudioAccountOption[] {
  const want = String(platform ?? '');
  if (!want) return [];
  return (Array.isArray(accounts) ? accounts : [])
    .filter((a) => a && a.platform === want && a.status !== 'archived')
    .map((a) => {
      const loginId = String(a.loginId ?? '').trim();
      const label = String(a.label ?? '').trim();
      return {
        id: a.id,
        platform: a.platform,
        label,
        loginId,
        display: loginId || label || a.platform,
      };
    });
}

/**
 * ข้อความที่จะถูกคัดลอกไปวางบน Facebook = เนื้อหา + ลิงก์ (ถ้ามี)
 * ไม่เติมบรรทัดเปล่าเมื่อไม่มีลิงก์ — วางแล้วจะได้ไม่ต้องลบบรรทัดทิ้ง
 */
export function buildTextPost(text: string, link: string): string {
  const body = String(text ?? '').trim();
  const url = String(link ?? '').trim();
  if (!body) return url;
  if (!url) return body;
  return `${body}\n\n${url}`;
}

export interface TextPostStatus {
  /** จำนวนตัวอักษรจริง (code point — อีโมจิ 1 ตัว = 1) */
  len: number;
  /** เกินเพดานกี่ตัว (0 = ไม่เกิน) */
  over: number;
  /** ยังไม่ได้พิมพ์เนื้อหา (ลิงก์อย่างเดียวก็โพสต์ได้ แต่ต้องเตือนให้รู้) */
  missing: boolean;
  ok: boolean;
}

export function textPostStatus(text: string, link: string, max: number): TextPostStatus {
  const body = buildTextPost(text, link);
  const len = [...body].length;
  const cap = Number(max) > 0 ? Number(max) : 0;
  const missing = !String(text ?? '').trim();
  return {
    len,
    over: Math.max(0, len - cap),
    missing,
    ok: !missing && len <= cap,
  };
}
