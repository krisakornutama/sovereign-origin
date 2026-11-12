// clone import/export — การถอดแบบทั้งระบบ = การอ่านทั้ง DB ออกไป และเขียนทับตารางด้วย TRUNCATE
//
// 1) เดิมใช้แค่ `authenticate` ⇒ บัญชีใดก็ได้ (OPERATOR/KID/SYSTEM_AI) สั่ง
//    POST /clone/import แล้ว `TRUNCATE TABLE "<ชื่อตาราง>" RESTART IDENTITY CASCADE`
//    กับตารางใดก็ได้ที่ส่งชื่อมาในแพ็กเกจ (เช่น users, audit_logs) = ลบข้อมูลทั้งระบบได้
//    และ POST /clone/export ดัมป์ข้อมูลทุกตารางของโมดูลที่เลือก (เด็ก/สุขภาพ/การเงิน) ออกไปได้
// 2) validatePackage ไม่เคยเทียบชื่อตารางกับ MODULE_MANIFEST ⇒ แพ็กเกจปลอมชี้ตารางนอก
//    รายการได้ (ทั้ง TRUNCATE และ INSERT เข้า users เพื่อสร้างบัญชีใหม่)
// 3) เลือกโมดูลที่ไม่มีอยู่จริงแล้วสั่ง export = ได้แพ็กเกจเปล่า `modules: []` เงียบ ๆ
//    (ผู้ใช้อ่านว่า "สำรองข้อมูลแล้ว" ทั้งที่ไม่มีอะไรถูกสำรอง)
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import cloneRoutes from '../src/modules/clone/clone.routes';
import { prisma } from '../src/lib/prisma';
import { MODULE_MANIFEST } from '../src/services/export-clone.service';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let queries: string[] = [];
let executes: string[] = [];
const ADMIN = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'Content-Type': 'application/json' };
const OPERATOR = { Authorization: `Bearer ${makeToken('OPERATOR')}`, 'Content-Type': 'application/json' };
const AI = { Authorization: `Bearer ${makeToken('SYSTEM_AI')}`, 'Content-Type': 'application/json' };

before(async () => {
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    queries.push(sql);
    if (sql.includes('information_schema')) {
      // จำลองว่าเป้าหมายมีตาราง/คอลัมน์ครบ
      return [{ column_name: 'id' }, { column_name: 'name' }, { column_name: 'action' }];
    }
    return [{ id: 'r1', name: 'block-x', action: 'DENY' }];
  };
  (prisma as any).$executeRawUnsafe = async (sql: string) => {
    executes.push(sql);
    return 1;
  };
  server = await createTestServer((app) => app.use('/api/clone', cloneRoutes));
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  queries = [];
  executes = [];
});

function post(path: string, body: unknown, headers: Record<string, string> = ADMIN) {
  return fetch(server.baseUrl + `/api/clone/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validPackage = {
  version: 1,
  modules: [
    { key: 'firewall', tables: [{ table: 'firewall_rules', rows: [{ id: 'r1', name: 'block-x', action: 'DENY' }] }] },
  ],
};

test('OPERATOR สั่ง import ไม่ได้ (403) และไม่มี SQL ใด ๆ ถูกเรียก', async () => {
  const res = await post('import', { package: validPackage }, OPERATOR);
  assert.equal(res.status, 403);
  const body: any = await res.json();
  assert.ok(String(body.error).length > 0, 'ต้องบอกเหตุผล');
  assert.deepEqual(body.requiredRoles, ['SUPERADMIN']);
  assert.deepEqual(executes, [], 'ห้ามมี TRUNCATE/INSERT ใด ๆ');
  assert.deepEqual(queries, [], 'ห้ามแตะ DB เลย');
});

test('SYSTEM_AI (agent) สั่ง export ข้อมูลทั้งระบบไม่ได้ (403)', async () => {
  const res = await post('export', { modules: ['knowledge', 'kids'] }, AI);
  assert.equal(res.status, 403);
  assert.deepEqual(queries, [], 'ห้ามดัมป์ข้อมูลใด ๆ');
});

test('OPERATOR สั่ง export ไม่ได้ (403) — ข้อมูลเด็ก/สุขภาพ/การเงิน ไม่ใช่ของ public', async () => {
  const res = await post('export', { modules: ['kids'] }, OPERATOR);
  assert.equal(res.status, 403);
  assert.deepEqual(queries, []);
});

test('SUPERADMIN สั่ง import แพ็กเกจที่ชี้ตารางนอก MODULE_MANIFEST ไม่ได้ (400) และไม่แตะ DB', async () => {
  const evil = {
    version: 1,
    modules: [
      { key: 'firewall', tables: [{ table: 'users', rows: [{ id: 'u1', username: 'attacker', role: 'SUPERADMIN' }] }] },
    ],
  };
  const res = await post('import', { package: evil }, ADMIN);
  assert.equal(res.status, 400);
  const body: any = await res.json();
  assert.match(String(body.error), /MODULE_MANIFEST|manifest/);
  assert.match(String(body.error), /users/, 'ต้องบอกว่าตารางไหนถูกปฏิเสธ');
  assert.deepEqual(executes, [], 'ห้าม TRUNCATE users');
  assert.deepEqual(queries, [], 'ต้องปฏิเสธก่อน query information_schema');
});

test('ตาราง audit_logs (มีจริงใน DB แต่ไม่อยู่ในรายการถอดแบบ) ก็ถูกปฏิเสธ', async () => {
  const evil = { version: 1, modules: [{ key: 'x', tables: [{ table: 'audit_logs', rows: [{ id: '1' }] }] }] };
  const res = await post('import', { package: evil }, ADMIN);
  assert.equal(res.status, 400);
  assert.deepEqual(executes, []);
});

test('SUPERADMIN import แพ็กเกจที่ถูกต้องยังทำงานได้ (allowlist ไม่เข้มเกิน)', async () => {
  const res = await post('import', { package: validPackage }, ADMIN);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.restoredTables, 1);
  assert.ok(executes.some((s) => s.includes('TRUNCATE TABLE "firewall_rules"')));
  assert.ok(executes.some((s) => s.includes('INSERT INTO "firewall_rules"')));
});

test('SUPERADMIN export โมดูลที่ถูกต้องได้แพ็กเกจจริง', async () => {
  const res = await post('export', { modules: ['firewall'] }, ADMIN);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.package.modules[0].key, 'firewall');
  assert.ok(body.package.modules[0].tables.length > 0);
});

test('เลือกโมดูลที่ไม่มีอยู่จริง = 400 พร้อมรายการที่ใช้ได้ (ไม่ใช่แพ็กเกจเปล่าที่อ่านว่า "สำรองแล้ว")', async () => {
  const res = await post('export', { modules: ['firewall', 'no-such-module'] }, ADMIN);
  assert.equal(res.status, 400);
  const body: any = await res.json();
  assert.deepEqual(body.unknownModules, ['no-such-module']);
  assert.ok(Array.isArray(body.availableModules) && body.availableModules.length >= MODULE_MANIFEST.length);
  assert.deepEqual(queries, [], 'ต้องไม่ดัมป์อะไรเลยเมื่อคำขอไม่ถูกต้อง');
});

test('manifest (แค่รายชื่อโมดูล ไม่มีข้อมูล) อ่านได้ทุก role ที่ล็อกอินแล้ว', async () => {
  const res = await fetch(server.baseUrl + '/api/clone/manifest', { headers: OPERATOR });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.ok(Array.isArray(body.modules) && body.modules.length > 0);
  assert.equal(body.modules[0].rows, undefined, 'manifest ต้องไม่มีข้อมูลแถว');
});
