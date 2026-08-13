// src/services/firewall-engine.service.ts
//
// Firewall Engine — กฎ allow/deny (ทิศทาง/โปรโตคอล/IP/พอร์ต) + จำแนกการเชื่อมต่อ
// "unknown" = การเชื่อมต่อที่ไม่ตรงกับกฎใดเลย → ตัดสินด้วยนโยบายเริ่มต้น
// และสร้างสคริปต์ netsh advfirewall เพื่อบังคับใช้กับ Windows Firewall จริง

export type RuleAction = 'ALLOW' | 'DENY';
export type RuleDirection = 'IN' | 'OUT' | 'BOTH';

export interface FirewallRule {
  id: string;
  name: string;
  action: RuleAction | string; // ALLOW | DENY (DB คืน string)
  direction: RuleDirection | string; // IN | OUT | BOTH
  protocol: string; // ANY | TCP | UDP | ICMP
  remote_ip: string | null; // IP หรือ CIDR
  remote_port: string | null; // พอร์ตหรือช่วง เช่น 443, 8000-8100
  local_port: string | null;
  priority: number; // เลขสูง = สำคัญก่อน
  description?: string | null;
  enabled?: boolean;
}

export interface NetConnection {
  protocol: string; // TCP | UDP
  local: string; // ip:port
  remote: string; // ip:port | *:*
  state: string;
  pid: string;
}

export interface ClassifyResult {
  action: RuleAction;
  rule: FirewallRule | null;
  label: 'ALLOWED' | 'BLOCKED' | 'UNKNOWN';
  message: string;
}

// ── IP / CIDR ──

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const c = String(cidr ?? '').trim();
  if (!c) return false;
  if (!c.includes('/')) return ip === c;
  const [net, prefixStr] = c.split('/');
  const prefix = Number(prefixStr);
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(net);
  if (ipInt == null || netInt == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

// ── port match ──

function portMatches(portStr: string | null, port: number | null): boolean {
  if (!portStr) return true; // กฎไม่จำกัดพอร์ต
  const s = String(portStr).trim();
  if (s.includes('-')) {
    const [a, b] = s.split('-').map((x) => Number(x.trim()));
    if (port != null && Number.isFinite(a) && Number.isFinite(b)) return port >= a && port <= b;
    return false;
  }
  const single = Number(s);
  return port != null && Number.isFinite(single) && port === single;
}

function parsePort(addr: string | null | undefined): number | null {
  if (!addr) return null;
  const idx = addr.lastIndexOf(':');
  if (idx < 0) return null;
  const p = Number(addr.slice(idx + 1));
  return Number.isFinite(p) ? p : null;
}

// ── netstat parse ──

export function parseNetstat(raw: string): NetConnection[] {
  const out: NetConnection[] = [];
  for (const line of String(raw ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(TCP|UDP|tcp|udp)\s+([^\s]+)\s+([^\s]+)\s+(?:([^\s]+)\s+)?(\d+)?/);
    if (!m) continue;
    out.push({
      protocol: m[1].toUpperCase(),
      local: m[2],
      remote: m[3],
      state: m[4] || '—',
      pid: m[5] || 'N/A',
    });
  }
  return out;
}

// ── classify ──

function ruleMatches(rule: FirewallRule, conn: NetConnection): boolean {
  const proto = conn.protocol.toUpperCase();
  if (rule.protocol !== 'ANY' && rule.protocol.toUpperCase() !== proto) return false;
  const remoteIp = conn.remote.split(':')[0];
  if (rule.remote_ip && !ipInCidr(remoteIp, rule.remote_ip)) return false;
  const remotePort = parsePort(conn.remote);
  if (!portMatches(rule.remote_port, remotePort)) return false;
  const localPort = parsePort(conn.local);
  if (!portMatches(rule.local_port, localPort)) return false;
  return true;
}

export function classifyConnection(
  conn: NetConnection,
  rules: FirewallRule[],
  defaultPolicy: RuleAction
): ClassifyResult {
  const enabled = rules.filter((r) => r.enabled !== false);    const sorted = [...enabled].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, conn)) {
      const action = rule.action === 'DENY' ? 'DENY' : 'ALLOW';
      return {
        action,
        rule,
        label: action === 'ALLOW' ? 'ALLOWED' : 'BLOCKED',
        message: `${action === 'ALLOW' ? 'อนุญาต' : 'บล็อก'}โดยกฎ "${rule.name}" (${rule.protocol} ${rule.direction})`,
      };
    }
  }
  return {
    action: defaultPolicy,
    rule: null,
    label: 'UNKNOWN',
    message: `ไม่ตรงกับกฎใด — นโยบายเริ่มต้น ${defaultPolicy === 'ALLOW' ? 'อนุญาต' : 'บล็อก'}`,
  };
}

/** evaluateConnection — เหมือน classify แต่ label UNKNOWN ชัดเจนสำหรับหน้า UI */
export function evaluateConnection(
  conn: NetConnection,
  rules: FirewallRule[],
  defaultPolicy: RuleAction
): ClassifyResult & { label: 'ALLOWED' | 'BLOCKED' | 'UNKNOWN' } {
  const r = classifyConnection(conn, rules, defaultPolicy);
  if (r.rule == null) {
    return {
      ...r,
      label: 'UNKNOWN',
      message: '⚠️ การเชื่อมต่อที่ไม่รู้จัก (unknown) — ไม่ตรงกับกฎ allowlist ใด',
    };
  }
  return r as ClassifyResult & { label: 'ALLOWED' | 'BLOCKED' | 'UNKNOWN' };
}

// ── host script (Windows Firewall ผ่าน netsh) ──

export function buildHostScript(rules: FirewallRule[], defaultPolicy: RuleAction): string {
  const lines: string[] = [];
  lines.push('@echo off');
  lines.push('REM ─────────────────────────────────────────────');
  lines.push('REM SOVEREIGN OS Firewall — สคริปต์บังคับใช้กับ Windows Firewall');
  lines.push('REM รันด้วยสิทธิ์ Administrator (คลิกขวา → Run as administrator)');
  lines.push('REM ─────────────────────────────────────────────');
  lines.push('REM ตั้งค่านโยบายเริ่มต้นสำหรับทุกโพรไฟล์');
  lines.push(`netsh advfirewall set allprofiles firewallpolicy blockinbound,${defaultPolicy === 'DENY' ? 'blockoutbound' : 'allowoutbound'}`);
  lines.push('');
  lines.push('REM ── กฎจากระบบ ──');
  const used = new Set<string>();
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const name = `SOV_${rule.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
    if (used.has(name)) continue;
    used.add(name);
    const direction = rule.direction === 'IN' ? 'in' : rule.direction === 'OUT' ? 'out' : 'in';
    const action = rule.action === 'ALLOW' ? 'allow' : 'block';
    const proto = rule.protocol === 'ANY' ? 'any' : rule.protocol.toLowerCase();
    let cmd = `netsh advfirewall firewall add rule name="${name}" dir=${direction} action=${action} protocol=${proto}`;
    if (rule.remote_ip) cmd += ` remoteip=${rule.remote_ip}`;
    if (rule.remote_port) cmd += ` remoteport=${rule.remote_port}`;
    if (rule.local_port) cmd += ` localport=${rule.local_port}`;
    cmd += ` profile=any`;
    lines.push(`REM ${rule.name}${rule.description ? ' — ' + rule.description : ''}`);
    lines.push(cmd);
    lines.push('');
  }
  lines.push('echo.');
  lines.push('echo ✅ นำกฎทั้งหมดไปใช้กับ Windows Firewall แล้ว');
  lines.push('pause');
  return lines.join('\r\n');
}

// ── รายงานสถานะ (แทนค่าฮาร์ดโค้ด unknown) ──

export function engineStatus(
  rules: FirewallRule[],
  defaultPolicy: RuleAction
): { engine: 'active' | 'inactive'; rules: number; enabledRules: number; defaultPolicy: RuleAction; note: string } {
  const enabled = rules.filter((r) => r.enabled !== false);
  return {
    engine: rules.length > 0 || defaultPolicy === 'DENY' ? 'active' : 'inactive',
    rules: rules.length,
    enabledRules: enabled.length,
    defaultPolicy,
    note:
      rules.length > 0
        ? `กฎ ${enabled.length}/${rules.length} รายการทำงาน — การเชื่อมต่อ unknown ถูก${defaultPolicy === 'DENY' ? 'บล็อก' : 'อนุญาต'}ตามนโยบายเริ่มต้น`
        : 'ยังไม่มีกฎ — ทุกอย่างเป็น unknown ผ่านนโยบายเริ่มต้น',
  };
}
