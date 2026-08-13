import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import { AgentPolicy, AGENT_TOOLS } from '../src/services/agent-policy.service';

function makePolicy(overrides: Partial<ConstructorParameters<typeof AgentPolicy>[0]> = {}) {
  return new AgentPolicy({ autonomy: 'suggest', ...overrides });
}

function getOwnNonInternalIps(): string[] {
  const ips: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.internal) continue;
      ips.push(addr.address.toLowerCase());
    }
  }
  return ips;
}

test('rejects invalid autonomy level at construction', () => {
  assert.throws(() => new AgentPolicy({ autonomy: 'everything' as any }));
});

test('autonomy can be changed at runtime and invalid values are rejected', () => {
  const p = makePolicy();
  assert.strictEqual(p.getAutonomy(), 'suggest');
  p.setAutonomy('view');
  assert.strictEqual(p.getAutonomy(), 'view');
  p.setAutonomy('autonomous');
  assert.strictEqual(p.getAutonomy(), 'autonomous');
  assert.throws(() => p.setAutonomy('god-mode' as any));
});

test('tool classification separates read-only from action tools', () => {
  assert.strictEqual(AGENT_TOOLS.getTelemetry.kind, 'read-only');
  assert.strictEqual(AGENT_TOOLS.getKnowledge.kind, 'read-only');
  assert.strictEqual(AGENT_TOOLS.getNetworkConnections.kind, 'read-only');
  assert.strictEqual(AGENT_TOOLS.blockIP.kind, 'action');
  assert.strictEqual(AGENT_TOOLS.unblockIP.kind, 'action');
  assert.strictEqual(AGENT_TOOLS.killProcess.kind, 'action');
  const p = makePolicy();
  assert.strictEqual(p.isReadOnlyTool('getTelemetry'), true);
  assert.strictEqual(p.isReadOnlyTool('blockIP'), false);
  assert.strictEqual(p.isActionTool('killProcess'), true);
});

test('blockIP guard rejects invalid IP strings', () => {
  const p = makePolicy();
  for (const bad of ['', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '1.2.3.4:80', 'not-an-ip', ':::']) {
    assert.strictEqual(p.guardAction('blockIP', { ip: bad }).allowed, false, `should reject "${bad}"`);
  }
  assert.strictEqual(p.guardAction('blockIP', {}).allowed, false);
});

test('blockIP guard rejects loopback, link-local, multicast, broadcast and unspecified addresses', () => {
  const p = makePolicy();
  const bad = [
    '127.0.0.1', '127.255.255.254',
    '169.254.10.20',
    '224.0.0.251', '239.255.255.250',
    '255.255.255.255',
    '0.0.0.0',
    '::1', '::', 'fe80::1', 'ff02::1',
  ];
  for (const ip of bad) {
    assert.strictEqual(p.guardAction('blockIP', { ip }).allowed, false, `should reject ${ip}`);
  }
});

test('blockIP guard rejects this host’s own IPs (lockout protection)', () => {
  const p = makePolicy();
  const own = getOwnNonInternalIps();
  for (const ip of own) {
    assert.strictEqual(p.guardAction('blockIP', { ip }).allowed, false, `should reject own IP ${ip}`);
  }
});

test('blockIP guard rejects IPs on the protected list', () => {
  const p = makePolicy({ protectedIps: ['203.0.113.7', '192.168.1.1'] });
  assert.strictEqual(p.guardAction('blockIP', { ip: '203.0.113.7' }).allowed, false);
  assert.strictEqual(p.guardAction('blockIP', { ip: '192.168.1.1' }).allowed, false);
});

test('blockIP guard allows public IPs', () => {
  const p = makePolicy();
  for (const ip of ['8.8.8.8', '203.0.113.5', '2606:4700:4700::1111']) {
    assert.strictEqual(p.guardAction('blockIP', { ip }).allowed, true, `should allow ${ip}`);
  }
});

test('addProtectedIp protects an IP at runtime', () => {
  const p = makePolicy();
  assert.strictEqual(p.guardAction('blockIP', { ip: '8.8.8.8' }).allowed, true);
  p.addProtectedIp('8.8.8.8');
  assert.strictEqual(p.guardAction('blockIP', { ip: '8.8.8.8' }).allowed, false);
});

test('unblockIP guard validates the IP format but not the block policy', () => {
  const p = makePolicy();
  assert.strictEqual(p.guardAction('unblockIP', { ip: '8.8.8.8' }).allowed, true);
  assert.strictEqual(p.guardAction('unblockIP', { ip: '127.0.0.1' }).allowed, true);
  assert.strictEqual(p.guardAction('unblockIP', { ip: 'banana' }).allowed, false);
  assert.strictEqual(p.guardAction('unblockIP', {}).allowed, false);
});

test('killProcess guard rejects missing or invalid targets', () => {
  const p = makePolicy();
  assert.strictEqual(p.guardAction('killProcess', {}).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { pid: 0 }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { pid: -5 }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { pid: 1.5 }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { pid: 'abc' }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { pid: null }).allowed, false);
});

test('killProcess guard rejects system-critical and own pids', () => {
  const p = makePolicy();
  for (const pid of [1, 2, 3, 4]) {
    assert.strictEqual(p.guardAction('killProcess', { pid }).allowed, false, `pid ${pid}`);
  }
  assert.strictEqual(p.guardAction('killProcess', { pid: process.pid }).allowed, false);
});

test('killProcess guard allows ordinary pids', () => {
  const p = makePolicy();
  assert.strictEqual(p.guardAction('killProcess', { pid: process.pid + 1000 }).allowed, true);
});

test('killProcess guard rejects wildcard or path-containing names', () => {
  const p = makePolicy();
  for (const name of ['C:\\Windows\\System32\\svchost.exe', '/usr/bin/kill', '*.exe', 'node?', 'taskk*', 'a/b']) {
    assert.strictEqual(p.guardAction('killProcess', { name }).allowed, false, name);
  }
});

test('killProcess guard rejects protected process names', () => {
  const p = makePolicy();
  for (const name of ['svchost', 'svchost.exe', 'lsass', 'lsass.exe', 'winlogon', 'system', 'node', 'node.exe', 'tsx', 'npm']) {
    assert.strictEqual(p.guardAction('killProcess', { name }).allowed, false, name);
  }
});

test('killProcess guard allows ordinary process names', () => {
  const p = makePolicy();
  for (const name of ['notepad', 'notepad.exe', 'python', 'myapp']) {
    assert.strictEqual(p.guardAction('killProcess', { name }).allowed, true, name);
  }
});

test('killProcess guard respects configured protected processes (case-insensitive)', () => {
  const p = makePolicy({ protectedProcesses: ['mycriticalsvc'] });
  assert.strictEqual(p.guardAction('killProcess', { name: 'mycriticalsvc' }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { name: 'MyCriticalSvc' }).allowed, false);
  assert.strictEqual(p.guardAction('killProcess', { name: 'mycriticalsvc.exe' }).allowed, false);
});
