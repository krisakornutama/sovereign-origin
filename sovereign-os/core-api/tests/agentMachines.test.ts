import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import {
  hashToken,
  generateToken,
  registerMachine,
  authenticateToken,
  listMachines,
  heartbeat,
  enqueueRemoteJob,
  pullJobs,
  reportJobResult,
  canMachineRun,
} from '../src/services/agent-machines.service';

describe('agent machines — token', () => {
  test('generateToken returns a fresh random token each call', () => {
    const a = generateToken();
    const b = generateToken();
    assert.ok(typeof a === 'string' && a.length >= 32);
    assert.notEqual(a, b);
  });

  test('hashToken is deterministic and sha256-shaped', () => {
    const h1 = hashToken('abc');
    const h2 = hashToken('abc');
    assert.equal(h1, h2);
    assert.match(h1, /^[a-f0-9]{64}$/);
  });

  test('hashToken of different tokens differs', () => {
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });
});

describe('agent machines — register', () => {
  test('register stores only the hash, never the raw token', async () => {
    let stored: any = null;
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => { stored = args.data; return { id: 'm-1', ...args.data }; },
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
    });
    const res = await registerMachine({ name: 'คอมห้องทำงาน', capabilities: ['opencode'] });
    assert.ok(res.token, 'ต้องคืน token ครั้งเดียวให้ผู้ใช้');
    // ไม่มีฟิลด์ token ธรรมดาเลย และค่าใน DB ต้องไม่มี token จริงโผล่
    assert.equal(stored.token, undefined);
    assert.equal(stored.token_hash, hashToken(res.token));
    assert.equal(JSON.stringify(stored).includes(res.token), false);
    assert.equal(stored.name, 'คอมห้องทำงาน');
    assert.equal(stored.status, 'offline');
  });

  test('register rejects empty name', async () => {
    await assert.rejects(() => registerMachine({ name: '', capabilities: [] }), /name/i);
  });

  test('authenticateToken accepts the right token and rejects wrong one', async () => {
    const token = generateToken();
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
      findFirst: async (args: any) =>
        args.where.token_hash === hashToken(token)
          ? { id: 'm-1', name: 'runner-a', status: 'online', capabilities: ['opencode'], executors: ['opencode'] }
          : null,
    });
    const ok = await authenticateToken(token);
    assert.equal(ok?.id, 'm-1');
    const bad = await authenticateToken('not-the-token');
    assert.equal(bad, null);
  });

  test('authenticateToken returns null for empty token', async () => {
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
      findFirst: async () => null,
    });
    assert.equal(await authenticateToken(''), null);
  });
});

describe('agent machines — list + heartbeat', () => {
  test('listMachines returns machines', async () => {
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findFirst: async () => null,
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
      findMany: async () => [{ id: 'm-1', name: 'runner-a', status: 'online' }],
    });
    const list = await listMachines();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'runner-a');
  });

  test('heartbeat marks machine online and stamps last_heartbeat', async () => {
    let updated: any = null;
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args: any) => { updated = args.data; return { id: 'm-1', ...args.data }; },
    });
    const res = await heartbeat('m-1', '1.2.3');
    assert.equal(updated.status, 'online');
    assert.ok(updated.last_heartbeat instanceof Date);
    assert.equal(res.status, 'online');
  });

  test('heartbeat throws for unknown machine', async () => {
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => { throw new Error('Record to update not found.'); },
    });
    await assert.rejects(() => heartbeat('nope', '1.2.3'));
  });
});

describe('agent machines — dispatch', () => {
  test('canMachineRun matches executor and tags', () => {
    const m = { capabilities: ['opencode'], executors: ['opencode'] } as any;
    assert.equal(canMachineRun(m, 'opencode', undefined), true);
    assert.equal(canMachineRun(m, 'freebuff', undefined), false);
    // freebuff ต้องมีทั้ง executor และ capability
    const m2 = { capabilities: ['opencode', 'freebuff'], executors: ['opencode', 'freebuff'] } as any;
    assert.equal(canMachineRun(m2, 'freebuff', undefined), true);
  });

  test('enqueueRemoteJob pins the job to the machine', async () => {
    let created: any = null;
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => { created = args.data; return { id: 'j-1', ...args.data }; },
      findMany: async () => [],
      update: async (args: any) => ({ ...args.data, id: args.where.id }),
    });
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => ({ id: 'm-1', name: 'runner-a', executors: ['opencode'] }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
    });
    const job = await enqueueRemoteJob({
      machineId: 'm-1',
      executor: 'opencode',
      prompt: 'ทดสอบ',
      model: 'ollama/gemma3',
      workspace: 'E:/work',
      roleId: 'r-1',
      roleName: 'นักวิเคราะห์',
    });
    assert.equal(job.id, 'j-1');
    assert.equal(created.machine_id, 'm-1');
    assert.equal(created.executor, 'opencode');
    assert.equal(created.executor_model, 'ollama/gemma3');
    assert.equal(created.status, 'queued');
    assert.equal(created.priority, 0);
  });

  test('enqueueRemoteJob rejects when machine unknown', async () => {
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
    });
    await assert.rejects(
      () => enqueueRemoteJob({ machineId: 'ghost', executor: 'opencode', prompt: 'x' }),
      /machine|not found|ไม่พบ/i,
    );
  });

  test('enqueueRemoteJob rejects unsupported executor', async () => {
    mockModel(prismaRef() as any, 'agentMachine', {
      create: async (args: any) => ({ id: 'm-1', ...args.data }),
      findUnique: async () => ({ id: 'm-1', name: 'r', executors: ['opencode'] }),
      findFirst: async () => null,
      findMany: async () => [],
      update: async (args: any) => ({ id: 'm-1', ...args.data }),
    });
    await assert.rejects(
      () => enqueueRemoteJob({ machineId: 'm-1', executor: 'totally-made-up', prompt: 'x' }),
      /executor/i,
    );
  });

  test('pullJobs returns only queued jobs this machine can run and marks them dispatched', async () => {
    const machine = { id: 'm-1', name: 'runner-a', capabilities: ['opencode'], executors: ['opencode'] } as any;
    const updates: any[] = [];
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => ({ id: 'j-1', ...args.data }),
      findMany: async () => [
        { id: 'j-1', executor: 'opencode', prompt: 'งานที่ทำได้', workspace: null, executor_model: null, executor_agent: null, priority: 0 },
        { id: 'j-2', executor: 'freebuff', prompt: 'งานที่ทำไม่ได้', workspace: null, executor_model: null, executor_agent: null, priority: 0 },
      ],
      update: async (args: any) => { updates.push(args); return { ...args.data, id: args.where.id }; },
    });
    const jobs = await pullJobs(machine, 5);
    assert.equal(jobs.length, 1, 'ต้องกรองงานที่เครื่องนี้ทำไม่ได้ออก');
    assert.equal(jobs[0].id, 'j-1');
    assert.ok(updates.length > 0, 'ต้อง mark ว่า dispatched กันสองเครื่องมาหยิบงานเดียวกัน');
    assert.equal(updates[0].data.status, 'running');
  });

  test('pullJobs returns empty array when nothing queued', async () => {
    const machine = { id: 'm-1', capabilities: ['opencode'], executors: ['opencode'] } as any;
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => ({ id: 'j-1', ...args.data }),
      findMany: async () => [],
      update: async () => { assert.fail('ไม่ควรมี update'); return {} as any; },
    });
    const jobs = await pullJobs(machine, 5);
    assert.deepEqual(jobs, []);
  });

  test('reportJobResult stores outcome and marks done', async () => {
    let updated: any = null;
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => ({ id: 'j-1', ...args.data }),
      findMany: async () => [],
      update: async (args: any) => { updated = args.data; return { id: 'j-1', ...args.data }; },
    });
    const res = await reportJobResult('j-1', {
      status: 'done',
      result: 'เสร็จแล้ว',
      exitCode: 0,
      logTail: 'stdout...',
      screenshotUrl: 'file:///shot.png',
    });
    assert.equal(updated.status, 'done');
    assert.equal(updated.result, 'เสร็จแล้ว');
    assert.equal(updated.exit_code, 0);
    assert.equal(updated.screenshot_url, 'file:///shot.png');
    assert.ok(updated.completed_at instanceof Date);
    assert.equal(res.status, 'done');
  });

  test('reportJobResult maps failure to error status with exit code', async () => {
    let updated: any = null;
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => ({ id: 'j-1', ...args.data }),
      findMany: async () => [],
      update: async (args: any) => { updated = args.data; return { id: 'j-1', ...args.data }; },
    });
    await reportJobResult('j-1', { status: 'error', error: 'พัง', exitCode: 1, logTail: 'boom' });
    assert.equal(updated.status, 'error');
    assert.equal(updated.error, 'พัง');
    assert.equal(updated.exit_code, 1);
  });

  test('reportJobResult rejects unknown status', async () => {
    mockModel(prismaRef() as any, 'agentJob', {
      create: async (args: any) => ({ id: 'j-1', ...args.data }),
      findMany: async () => [],
      update: async () => ({}) as any,
    });
    await assert.rejects(
      () => reportJobResult('j-1', { status: 'weird' as any }),
      /status/i,
    );
  });
});

// helper: ใช้ prisma instance จาก service (mockModel ต้องได้ object เดียวกัน)
import { prisma } from '../src/lib/prisma';
function prismaRef() {
  return prisma;
}