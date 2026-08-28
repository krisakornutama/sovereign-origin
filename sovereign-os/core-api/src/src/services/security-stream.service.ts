import { EventEmitter } from 'events';

// ── Security Real-time Event Stream (Pillar — SOC live feed) ──
// SSE hub: รับ event จากทุก service (anomaly, IDS, kill-switch, intel, app control, ...)
// แล้วกระจายไปยัง client ที่ subscribe ผ่าน GET /api/security/nextgen/events

export type SecurityStreamType =
  | 'KILL_SWITCH'
  | 'THREAT'
  | 'IDS_ALERT'
  | 'INTEL_UPDATE'
  | 'APP_CONTROL'
  | 'DNS_BLOCK'
  | 'DNS_ALLOW'
  | 'AI_ANALYSIS'
  | 'MALWARE_DETECTED'
  | 'FIRST_RESPONDER'
  | 'REALITY'
  | 'DRILL'
  | 'LIVING_MODE'
  | 'MANUAL_DAY'
  | 'TIME_DESYNC'
  | 'RELAY_CHATTER'
  | 'BIT_ROT'
  | 'INJECTION'
  | 'GOVSIM'
  | 'GOVERNOR'
  | 'SYSTEM'
  | 'ACTUATION'
  | 'MESH'
  | 'DMS';

export interface SecurityStreamEvent {
  type: SecurityStreamType;
  data: any;
  ts: number;
}

const REPLAY_LIMIT = 50;

class SecurityStreamService {
  private emitter = new EventEmitter();
  private lastEvents: SecurityStreamEvent[] = [];

  constructor() {
    // SSE สามารถมี client ได้หลายตัวพร้อมกัน (กัน warning MaxListeners)
    this.emitter.setMaxListeners(1000);
  }

  push(type: SecurityStreamType, data: any) {
    const evt: SecurityStreamEvent = { type, data, ts: Date.now() };
    this.lastEvents.push(evt);
    if (this.lastEvents.length > REPLAY_LIMIT) this.lastEvents.shift();
    this.emitter.emit('event', evt);
  }

  subscribe(cb: (evt: SecurityStreamEvent) => void): () => void {
    this.emitter.on('event', cb);
    let alive = true;
    return () => {
      if (!alive) return;
      alive = false;
      this.emitter.off('event', cb);
    };
  }

  replay(): SecurityStreamEvent[] {
    return [...this.lastEvents];
  }

  listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}

export const securityStream = new SecurityStreamService();