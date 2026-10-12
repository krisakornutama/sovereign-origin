// tools/machine-alert.config.mjs — สวิตช์เปิด/ปิดการแจ้งเตือน Telegram
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────────
// เจ้าของสั่ง 12/10/69: "alert ใน telegram อย่าพึ่งให้ทำงานพื้นหลังก็ได้
//   มีปุ่มเปิด-ปิดด้วยมั้ย ... การส่งข้อมูลหลาย ๆ อย่างโดยที่ยังไม่ได้จริง บางทีมันก็รก"
//   ⇒ ค่าเริ่มต้น = ปิด และต้องสลับได้ด้วยคำสั่งเดียว ไม่ต้องแก้โค้ด
//
// ── หลักการ ──────────────────────────────────────────────────────────────
// · ปิดแล้ว "ยังตรวจอยู่" แต่ไม่ส่งออก — ประวัติยังถูกจดไว้ ตอนเปิดกลับมาเห็นครบ
// · เปิดแล้วส่งเฉพาะระดับที่ตั้งไว้ (ค่าเริ่มต้น critical เท่านั้น) ไม่ใช่ทุกเรื่อง
// · ทุกค่ามีค่าเริ่มต้นที่ปลอดภัย ถ้าไฟล์เพี้ยน/หาย = ปิด ไม่ใช่ส่งทั้งหมด
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'tools', 'alert-settings.json');

export const DEFAULTS = {
  /** false = ไม่ส่ง Telegram อัตโนมัติ (เจ้าของเลือก 12/10/69) */
  enabled: false,
  /** ระดับขั้นต่ำที่ยอมส่ง: 'critical' | 'warn' | 'info' */
  minLevel: 'critical',
  /** ส่งซ้ำเรื่องเดิมได้ทุกกี่นาที (0 = ไม่ส่งซ้ำเลยจนกว่าจะหายแล้วกลับมาเป็น) */
  cooldownMin: 120,
};

export const LEVELS = ['info', 'warn', 'critical'];

export function readConfig(file = CONFIG_PATH) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // ไม่มีไฟล์/อ่านไม่ได้/JSON พัง = ใช้ค่าเริ่มต้น (ปิดไว้ก่อน ปลอดภัยกว่าส่งรัว)
    return { ...DEFAULTS };
  }
  return normalize({ ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) });
}

/** ค่าเพี้ยน = บังคับกลับเป็นค่าเริ่มต้น ไม่ตีความตามใจผู้แก้ไฟล์ */
export function normalize(cfg) {
  return {
    enabled: cfg.enabled === true,
    minLevel: LEVELS.includes(cfg.minLevel) ? cfg.minLevel : DEFAULTS.minLevel,
    cooldownMin: Number.isFinite(Number(cfg.cooldownMin)) && Number(cfg.cooldownMin) >= 0
      ? Math.round(Number(cfg.cooldownMin))
      : DEFAULTS.cooldownMin,
  };
}

export function writeConfig(cfg, file = CONFIG_PATH) {
  const clean = normalize(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return clean;
}

/** ระดับนี้ต้องส่งไหม (เทียบกับที่ตั้งไว้) */
export function shouldSend(level, cfg = readConfig()) {
  if (!cfg.enabled) return false;
  const a = LEVELS.indexOf(level);
  const b = LEVELS.indexOf(cfg.minLevel);
  if (a < 0) return false;
  return a >= b;
}

/** เวลานัดถัดไปที่อนุญาตให้ส่งซ้ำเรื่องเดิม (0 = ไม่ส่งซ้ำ) */
export function cooldownMs(cfg = readConfig()) {
  return Math.max(0, Number(cfg.cooldownMin) || 0) * 60_000;
}

export function describe(cfg = readConfig()) {
  return [
    `สถานะ   : ${cfg.enabled ? 'เปิด (ส่ง Telegram อัตโนมัติ)' : 'ปิด (ตรวจอยู่ แต่ไม่ส่ง)'}`,
    `ระดับต่ำสุด : ${cfg.minLevel}`,
    `ส่งซ้ำได้ทุก : ${cfg.cooldownMin} นาที`,
    `ไฟล์ตั้งค่า : ${CONFIG_PATH}`,
  ].join('\n');
}
