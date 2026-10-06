import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATOR_ALERT_TIERS,
  buildApprovalButtons,
  buildJobAlertText,
  resolveAlertTiers,
  notifyJobFinished,
  notifyJobNeedsApproval,
  type NotifyDeps,
} from '../src/services/orchestrator-notify.service';
import {
  resolveCallProvider,
  placeCall,
  isDialableNumber,
  type CallerDeps,
} from '../src/services/caller.service';

// ── DI ทั้งหมด — ไม่ยิง Telegram/โทรจริงในเทสต์ ──
function deps(over: Partial<NotifyDeps> = {}): NotifyDeps & { sent: string[]; called: any[]; voiced: string[] } {
  const sent: string[] = [];
  const voiced: string[] = [];
  const called: any[] = [];
  const base = {
    sendText: async (t: string) => {
      sent.push(t);
      return true;
    },
    sendVoice: async (t: string) => {
      voiced.push(t);
      return true;
    },
    call: async (payload: any) => {
      called.push(payload);
      return { ok: true, provider: 'bland', callId: 'call-1' };
    },
  };
  return { sent, voiced, called, ...base, ...over } as any;
}

describe('orchestrator-notify — ระดับการแจ้งเตือน', () => {
  test('ระดับที่ปลอดภัยเริ่มต้นคือข้อความ Telegram เท่านั้น (ไม่โทรและไม่เสียงเอง)', () => {
    assert.deepEqual(resolveAlertTiers(undefined), ['text']);
    assert.deepEqual(resolveAlertTiers(''), ['text']);
    assert.deepEqual(ORCHESTRATOR_ALERT_TIERS, ['text', 'voice', 'call']);
  });

  test('ระดับที่เลือกมาต้องอยู่ในรายการที่ระบบรู้จัก', () => {
    assert.deepEqual(resolveAlertTiers('text,voice'), ['text', 'voice']);
    assert.deepEqual(resolveAlertTiers('voice'), ['voice']);
    assert.deepEqual(resolveAlertTiers('bogus'), []);
  });
});

describe('orchestrator-notify — ข้อความ', () => {
  test('ข้อความงานเสร็จมีผลลัพธ์และตัวแปรที่ผู้ใช้สั่งเอง', () => {
    const text = buildJobAlertText({
      status: 'done',
      jobId: 'job-1',
      machineName: 'คอมเครื่องที่ 2',
      executor: 'opencode',
      model: 'qwen3:4b',
      result: 'แก้บั๊กแล้ว',
      exitCode: 0,
    });
    assert.match(text, /คอมเครื่องที่ 2/);
    assert.match(text, /opencode/);
    assert.match(text, /qwen3:4b/);
    assert.match(text, /แก้บั๊กแล้ว/);
  });

  test('ข้อความงานล้มเหลวต้องบอก error และ exit code', () => {
    const text = buildJobAlertText({
      status: 'error',
      jobId: 'job-1',
      machineName: 'คอมเครื่องที่ 2',
      executor: 'opencode',
      error: 'Insufficient account funds',
      exitCode: 1,
    });
    assert.match(text, /Insufficient account funds/);
    assert.match(text, /exit 1/);
  });

  test('escape HTML ไม่ให้ prompt ที่โหลดมาพัง markup ของ Telegram', () => {
    const text = buildJobAlertText({
      status: 'done',
      jobId: 'job-1',
      machineName: 'a & <b>',
      executor: 'echo',
      result: '<script>x</script>',
    });
    assert.ok(!text.includes('<script>'));
    assert.ok(text.includes('&lt;script&gt;'));
  });
});

describe('orchestrator-notify — ส่งจริง', () => {
  test('งานเสร็จส่งข้อความและรายงานว่าสำเร็จ', async () => {
    const d = deps();
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'opencode', result: 'ok' },
      d
    );
    assert.equal(res.delivered, true);
    assert.equal(d.sent.length, 1);
    assert.deepEqual(res.tiers, [{ tier: 'text', ok: true }]);
  });

  test('ระดับ voice เรียก sendVoice หลังข้อความ และระดับ call เรียก call', async () => {
    const d = deps();
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['text', 'voice', 'call'], callTo: '+66812345678' }
    );
    assert.deepEqual(d.sent.length, 1);
    assert.deepEqual(d.voiced.length, 1);
    assert.equal(d.called.length, 1);
    assert.equal(res.delivered, true);
    assert.equal(res.tiers.length, 3);
  });

  test('ไม่มีเบอร์โทร → ไม่ยิงโทรออกไปข้างนอก', async () => {
    const d = deps({ loadCallTo: async () => null } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['text', 'call'] }
    );
    assert.equal(d.called.length, 0);
    assert.equal(res.tiers[1].ok, false);
  });

  test('CALL_PROVIDER=none ต้องเป็น no-op ที่ปลอดภัย — ไม่ต้องมีเบอร์โทรก็ไม่ error', async () => {
    const d = deps({
      call: async () => ({ ok: false, skipped: true, reason: 'provider disabled' }) as any,
    } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['text', 'call'], callTo: '+66812345678' }
    );
    assert.equal(res.delivered, true, 'ข้อความสำเร็จก็นับว่าส่งถึงแล้ว');
    assert.deepEqual(res.tiers[1], { tier: 'call', ok: false, reason: 'provider disabled' });
  });

  test('Telegram ล่มต้องไม่ทำให้ระบบล้ม — คืน delivered=false และ error', async () => {
    const d = deps({
      sendText: async () => {
        throw new Error('telegram 502');
      },
    } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d
    );
    assert.equal(res.delivered, false);
    assert.match(String(res.error), /telegram 502/);
  });

  test('ตัวเลือกว่าจะโทรเบอร์ไหนมาจาก env ตอนเรียก (ผู้ใช้ตั้งเองต่องาน)', async () => {
    const d = deps();
    await notifyJobFinished(
      { status: 'error', jobId: 'job-1', machineName: 'PC-2', executor: 'opencode', error: 'บูม', exitCode: 1 },
      d,
      { tiers: ['call'], callTo: '+66812345678' }
    );
    assert.equal(d.called[0].to, '+66812345678');
    assert.match(d.called[0].message, /PC-2/);
  });
});

// red-first: ก่อนแก้ ไม่มีที่ไหนส่ง callTo เลย ⇒ เปิด CALL_PROVIDER=bland ก็โทรไม่ออก
// เพราะระบบไม่รู้จะโทรเบอร์ไหน (ผู้ใช้เปิดสวิตช์เห็นว่าพร้อม แต่กดแล้วไม่มีอะไรเกิดขึ้น)
describe('orchestrator-notify — เบอร์โทรต้องมาจากที่เก็บจริง ไม่ใช่ค่าว่างตลอดไป', () => {
  test('ไม่ส่ง callTo มา ระบบต้องไปหาเบอร์ที่ตั้งไว้เองแล้วโทร', async () => {
    const d = deps({ loadCallTo: async () => '+66812345678' } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['call'] }
    );
    assert.equal(d.called.length, 1, 'ต้องโทรจริง ไม่ใช่ตกเพราะไม่มีใครส่ง callTo');
    assert.equal(d.called[0].to, '+66812345678');
    assert.equal(res.tiers[0].ok, true);
  });

  test('หาเบอร์ล้มเหลวต้องไม่ throw — งานที่เพิ่งเสร็จต้องไม่กลายเป็น error', async () => {
    const d = deps({
      loadCallTo: async () => {
        throw new Error('DB down');
      },
    } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['call'] }
    );
    assert.equal(d.called.length, 0);
    assert.equal(res.tiers[0].ok, false);
  });

  test('callTo ที่ส่งมาเองต้องชนะค่าที่หาจากที่เก็บ (ผู้ใช้บังคับต่องานได้)', async () => {
    const d = deps({ loadCallTo: async () => '+66900000000' } as any);
    await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['call'], callTo: '+66812345678' }
    );
    assert.equal(d.called[0].to, '+66812345678');
  });

  test('เบอร์ที่หามาต้องผ่าน E.164 ก่อนโทร — เบอร์ผิดรูปไม่ยิงออกนอกเครื่อง', async () => {
    const d = deps({ loadCallTo: async () => '0812345678' } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['call'] }
    );
    assert.equal(d.called.length, 0, 'เบอร์ไม่ใช่ E.164 ห้ามยิง');
    assert.match(String(res.tiers[0].reason), /E\.164/);
  });

  test('ไม่มี provider แล้วต้องยังทำงานต่อแบบ no-op ไม่ throw', async () => {
    const d = deps({
      loadCallTo: async () => '+66812345678',
      call: async () => ({ ok: false, skipped: true, reason: 'CALL_PROVIDER=none — ไม่โทรออก' }) as any,
    } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['text', 'call'] }
    );
    assert.equal(res.delivered, true, 'ข้อความสำเร็จก็นับว่าส่งถึงแล้ว');
    assert.equal(d.sent.length, 1);
    assert.match(String(res.tiers[1].reason), /provider/i);
  });

  test('ไม่มีเบอร์ในระบบเลย → ข้ามชั้น call เป็น no-op และบอกว่าไปตั้งที่ไหน', async () => {
    const d = deps({ loadCallTo: async () => null } as any);
    const res = await notifyJobFinished(
      { status: 'done', jobId: 'job-1', machineName: 'PC-2', executor: 'echo', result: 'ok' },
      d,
      { tiers: ['text', 'call'] }
    );
    assert.equal(d.called.length, 0);
    assert.match(String(res.tiers[1].reason), /Settings/);
  });
});

describe('orchestrator-notify — ปุ่มอนุมัติงานเสี่ยง', () => {
  test('ข้อความขออนุมัติต้องมีปุ่ม ✅/🚫 ผูกกับ job id', async () => {
    const d = deps();
    const res = await notifyJobNeedsApproval(
      { jobId: 'job-9', machineName: 'PC-2', executor: 'opencode', prompt: 'rm -rf /' },
      d
    );
    assert.equal(res.delivered, true);
    assert.equal(d.sent.length, 1);
  });

  test('ปุ่มอนุมัติต้องใช้ prefix ของตัวเอง ไม่ชนกับ approve/reject ของ agent action', () => {
    const buttons = buildApprovalButtons('job-9');
    assert.deepEqual(buttons, [
      { text: '✅ อนุมัติให้รัน', data: 'jobok:job-9' },
      { text: '🚫 ยกเลิกงาน', data: 'jobreject:job-9' },
    ]);
  });
});

describe('caller.service — provider-agnostic', () => {
  test('ค่าเริ่มต้นคือ none และไม่ต้องมี key ใด ๆ', () => {
    assert.equal(resolveCallProvider(undefined), 'none');
    assert.equal(resolveCallProvider(''), 'none');
    assert.equal(resolveCallProvider('none'), 'none');
    assert.equal(resolveCallProvider('bland'), 'bland');
    assert.equal(resolveCallProvider('twilio'), 'twilio');
    assert.equal(resolveCallProvider('weird'), 'none', 'ค่าแปลกปลอมต้อง fallback เป็น none ไม่ใช่ยิงผิดที่');
  });

  test('provider none คืน skipped=true และไม่ยิง HTTP ใด ๆ', async () => {
    let called = 0;
    const d: CallerDeps = {
      provider: 'none',
      post: async () => {
        called++;
        return {};
      },
    } as any;
    const res = await placeCall({ to: '+66812345678', message: 'ทดสอบ' }, d);
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(called, 0);
  });

  test('เบอร์โทรต้องผ่าน validation ก่อน — เบอร์มั่วโยงไม่ผ่าน', () => {
    assert.equal(isDialableNumber('+66812345678'), true);
    assert.equal(isDialableNumber('0812345678'), false);
    assert.equal(isDialableNumber('not-a-number'), false);
    assert.equal(isDialableNumber(''), false);
  });

  test('bland ต้องส่ง payload ตามที่ Bland AI กำหนด', async () => {
    let seen: any = null;
    const d: CallerDeps = {
      provider: 'bland',
      apiKey: 'bl-test',
      voiceId: 'v-1',
      post: async (url: string, body: any, headers: any) => {
        seen = { url, body, headers };
        return { data: { id: 'call-xyz' } };
      },
    } as any;
    const res = await placeCall({ to: '+66812345678', message: 'เสร็จแล้ว' }, d);
    assert.equal(res.ok, true);
    assert.equal(res.callId, 'call-xyz');
    assert.match(seen.url, /bland\.ai/);
    assert.equal(seen.body.phone_number, '+66812345678'); // Bland ใช้ phone_number ไม่ใช่ to
    assert.equal(seen.body.voice_id, 'v-1');
    assert.match(seen.headers.Authorization, /Bearer bl-test/);
  });

  test('bland ไม่มี key ต้องข้ามแบบปลอดภัย ไม่ throw', async () => {
    const d: CallerDeps = {
      provider: 'bland',
      apiKey: '',
      post: async () => {
        throw new Error('ไม่ควรถูกเรียก');
      },
    } as any;
    const res = await placeCall({ to: '+66812345678', message: 'x' }, d);
    assert.equal(res.ok, false);
    assert.match(String(res.reason), /BLAND_API_KEY/);
  });

  test('provider ล้มเหลวจากเครือข่ายต้องคืน ok=false ไม่ throw', async () => {
    const d: CallerDeps = {
      provider: 'bland',
      apiKey: 'bl-test',
      post: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as any;
    const res = await placeCall({ to: '+66812345678', message: 'x' }, d);
    assert.equal(res.ok, false);
    assert.match(String(res.reason), /ECONNREFUSED/);
  });

  test('เบอร์ไม่ผ่าน validation ต้องไม่ยิง request ออกไปข้างนอก', async () => {
    let called = 0;
    const d: CallerDeps = {
      provider: 'bland',
      apiKey: 'bl-test',
      post: async () => {
        called++;
        return {};
      },
    } as any;
    const res = await placeCall({ to: '0812345678', message: 'x' }, d);
    assert.equal(res.ok, false);
    assert.equal(called, 0);
    assert.match(String(res.reason), /E\.164/);
  });
});