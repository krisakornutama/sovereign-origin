#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/order/fulfill.mjs — ปิดออเดอร์ที่โอนเงินแล้วให้จบในคำสั่งเดียว
//
// ที่มา: หลังลูกค้าโอนและส่งสลิป เจ้าของยังต้อง (ก) ออกไลเซนส์ (ข) เขียนใบเสร็จ
// (ค) พิมพ์อีเมลส่งลูกค้า (ง) จดว่าใครซื้ออะไร เท่าไร — สี่ขั้นนี้ทำมือทุกออเดอร์
// และเป็นขั้นที่ช้าที่สุดของทั้งลูป (สัญญาไว้ 24 ชม. แต่คนไทยคาดหวังเป็นนาที)
//
// หลักการ:
//   • fail-closed: sell.mjs ตรวจไลเซนส์ซ้ำก่อน แล้วเราจึงสร้างไฟล์ส่งมอบ
//   • ราคา THB ต้องตรงกับ portfolio/pricing.json (ไม่มีทางพิมพ์ราคาผิด tier)
//   • ไม่คัดลอกสลิปเข้ามาใน repo — เก็บแค่ชื่อไฟล์ + sha256 ไว้เป็นหลักฐาน
//   • ผลิตอีเมล .eml พร้อมแนบ (license.txt, delivery.md, receipt.html) ⇒ เปิดแล้วกด Send ได้เลย
//
// ใช้:
//   node tools/order/fulfill.mjs --ref SO-261128-1A2B --tier business \
//     --name "ร้านตัวอย่าง" --email buyer@example.com --amount 5590 \
//     --slip ~/Downloads/slip.jpg [--machines MACHINE-ID] [--promo EARLY20]
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELL = path.join(ROOT, 'tools', 'license', 'sell.mjs');
const PRICING_PATH = path.join(ROOT, 'portfolio', 'pricing.json');
const PUBLIC_KEY = path.join(ROOT, 'portfolio', 'license-pub.txt');
const SELLER_EMAIL = 'owenhoper3@gmail.com';
const SELLER_NAME = 'กฤษกรณ์ อุตมะ (Krisakorn Utama)';

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    [
      'Sovereign OS — ปิดออเดอร์โอนเงิน (ไลเซนส์ + ใบเสร็จ + อีเมลพร้อมส่ง + ledger)',
      '',
      '  --ref <SO-YYMMDD-XXXX>     เลขที่คำสั่งซื้อจากหน้า order.html',
      '  --tier home|business|pro',
      '  --name "<ชื่อบนไลเซนส์>"',
      '  --email <อีเมลลูกค้า>',
      '  --amount <บาท>             ต้องตรงกับ pricing.json (ราคาเต็มหรือราคาโปร)',
      '  [--slip <ไฟล์สลิป>]        เก็บแค่ชื่อไฟล์ + sha256 ไม่คัดลอกเข้า repo',
      '  [--machines <id,...>] [--promo EARLY20] [--allow-custom-amount]',
      '  [--outdir sales/<ref>] [--ledger sales/ledger.jsonl] [--now ISO]',
      '',
      'exit: 0 = พร้อมส่ง · 1 = ไม่ผ่าน (ไม่มีไฟล์ส่ง ไม่มีแถว ledger)',
      '',
    ].join('\n')
  );
}

const flags = parseArgs(process.argv.slice(2));
if (flags.help === 'true' || Object.keys(flags).length === 0) {
  usage();
  process.exit(0);
}

const pricing = JSON.parse(readFileSync(PRICING_PATH, 'utf8'));
const tier = String(flags.tier ?? 'home');
const tierSpec = pricing.tiers.find((t) => t.id === tier);
if (!tierSpec) fail(`ไม่รู้จัก tier "${tier}" — ใช้ home, business หรือ pro`);

const ref = String(flags.ref ?? '');
if (!/^SO-\d{6}-[0-9A-F]{4}$/i.test(ref)) fail('--ref ต้องอยู่ในรูป SO-YYMMDD-XXXX (สร้างจากหน้า order.html)');

const buyer = String(flags.name ?? '').trim();
if (!buyer) fail('ต้องระบุ --name "<ชื่อที่จะพิมพ์บนไลเซนส์>"');

const email = String(flags.email ?? '').trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ต้องระบุ --email ของลูกค้า (ใช้ส่งไฟล์และติดตาม)');

const amount = Number(flags.amount);
if (!Number.isFinite(amount) || amount <= 0) fail('ต้องระบุ --amount <บาท> เป็นตัวเลขมากกว่า 0');

const promoPercent = pricing.promo.percent;
const promoPrice = Math.floor((tierSpec.thb * (100 - promoPercent)) / 100 / 10) * 10;
const allowed = [tierSpec.thb, promoPrice];
if (!allowed.includes(amount) && flags['allow-custom-amount'] !== 'true') {
  fail(
    `ยอด ${amount} ไม่ตรงกับราคา ${tierSpec.name}: เต็ม ${tierSpec.thb} หรือโปร ${promoPrice} บาท` +
      ' (ถ้าเป็นราคาที่ตกลงเป็นกรณีพิเศษ ให้ใส่ --allow-custom-amount)'
  );
}
const usedPromo = amount === promoPrice && amount !== tierSpec.thb;

const slipPath = flags.slip ? path.resolve(flags.slip.replace(/^~/, process.env.HOME ?? '')) : '';
let slipInfo = null;
if (slipPath) {
  if (!existsSync(slipPath)) fail(`ไม่พบไฟล์สลิป: ${slipPath}`);
  const bytes = readFileSync(slipPath);
  slipInfo = {
    file: path.basename(slipPath),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    note: 'เก็บแค่ชื่อไฟล์และ sha256 (ไม่คัดลอกสลิปเข้า repo)',
  };
}

const outdir = path.resolve(ROOT, flags.outdir ?? path.join('sales', ref));
const ledger = path.resolve(ROOT, flags.ledger ?? path.join('sales', 'ledger.jsonl'));
mkdirSync(outdir, { recursive: true });

const sellArgs = [
  SELL,
  '--key', process.env.LICENSE_PRIVATE_KEY_PATH ?? path.join(ROOT, '..', '.secrets', 'license-priv.pem'),
  '--public-key', PUBLIC_KEY,
  '--licensee', buyer,
  '--tier', tier,
  '--amount', String(amount),
  '--order', ref,
  '--outdir', outdir,
  '--ledger', ledger,
  '--paid',
];
if (flags.machines) sellArgs.push('--machines', String(flags.machines));
if (tierSpec.perpetual) sellArgs.push('--perpetual');
else sellArgs.push('--days', String(tierSpec.days || 365));
if (flags.now) sellArgs.push('--now', String(flags.now));

process.stdout.write(`→ ออกไลเซนส์ ${ref} (${tierSpec.name}, ${amount} บาท)\n`);
const sold = spawnSync(process.execPath, sellArgs, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
if (sold.status !== 0) fail(`sell.mjs ไม่ผ่าน — ไม่มีไฟล์ส่งมอบ:\n${sold.stderr || sold.stdout || ''}`.trim());
if (sold.stdout) process.stdout.write(sold.stdout);

const licensePath = path.join(outdir, 'license.txt');
const deliveryPath = path.join(outdir, 'delivery.md');
if (!existsSync(licensePath)) fail('sell.mjs จบแล้วแต่ไม่พบ license.txt — หยุดก่อนส่ง');

const delivery = readFileSync(deliveryPath, 'utf8');
const licenseText = readFileSync(licensePath, 'utf8').trim();
const licenseId = (delivery.match(/ไลเซนส์: `([^`]+)`/) ?? [])[1] ?? '';
const expiresAt = (delivery.match(/หมดอายุ: (.+)/) ?? [])[1]?.trim() ?? '';
const now = flags.now ? new Date(String(flags.now)) : new Date();
const isoDate = now.toISOString().slice(0, 10);
const thb = (n) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(n);

const referralCodes = Array.from({ length: pricing.referral.codesPerBuyer }, (_, i) => `${ref}-R${i + 1}`);

// ── ใบเสร็จรับเงิน (พิมพ์/บันทึกเป็น PDF ได้) ──────────────────────────────
const receiptHtml = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ใบเสร็จรับเงิน ${ref}</title>
<style>
body{font-family:'IBM Plex Sans Thai Looped','Noto Sans Thai Looped',system-ui,sans-serif;color:#1b1712;margin:32px;line-height:1.6;max-width:720px}
h1{font-size:1.15rem;margin:0 0 2px}
.muted{color:#6b6259;font-size:.86rem}
table{width:100%;border-collapse:collapse;margin:18px 0}
th,td{border-bottom:1px solid #d8d0c4;padding:8px 6px;text-align:left;font-size:.92rem}
td.num,th.num{text-align:right}
.total{font-weight:700;color:#8c2f27}
.box{border:1px solid #d8d0c4;border-radius:6px;padding:12px 14px;margin:14px 0}
@media print{body{margin:12mm}.no-print{display:none}}
</style></head><body>
<h1>ใบเสร็จรับเงิน / Receipt</h1>
<p class="muted">เลขที่ ${ref} · วันที่ ${isoDate} · อ้างอิงไลเซนส์ ${licenseId || '-'}</p>
<div class="box">
  <strong>ผู้ขาย</strong><br>${SELLER_NAME}<br>อีเมล ${SELLER_EMAIL}<br>
  <span class="muted">ยังไม่จดทะเบียนภาษีมูลค่าเพิ่ม จึงไม่มีภาษีมูลค่าเพิ่มในใบนี้</span>
</div>
<div class="box">
  <strong>ผู้ซื้อ</strong><br>${buyer}<br>${email}
</div>
<table>
  <thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">รวม (บาท)</th></tr></thead>
  <tbody>
    <tr><td>Sovereign OS — ${tierSpec.name} (${tierSpec.machines ? tierSpec.machines + ' เครื่อง' : 'ไม่จำกัดสาขา'}, ${tierSpec.updates})<br>
      <span class="muted">ไลเซนส์ ${licenseId || '-'}${expiresAt ? ' · หมดอายุ ' + expiresAt : ''}${usedPromo ? ' · ใช้โค้ด ' + pricing.promo.code : ''}</span></td>
      <td class="num">1</td><td class="num">${thb(amount)}</td></tr>
    <tr><td class="total">รวมทั้งสิ้น</td><td></td><td class="num total">${thb(amount)}</td></tr>
  </tbody>
</table>
<p class="muted">ชำระโดยการโอนเข้าบัญชีธนาคารกรุงไทย เลขที่ 4440626505 ชื่อ กฤษกรณ์ อุตมะ ·
คืนเงินเต็มจำนวนภายใน 7 วันถ้าใช้งานบนเครื่องผู้ซื้อไม่ได้ · เปลี่ยนเครื่องได้ปีละ 1 ครั้ง</p>
<button class="no-print" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>
</body></html>`;
writeFileSync(path.join(outdir, 'receipt.html'), receiptHtml);

// ── อีเมลพร้อมส่ง (multipart + แนบไฟล์) ────────────────────────────────────
const subject = `Sovereign OS — ไฟล์ติดตั้งและไลเซนส์ของคุณ (${ref})`;
const bodyText = [
  `สวัสดีครับ คุณ${buyer}`,
  '',
  `ได้รับชำระ ${thb(amount)} บาท สำหรับ Sovereign OS ${tierSpec.name} เรียบร้อยแล้ว (อ้างอิง ${ref})`,
  'ไฟล์ที่แนบมาพร้อมอีเมลนี้:',
  '  1) license.txt — ไลเซนส์ที่เซ็นด้วย Ed25519 (วางใน .env ตาม delivery.md)',
  '  2) delivery.md — วิธีติดตั้งทีละขั้น + public key สำหรับตรวจใบเอง',
  '  3) receipt.html — ใบเสร็จรับเงิน (เปิดแล้วพิมพ์/บันทึกเป็น PDF ได้)',
  '',
  'ลิงก์ดาวน์โหลดไฟล์ติดตั้ง (ตรวจ SHA256SUMS.txt ก่อนติดตั้ง):',
  '  https://github.com/krisakornutama/sovereign-origin/releases/tag/v1.3.10',
  '  ตรวจลายนิ้วมือไฟล์ได้ที่ https://sovereignoriginshop.dpdns.org/release-verify.html',
  '',
  `รหัสแนะนำสำหรับคนรู้จัก (ลด ${pricing.referral.percent}% ต่อคน ใช้กับการโอนในประเทศ):`,
  ...referralCodes.map((code) => `  ${code}`),
  '',
  'ถ้าติดตั้งไม่ผ่าน ตอบอีเมลนี้ได้เลย ผมช่วยจนใช้งานได้ หรือคืนเงินเต็มจำนวนภายใน 7 วัน',
  '',
  'ขอบคุณครับ',
  SELLER_NAME,
  SELLER_EMAIL,
  'https://sovereignoriginshop.dpdns.org/buy.html',
].join('\r\n');

function attach(name, content, type) {
  const b64 = Buffer.from(content, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `--BOUNDARY`,
    `Content-Type: ${type}; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64,
  ].join('\r\n');
}

const eml = [
  `From: ${SELLER_NAME} <${SELLER_EMAIL}>`,
  `To: ${buyer} <${email}>`,
  `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
  `Date: ${now.toUTCString()}`,
  `Message-ID: <${ref}@sovereignoriginshop.dpdns.org>`,
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUNDARY"',
  '',
  '--BOUNDARY',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(bodyText, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  attach('license.txt', licenseText, 'text/plain; charset="utf-8"'),
  attach('delivery.md', delivery, 'text/markdown; charset="utf-8"'),
  attach('receipt.html', receiptHtml, 'text/html; charset="utf-8"'),
  '--BOUNDARY--',
  '',
].join('\r\n');
const emlPath = path.join(outdir, 'email.eml');
writeFileSync(emlPath, eml);

const orderRecord = {
  ref,
  createdAt: now.toISOString(),
  tier,
  tierName: tierSpec.name,
  buyer,
  email,
  amountThb: amount,
  listPriceThb: tierSpec.thb,
  promo: usedPromo ? pricing.promo.code : null,
  licenseId,
  expiresAt,
  machines: flags.machines ? String(flags.machines).split(',').map((v) => v.trim()).filter(Boolean) : [],
  slip: slipInfo,
  referralCodes,
  files: {
    license: path.relative(ROOT, licensePath).split(path.sep).join('/'),
    delivery: path.relative(ROOT, deliveryPath).split(path.sep).join('/'),
    receipt: path.relative(ROOT, path.join(outdir, 'receipt.html')).split(path.sep).join('/'),
    email: path.relative(ROOT, emlPath).split(path.sep).join('/'),
  },
  status: 'ready-to-send',
  sentAt: null,
};
writeFileSync(path.join(outdir, 'order.json'), JSON.stringify(orderRecord, null, 2) + '\n');

process.stdout.write(
  [
    '',
    `✓ พร้อมส่ง ${ref}`,
    `  ไลเซนส์: ${licenseId || '-'}${expiresAt ? ` (หมดอายุ ${expiresAt})` : ' (ซื้อขาด)'}`,
    `  ยอด: ${thb(amount)} บาท · ${tierSpec.name}${usedPromo ? ` · โค้ด ${pricing.promo.code}` : ''}`,
    `  ใบเสร็จ: ${orderRecord.files.receipt}`,
    `  อีเมลพร้อมแนบ: ${orderRecord.files.email}`,
    `  รหัสแนะนำ: ${referralCodes.join(', ')}`,
    `  ขั้นต่อไป: เปิด ${orderRecord.files.email} แล้วกด Send (หรือลากไฟล์ในโฟลเดอร์ ${path.relative(ROOT, outdir)} แนบเอง)`,
    '',
  ].join('\n')
);
