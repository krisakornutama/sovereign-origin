import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import { AgentPolicy } from '../src/services/agent-policy.service';
import { AgentActionsService, type SystemExecutor } from '../src/services/agent-actions.service';

function makeFakeExecutor(): SystemExecutor & { calls: string[] } {
  const calls: string[] = [];
  const executor: SystemExecutor & { calls: string[] } = {
    calls,
    async blockIp(ip) {
      calls.push(`blockIp:${ip}`);
      return `blocked ${ip}`;
    },
    async unblockIp(ip) {
      calls.push(`unblockIp:${ip}`);
      return `unblocked ${ip}`;
    },
    async killProcessByPid(pid) {
      calls.push(`killProcessByPid:${pid}`);
      return `killed ${pid}`;
    },
    async killProcessByName(name) {
      calls.push(`killProcessByName:${name}`);
      return `killed ${name}`;
    },
  };
  return executor;
}

function makeActions(autonomy: 'view' | 'suggest' | 'autonomous' = 'suggest') {
  const policy = new AgentPolicy({ autonomy });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor);
  return { policy, executor, service };
}

test('suggest mode queues an action as a pending approval and does not execute it', async () => {
  const { executor, service } = makeActions('suggest');
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'requires_approval');
  assert.strictEqual(executor.calls.length, 0);

  const approvals = service.listApprovals();
  assert.strictEqual(approvals.length, 1);
  assert.strictEqual(approvals[0].status, 'pending');
  assert.strictEqual(approvals[0].tool, 'blockIP');
  assert.ok(approvals[0].id);
});

test('approving a queued command executes it', async () => {
  const { executor, service } = makeActions('suggest');
  const result = await service.executeAction('killProcess', { pid: 12345 });
  assert.strictEqual(result.status, 'requires_approval');

  const approved = await service.approveApproval(result.approval_id!);
  assert.strictEqual(approved.status, 'ok');
  assert.deepStrictEqual(executor.calls, ['killProcessByPid:12345']);
  assert.strictEqual(service.listApprovals()[0].status, 'approved');
});

test('approve re-runs guards and rejects if the target became protected', async () => {
  const { policy, service } = makeActions('suggest');
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'requires_approval');

  policy.addProtectedIp('8.8.8.8');
  const approved = await service.approveApproval(result.approval_id!);
  assert.strictEqual(approved.status, 'denied');
  assert.match(approved.reason!, /no longer passes the security guards/i);
  assert.strictEqual(service.listApprovals()[0].status, 'rejected');
});

test('rejecting a queued command never executes it', async () => {
  const { executor, service } = makeActions('suggest');
  const result = await service.executeAction('unblockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'requires_approval');

  const rejected = service.rejectApproval(result.approval_id!);
  assert.ok(rejected);
  assert.strictEqual(rejected!.status, 'denied');
  assert.strictEqual(executor.calls.length, 0);
  assert.strictEqual(service.listApprovals()[0].status, 'rejected');
});

test('approving an unknown or already-decided id fails', async () => {
  const { service } = makeActions('suggest');
  const missing = await service.approveApproval('does-not-exist');
  assert.strictEqual(missing.status, 'denied');

  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  await service.approveApproval(result.approval_id!);
  const again = await service.approveApproval(result.approval_id!);
  assert.strictEqual(again.status, 'denied');
});

test('view mode denies action tools without queueing anything', async () => {
  const { executor, service } = makeActions('view');
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(executor.calls.length, 0);
  assert.strictEqual(service.listApprovals().length, 0);
});

test('autonomous mode executes action tools directly, guards still apply', async () => {
  const { executor, service } = makeActions('autonomous');
  const ok = await service.executeAction('killProcess', { pid: 12345 });
  assert.strictEqual(ok.status, 'ok');
  assert.deepStrictEqual(executor.calls, ['killProcessByPid:12345']);

  executor.calls.length = 0;
  const denied = await service.executeAction('blockIP', { ip: '127.0.0.1' });
  assert.strictEqual(denied.status, 'denied');
  assert.strictEqual(executor.calls.length, 0);
});

test('suggest mode still blocks dangerous targets before queueing', async () => {
  const { executor, service } = makeActions('suggest');
  const result = await service.executeAction('blockIP', { ip: '127.0.0.1' });
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(service.listApprovals().length, 0);
  assert.strictEqual(executor.calls.length, 0);
});

test('expired approvals cannot be approved', async () => {
  const policy = new AgentPolicy({ autonomy: 'suggest', approvalTtlMs: 5 });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor);
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'requires_approval');

  await new Promise((r) => setTimeout(r, 20));
  const approved = await service.approveApproval(result.approval_id!);
  assert.strictEqual(approved.status, 'denied');
  assert.match(approved.reason!, /expired/i);
  assert.strictEqual(executor.calls.length, 0);
});

test('tracks blocked IPs after successful execution and clears them on unblock', async () => {
  const { executor, service } = makeActions('autonomous');
  await service.executeAction('blockIP', { ip: '8.8.8.8' });
  await service.executeAction('blockIP', { ip: '203.0.113.5' });
  assert.deepStrictEqual(service.listBlockedIps(), ['203.0.113.5', '8.8.8.8']);

  executor.calls.length = 0;
  await service.executeAction('unblockIP', { ip: '8.8.8.8' });
  assert.deepStrictEqual(service.listBlockedIps(), ['203.0.113.5']);
});

test('tracks blocked IPs only after the approval is granted', async () => {
  const { service } = makeActions('suggest');
  const result = await service.executeAction('blockIP', { ip: '203.0.113.9' });
  assert.strictEqual(result.status, 'requires_approval');
  assert.deepStrictEqual(service.listBlockedIps(), []); // ยังไม่ถูก block จริง

  await service.approveApproval(result.approval_id!);
  assert.deepStrictEqual(service.listBlockedIps(), ['203.0.113.9']);
});

test('does not track IPs when the underlying command failed', async () => {
  const policy = new AgentPolicy({ autonomy: 'autonomous' });
  const executor: SystemExecutor = {
    async blockIp() {
      return '⚠️ firewall block failed: boom';
    },
    async unblockIp() {
      return 'unblocked';
    },
    async killProcessByPid() {
      return 'killed';
    },
    async killProcessByName() {
      return 'killed';
    },
  };
  const service = new AgentActionsService(policy, executor);
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(service.listBlockedIps(), []);
});

test('view mode never records blocked IPs', async () => {
  const { service } = makeActions('view');
  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'denied');
  assert.deepStrictEqual(service.listBlockedIps(), []);
});

test('records audit entry when an action is executed', async () => {
  const entries: any[] = [];
  const policy = new AgentPolicy({ autonomy: 'autonomous' });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor, (e) => entries.push(e));

  await service.executeAction('blockIP', { ip: '8.8.8.8' }, { actor: 'user-1', source: 'chat' });

  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].actionType, 'AI_AGENT_ACTION_EXECUTED');
  assert.strictEqual(entries[0].userId, 'user-1');
  assert.strictEqual(entries[0].payload.tool, 'blockIP');
  assert.strictEqual(entries[0].payload.args.ip, '8.8.8.8');
  assert.strictEqual(entries[0].payload.source, 'chat');
  assert.ok(entries[0].payload.result);
});

test('records audit entry when an action is denied', async () => {
  const entries: any[] = [];
  const policy = new AgentPolicy({ autonomy: 'view' });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor, (e) => entries.push(e));

  await service.executeAction('blockIP', { ip: '8.8.8.8' });

  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].actionType, 'AI_AGENT_ACTION_DENIED');
  assert.match(entries[0].payload.reason, /view/i);
});

test('records audit entries for queued approvals and their decision', async () => {
  const entries: any[] = [];
  const policy = new AgentPolicy({ autonomy: 'suggest' });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor, (e) => entries.push(e));

  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' }, { actor: 'user-1' });
  assert.strictEqual(result.status, 'requires_approval');
  assert.strictEqual(entries[0].actionType, 'AI_AGENT_ACTION_REQUESTED');
  assert.strictEqual(entries[0].payload.approval_id, result.approval_id);

  await service.approveApproval(result.approval_id!, 'admin-1');
  const decided = entries.find((e) => e.actionType === 'AI_AGENT_APPROVAL_DECIDED');
  assert.ok(decided);
  assert.strictEqual(decided.userId, 'admin-1');
  assert.strictEqual(decided.payload.decision, 'approved');
  assert.strictEqual(decided.payload.tool, 'blockIP');
});

test('records audit entry when an approval is rejected', async () => {
  const entries: any[] = [];
  const policy = new AgentPolicy({ autonomy: 'suggest' });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor, (e) => entries.push(e));

  const result = await service.executeAction('killProcess', { pid: 12345 }, { actor: 'user-1' });
  service.rejectApproval(result.approval_id!, 'admin-1');

  const decided = entries.find((e) => e.actionType === 'AI_AGENT_APPROVAL_DECIDED');
  assert.ok(decided);
  assert.strictEqual(decided.payload.decision, 'rejected');
  assert.strictEqual(decided.payload.tool, 'killProcess');
});

test('a broken audit sink never breaks action execution', async () => {
  const policy = new AgentPolicy({ autonomy: 'autonomous' });
  const executor = makeFakeExecutor();
  const service = new AgentActionsService(policy, executor, () => {
    throw new Error('audit db down');
  });

  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' });
  assert.strictEqual(result.status, 'ok');
});

test('calls the approval notifier when an action is queued', async () => {
  const { service } = makeActions('suggest');
  const notified: any[] = [];
  service.onApprovalRequested((info) => notified.push(info));

  const result = await service.executeAction('blockIP', { ip: '8.8.8.8' }, { source: 'chat' });
  assert.strictEqual(result.status, 'requires_approval');
  assert.strictEqual(notified.length, 1);
  assert.strictEqual(notified[0].approval_id, result.approval_id);
  assert.strictEqual(notified[0].tool, 'blockIP');
  assert.strictEqual(notified[0].source, 'chat');
});

test('a broken notifier never breaks queueing the approval', async () => {
  const { service } = makeActions('suggest');
  service.onApprovalRequested(() => {
    throw new Error('telegram down');
  });

  const result = await service.executeAction('killProcess', { pid: 12345 });
  assert.strictEqual(result.status, 'requires_approval');
  assert.ok(result.approval_id);
});
