// security events — อ่านต้องจริง เขียนต้องมีสิทธิ์
//
// 1) GET /api/security/events เดิม catch แล้วตอบ `[]` ⇒ หน้า /security ขึ้น
//    "Security Events: 0" ทั้งที่อ่าน DB ไม่ได้ = หลักฐานความปลอดภัยเท็จ
//    (ปัญหาเดียวกับ connections ที่แก้ไปแล้วใน SEC-020) ต้องมี degraded flag + เหตุผล
// 2) POST /api/security/events เปิดให้ทุก role (รวม KID) เขียนเหตุการณ์ได้ และไม่ตรวจ
//    ค่าใด ๆ ⇒ ใครมีบัญชีก็ปลอมเหตุการณ์ความปลอดภัยได้ (และถล่ม 50 แถวล่าสุด
//    จนของจริงหลุดจากสายตา) · severity ต้องเป็นชุดที่ระบบรู้จัก ไม่งั้น UI/alert
//    ตีความผิด (สี/ระดับแจ้งเตือน)
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import securityRoutes from '../src/modules/security/security.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let created: any[] = [];
let findManyImpl: (args: any) => any = async () => [];
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'Content-Type': 'application/json' };
const KID_AUTH = { Authorization: `Bearer ${makeToken('KID')}`, 'Content-Type': 'application/json' };

before(async () => {
  mockModel(prisma, 'securityEvent', {
    findMany: async (args: any) => findManyImpl(args),
    create: async ({ data }: any) => {
      const row = { id: `evt-${created.length + 1}`, timestamp: new Date().toISOString(), ...data };
      created.push(row);
      return row;
    },
  });
  server = await createTestServer((app) => app.use('/api/security', securityRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  created = [];
  findManyImpl = async () => [];
});

function post(body: unknown, headers: Record<string, string> = AUTH) {
  return fetch(server.baseUrl + '/api/security/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('อ่าน DB ไม่ได้ = degraded: true + เหตุผล ไม่ใช่ [] ที่อ่านว่า "ไม่มีเหตุการณ์"', async () => {
  findManyImpl = async () => {
    throw new Error('db down');
  };
  const res = await fetch(server.baseUrl + '/api/security/events', { headers: AUTH });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.ok(Array.isArray(body.events), 'ต้องมี events เป็น array');
  assert.equal(body.events.length, 0);
  assert.equal(body.degraded, true);
  assert.ok(String(body.reason).length > 0, 'ต้องบอกเหตุผล');
});

test('อ่านได้ = degraded: false พร้อมของจริง', async () => {
  findManyImpl = async () => [{ id: 'e1', event_type: 'INTRUSION', severity: 'critical', description: 'x' }];
  const res = await fetch(server.baseUrl + '/api/security/events', { headers: AUTH });
  const body: any = await res.json();
  assert.equal(body.degraded, false);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].event_type, 'INTRUSION');
});

test('KID เขียนเหตุการณ์ความปลอดภัยไม่ได้ (403) และไม่ถึง DB', async () => {
  const res = await post({ event_type: 'INTRUSION', severity: 'critical', description: 'ปลอม' }, KID_AUTH);
  assert.equal(res.status, 403);
  assert.equal(created.length, 0, 'คำขอที่ไม่มีสิทธิ์ต้องไม่เขียนอะไรลง DB');
});

test('severity ที่ระบบไม่รู้จัก = 400 (ไม่เก็บค่าแปลกปลอมไว้ให้ UI ตีความ)', async () => {
  const res = await post({ event_type: 'INTRUSION', severity: 'SUPER-CRITICAL', description: 'x' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /severity/);
  assert.equal(created.length, 0);
});

test('event_type ที่มีอักขระแปลก/ยาวเกิน = 400', async () => {
  for (const type of ['<script>alert(1)</script>', 'A'.repeat(80), '']) {
    const res = await post({ event_type: type, severity: 'info', description: 'x' });
    assert.equal(res.status, 400, `event_type=${JSON.stringify(type)} ควรเป็น 400`);
  }
  assert.equal(created.length, 0);
});

test('ไม่มี description = 400 (schema บังคับ แต่ต้องบอกก่อนถึง DB)', async () => {
  const res = await post({ event_type: 'INTRUSION', severity: 'info' });
  assert.equal(res.status, 400);
  assert.equal(created.length, 0);
});

test('IP ที่ยาวผิดรูป = 400 (ไม่เก็บหลักฐานที่ระบุต้นทางไม่ได้)', async () => {
  const res = await post({
    event_type: 'INTRUSION',
    severity: 'info',
    description: 'x',
    source_ip: 'A'.repeat(100),
  });
  assert.equal(res.status, 400);
  assert.equal(created.length, 0);
});

test('ค่าที่ถูกต้อง = 201 และ severity ถูกทำให้เป็นตัวเล็กตามที่ระบบใช้', async () => {
  const res = await post({
    event_type: 'port_scan',
    severity: 'WARNING',
    source_ip: '203.0.113.5',
    description: '  สแกนพอร์ตผิดปกติ  ',
  });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.equal(body.event_type, 'PORT_SCAN');
  assert.equal(body.severity, 'warning');
  assert.equal(body.description, 'สแกนพอร์ตผิดปกติ');
  assert.equal(created.length, 1);
});
