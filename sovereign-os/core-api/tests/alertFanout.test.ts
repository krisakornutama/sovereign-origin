// tests/alertFanout.test.ts
//
// ── CE3: ยิงแจ้งเตือนหลายช่องทาง (Telegram + Discord + LINE) ─────────────────
// dispatcher เดิมมี severity/dedup/rate-limit อยู่แล้ว — ไฟล์นี้แค่แปลงข้อความ
// และยิงออกหลายช่องพร้อมกันแบบ soft-fail (ช่องหนึ่งล้มต้องไม่ทำให้ช่องอื่นล้ม)
//
// กติกาที่ล็อกไว้:
//   · Discord/LINE ไม่รับ HTML → ต้องแปลงเป็นข้อความล้วน และคงลิงก์ให้อ่านออก
//   · Discord webhook ต้องเป็น https + โฮสต์ของ Discord + path /api/webhooks/ เท่านั้น
//   · กัน mention spam: allowed_mentions.parse = [] (@everyone ในข้อความไม่ทำงาน)
//   · Discord จำกัด 2000 ตัวอักษร, LINE 5000 → ตัดให้พอดีก่อนส่ง
//   · อย่างน้อยหนึ่งช่องสำเร็จ = ok (ไม่ throw แม้บางช่องล้ม)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordPayload,
  buildLinePayload,
  fanoutAlert,
  htmlToPlainText,
  isDiscordWebhookUrl,
  isValidLineTo,
  resolveExternalAlertTargets,
  type PostFn,
} from '../src/services/alert-fanout.service';

describe('htmlToPlainText', () => {
  it('ถอดแท็ก HTML และคงลิงก์ให้อ่านได้', () => {
    const html = '<b>🚨 CRITICAL</b>\nBattery at <b>5%</b>\n\n<a href="http://box.local/dashboard">🖥️ Dashboard</a>';
    const text = htmlToPlainText(html);
    assert.equal(text.includes('<b>'), false);
    assert.match(text, /CRITICAL/);
    assert.match(text, /Battery at 5%/);
    assert.match(text, /Dashboard \(http:\/\/box\.local\/dashboard\)/);
  });

  it('แปลง <br> เป็นขึ้นบรรทัดใหม่ และถอด entity', () => {
    const text = htmlToPlainText('A &amp; B<br>C &lt; D');
    assert.equal(text, 'A & B\nC < D');
  });

  it('ยุบช่องว่างซ้ำโดยไม่ทำลายย่อหน้า', () => {
    const text = htmlToPlainText('<p>one</p><p>two</p>\n\n\n\n<p>three</p>');
    assert.equal(text, 'one\ntwo\n\nthree');
  });
});

describe('Discord', () => {
  it('รับเฉพาะ webhook https ของ Discord', () => {
    assert.equal(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc'), true);
    assert.equal(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/123/abc'), true);
    assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc'), false, 'ต้องเป็น https');
    assert.equal(isDiscordWebhookUrl('https://evil.example/api/webhooks/123/abc'), false, 'โฮสต์ต้องเป็นของ Discord');
    assert.equal(isDiscordWebhookUrl('https://discord.com/api/v9/channels'), false, 'path ต้องเป็น webhook');
    assert.equal(isDiscordWebhookUrl(''), false);
  });

  it('ตัดข้อความที่ยาวเกิน 2000 ตัวอักษร และปิด mention', () => {
    const payload = buildDiscordPayload('<b>x</b>'.repeat(1000));
    assert.ok(payload.content.length <= 2000, `ยาว ${payload.content.length}`);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.content.includes('<b>'), false);
  });
});

describe('LINE', () => {
  it('ตรวจรหัสผู้รับ (U/C/R + hex 32)', () => {
    assert.equal(isValidLineTo('U' + 'a'.repeat(32)), true);
    assert.equal(isValidLineTo('C' + '0'.repeat(32)), true);
    assert.equal(isValidLineTo('R' + 'f'.repeat(32)), true);
    assert.equal(isValidLineTo('X' + 'a'.repeat(32)), false);
    assert.equal(isValidLineTo('U123'), false);
    assert.equal(isValidLineTo(''), false);
  });

  it('สร้าง payload แบบข้อความ (LINE ไม่รับ HTML) และตัดที่ 5000', () => {
    const payload = buildLinePayload('U' + 'a'.repeat(32), '<b>สวัสดี</b>' + 'y'.repeat(6000));
    assert.equal(payload.to, 'U' + 'a'.repeat(32));
    assert.equal(payload.messages[0].type, 'text');
    assert.ok(payload.messages[0].text.length <= 5000, `ยาว ${payload.messages[0].text.length}`);
    assert.equal(payload.messages[0].text.includes('<b>'), false);
  });
});

describe('resolveExternalAlertTargets', () => {
  it('อ่าน env และข้ามค่าที่ว่าง/ผิดรูปแบบ', () => {
    const t = resolveExternalAlertTargets({
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/tok',
      LINE_CHANNEL_ACCESS_TOKEN: 'token-123',
      LINE_TO: 'U' + 'b'.repeat(32),
    });
    assert.equal(t.discord?.webhookUrl, 'https://discord.com/api/webhooks/1/tok');
    assert.equal(t.line?.channelAccessToken, 'token-123');
    assert.equal(t.line?.to, 'U' + 'b'.repeat(32));
  });

  it('Discord URL ผิดรูปแบบ = ไม่ตั้งช่องนั้น (ไม่ทำให้ช่องอื่นหาย)', () => {
    const t = resolveExternalAlertTargets({
      DISCORD_WEBHOOK_URL: 'http://evil.example/hook',
      LINE_CHANNEL_ACCESS_TOKEN: 'tok',
      LINE_TO: 'U' + 'c'.repeat(32),
    });
    assert.equal(t.discord, undefined);
    assert.ok(t.line, 'LINE ต้องยังอยู่');
  });

  it('LINE ต้องมีทั้ง token และผู้รับ', () => {
    const t = resolveExternalAlertTargets({ LINE_CHANNEL_ACCESS_TOKEN: 'tok' });
    assert.equal(t.line, undefined);
    assert.deepEqual(t, {});
  });
});

describe('fanoutAlert', () => {
  it('ยิงครบทุกช่องด้วย payload ที่ถูกต้อง และ ok เมื่ออย่างน้อยหนึ่งช่องสำเร็จ', async () => {
    const calls: Array<{ url: string; body: any; headers: any }> = [];
    const post: PostFn = async (url, body, cfg) => {
      calls.push({ url, body, headers: cfg?.headers });
      return { ok: true };
    };
    const res = await fanoutAlert('<b>hello</b>', {
      telegram: { botToken: 'BOT', chatId: '42' },
      discord: { webhookUrl: 'https://discord.com/api/webhooks/1/tok' },
      line: { channelAccessToken: 'LT', to: 'U' + 'd'.repeat(32) },
    }, post);

    assert.equal(res.ok, true);
    assert.equal(calls.length, 3);
    const tg = calls.find((c) => c.url.includes('api.telegram.org'));
    assert.match(tg!.url, /botBOT\/sendMessage/);
    assert.equal(tg!.body.parse_mode, 'HTML');
    const dc = calls.find((c) => c.url.includes('discord.com'));
    assert.deepEqual(dc!.body.allowed_mentions, { parse: [] });
    const ln = calls.find((c) => c.url.includes('api.line.me'));
    assert.equal(ln!.headers.Authorization, 'Bearer LT');
  });

  it('ช่องหนึ่งล้ม ไม่ทำให้ช่องอื่นล้ม และรายงานเหตุผลแยกช่อง', async () => {
    const post: PostFn = async (url) => {
      if (url.includes('discord.com')) throw new Error('discord 500');
      return {};
    };
    const res = await fanoutAlert('x', {
      telegram: { botToken: 'B', chatId: '1' },
      discord: { webhookUrl: 'https://discord.com/api/webhooks/1/t' },
    }, post);
    assert.equal(res.ok, true, 'Telegram สำเร็จ = ok');
    const dc = res.outcomes.find((o) => o.channel === 'discord');
    assert.equal(dc!.ok, false);
    assert.match(dc!.reason, /discord 500/);
  });

  it('ทุกช่องล้ม = ok=false และไม่ throw', async () => {
    const post: PostFn = async () => { throw new Error('network down'); };
    const res = await fanoutAlert('x', { line: { channelAccessToken: 'L', to: 'U' + 'e'.repeat(32) } }, post);
    assert.equal(res.ok, false);
    assert.equal(res.outcomes.length, 1);
    assert.equal(res.outcomes[0].channel, 'line');
  });

  it('ไม่มีช่องทางเลย = ok=false ไม่เรียก network', async () => {
    let called = 0;
    const res = await fanoutAlert('x', {}, async () => { called++; return {}; });
    assert.equal(res.ok, false);
    assert.equal(called, 0);
    assert.deepEqual(res.outcomes, []);
  });
});
