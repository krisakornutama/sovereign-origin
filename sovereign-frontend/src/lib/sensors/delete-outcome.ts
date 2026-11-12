// อ่านผลของคำขอลบข้อมูลเทเลเมตรี — "ลบแล้ว" ต้องมาจาก server ไม่ใช่จากการที่ request ไม่ throw
//
// เดิม SensorsHub.deleteAll ขึ้นข้อความสำเร็จทันทีหลัง authFetch โดยไม่ดู res.ok
// ⇒ 403 (ไม่มีสิทธิ์) หรือ 500 ถูกอ่านว่า "ลบทั้งหมดแล้ว" ทั้งที่ข้อมูลยังอยู่
// (และหลังเพิ่มสิทธิ์ระดับผู้ดูแล KID ยิงแล้วได้ 403 เป็นเรื่องปกติที่ไม่ใช่ความผิดพลาดของระบบ)

export type DeleteRejection = 'forbidden' | 'failed';

/**
 * @param status HTTP status จาก server
 * @param body JSON ที่ parse ได้ (หรือ {} เมื่อ parse ไม่ได้)
 * @returns null = ลบสำเร็จจริง · 'forbidden' = ไม่มีสิทธิ์ · 'failed' = อย่างอื่น
 */
export function deleteRejection(status: number, body: unknown): DeleteRejection | null {
  if (status === 403) return 'forbidden';
  if (!Number.isFinite(status) || status < 200 || status >= 300) return 'failed';
  // บาง route ตอบ 200 พร้อม success:false (เช่น ไม่มีอะไรให้ลบ) — ห้ามอ่านว่าเป็นความสำเร็จ
  if (body && typeof body === 'object' && (body as { success?: boolean }).success === false) return 'failed';
  return null;
}

export function deleteFailureMessage(
  rejection: DeleteRejection,
  status: number,
  body: unknown,
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
): string {
  if (rejection === 'forbidden') {
    return t('sensorsHub.deleteForbidden', '❌ ไม่มีสิทธิ์ลบข้อมูลเทเลเมตรี — ต้องเป็นผู้ดูแลระบบ');
  }
  const serverError = (body as { error?: string } | null | undefined)?.error;
  return `❌ ${serverError || t('sensorsHub.deleteFailed', '❌ ลบไม่สำเร็จ')} (HTTP ${status})`;
}
