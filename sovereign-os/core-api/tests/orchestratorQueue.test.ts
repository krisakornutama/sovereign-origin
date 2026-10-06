import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import { prisma } from '../src/lib/prisma';
import {
  listQueue,
  cancelJob,
  repeatJob,
  queueStats,
  summarizeJob,
  canCancel,
  parseQueueCommand,
} from '../src/services/orchestrator-queue.service';
import { TelegramAgentBot } from '../src/services/telegram-agent-bot.service';

const MACHINES = { id: 'm-1', name: 'คอมเครื่องที่ 2', status: 'online', executors: ['opencode'], capabilities: [] };

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    role_name: 'remote',
    prompt: 'ทำงานนี้',
    status: 'queued',
    priority: 5,
    machine_id: 'm-1',
    executor: 'opencode',
    executor_model: 'qwen3:4b',
    risk: null,
    result: null,
    error: null,
    exit_code: null,
    created_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

/**
 * stub ผู้มีสถานะปัจจุบันของแถวจริง เพื่อให้ updateMany นับได้ถูกต้องแบบ Prisma
 * (แถวที่ไม่ตรงเงื่อนไข where ไม่ถูกเขียน → count 0 และไม่บันทึกลง calls)
 */
function stub(rows: any[], currentStatus = 'queued') {
  const calls: any[] = [];
  mockModel(prisma as any, 'agentMachine', {
    findMany: async () => [MACHINES] as any,
    findUnique: async () => MACHINES as any,
  });
  mockModel(prisma as any, 'agentJob', {
    findMany: async (args: any) => {
      calls.push(args);
      return rows as any;
    },
    updateMany: async (args: any) => {
      const w = args.where?.status;
      const match = typeof w === 'string' ? w === currentStatus : Array.isArray(w?.in) ? w.in.includes(currentStatus) : true;
      if (match) calls.push(args);
      return { count: match ? 1 : 0 };
    },
    create: async (args: any) => {
      calls.push(args);
      return job({ id: 'job-new', status: 'queued', ...args.data });
    },
  });
  return calls;
}

describe('orchestrator-queue — ดูคิว', () => {
  test('เรียงตาม priority และแนบชื่อเครื่องมาให้ด้วย', async () => {
    const calls = stub([job({ id: 'a', priority: 9 }), job({ id: 'b', priority: 1 })]);
    const rows = await listQueue();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].machineName, 'คอมเครื่องที่ 2');
    assert.ok(calls.some((c) => Array.isArray(c?.orderBy)), 'ต้องมี orderBy');
  });

  test('screenshot_url ต้องไปถึงหน้าเว็บด้วย (ภาพจบงาน)', async () => {
    stub([job({ status: 'done', screenshot_url: 'http://hub.local/shots/x.png' })]);
    const rows = await listQueue();
    assert.equal(rows[0].screenshotUrl, 'http://hub.local/shots/x.png');
  });

  test('งานที่ยังไม่มีเครื่องก็ยังแสดงได้ (machineName เป็นค่าว่าง)', async () => {
    stub([job({ machine_id: null })]);
    const rows = await listQueue();
    assert.equal(rows[0].machineName, '');
  });

  test('log_tail ถูกตัดสั้นไว้ หน้าเว็บไม่ต้องโหลดก้อนใหญ่', async () => {
    stub([job({ log_tail: 'x'.repeat(5000) })]);
    const rows = await listQueue();
    assert.ok((rows[0].logTail ?? '').length <= 500);
  });
});

describe('orchestrator-queue — ยกเลิกงาน', () => {
  test('ยกเลิกได้เฉพาะงานที่ยังรออยู่', () => {
    assert.equal(canCancel('queued'), true);
    assert.equal(canCancel('awaiting_approval'), true);
    assert.equal(canCancel('running'), false);
    assert.equal(canCancel('done'), false);
    assert.equal(canCancel('error'), false);
  });

  test('ยกเลิกงานที่ยังรออยู่ได้', async () => {
    const calls = stub([]);
    const out = await cancelJob('job-1', 'user-1');
    assert.equal(out.ok, true);
    assert.equal(out.status, 'cancelled');
    assert.ok(calls.some((c) => c.data?.status === 'cancelled'));
  });

  test('ยกเลิกงานที่กำลังรันไม่ได้', async () => {
    const calls = stub([], 'running');
    const out = await cancelJob('job-running', 'user-1');
    assert.equal(out.ok, false);
    assert.equal(calls.length, 0, 'ห้ามเขียนสถานะทับงานที่กำลังรันอยู่');
  });
});

describe('orchestrator-queue — ทำซ้ำ', () => {
  test('ทำซ้ำงานเดิมได้ โดยคัดลอก prompt/เครื่อง/ตัวแปร แต่สถานะเริ่มต้นใหม่', async () => {
    stub([]);
    mockModel(prisma as any, 'agentJob', {
      findUnique: async () => job({ status: 'done', result: 'เสร็จแล้ว', exit_code: 0 }) as any,
      create: async (args: any) => job({ id: 'job-new', ...args.data }) as any,
      updateMany: async () => ({ count: 1 }) as any,
      findMany: async () => [] as any,
    });
    const out = await repeatJob('job-1');
    assert.equal(out.ok, true);
    assert.equal(out.status, 'queued');
  });

  test('ทำซ้ำงานที่ยังไม่เคยมีไม่ได้', async () => {
    mockModel(prisma as any, 'agentJob', {
      findUnique: async () => null as any,
      create: async () => job() as any,
      updateMany: async () => ({ count: 1 }) as any,
      findMany: async () => [] as any,
    });
    const out = await repeatJob('ไม่มีงานนี้');
    assert.equal(out.ok, false);
    assert.match(String(out.reason), /ไม่พบ/);
  });
});

describe('orchestrator-queue — สรุปสถานะ', () => {
  test('นับแยกตามสถานะและงานที่รออนุมัติ', async () => {
    const calls = stub([]);
    mockModel(prisma as any, 'agentJob', {
      findMany: async () => [] as any,
      groupBy: async () => [
        { _count: { _all: 2 }, status: 'queued' },
        { _count: { _all: 1 }, status: 'awaiting_approval' },
      ] as any,
    });
    const s = await queueStats();
    assert.equal(s.queued, 2);
    assert.equal(s.awaitingApproval, 1);
    assert.ok(calls.length >= 0);
  });
});

describe('orchestrator-queue — ข้อความสรุปงานเดียว', () => {
  test('งานเสร็จบอกผลลัพธ์ งานรอกดบอกว่ารออนุมัติ', () => {
    const done = summarizeJob(job({ status: 'done', result: 'แก้แล้ว', exit_code: 0 }), 'คอมเครื่องที่ 2');
    assert.match(done, /แก้แล้ว/);
    const waiting = summarizeJob(job({ status: 'awaiting_approval' }), 'คอมเครื่องที่ 2');
    assert.match(waiting, /อนุมัติ|รอกด/);
  });

  test('ข้อความถูก escape HTML ไม่ให้ prompt พัง markup', () => {
    const out = summarizeJob(job({ status: 'done', result: '<b>ไม่ใช่ markup</b>' }), 'PC');
    assert.ok(!out.includes('<b>ไม่ใช่ markup</b>'));
    assert.ok(out.includes('&lt;b&gt;'));
  });
});

describe('orchestrator-queue — คำสั่ง Telegram', () => {
  test('/queue ดูคิว และรับ /queue 2 เพื่อดูเฉพาะ 2 รายการ', () => {
    assert.deepEqual(parseQueueCommand('/queue'), { action: 'list', limit: 10 });
    assert.deepEqual(parseQueueCommand('/queue 3'), { action: 'list', limit: 3 });
  });

  test('/add ใส่งานเข้าคิว และอ่าน flag ต่าง ๆ ได้', () => {
    const cmd = parseQueueCommand('/add รีเซตฐานข้อมูล @opencode @machine:m-1 @model:qwen3:4b @priority:9 @risk:high');
    assert.ok(cmd && cmd.action === 'add');
    assert.equal(cmd.prompt, 'รีเซตฐานข้อมูล');
    assert.equal(cmd.executor, 'opencode');
    assert.equal(cmd.machineId, 'm-1');
    assert.equal(cmd.model, 'qwen3:4b');
    assert.equal(cmd.priority, 9);
    assert.equal(cmd.risk, 'high');
  });

  test('@ ที่ไม่รู้จักต้องอยู่ใน prompt ไม่ใช่ถูกเดาเป็น executor', () => {
    const cmd = parseQueueCommand('/add ส่งอีเมลหา @alice');
    assert.ok(cmd && cmd.action === 'add');
    assert.equal(cmd.executor, null);
    assert.equal(cmd.prompt, 'ส่งอีเมลหา @alice');
  });

  test('โมเดล/เครื่อง/priority มาจากผู้ใช้เสมอ — ค่าไม่มี = ไม่เดาเอง', () => {
    const cmd = parseQueueCommand('/add อ่านไฟล์');
    assert.ok(cmd && cmd.action === 'add');
    assert.equal(cmd.model, null);
    assert.equal(cmd.machineId, null);
    assert.equal(cmd.priority, 0);
    assert.equal(cmd.risk, null);
  });

  test('/cancel <id> ยกเลิกงาน', () => {
    assert.deepEqual(parseQueueCommand('/cancel job-1'), { action: 'cancel', jobId: 'job-1' });
  });

  test('/repeat <id> ทำซ้ำ', () => {
    assert.deepEqual(parseQueueCommand('/repeat job-1'), { action: 'repeat', jobId: 'job-1' });
  });

  test('คำสั่งที่ไม่รู้จักคืน null ไม่เดา', () => {
    assert.equal(parseQueueCommand('สวัสดี'), null);
    assert.equal(parseQueueCommand('/queue ไม่ใช่ตัวเลข'), null);
    assert.equal(parseQueueCommand('/cancel'), null, 'ไม่มี id = ทำไม่ได้ ไม่เดา');
  });

  test('จำกัดความยาว prompt ไม่ให้ Telegram ตัดเอง', () => {
    const cmd = parseQueueCommand(`/add ${'x'.repeat(4000)}`);
    assert.ok(cmd && cmd.action === 'add');
    assert.ok((cmd.prompt ?? '').length <= 3900);
  });
});

// ── คำสั่งที่วิ่งเข้ามาจริงทาง long polling ──
describe('orchestrator-queue — คำสั่ง Telegram แบบ end-to-end', () => {
  function bot() {
    const sent: string[] = [];
    const b = new TelegramAgentBot({
      send: async (t) => {
        sent.push(t);
        return true;
      },
      resolveActor: async () => 'user-1',
      allowedChatId: '12345',
      token: '',
    });
    return { b, sent };
  }

  test('/queue ตอบรายการงานจริง', async () => {
    stub([job({ id: 'job-1', status: 'queued', machine_id: 'm-1' })]);
    const { b, sent } = bot();
    await b.handleUpdate({ message: { from: { id: 12345 }, text: '/queue' } });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /job-1|รอคิว/);
  });

  test('/add ต้องตอบว่าเข้าคิวแล้ว พร้อมบอกว่างานเสี่ยงรอกดไหม', async () => {
    const created: any[] = [];
    mockModel(prisma as any, 'agentMachine', {
      findMany: async () => [MACHINES] as any,
      findUnique: async () => MACHINES as any,
    });
    // /add ไม่ได้ส่ง roleId มา → enqueueRemoteJob ต้องหาบทบาทจริงมาใช้ (mockModel แทนทั้ง object)
    mockModel(prisma as any, 'agentRole', {
      findFirst: async () => ({ id: 'role-1', name: 'นักวิเคราะห์ความเสี่ยง' }) as any,
    });
    mockModel(prisma as any, 'agentJob', {
      create: async (args: any) => {
        created.push(args.data);
        return job({ id: 'job-new', ...args.data });
      },
      update: async (args: any) => ({ id: args.where.id, ...args.data }) as any,
      updateMany: async () => ({ count: 1 }) as any,
      findUnique: async () => job({ status: 'queued' }) as any,
      findMany: async () => [] as any,
    });
    const { b, sent } = bot();
    await b.handleUpdate({
      message: { from: { id: 12345 }, text: '/add ล้าง cache @opencode @machine:m-1 @model:qwen3:4b' },
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].executor_model, 'qwen3:4b', 'โมเดลต้องมาจากผู้ใช้');
    assert.match(sent[0], /เข้าคิว|รอกด/);
  });

  test('/add งานเสี่ยงต้องถูกพักรอกด ไม่ใช่วิ่งเข้าเครื่องทันที', async () => {
    mockModel(prisma as any, 'agentMachine', {
      findMany: async () => [MACHINES] as any,
      findUnique: async () => MACHINES as any,
    });
    mockModel(prisma as any, 'agentRole', {
      findFirst: async () => ({ id: 'role-1', name: 'นักวิเคราะห์ความเสี่ยง' }) as any,
    });
    mockModel(prisma as any, 'agentJob', {
      create: async (args: any) => job({ id: 'job-new', ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }) as any,
      updateMany: async () => ({ count: 1 }) as any,
      findUnique: async () => job({ status: 'queued' }) as any,
      findMany: async () => [] as any,
    });
    const { b, sent } = bot();
    await b.handleUpdate({
      message: { from: { id: 12345 }, text: '/add ลบฐานข้อมูลทั้งหมด @opencode @machine:m-1' },
    });
    assert.match(sent[0], /รอกด|อนุมัติ/);
  });

  test('/cancel งานที่กำลังรันได้รับคำตอบว่ายกเลิกไม่ได้', async () => {
    stub([], 'running');
    const { b, sent } = bot();
    await b.handleUpdate({ message: { from: { id: 12345 }, text: '/cancel job-1' } });
    assert.match(sent[0], /ยกเลิกไม่ได้|รันอยู่/);
  });

  test('/add ที่ไม่ระบุเครื่องต้องไม่เดาให้ — บอกรายการเครื่องที่มีจริง', async () => {
    stub([]);
    const { b, sent } = bot();
    await b.handleUpdate({
      message: { from: { id: 12345 }, text: '/add ล้าง cache @opencode' },
    });
    assert.match(sent[0], /ต้องระบุเครื่อง/);
    assert.match(sent[0], /m-1/, 'ต้องบอก id ที่ใช้ได้จริง');
  });

test('คำสั่งจากแชทอื่นถูกเมิน — ไม่มีการแก้คิว', async () => {
    stub([job()]);
    const { b, sent } = bot();
    await b.handleUpdate({ message: { from: { id: 777 }, text: '/queue' } });
    assert.equal(sent.length, 0);
  });

  test('คำสั่งที่ไม่รู้จักไม่ตอบอะไรเพื่อไม่ให้บอทเป็นพาสัด', async () => {
    stub([]);
    const { b, sent } = bot();
    await b.handleUpdate({ message: { from: { id: 12345 }, text: '/รีเซ็ตทั้งหมด' } });
    assert.equal(sent.length, 0);
  });
});