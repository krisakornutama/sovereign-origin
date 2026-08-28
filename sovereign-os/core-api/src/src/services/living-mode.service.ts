import path from 'path';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

// ── Living Mode (Anti-Goodhart Shield — ภัย 2) ──
// เมื่อเปิด: กฎ automation ที่วัด "ร่องรอยการมีชีวิต" (ควันจากการทำอาหาร, ค่าไฟ, เสียง)
// จะไม่เตือน ไม่สร้าง alert ไม่ส่ง Telegram — เพราะมนุษย์ไม่ได้เกิดมาเพื่อทำกราฟให้สวย
// ไม่หมดอายุอัตโนมัติ (เป็นไลฟ์สไตล์ ไม่ใช่เหตุฉุกเฉิน) — เปิด/ปิดได้เองที่หน้า วิถีชีวิต

export interface LivingModeState {
  active: boolean;
  by: string;
  at: number | null;
}

const STATE_FILE = process.env.LIVING_MODE_FILE || path.resolve(process.cwd(), 'data', 'living-mode.json');

function load(): LivingModeState {
  const { data } = readJsonVerified<LivingModeState>(STATE_FILE);
  if (data) {
    return { active: !!data.active, by: typeof data.by === 'string' ? data.by : '', at: typeof data.at === 'number' ? data.at : null };
  }
  return { active: false, by: '', at: null };
}

function save(state: LivingModeState) {
  saveJsonAtomic(STATE_FILE, state);
}

class LivingModeService {
  private state: LivingModeState = { active: false, by: '', at: null };

  init() {
    this.state = load();
  }

  isActive(): boolean {
    return this.state.active;
  }

  status(): LivingModeState {
    return { ...this.state };
  }

  set(active: boolean, by: string): LivingModeState {
    this.state = { active, by: by || 'unknown', at: Date.now() };
    save(this.state);
    securityStream.push('LIVING_MODE', { ...this.state });
    console.log(active ? `🌿 Living Mode ON (${this.state.by}) — ระบบไม่เตือนรบกวนการใช้ชีวิตแล้ว` : '🌿 Living Mode OFF');
    return this.status();
  }
}

export const livingMode = new LivingModeService();