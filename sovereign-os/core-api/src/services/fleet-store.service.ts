// src/services/fleet-store.service.ts
//
// ── ที่เก็บ state ของ Fleet Control Plane (ไม่ใช้ DB) ────────────────────────
// เหตุผลที่เลือกไฟล์บนดิสก์แทนตารางใหม่:
//   • ระบบอยู่ระหว่าง Cold Soak — ห้าม migrate DB
//   • ข้อมูลพวกนี้เป็น "นโยบาย/ทะเบียนขนาดเล็ก" ไม่ใช่ข้อมูลธุรกิจ
//     (เครื่องมีกี่เครื่องอยู่ใน DB เดิมแล้ว — ที่นี่เก็บเฉพาะ override + token)
//   • ต้อง backup/ย้ายง่าย และอ่านด้วยคนได้เมื่อฉุกเฉิน
//
// ที่เก็บจริง: sovereign-os/core-api/data/fleet/ (volume ที่ mount อยู่แล้ว)
//   policy.json            นโยบายช่องทางอัปเดต + site/group ต่อเครื่อง
//   enrollment-tokens.json รหัสเชิญแบบใช้ครั้ง/มีวันหมดอายุ (เก็บแค่ hash)
//
// ⚠️ กติกา:
//   • เขียนแบบ atomic (temp → rename) — ไฟล์พังกลางคันต้องไม่ทำให้ทั้งศูนย์เสีย
//   • token/รหัสจริงห้ามลงไฟล์นี้ — เก็บเฉพาะ sha256
//   • ไฟล์เสีย = อ่านเป็นค่าเริ่มต้นแบบ fail-closed (ไม่เดาว่าข้อมูลเก่ายังใช้ได้)
import fs from 'node:fs';
import path from 'node:path';

/** โฟลเดอร์เริ่มต้น — เปลี่ยนได้ด้วย FLEET_DIR (tests ใช้ path ชั่วคราว) */
export const DEFAULT_FLEET_DIR =
  process.env.FLEET_DIR || path.join(__dirname, '..', '..', 'data', 'fleet');

export function fleetRoot(root?: string): string {
  return root || process.env.FLEET_DIR || DEFAULT_FLEET_DIR;
}

export function fleetFile(name: string, root?: string): string {
  return path.join(fleetRoot(root), name);
}

/** อ่าน JSON — ไฟล์ไม่มี/เสียคืน fallback (ไม่ throw ให้ route ล่ม) */
export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.error(`[fleet] อ่าน ${path.basename(file)} ไม่ได้:`, err instanceof Error ? err.message : err);
    }
    return fallback;
  }
}

/**
 * เขียน JSON แบบ atomic:
 *   1) เขียนไฟล์ชั่วคราวในโฟลเดอร์เดียวกัน
 *   2) rename ทับไฟล์จริง (atomic บน filesystem เดียวกัน)
 *   3) ถ้า rename ไม่ได้ (Windows บางกรณี) ค่อย copy ทับแล้วลบ temp
 * ไม่มีทางที่ไฟล์จริงจะถูก truncate แล้ว crash กลางทาง
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

/** ตัดข้อความสำหรับเก็บในไฟล์/แสดง UI — คุมความยาวและอักขระควบคุม */
export function sanitizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, max) : null;
}

/** key ที่ปลอดภัยสำหรับใช้เป็นชื่อใน JSON (machine id / token id) */
export function isSafeKey(value: unknown, max = 64): value is string {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
}

/**
 * คิวเขียนไฟล์แบบ in-process — กันสอง request อ่าน-แก้-เขียนทับกัน
 * (core-api รัน instance เดียว; หลาย instance ต้องใช้ DB/lock จริงในอนาคต)
 */
export function createLock(): <T>(fn: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
