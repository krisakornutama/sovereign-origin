// TDD: Firewall engine — กฎ allow/deny + จำแนกการเชื่อมต่อ + สร้างสคริปต์ Windows Firewall
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNetstat,
  classifyConnection,
  evaluateConnection,
  ipInCidr,
  buildHostScript,
  type FirewallRule,
  type NetConnection,
} from '../src/services/firewall-engine.service';

test('ipInCidr matches exact and ranged IPs', () => {
  assert.ok(ipInCidr('192.168.1.5', '192.168.1.0/24'));
  assert.ok(ipInCidr('10.0.0.1', '10.0.0.1/32'));
  assert.ok(!ipInCidr('192.168.2.5', '192.168.1.0/24'));
});

test('parseNetstat extracts protocol, addresses, state, pid', () => {
  const raw = [
    'TCP    192.168.1.100:3001   10.12.55.5:54321   ESTABLISHED  1234',
    'UDP    0.0.0.0:5353         *:*               1274',
  ].join('\n');
  const conns = parseNetstat(raw);
  assert.equal(conns.length, 2);
  assert.equal(conns[0].protocol, 'TCP');
  assert.equal(conns[0].local, '192.168.1.100:3001');
  assert.equal(conns[0].remote, '10.12.55.5:54321');
  assert.equal(conns[0].state, 'ESTABLISHED');
  assert.equal(conns[0].pid, '1234');
});

test('classifyConnection honors DENY rules over ALLOW', () => {
  const rules: FirewallRule[] = [
    { id: 'r1', name: 'allow-lan', action: 'ALLOW', direction: 'IN', protocol: 'ANY', remote_ip: '192.168.1.0/24', remote_port: null, local_port: null, priority: 1 },
    { id: 'r2', name: 'block-bad', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '10.12.55.5', remote_port: null, local_port: null, priority: 2 },
  ];
  const c: NetConnection = { protocol: 'TCP', local: '192.168.1.100:3001', remote: '10.12.55.5:54321', state: 'ESTABLISHED', pid: '1234' };
  const r = classifyConnection(c, rules, 'ALLOW');
  assert.equal(r.action, 'DENY');
  assert.equal(r.rule?.name, 'block-bad');
});

test('classifyConnection uses default policy for unmatched (unknown) traffic', () => {
  const conn: NetConnection = { protocol: 'TCP', local: '127.0.0.1:8080', remote: '8.8.8.8:53', state: 'ESTABLISHED', pid: '999' };
  assert.equal(classifyConnection(conn, [], 'DENY').action, 'DENY');
  assert.equal(classifyConnection(conn, [], 'ALLOW').action, 'ALLOW');
});

test('evaluateConnection labels unknown connections that bypass the allowlist', () => {
  const allow: FirewallRule[] = [
    { id: 'r1', name: 'allow-telegram', action: 'ALLOW', direction: 'OUT', protocol: 'TCP', remote_ip: null, remote_port: '443', local_port: null, priority: 1 },
  ];
  const known = evaluateConnection({ protocol: 'TCP', local: '10.0.0.5:44322', remote: '149.154.167.50:443', state: 'ESTABLISHED', pid: '88' }, allow, 'DENY');
  assert.equal(known.label, 'ALLOWED');
  const unknown = evaluateConnection({ protocol: 'TCP', local: '10.0.0.5:44444', remote: '45.33.1.2:9999', state: 'ESTABLISHED', pid: '31337' }, allow, 'DENY');
  assert.equal(unknown.label, 'UNKNOWN');
  assert.ok(unknown.message.length > 0);
});

test('buildHostScript generates netsh advfirewall commands from rules', () => {
  const rules: FirewallRule[] = [
    { id: 'r1', name: 'block-bad', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '10.12.55.5', remote_port: null, local_port: null, priority: 2 },
  ];
  const script = buildHostScript(rules, 'DENY');
  assert.ok(script.includes('netsh advfirewall'));
  assert.ok(script.includes('block-bad'));
  assert.ok(script.includes('10.12.55.5'));
  assert.ok(script.includes('allprofiles firewallpolicy'));
  assert.ok(script.includes('REM') || script.includes('#')); // มีคำอธิบาย
});
