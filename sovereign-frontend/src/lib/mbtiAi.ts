// แนบโค้ด MBTI ไปกับทุก AI call — ให้ AI กลางและหลวงพี่ปรับโทนตามบุคลิกผู้ใช้
// (ผลแบบทดสอบอยู่บนเครื่องเป็น local-first — client ส่งโค้ด 4 ตัวเท่านั้น ไม่ส่ง raw คะแนน)
import { latestLocalResult } from './mbtiData';

/** โค้ด MBTI ผลล่าสุดของผู้ใช้ (null ถ้ายังไม่เคยทำ) — client-only */
export function currentMbtiCode(): string | null {
  return latestLocalResult()?.code ?? null;
}

/** แนบ mbti ลง body ของ POST /api/ai/chat อัตโนมัติ (ถ้ามีผล) */
export function withMbti<T extends Record<string, unknown>>(body: T): T & { mbti?: string } {
  const code = currentMbtiCode();
  return code ? { ...body, mbti: code } : body;
}
