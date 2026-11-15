// kid-home-panel-split-truth — KidHomePanel.tsx เกินเพดาน component 400 ต้องแยกการ์ดย่อย (FE-006)
//
// เหตุผล: components/knowledge/KidHomePanel.tsx 765 บรรทัด > เพดาน component 400 — เกิน 365
// วิธีแก้: แยกส่วน JSX ตามโซนเป็น component ย่อยใน components/knowledge/kid-home/ แบบ verbatim
//   (งานบ้าน+บิล+ค่าขนม / ถัง+PIN / หุ้น+พอร์ต / ประวัติ+คูปอง+กระเป๋า) — props เดิมทุกชื่อ
//   KidHomePanel คงเป็น shell + interface KidHomePanelProps เดิม (หน้า knowledge.tsx ไม่ต้องแก้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'knowledge');
const PANEL = path.join(FE, 'KidHomePanel.tsx');
const KID_DIR = path.join(FE, 'kid-home');

const CHORES = path.join(KID_DIR, 'KidHomeChoresBills.tsx');
const PIGGY = path.join(KID_DIR, 'KidHomePiggyPin.tsx');
const STOCKS = path.join(KID_DIR, 'KidHomeStocks.tsx');
const HISTORY = path.join(KID_DIR, 'KidHomeHistoryCouponsWallet.tsx');

const SECTIONS = [
  [CHORES, ['knowledge.home.choresTitle', 'knowledge.home.billsTitle', 'knowledge.home.allowanceTitle']],
  [PIGGY, ['knowledge.home.piggyTitle', 'knowledge.home.pinTitle']],
  [STOCKS, ['knowledge.home.stocksTitle', 'PortfolioHistoryChart']],
  [HISTORY, ['knowledge.home.auditTitle', 'knowledge.home.couponsTitle', 'knowledge.home.walletTitle']],
];

test('KidHomePanel.tsx ต้องจัดขนาดลง ≤ 400 บรรทัด (เพดาน components)', () => {
  const n = readFileSync(PANEL, 'utf8').split('\n').length;
  assert.ok(n <= 400, `KidHomePanel.tsx = ${n} บรรทัด > เพดาน 400 — แยกการ์ดย่อยตาม FE-006`);
});

test('component ย่อย 4 ไฟล์ต้องมีอยู่ ≤ 400 และถือเนื้อหาโซนเดิมครบ', () => {
  for (const [file, keys] of SECTIONS) {
    assert.ok(existsSync(file), `${path.relative(ROOT, file)} ยังไม่มี`);
    const src = readFileSync(file, 'utf8');
    const n = src.split('\n').length;
    assert.ok(n <= 400, `${path.basename(file)} = ${n} บรรทัด > เพดาน 400`);
    for (const k of keys) assert.ok(src.includes(k), `${path.basename(file)} ต้องมี ${k}`);
  }
});

test('หน้า shell ต้องไม่เหลือเนื้อหาโซนที่ย้ายแล้ว (กัน copy ซ้ำ)', () => {
  const src = readFileSync(PANEL, 'utf8');
  for (const anchor of [
    "t('knowledge.home.choresTitle'",
    "t('knowledge.home.billsTitle'",
    "t('knowledge.home.allowanceTitle'",
    "t('knowledge.home.piggyTitle'",
    "t('knowledge.home.pinTitle'",
    "t('knowledge.home.stocksTitle'",
    "t('knowledge.home.auditTitle'",
    "t('knowledge.home.couponsTitle'",
    "t('knowledge.home.walletTitle'",
  ]) {
    assert.ok(!src.includes(anchor), `"${anchor}" ยังค้างใน KidHomePanel — ต้องอยู่ใน component ย่อย`);
  }
});

test('shell ต้องคง interface เดิมครบ + เรียก component ย่อยทั้ง 4', () => {
  const src = readFileSync(PANEL, 'utf8');
  assert.match(src, /interface KidHomePanelProps/, 'ต้องคง interface KidHomePanelProps (props หน้า knowledge.tsx ไม่เปลี่ยน)');
  for (const p of ['kidHome:', 'setShowKidHome:', 'redeemCouponUI:', 'adjustWalletUI:', 'setPinUI:', 'setSavingsGoalUI:']) {
    assert.ok(src.includes(p), `interface ต้องยังมี ${p}`);
  }
  for (const fn of ['KidHomeChoresBills', 'KidHomePiggyPin', 'KidHomeStocks', 'KidHomeHistoryCouponsWallet']) {
    assert.match(src, new RegExp(`\\b${fn}\\b`), `shell ต้องเรียก ${fn}`);
  }
  assert.match(src, /export default function KidHomePanel/, 'ต้องคง default export ชื่อเดิม');
});
