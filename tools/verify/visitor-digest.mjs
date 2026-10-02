#!/usr/bin/env node
// tools/verify/visitor-digest.mjs — สรุปพฤติกรรมผู้เยี่ยมชม + ความต้องการใหม่ ส่ง Telegram (P13 30/9/69)
//   node tools/verify/visitor-digest.mjs           → ส่งสรุป 7 วันล่าสุด เสมอ (เรียกโดย Task วันจันทร์ 08:00)
//   node tools/verify/visitor-digest.mjs --test    → เหมือนกันแต่พิมพ์ข้อความออกจอ ไม่ส่ง Telegram
// แนวเดียวกับ security-anomaly.mjs: psql ผ่าน docker exec · DB ติดต่อไม่ได้ = ล้มดัง (exit 1) ห้ามปลอมข้อความปกติ
// ความต้องการใหม่ (kind=question/survey) นับเฉพาะ "หลัง digest ครั้งก่อน" (จด timestamp ไว้ที่ data/visitor-digest-last.json)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './telegram-creds.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_FILE = join(ROOT, 'sovereign-os', 'core-api', 'data', 'visitor-digest-last.json');
const TEST_MODE = process.argv.includes('--test');

function psqlRows(sql) {
  return execFileSync('docker',
    ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'],
    { input: sql, encoding: 'utf8', timeout: 30_000, windowsHide: true }
  ).split(/\r?\n/).filter(Boolean);
}

function lastDigestAt() {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return j.sentAt ?? null;
  } catch { return null; }
}

function esc(s) { return String(s ?? '').replace(/[<>&]/g, ''); }

/* SEO (P22 2/10/69) — วงรายสัปดาห์: ยิง IndexNow ให้บอทรู้ทันทีที่ URL เปลี่ยน + เช็คว่า sitemap ยังตอบได้
   soft-fail ทั้งก้อน — digest รายงานผู้เข้าชม ต้องไม่ล้มเพราะเว็บไม่ตอบ */
async function seoBlock() {
  try {
    const r = spawnSync('node', [join(ROOT, 'tools', 'indexnow-shop-notify.mjs'), '--strict'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, windowsHide: true,
    });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((s) => s.trim()).filter(Boolean);
    // บรรทัดสรุปขึ้นต้นด้วย "indexnow-shop:" (ท้าย ๆ เป็นรายการ URL) — จับจากบรรทัดนั้น ไม่ใช่บรรทัดสุดท้าย
    const last = out.find((l) => l.startsWith('indexnow-shop:')) ?? out[out.length - 1] ?? '';
    const pingOk = r.status === 0 && last.startsWith('indexnow-shop: ✓');
    let urls = 0;
    try {
      const res = await fetch('https://sovereignoriginshop.dpdns.org/sitemap.xml', { signal: AbortSignal.timeout(15_000) });
      if (res.ok) urls = [...(await res.text()).matchAll(/<loc>/g)].length;
    } catch { /* sitemap ตอบไม่ได้ = รายงานว่าไม่ผ่าน */ }
    return { pingOk, sitemapOk: urls > 0, urls };
  } catch (e) {
    return { pingOk: false, sitemapOk: false, urls: 0, err: e?.message ?? String(e) };
  }
}

/* ผลของ SEO pre-flight + การพิสูจน์ backup จากรอบ nightly ล่าสุด (อ่านไฟล์ ไม่รันซ้ำ)
   — รายงานรายสัปดาห์ควรเห็นภาพรวม ไม่ใช่แค่ยิง IndexNow ผ่าน */
function lastCheck(file) {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'logs', file), 'utf8'));
  } catch { return null; }
}

async function main() {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sinceQ = since.slice(0, 19).replace('T', ' ');
  const prev = lastDigestAt(); // null = ครั้งแรก → ใช้ 7 วัน

  // 1) ภาพรวม 7 วัน
  const total = psqlRows(`SELECT count(*) FROM visitor_events WHERE created_at >= '${sinceQ}';`)[0] ?? '0';
  const visitors = psqlRows(`SELECT count(DISTINCT ip_hash) FROM visitor_events WHERE created_at >= '${sinceQ}' AND ip_hash IS NOT NULL;`)[0] ?? '0';

  const pageRows = psqlRows(`SELECT page, count(*) FROM visitor_events WHERE kind='page_view' AND created_at >= '${sinceQ}' GROUP BY page ORDER BY count(*) DESC LIMIT 4;`);
  const tabRows = psqlRows(`SELECT COALESCE(detail,'?'), count(*) FROM visitor_events WHERE kind='demo_tab' AND created_at >= '${sinceQ}' GROUP BY 1 ORDER BY count(*) DESC LIMIT 4;`);
  const avgRow = psqlRows(`SELECT round(avg(value::numeric)) FROM visitor_events WHERE kind='time_on_page' AND created_at >= '${sinceQ}' AND value ~ '^[0-9]+$';`)[0];

  // 2) ความต้องการใหม่ตั้งแต่ digest ก่อน (หรือ 7 วัน ถ้าครั้งแรก)
  const newSinceQ = (prev ?? since).slice(0, 19).replace('T', ' ');
  const surveyRows = psqlRows(`SELECT value, count(*) FROM visitor_events WHERE kind='survey' AND created_at >= '${newSinceQ}' GROUP BY value ORDER BY count(*) DESC LIMIT 5;`);
  const questionRows = psqlRows(`SELECT detail, value FROM visitor_events WHERE kind='question' AND created_at >= '${newSinceQ}' ORDER BY created_at DESC LIMIT 5;`);

  // 3) ฟีดแบ็กรอตัดสิน
  const pending = psqlRows(`SELECT count(*) FROM feedback_notes WHERE useful IS NULL;`)[0] ?? '0';

  const lines = [];
  lines.push('📊 <b>สรุปผู้เยี่ยมชม 7 วัน</b>');
  lines.push(`เหตุการณ์ ${total} · ผู้มาเยือน ~${visitors} คน${avgRow ? ` · อยู่หน้าเฉลี่ย ${avgRow}s` : ''}`);
  if (pageRows.length) lines.push('หน้ายอดนิยม: ' + pageRows.map((r) => { const [p, c] = r.split('|'); return `${p}(${c})`; }).join(' · '));
  if (tabRows.length) lines.push('แท็บเดโม่: ' + tabRows.map((r) => { const [t, c] = r.split('|'); return `${t}(${c})`; }).join(' · '));

  if (surveyRows.length || questionRows.length) {
    lines.push('');
    lines.push(`💡 <b>ความต้องการใหม่</b> (ตั้งแต่ ${prev ? 'digest ก่อน' : '7 วันก่อน'})`);
    if (surveyRows.length) lines.push('อยากใช้จริงก่อน: ' + surveyRows.map((r) => { const [v, c] = r.split('|'); return `${v}(${c})`; }).join(' · '));
    for (const r of questionRows) {
      const [d, v] = r.split('|');
      lines.push(`• ${esc(d)} — ${esc(v)}`);
    }
  } else {
    lines.push('');
    lines.push('💡 ความต้องการใหม่: ยังไม่มีในรอบนี้');
  }

  // 4) เงินเข้า 7 วัน (P18): ยอดแจ้งชำระรอยืนยัน (PROMPTPAY ยังไม่ถูกยืนยันด้วยบิล CASH/TRANSFER) + ยอดรับแล้ว
  //    "รับแล้ว" = บิลยืนยันจากเจ้าของ (method ไม่ใช่ PROMPTPAY — ตามกติกา addPayment ที่ method CASH/TRANSFER = เงินเข้าจริง)
  const ppRows = psqlRows(`SELECT COALESCE(sum(p.amount),0) FROM business_payments p JOIN business_orders o ON o.id=p."orderId" WHERE p.method='PROMPTPAY' AND p."rejectedAt" IS NULL AND o.status IN ('QUOTE','ORDERED') AND p."paidAt" >= '${sinceQ}';`);
  const receivedRows = psqlRows(`SELECT COALESCE(sum(p.amount),0) FROM business_payments p WHERE p.method <> 'PROMPTPAY' AND p."paidAt" >= '${sinceQ}';`);
  const billRows = psqlRows(`SELECT count(*) FROM business_orders WHERE "partnerId" IS NOT NULL AND "createdAt" >= '${sinceQ}';`);
  lines.push('');
  lines.push('💰 <b>เงินเข้า 7 วัน</b>');
  lines.push(`แจ้งชำระรอยืนยัน: ${Number(ppRows[0] ?? 0).toLocaleString('th-TH')} ฿ · ยืนยันรับแล้ว: ${Number(receivedRows[0] ?? 0).toLocaleString('th-TH')} ฿ · บิลคู่ค้าใหม่ ${billRows[0] ?? 0} ใบ`);
  if (Number(ppRows[0] ?? 0) > 0) lines.push('→ เปิดยืนยันที่ /business → แท็บออเดอร์ (การ์ด "แจ้งชำระแล้วรอยืนยัน")');

  if (Number(pending) > 0) {
    lines.push('');
    lines.push(`📬 ฟีดแบ็กรอคัดกรอง ${pending} รายการ — เปิด /feedback-admin กด 👍 แล้วยื่นถึงคุณได้`);
  }

  // 5) SEO: sitemap + IndexNow + ผล pre-flight/backup จาก nightly ล่าสุด (soft-fail)
  const seo = await seoBlock();
  const seoCheck = lastCheck('seo-preflight.json');
  const restoreCheck = lastCheck('backup-restore-check.json');
  const gscCheck = lastCheck('gsc-coverage.json');
  lines.push('');
  lines.push(`🔎 <b>SEO</b>: sitemap ${seo.sitemapOk ? `${seo.urls} URL` : '⚠️ ตอบไม่ผ่าน'} · IndexNow ${seo.pingOk ? 'ส่งแล้ว ✓' : '⚠️ ยังไม่ผ่าน'}`);
  lines.push(
    `ตรวจหน้าเว็บ: ${seoCheck ? (seoCheck.ok ? `ผ่าน ${seoCheck.checked} URL ✓` : `⚠️ ${seoCheck.problems.length} จุด`) : 'ยังไม่ได้ตรวจ'}` +
      ` · backup: ${restoreCheck ? (restoreCheck.ok ? `กู้คืนได้จริง ✓ (${restoreCheck.dump ?? '-'})` : '⚠️ กู้คืนไม่ได้') : 'ยังไม่ได้ตรวจ'}`
  );
  // GSC coverage: อ่านไฟล์ log ไม่ยิง API ซ้ำ · ยังไม่ได้ตั้ง credential = ขึ้นว่ายังไม่ได้ตั้งค่า (ไม่ใช่เตือน)
  lines.push(
    gscCheck
      ? (gscCheck.skipped
        ? `Google index: ยังไม่ได้ตั้งค่า GSC API (รอ Verify + credential)`
        : (gscCheck.ok
          ? `Google index: ${gscCheck.indexed?.length ?? 0}/${gscCheck.sitemapUrls ?? 0} หน้าติด index ✓ · impressions ${gscCheck.current?.impressions ?? 0}`
          : `Google index: ⚠️ ${gscCheck.problems?.length ?? 0} จุด`))
      : 'Google index: ยังไม่ได้ตรวจ'
  );

  const text = lines.join('\n');

  if (TEST_MODE) {
    console.log(text.replace(/<[^>]+>/g, ''));
    return;
  }

  const r = await notify(text);
  if (!r.ok) {
    console.error('ส่ง Telegram ไม่สำเร็จ:', r.error ?? 'unknown');
    process.exit(1);
  }
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ sentAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log('ส่ง digest แล้ว');
}

try {
  main().catch((e) => { console.error('digest ล้ม:', e?.message ?? e); process.exit(1); });
} catch (e) {
  console.error('digest ล้ม (DB/ดิสก์):', e?.message ?? e);
  process.exit(1);
}
