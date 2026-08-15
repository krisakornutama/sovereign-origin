import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('AI Kill-Switch (Global Emergency Override)', () => {
  let testDir: string;
  let stateFile: string;
  let aiKillSwitch: any;
  let actions: any;
  let executor: { calls: string[]; blockIp: (ip: string) => Promise<string>; unblockIp: (ip: string) => Promise<string>; killProcessByPid: (pid: number) => Promise<string>; killProcessByName: (name: string) => Promise<string> };

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-killswitch-'));
    stateFile = path.join(testDir, 'kill-switch.json');
    // ตั้ง env ก่อน dynamic import — kill-switch service อ่าน path ตอน module load
    process.env.AI_KILL_SWITCH_FILE = stateFile;

    // ดึง instance ใหม่ทั้งหมดใน process นี้ (node --test แยก process ต่อไฟล์อยู่แล้ว)
    const ksMod = await import('../src/services/ai-kill-switch.service');
    aiKillSwitch = ksMod.aiKillSwitch;
    aiKillSwitch.init();

    const { AgentPolicy } = await import('../src/services/agent-policy.service');
    const { AgentActionsService } = await import('../src/services/agent-actions.service');
    executor = {
      calls: [] as string[],
      async blockIp(ip: string) { executor.calls.push(`blockIp:${ip}`); return `blocked ${ip}`; },
      async unblockIp(ip: string) { executor.calls.push(`unblockIp:${ip}`); return `unblocked ${ip}`; },
      async killProcessByPid(pid: number) { executor.calls.push(`killProcessByPid:${pid}`); return `killed ${pid}`; },
      async killProcessByName(name: string) { executor.calls.push(`killProcessByName:${name}`); return `killed ${name}`; },
    };
    const policy = new AgentPolicy({ autonomy: 'suggest' });
    actions = new AgentActionsService(policy, executor);
  });

  after(() => {
    try {
      aiKillSwitch?.set(false, '', 'test cleanup');
    } catch {}
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.AI_KILL_SWITCH_FILE;
  });

  test('init: เริ่มต้นเป็น OFF เสมอ', () => {
    const st = aiKillSwitch.status();
    assert.equal(st.active, false);
    assert.equal(aiKillSwitch.isActive(), false);
  });

  test('set(true): เปิดสวิตช์ + เหตุผล + persist ลงไฟล์', () => {
    const st = aiKillSwitch.set(true, 'พบ prompt injection loop', 'admin');
    assert.equal(st.active, true);
    assert.equal(st.reason, 'พบ prompt injection loop');
    assert.equal(st.by, 'admin');
    assert.ok(typeof st.at === 'number');
    assert.equal(aiKillSwitch.isActive(), true);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, true);
    assert.equal(saved.reason, 'พบ prompt injection loop');
  });

  test('set(true) ไม่ใส่เหตุผล: เติมข้อความเริ่มต้น', () => {
    aiKillSwitch.set(true, '', 'admin');
    assert.ok(aiKillSwitch.status().reason.length > 0, 'เหตุผลต้องไม่ว่าง');
  });

  test('set(false): ปลดล็อก + persist', () => {
    const st = aiKillSwitch.set(false, '', 'admin');
    assert.equal(st.active, false);
    assert.equal(aiKillSwitch.isActive(), false);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, false);
  });

  test('executeAction: kill-switch ON → denied ทุก action tool, executor ไม่ถูกเรียก', async () => {
    aiKillSwitch.set(true, 'test: ฉุกเฉิน', 'tester');
    executor.calls.length = 0;
    const r1 = await actions.executeAction('blockIP', { ip: '1.1.1.1' }, { source: 'system-ui' });
    assert.equal(r1.status, 'denied');
    assert.ok(String(r1.reason).includes('Kill-Switch'), `reason ต้องระบุ kill-switch: ${r1.reason}`);
    const r2 = await actions.executeAction('killProcess', { pid: 12345 }, { source: 'chat' });
    assert.equal(r2.status, 'denied');
    assert.deepEqual(executor.calls, [], 'ห้าม execute อะไรจริง');
    aiKillSwitch.set(false, '', 'tester');
  });

  test('approveApproval: kill-switch ON → ไม่อนุมัติ (คำขอค้าง pending ไม่ถูกดำเนินการ)', async () => {
    aiKillSwitch.set(false, '', 'tester'); // ปลดก่อนเพื่อสร้าง approval
    executor.calls.length = 0;
    const queued = await actions.executeAction('blockIP', { ip: '2.2.2.2' });
    assert.equal(queued.status, 'requires_approval');
    const id = queued.approval_id;
    assert.ok(id);

    aiKillSwitch.set(true, 'test: ฉุกเฉิน', 'tester');
    const denied = await actions.approveApproval(id, 'admin');
    assert.equal(denied.status, 'denied');
    assert.ok(String(denied.reason).includes('Kill-Switch'));
    assert.deepEqual(executor.calls, [], 'ต้องไม่ execute');
    const stillPending = actions.listApprovals().find((a: any) => a.id === id);
    assert.equal(stillPending?.status, 'pending', 'คำขอต้องค้างไว้ (ไม่ reject — รอปลดสวิตช์แล้วอนุมัติใหม่ได้)');
    aiKillSwitch.set(false, '', 'tester');
  });

  test('kill-switch OFF: กลับสู่พฤติกรรมปกติ (suggest → ขึ้น bucket approval)', async () => {
    aiKillSwitch.set(false, '', 'tester');
    executor.calls.length = 0;
    const r = await actions.executeAction('blockIP', { ip: '3.3.3.3' }, { source: 'security-ui' });
    assert.equal(r.status, 'requires_approval', 'kill-switch ปิดแล้วต้องทำงานปกติ');
    assert.deepEqual(executor.calls, []);
  });

  test('processMessage: kill-switch ON → ตอบทันที ไม่เรียก Ollama', async () => {
    aiKillSwitch.set(true, 'test: ฉุกเฉิน', 'tester');
    const { aiAgent } = await import('../src/services/AiAgentService');
    const reply = await aiAgent.processMessage('สวัสดี ทำอะไรก็ได้', { actor: 'unit-test' });
    assert.ok(typeof reply === 'string' && reply.includes('Kill-Switch'), `คำตอบต้องบอกว่าโดนหยุด: ${reply}`);
    aiKillSwitch.set(false, '', 'tester');
  });
});