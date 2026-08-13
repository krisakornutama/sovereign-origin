// src/services/agent-actions.service.ts
//
// Executes the agent's ACTION tools for real (firewall rules / process kill)
// and enforces the autonomy level:
//   - view        → actions are denied outright
//   - suggest     → actions become pending approvals for a superadmin
//   - autonomous  → actions run immediately (guards still apply)
//
// Guards are re-run at approval time, not just at queue time, so a command
// that became dangerous while waiting can never execute.
import crypto from 'crypto';
import net from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentPolicy, agentPolicy } from './agent-policy.service';
import { AuditService } from './audit.service';

const execFileAsync = promisify(execFile);

// Who/what triggered the action — used for the audit trail.
export interface ActionContext {
  actor?: string; // userId that caused the action (chat user / UI user)
  source?: 'chat' | 'security-ui' | 'system-ui' | 'approval' | 'system';
  ip?: string;
}

type AuditEntry = { userId: string; actionType: string; payload: any };
type AuditFn = (entry: AuditEntry) => void;

export type ActionResult =
  | { status: 'ok'; result: string }
  | { status: 'denied'; reason: string }
  | { status: 'requires_approval'; approval_id: string; tool: string; args: any; reason: string };

export interface PendingApproval {
  id: string;
  tool: string;
  args: any;
  reason: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
  result?: string;
  decidedAt?: number;
}

// Payload sent to external notifiers (e.g. Telegram) when an action needs
// a superadmin's approval.
export interface ApprovalRequestInfo {
  tool: string;
  args: any;
  approval_id: string;
  source?: string;
}

// Thin adapter over the OS so tests can inject a fake. Commands use
// execFile (no shell) so validated arguments can never be interpreted
// by a shell.
export interface SystemExecutor {
  blockIp(ip: string): Promise<string>;
  unblockIp(ip: string): Promise<string>;
  killProcessByPid(pid: number): Promise<string>;
  killProcessByName(name: string): Promise<string>;
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 15000 });
    return (stdout || stderr || '').trim() || 'ok';
  } catch (err: any) {
    return `failed: ${err?.stderr?.trim() || err?.message || 'unknown error'}`;
  }
}

export const realSystemExecutor: SystemExecutor = {
  async blockIp(ip) {
    if (process.platform === 'win32') {
      // Windows Firewall — one named rule per IP so it can be removed later.
      const rule = `SovereignOS-AI-Block-${ip}`;
      const out = await run('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        `name=${rule}`,
        'dir=in',
        'action=block',
        `remoteip=${ip}`,
        'enable=yes',
      ]);
      return out.startsWith('failed')
        ? `⚠️ firewall block failed for ${ip}: ${out}`
        : `blocked ${ip} (inbound firewall rule "${rule}")`;
    }
    const tool = net.isIP(ip) === 6 ? 'ip6tables' : 'iptables';
    const out = await run(tool, ['-A', 'INPUT', '-s', ip, '-j', 'DROP']);
    return out.startsWith('failed')
      ? `⚠️ ${tool} block failed for ${ip}: ${out}`
      : `blocked ${ip} (${tool} INPUT DROP)`;
  },

  async unblockIp(ip) {
    if (process.platform === 'win32') {
      const rule = `SovereignOS-AI-Block-${ip}`;
      const out = await run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${rule}`]);
      return out.startsWith('failed')
        ? `⚠️ firewall unblock failed for ${ip}: ${out}`
        : `unblocked ${ip} (removed rule "${rule}")`;
    }
    const tool = net.isIP(ip) === 6 ? 'ip6tables' : 'iptables';
    const out = await run(tool, ['-D', 'INPUT', '-s', ip, '-j', 'DROP']);
    return out.startsWith('failed')
      ? `⚠️ ${tool} unblock failed for ${ip}: ${out}`
      : `unblocked ${ip} (removed ${tool} INPUT DROP)`;
  },

  async killProcessByPid(pid) {
    if (process.platform === 'win32') {
      const out = await run('taskkill', ['/F', '/PID', String(pid)]);
      return out.startsWith('failed')
        ? `⚠️ failed to kill pid ${pid}: ${out}`
        : `killed process ${pid}`;
    }
    const out = await run('kill', ['-9', String(pid)]);
    return out.startsWith('failed')
      ? `⚠️ failed to kill pid ${pid}: ${out}`
      : `killed process ${pid}`;
  },

  async killProcessByName(name) {
    if (process.platform === 'win32') {
      const out = await run('taskkill', ['/F', '/IM', name]);
      return out.startsWith('failed')
        ? `⚠️ failed to kill "${name}": ${out}`
        : `killed all "${name}" processes`;
    }
    // pkill -x matches the exact name (no prefix/suffix matching).
    const out = await run('pkill', ['-9', '-x', name]);
    return out.startsWith('failed')
      ? `⚠️ failed to kill "${name}": ${out}`
      : `killed all "${name}" processes`;
  },
};

export class AgentActionsService {
  private approvals = new Map<string, PendingApproval>();
  // IPs blocked through this service (in-memory — the actual firewall rules
  // live in netsh/iptables; this is a quick lookup for the UI).
  private blockedIps = new Set<string>();
  // Registered by the app (server.ts) — e.g. to ping Telegram when a
  // superadmin decision is needed. A failing notifier never breaks the queue.
  private approvalNotifier: ((info: ApprovalRequestInfo) => void) | null = null;

  /** Register a callback fired whenever a new approval request is queued. */
  onApprovalRequested(fn: (info: ApprovalRequestInfo) => void): void {
    this.approvalNotifier = fn;
  }

  constructor(
    private policy: AgentPolicy,
    private executor: SystemExecutor = realSystemExecutor,
    private audit: AuditFn = () => {} // injected so tests can spy; default no-op
  ) {}

  /** IPs currently blocked through this service, sorted. */
  listBlockedIps(): string[] {
    return [...this.blockedIps].sort();
  }

  // Audit trail: every action the agent takes (or attempts) is recorded so
  // there is a verifiable history of who asked for what and what happened.
  // A failing audit sink never blocks the action itself.
  private logAudit(actionType: string, payload: any, ctx: ActionContext = {}): void {
    try {
      this.audit({
        userId: ctx.actor || 'system',
        actionType,
        payload: {
          ...payload,
          source: ctx.source || 'system',
          ...(ctx.ip ? { ip: ctx.ip } : {}),
        },
      });
    } catch (err) {
      console.error('AI agent audit error:', err);
    }
  }

  // Returns:
  //   { status: 'ok', result }                — executed
  //   { status: 'denied', reason }            — blocked by guards or view mode
  //   { status: 'requires_approval', ... }    — queued, waiting for a superadmin
  async executeAction(tool: string, args: any, ctx: ActionContext = {}): Promise<ActionResult> {
    if (!this.policy.isActionTool(tool)) {
      this.logAudit('AI_AGENT_ACTION_DENIED', { tool, args, reason: `"${tool}" is not an action tool` }, ctx);
      return { status: 'denied', reason: `"${tool}" is not an action tool` };
    }

    // Guards always run first — they are autonomy-independent.
    const guard = this.policy.guardAction(tool, args);
    if (!guard.allowed) {
      this.logAudit('AI_AGENT_ACTION_DENIED', { tool, args, reason: guard.reason, autonomy: this.policy.getAutonomy() }, ctx);
      return { status: 'denied', reason: guard.reason! };
    }

    const autonomy = this.policy.getAutonomy();
    if (autonomy === 'view') {
      const reason = `autonomy level is "view" (read-only) — action tool "${tool}" is disabled until a superadmin switches to "suggest" or "autonomous"`;
      this.logAudit('AI_AGENT_ACTION_DENIED', { tool, args, reason, autonomy }, ctx);
      return { status: 'denied', reason };
    }
    if (autonomy === 'suggest') {
      const approval = this.createApproval(tool, args);
      this.logAudit('AI_AGENT_ACTION_REQUESTED', { tool, args, approval_id: approval.id, autonomy }, ctx);
      try {
        this.approvalNotifier?.({ tool, args, approval_id: approval.id, source: ctx.source });
      } catch (err) {
        console.error('AI agent approval notifier error:', err);
      }
      return {
        status: 'requires_approval',
        approval_id: approval.id,
        tool,
        args,
        reason: 'awaiting superadmin approval',
      };
    }

    // autonomous
    const result = await this.runTool(tool, args);
    this.recordBlockedState(tool, args, result);
    this.logAudit('AI_AGENT_ACTION_EXECUTED', { tool, args, result, autonomy }, ctx);
    return { status: 'ok', result };
  }

  async approveApproval(id: string, actor?: string): Promise<ActionResult> {
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== 'pending') {
      return { status: 'denied', reason: `approval "${id}" not found or already decided` };
    }

    const ctx: ActionContext = { actor, source: 'approval' };

    const ttlMs = this.policy.getApprovalTtlMs();
    if (Date.now() - approval.createdAt > ttlMs) {
      approval.status = 'rejected';
      approval.decidedAt = Date.now();
      this.logAudit('AI_AGENT_APPROVAL_DECIDED', { decision: 'rejected', approval_id: id, tool: approval.tool, args: approval.args, reason: 'expired' }, ctx);
      return { status: 'denied', reason: `approval "${id}" expired — command was not executed` };
    }

    // Defense in depth: re-run the guards at decision time.
    const guard = this.policy.guardAction(approval.tool, approval.args);
    if (!guard.allowed) {
      approval.status = 'rejected';
      approval.decidedAt = Date.now();
      this.logAudit('AI_AGENT_APPROVAL_DECIDED', { decision: 'rejected', approval_id: id, tool: approval.tool, args: approval.args, reason: guard.reason }, ctx);
      return {
        status: 'denied',
        reason: `command no longer passes the security guards: ${guard.reason}`,
      };
    }

    const result = await this.runTool(approval.tool, approval.args);
    approval.status = 'approved';
    approval.decidedAt = Date.now();
    approval.result = result;
    this.recordBlockedState(approval.tool, approval.args, result);
    this.logAudit('AI_AGENT_APPROVAL_DECIDED', { decision: 'approved', approval_id: id, tool: approval.tool, args: approval.args, result }, ctx);
    return { status: 'ok', result };
  }

  rejectApproval(id: string, actor?: string): ActionResult | null {
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== 'pending') return null;
    approval.status = 'rejected';
    approval.decidedAt = Date.now();
    this.logAudit(
      'AI_AGENT_APPROVAL_DECIDED',
      { decision: 'rejected', approval_id: id, tool: approval.tool, args: approval.args, reason: 'rejected by superadmin' },
      { actor, source: 'approval' }
    );
    return { status: 'denied', reason: 'approval rejected by superadmin' };
  }

  listApprovals(): PendingApproval[] {
    this.prune();
    return [...this.approvals.values()];
  }

  private createApproval(tool: string, args: any): PendingApproval {
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      tool,
      args,
      reason: 'superadmin approval required',
      createdAt: Date.now(),
      status: 'pending',
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  private async runTool(tool: string, args: any): Promise<string> {
    switch (tool) {
      case 'blockIP':
        return this.executor.blockIp(String(args.ip));
      case 'unblockIP':
        return this.executor.unblockIp(String(args.ip));
      case 'killProcess': {
        const pid = Number(args?.pid);
        if (Number.isInteger(pid) && pid > 0) {
          return this.executor.killProcessByPid(pid);
        }
        return this.executor.killProcessByName(String(args?.name));
      }
      default:
        return `unknown action tool "${tool}"`;
    }
  }

  // Keep the in-memory blocked list in sync with what actually succeeded.
  // Failed commands (the executors return strings containing "failed") are
  // never recorded.
  private recordBlockedState(tool: string, args: any, result: string): void {
    if (!result || result.includes('failed')) return;
    if (tool === 'blockIP' && typeof args?.ip === 'string') {
      this.blockedIps.add(args.ip.toLowerCase());
    } else if (tool === 'unblockIP' && typeof args?.ip === 'string') {
      this.blockedIps.delete(args.ip.toLowerCase());
    }
  }

  // Drop decided approvals older than the TTL so the queue cannot grow forever.
  private prune(): void {
    const ttlMs = this.policy.getApprovalTtlMs();
    const now = Date.now();
    for (const [id, approval] of this.approvals) {
      if (approval.status !== 'pending' && now - (approval.decidedAt ?? 0) > ttlMs) {
        this.approvals.delete(id);
      }
    }
  }
}

// The singleton writes every entry into the AuditService (fire-and-forget —
// a DB hiccup must never break a firewall command).
export const agentActions = new AgentActionsService(agentPolicy, realSystemExecutor, (entry) => {
  AuditService.logAction(entry).catch(() => {});
});
