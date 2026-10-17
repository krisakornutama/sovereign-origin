// components/business/soverien/serial-guard.ts
// กัน "ตัวนับ serial ถอยหลัง" ตอนกู้คืนไฟล์สำรอง (17/10/69)
//
// แยกจาก store.ts ซึ่งชิดเพดาน 400 บรรทัด · ไม่ import อะไรที่ไม่ใช่ type
//   เพื่อให้เทสต์ Node (tools/test/soverien-tools.test.mjs) เรียกไฟล์นี้ตรง ๆ ได้
//
// ── ทำไมต้องมี ──
// เจ้าของมีไฟล์สำรองอยู่หลายใบ (ส่งออกทุก 7 วัน) ถ้าเปิดแอปแล้ว "กู้คืน" ใบที่เก่ากว่า
//   lastNo จะย้อนกลับไปต่ำกว่า serial ที่เคยพิมพ์ลงป้ายไปแล้ว
//   → ออกออเดอร์ครั้งถัดไปได้เลขซ้ำกับที่ติดอยู่บนเครื่องของลูกค้าจริง
//   → ลูกค้าสแกนป้ายแล้วเจอประกันของอีกคน / เรียกเครื่องซ้ำไม่ได้
// กฎเหล็กของโปรเจ็กคือ "ตัวนับเดินทางเดียว ห้ามซ้ำ แม้ void" — การกู้ข้อมูลก็ต้องไม่ทำให้ถอย
import type { Db, Model, Serial } from './types';

/** ตัวเลขสูงสุดที่อ่านได้จากชื่อ serial จริงของ prefix นี้ (-1 = ยังไม่มีสักตัว) */
function maxNoIn(prefix: string, from: readonly Serial[]): number {
  let mx = -1;
  for (const s of from) {
    if (!s?.sn || !s.sn.startsWith(`${prefix}-`)) continue;
    const n = Number(s.sn.slice(prefix.length + 1));
    if (Number.isFinite(n) && n > mx) mx = n;
  }
  return mx;
}

/**
 * ยก `lastNo` ของทุกรุ่นให้ไม่ต่ำกว่าของจริง แล้วคืนข้อมูลสำรองนั้น (แก้ในตัว)
 *
 * ปรับจาก 3 ทางพร้อมกัน เพราะแต่ละทางจับคนละกรณี:
 *   · lastNo ในไฟล์สำรอง        — ค่าปกติ
 *   · serial จริงในไฟล์สำรอง    — กันไฟล์ที่ lastNo เพี้ยน/ถูกแก้
 *   · ของที่อยู่ในเครื่องตอนนี้  — กันไฟล์เก่าทับข้อมูลใหม่
 *
 * @returns รุ่นที่ถูกยกตัวนับขึ้น (ใช้บอกผู้ใช้ว่าเกิดอะไรขึ้น)
 */
export function guardSerialCounter(backup: Db, current?: Db | null): Model[] {
  const floorOf = (m: Model): number => Math.max(
    m.lastNo,
    maxNoIn(m.prefix, backup.serials),
    current
      ? Math.max(maxNoIn(m.prefix, current.serials), current.models.find((x) => x.id === m.id)?.lastNo ?? -1)
      : -1,
  );

  const raised: Model[] = [];
  for (const m of backup.models) {
    const floor = floorOf(m);
    if (floor > m.lastNo) { m.lastNo = floor; raised.push(m); }
  }

  // รุ่นที่มีในเครื่องแต่ไม่มีในไฟล์สำรอง — ต้องเก็บไว้
  //   ไม่งั้น prefix เดิมถูกเปิดใหม่ด้วยตัวนับศูนย์ → serial ที่เคยพิมพ์ไปแล้วถูกใช้ซ้ำ
  if (current) {
    for (const m of current.models) {
      if (backup.models.some((x) => x.prefix === m.prefix)) continue;
      backup.models.push({ ...m, lastNo: floorOf(m) });
      raised.push(backup.models[backup.models.length - 1]);
    }
  }
  return raised;
}
