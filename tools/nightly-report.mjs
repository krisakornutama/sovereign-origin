#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// nightly-report.mjs — สรุปผล nightly verify:full ส่งเข้า Telegram (Phase 3)
// ใช้: node tools/nightly-report.mjs <statusJsonPath>
// อ่าน credentials จาก Postgres system_settings (telegram.botToken/chatId) เหมือน backend
// soft-fail ทั้งหมด: ไม่มี creds / Telegram ล่ม = exit 0 (ไม่ทำให้ nightly fail)
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const statusPath = process.argv[2];
if (!statusPath || !existsSync(statusPath)) {
  console.error('usage: node tools/nightly-report.mjs <status.json>');
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
const failedLine = failed.length
  ? `\nพัง ${failed.length} ขั้น: ${failed.map((x) => x.name).join(', ')}`
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
  (s.gsc ? `\n🔎 GSC coverage: ${s.gsc.ok ? '✓' : '⚠️'} ${s.gsc.last ?? ''}` : '') +
  (s.restore ? `\n💾 Backup กู้คืน: ${s.restore.ok ? '✓' : '🚨'} ${s.restore.last ?? ''}` : '') +
  // Phase 4: สุขภาพเครื่อง — ปัญหาที่ตรวจก่อนรัน (รู้ก่อนว่า verify อาจพังเพราะสภาพแวดล้อม)
  (Array.isArray(s.machine?.problems) && s.machine.problems.length
    ? '\n' + s.machine.problems.map((p) => `${p.level === 'critical' ? '🚨' : '⚠️'} ${p.message}`).join('\n')
    : '');

// ── ส่ง Telegram (credentials จาก DB — soft-fail) ──
function dbCreds() {
  try {
    const out = execSync(
      `docker exec sovereign-db psql -U sovereign -d sovereign -t -A -c "SELECT value FROM system_settings WHERE key='telegram.botToken'; SELECT value FROM system_settings WHERE key='telegram.chatId';"`,
      { encoding: 'utf8', timeout: 20_000 }
    ).split('\n').map((l) => l.trim()).filter(Boolean);
    return { token: out[0] ?? '', chatId: out[1] ?? '' };
  } catch {
    return { token: '', chatId: '' };
  }
}

async function main() {
  const { token, chatId } = dbCreds();
  if (!token || !chatId) {
    console.log('ไม่มี Telegram credentials ใน DB — ข้ามการส่ง (soft-fail)');
    process.exit(0);
  }
  if (process.argv.includes('--dry')) {
    console.log('[dry] จะส่งข้อความ:\n' + text);
    process.exit(0);
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    console.log(res.ok ? 'ส่งสรุป nightly เข้า Telegram แล้ว' : `Telegram ตอบ ${res.status} — ข้าม (soft-fail)`);
  } catch (err) {
    console.log('ส่งไม่สำเร็จ (soft-fail):', err instanceof Error ? err.message : err);
  }
  process.exit(0);
}
main();
