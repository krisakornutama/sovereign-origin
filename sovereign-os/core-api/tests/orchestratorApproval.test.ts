import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import { prisma } from '../src/lib/prisma';
import {
  classifyRisk,
  gateJobBeforeDispatch,
  approveJob,
  rejectJob,
  parseJobCallback,
} from '../src/services/orchestrator-approval.service';
import { extractCallbackData, TelegramAgentBot } from '../src/services/telegram-agent-bot.service';
import { sendTelegramVoice } from '../src/modules/telegram/telegram.routes';

/** เก็บทุก update ที่โค้ดพยายามเขียนลง AgentJob (ทั้ง update และ updateMany) */
function captureJobUpdates(row: Record<string, unknown> = {}): { updates: any[] } {
  const updates: any[] = [];
  mockModel(prisma as any, 'agentJob', {
    update: async (args: any) => {
      updates.push(args);
      return { id: args.where.id, ...row, ...args.data };
    },
    // เลียนแบบ Prisma: count = 0 เมื่อเงื่อนไข where ไม่ตรงกับสถานะปัจจุบันของแถว
    // (แถวที่ไม่ตรงเงื่อนไขไม่ถูกเขียนจริง → ไม่บันทึกลง updates)
    updateMany: async (args: any) => {
      const current = 'status' in row ? String(row.status) : 'awaiting_approval';
      const want = args.where?.status;
      const count = !want || want === current ? 1 : 0;
      if (count > 0) updates.push(args);
      return { count };
    },
    findUnique: async () => ({ id: 'job-1', status: 'awaiting_approval', prompt: 'x', ...row }),
    findMany: async () => [],
  });
  return { updates };
}

describe('orchestrator-approval — จัดระดับความเสี่ยง', () => {
  test('งานทั่วไปไม่เสี่ยง', () => {
    assert.equal(classifyRisk('อ่านไฟล์สรุปยอดขายเดือนนี้ให้หน่อย'), 'low');
  });

  test('งานที่ลบข้อมูล/ระบบต้องถือว่าเสี่ยง', () => {
    for (const p of [
      'rm -rf /',
      'DROP TABLE agent_jobs',
      'git push --force',
      'ลบไฟล์ทั้งหมดในโฟลเดอร์',
      'deploy production ทันที',
      'โอนเงินออกบัญชี',
    ]) {
      assert.equal(classifyRisk(p), 'high', `ควรจับเป็นเสี่ยง: ${p}`);
    }
  });

  test('งานทั่วไปที่พูดถึงการลบแต่ไม่ลบทั้งระบบ ต้องไม่ถูกกัก (ไม่ให้ผู้ใช้เบื่อจนกดมั่ว)', () => {
    for (const p of [
      'ลบไฟล์ log ที่เก่ากว่า 30 วัน',
      'ล้าง cache ก่อน build',
      'ลบไฟล์ build ในโฟลเดอร์ dist',
    ]) {
      assert.equal(classifyRisk(p), 'low', `ไม่ควรกัก: ${p}`);
    }
  });

  test('ขอบเขตการลบที่กว้างยังถูกจับแม้ไม่ใช้คำว่า "ลบ"', () => {
    assert.equal(classifyRisk('ลบฐานข้อมูลทั้งหมด'), 'high');
    assert.equal(classifyRisk('ล้างข้อมูลทั้งหมด'), 'high');
    // red-first: `[^newline]` ใน regex ไม่ใช่ "ไม่ใช่ newline" แต่คือ "ไม่ใช่ตัวอักษร n,e,w,l"
    // ทำให้ข้ามคำกลางที่มีตัวอักษรเหล่านั้นไม่ได้ → งานกักไม่ได้
    assert.equal(classifyRisk('ล้าง cache ทั้งหมด'), 'high');
    assert.equal(classifyRisk('ลบโฟลเดอร์ node_modules ทั้งหมด'), 'high');
    assert.equal(classifyRisk('ทิ้งไฟล์เก่าใน public ทั้งหมด'), 'high');
  });

  test('ผู้ใช้บังคับระดับความเสี่ยงเองได้ (ไม่ hardcode)', () => {
    assert.equal(classifyRisk('อ่านไฟล์ธรรมดา', 'high'), 'high');
    assert.equal(classifyRisk('rm -rf /', 'low'), 'low');
    assert.equal(classifyRisk('อ่านไฟล์', undefined), 'low');
  });
});

describe('orchestrator-approval — งานเสี่ยงต้องรอกดก่อนถึงเครื่อง', () => {
  test('งานเสี่ยงถูกพักไว้ awaiting_approval ก่อน dispatch', async () => {
    const { updates } = captureJobUpdates({ risk: 'high' });
    const out = await gateJobBeforeDispatch({
      id: 'job-1',
      prompt: 'rm -rf /',
      machine_id: 'm-1',
      executor: 'opencode',
      risk: 'high',
    });
    assert.equal(out.needsApproval, true);
    assert.equal(out.status, 'awaiting_approval');
    assert.ok(
      updates.some((u) => u.data?.status === 'awaiting_approval'),
      'ต้องเปลี่ยนสถานะ job เป็น awaiting_approval'
    );
  });

  test('งานไม่เสี่ยงปล่อยให้รันต่อ ไม่แตะ DB', async () => {
    const { updates } = captureJobUpdates({ risk: 'low' });
    const out = await gateJobBeforeDispatch({
      id: 'job-1',
      prompt: 'อ่านสรุปให้หน่อย',
      machine_id: 'm-1',
      executor: 'opencode',
      risk: 'low',
    });
    assert.equal(out.needsApproval, false);
    assert.equal(out.status, 'queued');
    assert.equal(updates.length, 0);
  });

  test('ไม่ระบุความเสี่ยงมา → ตัดสินจากเนื้อหา prompt เอง', async () => {
    const { updates } = captureJobUpdates({ risk: undefined });
    const out = await gateJobBeforeDispatch({
      id: 'job-1',
      prompt: 'DROP TABLE agent_jobs',
      machine_id: 'm-1',
      executor: 'opencode',
    });
    assert.equal(out.needsApproval, true);
    assert.equal(out.risk, 'high');
    assert.ok(updates.length > 0);
  });
});

describe('orchestrator-approval — ตัดสินใจจากปุ่ม Telegram', () => {
  test('อนุมัติแล้ว job กลับไปรอเครื่องดึง (queued) พร้อมบันทึกผู้อนุมัติ', async () => {
    const { updates } = captureJobUpdates();
    const out = await approveJob('job-1', 'user-1');
    assert.equal(out.ok, true);
    assert.equal(out.status, 'queued');
    assert.ok(updates.some((u) => u.data?.status === 'queued'));
    assert.ok(updates.some((u) => u.data?.approved_by === 'user-1'));
    assert.ok(updates.some((u) => u.data?.approved_at instanceof Date));
  });

  test('อนุมัติต้องเขียนแบบมีเงื่อนไข — กันคนสองกดพร้อมกันเขียนทับ', async () => {
    const { updates } = captureJobUpdates();
    await approveJob('job-1', 'user-1');
    assert.equal(updates[0].where.status, 'awaiting_approval', 'ต้องมี where.status');
  });

  test('ปฏิเสธแล้ว job ถูกยกเลิก (cancelled)', async () => {
    const { updates } = captureJobUpdates();
    const out = await rejectJob('job-1', 'user-1');
    assert.equal(out.ok, true);
    assert.equal(out.status, 'cancelled');
    assert.ok(updates.some((u) => u.data?.status === 'cancelled'));
  });

  test('กดปุ่มซ้ำบนงานที่ตัดสินใจแล้วต้องไม่ทำอะไร', async () => {
    const { updates } = captureJobUpdates({ status: 'done' });
    const out = await approveJob('job-1', 'user-1');
    assert.equal(out.ok, false);
    assert.equal(updates.length, 0);
  });

  test('กดอนุมัติเมื่อมีคนอนุมัติไปแล้ว (แข่งขัน) ต้องไม่เขียนทับ', async () => {
    let calls = 0;
    mockModel(prisma as any, 'agentJob', {
      updateMany: async () => {
        calls++;
        return { count: 1 };
      },
      update: async (args: any) => {
        calls++;
        return { id: args.where.id, ...args.data };
      },
      findUnique: async () => ({ id: 'job-1', status: 'awaiting_approval' }),
    });
    const out = await approveJob('job-1', 'user-1');
    assert.equal(out.ok, true);
    assert.equal(calls, 1, 'ต้องอัปเดตแบบมีเงื่อนไข (status=awaiting_approval) กันเขียนทับ');
  });
});

describe('orchestrator-approval — แยกคำสั่งจากปุ่มเดิมของ agent action', () => {
  test('parse jobok:/jobreject: ได้', () => {
    assert.deepEqual(parseJobCallback('jobok:job-9'), { action: 'approve', jobId: 'job-9' });
    assert.deepEqual(parseJobCallback('jobreject:job-9'), { action: 'reject', jobId: 'job-9' });
    assert.equal(parseJobCallback('approve:job-9'), null, 'ปุ่มของ agent action ต้องไม่ถูกจับ');
    assert.equal(parseJobCallback('โหนดคำสั่ง'), null);
  });

  test('ปุ่มเดิมของ agent action ยังถูกอ่านเป็นเดิม (ไม่พังของเก่า)', () => {
    assert.deepEqual(extractCallbackData('approve:abc-1'), { action: 'approve', id: 'abc-1' });
    assert.deepEqual(extractCallbackData('reject:abc-1'), { action: 'reject', id: 'abc-1' });
  });
});

// ── ปุ่มจริงที่วิ่งเข้ามาทาง long polling ──
function bot() {
  const sent: string[] = [];
  const b = new TelegramAgentBot({
    send: async (t) => {
      sent.push(t);
      return true;
    },
    resolveActor: async () => 'user-1',
    allowedChatId: '12345',
    token: '', // ปิด answerCallbackQuery จริง (ไม่ต้องยิงเน็ตในเทสต์)
  });
  return { b, sent };
}

describe('orchestrator-approval — ปุ่มจริงที่มาทาง Telegram', () => {
  test('กด ✅ → ปล่อยงานกลับเข้าคิว และตอบกลับในแชท', async () => {
    const { updates } = captureJobUpdates();
    const { b, sent } = bot();
    await b.handleUpdate({
      callback_query: { id: 'cb1', from: { id: 12345 }, data: 'jobok:job-1' },
    });
    assert.ok(updates.some((u) => u.data?.status === 'queued'));
    assert.ok(sent.some((t) => /ปล่อยงานให้เครื่องทำแล้ว/.test(t)));
  });

  test('กด 🚫 → ยกเลิกงาน', async () => {
    const { updates } = captureJobUpdates();
    const { b, sent } = bot();
    await b.handleUpdate({
      callback_query: { id: 'cb2', from: { id: 12345 }, data: 'jobreject:job-1' },
    });
    assert.ok(updates.some((u) => u.data?.status === 'cancelled'));
    assert.ok(sent.some((t) => /ยกเลิกงานแล้ว/.test(t)));
  });

  test('ปุ่มจากแชทอื่นถูกปฏิเสธ — ไม่มีใครปล่อยงานของคนอื่นได้', async () => {
    const { updates } = captureJobUpdates();
    const { b, sent } = bot();
    await b.handleUpdate({
      callback_query: { id: 'cb3', from: { id: 99999 }, data: 'jobok:job-1' },
    });
    assert.equal(updates.length, 0, 'ห้ามเขียนสถานะงานจากแชทที่ไม่ได้รับอนุญาต');
    assert.equal(sent.length, 0);
  });

  test('ปุ่มเดิมของ agent action ยังทำงานผ่านเส้นทางนี้ (regression)', async () => {
    const { b } = bot();
    let approved = '';
    (b as any).actions.approveApproval = async (id: string) => {
      approved = id;
      return { status: 'ok', result: 'เรียบร้อย' };
    };
    await b.handleUpdate({
      callback_query: { id: 'cb4', from: { id: 12345 }, data: 'approve:abc-1' },
    });
    assert.equal(approved, 'abc-1');
  });
});

describe('orchestrator-notify — เสียงพูดที่สังเคราะห์ไม่ได้ต้องไม่ทำให้ระบบล้ม', () => {
  test('sendTelegramVoice คืน false เมื่อไม่มี credential (ไม่ throw)', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    const prevChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';
    try {
      const ok = await sendTelegramVoice('ทดสอบเสียง');
      assert.equal(ok, false);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = prev;
      process.env.TELEGRAM_CHAT_ID = prevChat;
    }
  });
});