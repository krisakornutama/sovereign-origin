// scripts/alert-fanout-live.ts — ยิงเตือนจริงครบ 3 ช่อง (Telegram + Discord + LINE)
//
// ใช้เมื่อมี credential จริงใน .env แล้วเท่านั้น (ค่าว่าง = ข้ามช่องนั้น)
//   cd sovereign-os/core-api && npx tsx scripts/alert-fanout-live.ts
//
// ออกแบบให้ปลอดภัย: ไม่พิมพ์ token, ไม่ยิงถ้าไม่ได้ตั้งค่าช่องใดเลย,
// ถ้าช่องที่ตั้งไว้ล้ม → exit 1 พร้อมบอกว่าช่องไหน (soft-fail ภายในไม่ throw)
import dotenv from 'dotenv';
import path from 'node:path';
import { fanoutAlert, resolveExternalAlertTargets, type AlertTargets } from '../src/services/alert-fanout.service';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const html =
  '<b>🌡️ ทดสอบการแจ้งเตือน Sovereign OS</b>\n' +
  'อุณหภูมิ 45.2°C เกินเกณฑ์ 40°C (ข้อความทดสอบ — ไม่ใช่เหตุจริง)\n' +
  `<a href="${process.env.PUBLIC_APP_URL || 'http://localhost:3000'}/alerts/">เปิดหน้าแจ้งเตือน</a>`;

function telegramTargets(): AlertTargets {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  return botToken && chatId ? { telegram: { botToken, chatId } } : {};
}

async function main() {
  const targets: AlertTargets = { ...telegramTargets(), ...resolveExternalAlertTargets(process.env) };
  const channels = Object.keys(targets);
  if (channels.length === 0) {
    console.log('ยังไม่ได้ตั้งค่าช่องใดเลย — ตั้ง TELEGRAM_BOT_TOKEN/CHAT_ID, DISCORD_WEBHOOK_URL หรือ LINE_CHANNEL_ACCESS_TOKEN/LINE_TO ใน .env ก่อน');
    process.exit(0);
  }
  console.log(`ยิงทดสอบไปยัง: ${channels.join(', ')}`);
  const { ok, outcomes } = await fanoutAlert(html, targets);
  for (const o of outcomes) console.log(`- ${o.channel}: ${o.ok ? 'OK' : 'FAIL'} (${o.reason})`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('fanout live ล้ม:', err instanceof Error ? err.message : err);
  process.exit(1);
});
