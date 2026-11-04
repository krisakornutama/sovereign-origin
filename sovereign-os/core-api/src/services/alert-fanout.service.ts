// src/services/alert-fanout.service.ts
//
// ── CE3: ช่องทางแจ้งเตือนภายนอก (Telegram + Discord + LINE) ─────────────────
// dispatcher เดิม (telegram-alert.service) รับผิดชอบ severity / dedup / rate-limit
// ไฟล์นี้ทำหน้าที่แค่ "แปลงข้อความเป็นรูปแบบของแต่ละช่อง" แล้วยิงขนานกันแบบ soft-fail
//
// ทำไมต้องแยก: เดิม defaultSender ส่ง Telegram อย่างเดียวและคืน boolean เดียว
// ⇒ เพิ่มช่องใหม่ไม่ได้โดยไม่แตะ logic การยับยั้งข้อความซ้ำ (ซึ่งมีเทสต์คุมอยู่)
import axios from 'axios';

export type AlertChannelName = 'telegram' | 'discord' | 'line';

export interface TelegramChannelTarget {
  botToken: string;
  chatId: string;
}
export interface DiscordChannelTarget {
  webhookUrl: string;
}
export interface LineChannelTarget {
  channelAccessToken: string;
  to: string;
}
export interface AlertTargets {
  telegram?: TelegramChannelTarget;
  discord?: DiscordChannelTarget;
  line?: LineChannelTarget;
}

export interface ChannelOutcome {
  channel: AlertChannelName;
  ok: boolean;
  reason: string;
}

/** ฉีดได้ในเทสต์ — ไม่ยิงเน็ตจริง */
export type PostFn = (
  url: string,
  body: unknown,
  cfg?: { headers?: Record<string, string> }
) => Promise<unknown>;

const DISCORD_MAX_CHARS = 2000; // จำกัดของ Discord (content)
const LINE_MAX_CHARS = 5000; // จำกัดของ LINE Messaging API (text)
const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * แปลง HTML ของ Telegram เป็นข้อความล้วน
 * Discord/LINE ไม่ตีความ HTML — ถ้าส่งดิบผู้ใช้จะเห็น `<b>` เปล่า ๆ
 * ลิงก์ต้องคง URL ไว้เพราะผู้รับไม่มีทางกดจาก tag ได้
 */
export function htmlToPlainText(html: string): string {
  const withLinks = html.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => `${label.replace(/<[^>]*>/g, '')} (${href})`
  );
  return decodeEntities(
    withLinks
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function isDiscordWebhookUrl(raw: string): boolean {
  const v = (raw ?? '').trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === 'https:' &&
      DISCORD_HOSTS.has(u.hostname.toLowerCase()) &&
      u.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

/** LINE user/group/room id = U|C|R + hex 32 ตัว */
export function isValidLineTo(raw: string): boolean {
  return /^[UCR][0-9a-f]{32}$/i.test((raw ?? '').trim());
}

export function buildDiscordPayload(html: string): {
  content: string;
  allowed_mentions: { parse: string[] };
} {
  return {
    content: truncate(htmlToPlainText(html), DISCORD_MAX_CHARS),
    // กัน @everyone/@here จากเนื้อหา alert — webhook ไม่ควร ping ทั้งเซิร์ฟเวอร์
    allowed_mentions: { parse: [] },
  };
}

export function buildLinePayload(
  to: string,
  html: string
): { to: string; messages: Array<{ type: 'text'; text: string }> } {
  return {
    to,
    messages: [{ type: 'text', text: truncate(htmlToPlainText(html), LINE_MAX_CHARS) }],
  };
}

/**
 * อ่านช่องทางที่ไม่ใช่ Telegram จาก env
 * (Telegram มาจาก getTelegramCredentials เพราะรองรับ override ใน DB/UI)
 * ค่าที่ผิดรูปแบบ = ข้ามช่องนั้น ไม่ทำให้ช่องอื่นหาย
 */
export function resolveExternalAlertTargets(
  env: Record<string, string | undefined> = process.env
): AlertTargets {
  const out: AlertTargets = {};
  const webhook = (env.DISCORD_WEBHOOK_URL || '').trim();
  if (isDiscordWebhookUrl(webhook)) out.discord = { webhookUrl: webhook };

  const token = (env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  const to = (env.LINE_TO || '').trim();
  if (token && isValidLineTo(to)) out.line = { channelAccessToken: token, to };

  return out;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const defaultPost: PostFn = (url, body, cfg) => axios.post(url, body, cfg);

async function sendTelegram(
  target: TelegramChannelTarget,
  html: string,
  post: PostFn
): Promise<ChannelOutcome> {
  try {
    await post(
      `https://api.telegram.org/bot${target.botToken}/sendMessage`,
      { chat_id: target.chatId, text: html, parse_mode: 'HTML' }
    );
    return { channel: 'telegram', ok: true, reason: 'sent' };
  } catch (err) {
    return { channel: 'telegram', ok: false, reason: errText(err) };
  }
}

async function sendDiscord(
  target: DiscordChannelTarget,
  html: string,
  post: PostFn
): Promise<ChannelOutcome> {
  try {
    await post(target.webhookUrl, buildDiscordPayload(html));
    return { channel: 'discord', ok: true, reason: 'sent' };
  } catch (err) {
    return { channel: 'discord', ok: false, reason: errText(err) };
  }
}

async function sendLine(
  target: LineChannelTarget,
  html: string,
  post: PostFn
): Promise<ChannelOutcome> {
  try {
    await post('https://api.line.me/v2/bot/message/push', buildLinePayload(target.to, html), {
      headers: {
        Authorization: `Bearer ${target.channelAccessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return { channel: 'line', ok: true, reason: 'sent' };
  } catch (err) {
    return { channel: 'line', ok: false, reason: errText(err) };
  }
}

/**
 * ยิงทุกช่องที่ตั้งไว้พร้อมกัน
 * @returns ok = อย่างน้อยหนึ่งช่องสำเร็จ · outcomes = ผลแยกช่อง (ไม่ throw แม้ทุกช่องล้ม)
 */
export async function fanoutAlert(
  html: string,
  targets: AlertTargets,
  post: PostFn = defaultPost
): Promise<{ ok: boolean; outcomes: ChannelOutcome[] }> {
  const jobs: Array<Promise<ChannelOutcome>> = [];
  if (targets.telegram) jobs.push(sendTelegram(targets.telegram, html, post));
  if (targets.discord) jobs.push(sendDiscord(targets.discord, html, post));
  if (targets.line) jobs.push(sendLine(targets.line, html, post));

  const outcomes = await Promise.all(jobs);
  return { ok: outcomes.some((o) => o.ok), outcomes };
}
