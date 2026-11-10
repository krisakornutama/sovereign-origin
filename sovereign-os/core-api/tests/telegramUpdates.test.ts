import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { prisma } from '../src/lib/prisma';
import telegramRoutes from '../src/modules/telegram/telegram.routes';
import { __resetTelegramCredentialCache } from '../src/services/telegram-credentials.service';
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
