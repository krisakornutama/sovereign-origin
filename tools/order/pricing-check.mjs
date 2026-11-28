#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/order/pricing-check.mjs — กันราคาบนหน้าเว็บหลุดจาก pricing.json
//
// ที่มา: ราคาอยู่ 3 ที่ (pricing.json, order.html, procurement.html) — ถ้าแก้ที่เดียว
// ลูกค้าจะเห็นยอดโอนไม่ตรงกับที่เครื่องมือ fulfill ตรวจ ราคาผิด = โอนผิด = ต้องคืนเงิน
//
// ตรวจ: ราคาใน pricing.json สมเหตุสมผล (เทียบ USD) + ตัวเลขที่โชว์บนหน้าเว็บตรงกับ JSON
// exit: 0 = ตรงกัน · 1 = มีจุดที่หลุด
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// สูตรจัดรูปแบบราคาตัวเดียวกับที่หน้าเว็บใช้ (portfolio/price-format.js) — ห้ามเขียนซ้ำในไฟล์นี้
import priceFormat from '../../portfolio/price-format.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pricing = JSON.parse(readFileSync(path.join(ROOT, 'portfolio', 'pricing.json'), 'utf8'));

const { usdPrice, baht, approxThb, roundTo, priceTexts } = priceFormat;
const thb = baht;
const promoPrice = (list) => Math.floor((list * (100 - pricing.promo.percent)) / 100 / 10) * 10;

const pages = {
  'portfolio/order.html': readFileSync(path.join(ROOT, 'portfolio', 'order.html'), 'utf8'),
  'portfolio/procurement.html': readFileSync(path.join(ROOT, 'portfolio', 'procurement.html'), 'utf8'),
  'portfolio/buy.html': readFileSync(path.join(ROOT, 'portfolio', 'buy.html'), 'utf8'),
};

const failures = [];
function check(ok, message) {
  process.stdout.write(`${ok ? '✓' : '✗'} ${message}\n`);
  if (!ok) failures.push(message);
}

for (const tier of pricing.tiers) {
  const impliedUsd = tier.thb / pricing.usdPerThb;
  const drift = Math.abs(impliedUsd - tier.usd) / tier.usd;
  check(drift < 0.08, `${tier.name}: ฿${thb(tier.thb)} เทียบ $${tier.usd} คลาดเคลื่อน ${(drift * 100).toFixed(1)}% (< 8%)`);
}

for (const tier of pricing.tiers) {
  const promo = promoPrice(tier.thb);
  const orderHtml = pages['portfolio/order.html'];
  check(orderHtml.includes(`data-thb="${tier.thb}"`), `order.html: data-thb ของ ${tier.name} = ${tier.thb}`);
  check(
    orderHtml.includes(`฿${thb(tier.thb)}`) && orderHtml.includes(`฿${thb(promo)}`),
    `order.html: แสดง ${tier.name} ฿${thb(tier.thb)}→฿${thb(promo)}`
  );
  check(
    pages['portfolio/procurement.html'].includes(thb(tier.thb)) &&
      pages['portfolio/procurement.html'].includes(thb(promo)),
    `procurement.html: แสดง ${tier.name} ${thb(tier.thb)} / ${thb(promo)}`
  );
}

check(pages['portfolio/order.html'].includes(pricing.promo.code), `order.html: มีโค้ด ${pricing.promo.code}`);
check(
  pages['portfolio/procurement.html'].includes(String(pricing.renewal.thb).replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
  `procurement.html: ราคาต่ออายุ ฿${thb(pricing.renewal.thb)}`
);
check(pages['portfolio/order.html'].includes('4440626505'), 'order.html: มีเลขบัญชี 4440626505');
check(pages['portfolio/procurement.html'].includes('4440626505'), 'procurement.html: มีเลขบัญชี 4440626505');
check(pages['portfolio/buy.html'].includes('4440626505'), 'buy.html: มีเลขบัญชี 4440626505');

// ไม่มีเลขบัญชีอื่นนอกจาก 4440626505 บนหน้าขาย
for (const [name, html] of Object.entries(pages)) {
  const numbers = html.match(/\b\d{10}\b/g) ?? [];
  const foreign = numbers.filter((n) => n !== '4440626505');
  check(foreign.length === 0, `${name}: ไม่มีเลข 10 หลักอื่น (พบ ${foreign.join(', ') || 'ไม่มี'})`);
}

/* ── โปร EARLY20: หน้าเว็บต้องผูกกับ pricing.json ไม่ใช่แก้มือหลายหน้า ──
   order.html/buy.html มีจุดเสียบ (data-promo-note) + โหลด promo.js ซึ่งอ่าน promo.gumroadUrl
   ถ้า URL ยังเป็น null (ยังไม่สร้างโค้ดในหลังร้าน) หน้าเว็บต้องคงข้อความ "โอนอย่างเดียว" */
const promo = pricing.promo ?? {};
const promoJs = readFileSync(path.join(ROOT, 'portfolio', 'promo.js'), 'utf8');
const GUMROAD_PRODUCT = 'https://oweenhoper.gumroad.com/l/sovereign-os';
const gumroadNull = promo.gumroadUrl === null;

check(gumroadNull || typeof promo.gumroadUrl === 'string', 'promo.gumroadUrl เป็น null (ยังไม่มีโค้ด) หรือ URL เต็ม');

for (const name of ['portfolio/order.html', 'portfolio/buy.html']) {
  check(pages[name].includes('data-promo-note'), `${name}: มีจุดเสียบข้อความโปร (data-promo-note)`);
  check(pages[name].includes('src="promo.js"'), `${name}: โหลด promo.js`);
  check(!pages[name].includes(`${GUMROAD_PRODUCT}/${promo.code}`), `${name}: ไม่ hardcode ลิงก์โค้ด (ต้องมาจาก pricing.json)`);
}
check(promoJs.includes("fetch('pricing.json'"), 'promo.js: อ่าน pricing.json เป็นแหล่งความจริง');
check(promoJs.includes('data-promo-note'), 'promo.js: เขียนโน้ตโปรลงจุดเสียบ');
check(/^\d{4}-\d{2}-\d{2}$/.test(String(promo.expires)) && !Number.isNaN(Date.parse(promo.expires)),
  `promo.expires เป็นวันที่จริงรูปแบบ YYYY-MM-DD (${promo.expires})`);

if (gumroadNull) {
  check(promo.channel === 'bank-transfer', 'promo.channel = bank-transfer ขณะที่ยังไม่มีโค้ด Gumroad');
} else {
  check(promo.gumroadUrl === `${GUMROAD_PRODUCT}/${promo.code}`, `promo.gumroadUrl ชี้สินค้า+โค้ดเดียวกัน (${GUMROAD_PRODUCT}/${promo.code})`);
  check(/gumroad/.test(String(promo.channel)), 'promo.channel ระบุ gumroad แล้วเมื่อมีโค้ด');
  check(Number.isInteger(promo.percent) && promo.percent > 0 && promo.percent < 100, `promo.percent = ${promo.percent}% (ต้องเป็นจำนวนเต็ม 1–99)`);
}

/* ── ราคาบน buy.html: ตัวเลขที่ลูกค้าเห็นต้องมาจาก pricing.json ──
   buy.html เก็บค่า fallback ไว้ในช่อง [data-price] เพื่อให้ crawler/no-JS อ่านได้
   promo.js เขียนทับจาก JSON ตอนโหลด ⇒ ค่า fallback ที่ไม่ตรง JSON = ราคาที่คนไม่เปิด JS เห็นผิด
   ขั้นปัดราคาบาทมาจาก display.approxThbRoundTo ที่เดียว (ห้าม hardcode ใน HTML/promo.js) */
const buyHtml = pages['portfolio/buy.html'];
const approxStep = roundTo(pricing);
const bahtFmt = baht;

check(Number.isInteger(approxStep) && approxStep > 0,
  `pricing.json: display.approxThbRoundTo = ${pricing.display?.approxThbRoundTo} (ขั้นปัดราคาบาทโดยประมาณ)`);

/* ── สูตรราคาต้องอยู่ที่ price-format.js ที่เดียว ──
   promo.js (หน้าเว็บ) และไฟล์นี้ (ด่านตรวจ) เรียกทั้งคู่ ⇒ แก้สูตรที่เดียวไม่มีทางเพี้ยนจากกัน
   กันการถอยกลับ: ถ้าใครเผลอประกาศ usdPrice/approxThb/baht ซ้ำในไฟล์ใดไฟล์หนึ่ง ให้ pricing:check ล้มทันที */
const priceFormatJs = readFileSync(path.join(ROOT, 'portfolio', 'price-format.js'), 'utf8');
const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8');
for (const fn of ['usdPrice', 'baht', 'approxThb', 'priceTexts']) {
  check(new RegExp(`function ${fn}\\b`).test(priceFormatJs), `price-format.js: มีสูตร ${fn}()`);
}
check(promoJs.includes('SovereignPriceFormat'), 'promo.js: ใช้ price-format.js (ไม่ประกาศสูตรราคาเอง)');
check(selfSrc.includes('portfolio/price-format.js'), 'pricing-check.mjs: import price-format.js (สูตรราคาจุดเดียว)');
for (const fn of ['usdPrice', 'approxThb', 'baht']) {
  check(!new RegExp(`function ${fn}\\b`).test(promoJs), `promo.js: ไม่ประกาศ ${fn}() ซ้ำ (ต้องใช้ price-format.js)`);
  check(!new RegExp(`function ${fn}\\b`).test(selfSrc), `pricing-check.mjs: ไม่ประกาศ ${fn}() ซ้ำ (ต้อง import price-format.js)`);
}
for (const name of ['portfolio/buy.html', 'portfolio/order.html']) {
  const html = pages[name];
  const iShared = html.indexOf('src="price-format.js"');
  const iPromo = html.indexOf('src="promo.js"');
  check(iShared !== -1 && iPromo !== -1 && iShared < iPromo,
    `${name}: โหลด price-format.js ก่อน promo.js (defer รันตามลำดับ)`);
}
/* ค่า fallback ใน HTML ต้องตรงกับ priceTexts() ตัวเดียวกับที่ promo.js ใช้เขียนทับ */
for (const [key, text] of Object.entries(priceTexts(pricing))) {
  check(buyHtml.includes(`data-price="${key}">${text}<`), `buy.html: ช่อง ${key} = ${text}`);
}

for (const tier of pricing.tiers) {
  check(buyHtml.includes(`data-price="thb:${tier.id}">${bahtFmt(approxThb(tier.thb, approxStep))}<`),
    `buy.html: ช่องราคาบาทโดยประมาณ ${tier.name} = ${bahtFmt(approxThb(tier.thb, approxStep))} (ปัดขั้น ${approxStep})`);
}

/* head (meta/JSON-LD) ต้องอยู่ใน HTML ดิบเพราะ scraper ไม่รัน JS → ใช้ pricing:check บังคับให้ตรง JSON */
const head = buyHtml.split('</head>')[0];
const tierDots = pricing.tiers.map((t) => `${t.name} ${usdPrice(t.usd)}`).join(' · ');
const tierCommas = pricing.tiers.map((t) => `${t.name} ${usdPrice(t.usd)}`).join(', ');
check(head.includes(`content="ซื้อ Sovereign OS — ${tierDots}"`), `buy.html head: og/twitter title มีราคา ${tierDots}`);
check(head.includes(tierCommas), `buy.html head: meta description มีราคา ${tierCommas}`);

const ldJson = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(buyHtml);
let ld = null;
try { ld = ldJson ? JSON.parse(ldJson[1]) : null; } catch { ld = null; }
const offers = Array.isArray(ld?.offers) ? ld.offers : [];
check(offers.length === pricing.tiers.length,
  `buy.html JSON-LD: มี offers ครบ ${pricing.tiers.length} แพ็กเกจ (พบ ${offers.length})`);
for (const tier of pricing.tiers) {
  const offer = offers.find((o) => o?.name === tier.name);
  check(Boolean(offer) && Number(offer.price) === Number(tier.usd) && offer.priceCurrency === 'USD',
    `buy.html JSON-LD: ${tier.name} = $${tier.usd} USD`);
}

/* กันการเพิ่มตัวเลขใหม่แบบฝังมือ: หลังลบราคาในช่องออกแล้ว body ต้องไม่เหลือราคา */
const body = buyHtml.split('</head>')[1] ?? '';
const bodyNoSlots = body.replace(/data-price="[^"]*">[^<]*</g, 'data-price=""><');
const pricePattern = (usd) => new RegExp(`\\$${String(usd).replace('.', '\\.')}(?!\\d)`);
for (const tier of pricing.tiers) {
  check(!pricePattern(tier.usd).test(bodyNoSlots),
    `buy.html: ไม่มีราคา ${usdPrice(tier.usd)} ฝังนอกช่อง data-price`);
}
check(!pricePattern(pricing.renewal.usd).test(bodyNoSlots),
  `buy.html: ไม่มีราคาต่ออายุ ${usdPrice(pricing.renewal.usd)} ฝังนอกช่อง data-price`);
check(!/≈\s*[\d,]+\s*บาท/.test(bodyNoSlots),
  'buy.html: ราคาบาทโดยประมาณทุกจุดอยู่ในช่อง data-price="thb:…" (ไม่พิมพ์มือ)');

if (failures.length > 0) {
  process.stderr.write(`\n✗ pricing:check ไม่ผ่าน ${failures.length} ข้อ\n`);
  process.exit(1);
}
process.stdout.write('\n✓ pricing:check ผ่าน — ราคาบนเว็บตรงกับ pricing.json\n');
