// ─────────────────────────────────────────────────────────────
// ตรวจว่าแอปเดสก์ท็อปกำลังรันค้างอยู่ไหม
//
// ทำไมต้องมี: ตัวแพ็ก (build-desktop.mjs) เขียนทับ dist-portable/
//   ถ้ามีโปรเซสเปิดไฟล์ในโฟลเดอร์นั้นอยู่ cpSync จะได้ EPIPE บน Windows
//   แล้วแพ็กล้มทั้งชุด — เคสจริง 11/10/69 ล้มซ้ำ 2 รอบเพราะเจ้าของเปิดแอปค้างไว้
//
// แยกเป็นโมดูลเพื่อ "เทสต์กับพฤติกรรมจริง" ได้ ไม่ใช่แค่ grep ว่ามีคำว่า
//   detectAppRunning(...) = ฟังก์ชันบริสุทธิ์ เอาผลจาก tasklist มาตัดสิน (เทสต์ได้)
//   isDesktopAppRunning() = ตัวห่อที่รัน tasklist จริงแล้วเรียกตัวบน
// ─────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';

/** ชื่อโปรเซสของแอป (ตรงกับ productName ใน package.json ของ sovereign-frontend) */
export const APP_IMAGE = 'Sovereign OS.exe';

/**
 * ตัดสินจากผลลัพธ์ของ tasklist ว่าแอปกำลังรันอยู่ไหม
 * แยกออกมาให้เทสต์ได้โดยไม่ต้องเปิดแอปจริง
 *
 * @param {string} stdout ผลลัพธ์ของ `tasklist /FI "IMAGENAME eq ..." /NH`
 * @returns {boolean}
 */
export function detectAppRunning(stdout) {
  if (!stdout) return false;
  // tasklist ตอบว่า "INFO: No tasks are running..." เมื่อไม่มีโปรเซส
  if (/No tasks are running/i.test(stdout)) return false;
  return new RegExp(APP_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(stdout);
}

/** รัน tasklist จริง — คืน true ถ้าพบแอปกำลังรันค้างอยู่ */
export function isDesktopAppRunning() {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${APP_IMAGE}`, '/NH'], { encoding: 'utf8' });
  if (r.status !== 0) return false; // tasklist รันไม่ได้ = ถือว่าไม่ค้าง (อย่าบล็อกการแพ็ก)
  return detectAppRunning(r.stdout);
}