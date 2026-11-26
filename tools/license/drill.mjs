#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/license/drill.mjs — ซ้อม "ปิดการขายหนึ่งครั้ง" ให้จบในคำสั่งเดียว
//
// ที่มา: หน้า pay.html สัญญาว่า "ได้ไฟล์และไลเซนส์ภายใน 24 ชั่วโมง"
// แต่ยังไม่เคยมีใครพิสูจน์ว่าคำสั่งออกไลเซนส์ใช้งานได้จริงบนเครื่องนี้
// ⇒ ซ้อมก่อนมีออเดอร์จริง ไม่ใช่ซ้อมตอนลูกค้ารออยู่
//
// สิ่งที่พิสูจน์ (ทุกข้อต้องผ่าน ไม่งั้น exit 1):
//   1) มีคู่กุญแจ (สร้างให้ถ้ายังไม่มี)
//   2) `sell.mjs` ออกใบ + ตรวจซ้ำ + เขียน `delivery.md` + ledger ได้ (โฟลเดอร์ซ้อม ไม่แตะ ledger จริง)
//   3) ใบที่เพิ่งออกตรวจผ่านด้วยพับลิกคีย์
//   4) แก้ไบต์ในใบ 1 ตัว → ต้องตรวจไม่ผ่าน (fail-closed)
//   5) `delivery.md` มีลายนิ้วมือตรงกับพับลิกคีย์ที่ประกาศ
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PRIVATE_KEY_PATH, PUBLIC_KEY_PATH, ROOT, fingerprintOfPublicPem } from './keygen.mjs';

const ISSUE = path.join(ROOT, 'tools', 'license', 'issue.mjs');
const SELL = path.join(ROOT, 'tools', 'license', 'sell.mjs');
const KEYGEN = path.join(ROOT, 'tools', 'license', 'keygen.mjs');

const ORDER = 'DRILL-LOCAL';
const OUTDIR = path.join('sales', '_drill', ORDER);
const LEDGER = path.join('sales', '_drill', 'ledger.jsonl');
const TOKEN = path.join(ROOT, OUTDIR, 'license.txt');
const DELIVERY = path.join(ROOT, OUTDIR, 'delivery.md');

let failures = 0;
function check(ok, message, detail = '') {
  process.stdout.write(`${ok ? '✓' : '✗'} ${message}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures += 1;
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

// ── 1) กุญแจ ─────────────────────────────────────────────────────────────────
const keygen = run(KEYGEN, []);
if (keygen.status !== 0) {
  process.stderr.write(`✗ สร้าง/อ่านคู่กุญแจไม่ได้:\n${keygen.stderr || keygen.stdout}\n`);
  process.exit(1);
}
check(existsSync(PRIVATE_KEY_PATH), 'มีไพรเวตคีย์ (นอก repo)');
check(existsSync(PUBLIC_KEY_PATH), 'มีพับลิกคีย์บนเว็บ', 'portfolio/license-pub.txt');
const fingerprint = fingerprintOfPublicPem(readFileSync(PUBLIC_KEY_PATH, 'utf8'));

// ── 2) ออกใบจริงผ่าน sell.mjs (โฟลเดอร์ซ้อม) ─────────────────────────────────
const sold = run(SELL, [
  '--key',
  PRIVATE_KEY_PATH,
  '--public-key',
  PUBLIC_KEY_PATH,
  '--licensee',
  'Drill Buyer',
  '--tier',
  'home',
  '--perpetual',
  '--amount',
  '2140',
  '--sku',
  'SW-HOME',
  '--order',
  ORDER,
  '--outdir',
  OUTDIR,
  '--ledger',
  LEDGER,
  '--paid',
]);
check(sold.status === 0, 'sell.mjs ปิดการขายได้ (exit 0)', sold.status === 0 ? '' : (sold.stderr || '').trim().split('\n')[0]);
if (sold.status !== 0) process.exit(1);

check(existsSync(TOKEN), 'ได้ไฟล์ license.txt');
check(existsSync(DELIVERY), 'ได้ชุดส่งลูกค้า delivery.md');

// ── 3) ใบที่เพิ่งออกต้องตรวจผ่าน ─────────────────────────────────────────────
const verified = run(ISSUE, ['verify', '--token', `@${TOKEN}`, '--public-key', PUBLIC_KEY_PATH]);
check(verified.status === 0, 'ตรวจใบที่เพิ่งออกด้วยพับลิกคีย์: ผ่าน (exit 0)');

// ── 4) แก้ 1 ตัวอักษรในใบ → ต้องไม่ผ่าน ──────────────────────────────────────
const token = readFileSync(TOKEN, 'utf8').trim();
const last = token.slice(-1);
// เลือกตัวอักษร base64 อีกตัว เพื่อให้ยัง parse ได้ แต่ลายเซ็นผิด
const tamperedChar = last === 'A' ? 'B' : 'A';
const tamperedPath = path.join(ROOT, OUTDIR, 'license.tampered.txt');
writeFileSync(tamperedPath, `${token.slice(0, -1)}${tamperedChar}\n`, 'utf8');
const tampered = run(ISSUE, ['verify', '--token', `@${tamperedPath}`, '--public-key', PUBLIC_KEY_PATH]);
check(tampered.status !== 0, 'ใบที่ถูกแก้ 1 ตัวอักษรถูกปฏิเสธ (fail-closed)');

// ── 5) ชุดส่งลูกค้าต้องประกาศลายนิ้วมือตรง ───────────────────────────────────
const delivery = readFileSync(DELIVERY, 'utf8');
const publicPemBlock = readFileSync(PUBLIC_KEY_PATH, 'utf8').trim();
check(delivery.includes('BEGIN PUBLIC KEY'), 'delivery.md แนบพับลิกคีย์จริง');
check(delivery.includes(publicPemBlock.split('\n')[1] ?? '៚'), 'พับลิกคีย์ในชุดส่งตรงกับไฟล์ที่ประกาศ');

process.stdout.write(
  [
    '',
    `ลายนิ้วมือกุญแจไลเซนส์: ${fingerprint}`,
    `โฟลเดอร์ซ้อม: ${OUTDIR.split(path.sep).join('/')} (ไม่แตะ sales/ledger.jsonl จริง)`,
    failures === 0 ? '✓ ซ้อมผ่านทุกข้อ — พร้อมรับออเดอร์จริง' : `✗ ไม่ผ่าน ${failures} ข้อ`,
    '',
  ].join('\n')
);
process.exit(failures === 0 ? 0 : 1);
