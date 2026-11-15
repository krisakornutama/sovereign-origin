import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

// ─────────────────────────────────────────────────────────────
// ภาพหน้าจอตอนจบงาน + นโยบายอายุ (retention) — แยกไฟล์เพื่อไม่ให้เทสต์ไฟล์เดียวโตเกินงบ
// (arch-gate file-budget 800 บรรทัด) กติกาเดียวกับของเดิมทุกข้อ
// ─────────────────────────────────────────────────────────────

function loadRouter() {
  const mod = require('../src/modules/agent-machines/agent-machines.routes');
  return mod.default;
}

const shotsDir = path.resolve(process.cwd(), '.tmp-orch-shots');

/** ผูกเครื่อง m-1 ให้ผู้ใช้ทดสอบ (lan ยืนยันแล้ว) — ด่านเจ้าของภาพหน้าจอใช้กติกาเดียวกับช่องควบคุม */
function mockShotOwnership() {
  // ภาพหน้าจอผูกกับเครื่อง m-1 ซึ่งเป็นของผู้ใช้ทดสอบ (และยืนยัน LAN แล้ว)
  mockModel(prisma as any, 'agentMachineHub', {
    findMany: async () => [{ machine_id: 'm-1', user_id: 'test-user' }],
  });
  mockModel(prisma as any, 'agentMachine', {
    findUnique: async () => ({
      id: 'm-1',
      name: 'runner-a',
      status: 'online',
      role: 'USER',
      owner_user_id: null,
      lan_confirmed_at: new Date(),
      hub_users: [{ user_id: 'test-user' }],
    }),
    findFirst: async () => ({
      id: 'm-1',
      name: 'runner-a',
      status: 'online',
      executors: ['opencode'],
      role: 'USER',
      owner_user_id: null,
      lan_confirmed_at: new Date(),
      hub_users: [{ user_id: 'test-user' }],
    }),
    findMany: async () => [{ id: 'm-1', name: 'runner-a', status: 'online' }],
  });
}


describe('agent-machines routes — ภาพหน้าจอตอนจบงาน', () => {
  beforeEach(() => {
    process.env.ORCHESTRATOR_SCREENSHOT_DIR = shotsDir;
    fs.rmSync(shotsDir, { recursive: true, force: true });
    mockModel(prisma as any, 'agentJob', {
      findUnique: async (args: any) => ({ id: args.where.id, machine_id: 'm-1' }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
    });
    mockShotOwnership();
  });

  test('POST /jobs/:id/screenshot ปฏิเสธเมื่อไม่มี machine token (401)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('x')], { type: 'image/png' }), 'shot.png');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, { method: 'POST', body: fd });
      assert.equal(res.status, 401, 'ต้องไม่ให้คนไม่มี token อัปโหลด');
    } finally {
      await srv.close();
    }
  });

  test('POST /jobs/:id/screenshot เก็บไฟล์จริง + ตั้ง screenshot_url ให้งาน', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      fd.append('file', new Blob([png], { type: 'image/png' }), 'shot.png');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, {
        method: 'POST',
        headers: { 'x-machine-token': 'valid-token' },
        body: fd,
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.match(body.screenshotUrl, /^\/api\/agent-machines\/screenshots\//);
      const fname = body.screenshotUrl.split('/').pop();
      assert.ok(fs.existsSync(path.join(shotsDir, fname)), 'ไฟล์ต้องอยู่บนดิสก์จริง');
    } finally {
      await srv.close();
    }
  });

  test('POST /jobs/:id/screenshot ปฏิเสธไฟล์ที่ไม่ใช่ภาพ และไม่เขียนลงดิสก์เลย', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'evil.exe');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, {
        method: 'POST',
        headers: { 'x-machine-token': 'valid-token' },
        body: fd,
      });
      assert.equal(res.status, 400);
      const written = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).length : 0;
      assert.equal(written, 0, 'ไฟล์ผิดชนิดต้องไม่ถูกเขียนบนดิสก์');
    } finally {
      await srv.close();
    }
  });

  test('GET /screenshots/:file ต้องมี JWT จึงเปิดได้', async () => {
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'job-j-1-1700000000000-abcdef12.png'), Buffer.from('png'));
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/job-j-1-1700000000000-abcdef12.png`);
      assert.equal(noAuth.status, 401, 'ภาพหน้าจอของเครื่องเป็นของส่วนตัว — ห้ามเปิดสาธารณะ');
      const ok = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/job-j-1-1700000000000-abcdef12.png`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(ok.status, 200);
    } finally {
      await srv.close();
    }
  });

  test('GET /screenshots/:file ของเครื่องที่ไม่ได้ผูก = 403 (ภาพไม่ใช่ของทุกคนที่ล็อกอิน)', async () => {
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'job-j-1-1700000000000-abcdef12.png'), Buffer.from('png'));
    // ผู้ใช้ทดสอบหลุดจากการผูกเครื่อง m-1
    mockModel(prisma as any, 'agentMachine', {
      findUnique: async () => ({
        id: 'm-1', name: 'runner-a', status: 'online', role: 'USER',
        owner_user_id: null, lan_confirmed_at: new Date(), hub_users: [],
      }),
    });
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/job-j-1-1700000000000-abcdef12.png`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 403, 'ภาพหน้าจอของเครื่องอื่นต้องไม่หลุดให้คนที่ไม่ได้ผูกเครื่อง');
    } finally {
      await srv.close();
    }
  });

  test('GET /screenshots/:file ปฏิเสธ path traversal', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/..%2f..%2fpackage.json`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.ok(res.status === 400 || res.status === 404, `ต้องไม่หลุดออกนอกโฟลเดอร์ (ได้ ${res.status})`);
    } finally {
      await srv.close();
    }
  });

  // เทสต์ข้ามโปรเจ็กต์: ใช้ฟังก์ชัน uploadScreenshot ตัวจริงของ runner ยิงเข้า route จริง
  // เพื่อกัน field name / filename / header หลุดจากกัน (เทสต์ฝั่งเดียวจับ drift ไม่ได้)
  test('e2e — uploadScreenshot ของ runner ส่งเข้าถึง route จริงได้', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const { uploadScreenshot } = await import('../../agent-runner/src/runner.mjs');
      const out = await uploadScreenshot({
        hubUrl: srv.baseUrl,
        token: 'valid-token',
        jobId: 'j-1',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      });
      assert.match(out.screenshotUrl, /^\/api\/agent-machines\/screenshots\//);
      const fname = out.screenshotUrl.split('/').pop();
      assert.ok(fs.existsSync(path.join(shotsDir, fname)), 'ไฟล์ที่ runner ส่งต้องถึงดิสก์จริง');
    } finally {
      await srv.close();
    }
  });
});

// red-first (chunk 3): ด่านอนุมัติงานเสี่ยงมีแค่ฝั่ง Telegram callback — ไม่มี route/ปุ่มบนเว็บ
// ⇒ ผู้ใช้ที่ไม่ได้เปิด Telegram เปิดงานเสี่ยงค้างไว้จนหมดอายุไม่ได้เลย
// กฎสถานะ: 200 เมื่อเปลี่ยนสถานะจริง · 409 เมื่องานไม่ได้อยู่ใน awaiting_approval

describe('agent-machines routes — อนุมัติ/ปฏิเสธงานเสี่ยงจากหน้าเว็บ', () => {
  let updateManyCalls: any[] = [];
  let updateCount = 1;

  beforeEach(() => {
    updateManyCalls = [];
    updateCount = 1;
    mockModel(prisma as any, 'agentJob', {
      findMany: async () => [
        { id: 'j-risk', status: 'awaiting_approval', prompt: 'ล้างฐานข้อมูลทั้งหมด', priority: 0 },
        { id: 'j-safe', status: 'queued', prompt: 'สรุปรายงาน', priority: 0 },
      ],
      updateMany: async (args: any) => {
        updateManyCalls.push(args);
        return { count: updateCount };
      },
      groupBy: async () => [], // queueStats ใช้ groupBy — mock ให้ครบจะได้ไม่ log error ท้ายเทสต์
    });
  });

  test('POST /queue/:id/approve ปล่อยงานเข้าคิวเมื่อสถานะเป็น awaiting_approval', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ actor: 'web-admin' }),
      });
      assert.equal(res.status, 200, 'อนุมัติได้จากเว็บต้องตอบ 200 (ไม่ใช่ 404 เหมือนตอนนี้)');
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.equal(body.status, 'queued', 'งานต้องถูกปล่อนกลับเข้าคิวให้เครื่องดึง');
      assert.equal(updateManyCalls.length, 1);
      assert.equal(updateManyCalls[0].where.status, 'awaiting_approval', 'ต้อง gate ด้วยสถานะกันสองคนกดพร้อมกัน');
      assert.equal(updateManyCalls[0].data.status, 'queued');
      assert.equal(updateManyCalls[0].data.approved_by, 'web-admin');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/approve ตอบ 409 เมื่องานไม่ได้รออนุมัติอยู่', async () => {
    updateCount = 0; // งานถูกตัดสินใจไปแล้ว / ไม่มีจริง
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: '{}',
      });
      assert.equal(res.status, 409, 'สถานะไม่ตรงต้องบอกว่าขัดแย้ง ไม่ใช่แกล้งทำเป็นสำเร็จ');
      const body = await res.json() as any;
      assert.ok(body.error, 'ต้องบอกเหตุผลว่าทำไม่ได้');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/reject ปฏิเสธงานเป็น cancelled', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ actor: 'web-admin' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.equal(body.status, 'cancelled', 'ปฏิเสธแล้วเครื่องห้ามได้งานนี้ไปทำ');
      assert.equal(updateManyCalls[0].data.status, 'cancelled');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/approve|reject ต้องมีสิทธิ์ SUPERADMIN (401/403)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, { method: 'POST', body: '{}' });
      assert.equal(noAuth.status, 401);
      const wrongRole = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('VIEWER')}` },
        body: '{}',
      });
      assert.equal(wrongRole.status, 403, 'คนไม่มีสิทธิ์ห้ามปล่อยงานเสี่ยงเข้าคิว');
      assert.equal(updateManyCalls.length, 0, 'คนไม่มีสิทธิ์ห้ามแตะฐานข้อมูล');
    } finally {
      await srv.close();
    }
  });

  test('GET /queue คืน canApprove=true เฉพาะงานที่รออนุมัติ (ให้ UI ใช้แสดงปุ่ม)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      const risky = body.jobs.find((j: any) => j.id === 'j-risk');
      const safe = body.jobs.find((j: any) => j.id === 'j-safe');
      assert.equal(risky.canApprove, true, 'งานที่รออนุมัติ UI ต้องกดปุ่มได้');
      assert.equal(safe.canApprove, false, 'งานปกติห้ามขึ้นปุ่มอนุมัติ');
    } finally {
      await srv.close();
    }
  });
});

// red-first (chunk 4): ภาพหน้าจอ ~2.8 MB/งาน สะสมใน data/orchestrator-shots
// ไม่มี retention ไม่มีใครล้าง ⇒ disk โตไม่รู้จบ
// กฎ: เกินอายุ (default 14 วัน) = ลบไฟล์ **และ** เคลียร์ screenshot_url บนแถวงาน
//      (ลบอย่างเดียวไม่พอ — URL ค้างทำให้ผู้ใช้กดดูแล้วเจอ 404 งง ๆ)

describe('agent-machines routes — นโยบายอายุภาพหน้าจอ (retention 14 วัน)', () => {
  const pruneCalls: any[] = [];

  beforeEach(() => {
    process.env.ORCHESTRATOR_SCREENSHOT_DIR = shotsDir;
    delete process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS; // ใช้ default 14
    fs.rmSync(shotsDir, { recursive: true, force: true });
    fs.mkdirSync(shotsDir, { recursive: true });
    pruneCalls.length = 0;
    mockModel(prisma as any, 'agentJob', {
      findUnique: async (args: any) => ({ id: args.where.id, machine_id: 'm-1' }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      updateMany: async (args: any) => {
        pruneCalls.push(args);
        return { count: args?.where?.screenshot_url?.in?.length ?? 0 };
      },
    });
    mockShotOwnership();
  });

  /** วางไฟล์ภาพแล้วเลื่อน mtime ย้อนหลังตามจำนวนวัน (ทดสอบบน temp dir ไม่แตะ data จริง) */
  function putFile(name: string, ageDays: number): string {
    const full = path.join(shotsDir, name);
    fs.writeFileSync(full, Buffer.from('png-bytes'));
    const t = new Date(Date.now() - ageDays * 86_400_000);
    fs.utimesSync(full, t, t);
    return full;
  }

  function loadScreenshotService(): any {
    return require('../src/services/orchestrator-screenshot.service');
  }

  test('pruneScreenshots ลบไฟล์เกิน 14 วันและเคลียร์ screenshot_url (ไฟล์ยังไม่หมดอายุต้องอยู่)', async () => {
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-old-0001-old.png', 20);
    const youngFile = putFile('job-j-young-0002-young.png', 13);

    const out = await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'ไฟล์อายุ 20 วันต้องถูกลบออกจากดิสก์');
    assert.equal(fs.existsSync(youngFile), true, 'ไฟล์อายุ 13 วัน (ยังไม่เกิน 14) ห้ามลบ');
    assert.equal(pruneCalls.length, 1, 'ต้องเคลียร์ screenshot_url บนแถวงานด้วย ไม่ใช่ลบไฟล์อย่างเดียว');
    assert.deepEqual(pruneCalls[0].data, { screenshot_url: null }, 'ต้องล้างคอลัมน์ screenshot_url');
    const inList: string[] = pruneCalls[0].where.screenshot_url.in;
    assert.ok(
      inList.includes('/api/agent-machines/screenshots/job-j-old-0001-old.png'),
      'ต้องชี้ URL ของไฟล์ที่ลบไปแล้วเท่านั้น'
    );
    assert.ok(!inList.some((u) => u.includes('young')), 'ห้ามแตะแถวของงานที่ภาพยังอยู่');
    assert.equal(out.deleted.length, 1, 'ต้องรายงานจำนวนไฟล์ที่ลบให้ worker เอาไป log ได้');
  });

  test('ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS เปลี่ยนอายุที่ใช้ตัดได้', async () => {
    process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS = '2';
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-3days-old.png', 3);
    const freshFile = putFile('job-j-1day-new.png', 1);

    await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'retention=2 ⇒ ไฟล์ 3 วันต้องหาย');
    assert.equal(fs.existsSync(freshFile), true, 'retention=2 ⇒ ไฟล์ 1 วันต้องอยู่');
  });

  test('ค่า retention ที่ผิดรูปแบบต้องตกกลับเป็น 14 วัน ไม่ใช่ลบหมดหรือข้าม', async () => {
    process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS = 'not-a-number';
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-20days-old.png', 20);
    const youngFile = putFile('job-j-2days-young.png', 2);

    await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'ค่าพังไม่ได้แปลว่าปิด retention');
    assert.equal(fs.existsSync(youngFile), true, 'ค่าพังต้องไม่ทำให้ลบไฟล์ที่ยังไม่หมดอายุ');
  });

  test('GET /screenshots/:file ของไฟล์ที่ถูก prune แล้วตอบ 404 ไม่ crash', async () => {
    const { pruneScreenshots } = loadScreenshotService();
    putFile('job-j-gone-1700000000000-abcdef12.png', 30);
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const url = `${srv.baseUrl}/api/agent-machines/screenshots/job-j-gone-1700000000000-abcdef12.png`;
      const before = await fetch(url, { headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` } });
      assert.equal(before.status, 200, 'ก่อน prune ต้องเปิดดูได้');

      await pruneScreenshots();

      const after = await fetch(url, { headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` } });
      assert.equal(after.status, 404, 'ไฟล์ถูกลบแล้วต้องตอบ 404 ไม่ใช่ 500/crash');
    } finally {
      await srv.close();
    }
  });
});
