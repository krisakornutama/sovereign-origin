// Audit log export (CSV).
//
// Why it exists: "ตรวจย้อนได้" must survive leaving the app — the owner needs a
// file they can hand to an auditor (PDPA / e-Tax) without a DB console.
//
// What this pins:
//  - SUPERADMIN only (the whole audit log is owner data).
//  - RFC 4180 quoting (commas, quotes, newlines) so the file never shifts
//    columns when a payload contains free text.
//  - CSV formula-injection guard: a cell starting with = + - @ is prefixed with
//    an apostrophe, otherwise opening the export in Excel can execute content.
//  - Filters (actionPrefix, from/to) are applied server-side, and the row cap
//    stops an accidental full-table dump.
//  - The export itself is audited (AUDIT_EXPORT) with the filters and row count.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import auditRoutes from '../src/modules/audit/audit.routes';
import { prisma } from '../src/lib/prisma';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let findManyArgs: any = null;
let rows: any[] = [];
const auditLogs: any[] = [];

before(async () => {
  mockModel(prisma, 'auditLog', {
    findMany: async (args: any) => {
      findManyArgs = args;
      return rows;
    },
  });
  mock.method(AuditService, 'logAction', async (p: any) => {
    auditLogs.push(p);
  });
  server = await createTestServer((app) => app.use('/api/audit', auditRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

// Minimal RFC 4180 parser — the test must read the file the way Excel would.
function parseCsv(text: string): string[][] {
  const rowsOut: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rowsOut.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rowsOut.push(row);
  }
  return rowsOut;
}

function get(path: string, token?: string) {
  return fetch(server.baseUrl + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// อ่านไบต์จริงแล้วตัด BOM เอง — Response.text() ตัด BOM ทิ้งตามสเปก fetch
async function csvText(res: Response): Promise<string> {
  const raw = Buffer.from(await res.arrayBuffer());
  return raw.subarray(3).toString('utf8');
}

test('export ต้องเป็น SUPERADMIN เท่านั้น (401 / 403)', async () => {
  const anon = await get('/api/audit/export');
  assert.equal(anon.status, 401);
  const operator = await get('/api/audit/export', makeToken('OPERATOR'));
  assert.equal(operator.status, 403);
});

test('ได้ CSV (UTF-8 BOM) + header ครบ และค่าที่มี comma/quote/newline ยังอ่านกลับได้เท่าเดิม', async () => {
  rows = [
    {
      id: 'a1',
      timestamp: new Date('2026-11-10T08:00:00.000Z'),
      action_type: 'USER_PASSWORD_CHANGED',
      payload: { ip: '192.168.1.9', method: 'PUT', path: '/api/users/1', note: 'hello, "world"\nline2' },
      user: { username: 'somchai' },
    },
  ];
  auditLogs.length = 0;

  const res = await get('/api/audit/export', makeToken('SUPERADMIN'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/csv/);
  assert.match(String(res.headers.get('content-disposition')), /attachment; filename="audit-export-.*\.csv"/);

  const raw = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'ต้องมี BOM ให้ Excel อ่านภาษาไทยถูก');
  const text = raw.subarray(3).toString('utf8');

  const parsed = parseCsv(text);
  assert.deepEqual(parsed[0], ['timestamp', 'user', 'action', 'ip', 'method', 'path', 'payload']);
  assert.equal(parsed.length, 2);
  const [timestamp, username, action, ip, method, path, payload] = parsed[1];
  assert.equal(timestamp, '2026-11-10T08:00:00.000Z');
  assert.equal(username, 'somchai');
  assert.equal(action, 'USER_PASSWORD_CHANGED');
  assert.equal(ip, '192.168.1.9');
  assert.equal(method, 'PUT');
  assert.equal(path, '/api/users/1');
  assert.deepEqual(JSON.parse(payload), {
    ip: '192.168.1.9',
    method: 'PUT',
    path: '/api/users/1',
    note: 'hello, "world"\nline2',
  });
});

test('กัน CSV formula injection: เซลล์ที่ขึ้นต้นด้วย = + - @ ถูกเติม apostrophe', async () => {
  rows = [
    {
      id: 'a2',
      timestamp: new Date('2026-11-10T09:00:00.000Z'),
      action_type: '+SUM(A1:A2)',
      payload: { ip: '@evil' },
      user: { username: '=HYPERLINK("http://x")' },
    },
  ];

  const res = await get('/api/audit/export', makeToken('SUPERADMIN'));
  const parsed = parseCsv(await csvText(res));
  assert.equal(parsed[1][1], `'=HYPERLINK("http://x")`);
  assert.equal(parsed[1][2], "'+SUM(A1:A2)");
  assert.equal(parsed[1][3], "'@evil");
});

test('ตัวกรองถูกส่งไปที่ DB จริง (actionPrefix + from/to) และ take ไม่เกินเพดาน', async () => {
  rows = [];
  findManyArgs = null;
  const res = await get(
    '/api/audit/export?actionPrefix=USER_PASSWORD&from=2026-11-01T00:00:00.000Z&to=2026-11-10T23:59:59.000Z&limit=999999',
    makeToken('SUPERADMIN')
  );
  assert.equal(res.status, 200);
  assert.ok(findManyArgs, 'ต้องเรียก prisma.auditLog.findMany');
  assert.equal(findManyArgs.where.action_type.startsWith, 'USER_PASSWORD');
  assert.equal(findManyArgs.where.timestamp.gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(findManyArgs.where.timestamp.lte.toISOString(), '2026-11-10T23:59:59.000Z');
  assert.equal(findManyArgs.take, 10000);
});

test('เขียน audit AUDIT_EXPORT พร้อมจำนวนแถวและตัวกรอง (ตรวจย้อนได้ว่ามีใครดึงข้อมูลออกไป)', async () => {
  rows = [
    { id: 'a3', timestamp: new Date('2026-11-10T10:00:00.000Z'), action_type: 'X', payload: {}, user: null },
    { id: 'a4', timestamp: new Date('2026-11-10T10:01:00.000Z'), action_type: 'Y', payload: {}, user: null },
  ];
  auditLogs.length = 0;

  const res = await get('/api/audit/export?actionPrefix=USER_PASSWORD', makeToken('SUPERADMIN'));
  assert.equal(res.status, 200);

  const entry = auditLogs.find((l) => l.actionType === 'AUDIT_EXPORT');
  assert.ok(entry, 'ต้องมี audit AUDIT_EXPORT');
  assert.equal(entry.payload.rows, 2);
  assert.equal(entry.payload.actionPrefix, 'USER_PASSWORD');
  assert.equal(typeof entry.userId, 'string');
});
