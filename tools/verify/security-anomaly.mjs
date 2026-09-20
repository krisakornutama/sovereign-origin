#!/usr/bin/env node
// tools/verify/security-anomaly.mjs — สรุปความผิดปกติจาก audit_logs (24 ชม.) ส่ง Telegram
//   node tools/verify/security-anomaly.mjs            → เงียบถ้าไม่มี findings · พบ = ส่ง Telegram
//   node tools/verify/security-anomaly.mjs --digest   → ส่งสรุปเสมอ (แม้ว่าง) — ทดสอบช่องทาง/ยืนยันชีวิต
// ตรวจ 6 กลุ่ม: brute-force (RATE_LIMIT_BLOCK) · MFA burst · กิจกรรมนอกเวลา (00:00–05:30 ไทย)
//             · เหตุการณ์บัญชีอ่อนไหว · user แตะโมดูลใหม่ที่ไม่เคยแตะ 30 วัน · spike ต่อ route
// ตัด noise ของ tooling เอง: actor mock-admin / pentest-% / trust-% / gate-% และ automation/check, system/wan/check
import { execFileSync } from 'node:child_process';
import { notify } from './telegram-creds.mjs';

const DB = 'sovereign';
// execFileSync แบบ args array — ห้ามผ่าน shell: cmd.exe ตี '|' ใน -F '|' เป็น pipe (พิสูจน์แล้ว)
const psqlRows = (sql) => execFileSync('docker',
  ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'],
  { input: sql, encoding: 'utf8', timeout: 30_000, windowsHide: true }
).split(/\r?\n/).filter(Boolean);
// ระบบยังไม่ audit login ปกติ (มีแต่ RATE_LIMIT_BLOCK) — ค้น payload ด้วย ->> ; timestamp เป็น timestamptz
const ACTOR_EXCL = `COALESCE(u.username,'') NOT IN ('mock-admin') AND COALESCE(u.username,'') NOT LIKE 'pentest-%'
  AND COALESCE(u.username,'') NOT LIKE 'trust-%' AND COALESCE(u.username,'') NOT LIKE 'gate-%' AND COALESCE(u.username,'') NOT LIKE 'ui-%'`;
const NOISE = `a.action_type NOT LIKE '%/api/automation%' AND a.action_type NOT LIKE '%/api/system/wan%'`;

const findings = [];
const add = (severity, title, lines) => { if (lines.length) findings.push({ severity, title, lines }); };

// 1) brute-force: RATE_LIMIT_BLOCK จับกลุ่มตาม username+ip (payload มี ip ตอนโดนบล็อก)
const bf = psqlRows(`SELECT payload->>'username', payload->>'ip', count(*) FROM audit_logs
  WHERE action_type='RATE_LIMIT_BLOCK' AND "timestamp" > now() - interval '24 hours'
  GROUP BY 1,2 HAVING count(*) >= 3 ORDER BY 3 DESC LIMIT 10;`);
add('🚨', 'Brute-force ถูกบล็อกโดย rate limit', bf.map(r => { const [u, ip, c] = r.split('|'); return `  - ${u || '(ไม่ระบุบัญชี)'} @ ${ip || '?'} × ${c} ครั้ง`; }));

// 2) MFA burst: ลองรหัส MFA รัว ๆ ต่อบัญชี
const mfa = psqlRows(`SELECT COALESCE(u.username,'(ผู้ใช้ถูกลบ)'), count(*) FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
  WHERE a.action_type='POST /api/auth/verify-mfa' AND a."timestamp" > now() - interval '24 hours' AND ${ACTOR_EXCL}
  GROUP BY 1 HAVING count(*) >= 15 ORDER BY 2 DESC LIMIT 10;`);
add('🚨', 'MFA ถูกลองรัว ๆ (>= 15 ครั้ง/บัญชี/วัน)', mfa.map(r => { const [u, c] = r.split('|'); return `  - ${u} × ${c}`; }));

// 3) กิจกรรมนอกเวลา 00:00–05:30 เวลาไทย (ตัด noise ระบบอัตโนมัติ)
const off = psqlRows(`SELECT COALESCE(u.username,'(ผู้ใช้ถูกลบ)'), count(*), min(to_char(a."timestamp" AT TIME ZONE 'Asia/Bangkok','HH24:MI')), max(to_char(a."timestamp" AT TIME ZONE 'Asia/Bangkok','HH24:MI'))
  FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
  WHERE a."timestamp" > now() - interval '24 hours' AND ${NOISE} AND ${ACTOR_EXCL}
    AND EXTRACT(HOUR FROM a."timestamp" AT TIME ZONE 'Asia/Bangkok') + EXTRACT(MINUTE FROM a."timestamp" AT TIME ZONE 'Asia/Bangkok')/60.0 < 5.5
  GROUP BY 1 HAVING count(*) >= 3 ORDER BY 2 DESC LIMIT 10;`);
add('⚠️', 'กิจกรรมนอกเวลา (00:00–05:30)', off.map(r => { const [u, c, lo, hi] = r.split('|'); return `  - ${u} × ${c} (${lo}–${hi})`; }));

// 4) เหตุการณ์บัญชีอ่อนไหว (รีเซ็ตรหัส/สร้าง/ลบ user) — ตัดของ tooling ออก
const acct = psqlRows(`SELECT to_char(a."timestamp" AT TIME ZONE 'Asia/Bangkok','DD/MM HH24:MI'), a.action_type, COALESCE(u.username,'(ลบแล้ว)')
  FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
  WHERE a."timestamp" > now() - interval '24 hours'
    AND (a.action_type IN ('USER_PASSWORD_RESET_BY_ADMIN','POST /api/auth/change-password','POST /api/users') OR a.action_type LIKE 'DELETE /api/users/%')
    AND ${ACTOR_EXCL} AND a.user_id IS NOT NULL ORDER BY a."timestamp" DESC LIMIT 15;`);
add('ℹ️', 'เหตุการณ์บัญชี (รีเซ็ต/สร้าง/ลบ)', acct.map(r => `  - ${r.replace('|', ' · ').replace('|', ' · ')}`));

// 5) user แตะโมดูลที่ไม่เคยแตะมา 30 วันก่อนหน้า (first-seen)
const firstSeen = psqlRows(`WITH base AS (
    SELECT a.user_id, COALESCE(u.username,'(ลบแล้ว)') AS uname,
      split_part(substring(a.action_type from position('/api/' in a.action_type)+5), '/', 1) AS module
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    WHERE a."timestamp" > now() - interval '24 hours' AND position('/api/' in a.action_type) > 0 AND ${NOISE}
  )
  SELECT b.uname, b.module, count(*) FROM base b
  WHERE b.module <> '' AND b.module NOT IN ('auth') AND b.uname <> '(ลบแล้ว)' AND b.uname <> 'mock-admin'
    AND b.uname NOT LIKE 'pentest-%' AND b.uname NOT LIKE 'trust-%'
    AND NOT EXISTS (
      SELECT 1 FROM audit_logs a2 WHERE a2.user_id = b.user_id
        AND a2."timestamp" BETWEEN now() - interval '30 days' AND now() - interval '24 hours'
        AND a2.action_type LIKE '%/api/' || b.module || '/%')
  GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8;`);
add('⚠️', 'แตะโมดูลที่ไม่เคยแตะมาก่อน (30 วัน)', firstSeen.map(r => { const [u, m, c] = r.split('|'); return `  - ${u} → /api/${m} × ${c}`; }));

// 6) spike ต่อ route: วันนี้ > 3× ค่าเฉลี่ย 7 วันก่อนหน้า และ > 200 ครั้ง
const spike = psqlRows(`WITH d AS (
    SELECT date_trunc('day', "timestamp" AT TIME ZONE 'Asia/Bangkok') AS day, action_type, count(*) AS c
    FROM audit_logs a WHERE a."timestamp" > now() - interval '8 days' AND ${NOISE} GROUP BY 1, 2)
  SELECT action_type, max(c) FILTER (WHERE day = date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')),
    round(avg(c) FILTER (WHERE day < date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')), 1)
  FROM d GROUP BY action_type
  -- ต้องมีประวัติ >= 3 วันก่อนหน้า (baseline เย็นตัดสินไม่ได้)
  HAVING count(DISTINCT day) FILTER (WHERE day < date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')) >= 3
     AND max(c) FILTER (WHERE day = date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')) > 200
     AND max(c) FILTER (WHERE day = date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')) > 3 * COALESCE(avg(c) FILTER (WHERE day < date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')), 0)
  ORDER BY 2 DESC LIMIT 8;`);
add('⚠️', 'Traffic spike (> 3× ค่าเฉลี่ย 7 วัน)', spike.map(r => { const [t, c, avg] = r.split('|'); return `  - ${t} × ${c} (ปกติ ~${avg})`; }));

const total = psqlRows(`SELECT count(*) FROM audit_logs WHERE "timestamp" > now() - interval '24 hours';`)[0];
const stamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });

let text;
if (findings.length === 0) {
  text = `🛡️ Sovereign security digest (${stamp})\n✅ ไม่พบความผิดปกติ — ตรวจ ${total} events ใน 24 ชม.\n(6 กลุ่ม: brute-force · MFA burst · นอกเวลา · เหตุการณ์บัญชี · โมดูลใหม่ · spike)`;
} else {
  text = `🛡️ Sovereign security digest (${stamp}) — พบ ${findings.length} กลุ่ม · ${total} events/24 ชม.\n\n`
    + findings.map((f) => `${f.severity} ${f.title}\n${f.lines.join('\n')}`).join('\n\n');
}

console.log(`── ${stamp} · ${total} events/24 ชม. ──`);
console.log(text);

if (process.argv[2] === '--digest' || findings.length > 0) {
  const r = await notify(text);
  console.log(r.ok ? 'Telegram: ส่งแล้ว' : `Telegram: ไม่ได้ส่ง (${r.error})`);
  process.exit(r.ok ? 0 : 1);
}
console.log(`เงียบตามดีไซน์ — ไม่มี findings (${total} events/24 ชม.)`);
