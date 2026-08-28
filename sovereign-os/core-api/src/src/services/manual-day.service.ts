import path from 'path';
import { config } from '../config';
import { automationEngine } from './automation.service';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

// ── Manual Day (Cognitive Grounding — ภัย 5) ──
// "วันไร้ระบบอัตโนมัติ": พัก automation ทั้งบ้านตามเวลาที่กำหนด (default 24 ชม.)
// เด็ก (และผู้ใหญ่) ได้เปิดไฟ เปิดน้ำ กดสวิตช์ ด้วยมือจริง — เห็นว่าไฟฟ้า/น้ำไม่ใช่วิทยาศาสตร์
// แต่คือสิ่งที่ต้องใช้มือคน หมดอายุอัตโนมัติ (lazy expiry แบบ first-responder) ไม่ลืมคืนระบบ

export interface ManualDayState {
  active: boolean;
  by: string;
  at: number | null;
  note: string;
  endsAt: number | null;
}

const STATE_FILE = process.env.MANUAL_DAY_FILE || path.resolve(process.cwd(), 'data', 'manual-day.json');

function load(): ManualDayState {
  const { data } = readJsonVerified<ManualDayState>(STATE_FILE);
  if (data) {
    return {
      active: !!data.active,
      by: typeof data.by === 'string' ? data.by : '',
      at: typeof data.at === 'number' ? data.at : null,
      note: typeof data.note === 'string' ? data.note : '',
      endsAt: typeof data.endsAt === 'number' ? data.endsAt : null,
    };
  }
  return { active: false, by: '', at: null, note: '', endsAt: null };
}

function save(state: ManualDayState) {
  saveJsonAtomic(STATE_FILE, state);
}

class ManualDayService {
  private state: ManualDayState = { active: false, by: '', at: null, note: '', endsAt: null };

  init() {
    this.state = load();
    if (this.state.active && this.state.endsAt && Date.now() > this.state.endsAt) {
      this.set(false, 'system', 'หมดอายุอัตโนมัติ (boot)');
    }
    this.applyToEngine();
  }

  isActive(): boolean {
    if (this.state.active && this.state.endsAt && Date.now() > this.state.endsAt) {
      this.set(false, 'system', 'หมดอายุอัตโนมัติ');
    }
    return this.state.active;
  }

  status(): ManualDayState & { remainingMs: number | null } {
    this.isActive();
    return {
      ...this.state,
      remainingMs: this.state.active && this.state.endsAt ? this.state.endsAt - Date.now() : null,
    };
  }

  async set(active: boolean, by: string, note: string, hours?: number): Promise<ManualDayState & { remainingMs: number | null }> {
    const now = Date.now();
    const dur = Math.max(1, Math.min(72, hours ?? config.lifestyle.manualDayHours)) * 3600000;
    this.state = {
      active,
      by: by || 'unknown',
      at: now,
      note: (note || '').trim().slice(0, 300),
      endsAt: active ? now + dur : null,
    };
    save(this.state);
    this.applyToEngine();
    securityStream.push('MANUAL_DAY', { ...this.state });
    console.log(active ? `🤚 MANUAL DAY: ระบบอัตโนมัติพัก ${dur / 3600000} ชม. (โดย ${by})` : '🤚 Manual day ended — automation กลับมาทำงาน');
    return this.status();
  }

  private applyToEngine() {
    automationEngine.paused = this.state.active;
    automationEngine.pausedBy = this.state.active ? this.state.by : '';
  }
}

export const manualDay = new ManualDayService();