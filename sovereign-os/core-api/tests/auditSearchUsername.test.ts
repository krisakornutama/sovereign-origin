// ค้น audit log ด้วย "ชื่อผู้ใช้" — placeholder ของหน้า /audit สัญญาไว้ แต่ API ไม่ทำ
//
// หน้า /audit มีช่องค้นหาที่บอกผู้ใช้ตรง ๆ ว่า "ค้น action/payload หรือ somchai, /api/users"
// แต่ buildWhere ค้นแค่ action_type กับ payload::text ⇒ พิมพ์ชื่อคนที่ทำรายการลงไป
// ได้ผลลัพธ์ว่างเสมอ (payload เก็บ ip/method/path/request body ไม่มี username)
// ผู้ตรวจจึงหาคนหนึ่งคนไม่ได้เลยนอกจากเลื่อนดูทั้งตาราง — ขัดเป้าหมาย "ตรวจย้อนได้"
//
// เทสต์นี้ยึด "รูปร่างของ where" ที่ route ส่งให้ Prisma (ไม่ผูกกับ SQL string):
//   - q ต้องสร้างเงื่อนไขบน user.username แบบไม่สนตัวพิมพ์
//   - ต้องไม่ทิ้งตัวกรองเดิม (actionPrefix / from-to) และการค้น payload ยังทำงาน
//   - q ว่าง = ไม่มีเงื่อนไขชื่อ (ไม่สแกน relation โดยไม่จำเป็น)
import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import auditRoutes from '../src/modules/audit/audit.routes';
import { prisma } from '../src/lib/prisma';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let findManyArgs: any = null;
let rows: any[] = [];
let rawHits: Array<{ id: string }> = [];
let rawCalls: Array<{ sql: string; values: unknown[] }> = [];

before(async () => {
  mockModel(prisma, 'auditLog', {
    findMany: async (args: any) => {
      findManyArgs = args;
      return rows;
    },
  });
  // payload เป็น JSONB → route ใช้ $queryRaw; ที่นี่เราเก็บคำสั่ง SQL ไว้ดูว่าไม่ถอยหลัง
  mock.method(prisma as any, '$queryRaw', async (query: any) => {
    rawCalls.push({ sql: String(query?.sql ?? query?.strings?.join('?') ?? ''), values: query?.values ?? [] });
    return rawHits;
  });
  mock.method(AuditService, 'logAction', async () => undefined);
  server = await createTestServer((app) => app.use('/api/audit', auditRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

beforeEach(() => {
  findManyArgs = null;
  rows = [];
  rawHits = [];
  rawCalls = [];
});

function get(path: string, token = makeToken('SUPERADMIN')) {
  return fetch(server.baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
}

/** หาเงื่อนไข username ที่ซ่อนอยู่ที่ไหนก็ได้ใน where (รองรับทั้ง user:{...} และ user:{is:{...}}) */
function usernameFilter(node: any, seen = new Set<any>()): any {
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  const candidate = node.username;
  if (candidate && typeof candidate === 'object' && typeof candidate.contains === 'string') return candidate;
  for (const value of Object.values(node)) {
    const found = usernameFilter(value, seen);
    if (found) return found;
  }
  return null;
}

/** เก็บทุก branch ของ OR (ชั้นบนสุด) ไว้ตรวจ */
function orBranches(where: any): any[] {
  const branches = where?.OR;
  return Array.isArray(branches) ? branches : [];
}

test('ค้นด้วยชื่อผู้ใช้: where ต้องมีเงื่อนไข user.username (เดิมไม่มีเลย)', async () => {
  await get('/api/audit?q=somchai');
  assert.ok(findManyArgs, 'ต้องเรียก prisma.auditLog.findMany');

  const filter = usernameFilter(findManyArgs.where);
  assert.ok(filter, 'ต้องมีเงื่อนไข username ใน where — เดิมค้นได้แค่ action_type/payload');
  assert.equal(filter.contains, 'somchai');
  assert.equal(filter.mode, 'insensitive', 'ชื่อผู้ใช้ต้องค้นแบบไม่สนตัวพิมพ์ (ILIKE เดิมของ payload)');
});

test('ตัวพิมพ์ไม่สำคัญ: SomChai ให้ contains ชื่อตามที่พิมพ์ แต่ยัง mode insensitive', async () => {
  await get('/api/audit?q=SomChai');
  const filter = usernameFilter(findManyArgs.where);
  assert.equal(filter.contains, 'SomChai');
  assert.equal(filter.mode, 'insensitive');
});

test('ไม่ทิ้งตัวกรองเดิม: actionPrefix + from/to ยังอยู่ครบพร้อมเงื่อนไขชื่อ', async () => {
  await get('/api/audit?q=somchai&actionPrefix=USER_PASSWORD&from=2026-11-01T00:00:00.000Z&to=2026-11-10T23:59:59.000Z');
  const where = findManyArgs.where;
  assert.equal(where.action_type.startsWith, 'USER_PASSWORD');
  assert.equal(where.timestamp.gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(where.timestamp.lte.toISOString(), '2026-11-10T23:59:59.000Z');
  assert.ok(usernameFilter(where), 'เงื่อนไขชื่อต้องไม่ไปแทนที่ตัวกรองอื่น');
});

test('การค้น action/payload เดิมยังทำงาน: id ที่ search เจอต้องถูกใช้กรองด้วย', async () => {
  rawHits = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001' }];
  await get('/api/audit?q=USER_PASSWORD_RESET');
  const idBranches = orBranches(findManyArgs.where).filter((b) => b?.id?.in);
  assert.equal(idBranches.length, 1, 'id ที่ raw search เจอต้องยังถูกส่งต่อให้ Prisma');
  assert.deepEqual(idBranches[0].id.in, ['aaaaaaaa-0000-4000-8000-000000000001']);
  assert.ok(usernameFilter(findManyArgs.where), 'ต้องค้นชื่อผู้ใช้ควบคู่กันไป (OR) ไม่ใช่แทนกัน');
});

test('raw search ไม่เจออะไรเลย ก็ยังต้องค้นด้วยชื่อได้ (เดิมปีก id: { in: [] } ปิดทางทั้งหมด)', async () => {
  rawHits = [];
  await get('/api/audit?q=somchai');
  assert.ok(usernameFilter(findManyArgs.where), 'ไม่มี raw hit ต้องไม่ทำให้ค้นชื่อไม่ได้');
});

test('q ว่าง = ไม่มีเงื่อนไขชื่อ และไม่ยิง raw query เลย', async () => {
  await get('/api/audit?limit=5');
  assert.equal(usernameFilter(findManyArgs.where), null);
  assert.equal(orBranches(findManyArgs.where).length, 0);
  assert.equal(rawCalls.length, 0, 'ไม่พิมพ์คำค้น = ห้ามสแกนทั้งตาราง');
});

test('SQL ของ payload/action ยังอยู่ในรูปเดิม (parameterized — ไม่ต่อสตริงจากผู้ใช้)', async () => {
  await get('/api/audit?q=100%25');
  assert.equal(rawCalls.length, 1);
  const { sql, values } = rawCalls[0];
  assert.match(sql, /action_type/i);
  assert.match(sql, /payload::text/i);
  assert.ok(values.includes('%100%%'), 'ค่าค้นต้องถูกส่งเป็น parameter ไม่ใช่ต่อในสตริง SQL');
});

test('หน้า export ใช้ตัวกรองเดียวกัน: /api/audit/export?q=<ชื่อ> ต้องค้นด้วยชื่อผู้ใช้ด้วย', async () => {
  await get('/api/audit/export?q=somchai');
  assert.ok(usernameFilter(findManyArgs.where), 'export ต้องค้นชื่อผู้ใช้ได้เหมือนรายการ');
});
