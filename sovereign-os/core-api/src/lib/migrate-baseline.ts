/**
 * ตรรกะบริสุทธิ์ของ "baseline ฐานข้อมูลที่ถูกสร้างมาก่อนมี _prisma_migrations"
 *
 * ทำไมต้องมี: ลูกค้าที่ติดตั้งรุ่นก่อน squash baseline (หรือกู้ volume เก่ากลับมา)
 * มี schema อยู่ครบแต่ไม่มีตาราง _prisma_migrations ⇒ `prisma migrate deploy`
 * ล้มด้วย P3005 ทุกครั้ง และ service migrate ทำให้ทั้งสแตก start ไม่ขึ้น
 *
 * กติกาความปลอดภัย: baseline ได้เฉพาะเมื่อ schema ในฐานข้อมูล "ตรงกับ" datamodel
 * ปัจจุบัน (drift ว่าง) — ถ้า drift ไม่ว่างต้องหยุดให้คนตรวจ ไม่เดาแทน
 */

/** P3005 = "The database schema is not empty" — ฐานข้อมูลมีของอยู่แต่ไม่มีประวัติ migration */
export function isUnmanagedSchemaError(output: string): boolean {
  const text = String(output ?? '');
  if (/P3005/.test(text)) return true;
  // ข้อความนี้เฉพาะเจาะจงพอ (ไม่ใช่ error เชื่อมต่อ/ฐานข้อมูลไม่มี) จึงรับแม้ไม่มีโค้ด P3005
  return /database schema is not empty/i.test(text);
}

/** รายชื่อ migration ที่ควรถูก mark ว่า apply แล้ว (เรียงตามชื่อ = ลำดับเวลา) */
export function listMigrationNames(entries: string[]): string[] {
  return entries
    .filter((name) => /^\d{14}_/.test(name) && !name.endsWith('.toml'))
    .sort();
}

/**
 * ตัดสินว่าควรทำอะไรต่อจากผลลัพธ์ที่ได้
 * - deploy ผ่าน = ok
 * - ล้มด้วย P3005 + drift ว่าง = baseline (resolve ทุก migration แล้ว deploy ซ้ำ)
 * - ล้มด้วย P3005 + drift ไม่ว่าง = fail (ต้องคนตรวจ)
 * - ล้มด้วย error อื่น = fail
 */
export type BaselineDecision = 'ok' | 'baseline' | 'fail';

export function decideMigrateAction({
  deployOk,
  deployOutput,
  driftOk,
}: {
  deployOk: boolean;
  deployOutput: string;
  /** true = schema ใน DB ตรงกับ datamodel (migrate diff --exit-code คืน 0) */
  driftOk?: boolean;
}): BaselineDecision {
  if (deployOk) return 'ok';
  if (!isUnmanagedSchemaError(deployOutput)) return 'fail';
  return driftOk === true ? 'baseline' : 'fail';
}
