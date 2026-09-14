#!/usr/bin/env node
/* Site audit — the deploy gate for this repo.
   Part 1 (static): every page parses, every internal link + anchor resolves.
   Part 2 (browser, needs playwright): zero console/page errors and zero
   horizontal overflow on every page (desktop + mobile), and smoke-checks of
   the interactive widgets. External links are listed, not fetched (CI-safe).
   Usage: node scripts/audit.js  (serves this folder on 127.0.0.1:4919 itself) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function report(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/* ───────── part 1: static link & anchor graph ───────── */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const anchors = new Map(); // page -> Set(ids)
const external = new Set();
const linkRows = []; // {from, raw, target, anchor}

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  anchors.set(page, ids);
}

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  // scan markup only — inline JS builds hrefs from data and is not real HTML
  const scanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const m of scanHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (raw.startsWith('#')) {
      linkRows.push({ from: page, raw, target: page, anchor: raw.slice(1) });
    } else if (/^(https?:)?\/\//.test(raw)) {
      external.add(raw);
    } else if (!/^(mailto:|data:|tel:)/.test(raw)) {
      const [t, a] = raw.split('#');
      linkRows.push({ from: page, raw, target: t, anchor: a || null });
    }
  }
}

report(pages.length >= 8, `all ${pages.length} pages read`, pages.join(', '));

const seen = new Set();
for (const row of linkRows) {
  const key = `${row.from} -> ${row.raw}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (!row.target) { report(false, `link ${key}`, 'empty target'); continue; }
  if (!fs.existsSync(path.join(ROOT, row.target))) { report(false, `link ${key}`, `missing file ${row.target}`); continue; }
  if (row.anchor && !(anchors.get(row.target) || new Set()).has(row.anchor)) {
    report(false, `link ${key}`, `missing id "${row.anchor}" in ${row.target}`);
  }
}
const broken = linkRows.length && [...seen].filter((k) => k.includes('->') === false);
report(true, `internal links checked: ${seen.size}`, 'duplicates collapsed');
console.log(`INFO external links referenced (not fetched): ${external.size}`);
for (const e of [...external].slice(0, 8)) console.log(`       ${e}`);
if (external.size > 8) console.log(`       … and ${external.size - 8} more`);

/* ───────── part 2: headless browser (skipped if playwright absent) ───────── */
let chromium = null;
try { chromium = require('playwright').chromium; } catch { /* optional below */ }

async function main() {
  if (!chromium) {
    console.log('SKIP browser checks — playwright not installed (run: npm install)');
    finish();
    return;
  }
  process.env.PORT = '4919';
  await import('./serve.mjs'); // starts listening on import
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();
  const pages2 = pages.map((p) => p);

  async function sweep(viewport, label) {
    for (const page of pages2) {
      const ctx = await browser.newContext({ viewport });
      const p = await ctx.newPage();
      const errs = [];
      p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await p.goto(`http://127.0.0.1:4919/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
      await p.waitForTimeout(400);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report(errs.length === 0 && overflow === 0, `${label} ${page}`, `errors=${errs.length} overflow=${overflow}${errs.length ? ' :: ' + errs.join(' | ').slice(0, 160) : ''}`);
      await ctx.close();
    }
  }
  await sweep({ width: 1280, height: 800 }, 'desktop');
  await sweep({ width: 390, height: 844 }, 'mobile ');

  // widget smoke checks
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { failures++; console.log('FAIL widget pageerror: ' + e.message); });

  async function goto(f) { await p.goto(`http://127.0.0.1:4919/${f}`, { waitUntil: 'networkidle' }); }

  // index: VAT period picker re-stamps the seal
  await goto('index.html');
  if (await p.locator('#periodSel').count()) {
    const before = await p.locator('#stampPeriod').innerText().catch(() => '');
    await p.locator('#periodSel').selectOption({ index: 2 });
    await p.waitForTimeout(400);
    const after = await p.locator('#stampPeriod').innerText().catch(() => '');
    report(!!before && before !== after, 'widget index: period picker re-stamps seal');
  } else report(false, 'widget index: #periodSel missing');

  // farm: herb picker swaps card
  await goto('farm.html');
  if (await p.locator('#herbSel').count()) {
    const before = await p.locator('#herbCard').innerText().catch(() => '');
    await p.locator('#herbSel').selectOption({ index: 1 });
    await p.waitForTimeout(300);
    const after = await p.locator('#herbCard').innerText().catch(() => '');
    report(!!before && before !== after, 'widget farm: herb picker swaps card');
  } else report(false, 'widget farm: #herbSel missing');

  // iot: rule simulation renders stage
  await goto('iot.html');
  if (await p.locator('#ruleSel').count()) {
    const before = await p.locator('#stage').innerHTML().catch(() => '');
    await p.locator('#ruleSel').selectOption({ index: 1 });
    await p.waitForTimeout(900);
    const after = await p.locator('#stage').innerHTML().catch(() => '');
    report(after !== before && after.trim().length > 0, 'widget iot: rule sim renders stage');
  } else report(false, 'widget iot: #ruleSel missing');

  // books: console API, honest empty states, search, publisher·year line, sorting
  await goto('books.html');
  const apiOk = await p.evaluate(() => {
    const B = window.__books__ || {};
    return Array.isArray(B.CATEGORIES) && B.CATEGORIES.length === 6 && Array.isArray(B.published) && Array.isArray(B.read) && typeof B.rebuildAll === 'function';
  });
  report(apiOk, 'widget books: __books__ API (categories, shelves, rebuild)');
  const bars0 = await p.locator('.filters').count();
  const empties0 = await p.locator('.empty').count();
  report(bars0 === 0 && (empties0 === 2 || empties0 === 0), 'widget books: empty state honest (bars hidden, empty cards or filled)');

  // inject data via the console API and exercise search + publisher/year + sort
  await p.evaluate(() => {
    const B = window.__books__;
    B.published.length = 0;
    B.published.push({ title: 'ตำรากลยุทธ์', author: 'ผู้เขียน ก', url: 'https://example.com/p1', note: 'โน้ต', category: 'กลยุทธ์', year: 2568, publisher: 'สำนักพิมพ์ ก' });
    B.read.length = 0;
    B.read.push(
      { title: 'ศิลปะสงคราม', author: 'ซุนจื่อ', category: 'สงคราม', year: 2550, publisher: 'สำนักพิมพ์ ส' },
      { title: 'ชีวประวัติ ยาว', author: 'ผู้เขียน ช', category: 'ชีวประวัติ', year: 2568 },
      { title: 'เล่มไม่มีปี', author: 'ผู้เขียน อ', category: 'อื่น ๆ' }
    );
    B.rebuildAll();
  });
  const cards = await p.locator('.book').count();
  const pubLines = await p.locator('#pubShelf .bk-pub').allInnerTexts();
  const injectOk = cards === 4 && pubLines.length === 1 && pubLines[0].includes('สำนักพิมพ์ ก') && pubLines[0].includes('2568');
  report(injectOk, 'widget books: cards + publisher·year line', JSON.stringify({ cards, pubLines }));
  await p.fill('#searchIn', 'ซุนจื่อ');
  await p.waitForTimeout(200);
  const sPub = await p.locator('#pubShelf .book').count();
  const sRead = await p.locator('#readShelf .book').count();
  report(sPub === 0 && sRead === 1, 'widget books: search filters both shelves', `pub=${sPub} read=${sRead}`);
  await p.fill('#searchIn', 'zzz-not-found');
  await p.waitForTimeout(200);
  const zPubEmpty = await p.locator('#pubShelf .empty').innerText().catch(() => '');
  report(zPubEmpty.includes('คำค้น'), 'widget books: no-result message distinct', JSON.stringify(zPubEmpty.slice(0, 70)));
  await p.fill('#searchIn', '');
  await p.waitForTimeout(200);
  await p.selectOption('#readSort', 'new');
  await p.waitForTimeout(200);
  const titlesNew = await p.locator('#readShelf .bk-title').allInnerTexts();
  report(titlesNew[0] === 'ชีวประวัติ ยาว' && titlesNew[titlesNew.length - 1] === 'เล่มไม่มีปี', 'widget books: read shelf sorted new→old, no-year last', JSON.stringify(titlesNew));
  await p.selectOption('#readSort', 'old');
  await p.waitForTimeout(200);
  const titlesOld = await p.locator('#readShelf .bk-title').allInnerTexts();
  report(titlesOld[0] === 'ศิลปะสงคราม' && titlesOld[titlesOld.length - 1] === 'เล่มไม่มีปี', 'widget books: read shelf sorted old→new', JSON.stringify(titlesOld));
  await p.evaluate(() => { const B = window.__books__; B.published.length = 0; B.read.length = 0; B.rebuildAll(); });

  // projects: contact form validation without navigation
  await goto('projects.html');
  if (await p.locator('#contactForm button[type=submit]').count()) {
    await p.locator('#contactForm button[type=submit]').click();
    await p.waitForTimeout(250);
    const msg = await p.locator('#formMsg').innerText().catch(() => '');
    report(msg.trim().length > 0 && p.url().includes('projects.html'), 'widget projects: empty form blocked with message');
  } else report(false, 'widget projects: contact form missing');

  await ctx.close();
  await browser.close();
  finish();
}

function finish() {
  console.log(failures === 0 ? 'AUDIT CLEAN' : `AUDIT FAILED: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('AUDIT CRASH', e); process.exit(1); });
