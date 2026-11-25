#!/usr/bin/env node
/* build-seal-en — สร้าง portfolio/seal-en.html จาก portfolio/seal.html
 *
 * ทำไมต้องสร้างจากไฟล์ไทย ไม่ใช่เขียนแยก: ตรึงให้ "โค้ดเข้ารหัส" เหมือนกันทุกไบต์
 * (canonical JSON, การเลือกอัลกอริทึม, การจับคู่ไฟล์) — ถ้าเขียนแยก มีโอกาสที่
 * หน้าอังกฤษจะเซ็นด้วยกติกาคนละชุดแล้วตรวจกันไม่ผ่าน
 *
 * ทุกการแทนที่ต้องเจอ "พอดี 1 ครั้ง" ไม่งั้นสคริปต์หยุด (exit 1) — กันข้อความ
 * ไทยหลุดไปหน้าอังกฤษเงียบ ๆ เมื่อมีคนแก้ต้นฉบับ
 *
 * ใช้: node scripts/build-seal-en.mjs [--check]
 *   --check  = ตรวจว่าผลที่ได้ตรงกับไฟล์ที่ commit อยู่ (ไม่เขียนทับ) สำหรับ CI
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const SRC = path.join(SITE, 'seal.html');
const OUT = path.join(SITE, 'seal-en.html');
const CHECK = process.argv.includes('--check');

/* [ไทยในต้นฉบับ, อังกฤษที่จะใช้] — เรียงตามที่ปรากฏในไฟล์ */
const MAP = [
  // ── head ──
  ['<html lang="th">', '<html lang="en">'],
  ['<title>ตราประทับไฟล์ — Sovereign Seal (ฟรี ออฟไลน์)</title>',
    '<title>File seal — Sovereign Seal (free, offline)</title>'],
  ['content="เซ็นและตรวจไฟล์แบบออฟไลน์: ลากไฟล์ใดก็ได้ ได้ลายนิ้วมือ SHA-256 และตราที่เซ็นด้วย Ed25519 แล้วใครก็ตรวจได้ว่าไฟล์ถูกแก้หรือไม่ โดยไม่ต้องมีบัญชี ไม่ต้องต่อเน็ต ไม่มีเซิร์ฟเวอร์"',
    'content="Seal and verify files offline: drop any file, get its SHA-256 plus a signed seal, and anyone can check whether it was altered — no account, no network, no server"'],
  ['content="พิสูจน์ว่าไฟล์ไม่ถูกแก้ ใครก็ตรวจได้แบบออฟไลน์ ฟรี ไม่มีบัญชี ไม่มีเซิร์ฟเวอร์"',
    'content="Prove a file was not altered. Anyone can verify it offline. Free, no account, no server."'],
  ['content="กฤษกรณ์ อุตมะ (Krisakorn Utama)"', 'content="Krisakorn Utama"'],
  ['content="Sovereign Seal — ตราประทับไฟล์"', 'content="Sovereign Seal — file seal"'],

  // ── nav ──
  ['    <a href="index.html">หน้าแรก</a>\n    <a href="buy.html">ระบบหลังบ้าน</a>\n    <a href="support.html">สนับสนุน</a>\n    <a href="seal-en.html" hreflang="en" lang="en">EN</a>\n    <a class="dl" href="seal.html" download="sovereign-seal.html">ดาวน์โหลดหน้านี้</a>',
    '    <a href="en.html">Home</a>\n    <a href="buy-intl.html">Back-office suite</a>\n    <a href="support-en.html">Support</a>\n    <a href="seal.html" hreflang="th" lang="th">ไทย</a>\n    <a class="dl" href="seal-en.html" download="sovereign-seal.html">Download this page</a>'],

  // ── hero ──
  ['<p class="eyebrow">ฟรี · ไม่ต้องติดตั้ง · ไม่มีบัญชี</p>', '<p class="eyebrow">Free · No install · No account</p>'],
  ['<h1>ตราประทับไฟล์</h1>', '<h1>File seal</h1>'],
  ['<p class="lede">ใครก็แก้ไฟล์คุณได้ แต่แก้ไม่ได้โดยที่คุณไม่รู้ — ลากไฟล์ใดก็ได้\n    (รูป วิดีโอ เอกสาร ใบเสร็จ ไฟล์สำรอง ตัวติดตั้ง) เพื่อรับลายนิ้วมือ\n    <b>SHA-256</b> และตราที่เซ็นด้วยลายเซ็นดิจิทัล แล้วส่งไฟล์กับตราให้ใครก็ได้\n    เขาตรวจเองได้ว่ามันเป็นไบต์เดียวกันกับตอนคุณเซ็น หรือถูกแก้ระหว่างทาง</p>',
    '<p class="lede">Anyone can change a file you sent — but they cannot do it without you finding out.\n    Drop any file (a photo, a video, a PDF, a receipt, a backup, an installer) to get its\n    <b>SHA-256</b> and a digitally signed seal. Send the file with the seal, and whoever\n    receives it can check that these are the exact bytes you signed, unchanged.</p>'],
  ['<p class="badge"><i></i> ไม่มีการส่งไฟล์ออกจากเครื่องนี้ — ไม่มีเน็ตก็ใช้ได้</p>',
    '<p class="badge"><i></i> Nothing is uploaded from this machine — it works with no network</p>'],
  ['<p class="hint">รุ่นล่าสุด <b>1.0.0</b> ·\n    <a href="https://github.com/krisakornutama/sovereign-origin/releases/tag/seal-v1.0.0">ดาวน์โหลดไฟล์และดูจำนวนดาวน์โหลด</a>\n    · ชุดดาวน์โหลดถูกเซ็นด้วยเครื่องมือนี้เอง กุญแจผู้เซ็น <b>b0ae40d0e74ea8a70f4d74887d3213d5</b></p>',
    '<p class="hint">Latest release <b>1.0.0</b> ·\n    <a href="https://github.com/krisakornutama/sovereign-origin/releases/tag/seal-v1.0.0">download the files and see download counts</a>\n    · the download set is signed by this very tool; signer key <b>b0ae40d0e74ea8a70f4d74887d3213d5</b></p>'],

  // ── tabs ──
  ['aria-controls="panelSign">เซ็นไฟล์</button>', 'aria-controls="panelSign">Seal a file</button>'],
  ['aria-controls="panelVerify">ตรวจตรา</button>', 'aria-controls="panelVerify">Verify a seal</button>'],

  // ── key card ──
  ['<h2>กุญแจผู้เซ็น</h2>', '<h2>Your signing key</h2>'],
  ['<p class="hint">กุญแจถูกสร้างในเบราว์เซอร์นี้และเก็บไว้ในเครื่องคุณเท่านั้น\n        ไม่มีใครเห็น ไม่มีเซิร์ฟเวอร์ใดได้รับ</p>',
    '<p class="hint">The key is generated inside this browser and stays on your machine.\n        Nobody sees it; no server receives it.</p>'],
  ['<p class="fp" id="fp">ยังไม่มีกุญแจ</p>', '<p class="fp" id="fp">No key yet</p>'],
  ['<button class="primary" id="btnGen">สร้างกุญแจใหม่</button>', '<button class="primary" id="btnGen">Create a key</button>'],
  ['<button id="btnExport">ดาวน์โหลดกุญแจ (สำรอง)</button>', '<button id="btnExport">Download key (backup)</button>'],
  ['<label class="btn" for="importKey">นำเข้ากุญแจเดิม</label>', '<label class="btn" for="importKey">Import existing key</label>'],
  ['<button class="danger" id="btnForget">ลบกุญแจในเครื่องนี้</button>', '<button class="danger" id="btnForget">Delete the key on this machine</button>'],
  ['<p class="warn" id="keyWarn" hidden>กุญแจหายแล้วเซ็นแทนของเดิมไม่ได้ — ดาวน์โหลดเก็บไว้จะปลอดภัยกว่า</p>',
    '<p class="warn" id="keyWarn" hidden>If the key is lost you cannot sign as the same identity again — keep a downloaded backup</p>'],

  // ── sign card ──
  ['<h2>ไฟล์ที่จะเซ็น</h2>', '<h2>Files to seal</h2>'],
  ['<strong>ลากไฟล์มาวางตรงนี้</strong>', '<strong>Drop files here</strong>'],
  ['<small>หรือคลิกเพื่อเลือกไฟล์ (เลือกได้หลายไฟล์ ตราเดียวเก็บเป็นรายการ)</small>',
    '<small>or click to choose files — several files can share one seal</small>'],
  ['<button class="primary" id="btnSign" disabled>เซ็นและดาวน์โหลดตรา</button>', '<button class="primary" id="btnSign" disabled>Seal and download</button>'],
  ['<button id="btnClearSign">ล้างรายการ</button>', '<button id="btnClearSign">Clear list</button>'],

  // ── verify card ──
  ['<h2>ตรวจว่าไฟล์ถูกแก้หรือไม่</h2>', '<h2>Check whether a file was altered</h2>'],
  ['<p class="hint">ลากไฟล์ที่ได้มา และไฟล์ตรา (ชื่อลงท้ายด้วย .seal.json) มาวางพร้อมกันในช่องเดียว\n        รายชื่อไฟล์ในตราจะถูกจับคู่ให้เอง</p>',
    '<p class="hint">Drop the files you received and the seal file (its name ends with .seal.json)\n        into the same box; names inside the seal are matched for you.</p>'],
  ['<strong>ลากไฟล์ + ไฟล์ตรา มาวางตรงนี้</strong>', '<strong>Drop the files and the seal here</strong>'],
  ['<small>หรือคลิกเพื่อเลือกทั้งสองอย่างพร้อมกัน</small>', '<small>or click to choose both at once</small>'],
  ['<button id="btnClearVerify">ล้างผลตรวจ</button>', '<button id="btnClearVerify">Clear results</button>'],

  // ── limits ──
  ['<b>อ่านตรงนี้ก่อนใช้ตัดสินใจอะไรสำคัญ</b>', '<b>Read this before you rely on a seal for anything that matters</b>'],
  ['<li>ตราบอกได้แค่ว่า <b>ไบต์ไม่เปลี่ยน</b> และ <b>กุญแจใดเป็นคนเซ็น</b> — ไม่ได้บอกว่าเนื้อหาจริง โกหก หรือถูกต้องตามกฎหมาย</li>',
    '<li>A seal only says the <b>bytes did not change</b> and <b>which key signed them</b> — it says nothing about whether the content is true, honest or lawful</li>'],
  ['<li>เวลาในตราเป็นเวลาที่ผู้เซ็นอ้างเอง ไม่มีหน่วยงานกลางรับรองเวลา</li>',
    '<li>The time inside a seal is the signer\'s own claim; no authority attests it</li>'],
  ['<li>จะเชื่อว่า "ใครคนนั้นเซ็น" ต้องเทียบลายนิ้วมือกุญแจกับช่องทางที่คุณรู้จักอยู่แล้ว (เช่น หน้าเว็บหลักของเขา) ไม่ใช่เชื่อเพราะไฟล์บอก</li>',
    '<li>To believe a specific person signed it, compare the key fingerprint with a channel you already trust (their main site, their signed email) — not because the file says so</li>'],
  ['<li>กุญแจอยู่ในเบราว์เซอร์นี้เท่านั้น ล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่องแล้วต้องนำเข้ากุญแจที่สำรองไว้</li>',
    '<li>The key lives only in this browser; clearing site data or switching machines means importing your backup</li>'],

  // ── footer ──
  ['<p>ทำโดย กฤษกรณ์ อุตมะ · ฟรีถาวร ไม่มี paywall ·\n    <a href="support.html">สนับสนุนได้ที่นี่</a> ·\n    <a href="seal-cli.mjs" download>โหลดเวอร์ชันบรรทัดคำสั่ง</a></p>',
    '<p>Made by Krisakorn Utama · free forever, no paywall ·\n    <a href="support-en.html">Support this work</a> ·\n    <a href="seal-cli.mjs" download>Download the command-line version</a></p>'],

  // ── JS: strings the user sees ──
  ["if (n < 1024) return n + ' ไบต์';", "if (n < 1024) return n + ' bytes';"],
  ["$('fp').textContent = 'ยังไม่มีกุญแจ — กดสร้างกุญแจใหม่ก่อนเซ็น';", "$('fp').textContent = 'No key yet — create one before signing';"],
  ["$('fp').textContent = 'ลายนิ้วมือกุญแจ ' + fp;", "$('fp').textContent = 'Key fingerprint ' + fp;"],
  ["x.textContent = 'เอาออก';", "x.textContent = 'Remove';"],
  ["? 'พร้อมเซ็น ' + signFiles.length + ' ไฟล์'", "? 'Ready to seal ' + signFiles.length + ' file(s)'"],
  ["$('signState').textContent = 'สร้างกุญแจไม่ได้: ' + err.message;", "$('signState').textContent = 'Could not create a key: ' + err.message;"],
  ["if (!keyJwk) { $('signState').textContent = 'ยังไม่มีกุญแจให้ดาวน์โหลด'; return; }", "if (!keyJwk) { $('signState').textContent = 'No key to download yet'; return; }"],
  ["throw new Error('ไฟล์นี้ไม่ใช่กุญแจที่ใช้ได้');", "throw new Error('This file is not a usable key');"],
  ["$('signState').textContent = 'นำเข้ากุญแจแล้ว: ' + f.name;", "$('signState').textContent = 'Key imported: ' + f.name;"],
  ["$('signState').textContent = 'นำเข้าไม่ได้: ' + err.message;", "$('signState').textContent = 'Import failed: ' + err.message;"],
  ["$('signState').textContent = 'ลบกุญแจออกจากเครื่องนี้แล้ว';", "$('signState').textContent = 'Key deleted from this machine';"],
  ["$('signState').textContent = 'กำลังคำนวณลายนิ้วมือและเซ็น…';", "$('signState').textContent = 'Hashing and signing…';"],
  ["$('signState').textContent = 'เซ็นแล้ว: ' + name + ' · ผู้เซ็น ' + (await fingerprint(seal.publicKey));", "$('signState').textContent = 'Sealed: ' + name + ' · signer ' + (await fingerprint(seal.publicKey));"],
  ["$('signState').textContent = 'เซ็นไม่สำเร็จ: ' + err.message;", "$('signState').textContent = 'Signing failed: ' + err.message;"],
  ["h.textContent = (ok ? 'ผ่าน · ' : 'ไม่ผ่าน · ') + title;", "h.textContent = (ok ? 'PASS · ' : 'FAIL · ') + title;"],
  ["out.appendChild(resultBox(false, 'ยังไม่มีไฟล์ตรา', ['แนบไฟล์ที่ลงท้ายด้วย .seal.json มาด้วย']));", "out.appendChild(resultBox(false, 'No seal file', ['Attach the file whose name ends with .seal.json']));"],
  ["throw new Error('โครงสร้างไฟล์ตราไม่ถูกต้อง');", "throw new Error('This is not a valid seal file');"],
  ["out.appendChild(resultBox(false, 'อ่านไฟล์ตราไม่ได้', [err.message]));", "out.appendChild(resultBox(false, 'Could not read the seal', [err.message]));"],
  ["out.appendChild(resultBox(false, 'ตรวจลายเซ็นไม่ได้', [err.message]));", "out.appendChild(resultBox(false, 'Could not check the signature', [err.message]));"],
  ["out.appendChild(resultBox(false, 'ลายเซ็นไม่ถูกต้อง', [\n        'ไฟล์ตราถูกแก้ หรือกุญแจที่ใช้ตรวจไม่ใช่กุญแจที่เซ็น',\n        'ผู้เซ็นที่ตราอ้าง: ' + fp",
    "out.appendChild(resultBox(false, 'Signature is not valid', [\n        'The seal was edited, or the key used to check it is not the signing key',\n        'Signer claimed by the seal: ' + fp"],
  ["same ? 'ไบต์ตรงกับตอนเซ็นทุกไบต์' : 'ไบต์ไม่ตรง — ไฟล์ถูกแก้หลังเซ็น หรือคนละไฟล์',", "same ? 'Every byte matches what was signed' : 'Bytes differ — altered after signing, or a different file',"],
  ["'ตอนเซ็น: ' + it.sha256,", "'when signed: ' + it.sha256,"],
  ["'ตอนนี้: ' + digest", "'now: ' + digest"],
  ["out.appendChild(resultBox(false, 'ไม่มีไฟล์เหล่านี้ให้ตรวจ', missing));", "out.appendChild(resultBox(false, 'These files were not provided', missing));"],
  ["head.textContent = 'เซ็นเมื่อ ' + seal.body.at + ' · ผู้เซ็น ' + fp +\n      ' · ตรวจลายเซ็นแล้วผ่าน (จะเชื่อว่าเป็นของใคร ต้องเทียบลายนิ้วมือกับช่องทางที่คุณรู้จัก)';",
    "head.textContent = 'Signed at ' + seal.body.at + ' · signer ' + fp +\n      ' · signature verified (to believe it is a particular person, compare the fingerprint with a channel you trust)';"],
  ["$('signState').textContent = 'เบราว์เซอร์นี้ไม่มี crypto.subtle — ต้องเปิดผ่านที่อยู่ http หรือ https (หรือใช้เวอร์ชันบรรทัดคำสั่ง)';",
    "$('signState').textContent = 'This browser has no crypto.subtle — open the page over http or https, or use the command-line version';"],
  ["? 'อัลกอริทึมในเบราว์เซอร์นี้: Ed25519'", "? 'Algorithm in this browser: Ed25519'"],
  [": 'เบราว์เซอร์นี้ไม่รองรับ Ed25519 — ใช้ ECDSA P-256 แทน (ตรวจได้ด้วยเครื่องมือเดียวกัน) — ลายเซ็นยังใช้ได้เต็มที่';",
    ": 'This browser lacks Ed25519 — using ECDSA P-256 instead (checked by the same tool); the signature is just as valid';"],
  ["$('algNote').textContent = 'กุญแจที่มีอยู่เป็น ' + keyAlg(keyJwk) +\n        ' — ใช้ได้ แต่เซ็นด้วยกุญแจนี้จะได้ ' + keyAlg(keyJwk);",
    "$('algNote').textContent = 'Your existing key is ' + keyAlg(keyJwk) +\n        ' — usable, and signing with it produces ' + keyAlg(keyJwk);"],
];

let html = fs.readFileSync(SRC, 'utf8');

const missed = [];
for (const [from, to] of MAP) {
  const n = html.split(from).length - 1;
  if (n !== 1) { missed.push(`${n}× ${from.slice(0, 70).replace(/\n/g, '⏎')}`); continue; }
  html = html.split(from).join(to);
}
if (missed.length) {
  console.error('✗ แผนที่การแปลไม่ตรงกับต้นฉบับ — แก้ MAP ให้ตรงก่อน:');
  for (const m of missed) console.error('   ' + m);
  process.exit(1);
}

/* นับอักษรไทยที่หลุด — ตัดคอมเมนต์ (เก็บไว้ให้คนดูแลอ่านได้) และสองจุดที่ตั้งใจให้มีไทย:
   seed span สำหรับโหลดฟอนต์ กับลิงก์สลับภาษา */
const visible = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, '')
  .replace(/<a href="seal\.html"[^>]*>[^<]*<\/a>/g, '');
const leftover = (visible.match(/[\u0E00-\u0E7F]/g) || []).length;

/* ฟอนต์ไทยโหลดเฉพาะเมื่อมีข้อความไทยจริง — หน้าอังกฤษไม่มี ต้องมีตัวกระตุ้นเล็ก ๆ
   (แบบเดียวกับ support.html) ไม่งั้นด่านฟอนต์ของ audit จะจับว่าถอยไปใช้ฟอนต์สำรอง */
/* ต้องแยก Span ต่อตระกูล: ถ้าใล่ทั้งสองใน stack เดียว เบราว์เซอร์จะโหลดแค่ตัวแรก */
const SEED = '<!-- the Thai faces only download when Thai text uses them; these off-screen lines keep both loaded -->\n' +
  '<span aria-hidden="true" style="position:absolute;left:-9999px;top:0;white-space:nowrap;font-family:\'IBM Plex Sans Thai Looped\'">ฎ ฏ ฐ ฒ ณ ต</span>\n' +
  '<span aria-hidden="true" style="position:absolute;left:-9999px;top:0;white-space:nowrap;font-family:\'Noto Sans Thai Looped\'">ฎ ฏ ฐ ฒ ณ ต</span>\n';
html = html.replace('<body>\n', '<body>\n' + SEED, 1);

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== html) { console.error('✗ seal-en.html ไม่ตรงกับที่สร้างจาก seal.html — รัน `node scripts/build-seal-en.mjs`'); process.exit(1); }
  console.log('PASS seal-en.html is up to date');
  process.exit(0);
}

fs.writeFileSync(OUT, html);
console.log(`เขียน ${path.relative(process.cwd(), OUT)} (${html.length} ไบต์, อักษรไทยคงเหลือ ${leftover} ตัว — ต้องเป็น 0)`);
if (leftover !== 0) { console.error('✗ ยังมีข้อความไทยในหน้าอังกฤษ — เติม MAP แล้วรันใหม่'); process.exit(1); }
