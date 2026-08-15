"use client";
import { useEffect, useState, useCallback } from 'react';
import type { KillSwitchState } from './KillSwitchCard';

export interface StreamEvent {
  type: string;
  data: any;
  ts: number;
}

const EVENT_TYPES = [
  'hello', 'ping',
  'KILL_SWITCH', 'THREAT', 'IDS_ALERT', 'INTEL_UPDATE', 'APP_CONTROL', 'DNS_BLOCK', 'DNS_ALLOW', 'AI_ANALYSIS',
  'FIRST_RESPONDER', 'REALITY', 'DRILL', 'LIVING_MODE', 'MANUAL_DAY',
  'TIME_DESYNC', 'RELAY_CHATTER', 'BIT_ROT', 'INJECTION', 'GOVSIM',
] as const;

const TYPE_ICON: Record<string, string> = {
  THREAT: '🚨', IDS_ALERT: '🛰️', KILL_SWITCH: '⛔', INTEL_UPDATE: '🧬',
  APP_CONTROL: '📱', DNS_BLOCK: '🚫', DNS_ALLOW: '✅', AI_ANALYSIS: '🤖',
  FIRST_RESPONDER: '🚑', REALITY: '🧠', DRILL: '🧯',
  LIVING_MODE: '🌿', MANUAL_DAY: '🤚',
  TIME_DESYNC: '⏰', RELAY_CHATTER: '⚡', BIT_ROT: '💾', INJECTION: '🧪', GOVSIM: '🏛️',
};

function summarize(type: string, data: any): string {
  switch (type) {
    case 'THREAT':
      return `[${data.severity}] ${data.description || 'anomaly'}${data.blocked ? ' — 🚫 auto-blocked' : ''}`;
    case 'IDS_ALERT':
      return `[Suricata] ${data.signature || ''} จาก ${data.sourceIp || '-'}${data.category ? ` (${data.category})` : ''}`;
    case 'KILL_SWITCH':
      return data.active
        ? `เปิดโดย ${data.by || 'unknown'} — ${data.reason || ''}`
        : `ปลดล็อกโดย ${data.by || 'unknown'}`;
    case 'INTEL_UPDATE':
      return data.action === 'add'
        ? `เพิ่ม IOC ${data.item?.type} ${data.item?.value}${data.item?.category ? ` (${data.item.category})` : ''}`
        : 'อัปเดตฐาน IOC';
    case 'APP_CONTROL':
      return `${data.action === 'toggle' ? 'สลับ' : 'เปลี่ยน'} App ${data.appId} → ${data.blocked ? 'block' : 'unblock'}`;
    case 'DNS_BLOCK':
      return `Block โดเมน ${data.domain} ผ่าน Pi-hole + Threat DB`;
    case 'DNS_ALLOW':
      return `ปลดบล็อกโดเมน ${data.domain}`;
    case 'AI_ANALYSIS':
      return `AI Analyst สรุป: ${data.stats ? `ตรวจ ${data.stats.events24h} เหตุการณ์` : '—'}`;
    case 'FIRST_RESPONDER':
      return data.active
        ? `โหมดฉุกเฉินเปิด โดย ${data.by || 'unknown'}${data.note ? ` — ${data.note}` : ''} (หมดอายุ ${data.expiresAt ? new Date(data.expiresAt).toLocaleString('th-TH') : '-'})`
        : `โหมดฉุกเฉินปิด โดย ${data.by || 'unknown'}`;
    case 'REALITY':
      return data.action === 'correct'
        ? `ครอบครัวยืนยัน [${data.kind}] โดย ${data.by || 'unknown'} — ${data.note || ''}`
        : 'อัปเดต Paranoia Index';
    case 'DRILL':
      return `Chaos Drill: ${data.verdict} (${data.passed}/${data.total} checks)`;
    case 'LIVING_MODE':
      return data.active
        ? `Living Mode เปิด โดย ${data.by || 'unknown'} — ระบบไม่เตือนรบกวนการใช้ชีวิต`
        : `Living Mode ปิด (โดย ${data.by || 'unknown'})`;
    case 'MANUAL_DAY':
      return data.active
        ? `Manual Day เริ่ม โดย ${data.by || 'unknown'} — automation พัก ${data.endsAt ? Math.max(0, Math.round((data.endsAt - data.ts) / 3600000)) : ''} ชม.`
        : `Manual Day จบ — ระบบอัตโนมัติกลับมา`;
    case 'TIME_DESYNC':
      return `⏰ เวลาไม่เสถียร [${data.type || '?'}] ${data.detail || ''}`;
    case 'RELAY_CHATTER':
      return `⚡ Relay ${data.relayId || '?'} ${data.type === 'device_chatter' ? 'ชิปสับถี่ (Hardware Chatter!)' : 'สั่งถี่เกิน'} — ${data.detail || ''}`;
    case 'BIT_ROT':
      return `💾 Bit Rot: checksum ไม่ตรง ${data.file || '?'}${data.quarantinedTo ? ' → สำรองไว้แล้ว' : ''}`;
    case 'INJECTION':
      return `🧪 Prompt-Injection ถูกบล็อก (${(data.patterns || []).join(', ')}) actor=${data.actor || 'unknown'}`;
    case 'GOVSIM':
      return data.action === 'status'
        ? `🏛️ GovSim [${data.scenario}] เปลี่ยนสถานะ → ${data.status} — ${data.text || ''}`
        : `🏛️ GovSim [${data.scenario}] tick ${data.tick}${data.events?.length ? ': ' + data.events.join(' | ') : ''}`;
    default:
      return JSON.stringify(data).slice(0, 120);
  }
}

function colorOf(type: string, data: any): string {
  if (type === 'KILL_SWITCH' && data.active) return 'text-red-300 border-red-800 bg-red-950/40';
  if (type === 'FIRST_RESPONDER' && data.active) return 'text-red-300 border-red-800 bg-red-950/40';
  if (type === 'THREAT') return data.severity === 'critical' ? 'text-red-300 border-red-800 bg-red-950/40' : 'text-amber-300 border-amber-800 bg-amber-950/30';
  if (type === 'IDS_ALERT') return 'text-red-300 border-red-800 bg-red-950/40';
  if (type === 'DNS_BLOCK' || type === 'APP_CONTROL') return 'text-orange-300 border-orange-800 bg-orange-950/30';
  if (type === 'DRILL') return data.verdict === 'FAIL' ? 'text-red-300 border-red-800 bg-red-950/40' : data.verdict === 'DEGRADED' ? 'text-amber-300 border-amber-800 bg-amber-950/30' : 'text-emerald-300 border-emerald-800 bg-emerald-950/30';
  if (type === 'MANUAL_DAY' && data.active) return 'text-amber-300 border-amber-800 bg-amber-950/30';
  if (type === 'TIME_DESYNC' || type === 'BIT_ROT') return 'text-red-300 border-red-800 bg-red-950/40';
  if (type === 'RELAY_CHATTER' || type === 'INJECTION') return 'text-orange-300 border-orange-800 bg-orange-950/30';
  if (type === 'GOVSIM') return data.action === 'status' && (data.status === 'civil_war' || data.status === 'collapsed') ? 'text-red-300 border-red-800 bg-red-950/40' : data.action === 'status' ? 'text-blue-300 border-blue-800 bg-blue-950/30' : 'text-violet-300 border-violet-800 bg-violet-950/30';
  return 'text-gray-200 border-gray-700 bg-gray-900/40';
}

type ConnState = 'off' | 'connecting' | 'live' | 'offline';

export default function LiveEventStreamPanel({
  apiBase,
  token,
  onKillSwitch,
  onFirstResponder,
}: {
  apiBase: string;
  token: string | null;
  onKillSwitch?: (state: KillSwitchState) => void;
  onFirstResponder?: (state: any) => void;
}) {
  const [conn, setConn] = useState<ConnState>('off');
  const [events, setEvents] = useState<StreamEvent[]>([]);

  const prepend = useCallback((evt: StreamEvent) => {
    setEvents((prev) => {
      const dup = evt.type !== 'hello' && prev.some((e) => e.type === evt.type && e.ts === evt.ts);
      return dup ? prev : [evt, ...prev].slice(0, 50);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${apiBase}/api/security/nextgen/events?token=${encodeURIComponent(token)}`);
    setConn('connecting');
    es.onopen = () => setConn('live');
    es.onerror = () => setConn(es.readyState === EventSource.CLOSED ? 'off' : 'offline');

    const handler = (type: string) => (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (type === 'hello') {
          const replay: StreamEvent[] = (data.replay || []).filter(
            (r: any) => r && r.type && r.type !== 'hello' && r.type !== 'ping'
          );
          if (replay.length) {
            setEvents((prev) => {
              const merged = [...prev];
              for (const r of replay) {
                if (!merged.some((e) => e.type === r.type && e.ts === r.ts)) merged.push(r);
              }
              return merged.sort((a, b) => b.ts - a.ts).slice(0, 50);
            });
          }
          return;
        }
        if (type === 'ping') return;
        const evt: StreamEvent = { type, data, ts: data.ts || Date.now() };
        if (type === 'KILL_SWITCH') onKillSwitch?.(data);
        if (type === 'FIRST_RESPONDER') onFirstResponder?.(data);
        prepend(evt);
      } catch {
        // ข้าม event ที่ parse ไม่ได้
      }
    };

    const unsubs = EVENT_TYPES.map((n) => {
      es.addEventListener(n, handler(n));
      return n;
    });
    return () => {
      unsubs.forEach((n) => es.removeEventListener(n, handler(n)));
      es.close();
      setConn('off');
    };
  }, [apiBase, token, onKillSwitch, onFirstResponder, prepend]);

  const dot =
    conn === 'live' ? 'bg-emerald-500 animate-pulse' :
    conn === 'connecting' ? 'bg-amber-500 animate-pulse' :
    conn === 'offline' ? 'bg-red-500' : 'bg-gray-600';

  const label =
    conn === 'live' ? 'เชื่อมต่อสด' :
    conn === 'connecting' ? 'กำลังเชื่อมต่อ...' :
    conn === 'offline' ? 'ขาดการเชื่อมต่อ (กำลังพยายามใหม่)' : 'ปิดอยู่';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">
          📡 เหตุการณ์สด (Real-time Stream)
          <span className="ml-2 text-[10px] text-gray-500 font-normal">— anomaly / IDS / kill-switch / intel เกิดเมื่อไหร่โผล่ทันที</span>
        </h2>
        <span className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border border-gray-700 ${conn === 'live' ? 'text-emerald-300' : 'text-gray-500'}`}>
          <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
        </span>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {events.length === 0 && (
          <div className="text-xs text-gray-600 py-4 text-center">
            ยังไม่มีเหตุการณ์สด — เหตุการณ์ใหม่ (anomaly, IDS alert, kill-switch, ...) จะแสดงที่นี่ทันที
          </div>
        )}
        {events.map((e, i) => (
          <div key={`${e.ts}-${i}`} className={`flex items-start gap-2 text-[11px] rounded px-2 py-1.5 border ${colorOf(e.type, e.data)}`}>
            <span className="font-mono whitespace-nowrap text-[10px] opacity-70">{new Date(e.ts).toLocaleTimeString('th-TH')}</span>
            <span>{TYPE_ICON[e.type] || '▪️'}</span>
            <span className="font-bold">{e.type}</span>
            <span className="flex-1 truncate">{summarize(e.type, e.data)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}