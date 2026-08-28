import fs from 'fs';
import path from 'path';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

// ── Emergency Agent Kill-Switch (Global Override) ──
// ปุ่มหยุดการทำงานของ AI Agent ทุกตัวในระบบทันที:
//  - ปฏิเสธการ execute action tool ทุกชนิด (agent-actions.service)
//  - ปฏิเสธการอนุมัติ approval ทั้งหมด (approve/reject ผ่าน route + Telegram)
//  - หยุดการตอบสนองของ AI chat (AiAgentService.processMessage)
// สถานะ persist ใน data/ai-kill-switch.json (แค่ปิด/เปิดสวิตช์ — ไม่ต้องผูก DB)
// และกระจาย event ไปยัง real-time stream ทันทีที่เปลี่ยนสถานะ

export interface KillSwitchState {
  active: boolean;
  reason: string;
  by: string;
  at: number | null;
}

// เส้นทาง state file — override ผ่าน env (ใช้ในการทดสอบ)
const STATE_FILE =
  process.env.AI_KILL_SWITCH_FILE || path.resolve(process.cwd(), 'data', 'ai-kill-switch.json');

function loadState(): KillSwitchState {
  const { data } = readJsonVerified<KillSwitchState>(STATE_FILE);
  if (data) {
    return {
      active: !!data.active,
      reason: typeof data.reason === 'string' ? data.reason : '',
      by: typeof data.by === 'string' ? data.by : '',
      at: typeof data.at === 'number' ? data.at : null,
    };
  }
  return { active: false, reason: '', by: '', at: null };
}

class AiKillSwitchService {
  private state: KillSwitchState = { active: false, reason: '', by: '', at: null };

  init() {
    this.state = loadState();
  }

  isActive(): boolean {
    return this.state.active;
  }

  status(): KillSwitchState {
    return { ...this.state };
  }

  set(active: boolean, reason: string, by: string): KillSwitchState {
    const trimmed = (active ? reason || 'เร่งด่วน — กำหนดโดยผู้ดูแลระบบ' : '')
      .trim()
      .slice(0, 500);
    this.state = { active, reason: trimmed, by: by || 'unknown', at: Date.now() };
    saveJsonAtomic(STATE_FILE, this.state);
    securityStream.push('KILL_SWITCH', { ...this.state });
    if (active) {
      console.warn(`⛔ AI KILL-SWITCH ENGAGED by ${this.state.by}: ${trimmed}`);
    } else {
      console.log('🟢 AI kill-switch released');
    }
    return this.status();
  }
}

export const aiKillSwitch = new AiKillSwitchService();