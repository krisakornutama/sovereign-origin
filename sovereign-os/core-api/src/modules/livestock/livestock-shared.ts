// ═════════════════════════════════════════════════════════════
// livestock-shared.ts — constants + helpers ที่ใช้ร่วมกันทุก section
// ของ Sovereign Livestock Engine (แยกมาจาก livestock.routes.ts เดิม)
// ═════════════════════════════════════════════════════════════
import { sendTelegramAlert } from '../../services/telegram-alert.service';

export const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];
export const DAY_MS = 86_400_000;
// ระยะกักกันอัตโนมัติ (วัน) — นับจากวันที่เข้ากักกัน → cron ปลดเอง
export const QUARANTINE_DAYS = parseInt(process.env.LIVESTOCK_QUARANTINE_DAYS || '14', 10);
export const SPECIES = ['POULTRY_BROILER', 'POULTRY_LAYER', 'DUCK', 'SWINE', 'CATTLE'];
export const GROUP_STATUSES = ['ACTIVE', 'QUARANTINE', 'HARVESTED', 'LOCKED_WITHDRAWAL'];
export const BREED_STATUSES = ['PREGNANT', 'LITTERED', 'FAILED', 'ABORTED'];
// FCR standard curve ตามชนิดพันธุ์ (kg อาหารต่อ kg น้ำหนักเพิ่ม)
export const ROS = {
  broiler: 1.9,
  layer: 2.0,
  duck: 2.2,
  swine: 3.0,
  cattle: 7.0,
};

export interface ClimateSample {
  houseCode?: string;
  tempC: number;
  rhPct: number;
  thi: number;
  status: 'COMFORT' | 'HEAT_WARNING' | 'CRITICAL';
  at: string;
}
// ประวัติ climate ถูกเก็บลง hypertable (livestock_climate_logs) แล้ว —
// ในหน่วยความจำใช้เป็น cache เล็กๆ เฉพาะ session นี้เท่านั้น
export const climateHistory: ClimateSample[] = [];
export const MAX_CLIMATE_HISTORY = 500;

// สถานะพัดลมต่อเล้า (Hysteresis & Anti-Flapping) — จำ on/off + เวลาสั่งครั้งสุดท้าย
// เพื่อกัน "ตัด-ต่อ" ถี่ๆ ตอน THI ก้ำกึ่ง threshold (เปิด 74 / ปิด 70 + cooldown 5 นาที)
export const fanStates = new Map<string, { on: boolean; lastToggleAt: number }>();

export const notify = (text: string, severity: 'info' | 'warn' | 'critical', eventKey?: string) =>
  sendTelegramAlert({ text, severity, eventKey });

export const parseDate = (v: unknown): Date | null | 'invalid' => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};
