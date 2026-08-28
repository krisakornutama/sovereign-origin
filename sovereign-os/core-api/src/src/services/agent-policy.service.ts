// src/services/agent-policy.service.ts
//
// The AI agent's policy layer: tool registry, autonomy level, and the guards
// that stop the agent from issuing critical commands (blocking its own IP,
// killing system processes, ...). Guards run BEFORE execution at every
// autonomy level — even "autonomous" cannot bypass them.
import net from 'net';
import os from 'os';
import path from 'path';
import { config } from '../config';

export type AutonomyLevel = 'view' | 'suggest' | 'autonomous';
export type ToolKind = 'read-only' | 'action';

export interface AgentTool {
  kind: ToolKind;
  description: string;
}

// Central tool registry — single source of truth for what the agent can do.
export const AGENT_TOOLS: Record<string, AgentTool> = {
  // ---- read-only: allowed at every autonomy level ----
  getTelemetry: {
    kind: 'read-only',
    description: 'Latest sensor data (temperature, humidity, battery, water level, power)',
  },
  getEmergencyPlan: {
    kind: 'read-only',
    description: 'Emergency protocol for a given type (fire, flood, intrusion)',
  },
  getKnowledge: {
    kind: 'read-only',
    description: 'Search the offline survival manual (RAG)',
  },
  getNetworkConnections: {
    kind: 'read-only',
    description: 'List active network connections',
  },
  checkFirewall: {
    kind: 'read-only',
    description: 'Report firewall status',
  },
  getSecurityEvents: {
    kind: 'read-only',
    description: 'Recent security events from the database',
  },
  // ---- actions: guarded, gated by the autonomy level ----
  blockIP: {
    kind: 'action',
    description: 'Block an IP address at the firewall — args: { ip }',
  },
  unblockIP: {
    kind: 'action',
    description: 'Remove an existing firewall block — args: { ip }',
  },
  killProcess: {
    kind: 'action',
    description: 'Terminate a process — args: { pid } (positive integer) or { name } (exact process name)',
  },
};

// Processes that must never be killed — taking any of these down could
// disable the hub itself. Node runtimes are included because the core-api
// runs on them.
const DEFAULT_PROTECTED_PROCESSES = [
  'system',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'lsm',
  'svchost',
  'winmgmt',
  'spoolsv',
  'dwm',
  'fontdrvhost',
  'node',
  'tsx',
  'npm',
  'npx',
];

export interface AgentPolicyOptions {
  autonomy?: AutonomyLevel;
  protectedIps?: string[];
  protectedProcesses?: string[];
  approvalTtlMs?: number;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export class AgentPolicy {
  private autonomy: AutonomyLevel;
  private protectedIps: Set<string>;
  private protectedProcesses: Set<string>;
  private approvalTtlMs: number;
  // The server's own process name(s) — killing it would kill the agent.
  private ownProcessNames: Set<string>;

  constructor(opts: AgentPolicyOptions = {}) {
    this.autonomy = AgentPolicy.normalizeAutonomy(opts.autonomy ?? 'suggest');
    this.protectedIps = new Set(
      (opts.protectedIps ?? []).map((ip) => ip.trim().toLowerCase()).filter(Boolean)
    );
    // Store both the raw name and the ".exe"-stripped variant so lookups are
    // forgiving of "svchost" vs "svchost.exe".
    this.protectedProcesses = new Set(
      [...DEFAULT_PROTECTED_PROCESSES, ...(opts.protectedProcesses ?? [])]
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
        .flatMap((n) => [n, n.replace(/\.exe$/, '')])
    );
    this.approvalTtlMs = opts.approvalTtlMs ?? 15 * 60 * 1000;

    const base = path.basename(process.argv[1] || '').toLowerCase();
    this.ownProcessNames = new Set<string>();
    if (base) {
      this.ownProcessNames.add(base);
      this.ownProcessNames.add(base.replace(/\.(ts|js|mjs|cjs)$/, ''));
    }
  }

  static normalizeAutonomy(value: string): AutonomyLevel {
    if (value === 'view' || value === 'suggest' || value === 'autonomous') {
      return value;
    }
    throw new Error(
      `Invalid autonomy level "${value}" — must be one of: view, suggest, autonomous`
    );
  }

  // ---------- autonomy ----------

  getAutonomy(): AutonomyLevel {
    return this.autonomy;
  }

  setAutonomy(value: AutonomyLevel): void {
    this.autonomy = AgentPolicy.normalizeAutonomy(value);
  }

  getApprovalTtlMs(): number {
    return this.approvalTtlMs;
  }

  getProtectedIps(): string[] {
    return [...this.protectedIps];
  }

  getProtectedProcesses(): string[] {
    return [...this.protectedProcesses];
  }

  addProtectedIp(ip: string): void {
    this.protectedIps.add(ip.trim().toLowerCase());
  }

  // ---------- tool classification ----------

  isActionTool(tool: string): boolean {
    return AGENT_TOOLS[tool]?.kind === 'action';
  }

  isReadOnlyTool(tool: string): boolean {
    return AGENT_TOOLS[tool]?.kind === 'read-only';
  }

  // ---------- guards ----------

  guardAction(tool: string, args: any): GuardResult {
    switch (tool) {
      case 'blockIP':
        return this.guardBlockIp(args?.ip);
      case 'unblockIP':
        return this.guardUnblockIp(args?.ip);
      case 'killProcess':
        return this.guardKillProcess(args);
      default:
        return { allowed: true };
    }
  }

  private guardBlockIp(ip: unknown): GuardResult {
    if (typeof ip !== 'string' || ip.trim() === '') {
      return { allowed: false, reason: 'blockIP requires an "ip" argument' };
    }
    const family = net.isIP(ip);
    if (family === 0) {
      return { allowed: false, reason: `invalid IP address: "${ip}"` };
    }
    const normalized = ip.toLowerCase();

    if (family === 4) {
      const [a, b, c, d] = ip.split('.').map(Number);
      if (a === 127) {
        return { allowed: false, reason: `cannot block loopback address (${ip})` };
      }
      if (a === 0) {
        return { allowed: false, reason: `cannot block unspecified address (${ip})` };
      }
      if (a === 169 && b === 254) {
        return { allowed: false, reason: `cannot block link-local address (${ip})` };
      }
      if (a >= 224 && a <= 239) {
        return { allowed: false, reason: `cannot block multicast address (${ip})` };
      }
      if (a === 255 && b === 255 && c === 255 && d === 255) {
        return { allowed: false, reason: `cannot block broadcast address (${ip})` };
      }
    } else {
      if (normalized === '::' || normalized === '::0' || normalized === '0:0:0:0:0:0:0:0') {
        return { allowed: false, reason: `cannot block unspecified address (${ip})` };
      }
      if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
        return { allowed: false, reason: `cannot block loopback address (${ip})` };
      }
      if (normalized.startsWith('fe80:')) {
        return { allowed: false, reason: `cannot block link-local address (${ip})` };
      }
      if (normalized.startsWith('ff')) {
        return { allowed: false, reason: `cannot block multicast address (${ip})` };
      }
    }

    if (this.protectedIps.has(normalized)) {
      return { allowed: false, reason: `IP ${ip} is on the protected list` };
    }
    if (this.getOwnIps().has(normalized)) {
      return {
        allowed: false,
        reason: `IP ${ip} belongs to this host — blocking it would lock out the hub`,
      };
    }
    return { allowed: true };
  }

  private guardUnblockIp(ip: unknown): GuardResult {
    if (typeof ip !== 'string' || ip.trim() === '') {
      return { allowed: false, reason: 'unblockIP requires an "ip" argument' };
    }
    if (net.isIP(ip) === 0) {
      return { allowed: false, reason: `invalid IP address: "${ip}"` };
    }
    return { allowed: true };
  }

  private guardKillProcess(args: any): GuardResult {
    const pid = args?.pid;
    const name = args?.name;

    if (pid !== undefined && pid !== null) {
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
        return { allowed: false, reason: `invalid pid: "${pid}" — must be a positive integer` };
      }
      if (pid < 5) {
        return { allowed: false, reason: `pid ${pid} is a system-critical process` };
      }
      if (pid === process.pid) {
        return { allowed: false, reason: `pid ${pid} is the AI agent's own process` };
      }
      return { allowed: true };
    }

    if (typeof name === 'string' && name.trim() !== '') {
      const trimmed = name.trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        return {
          allowed: false,
          reason: `invalid process name "${trimmed}" — no paths or wildcards allowed`,
        };
      }
      const normalized = trimmed.toLowerCase().replace(/\.exe$/, '');
      if (this.protectedProcesses.has(normalized)) {
        return { allowed: false, reason: `process "${trimmed}" is protected` };
      }
      if (this.ownProcessNames.has(normalized) || this.ownProcessNames.has(trimmed.toLowerCase())) {
        return { allowed: false, reason: `process "${trimmed}" is the AI agent's own process` };
      }
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'killProcess requires either a numeric "pid" or an exact process "name"',
    };
  }

  // Host addresses are computed live — if the hub's own IP changes, the
  // guard still protects it. Loopback is handled above; here we only need
  // the non-internal (real) addresses.
  private getOwnIps(): Set<string> {
    const own = new Set<string>();
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const addr of addrs || []) {
        if (!addr.internal) own.add(addr.address.toLowerCase());
      }
    }
    return own;
  }
}

// Singleton backed by environment configuration (see src/config/index.ts).
export const agentPolicy = new AgentPolicy({
  autonomy: config.agent.autonomy,
  protectedIps: config.agent.protectedIps,
  protectedProcesses: config.agent.protectedProcesses,
  approvalTtlMs: config.agent.approvalTtlMs,
});
