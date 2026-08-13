import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { reportService, prisma } from '../src/services/report.service';
import { prisma as chartPrisma } from '../src/services/chart-snapshot.service';
import { mockModel } from './helpers';

before(() => {
  // ── data layer (report service) ──
  mock.method(prisma, '$queryRawUnsafe', async (query: string) => {
    if (query.includes('DISTINCT ON')) return [{ metric: 'temperature', value: 30 }];
    if (query.includes('GROUP BY metric'))
      return [{ metric: 'temperature', min_value: 20, avg_value: 25, max_value: 30 }];
    if (query.includes('COUNT(*) AS total')) return [{ total: 2, online: 1 }];
    return [];
  });
  mockModel(prisma, 'automationAlert', { count: async () => 3 });
  mockModel(prisma, 'securityEvent', { count: async () => 1 });
  mockModel(prisma, 'dailyReport', {
    create: async (args: any) => ({
      id: 'report-test-1',
      ...args.data,
      created_at: new Date(),
    }),
  });

  // ── data layer (chart snapshot) — ให้ทุก metric มีข้อมูล ──
  mock.method(chartPrisma, '$queryRawUnsafe', async (query: string) => {
    if (!query.includes('time_bucket')) return [];
    const now = Date.now();
    const metrics = ['temperature', 'humidity', 'battery_soc', 'power_kw', 'water_level_cm', 'rainfall'];
    const rows: any[] = [];
    for (const m of metrics) {
      for (let i = 0; i < 10; i++) {
        rows.push({ metric: m, bucket: new Date(now - (9 - i) * 600000).toISOString(), avg_value: 20 + i });
      }
    }
    return rows;
  });
});

after(() => {
  mock.restoreAll();
});

/** axios mock — Ollama (AI) vs Telegram แยกตาม URL */
function mockAxios(aiWorks = true) {
  return mock.method(axios, 'post', async (url: string) => {
    if (String(url).includes('/api/generate')) {
      if (!aiWorks) throw new Error('ollama offline');
      return { data: { response: 'สรุปภาพรวม: อุณหภูมิปกติตลอดช่วง' } };
    }
    return { data: { ok: true } };
  });
}

function splitCalls(postMock: ReturnType<typeof mock.method>) {
  const all = postMock.mock.calls.map((c) => c.arguments as [string, any]);
  return {
    generate: all.filter(([u]) => String(u).includes('/api/generate')),
    sendMessage: all.filter(([u]) => String(u).endsWith('/sendMessage')),
    sendPhoto: all.filter(([u]) => String(u).endsWith('/sendPhoto')),
  };
}

test('daily report sends Telegram message + one combined multi-metric chart photo', async () => {
  const postMock = mockAxios();
  const report = await reportService.generateNow('daily');

  assert.strictEqual(report.type, 'daily');
  assert.strictEqual(report.id, 'report-test-1');

  const { generate, sendMessage, sendPhoto } = splitCalls(postMock);
  assert.strictEqual(generate.length, 1, 'เรียก Ollama สรุป 1 ครั้ง');
  assert.strictEqual(sendMessage.length, 1, 'ส่งข้อความ Telegram 1 ครั้ง');
  assert.ok(String(sendMessage[0][1].text).includes('🌅 รายงานสรุปประจำวัน'));
  // multi-series: รวมทุก metric ลงภาพเดียว → 1 รูป
  assert.strictEqual(sendPhoto.length, 1, 'ส่งกราฟรวม 1 รูป');

  const caption = (sendPhoto[0][1] as FormData).get('caption');
  assert.match(String(caption), /แนวโน้ม 6 metric/);
  assert.match(String(caption), /ย้อนหลัง 24 ชม\./);
});

test('weekly report uses weekly period text in photo caption', async () => {
  const postMock = mockAxios();
  await reportService.generateNow('weekly');

  const { sendMessage, sendPhoto } = splitCalls(postMock);
  assert.ok(String(sendMessage[0][1].text).includes('📅 รายงานสรุปประจำสัปดาห์'));
  const caption = (sendPhoto[0][1] as FormData).get('caption');
  assert.match(String(caption), /ย้อนหลัง 7 วัน/);
});

test('skips chart photos for metrics without data, but still sends message', async () => {
  // ให้ทุก time_bucket query คืนค่าว่าง → ไม่มี metric ไหนวาดกราฟได้
  mock.method(chartPrisma, '$queryRawUnsafe', async () => []);
  const postMock = mockAxios();

  await reportService.generateNow('daily');

  const { sendMessage, sendPhoto } = splitCalls(postMock);
  assert.strictEqual(sendMessage.length, 1);
  assert.strictEqual(sendPhoto.length, 0, 'ไม่มีข้อมูล → ไม่ส่งรูป');
});

test('falls back to text summary when Ollama is offline (report still generated + sent)', async () => {
  const postMock = mockAxios(false); // Ollama offline
  const report = await reportService.generateNow('daily');

  assert.ok(report.summary.includes('ออนไลน์ 1/2'), 'summary เป็น fallback ที่มีข้อมูลสถิติ');

  const { generate, sendMessage } = splitCalls(postMock);
  assert.strictEqual(generate.length, 1, 'พยายามเรียก Ollama แต่ล้มเหลว');
  assert.strictEqual(sendMessage.length, 1, 'ยังส่งข้อความ Telegram ตามปกติ');
});
