#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// nightly-report.mjs — สรุปผล nightly verify ส่งเข้า Telegram (Phase 3)
// ใช้: node tools/nightly-report.mjs <statusJsonPath> [--dry]
// creds: tools/verify/telegram-creds.mjs (เจ้าของเดียว — DB → infra/.env)
//   เดิมอ่าน DB อย่างเดียว ⇒ DB มีแค่ telegram.bizChatId ทำให้ทุกคืน "ข้ามการส่ง" เงียบ ๆ
// soft-fail ทั้งหมด: ไม่มี creds / Telegram ล่ม = exit 0 (ไม่ทำให้ nightly fail)
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { notify, readTelegramCreds } from './verify/telegram-creds.mjs';

const REPO = join(path.dirname(fileURLToPath(import.meta.url)), '..');

const statusPath = process.argv[2];
if (!statusPath || statusPath.startsWith('--') || !existsSync(statusPath)) {
  console.error('usage: node tools/nightly-report.mjs <status.json> [--dry]');
  process.exit(0);
}

let s = {};
try { s = JSON.parse(readFileSync(statusPath, 'utf8')); } catch { process.exit(0); }

const ok = s.ok === true;
const skipped = Array.isArray(s.skipped) ? s.skipped : [];
// "ผ่าน" ที่มีขั้นข้าม = ผ่านไม่ครบ → ห้ามใช้เครื่องหมาย ✅ เด็ดขาด (สั่งเจ้าของ 2/10/69)
const icon = !ok ? '🚨' : skipped.length ? '⚠️' : '✅';
const headline = !ok ? 'ไม่ผ่าน' : skipped.length ? 'ผ่าน (มีขั้นข้าม)' : 'ผ่าน';
const dur = s.durationMin != null ? ` (${s.durationMin} นาที)` : '';
const failed = (s.steps ?? []).filter((x) => x.ok === false);
const failedExtras = Array.isArray(s.failedExtras) ? s.failedExtras : [];
const failedNames = [...failed.map((x) => x.name), ...failedExtras];
const failedLine = failedNames.length
  ? `\nพัง ${failedNames.length} ขั้น: ${failedNames.join(', ')}`
  : '';
const skippedLine = skipped.length
  ? `\n<b>ข้าม ${skipped.length} รายการ</b> (ไม่ได้ตรวจจริง):\n` +
    skipped.slice(0, 6).map((x) => `• ${x.name} — ${x.why}`).join('\n') + '\n'
  : '';
const backendLine = s.backend && s.backend.up === false
  ? '\n🚨 backend :3001 ขึ้นไม่ได้ — e2e ไม่ได้รันคืนนี้'
  : '';
// gate: บอกตรง ๆ ว่าผลรอบนี้เชื่อได้ไหม (ไฟล์ system-truth.json เป็นของรอบเก่า = ไม่รู้ผลขั้นตอน)
const gate = s.gateStepsFresh === false
  ? 'ไม่ทราบ (gate ล้มก่อนเขียนผล — ดู logs/nightly/last-run.log)'
  : s.lastGateOk === true ? 'ผ่าน' : s.lastGateOk === false ? 'พัง' : 'ไม่มีข้อมูล';
const code = s.codeMatch === true ? 'ตรง' : s.codeMatch === false ? '⚠️ ไม่ตรง (prod รันโค้ดเก่า!)' : 'ไม่มีข้อมูล';

const text =
  `${icon} <b>Nightly Verify ${headline}</b>${dur}\n` +
  `เกตล่าสุด: ${gate} · fingerprint: ${code}\n` +
  backendLine +
  skippedLine +
  `migration head: <code>${s.migrationHead ?? '—'}</code>${failedLine}` +
  // P22 (2/10/69): ผล IndexNow ต่อบอท Bing/Yandex — ล้มไม่ทำให้ nightly พัง แต่ต้องเห็นทุกคืน
  (s.indexnow ? `\n🔎 IndexNow: ${s.indexnow.ok ? '✓' : '⚠️'} ${s.indexnow.last ?? ''}` : '') +
  (s.seo ? `\n🔎 SEO pre-flight: ${s.seo.ok ? '✓' : '⚠️'} ${s.seo.last ?? ''}` : '') +
  (s.gsc ? `\n🔎 GSC coverage: ${s.gsc.skipped ? '⏭' : s.gsc.ok ? '✓' : '⚠️'} ${s.gsc.last ?? ''}` : '') +
  (s.restore ? `\n💾 Backup กู้คืน: ${s.restore.skipped ? '⏭' : s.restore.ok ? '✓' : '🚨'} ${s.restore.last ?? ''}` : '') +
  // ความยินยอม/PDPA: อ่านเท่านั้น (ไม่สร้างบัญชี) — ล้ม = เส้นข้อมูลส่วนบุคคลมีปัญหา ต้องเห็นทุกคืน
  (s.consentSmoke ? `\n🧾 Consent smoke: ${s.consentSmoke.skipped ? '⏭' : s.consentSmoke.ok ? '✓' : '🚨'} ${s.consentSmoke.last ?? ''}` : '') +
  // J3b: ประวัติ nightly ขาดวันไหน = กราฟแนวโน้มมีรู ต้องรู้ก่อนเชื่อ "ผ่านติดกัน N วัน"
  (Array.isArray(s.historyGaps) && s.historyGaps.length
    ? `\n🗓 ประวัติ nightly ขาด ${s.historyGaps.length} วัน: ${s.historyGaps.slice(0, 7).join(', ')}${s.historyGaps.length > 7 ? ' …' : ''}`
    : '') +
  // Phase 4: สุขภาพเครื่อง — ปัญหาที่ตรวจก่อนรัน (รู้ก่อนว่า verify อาจพังเพราะสภาพแวดล้อม)
  (Array.isArray(s.machine?.problems) && s.machine.problems.length
    ? '\n' + s.machine.problems.map((p) => `${p.level === 'critical' ? '🚨' : '⚠️'} ${p.message}`).join('\n')
    : '');

async function main() {
  const dry = process.argv.includes('--dry');
  const creds = readTelegramCreds();
  const hasCreds = Boolean(creds.token && creds.chatId);

  // dry = ต้องเห็นข้อความเสมอ แม้ creds จะหาย — ใช้ทดสอบระบบโดยไม่กวนเจ้าของตอนตี 2
  if (dry) {
    console.log(`[dry] creds: ${hasCreds ? creds.source : 'ไม่พบ (DB/infra/.env)'} — จะส่งข้อความ:\n${text}`);
    process.exitCode = 0;
    return;
  }
  if (!hasCreds) {
    console.log('ไม่มี Telegram credentials (DB หรือ sovereign-os/infra/.env) — ข้ามการส่ง (soft-fail)');
    process.exitCode = 0;
    return;
  }
  const r = await notify(text, creds, { parseMode: 'HTML' });
  if (r.ok) console.log(`ส่งสรุป nightly เข้า Telegram แล้ว (creds: ${creds.source})`);
  else console.log(`ส่งไม่สำเร็จ (soft-fail): ${r.error}`);
  process.exitCode = 0;
}

main().catch((err) => {
  // รายงานล้มต้องไม่ทำให้ nightly ล้ม — แค่จบเงียบพร้อม log
  console.log('nightly-report error (soft-fail):', err instanceof Error ? err.message : err);
  process.exitCode = 0;
});
