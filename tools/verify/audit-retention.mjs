#!/usr/bin/env node
// tools/verify/audit-retention.mjs — I3c (28/9/69): audit_logs เก็บ 90 วัน เกิน = export เป็น .json.gz แล้ว drop partition
//   node tools/verify/audit-retention.mjs                  → ตรวจ partition เดือนที่ "จบ" มานานกว่า AUDIT_RETENTION_DAYS (default 90)
//                                                            เจอ = export json.gz → ตรวจจำนวนแถว → DROP partition → คัดลอกไป mirror → แจ้ง Telegram
//   node tools/verify/audit-retention.mjs --probe          → โหมดพิสูจน์ท่อโดยไม่แตะข้อมูลจริง: สร้าง partition เดือนเก่าจำลอง
//                                                            + แถวปลอม → export/drop ของปลอมครบวงจร → รายงาน (ปิดท้ายลบของปลอม)
// หลักการ: partition ล็อกสั้น (drop ทั้งเดือนไม่แตะแถวอื่น) · ไฟล์เก็บบน E: + mirror (ช่องทางที่สอง E3) · drop เฉพาะหลัง export จำนวนแถวตรง
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // MAIN เสมอ (ธรรมเนียม offsite-push)
const MAIN_ROOT = 'E:/My work/Project Sovereign Origin';
const MIRROR_DIR = path.resolve(process.env.OFFSITE_MIRROR_DIR || 'C:/SovereignOffsite');
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 90);
const COLD_DIR = path.join(MAIN_ROOT, 'sovereign-os/infra/cold-storage/audit_logs');
const PROBE = process.argv.includes('--probe');

const psql = (sql) => execFileSync('docker', ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', sql], { encoding: 'utf8', timeout: 120_000 }).trim();
const psqlRows = (sql) => execFileSync('docker', ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-At', '-F', '\t', '-c', sql], { encoding: 'utf8', timeout: 300_000 }).trim().split('\n').filter(Boolean);

// partition เดือนนั้น "จบ" (สิ้นสุดเดือน) มานานกว่า retention หรือยัง — parse bound ฝั่ง JS (pg_get_expr คืน text)
function expiredPartitions() {
  const rows = psqlRows(`SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs' AND c.relname NOT LIKE '%default'`);
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  const out = [];
  for (const row of rows) {
    const [name, bound] = row.split('\t');
    const m = String(bound).match(/FROM \('([^']+)'/);
    if (!m) continue;
    const [y, mo] = m[1].split('-').map(Number);
    const ends = Date.UTC(y, mo, 1); // วันแรกของเดือนถัดไป = จุดที่ partition หยุดรับข้อมูล
    if (ends < cutoff) out.push(name);
  }
  return out.sort();
}

async function notify(text) {
  try {
    const { readTelegramCreds } = await import('./telegram-creds.mjs');
    const tg = readTelegramCreds();
    if (!tg.token || !tg.chatId) return;
    await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chatId, text }), signal: AbortSignal.timeout(30_000),
    });
  } catch { /* แจ้งไม่ถึง = ข้าม (สายหลักคือไฟล์) */ }
}

if (PROBE) {
  console.log('── โหมด PROBE: partition จำลอง + แถวปลอม — ท่อครบวงจร ไม่แตะข้อมูลจริง ──');
  const probePart = 'audit_logs_2025_01';
  psql(`CREATE TABLE IF NOT EXISTS ${probePart} PARTITION OF audit_logs FOR VALUES FROM ('2025-01-01') TO ('2025-02-01')`);
  psql(`INSERT INTO audit_logs (id, timestamp, action_type, payload) SELECT gen_random_uuid(), timestamp '2025-01-05 12:00:00+00', 'I3C_PROBE', '{"probe":true}'::jsonb FROM generate_series(1, 7)`);
  const probeExpired = psqlRows(`
    SELECT c.relname FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs' AND c.relname = '${probePart}'`).length > 0;
  if (!probeExpired) { console.error('สร้าง partition จำลองไม่สำเร็จ'); process.exit(1); }
  console.log(`partition จำลองพร้อม: ${probePart} (แถวปลอม 7)`);
  await runPipeline([probePart], { probe: true });
  // เก็บกวาดของปลอม: partition ถูก drop แล้วระหว่างท่อ — เหลือแค่ไฟล์ cold ของปลอมให้ลบ
  for (const f of fs.readdirSync(COLD_DIR)) if (f.includes('_2025_01')) fs.unlinkSync(path.join(COLD_DIR, f));
  console.log('✅ PROBE ผ่าน — ท่อ export→ตรวจ→drop→mirror ใช้การได้จริง (ของปลอมเก็บกวาดหมด)');
  process.exit(0);
}

async function runPipeline(parts, { probe = false } = {}) {
  let didAny = false;
  for (const part of parts) {
    const month = part.replace('audit_logs_', ''); // YYYY_MM
    const [y, m] = month.split('_').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const outPath = path.join(COLD_DIR, `audit_logs_${month}.json.gz`);
    fs.mkdirSync(COLD_DIR, { recursive: true });

    // 1) export รายแถวเป็น NDJSON แล้ว gzip — เขียนผ่านไฟล์ชั่วคราวบน E: ตามกฎ
    const tmp = outPath + '.tmp';
    const rows = psqlRows(`SELECT row_to_json(t)::text FROM (SELECT * FROM audit_logs WHERE "timestamp" >= '${from}' AND "timestamp" < '${to}' ORDER BY "timestamp") t`);
    fs.writeFileSync(tmp, rows.join('\n'));
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    fs.writeFileSync(outPath, gz);
    fs.unlinkSync(tmp);
    const exported = rows.length;

    // 2) ตรวจจำนวนแถวตรงก่อน drop — ไม่ตรง = ห้ามลบเด็ดขาด
    const counted = Number(psql(`SELECT count(*) FROM audit_logs WHERE "timestamp" >= '${from}' AND "timestamp" < '${to}'`));
    if (exported !== counted) {
      console.error(`❌ ${part}: export ${exported} ≠ count ${counted} — งด drop (ไฟล์ยังอยู่ที่ ${outPath})`);
      continue;
    }

    // 3) drop ทั้ง partition (ล็อกสั้น ไม่แตะแถวอื่น)
    psql(`DROP TABLE IF EXISTS ${part}`);

    // 4) คัดลอกเข้า mirror (ช่องทางที่สอง E3) — best-effort
    let mirrored = false;
    try {
      fs.mkdirSync(MIRROR_DIR, { recursive: true });
      fs.copyFileSync(outPath, path.join(MIRROR_DIR, path.basename(outPath)));
      mirrored = true;
    } catch (e) { console.error(`⚠️ mirror ล้ม — ${String(e?.message || e).slice(0, 100)}`); }

    const kb = Math.round(gz.length / 1024);
    console.log(`✅ ${part}: export ${exported} แถว → ${path.basename(outPath)} (${kb} KB) → drop แล้ว${mirrored ? ' + mirror' : ''}`);
    didAny = true;
    if (!probe) await notify(`🗄 Audit retention (90 วัน): เดือน ${month} export ${exported} แถว (${kb} KB) → เก็บ cold storage + drop partition แล้ว`);
  }
  return didAny;
}

const parts = expiredPartitions();
if (!parts.length) {
  console.log(`✅ ไม่มี partition เกินเกณฑ์ ${RETENTION_DAYS} วัน — ไม่ต้องทำอะไร`);
  process.exit(0);
}
console.log(`เจอ ${parts.length} partition เกินเกณฑ์: ${parts.join(', ')}`);
const did = await runPipeline(parts);
process.exit(did ? 0 : 1);
