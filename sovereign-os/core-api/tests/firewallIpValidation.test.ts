// firewall block/unblock — รับเฉพาะ IP เดี่ยว และคำขอต้องไม่ค้าง
//
// 1) เดิม `ip` ถูกส่งต่อดิบ ๆ ไปถึง netsh/iptables ⇒ `0.0.0.0/0` (หรือ CIDR/ช่วง)
//    = block ทุกทราฟฟิกขาเข้า = ล็อกตัวเองออกจากระบบทั้งเครื่อง (ทำได้ด้วยคำขอเดียว
//    และพิมพ์ผิดครั้งเดียว) · ค่าที่ไม่ใช่ IP ก็ถูกส่งต่อให้เครื่องมือ OS ตีความเอง
// 2) handler เป็น async ที่ await `agentActions.executeAction` โดยไม่มี try/catch
//    ⇒ Express 4 ไม่ดัก async throw: executor โยนเมื่อไรคำขอค้างจน client timeout
//    (แทนที่จะได้ 500 ที่บอกความจริง)
import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import securityRoutes from '../src/modules/security/security.routes';
import { agentActions, realSystemExecutor } from '../src/services/agent-actions.service';
import { normalizeSingleIp } from '../src/lib/ip-address';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let calls: Array<{ tool: string; params: any }> = [];
let behavior: 'ok' | 'throw' = 'ok';
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'Content-Type': 'application/json' };

before(async () => {
  mock.method(agentActions, 'executeAction', async (tool: string, params: any) => {
    calls.push({ tool, params });
    if (behavior === 'throw') throw new Error('executor exploded');
    return { status: 'executed', result: 'ok' };
  });
  server = await createTestServer((app) => app.use('/api/security', securityRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

beforeEach(() => {
  calls = [];
  behavior = 'ok';
});

test('helper: IP เดี่ยวเท่านั้นที่ผ่าน (ไม่รับ CIDR/ช่วง/ชื่อโฮสต์)', () => {
  assert.equal(normalizeSingleIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeSingleIp('  203.0.113.7  '), '203.0.113.7');
  assert.equal(normalizeSingleIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeSingleIp('0.0.0.0/0'), null);
  assert.equal(normalizeSingleIp('192.168.1.0/24'), null);
  assert.equal(normalizeSingleIp('10.0.0.1-10.0.0.9'), null);
  assert.equal(normalizeSingleIp('example.com'), null);
  assert.equal(normalizeSingleIp('1.2.3.4; rm -rf /'), null);
  assert.equal(normalizeSingleIp(''), null);
  assert.equal(normalizeSingleIp(null), null);
});

test('block 0.0.0.0/0 ถูกปฏิเสธ (400) ก่อนถึง agentActions — ไม่ล็อกทั้งเครื่อง', async () => {
  const res = await fetch(server.baseUrl + '/api/security/firewall/block', {
    method: 'POST', headers: AUTH, body: JSON.stringify({ ip: '0.0.0.0/0' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /IP เดี่ยว/);
  assert.equal(calls.length, 0, 'ห้ามเรียก executor');
});

test('IP ที่มีอักขระแปลกถูกปฏิเสธ (400) และไม่ถึง executor', async () => {
  for (const ip of ['1.2.3.4; rm -rf /', '$(whoami)', '10.0.0.1-10.0.0.9', 'example.com']) {
    const res = await fetch(server.baseUrl + '/api/security/firewall/block', {
      method: 'POST', headers: AUTH, body: JSON.stringify({ ip }),
    });
    assert.equal(res.status, 400, ip);
  }
  assert.equal(calls.length, 0);
});

test('unblock ก็เข้มเดียวกัน (ไม่ให้ใส่ CIDR ไปลบกฎที่ไม่ตั้งใจ)', async () => {
  const res = await fetch(server.baseUrl + '/api/security/firewall/unblock', {
    method: 'POST', headers: AUTH, body: JSON.stringify({ ip: '0.0.0.0/0' }),
  });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('IP เดี่ยวที่ถูกต้องยังทำงานได้ (ส่งต่อ trimmed)', async () => {
  const res = await fetch(server.baseUrl + '/api/security/firewall/block', {
    method: 'POST', headers: AUTH, body: JSON.stringify({ ip: '  203.0.113.7 ' }),
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'blockIP');
  assert.equal(calls[0].params.ip, '203.0.113.7');
});

test('executor โยน error = 500 ทันที ไม่ใช่คำขอค้างจน timeout', async () => {
  behavior = 'throw';
  const res = await fetch(server.baseUrl + '/api/security/firewall/block', {
    method: 'POST', headers: AUTH, body: JSON.stringify({ ip: '203.0.113.7' }),
    signal: AbortSignal.timeout(4000),
  });
  assert.equal(res.status, 500);
  assert.ok(String((await res.json()).error).length > 0, 'ต้องบอกผู้ใช้ว่าล้ม');
});

test('realSystemExecutor ปฏิเสธค่าที่ไม่ใช่ IP เองด้วย (กันชั้นที่สอง ไม่เรียก netsh/iptables)', async () => {
  const out = await realSystemExecutor.blockIp('0.0.0.0/0');
  assert.match(out, /refus|ปฏิเสธ|not a single IP/i);
  const out2 = await realSystemExecutor.unblockIp('1.2.3.4; echo pwned');
  assert.match(out2, /refus|ปฏิเสธ|not a single IP/i);
});
