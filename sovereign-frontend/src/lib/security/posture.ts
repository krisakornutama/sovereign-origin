// security posture — ตรรกะของแผง "ภาพรวมความปลอดภัย" (ใช้จริงทั้งหน้า /security)
//
// หลักการเดียวกับฝั่ง backend: "อ่านไม่ได้" ≠ "ปกติ"
// จุดที่ต้องระวังเป็นพิเศษ: เซิร์ฟเวอร์อาจสรุป overall มาแล้ว แต่ UI ต้องคำนวณเองจาก
// state ของแต่ละแหล่ง เพราะถ้า payload ขัดแย้งกัน (บอก ok ทั้งที่มีแหล่งล้ม) การเชื่อ
// ตัวเลขสรุปจะทำให้หน้าเขียวปลอม — ซึ่งเป็นสิ่งที่ SEC-045/041 ต้องการกำจัด

export type PostureState = 'ok' | 'unavailable';
export type PostureOverall = 'ok' | 'degraded' | 'unavailable';

export interface PostureSource<M> {
  state: PostureState;
  /** เหตุผลที่อ่านไม่ได้ (null เมื่อ ok) */
  reason: string | null;
  /** รหัส error จาก Prisma เช่น P2010 — ไม่มีข้อความลับ */
  code: string | null;
  /** รายละเอียดที่ปิดความลับแล้ว */
  detail: string | null;
  /** null เสมอเมื่อ state = unavailable */
  metrics: M | null;
}

export interface PostureAccounts {
  total: number;
  withoutMfa: number;
  mustChangePassword: number;
}
export interface PostureBruteForce {
  blocks: number;
}
export interface PostureEvents {
  critical: number;
  warning: number;
  total: number;
}
export interface PostureFirewall {
  rulesEnabled: number;
  rulesTotal: number;
  defaultPolicy: string | null;
}
export interface PostureThreatIntel {
  active: number;
  lastUpdated: string | null;
}
export interface PostureAudit {
  entries: number;
  oldest: string | null;
}

export interface SecurityPosture {
  checkedAt: string;
  overall: PostureOverall;
  available: number;
  unavailable: number;
  sources: {
    accounts: PostureSource<PostureAccounts>;
    bruteForce24h: PostureSource<PostureBruteForce>;
    securityEvents24h: PostureSource<PostureEvents>;
    firewall: PostureSource<PostureFirewall>;
    threatIntel: PostureSource<PostureThreatIntel>;
    auditTrail: PostureSource<PostureAudit>;
  };
}

export const POSTURE_SOURCES = [
  'accounts',
  'bruteForce24h',
  'securityEvents24h',
  'firewall',
  'threatIntel',
  'auditTrail',
] as const;

export type PostureSourceKey = (typeof POSTURE_SOURCES)[number];

const STATES: readonly string[] = ['ok', 'unavailable'];

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** แปลง payload จาก API เป็นโครงที่ UI ใช้ — คืน null เมื่อเชื่อถือไม่ได้ */
export function parsePosture(input: unknown): SecurityPosture | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, any>;
  const rawSources = raw.sources;
  if (!rawSources || typeof rawSources !== 'object') return null;
  if (typeof raw.checkedAt !== 'string' || Number.isNaN(Date.parse(raw.checkedAt))) return null;

  const sources: Record<string, PostureSource<unknown>> = {};
  for (const key of POSTURE_SOURCES) {
    const src = rawSources[key];
    if (!src || typeof src !== 'object') return null;
    if (!STATES.includes(String(src.state))) return null;
    const state = src.state as PostureState;
    sources[key] = {
      state,
      reason: str(src.reason),
      code: str(src.code),
      detail: str(src.detail),
      // แหล่งที่อ่านไม่ได้: ห้ามพกตัวเลขมาโชว์ (แม้ payload จะแถมมา)
      metrics: state === 'ok' && src.metrics && typeof src.metrics === 'object' ? src.metrics : null,
    };
  }

  // คำนวณสรุปเองจาก state — ไม่ใช้ raw.overall/available ที่เซิร์ฟเวอร์ส่งมา
  const states = POSTURE_SOURCES.map((k) => sources[k].state);
  const unavailable = states.filter((s) => s === 'unavailable').length;
  const available = states.length - unavailable;
  const overall: PostureOverall = unavailable === 0 ? 'ok' : available === 0 ? 'unavailable' : 'degraded';

  return {
    checkedAt: raw.checkedAt,
    overall,
    available,
    unavailable,
    sources: {
      accounts: withMetrics<PostureAccounts>(sources.accounts, (m) => ({
        total: num(m.total),
        withoutMfa: num(m.withoutMfa),
        mustChangePassword: num(m.mustChangePassword),
      })),
      bruteForce24h: withMetrics<PostureBruteForce>(sources.bruteForce24h, (m) => ({
        blocks: num(m.blocks),
      })),
      securityEvents24h: withMetrics<PostureEvents>(sources.securityEvents24h, (m) => ({
        critical: num(m.critical),
        warning: num(m.warning),
        total: num(m.total),
      })),
      firewall: withMetrics<PostureFirewall>(sources.firewall, (m) => ({
        rulesEnabled: num(m.rulesEnabled),
        rulesTotal: num(m.rulesTotal),
        defaultPolicy: str(m.defaultPolicy),
      })),
      threatIntel: withMetrics<PostureThreatIntel>(sources.threatIntel, (m) => ({
        active: num(m.active),
        lastUpdated: str(m.lastUpdated),
      })),
      auditTrail: withMetrics<PostureAudit>(sources.auditTrail, (m) => ({
        entries: num(m.entries),
        oldest: str(m.oldest),
      })),
    },
  };
}

function withMetrics<M>(
  src: PostureSource<unknown>,
  map: (raw: Record<string, any>) => M
): PostureSource<M> {
  return {
    state: src.state,
    reason: src.reason,
    code: src.code,
    detail: src.detail,
    metrics: src.state === 'ok' && src.metrics ? map(src.metrics as Record<string, any>) : null,
  };
}

export type PostureVariant = 'ok' | 'warn' | 'err' | 'info';

export function overallVariant(overall: PostureOverall): PostureVariant {
  return overall === 'ok' ? 'ok' : overall === 'degraded' ? 'warn' : 'err';
}

export function sourceVariant(state: PostureState): PostureVariant {
  return state === 'ok' ? 'ok' : 'err';
}

export interface PostureAttention {
  /** คีย์ i18n ใต้ security.posture.attention */
  key: string;
  severity: PostureVariant;
  vars?: Record<string, string | number>;
}

/**
 * รายการ "ต้องจัดการ" — ทุกใบต้องมาจากตัวเลขจริงใน posture
 * ถ้าไม่มีอะไรผิดจริง = [] (UI จะแสดงข้อความ "ไม่พบสิ่งที่ต้องจัดการ" เฉพาะตอน overall ok)
 */
export function postureAttention(p: SecurityPosture): PostureAttention[] {
  const out: PostureAttention[] = [];

  for (const key of POSTURE_SOURCES) {
    const src = p.sources[key];
    if (src.state === 'unavailable') {
      out.push({ key: 'sourceDown', severity: 'err', vars: { source: key } });
    }
  }

  const accounts = p.sources.accounts.metrics;
  if (accounts?.withoutMfa) {
    out.push({ key: 'withoutMfa', severity: 'warn', vars: { n: accounts.withoutMfa } });
  }
  if (accounts?.mustChangePassword) {
    out.push({ key: 'mustChangePassword', severity: 'warn', vars: { n: accounts.mustChangePassword } });
  }

  const events = p.sources.securityEvents24h.metrics;
  if (events?.critical) {
    out.push({ key: 'criticalEvents', severity: 'err', vars: { n: events.critical } });
  }

  const brute = p.sources.bruteForce24h.metrics;
  if (brute?.blocks) {
    out.push({ key: 'bruteForce', severity: 'warn', vars: { n: brute.blocks } });
  }

  const fw = p.sources.firewall.metrics;
  if (fw && fw.defaultPolicy !== 'DENY') {
    out.push({
      key: 'firewallDefaultAllow',
      severity: 'warn',
      vars: { policy: fw.defaultPolicy ?? '—' },
    });
  }
  if (fw && fw.rulesEnabled === 0) {
    out.push({ key: 'firewallNoRules', severity: 'warn', vars: { total: fw.rulesTotal } });
  }

  const intel = p.sources.threatIntel.metrics;
  if (intel && intel.active === 0) {
    out.push({ key: 'threatIntelEmpty', severity: 'info' });
  }

  const audit = p.sources.auditTrail.metrics;
  if (audit && audit.entries === 0) {
    out.push({ key: 'auditEmpty', severity: 'err' });
  }

  return out;
}
