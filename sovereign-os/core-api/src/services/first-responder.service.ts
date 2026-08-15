import path from 'path';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { securityStream } from './security-stream.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';

const prisma = new PrismaClient();

// ── First-Responder Mode (SOS) — รับมือเหตุฉุกเฉินกับหน่วยกู้ภัย ──
// เมื่อเปิดโหมดนี้:
//  - ระบบยังบันทึกภาพแบบ Honeypot เงียบ ๆ (Vision AI รันต่อแต่ไม่ alert) — กัน "Emergency Exploitation"
//  - บันทึกเป็น securityEvent + ส่ง real-time stream ให้ UI ทุกหน้าทราบ
//  - หมดอายุอัตโนมัติ (default 2 ชม.) — ไม่ลืมปิด
// Zero-Trust Emergency Activation (Phase 6 — ภัยที่ 1):
//  - source='physical' = กดปุ่มกลไกจริงในบ้าน (MQTT sovereign/{node}/emergency/button)
//  - source='api'      = SUPERADMIN กดผ่าน UI — ยอมรับได้ แต่ต้องมีหลักฐานคนในบ้าน (honeypot บังคับทำงาน)
//  - ห้าม trigger จากเซ็นเซอร์ระดับต่ำเดี่ยว ๆ / จากภายนอกบ้าน

export interface FirstResponderState {
  active: boolean;
  by: string;
  at: number | null;
  note: string;
  expiresAt: number | null;
  source: 'api' | 'physical' | 'system';
}

const STATE_FILE =
  process.env.FIRST_RESPONDER_FILE || path.resolve(process.cwd(), 'data', 'first-responder.json');

function loadState(): FirstResponderState {
  const { data } = readJsonVerified<FirstResponderState>(STATE_FILE);
  if (data) {
    return {
      active: !!data.active,
      by: typeof data.by === 'string' ? data.by : '',
      at: typeof data.at === 'number' ? data.at : null,
      note: typeof data.note === 'string' ? data.note : '',
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
      source: data.source === 'physical' ? 'physical' : data.source === 'api' ? 'api' : 'system',
    };
  }
  return { active: false, by: '', at: null, note: '', expiresAt: null, source: 'system' };
}

function saveState(state: FirstResponderState) {
  saveJsonAtomic(STATE_FILE, state);
}

class FirstResponderService {
  private state: FirstResponderState = { active: false, by: '', at: null, note: '', expiresAt: null, source: 'system' };

  init() {
    this.state = loadState();
    // ถ้าไฟล์บอก active อยู่แต่หมดอายุไปแล้ว → ปลดทันทีตอน boot
    if (this.state.active && this.state.expiresAt && Date.now() > this.state.expiresAt) {
      this.set(false, 'system', 'หมดอายุอัตโนมัติ (boot)');
    }
  }

  /** ตรวจ + ปลดเมื่อหมดอายุ (lazy expiry — เรียกผ่าน status()/isActive() ทุกครั้ง) */
  isActive(): boolean {
    if (this.state.active && this.state.expiresAt && Date.now() > this.state.expiresAt) {
      this.set(false, 'system', 'หมดอายุอัตโนมัติ');
    }
    return this.state.active;
  }

  status(): FirstResponderState & { remainingMs: number | null } {
    this.isActive(); // lazy expiry
    return {
      ...this.state,
      remainingMs: this.state.active && this.state.expiresAt ? this.state.expiresAt - Date.now() : null,
    };
  }

  /**
   * Zero-Trust: ปุ่มกลไกจริงในบ้านกด → source='physical' (เชื่อถือได้สูงสุด)
   * รับผ่าน MQTT sovereign/{nodeId}/emergency/button (payload 1/ON = เปิด, 0/OFF = ปิด)
   */
  async activatePhysical(nodeId: string, on: boolean): Promise<FirstResponderState> {
    return this.set(on, `physical:${nodeId}`, on ? 'ปุ่มฉุกเฉินกลไกในบ้าน' : 'ปุ่มฉุกเฉินกลไกปลด', on ? 'physical' : 'api');
  }

  async set(
    active: boolean,
    by: string,
    note: string,
    source: 'api' | 'physical' | 'system' = 'api'
  ): Promise<FirstResponderState> {
    const now = Date.now();
    this.state = {
      active,
      by: by || 'unknown',
      at: now,
      note: (note || '').trim().slice(0, 500),
      expiresAt: active ? now + config.nextgen.firstResponderDurationMs : null,
      source,
    };
    saveState(this.state);
    securityStream.push('FIRST_RESPONDER', { ...this.state });
    try {
      await prisma.securityEvent.create({
        data: {
          event_type: 'FIRST_RESPONDER',
          severity: active ? 'warning' : 'info',
          description: active
            ? `🚨 First-Responder Mode เปิด โดย ${this.state.by} [${source === 'physical' ? 'ปุ่มกลไกในบ้าน' : source === 'api' ? 'UI (SUPERADMIN)' : 'ระบบ'}]${this.state.note ? ` — ${this.state.note}` : ''} (หมดอายุ ${new Date(this.state.expiresAt!).toLocaleString('th-TH')})`
            : `🟢 First-Responder Mode ปิด โดย ${this.state.by}${this.state.note ? ` — ${this.state.note}` : ''}`,
          raw_data: { by: this.state.by, source },
        },
      });
    } catch (err) {
      console.error('First-responder event write error:', err instanceof Error ? err.message : err);
    }
    console.log(active ? `🚨 FIRST-RESPONDER MODE ON by ${this.state.by} (${source}, ${this.state.note})` : '🟢 First-responder mode off');
    return this.status();
  }
}

export const firstResponder = new FirstResponderService();