#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/order/sync-head.mjs — สร้างส่วนหัวของ portfolio/buy.html จาก pricing.json
//
// ทำไมต้อง "สร้างตอน build" ไม่ใช่เขียนด้วย JS ตอนเปิดหน้า:
//   ตัวอ่านลิงก์ (Facebook, X/Twitter, LinkedIn, Slack, Discord) ไม่รัน JS — มันอ่าน
//   <meta>/JSON-LD จาก HTML ดิบเท่านั้น ถ้าปล่อยให้ promo.js เติมตัวเลขทีหลัง
//   ตัวอย่างลิงก์ (OG card) จะโชว์ราคาเก่าหรือว่าง ⇒ เสียช่องฟรีที่คนแชร์ลิงก์ให้เรา
//   ทางเดียวที่ได้ทั้ง "แหล่งความจริงเดียว" และ "scraper อ่านได้" คือ:
//   pricing.json → สคริปต์นี้ → buy.html นิ่ง ๆ (commit ตามปกติ)
//
// ใช้:
//   npm run pricing:head            เขียน buy.html ใหม่ (แก้ราคาใน JSON แล้วรันตัวนี้)
//   npm run pricing:head -- --check ตรวจอย่างเดียว ไม่แตะไฟล์ (CI: Audit site)
//
// ตรวจซ้ำ: tools/order/pricing-check.mjs เรียก renderHead() ตัวเดียวกันมาเทียบ
//   ⇒ ถ้าใครแก้ head มือหรือลืมรันหลังเปลี่ยนราคา pricing:check จะล้มทันที
//
// สิ่งที่ไฟล์นี้เป็นเจ้าของ (แก้มือแล้วจะถูกเขียนทับ):
//   · <meta name="description">        — รายการราคาคั่นด้วย ", "
//   · <meta property="og:title">       — "ซื้อ Sovereign OS — Home $59 · Business $199 · …"
//   · <meta name="twitter:title">      — ข้อความเดียวกับ og:title
//   · JSON-LD `offers`                — หนึ่ง Offer ต่อหนึ่ง tier (ราคา/สกุลเงินจาก JSON)
// สิ่งที่ไฟล์นี้ไม่แตะ: title, canonical, og:image/url/description, twitter:description,
//   ข้อความ non-price อื่น ๆ และ JSON-LD ฟิลด์อื่น (name/description/brand/url)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import priceFormat from '../../portfolio/price-format.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUY_HTML = path.join(ROOT, 'portfolio', 'buy.html');
export const PRICING_JSON = path.join(ROOT, 'portfolio', 'pricing.json');

const DEFAULT_OFFER_URL = 'https://oweenhoper.gumroad.com/l/sovereign-os';
const JSONLD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;

/* รายการราคาที่ใช้ใน head — สูตรตัวเลขมาจาก price-format.js (ที่เดียวกับหน้าเว็บ) */
function priceLists(pricing) {
  const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
  const pairs = tiers.map((t) => `${t.name} ${priceFormat.usdPrice(t.usd)}`);
  return { dot: pairs.join(' · '), comma: pairs.join(', '), tiers };
}

/* offers ของ JSON-LD: หนึ่ง Offer ต่อ tier · คง url เดิมของ Offer ที่ชื่อตรงกัน */
function offersFrom(pricing, previous) {
  const prev = Array.isArray(previous) ? previous : [];
  return (Array.isArray(pricing.tiers) ? pricing.tiers : []).map((tier) => {
    const old = prev.find((o) => o && o.name === tier.name);
    return {
      '@type': 'Offer',
      name: tier.name,
      price: String(tier.usd),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: (old && old.url) || DEFAULT_OFFER_URL,
    };
  });
}

/**
 * คืน HTML ของ buy.html ที่ตัวเลขใน head ตรงกับ pricing.json
 * เป็น pure function (ไม่แตะดิสก์) ⇒ pricing-check ใช้เทียบได้โดยไม่เขียนไฟล์
 */
export function renderHead(html, pricing) {
  const { dot, comma } = priceLists(pricing);
  const cut = html.indexOf('</head>');
  if (cut === -1) throw new Error('buy.html: ไม่พบ </head>');
  let head = html.slice(0, cut);
  const rest = html.slice(cut);

  /* 1) รายการราคาใน meta description / og:title / twitter:title
        รูปแบบ "<ชื่อ> $<ราคา>" คั่นด้วย " · " หรือ ", " — ทั้งก้อนถูกเขียนใหม่จาก JSON
        จับ “ทุกรายการที่หน้าตาเหมือนราคา” ไม่ใช่เฉพาะชื่อที่มีใน tiers ปัจจุบัน ⇒
        ถ้าเพิ่ม/ลบ/เปลี่ยนชื่อแพ็กเกจ ตัวเลขเก่าที่ค้างอยู่จะถูกกวาดออกด้วย ไม่เหลือราคาผี */
  const pair = '[^\\s$·,]+\\s+\\$\\d+(?:\\.\\d+)?';
  const runRe = new RegExp(`${pair}(?:\\s*(?:·|,)\\s*${pair})+`, 'g');
  let dotRuns = 0;
  let commaRuns = 0;
  head = head.replace(runRe, (m) => {
    if (m.includes('·')) { dotRuns++; return dot; }
    commaRuns++;
    return comma;
  });
  if (dotRuns === 0 || commaRuns === 0) {
    throw new Error(
      'buy.html head: หาไม่พบรายการราคาที่ต้องสร้างใหม่ ' +
      `(พบแบบ " · " ${dotRuns} จุด, แบบ ", " ${commaRuns} จุด) — ` +
      'โครง head เปลี่ยนไปจากที่สคริปต์นี้รู้จัก; แก้ regex ใน sync-head.mjs ก่อน'
    );
  }
  /* กันเงียบ: หลังสร้างแล้ว head ต้องมีรายการราคาชุดใหม่จริง ๆ ทั้งสองแบบ */
  if (!head.includes(dot) || !head.includes(comma)) {
    throw new Error('buy.html head: สร้างรายการราคาใหม่แล้วไม่พบใน head — ตรวจ regex ใน sync-head.mjs');
  }

  /* 2) JSON-LD offers — parse ของเดิมเพื่อคงฟิลด์อื่นไว้ทั้งหมด
        เขียนใหม่เฉพาะก้อน offers แบบข้อความ (ไม่ stringify ทั้งก้อน) เพื่อ:
        · คงรูปทรง/การย่อหน้าที่เหลือของ JSON-LD ไว้ให้ diff น้อยที่สุด
        · ราคาไม่เปลี่ยน = ไฟล์ไม่เปลี่ยนแม้แต่ไบต์เดียว (--check ผ่านโดยไม่ต้องรันซ้ำ) */
  const m = JSONLD_RE.exec(head);
  if (!m) throw new Error('buy.html head: ไม่พบ <script type="application/ld+json">');
  let ld;
  try {
    ld = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`buy.html head: JSON-LD parse ไม่ได้ (${e.message})`);
  }

  const offers = offersFrom(pricing, ld.offers);
  const lines = offers
    .map((o) => '    { ' + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + ' }')
    .join(',\n');
  const offersRe = /"offers"\s*:\s*\[[\s\S]*?\n  \]/;
  if (!offersRe.test(m[1])) {
    throw new Error('buy.html head: ไม่พบก้อน "offers": [ … ] ในรูปแบบที่สคริปต์นี้รู้จัก (แก้ regex ใน sync-head.mjs ก่อน)');
  }
  const nextJson = m[1].replace(offersRe, `"offers": [\n${lines}\n  ]`);

  /* กันการสร้าง JSON ที่ parse ไม่ได้หรือ offers ไม่ตรงกับ pricing.json */
  const reparsed = JSON.parse(nextJson);
  if (JSON.stringify(reparsed.offers) !== JSON.stringify(offers)) {
    throw new Error('buy.html head: offers ที่สร้างขึ้นไม่ตรงกับ tiers ใน pricing.json');
  }
  head = head.replace(JSONLD_RE, `<script type="application/ld+json">${nextJson}</script>`);

  return head + rest;
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const checkOnly = process.argv.includes('--check');
  const pricing = JSON.parse(readFileSync(PRICING_JSON, 'utf8'));
  const before = readFileSync(BUY_HTML, 'utf8');

  let after;
  try {
    after = renderHead(before, pricing);
  } catch (e) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(1);
  }

  if (before === after) {
    process.stdout.write('✓ buy.html head ตรงกับ pricing.json อยู่แล้ว\n');
    process.exit(0);
  }

  if (checkOnly) {
    const a = before.split('\n');
    const b = after.split('\n');
    const firstDiff = a.findIndex((line, i) => line !== b[i]) + 1;
    process.stderr.write(
      '✗ buy.html head ไม่ตรงกับ pricing.json\n' +
      `  บรรทัดแรกที่ต่าง: ${firstDiff}\n` +
      '  แก้: npm run pricing:head   (แล้ว commit buy.html ที่ถูกเขียนใหม่)\n'
    );
    process.exit(1);
  }

  writeFileSync(BUY_HTML, after);
  process.stdout.write('✓ เขียน buy.html ใหม่จาก pricing.json แล้ว — ตรวจ diff ก่อน commit\n');
}
