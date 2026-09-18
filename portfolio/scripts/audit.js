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

report(pages.length >= 11, `all ${pages.length} pages read`, pages.join(', '));

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
report(true, `internal links checked: ${seen.size}`, 'duplicates collapsed');
console.log(`INFO external links referenced (not fetched): ${external.size}`);
for (const e of [...external].slice(0, 8)) console.log(`       ${e}`);
if (external.size > 8) console.log(`       … and ${external.size - 8} more`);

/* ───────── part 2: headless browser (skipped if playwright absent) ───────── */
let chromium = null;
try { chromium = require('playwright').chromium; } catch { /* optional below */ }

/* ───────── part 1.5: copy gate (no browser needed) ─────────
   ตัวตรวจคำไทย/มาร์กอัป + self-test ของตัวมันเอง — ด่านที่ไม่เคยยิงคือด่านที่ไร้ค่า */
async function copyGate() {
  const { runCheck, selfTest } = await import('./check-copy.mjs');
  const st = selfTest();
  report(st.length === 0, 'copy gate self-test (catches misspelling / Thai-Latin join / dropped การันต์ / raw & / bad spacing)', st.join(', ') || 'all 5 classes caught');
  const r = runCheck(ROOT);
  report(r.ok, `copy gate: ${r.files} files clean (site + README + docs when present)`, r.ok ? '' : `${r.findings} finding(s) listed above`);
}

async function main() {
  await copyGate();
  if (!chromium) {
    console.log('SKIP browser checks — playwright not installed (run: npm install)');
    finish();
    return;
  }
  process.env.PORT = '4919';
  await import('./serve.mjs'); // starts listening on import
  await new Promise((r) => setTimeout(r, 600));

  const browser = await chromium.launch();

  /* เก็บผลด่านที่ต้อง "วัด" ไม่ใช่แค่ "หน้าพังไหม" — ฟอนต์ต้องถูกใช้จริง, ข้อความห้ามถูกตัดเงียบ,
     ปุ่มห้ามมีแค่สัญลักษณ์เป็นชื่อ (ถ้าฟอนต์ emoji หายผู้ใช้ต้องยังใช้เว็บได้) */
  const gate = { fontFails: [], clipFails: [], emojiFails: [], iconFails: [], textLen: {} };
  /* หน้าบางหน้ามีข้อความที่ "พิมพ์ทีละตัว" (บูต/จำลอง) — วัดตอนกำลังพิมพ์จะเทียบกันไม่ได้
     จึงรอให้จำนวนตัวอักษรนิ่งก่อน (2 ตัวอย่างติดกันเท่ากัน) แล้วค่อยใช้เทียบ */
  async function settledTextLen(page) {
    /* คืน { len, settled } — หน้าที่มีข้อความ "พิมพ์/เติมท้ายต่อเนื่อง" (บูต log, จำลองเซนเซอร์)
       ไม่มีจุดนิ่งให้รอเลย จึงต้องรายงานสถานะ unsettled แทนที่จะปลอมตัวเป็นตัวเลขนิ่ง
       (ผู้เรียกใช้เทียบความยาวได้เฉพาะเมื่อทั้งสองข้าง settled) */
    let prev = -1;
    for (let i = 0; i < 14; i++) {
      const n = await page.evaluate(() => document.body.innerText.length);
      if (n === prev) return { len: n, settled: true };
      prev = n;
      await page.waitForTimeout(250);
    }
    return { len: prev, settled: false };
  }
  const probe = (p) => p.evaluate(() => {
    /* `document.fonts.check()` ตอบ true ให้ตระกูลที่ไม่รู้จัก (ถือเป็น system font) —
       ตัวที่พิสูจน์ "โหลดมาจริง" คือจำนวน @font-face ของตระกูลนั้นที่ status=loaded */
    const loadedFaces = (needle) => [...document.fonts].filter((f) => f.family.includes(needle) && f.status === 'loaded').length;
    const uses = (needle) => [...document.querySelectorAll('body *')].some((el) => {
      if (el.children.length) return false;
      if (!(el.textContent || '').trim()) return false;
      return getComputedStyle(el).fontFamily.includes(needle);
    });
    const thaiIn = (needle) => [...document.querySelectorAll('body *')].some((el) => {
      if (el.children.length) return false;
      const t = (el.textContent || '').trim();
      if (!t || !/[\u0E00-\u0E7F]/.test(t)) return false;
      return getComputedStyle(el).fontFamily.includes(needle);
    });
    const c = document.createElement('canvas').getContext('2d');
    const head = 'ฎ ฏ ฐ ฒ ณ ต';
    c.font = '16px "Noto Sans Thai Looped"'; const wNoto = c.measureText(head).width;
    c.font = '16px "IBM Plex Sans Thai Looped"'; const wIbm = c.measureText(head).width;
    c.font = '16px serif'; const wSerif = c.measureText(head).width;
    let clipped = 0; const clipSample = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
      if (el.scrollWidth - el.clientWidth > 1) { clipped++; if (clipSample.length < 3) clipSample.push(t.slice(0, 40)); }
    }
    /* ชื่อปุ่ม: ยอมรับข้อความที่เห็น หรือ aria-label/title (ปุ่ม ✕ + aria-label = ใช้ได้จริง) */
    const emojiOnly = [];
    for (const el of document.querySelectorAll('a, button, [role="button"], summary')) {
      const raw = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
      if (!(el.innerText || '').trim() && !(el.getAttribute('aria-label') || '').trim()) continue;
      const stripped = raw.replace(/\p{Extended_Pictographic}/gu, '').replace(/[✕✖×⨯＋+✓]/g, '').trim();
      if (stripped.length < 2) emojiOnly.push(raw.slice(0, 30));
    }
    let iconsLonely = 0; const iconSample = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length) continue;
      const raw = (el.textContent || '');
      if (!raw.trim()) continue;
      const stripped = raw.replace(/\p{Extended_Pictographic}/gu, '').trim();
      if (stripped.length) continue; // มีข้อความของตัวเอง = ไม่พึ่ง emoji
      const parentText = (el.parentElement && el.parentElement.textContent || '').replace(/\p{Extended_Pictographic}/gu, '').trim();
      if (parentText.length < 2) { iconsLonely++; if (iconSample.length < 3) iconSample.push(raw.trim().slice(0, 20)); }
    }
    return {
      faces: { ibm: loadedFaces('IBM Plex Sans Thai Looped'), noto: loadedFaces('Noto Sans Thai Looped'), mono: loadedFaces('JetBrains Mono') },
      needs: { mono: uses('JetBrains Mono'), thaiInMono: thaiIn('JetBrains Mono') },
      widths: { ibm: wIbm, noto: wNoto, serif: wSerif }, clipped, clipSample, emojiOnly, iconsLonely, iconSample,
      textLen: document.body.innerText.length };
  });
  /* ด่านฟอนต์: ตระกูลที่ "หน้านี้ใช้จริง" ต้องโหลดมาจริง (หน้าที่ไม่ได้ใช้ ไม่ต้องมี) */
  const fontGate = (m) => {
    const bad = [];
    if (!m.faces.ibm) bad.push('IBM Plex Sans Thai Looped used but no loaded face');
    if (m.needs.mono && !m.faces.mono) bad.push('JetBrains Mono used but not loaded');
    if (m.needs.thaiInMono && !m.faces.noto) bad.push('Thai text inside mono lines but no looped face loaded for it');
    if (!(m.widths.ibm !== m.widths.serif && m.widths.noto !== m.widths.serif)) bad.push(`glyph widths identical to fallback ${JSON.stringify(m.widths)}`);
    return bad;
  };

  async function sweep(viewport, label) {
    for (const page of pages) {
      const ctx = await browser.newContext({ viewport });
      const p = await ctx.newPage();
      const errs = [];
      p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await p.goto(`http://127.0.0.1:4919/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
      // รอสัญญาณจริงของฟอนต์ (fonts.ready) แทนหน้าต่างตาย 400ms — CDN มาช้ากว่านั้นคือเรื่องเครือข่าย ไม่ใช่ defect ของหน้า
      await p.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]));
      await p.waitForTimeout(150);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report(errs.length === 0 && overflow === 0, `${label} ${page}`, `errors=${errs.length} overflow=${overflow}${errs.length ? ' :: ' + errs.join(' | ').slice(0, 160) : ''}`);
      const m = await probe(p);
      const at = `${label.trim()} ${page}`;
      for (const why of fontGate(m)) gate.fontFails.push(`${at} ${why}`);
      if (m.clipped) gate.clipFails.push(`${at} ${m.clipped} clipped :: ${m.clipSample.join(' | ')}`);
      if (m.emojiOnly.length) gate.emojiFails.push(`${at} :: ${m.emojiOnly.join(' | ')}`);
      if (m.iconsLonely) gate.iconFails.push(`${at} ${m.iconsLonely} :: ${m.iconSample.join(' | ')}`);
      if (label === 'desktop') gate.textLen[page] = await settledTextLen(p);
      await ctx.close();
    }
  }
  await sweep({ width: 1280, height: 800 }, 'desktop');
  await sweep({ width: 390, height: 844 }, 'mobile ');

  report(gate.fontFails.length === 0, 'fonts: looped Thai faces load AND render (not silent fallback) on every page, desktop+mobile',
    gate.fontFails.length ? gate.fontFails.slice(0, 4).join(' ; ') : `${pages.length} pages × 2 viewports (canvases differ from serif)`);
  report(gate.clipFails.length === 0, 'no silently clipped text (overflow hidden/clip with text wider than its box)',
    gate.clipFails.length ? gate.clipFails.slice(0, 4).join(' ; ') : 'checked every leaf element on every page, desktop+mobile');
  report(gate.emojiFails.length === 0, 'no control is labelled by emoji alone (usable with emoji fonts missing)',
    gate.emojiFails.length ? gate.emojiFails.slice(0, 4).join(' ; ') : 'links/buttons/summary all carry text or aria-label');
  report(gate.iconFails.length === 0, 'no icon stands without adjacent text (meaning not carried by emoji)',
    gate.iconFails.length ? gate.iconFails.slice(0, 4).join(' ; ') : 'every emoji-only node has text next to it');

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
  const pubCards0 = await p.locator('#pubShelf .book').count();
  const cats0 = await p.locator('#pubFilters .fbtn').count();
  const readEmpty0 = await p.locator('#readShelf .empty').innerText().catch(() => '');
  const readCards0 = await p.locator('#readShelf .book').count();
  report(pubCards0 === 8 && cats0 >= 4 && readEmpty0.includes('ยังไม่มีรายการ'),
    'widget books: real shelf = 8 verified books + category buttons built from that data; read shelf honestly empty',
    JSON.stringify({ pubCards0, cats0, readEmpty: readEmpty0.slice(0, 24) }));

  // inject data via the console API and exercise search + publisher/year + sort
  await p.evaluate(() => {
    const B = window.__books__;
    B.published.length = 0;
    B.published.push(
      { title: 'ตำรากลยุทธ์', author: 'ผู้เขียน ก', url: 'https://example.com/p1', note: 'โน้ต', category: 'กลยุทธ์', year: 2568, publisher: 'สำนักพิมพ์ ก', order: 2 },
      { title: 'หนังสือก่อน', author: 'ผู้เขียน ข', url: 'https://example.com/p2', category: 'อื่น ๆ', year: 2560, order: 1 }
    );
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
  const injectOk = cards === 5 && pubLines.length === 2 && pubLines.some((l) => l.includes('สำนักพิมพ์ ก') && l.includes('2568'));
  report(injectOk, 'widget books: cards + publisher·year line', JSON.stringify({ cards, pubLines }));
  const pubTitles = await p.locator('#pubShelf .bk-title').allInnerTexts();
  report(pubTitles[0] === 'หนังสือก่อน' && pubTitles[1] === 'ตำรากลยุทธ์', 'widget books: order field reorders cards, renderer untouched', JSON.stringify(pubTitles));
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
  await p.selectOption('#authorSel', 'ผู้เขียน ก');
  await p.waitForTimeout(200);
  const aPub = await p.locator('#pubShelf .book').count();
  const aRead = await p.locator('#readShelf .book').count();
  report(aPub === 1 && aRead === 0, 'widget books: author filter narrows both shelves', `pub=${aPub} read=${aRead}`);
  await p.selectOption('#authorSel', '');
  await p.selectOption('#yearSel', '2568');
  await p.waitForTimeout(200);
  const yPub = await p.locator('#pubShelf .book').count();
  const yRead = await p.locator('#readShelf .book').count();
  report(yPub === 1 && yRead === 1, 'widget books: year filter narrows both shelves', `pub=${yPub} read=${yRead}`);
  await p.selectOption('#yearSel', '');
  await p.waitForTimeout(200);
  await p.locator('#shelfFilters .fbtn[data-shelf="read"]').click();
  await p.waitForTimeout(200);
  const pubHidden = await p.locator('#published').isHidden();
  await p.locator('#shelfFilters .fbtn[data-shelf="all"]').click();
  await p.waitForTimeout(200);
  const pubBack = await p.locator('#published').isVisible();
  report(pubHidden && pubBack, 'widget books: shelf toggle hides/shows sections');
  await p.selectOption('#readSort', 'new');
  await p.waitForTimeout(200);
  const titlesNew = await p.locator('#readShelf .bk-title').allInnerTexts();
  report(titlesNew[0] === 'ชีวประวัติ ยาว' && titlesNew[titlesNew.length - 1] === 'เล่มไม่มีปี', 'widget books: read shelf sorted new→old, no-year last', JSON.stringify(titlesNew));
  await p.selectOption('#readSort', 'old');
  await p.waitForTimeout(200);
  const titlesOld = await p.locator('#readShelf .bk-title').allInnerTexts();
  report(titlesOld[0] === 'ศิลปะสงคราม' && titlesOld[titlesOld.length - 1] === 'เล่มไม่มีปี', 'widget books: read shelf sorted old→new', JSON.stringify(titlesOld));
  // ground truth for the search-index check = what the FILE renders (the inject/clear steps above only mutate this page)
  const bookRows = pubCards0 + readCards0;
  await p.evaluate(() => { const B = window.__books__; B.published.length = 0; B.read.length = 0; B.rebuildAll(); });

  // water: formation board — 3 modes, 9 cells, detail/checks react
  await goto('water.html');
  const wApi = await p.evaluate(() => {
    const W = window.__water__ || {};
    return W.MODES && Object.keys(W.MODES).length === 3 && typeof W.selectMode === 'function';
  });
  report(wApi, 'widget water: __water__ API (3 modes, 9 cells)');
  const wPills = await p.locator('#modePills .fbtn').count();
  const wCells = await p.locator('#waterBoard .cell').count();
  report(wPills === 3 && wCells === 9, 'widget water: board renders 3 mode pills + 9 cells', `pills=${wPills} cells=${wCells}`);
  await p.locator('#modePills .fbtn[data-mode="formation8"]').click();
  await p.waitForTimeout(200);
  await p.locator('#waterBoard .cell[data-key="c"]').click();
  await p.waitForTimeout(200);
  const detailC = await p.locator('#cellDetail').innerText();
  const modeOk = await p.evaluate(() => window.__water__.current().mode === 'formation8');
  report(modeOk && detailC.includes('หัวใจค่าย'), 'widget water: mode switch + center-cell detail updates');
  const checksN = await p.locator('#waterChecks li').count();
  report(checksN === 4, 'widget water: mode checks render 4 rules');
  // ground truth for the search-index consistency checks below
  var wTruth = await p.evaluate(() => {
    const W = window.__water__;
    return {
      taggedCells: Object.values(W.MODES).reduce((n, m) => n + Object.values(m.cells).filter((c) => c && c.tag).length, 0),
      terrainRows: W.TERRAIN.length
    };
  });

  // search: runtime index builds, query returns hits, type filter works
  await goto('search.html');
  await p.waitForFunction(() => window.__search__ && window.__search__.ready() > 50, null, { timeout: 15000 });
  const idxN = await p.evaluate(() => window.__search__.ready());
  report(idxN > 50, 'widget search: runtime index built from all pages', `entries=${idxN}`);
  // count-based consistency: the runtime index must mirror the live widget data —
  // a line-ending-fragile extractor or comment-phantom rows can otherwise shift
  // index contents silently while the old label-only checks keep passing.
  const counts = await p.evaluate(() => {
    const S = window.__search__;
    return {
      modeDesc: S.count('โหมด'),           // every tagged board cell indexes as desc 'โหมด <label>'
      terrainHits: S.count('ข้อมูลแปลง/บ่อ/รางบนกระดาน'),
      bookHits: S.count('ผลงานที่ลงพิมพ์') + S.count('ชั้นหนังสือที่อ่าน')
    };
  });
  counts.taggedCells = wTruth.taggedCells;
  counts.terrainRows = wTruth.terrainRows;
  counts.bookRows = bookRows;
  report(counts.modeDesc === counts.taggedCells && counts.taggedCells >= 27, 'widget search: water board cells fully indexed (9×3 modes)', JSON.stringify(counts));
  report(counts.terrainHits === counts.terrainRows && counts.terrainRows >= 6, 'widget search: terrain rows indexed match __water__.TERRAIN', JSON.stringify(counts));
  report(counts.bookHits === counts.bookRows, 'widget search: book rows indexed match __books__ shelves (no phantom rows)', JSON.stringify(counts));
  const findEn = await p.evaluate(() => window.__search__.find('livestock'));
  report(findEn >= 1, 'widget search: english entries indexed', `en=${findEn}`);
  await p.fill('#q', 'ภาษี');
  await p.waitForTimeout(250);
  const taxHits = await p.locator('.hit').count();
  report(taxHits >= 1, 'widget search: typing in the box renders hits', `hits=${taxHits}`);

  // en: english landing renders the full tour
  await goto('en.html');
  const stops = await p.locator('.tour .stop').count();
  const langEn = await p.evaluate(() => document.documentElement.lang === 'en');
  report(stops === 8 && langEn, 'widget en: landing renders 8 tour stops in english');

  // resilience: Google Fonts unreachable (offline / CDN down) — pages must stay usable, not blank
  const downCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await downCtx.route('**://fonts.googleapis.com/**', (r) => r.abort());
  await downCtx.route('**://fonts.gstatic.com/**', (r) => r.abort());
  const dp = await downCtx.newPage();
  const downFails = [];
  for (const page of pages) {
    const errs = [];
    // ตัดเสียงรบกวนจากเครือข่าย (Failed to load resource) — สิ่งที่ต้องเป็นศูนย์คือ JS ที่พัง ไม่ใช่ CDN ที่ล่ม
    const onConsole = (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); };
    const onPageError = (e) => errs.push('pageerror: ' + e.message);
    dp.on('console', onConsole);
    dp.on('pageerror', onPageError);
    await dp.goto(`http://127.0.0.1:4919/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
    await dp.waitForTimeout(300);
    const m = await dp.evaluate(() => {
      const h = document.querySelector('h1, h2');
      const faces = [...document.fonts].filter((f) => f.family.includes('Looped')).length;
      return {
        faces,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headingWidth: h ? h.getBoundingClientRect().width : document.body.scrollHeight,
      };
    });
    const downTextLen = await settledTextLen(dp); // { len, settled }
    dp.off('console', onConsole);
    dp.off('pageerror', onPageError);
    if (m.faces !== 0) downFails.push(`${page}: ${m.faces} webfont face(s) still declared — blocking did not take effect, test is meaningless`);
    if (errs.length) downFails.push(`${page}: errors=${errs.length} :: ${errs[0]}`);
    if (m.overflow !== 0) downFails.push(`${page}: overflow=${m.overflow}`);
    const base = gate.textLen[page];
    if (base && base.settled && downTextLen.settled && downTextLen.len !== base.len) downFails.push(`${page}: rendered text changed ${base.len}→${downTextLen.len}`);
    if (m.headingWidth < 20) downFails.push(`${page}: heading collapsed (${Math.round(m.headingWidth)}px)`);
  }
  report(downFails.length === 0, `resilience: all ${pages.length} pages usable with Google Fonts unreachable (no errors, no overflow, text + layout intact)`, downFails.slice(0, 4).join(' ; '));
  await downCtx.close();

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
