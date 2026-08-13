import express from 'express';
import type { Express } from 'express';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';

// ────────────────────────────────────────────────────────────────────────────
// mockModel — mock Prisma model delegate ที่เข้ากับ Node 24
//
// mock.method(prisma.User, 'count', ...) พังบน Node 24 เพราะ Prisma delegate
// เป็น Proxy ที่ `mock.method` อ่าน property ผ่าน getOwnPropertyDescriptor ไม่ได้
// → เจอ undefined → throw "methodName must be a method".
//
// ทางออก: assign plain-object delegate เข้า client proxy โดยตรง
// (Prisma client proxy อนุญาต set) แล้ว mock.method ก็ทำงานปกติบน object ธรรมดา
// ────────────────────────────────────────────────────────────────────────────
const delegates = new WeakMap<object, Map<string, Record<string, any>>>();

export function mockModel(prisma: any, model: string, methods: Record<string, any>): Record<string, any> {
  let byModel = delegates.get(prisma);
  if (!byModel) {
    byModel = new Map();
    delegates.set(prisma, byModel);
  }
  let delegate = byModel.get(model);
  if (!delegate) {
    delegate = {};
    byModel.set(model, delegate);
    prisma[model] = delegate; // assign ครั้งเดียว — method เพิ่มทีหลัง merge เข้า object เดียวกัน
  }
  for (const [name, fn] of Object.entries(methods)) {
    (delegate as any)[name] = fn;
  }
  return delegate;
}


export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/** สร้าง express app + listen บนพอร์ตสุ่ม แล้วคืน baseUrl */
export async function createTestServer(mount: (app: Express) => void): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  mount(app);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** สร้าง JWT ที่ผ่าน authenticate (mfa_verified = true) */
export function makeToken(role = 'SUPERADMIN', overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      userId: 'test-user',
      role,
      assigned_node_id: null,
      mfa_verified: true,
      ...overrides,
    },
    process.env.JWT_SECRET as string
  );
}
