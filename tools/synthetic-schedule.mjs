// tools/synthetic-schedule.mjs — ตัวคุมความถี่ของ synthetic browser check (pure)
//
// Task Scheduler ยิงทุก 5 นาที แต่ละรอบเปิด browser 3 โปรไฟล์ (WebKit/Chromium)
// ⇒ แล็ปท็อปมี Chrome/Node ตื่นทั้งวันแม้ไม่มีคนใช้แอป
// เราไม่แก้ trigger ของ task (แตะระบบน้อยที่สุด) — ให้สคริปต์เช็ค state file เอง
// แล้วข้ามรอบที่ยังไม่ถึง interval (ค่าเริ่มต้น 30 นาที, override ด้วย env)
import fs from 'node:fs';

export const DEFAULT_MIN_INTERVAL_MS = 30 * 60_000;

export function shouldRunSynthetic({ lastRunMs = 0, now = Date.now(), minIntervalMs = DEFAULT_MIN_INTERVAL_MS, force = false } = {}) {
  if (force) return true;
  if (!Number.isFinite(lastRunMs) || lastRunMs <= 0) return true;
  if (lastRunMs > now) return true; // clock skew — รันดีกว่าค้างตลอดกาล
  return now - lastRunMs >= Math.max(0, minIntervalMs);
}

export function readLastRunMs(file) {
  try {
    const n = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
