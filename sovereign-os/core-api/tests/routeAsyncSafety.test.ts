// Express 4 ไม่ดัก promise ที่ reject — async route handler ที่ await แล้วโยน error
// จะทำให้คำขอ "ค้าง" จน client timeout (ไม่ใช่ 500) และจับ connection ไว้จนหมด
//
// เกิดจริงมาแล้วหลายรอบ (SEC-023 `/latest`, SEC-026 firewall block/unblock, SEC-029 history)
// และยังเหลืออีก ~60 handler ที่ await DB/executor โดยไม่มี try/catch ⇒ รอบนี้กันทั้งคลาส:
//   1) `asyncRoute()` (src/lib/async-handler.ts) แปลง rejection เป็น 500 JSON + detail
//   2) เทสต์นี้สแกนทุกไฟล์ routes ด้วย TypeScript AST — handler ที่ `await` โดยไม่มี
//      `try` / `.catch(` / `asyncRoute(` = fail พร้อมบอกพิกัด
//
// กติกาเดียวกับด่านอื่นใน repo: ด่านต้องอยู่ในเทสต์ที่ commit ไว้ ไม่ใช่สคริปต์ชั่วคราว
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { asyncRoute } from '../src/lib/async-handler';
import { prisma } from '../src/lib/prisma';
import deviceRoutes from '../src/modules/devices/device.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

const MODULES_DIR = path.resolve(__dirname, '../src/modules');
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name.endsWith('.routes.ts')) out.push(p);
  }
  return out;
}

function hasNode(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (pred(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** ชื่อตัวแปรที่สร้างจาก Router() ในไฟล์ (router / lifestyleRoutes / …) */
function routerIdentifiers(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'Router'
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isAsyncHandler(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;
}

function unwrappedHandlers(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routers = routerIdentifiers(sf);
  const findings: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const recv = node.expression.expression;
      if (ROUTE_METHODS.has(method) && ts.isIdentifier(recv) && routers.has(recv.text)) {
        const fn = node.arguments[node.arguments.length - 1];
        if (fn && isAsyncHandler(fn) && ts.isBlock(fn.body)) {
          const body = fn.body;
          const hasTry = hasNode(body, (n) => ts.isTryStatement(n));
          const hasCatch = hasNode(
            body,
            (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'catch'
          );
          const hasAwait = hasNode(body, (n) => ts.isAwaitExpression(n));
          const wrapped =
            src.slice(Math.max(0, fn.getStart(sf) - 'asyncRoute('.length), fn.getStart(sf)) === 'asyncRoute(';
          if (hasAwait && !hasTry && !hasCatch && !wrapped) {
            const route = node.arguments[0];
            const label = route && ts.isStringLiteralLike(route) ? route.text : '?';
            const { line } = sf.getLineAndCharacterOfPosition(fn.getStart(sf));
            findings.push(
              `${path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/')}:${line + 1} ` +
                `${method.toUpperCase()} ${label}`
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

test('ทุก async route handler ที่ await ต้องมี try/catch หรือ asyncRoute() — กันคำขอค้าง', () => {
  const findings = routeFiles(MODULES_DIR).flatMap(unwrappedHandlers);
  assert.deepEqual(
    findings,
    [],
    `พบ ${findings.length} async handler ที่ไม่มี try/catch และไม่ได้ห่อด้วย asyncRoute():\n` +
      `${findings.join('\n')}\n` +
      `⇒ Express 4 จะปล่อยคำขอค้างเมื่อ handler โยน error — ห่อด้วย asyncRoute() จาก src/lib/async-handler.ts`
  );
});

function fakeRes(headersSent = false) {
  const out = { statusCode: 0, body: null as any, headersSent };
  const res: any = {
    get headersSent() {
      return out.headersSent;
    },
    status(code: number) {
      out.statusCode = code;
      return res;
    },
    json(payload: any) {
      out.body = payload;
      return res;
    },
  };
  return { res, out };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

test('asyncRoute: handler โยน error = 500 + detail (ไม่ค้าง ไม่ปล่อยเป็น HTML stack)', async () => {
  const { res, out } = fakeRes();
  const handler = asyncRoute(async () => {
    throw new Error('db exploded');
  });
  let nextCalls = 0;
  handler({ method: 'GET', originalUrl: '/api/x' } as any, res, () => {
    nextCalls++;
  });
  await tick();
  assert.equal(out.statusCode, 500);
  assert.match(String(out.body?.error), /ผิดพลาด/);
  assert.match(String(out.body?.detail), /db exploded/);
  assert.equal(nextCalls, 0);
});

test('asyncRoute: handler สำเร็จ = ไม่แตะ response ของ handler', async () => {
  const { res, out } = fakeRes();
  const handler = asyncRoute(async (_req: any, r: any) => {
    r.status(201).json({ ok: true });
  });
  (handler as any)({ method: 'POST', originalUrl: '/api/y' }, res, () => {});
  await tick();
  assert.equal(out.statusCode, 201);
  assert.deepEqual(out.body, { ok: true });
});

test('asyncRoute: ส่ง header ไปแล้ว = ต่อให้ Express (next(err)) ไม่เขียนทับ', async () => {
  const { res } = fakeRes(true);
  const handler = asyncRoute(async () => {
    throw new Error('stream broke');
  });
  let seen: unknown = null;
  (handler as any)({ method: 'GET', originalUrl: '/api/stream' }, res, (err: unknown) => {
    seen = err;
  });
  await tick();
  assert.ok(seen instanceof Error);
  assert.match(String((seen as Error).message), /stream broke/);
});

// ── ปลายทางจริง: route ที่เดิมไม่มี try/catch (GET /api/devices) ──────────────
// ถ้าไม่ห่อ asyncRoute คำขอจะค้าง (เทสต์นี้จะ timeout) — ไม่ใช่ 500
test('GET /api/devices ตอน DB โยน = 500 ทันที (ไม่ใช่คำขอค้างจน timeout)', async () => {
  const realDevice = (prisma as any).device;
  (prisma as any).device = {
    findMany: async () => {
      throw new Error('db down');
    },
  };
  let server: TestServer | null = null;
  try {
    server = await createTestServer((app) => app.use('/api/devices', deviceRoutes));
    const res = await fetch(server.baseUrl + '/api/devices', {
      headers: { Authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(res.status, 500);
    const body: any = await res.json();
    assert.match(String(body.error), /ผิดพลาด/);
    assert.match(String(body.detail), /db down/);
  } finally {
    if (server) await server.close();
    (prisma as any).device = realDevice;
  }
});
