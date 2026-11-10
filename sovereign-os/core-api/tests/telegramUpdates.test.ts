import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { prisma } from '../src/lib/prisma';
import telegramRoutes from '../src/modules/telegram/telegram.routes';
import { __resetTelegramCredentialCache } from '../src/services/telegram-credentials.service';
import {
  takeUpdatesSlot,
  __resetUpdatesThrottle,
  __setUpdatesSlotStore,
  createMemorySlotStore,
  prismaSlotStore,
} from '../src/modules/telegram/updates-throttle';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

// GET /api/telegram/updates — ดึง chat ID อัตโนมัติ (ปุ่มในหน้า settings)
// เทสต์นี้ครอบ "การ map ผล getUpdates" ฝั่ง server ซึ่ง E2E ฝั่งเบราว์เซอร์มองไม่เห็น
// (E2E intercept request ทั้งก้อน ⇒ ไม่ได้พิสูจน์ว่า map/dedup/กรองถูก)
// ไม่มีการยิง Telegram จริง: axios ถูก mock ทุกเคส

let server: TestServer;
let adminToken: string;

before(async () => {
  // getTelegramCredentials() อ่าน system_settings ก่อนตกไปใช้ env — ให้ตารางว่างแบบ resolve ทันที
  mockModel(prisma as any, 'systemSetting', {
    findMany: async () => [] as any[],
    findFirst: async () => null,
  });
  server = await createTestServer((app) => app.use('/api/telegram', telegramRoutes));
  adminToken = makeToken('SUPERADMIN');
});

// throttle จริงเก็บใน DB (telegram_updates_slot) — เทสต์ route ใช้ store ในหน่วยความจำแทน
// เพื่อไม่ให้ต้องมี Postgres ตอนรัน unit test · แต่ละเคสต้องเริ่มจากศูนย์ ไม่งั้นเคสหลังจะโดน 429 ของเราเอง
__setUpdatesSlotStore(createMemorySlotStore());
beforeEach(async () => { await __resetUpdatesThrottle(); });

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function getUpdates(headers: Record<string, string> = { Authorization: `Bearer ${adminToken}` }) {
  return fetch(server.baseUrl + '/api/telegram/updates', { headers });
}

/** คำตอบจาก api.telegram.org ตามรูปแบบจริง */
const updatesResponse = (result: unknown[]) => ({ data: { ok: true, result } });

test('map getUpdates → chatId/title/type/text และ dedup chatId ซ้ำ', async () => {
  const getMock = mock.method(axios, 'get', async () =>
    updatesResponse([
      {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 1000000001, type: 'group', title: 'บ้านเรา' },
          text: 'สวัสดี',
        },
      },
      // chatId เดิม (ข้อความใหม่ในห้องเดียวกัน) → ต้องเหลือแถวเดียว
      {
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: 1000000001, type: 'group', title: 'บ้านเรา' },
          text: 'อีกข้อความ',
        },
      },
      // ผู้ใช้ส่วนตัว: ไม่มี title → ใช้ username/first_name แทน
      {
        update_id: 3,
        message: {
          message_id: 12,
          chat: { id: 2000000002, type: 'private', username: 'somchai' },
          text: 'หวัดดี',
        },
      },
      // โพสต์ในช่อง: ข้อมูลอยู่ใน channel_post ไม่ใช่ message
      {
        update_id: 4,
        channel_post: {
          message_id: 13,
          chat: { id: -1001234567890, type: 'channel', title: 'ประกาศ' },
          text: 'ข่าวสาร',
        },
      },
    ])
  );

  try {
    const res = await getUpdates();
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { chats: any[] };

    assert.deepStrictEqual(
      body.chats.map((c) => c.chatId),
      ['1000000001', '2000000002', '-1001234567890'],
      'ต้อง dedup chatId เดิม และคงลำดับที่เจอก่อน'
    );
    assert.deepStrictEqual(body.chats[0], {
      chatId: '1000000001',
      title: 'บ้านเรา',
      type: 'group',
      text: 'สวัสดี',
    });
    assert.strictEqual(body.chats[1].title, 'somchai', 'ไม่มี title → ใช้ username');
    assert.strictEqual(body.chats[2].title, 'ประกาศ', 'channel_post ต้องอ่าน chat ของโพสต์');
    assert.strictEqual(body.chats[2].type, 'channel');

    // ยิงด้วย token ที่ตั้งไว้จริง (จาก env ของชุดเทสต์) — ไม่มี token ปลอมหลุดไป
    assert.strictEqual(getMock.mock.callCount(), 1);
    assert.match(String(getMock.mock.calls[0].arguments[0]), /\/getUpdates$/);
  } finally {
    getMock.mock.restore();
  }
});

test('update ที่ไม่มี chat (chatId ว่าง) ถูกกรองออก ไม่กลายเป็นแถวเปล่าใน UI', async () => {
  const getMock = mock.method(axios, 'get', async () =>
    updatesResponse([
      { update_id: 1 }, // ไม่มี message/channel_post เลย
      { update_id: 2, message: { message_id: 1, text: 'ไม่มี chat' } },
      { update_id: 3, edited_message: { message_id: 2, chat: { id: 3000000003 }, text: 'แก้ข้อความ' } },
      { update_id: 4, message: { message_id: 3, chat: { id: 4000000004, type: 'private' }, text: 'มี chat' } },
    ])
  );

  try {
    const res = await getUpdates();
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { chats: any[] };
    assert.deepStrictEqual(body.chats.map((c) => c.chatId), ['4000000004'], 'เหลือเฉพาะรายการที่มี chatId');
    for (const c of body.chats) assert.ok(c.chatId, 'ห้ามมีแถวที่ chatId ว่าง');
  } finally {
    getMock.mock.restore();
  }
});

test('ข้อความยาวถูกตัดที่ 60 ตัวอักษร (ไม่ส่งข้อความทั้งก้อนขึ้น UI)', async () => {
  const long = 'ก'.repeat(200);
  const getMock = mock.method(axios, 'get', async () =>
    updatesResponse([{ update_id: 1, message: { message_id: 1, chat: { id: 5000000005 }, text: long } }])
  );

  try {
    const res = await getUpdates();
    const body = (await res.json()) as { chats: any[] };
    assert.strictEqual(body.chats[0].text.length, 60);
    assert.strictEqual(body.chats[0].type, 'unknown', 'type หาย → unknown (ไม่ปล่อย undefined)');
  } finally {
    getMock.mock.restore();
  }
});

test('คืนได้สูงสุด 10 แชท (กัน UI ยาวเป็นหน้ากระดาษ)', async () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    update_id: i + 1,
    message: { message_id: i + 1, chat: { id: 6000000000 + i, type: 'group' }, text: `m${i}` },
  }));
  const getMock = mock.method(axios, 'get', async () => updatesResponse(many));

  try {
    const res = await getUpdates();
    const body = (await res.json()) as { chats: any[] };
    assert.strictEqual(body.chats.length, 10);
    assert.strictEqual(body.chats[0].chatId, '6000000000');
  } finally {
    getMock.mock.restore();
  }
});

test('Telegram ตอบ 401 → ตอบ 500 พร้อมสาเหตุ ไม่ค้างและไม่ retry ยิงซ้ำ', async () => {
  const getMock = mock.method(axios, 'get', async () => {
    throw Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: { ok: false, description: 'Unauthorized' } },
    });
  });

  try {
    const res = await getUpdates();
    assert.strictEqual(res.status, 500);
    const body = (await res.json()) as { error?: string; chats?: unknown };
    assert.match(String(body.error), /401/, 'ต้องบอกผู้ใช้ว่า token ถูกปฏิเสธ');
    assert.strictEqual(body.chats, undefined, 'ห้ามคืนรายการว่างปนกับ error');
    assert.strictEqual(getMock.mock.callCount(), 1, 'ล้มแล้วต้องไม่ยิงซ้ำอัตโนมัติ');
  } finally {
    getMock.mock.restore();
  }
});

test('Telegram ตอบ 429 → คืน 429 พร้อมข้อความให้ลองใหม่ ไม่ใช่ 500 เหมือนบั๊กฝั่งเรา', async () => {
  const getMock = mock.method(axios, 'get', async () => {
    throw Object.assign(new Error('Request failed with status code 429'), {
      response: {
        status: 429,
        data: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 12' },
      },
    });
  });

  try {
    const res = await getUpdates();
    assert.strictEqual(res.status, 429, 'ต้องแยก 429 ของ Telegram ออกจาก 5xx ของเรา');
    const body = (await res.json()) as { error?: string; chats?: unknown };
    assert.match(String(body.error), /Too Many Requests/, 'ต้องส่งคำอธิบายจาก Telegram ต่อให้ผู้ใช้');
    assert.strictEqual(body.chats, undefined, 'ห้ามคืนรายการว่างปนกับ error');
    assert.strictEqual((body as { retryAfter?: number }).retryAfter, 12, 'ต้องส่งเวลารอให้ UI (จาก description)');
    assert.strictEqual(getMock.mock.callCount(), 1, 'rate limit = ห้ามยิงซ้ำอัตโนมัติ');
  } finally {
    getMock.mock.restore();
  }
});

test('result ที่ไม่ใช่ array (หรือไม่มี data) → คืนลิสต์ว่าง ไม่ throw 500', async () => {
  const cases: unknown[] = [
    { data: { ok: true, result: { message: { chat: { id: 1 } } } } }, // object เดี่ยว
    { data: { ok: true, result: 'oops' } },                          // string
    { data: { ok: true } },                                          // ไม่มี result
    { data: null },                                                  // response ว่าง
    {},                                                              // ไม่มี data เลย
  ];

  for (const payload of cases) {
    // แต่ละ payload = การกดครั้งใหม่ของผู้ใช้ → ต้องไม่ติด throttle ของเคสก่อนในลูป
    await __resetUpdatesThrottle();
    const getMock = mock.method(axios, 'get', async () => payload as any);
    try {
      const res = await getUpdates();
      assert.strictEqual(res.status, 200, `payload ${JSON.stringify(payload)} ต้องไม่ทำให้ route ล้ม`);
      const body = (await res.json()) as { chats: unknown[] };
      assert.deepStrictEqual(body.chats, [], 'รูปผลผิด → ถือว่าไม่มีแชท (ให้ผู้ใช้กดใหม่)');
    } finally {
      getMock.mock.restore();
    }
  }
});

test('กดดึง Chat ID รัว ๆ → ครั้งที่สองได้ 429 จากเรา พร้อมวินาทีที่ต้องรอ (ไม่ยิง Telegram ซ้ำ)', async () => {
  const getMock = mock.method(axios, 'get', async () =>
    updatesResponse([{ update_id: 1, message: { message_id: 1, chat: { id: 9000000009, type: 'group' }, text: 'hi' } }])
  );

  try {
    const first = await getUpdates();
    assert.strictEqual(first.status, 200, 'ครั้งแรกต้องผ่าน');

    const second = await getUpdates();
    assert.strictEqual(second.status, 429, 'ครั้งที่สองในทันทีต้องถูกกันที่ฝั่งเรา');
    const body = (await second.json()) as { error?: string; retryAfter?: number };
    assert.match(String(body.error), /ลองใหม่/, 'ต้องบอกผู้ใช้ให้ลองใหม่');
    assert.ok(Number(body.retryAfter) >= 1, 'ต้องบอกจำนวนวินาทีที่ต้องรอ');
    assert.strictEqual(getMock.mock.callCount(), 1, 'ถูกกันแล้วต้องไม่ออก request ไป Telegram');
  } finally {
    getMock.mock.restore();
  }
});

test('throttle ปล่อยผ่านอีกครั้งเมื่อพ้นช่วงขั้นต่ำ และแยกคีย์ต่อผู้ใช้', async () => {
  const t0 = 1_000_000;
  assert.deepStrictEqual(await takeUpdatesSlot('user-a', t0), { allowed: true, retryAfter: 0 });

  const blocked = await takeUpdatesSlot('user-a', t0 + 500);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);

  // ผู้ใช้อื่นไม่ควรโดนผลของคนแรก
  assert.deepStrictEqual(await takeUpdatesSlot('user-b', t0 + 500), { allowed: true, retryAfter: 0 });

  // พ้นช่วงขั้นต่ำแล้วกลับมาใช้ได้ (route ใช้ค่า default 3 วิ)
  assert.deepStrictEqual(await takeUpdatesSlot('user-a', t0 + 3000), { allowed: true, retryAfter: 0 });
});

// ── store ที่ใช้จริง (DB) — ต้องกันข้าม process ด้วยคำสั่งเดียว ──
// mock prisma.$queryRaw เพื่อดูลำดับคำสั่ง/ค่า retryAfter โดยไม่ต้องมี Postgres
test('store DB: จองสิทธิ์ด้วย INSERT … ON CONFLICT … RETURNING คำสั่งเดียว (atomic)', async () => {
  const t0 = 1_700_000_000_000;
  const raw = mock.method(prisma as any, '$queryRaw', async () => [{ last_hit_at: new Date(t0) }] as any);
  try {
    assert.deepStrictEqual(await prismaSlotStore.claim('user-a', t0, 3000), { allowed: true, retryAfter: 0 });
    assert.strictEqual(raw.mock.callCount(), 1, 'ทางที่ผ่านต้องจบในคำสั่งเดียว (ไม่มี read-modify-write ให้แข่งกัน)');
    const sql = String((raw.mock.calls[0].arguments as any[])[0].join('?'));
    assert.match(sql, /INSERT INTO telegram_updates_slot/);
    assert.match(sql, /ON CONFLICT \(user_key\) DO UPDATE/, 'ต้องใช้ ON CONFLICT เพื่อความ atomic ข้าม process');
    assert.match(sql, /WHERE telegram_updates_slot\.last_hit_at <=/, 'เงื่อนไขเวลาต้องอยู่ที่ WHERE ของ DO UPDATE');
    assert.match(sql, /RETURNING last_hit_at/);
    // คีย์ถูกส่งเป็น bind parameter ไม่ต่อสตริงเอง
    assert.ok((raw.mock.calls[0].arguments as any[]).includes('user-a'));
  } finally {
    raw.mock.restore();
  }
});

test('store DB: ถูกบล็อก → อ่านค่าเดิมแล้วคืนวินาทีที่ต้องรอ (ปัดขึ้น)', async () => {
  const t0 = 1_700_000_000_000;
  const hitAt = t0 - 2000; // ผ่านมา 2 วิ จากหน้าต่าง 3 วิ → เหลือ ~1 วิ
  let call = 0;
  const raw = mock.method(prisma as any, '$queryRaw', async () => {
    call += 1;
    return (call === 1 ? [] : [{ last_hit_at: new Date(hitAt) }]) as any;
  });
  try {
    assert.deepStrictEqual(await prismaSlotStore.claim('user-a', t0, 3000), { allowed: false, retryAfter: 1 });
    assert.strictEqual(call, 2, 'ทางที่ถูกบล็อกอ่านค่าเดิมหนึ่งครั้งเพื่อบอกเวลารอ');
  } finally {
    raw.mock.restore();
  }
});

test('ยังไม่มี bot token → 400 บอกให้ตั้ง token ก่อน (ไม่ยิง outbound เลย)', async () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  __resetTelegramCredentialCache(); // cache 5 วิของ service — ต้องล้างก่อนอ่าน env ใหม่
  const getMock = mock.method(axios, 'get', async () => {
    throw new Error('ต้องไม่ถูกเรียกเมื่อไม่มี token');
  });

  try {
    const res = await getUpdates();
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /Bot Token/);
    assert.strictEqual(getMock.mock.callCount(), 0);
  } finally {
    getMock.mock.restore();
    process.env.TELEGRAM_BOT_TOKEN = saved;
    __resetTelegramCredentialCache();
  }
});

test('ไม่ล็อกอิน → 401 (รายการแชทเป็นข้อมูลของเจ้าของเครื่อง)', async () => {
  const res = await getUpdates({});
  assert.strictEqual(res.status, 401);
});
