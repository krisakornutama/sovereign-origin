// security posture — "ภาพรวมความปลอดภัย" ต้องมาจากของจริง และล้มเป็นรายแหล่ง
//
// หลักการเดียวกับ SEC-027/029/052: "อ่านไม่ได้" ≠ "ปกติ"
// endpoint นี้รวม 6 แหล่งข้อมูลจาก DB (ไม่ exec อะไรบนโฮสต์) แล้วบอกสถานะแยกแหล่ง
// ถ้าแหล่งใดอ่านไม่ได้ ต้องเป็น degraded + เหตุผล และ "ห้าม" สรุปเป็นเขียวทั้งหน้า
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import securityRoutes from '../src/modules/security/security.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

const d = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** ค่าเริ่มต้น = ทุกแหล่งตอบได้จริง (แต่ละเทสต์ override เฉพาะที่ต้องทดสอบ) */
function healthy() {
  return {
    userCount: async (args: any) => {
      const w = args?.where ?? {};
      if (w.mfa_secret === null) return 2; // ยังไม่เปิด MFA
      if (w.must_change_password === true) return 1; // ยังใช้รหัสชั่วคราว
      return 4; // บัญชีทั้งหมด
    },
    auditCount: async (args: any) => (args?.where?.action_type === 'RATE_LIMIT_BLOCK' ? 3 : 42),
    auditFindFirst: async () => ({ timestamp: d(120) }),
    eventCount: async (args: any) => {
      const sev = args?.where?.severity;
      if (sev === 'critical') return 1;
      if (sev === 'warning') return 5;
      return 9;
    },
    ruleCount: async (args: any) => (args?.where?.enabled === true ? 7 : 8),
    configFind: async () => ({ id: 1, default_policy: 'DENY', updated_at: d(1) }),
    intelCount: async () => 12,
    intelAgg: async () => ({ _max: { updated_at: d(2) } }),
  };
}

let db = healthy();

before(async () => {
  mockModel(prisma, 'user', {
    // auth middleware อ่านผู้ใช้จาก DB จริง — mock ต้องตอบ findUnique ด้วย ไม่งั้นได้ 503
    findUnique: async ({ where }: any) => ({
      id: where?.id ?? where?.username,
      username: 'posture-probe',
      role: 'SUPERADMIN',
      assigned_node_id: null,
      assigned_site_id: null,
      token_version: 0,
      must_change_password: false,
      deleted_at: null,
    }),
    count: async (a: any) => db.userCount(a),
  });
  mockModel(prisma, 'auditLog', {
    count: async (a: any) => db.auditCount(a),
    findFirst: async (a: any) => db.auditFindFirst(a),
  });
  mockModel(prisma, 'securityEvent', { count: async (a: any) => db.eventCount(a) });
  mockModel(prisma, 'firewallRule', { count: async (a: any) => db.ruleCount(a) });
  mockModel(prisma, 'firewallConfig', { findUnique: async (a: any) => db.configFind(a) });
  mockModel(prisma, 'threatIntelItem', {
    count: async (a: any) => db.intelCount(a),
    aggregate: async (a: any) => db.intelAgg(a),
  });
  server = await createTestServer((app) => app.use('/api/security', securityRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  db = healthy();
});

const getPosture = (headers: Record<string, string> = AUTH) =>
  fetch(server.baseUrl + '/api/security/posture', { headers });

test('ต้องล็อกอินก่อน (401)', async () => {
  const res = await fetch(server.baseUrl + '/api/security/posture');
  assert.equal(res.status, 401);
});

test('ทุกแหล่งอ่านได้ = overall "ok" และตัวเลขมาจาก DB จริง', async () => {
  const res = await getPosture();
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.overall, 'ok');
  assert.equal(body.available, 6);
  assert.equal(body.unavailable, 0);
  assert.equal(body.sources.accounts.metrics.total, 4);
  assert.equal(body.sources.accounts.metrics.withoutMfa, 2);
  assert.equal(body.sources.accounts.metrics.mustChangePassword, 1);
  assert.equal(body.sources.bruteForce24h.metrics.blocks, 3);
  assert.equal(body.sources.securityEvents24h.metrics.critical, 1);
  assert.equal(body.sources.firewall.metrics.rulesEnabled, 7);
  assert.equal(body.sources.firewall.metrics.defaultPolicy, 'DENY');
  assert.equal(body.sources.threatIntel.metrics.active, 12);
  assert.equal(body.sources.auditTrail.metrics.entries, 42);
  assert.ok(!Number.isNaN(Date.parse(body.checkedAt)), 'checkedAt ต้องเป็น ISO ที่อ่านได้');
});

test('แหล่งเดียวล้ม = degraded + บอกเหตุผลของแหล่งนั้น (แหล่งอื่นยังมีข้อมูล)', async () => {
  db.ruleCount = async () => {
    throw new Error('db down');
  };
  const res = await getPosture();
  assert.equal(res.status, 200, 'ต้องตอบ 200 พร้อม degraded ไม่ใช่ 500');
  const body: any = await res.json();
  assert.equal(body.overall, 'degraded');
  assert.equal(body.available, 5);
  assert.equal(body.unavailable, 1);
  assert.equal(body.sources.firewall.state, 'unavailable');
  assert.ok(String(body.sources.firewall.reason).length > 0, 'ต้องบอกเหตุผล');
  assert.equal(body.sources.firewall.metrics, null);
  assert.equal(body.sources.accounts.state, 'ok');
  assert.equal(body.sources.accounts.metrics.total, 4);
});

test('ทุกแหล่งล้ม = "unavailable" ไม่ใช่ "ok" (ห้ามเขียวทั้งที่ไม่มีข้อมูล)', async () => {
  const boom = async () => {
    throw new Error('db down');
  };
  db = { ...healthy(), userCount: boom, auditCount: boom, auditFindFirst: boom, eventCount: boom, ruleCount: boom, configFind: boom, intelCount: boom, intelAgg: boom };
  const res = await getPosture();
  const body: any = await res.json();
  assert.equal(body.overall, 'unavailable');
  assert.equal(body.available, 0);
  assert.equal(body.unavailable, 6);
  for (const [name, src] of Object.entries<any>(body.sources)) {
    assert.equal(src.state, 'unavailable', name + ' ต้องเป็น unavailable');
    assert.equal(src.metrics, null, name + ' ต้องไม่ส่ง metrics ปลอม');
  }
});

test('ไมรั่วรายละเอียด DB/ความลับออกไปกับเหตุผล', async () => {
  db.configFind = async () => {
    throw new Error('connect failed dsn=postgresql://sovereign:s3cret@db:5432/x password_hash=abc123');
  };
  const res = await getPosture();
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!/password_hash/i.test(text), 'ห้ามหลุดชื่อคอลัมน์ความลับ');
  assert.ok(!/s3cret/.test(text), 'ห้ามหลุดรหัสผ่านใน DSN');
  assert.ok(!/postgresql:\/\//i.test(text), 'ห้ามหลุด DSN');
});

test('แหล่งข้อมูลที่ล้มต้องไม่ถูกนับเป็น "ผ่าน" ใน available', async () => {
  db.intelCount = async () => {
    throw new Error('timeout');
  };
  const res = await getPosture();
  const body: any = await res.json();
  assert.equal(body.sources.threatIntel.state, 'unavailable');
  assert.equal(body.available + body.unavailable, 6);
  assert.equal(body.overall, 'degraded');
});
