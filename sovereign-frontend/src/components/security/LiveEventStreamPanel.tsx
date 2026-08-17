"use client";
import { useEffect, useState, useCallback } from 'react';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
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
  THREAT: 'alert-triangle', IDS_ALERT: 'alerts', KILL_SWITCH: 'x-circle', INTEL_UPDATE: 'database',
  APP_CONTROL: 'grid', DNS_BLOCK: 'shield', DNS_ALLOW: 'check-circle', AI_ANALYSIS: 'ai',
  FIRST_RESPONDER: 'heart-pulse', REALITY: 'eye', DRILL: 'target',
  LIVING_MODE: 'farm',
  TIME_DESYNC: 'clock', RELAY_CHATTER: 'zap', BIT_ROT: 'save', GOVSIM: 'governance',
};

type TFunc = (path: string, fallback?: string, vars?: Record<string, string | number>) => string;

function summarize(type: string, data: any, t: TFunc): string {
  switch (type) {
    case 'THREAT':
      return `[${data.severity}] ${data.description || 'anomaly'}${data.blocked ? ' — auto-blocked' : ''}`;
    case 'IDS_ALERT':
      return `[Suricata] ${data.signature || ''} ${t('securityComponents.stream.idsFrom', 'จาก')} ${data.sourceIp || '-'}${data.category ? ` (${data.category})` : ''}`;
    case 'KILL_SWITCH':
      return data.active
        ? t('securityComponents.stream.killEnabled', 'เปิดโดย {by} — {reason}', { by: data.by || 'unknown', reason: data.reason || '' })
        : t('securityComponents.stream.killReleased', 'ปลดล็อกโดย {by}', { by: data.by || 'unknown' });
    case 'INTEL_UPDATE':
      return data.action === 'add'
        ? t('securityComponents.stream.intelAdd', 'เพิ่ม IOC {type} {value}{cat}', { type: data.item?.type, value: data.item?.value, cat: data.item?.category ? ` (${data.item.category})` : '' })
        : t('securityComponents.stream.intelUpdate', 'อัปเดตฐาน IOC');
    case 'APP_CONTROL':
      return `${t(data.action === 'toggle' ? 'securityComponents.stream.appToggle' : 'securityComponents.stream.appChange', data.action === 'toggle' ? 'สลับ' : 'เปลี่ยน')} App ${data.appId} → ${data.blocked ? 'block' : 'unblock'}`;
    case 'DNS_BLOCK':
      return t('securityComponents.stream.dnsBlock', 'Block โดเมน {domain} ผ่าน Pi-hole + Threat DB', { domain: data.domain });
    case 'DNS_ALLOW':
      return t('securityComponents.stream.dnsAllow', 'ปลดบล็อกโดเมน {domain}', { domain: data.domain });
    case 'AI_ANALYSIS':
      return t('securityComponents.stream.aiSummary', 'AI Analyst สรุป: {stats}', {
        stats: data.stats ? t('securityComponents.stream.aiChecked', 'ตรวจ {n} เหตุการณ์', { n: data.stats.events24h }) : '—',
      });
    case 'FIRST_RESPONDER':
      return data.active
        ? t('securityComponents.stream.frEnabled', 'โหมดฉุกเฉินเปิด โดย {by}{note} (หมดอายุ {expires})', {
            by: data.by || 'unknown',
            note: data.note ? ` — ${data.note}` : '',
            expires: data.expiresAt ? new Date(data.expiresAt).toLocaleString(fmtLocale()) : '-',
          })
        : t('securityComponents.stream.frDisabled', 'โหมดฉุกเฉินปิด โดย {by}', { by: data.by || 'unknown' });
    case 'REALITY':
      return data.action === 'correct'
        ? t('securityComponents.stream.realityCorrect', 'ครอบครัวยืนยัน [{kind}] โดย {by} — {note}', { kind: data.kind, by: data.by || 'unknown', note: data.note || '' })
        : t('securityComponents.stream.realityUpdate', 'อัปเดต Paranoia Index');
    case 'DRILL':
      return `Chaos Drill: ${data.verdict} (${data.passed}/${data.total} checks)`;
    case 'LIVING_MODE':
      return data.active
        ? t('securityComponents.stream.livingOn', 'Living Mode เปิด โดย {by} — ระบบไม่เตือนรบกวนการใช้ชีวิต', { by: data.by || 'unknown' })
        : t('securityComponents.stream.livingOff', 'Living Mode ปิด (โดย {by})', { by: data.by || 'unknown' });
    case 'MANUAL_DAY':
      return data.active
        ? t('securityComponents.stream.manualOn', 'Manual Day เริ่ม โดย {by} — automation พัก {hours} ชม.', {
            by: data.by || 'unknown',
            hours: data.endsAt ? Math.max(0, Math.round((data.endsAt - data.ts) / 3600000)) : '',
          })
        : t('securityComponents.stream.manualOff', 'Manual Day จบ — ระบบอัตโนมัติกลับมา');
    case 'TIME_DESYNC':
      return t('securityComponents.stream.timeDesync', 'เวลาไม่เสถียร [{type}] {detail}', { type: data.type || '?', detail: data.detail || '' });
    case 'RELAY_CHATTER':
      return `Relay ${data.relayId || '?'} ${data.type === 'device_chatter' ? t('securityComponents.stream.relayChatter', 'ชิปสับถี่ (Hardware Chatter!)') : t('securityComponents.stream.relayTooFrequent', 'สั่งถี่เกิน')} — ${data.detail || ''}`;
    case 'BIT_ROT':
      return t('securityComponents.stream.bitRot', 'Bit Rot: checksum ไม่ตรง {file}{quarantine}', {
        file: data.file || '?',
        quarantine: data.quarantinedTo ? t('securityComponents.stream.bitRotQuarantined', ' → สำรองไว้แล้ว') : '',
      });
    case 'INJECTION':
      return t('securityComponents.stream.injectionBlocked', 'Prompt-Injection ถูกบล็อก ({patterns}) actor={actor}', {
        patterns: (data.patterns || []).join(', '),
        actor: data.actor || 'unknown',
      });
    case 'GOVSIM':
      return data.action === 'status'
        ? t('securityComponents.stream.govsimStatus', 'GovSim [{scenario}] เปลี่ยนสถานะ → {status} — {text}', { scenario: data.scenario, status: data.status, text: data.text || '' })
        : t('securityComponents.stream.govsimTick', 'GovSim [{scenario}] tick {tick}{events}', {
            scenario: data.scenario,
            tick: data.tick,
            events: data.events?.length ? ': ' + data.events.join(' | ') : '',
          });
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
  const t = useLanguageStore((s) => s.t);

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
    conn === 'live' ? t('securityComponents.stream.connLive', 'เชื่อมต่อสด') :
    conn === 'connecting' ? t('securityComponents.stream.connConnecting', 'กำลังเชื่อมต่อ...') :
    conn === 'offline' ? t('securityComponents.stream.connOffline', 'ขาดการเชื่อมต่อ (กำลังพยายามใหม่)') : t('securityComponents.stream.connOff', 'ปิดอยู่');

  return (
    <div className="panel panel-cyan p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
          {t('securityComponents.stream.title', 'เหตุการณ์สด (Real-time Stream)')}
          <span className="ml-2 text-[10px] text-gray-500 font-normal">{t('securityComponents.stream.titleSub', '— anomaly / IDS / kill-switch / intel เกิดเมื่อไหร่โผล่ทันที')}</span>
        </h2>
        <span className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border border-gray-700 ${conn === 'live' ? 'text-emerald-300' : 'text-gray-500'}`}>
          <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
        </span>
      </div>
      <div className="log-stream space-y-1 max-h-72 overflow-y-auto pr-1">
        {events.length === 0 && (
          <div className="text-xs text-gray-600 py-4 text-center">
            {t('securityComponents.stream.empty', 'ยังไม่มีเหตุการณ์สด — เหตุการณ์ใหม่ (anomaly, IDS alert, kill-switch, ...) จะแสดงที่นี่ทันที')}
          </div>
        )}
        {events.map((e, i) => (
          <div key={`${e.ts}-${i}`} className={`flex items-start gap-2 text-[11px] rounded px-2 py-1.5 border ${colorOf(e.type, e.data)}`}>
            <span className="font-mono whitespace-nowrap text-[10px] opacity-70 glow-text-cyan">{new Date(e.ts).toLocaleTimeString(fmtLocale())}</span>
            <span className="shrink-0 w-4 text-center pt-px">{TYPE_ICON[e.type] ? <Icon name={TYPE_ICON[e.type]} size={12} /> : null}</span>
            <span className="font-bold">{e.type}</span>
            <span className="flex-1 truncate">{summarize(e.type, e.data, t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}