// tools/find-shadow-installs.mjs
//
// ── หา "สำเนาเงา" ของแอปเดสก์ท็อปที่อยู่นอกโปรเจกต์ (14/10/69) ──
//
// ปัญหาจริง: มีโฟลเดอร์ E:\My work\SovereignOS เป็นสำเนาเก่าที่ถูกก๊อปออกไปเอง
//   ไอคอนเดสก์ท็อปยังชี้ไปที่นั่น → สั่ง build ใหม่เสร็จ ผลลัพธ์: "แก้แล้วไม่มีผล"
//   เพราะแอปที่เปิดอยู่ไม่ใช่ตัวที่เพิ่งแพ็ก และ build ไม่ได้ฟ้องอะไรเลย
//
// กติกา: นับเฉพาะโฟลเดอร์ที่มี "Sovereign OS.exe" อยู่จริง (ไม่ใช่แค่โฟลเดอร์เปล่า)
//        และต้องไม่ใช่ตัวที่กำลังแพ็กอยู่ (PORTABLE)
import { existsSync } from 'node:fs';
import path from 'node:path';

export const EXE_NAME = 'Sovereign OS.exe';

/** โฟลเดอร์ที่ถือว่าเป็นสำเนาเงา (เรียงตามความน่าจะเป็นของจริง) */
export const SHADOW_DIRS = ['SovereignOS', 'Sovereign OS', 'SovereignOS-old'];

/**
 * คืนรายการพาธสำเนาเงา
 * @param {string} root รากโปรเจกต์ (ดู sibling ของมัน)
 * @param {string} portable โฟลเดอร์ที่กำลังแพ็กอยู่ — จะไม่ถูกนับ
 * @returns {string[]}
 */
export function findShadowInstalls(root, portable) {
  const target = path.resolve(portable ?? '');
  return SHADOW_DIRS
    .map((d) => path.join(path.dirname(path.resolve(root)), d))
    
    .filter((d) => existsSync(path.join(d, EXE_NAME)))
    .filter((d) => path.resolve(d) !== target);
}