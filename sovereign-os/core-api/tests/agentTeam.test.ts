import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import {
  prisma,
  DEFAULT_ROLES,
  seedDefaultRoles,
  createAgentRole,
  updateAgentRole,
  deleteAgentRole,
  runAgentJob,
  listAgentJobs,
  getAgentJob,
  cancelAgentJob,
  processAgentQueue,
  setAgentOllama,
  setAgentNotify,
  runMorningReports,
} from '../src/services/agent-team.service';

describe('agent team — default roles', () => {
  test('DEFAULT_ROLES defines 6 roles with Thai descriptions', () => {
    assert.ok(DEFAULT_ROLES.length >= 6);
    for (const r of DEFAULT_ROLES) {
      assert.ok(r.name && r.description && r.system_prompt && r.capability);
      assert.ok(r.count >= 1);
    }
  });

  test('seedDefaultRoles inserts when table empty', async () => {
    let created = 0;
    mockModel(prisma, 'agentRole', {
      findMany: async () => [],
      createMany: async (args: any) => { created = args.data.length; return { count: created }; },
    });
    const n = await seedDefaultRoles();
    assert.equal(n, DEFAULT_ROLES.length);
    assert.equal(created, DEFAULT_ROLES.length);
  });

  test('seedDefaultRoles does not duplicate when roles exist', async () => {
    mockModel(prisma, 'agentRole', {
      findMany: async () => [{ id: 'r-1' }],
      createMany: async () => { assert.fail('should not create'); },
    });
    const n = await seedDefaultRoles();
    assert.equal(n, 0);
  });
});

describe('agent team — role CRUD', () => {
  test('createAgentRole validates name + description', async () => {
    mockModel(prisma, 'agentRole', { create: async () => ({ id: 'r-1' }) });
    const ok = await createAgentRole({ name: 'ผู้ดูแลระบบน้ำ', description: 'เฝ้าระวังน้ำ', system_prompt: 'คุณคือผู้ดูแลระบบน้ำ', capability: 'water', count: 1 });
    assert.equal(ok.id, 'r-1');
    await assert.rejects(createAgentRole({ name: '', description: 'x', system_prompt: 'y', capability: 'water', count: 1 }), /name/);
  });

  test('updateAgentRole persists changes', async () => {
    let updated: any = null;
    mockModel(prisma, 'agentRole', { update: async (args: any) => { updated = args.data; return { id: args.where.id }; } });
    await updateAgentRole('r-1', { count: 3, enabled: false });
    assert.equal(updated.count, 3);
    assert.equal(updated.enabled, false);
  });

  test('deleteAgentRole removes by id', async () => {
    let deletedId = '';
    mockModel(prisma, 'agentRole', { delete: async (args: any) => { deletedId = args.where.id; return { id: args.where.id }; } });
    await deleteAgentRole('r-1');
    assert.equal(deletedId, 'r-1');
  });
});

describe('agent team — background jobs', () => {
  test('runAgentJob creates job and runs it to done with a result', async () => {
    mockModel(prisma, 'agentRole', {
      findUnique: async () => ({
        id: 'r-1', name: 'ผู้ดูแลระบบน้ำ', emoji: '💧', description: 'x',
        system_prompt: 'คุณคือผู้ดูแลระบบน้ำ', capability: 'inventory', count: 1, enabled: true,
      }),
    });
    const created: any[] = [];
    mockModel(prisma, 'agentJob', {
      create: async (args: any) => { created.push({ ...args.data, id: 'j-1' }); return { ...args.data, id: 'j-1' }; },
      update: async (args: any) => { const r = created.find((j) => j.id === args.where.id); if (r) Object.assign(r, args.data); return r; },
      findMany: async (args: any) => (args.where?.status ? created.filter((j) => j.status === args.where.status) : created),
      findUnique: async (args: any) => created.find((j) => j.id === args.where.id) || null,
    });
    mockModel(prisma, 'inventoryItem', { findMany: async () => [{ name: 'น้ำดื่ม', quantity: 10, unit: 'L', category: 'WATER' }] });
    let called = false;
    setAgentOllama({ post: async (_url: string, body: any) => {
      called = true;
      assert.ok(String(body.system).includes('ผู้ดูแลระบบน้ำ'));
      assert.ok(String(body.prompt).includes('น้ำดื่ม'));
      return { data: { response: 'พบน้ำดื่ม 10 ลิตร — เพียงพอ' } };
    } });
    const job = await runAgentJob('r-1', 'ประเมินเสบียงน้ำ');
    assert.equal(job.id, 'j-1');
    await processAgentQueue(); // runner ทำงานเบื้องหลัง — รอให้เสร็จเพื่อ assert
    assert.ok(called);
    const row = created[0];
    assert.equal(row.status, 'done');
    assert.equal(row.progress, 100);
    assert.ok(String(row.result).includes('พบน้ำดื่ม'));
    assert.equal(row.role_name, 'ผู้ดูแลระบบน้ำ');
  });

  test('job failure marks status error with message', async () => {
    mockModel(prisma, 'agentRole', {
      findUnique: async () => ({
        id: 'r-2', name: 'x', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'farm', count: 1, enabled: true,
      }),
    });
    const created: any[] = [];
    mockModel(prisma, 'agentJob', {
      create: async (args: any) => { created.push({ ...args.data, id: 'j-2' }); return { ...args.data, id: 'j-2' }; },
      update: async (args: any) => { const r = created.find((j) => j.id === args.where.id); if (r) Object.assign(r, args.data); return r; },
      findMany: async (args: any) => (args.where?.status ? created.filter((j) => j.status === args.where.status) : created),
      findUnique: async (args: any) => created.find((j) => j.id === args.where.id) || null,
    });
    setAgentOllama({ post: async () => { throw new Error('ollama down'); } });
    const job = await runAgentJob('r-2', 'วิเคราะห์ฟาร์ม');
    assert.equal(job.id, 'j-2');
    await processAgentQueue();
    assert.equal(created[0].status, 'error');
    assert.match(String(created[0].error), /ollama down/);
  });

  test('cancelAgentJob cancels a queued job', async () => {
    const created: any[] = [{ id: 'j-3', status: 'queued', progress: 0, result: null, error: null, prompt: 'p', role_name: 'x', role_id: 'r-1', created_at: new Date(), started_at: null, completed_at: null }];
    mockModel(prisma, 'agentJob', {
      findUnique: async (args: any) => created.find((j) => j.id === args.where.id) || null,
      update: async (args: any) => { const r = created.find((j) => j.id === args.where.id); if (r) Object.assign(r, args.data); return r; },
      findMany: async (args: any) => (args.where?.status ? created.filter((j) => j.status === args.where.status) : created),
    });
    await cancelAgentJob('j-3');
    assert.equal(created[0].status, 'cancelled');
  });

  test('cancelAgentJob ignores a finished job', async () => {
    const finished = { id: 'j-5', status: 'done', progress: 100, result: 'x', error: null, prompt: 'p', role_name: 'x', role_id: 'r-1', created_at: new Date(), started_at: null, completed_at: new Date() };
    mockModel(prisma, 'agentJob', {
      findUnique: async (args: any) => finished,
      update: async () => { assert.fail('should not update a done job'); },
    });
    await cancelAgentJob('j-5');
    assert.equal(finished.status, 'done');
  });

  test('listAgentJobs returns newest first', async () => {
    mockModel(prisma, 'agentJob', {
      findMany: async (args: any) => {
        assert.equal(args.orderBy.created_at, 'desc');
        return [{ id: 'j-2', status: 'done' }, { id: 'j-1', status: 'queued' }];
      },
    });
    const rows = await listAgentJobs();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'j-2');
  });

  test('getAgentJob returns a single job', async () => {
    mockModel(prisma, 'agentJob', { findUnique: async (args: any) => ({ id: args.where.id, status: 'running', progress: 40 }) });
    const job = await getAgentJob('j-1');
    assert.equal(job.progress, 40);
  });

  test('processAgentQueue handles jobs left queued after restart', async () => {
    const queued = { id: 'j-4', status: 'queued', progress: 0, result: null, error: null, prompt: 'ประเมิน', role_name: 'x', role_id: 'r-1', created_at: new Date(), started_at: null, completed_at: null };
    mockModel(prisma, 'agentJob', {
      findMany: async (args: any) => (args.where?.status ? [{ ...queued, status: args.where.status }] : [queued]),
      update: async (args: any) => { Object.assign(queued, args.data); return queued; },
    });
    setAgentOllama({ post: async () => ({ data: { response: 'เสร็จ' } }) });
    const res = await processAgentQueue();
    assert.ok(res.ran >= 1);
    assert.equal(queued.status, 'done');
  });
});

describe('agent morning Telegram reports', () => {
  test('runMorningReports runs due role, sends Telegram and stamps date', async () => {
    const role = {
      id: 'r-1', name: 'ผู้ดูแลระบบน้ำ', emoji: '💧', description: 'x', system_prompt: 'p',
      capability: 'inventory', count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: null,
    };
    mockModel(prisma, 'agentRole', {
      findMany: async () => [role],
      update: async (args: any) => { Object.assign(role, args.data); return role; },
      findUnique: async () => role,
    });
    const created: any[] = [];
    mockModel(prisma, 'agentJob', {
      create: async (args: any) => { created.push({ ...args.data, id: 'j-1' }); return { ...args.data, id: 'j-1' }; },
      update: async (args: any) => { const r = created.find((j) => j.id === args.where.id); if (r) Object.assign(r, args.data); return r; },
      findMany: async (args: any) => (args.where?.status ? created.filter((j) => j.status === args.where.status) : created),
    });
    mockModel(prisma, 'inventoryItem', { findMany: async () => [] });
    const msgs: string[] = [];
    setAgentNotify(async (m: string) => { msgs.push(m); return true; });
    setAgentOllama({ post: async () => ({ data: { response: 'น้ำปกติ pH 7.0' } }) });
    const now = new Date('2026-08-12T07:30:00+07:00');
    const res = await runMorningReports(now);
    assert.equal(res.reported, 1);
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0].includes('ผู้ดูแลระบบน้ำ'));
    assert.ok(msgs[0].includes('น้ำปกติ'));
    assert.equal(role.last_report_date, '2026-08-12');
  });

  test('runMorningReports skips when already reported today', async () => {
    const role = {
      id: 'r-1', name: 'x', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'general',
      count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: '2026-08-12',
    };
    mockModel(prisma, 'agentRole', { findMany: async () => [role] });
    const msgs: string[] = [];
    setAgentNotify(async (m: string) => { msgs.push(m); return true; });
    const now = new Date('2026-08-12T08:00:00+07:00');
    const res = await runMorningReports(now);
    assert.equal(res.reported, 0);
    assert.equal(msgs.length, 0);
  });

  test('runMorningReports skips roles with daily_report off or before report hour', async () => {
    const off = {
      id: 'r-1', name: 'x', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'general',
      count: 1, enabled: true, daily_report: false, report_hour: 7, last_report_date: null,
    };
    const early = {
      id: 'r-2', name: 'y', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'general',
      count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: null,
    };
    mockModel(prisma, 'agentRole', { findMany: async () => [off, early] });
    setAgentNotify(async () => true);
    const res = await runMorningReports(new Date('2026-08-12T06:00:00+07:00'));
    assert.equal(res.reported, 0);
    assert.equal(res.skipped, 2);
  });

  // D1: ไม่มี Telegram credentials → ปิดเงียบแบบมี flag ชัดเจน (ไม่ crash cron อื่น ไม่สร้างงานเปล่า)
  test('runMorningReports: ไม่มี token → telegramConfigured=false ปิดเงียบ ไม่สร้างงาน ไม่มาร์ควัน', async () => {
    // setup-env ตั้ง env token ไว้ — mock systemSetting ให้ DB ว่างแล้วล้าง env ชั่วคราว
    mockModel(prisma, 'systemSetting', { findMany: async () => [] });
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChat = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      const role = {
        id: 'r-1', name: 'x', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'general',
        count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: null,
      };
      const created: any[] = [];
      mockModel(prisma, 'agentRole', {
        findMany: async () => [role],
        update: async (args: any) => { Object.assign(role, args.data); return role; },
      });
      mockModel(prisma, 'agentJob', { create: async (a: any) => { created.push(a.data); return { id: 'j', ...a.data }; } });
      const msgs: string[] = [];
      setAgentNotify(async (m: string) => { msgs.push(m); return true; });
      const res = await runMorningReports(new Date('2026-08-12T08:00:00+07:00'));
      assert.equal(res.telegramConfigured, false);
      assert.equal(res.reported, 0);
      assert.equal(created.length, 0); // ไม่สร้างงานเปล่า
      assert.equal(msgs.length, 0);
      assert.equal(role.last_report_date, null); // ไม่มาร์ควัน
    } finally {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      if (savedChat !== undefined) process.env.TELEGRAM_CHAT_ID = savedChat;
      // ล้าง cache ของ credentials service กันรบกวน test อื่น
      try { await (await import('../src/services/telegram-credentials.service')).clearTelegramCredentials(); } catch { /* ไม่มี helper ล้าง cache ก็ไม่เป็นไร */ }
    }
  });

  // D1: ส่งไม่สำเร็จ (notify ตอบ false) → ห้ามมาร์ค last_report_date — รอบถัดไป (30 นาที) ต้องลองใหม่
  test('runMorningReports: ส่ง Telegram ล้ม → ไม่มาร์ควัน รายงานไม่หาย (ลองใหม่รอบหน้า)', async () => {
    const role = {
      id: 'r-1', name: 'x', emoji: '🤖', description: 'x', system_prompt: 'p', capability: 'general',
      count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: null,
    };
    mockModel(prisma, 'agentRole', {
      findMany: async () => [role],
      update: async (args: any) => { Object.assign(role, args.data); return role; },
    });
    mockModel(prisma, 'agentJob', {
      create: async (a: any) => ({ id: 'j-1', ...a.data }),
      update: async (a: any) => ({ id: 'j-1', ...a.data }),
    });
    mockModel(prisma, 'device', { findMany: async () => [] });
    setAgentNotify(async () => false); // Telegram ตอบกลับว่าส่งไม่ถึง
    setAgentOllama({ post: async () => ({ data: { response: 'สรุป' } }) });
    const res = await runMorningReports(new Date('2026-08-12T08:00:00+07:00'));
    assert.equal(res.telegramConfigured, true);
    assert.equal(res.reported, 0);
    assert.equal(role.last_report_date, null); // ยังไม่มาร์ค — รอบหน้าลองใหม่
  });

  // D1: credentials มาจาก DB (ตั้งผ่าน UI) ก็ต้องทำงาน — พิสูจน์ hasTelegramCredentials อ่าน DB จริง
  test('runMorningReports: token จาก DB → telegramConfigured=true ส่งและมาร์ควันตามปกติ', async () => {
    mockModel(prisma, 'systemSetting', {
      findMany: async () => [
        { key: 'telegram.botToken', value: 'db-token' },
        { key: 'telegram.chatId', value: 'db-chat' },
      ],
    });
    const role = {
      id: 'r-1', name: 'ผู้ดูแลน้ำ', emoji: '💧', description: 'x', system_prompt: 'p', capability: 'inventory',
      count: 1, enabled: true, daily_report: true, report_hour: 7, last_report_date: null,
    };
    mockModel(prisma, 'agentRole', {
      findMany: async () => [role],
      update: async (args: any) => { Object.assign(role, args.data); return role; },
    });
    mockModel(prisma, 'agentJob', {
      create: async (a: any) => ({ id: 'j-1', ...a.data }),
      update: async (a: any) => ({ id: 'j-1', ...a.data }),
    });
    mockModel(prisma, 'inventoryItem', { findMany: async () => [] });
    const msgs: string[] = [];
    setAgentNotify(async (m: string) => { msgs.push(m); return true; });
    setAgentOllama({ post: async () => ({ data: { response: 'น้ำปกติ' } }) });
    const res = await runMorningReports(new Date('2026-08-12T08:00:00+07:00'));
    assert.equal(res.telegramConfigured, true);
    assert.equal(res.reported, 1);
    assert.equal(msgs.length, 1);
    assert.equal(role.last_report_date, '2026-08-12');
  });
});
