// e2e/helpers/authGuard.ts — ด่านกัน "fail ลูกโซ่" ของ e2e
//
// ปัญหาจริง 26/9: auth.setup ล้มจุดเดียว → Playwright รายงาน spec ที่ depend login
// เป็น "did not run" ทั้งกอง (63 spec) ทั้งที่ส่วนใหญ่ไม่เกี่ยวกับการล็อกอินเลย
// ทางแก้: spec ที่ต้อง storageState ประกาศตัวเองว่า "ข้ามได้ถ้า auth ใช้ไม่ได้"
// → ผลลัพธ์คือ skipped พร้อมเหตุผล ไม่ใช่ทั้งชุดล้ม และ spec ที่ไม่ต้องล็อกอินยังวิ่งครบ
//
// ใช้: วาง `skipIfAuthStateMissing();` ที่ระดับบนสุดของไฟล์ ก่อนลงทะเบียนเทสต์
import { test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const STATE_PATH = 'e2e/.auth/state.json';

export function skipIfAuthStateMissing(): void {
  let reason: string | null = null;
  if (!existsSync(STATE_PATH)) {
    reason = 'ไม่มี e2e/.auth/state.json — auth.setup ไม่สำเร็จ';
  } else {
    try {
      // ต้องมี token หน้าตา JWT จริง ไม่ใช่ไฟล์เปล่าที่ setup เขียนค้างไว้
      if (!/ey[A-Za-z0-9_-]+\./.test(readFileSync(STATE_PATH, 'utf8'))) {
        reason = 'state.json ไม่มี token ที่ใช้ได้';
      }
    } catch {
      reason = 'อ่าน state.json ไม่ได้';
    }
  }
  if (reason) test.skip(true, `${reason} (ข้ามเฉพาะ spec ที่ต้องล็อกอิน)`);
}
