// kid-home-hook-budget-truth — components/knowledge/use-kid-home.ts เกินเพดาน 400 ต้องแยกตาม domain (FE-004)
//
// เหตุผล: use-kid-home.ts 554 บรรทัด > เพดาน component 400 — เกิน 154 (ตัวเกินน้อยสุดที่เหลือ)
// วิธีแก้: แยก hook ตาม domain — งานบ้าน+PIN / บิล+กระเป๋าเงิน+ค่าขนม+คูปอง /
//   ถังสะสมแต้ม+เป้าหมาย / หุ้น+โหมดเงิน+พอร์ต+audit — ย้าย verbatim
//   useKidHome คงเป็นจุดเรียกรวมเดิม (export/interface/return key ครบชุดเดิม
//   59 ตัว — ผู้เรียกทุกตัวรวมทั้ง pages/knowledge.tsx ไม่ต้องแก้)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src');
const HOME = path.join(FE, 'components', 'knowledge', 'use-kid-home.ts');
const SUB = {
  chore: 'components/knowledge/use-kid-chore.ts',
  money: 'components/knowledge/use-kid-money.ts',
  piggy: 'components/knowledge/use-kid-piggy.ts',
  invest: 'components/knowledge/use-kid-invest.ts',
};

test('use-kid-home.ts ต้องจัดขนาดลง ≤ 400 บรรทัด (เพดาน components)', () => {
  const n = readFileSync(HOME, 'utf8').split('\n').length;
  assert.ok(n <= 400, `use-kid-home.ts = ${n} บรรทัด > เพดาน 400 — แยก hook ตาม domain`);
});

test('hook ย่อย 4 ไฟล์ต้องมีอยู่ ≤ 400 และครอบ logic ของ domain ตัวเองครบ (ย้ายตามเดิม)', () => {
  for (const rel of Object.values(SUB)) {
    const p = path.join(FE, rel);
    assert.ok(existsSync(p), `${rel} ยังไม่มี`);
    const n = readFileSync(p, 'utf8').split('\n').length;
    assert.ok(n <= 400, `${rel} = ${n} บรรทัด > เพดาน 400`);
  }
  const chore = readFileSync(path.join(FE, SUB.chore), 'utf8');
  for (const fn of ['loadKidHome', 'addChoreUI', 'completeChoreUI', 'reopenChoreUI', 'deleteChoreUI', 'promptKidPin', 'setPinUI']) {
    assert.match(chore, new RegExp(`\\b${fn}\\b`), `${SUB.chore} ต้องมี ${fn}`);
  }
  const money = readFileSync(path.join(FE, SUB.money), 'utf8');
  for (const fn of ['addBillUI', 'payBillUI', 'deleteBillUI', 'adjustWalletUI', 'setAllowanceUI', 'addCouponUI', 'redeemCouponUI', 'deleteCouponUI']) {
    assert.match(money, new RegExp(`\\b${fn}\\b`), `${SUB.money} ต้องมี ${fn}`);
  }
  const piggy = readFileSync(path.join(FE, SUB.piggy), 'utf8');
  for (const fn of ['setSavingsGoalUI', 'piggyTransferUI', 'setPiggyTargetUI']) {
    assert.match(piggy, new RegExp(`\\b${fn}\\b`), `${SUB.piggy} ต้องมี ${fn}`);
  }
  const invest = readFileSync(path.join(FE, SUB.invest), 'utf8');
  for (const fn of ['loadStocks', 'buyStockUI', 'sellStockUI', 'setMoneyModeUI', 'setInvestPolicyUI', 'addDepositUI', 'setTargetUI', 'loadAudit']) {
    assert.match(invest, new RegExp(`\\b${fn}\\b`), `${SUB.invest} ต้องมี ${fn}`);
  }
});

test('orchestrator ห้ามมี logic domain ค้าง — endpoint ของเด็กเหลือแค่ /home เท่านั้น', () => {
  const src = readFileSync(HOME, 'utf8');
  assert.match(src, /export function useKidHome/, 'ต้องคง export useKidHome เดิม');
  for (const ep of ['chores', 'bills', 'coupons', 'stocks', 'piggy', 'audit', 'wallet', 'allowance', 'savings', 'pin']) {
    assert.doesNotMatch(src, new RegExp(`teach/kids/\\$\\{activeKidId\\}/${ep}`), `endpoint ${ep} ยังค้างใน orchestrator — ต้องอยู่ใน hook ย่อย`);
  }
  for (const rel of Object.values(SUB)) {
    const name = rel.replace('.ts', '').split('/').pop();
    assert.match(src, new RegExp(`\\b${name}\\b`), `orchestrator ต้องเรียก ${name}`);
  }
});

test('orchestrator ต้องคืน key ครบชุดเดิม 59 ตัว (ผู้เรียก destructure ชื่อเดิม = props/panel ไม่เปลี่ยน)', () => {
  const src = readFileSync(HOME, 'utf8');
  const i = src.lastIndexOf('return {');
  assert.ok(i >= 0, 'orchestrator ต้องมี return คืนค่าท้ายฟังก์ชัน');
  const ret = src.slice(i);
  const KEYS = [
    'kidHome', 'setKidHome', 'homeLoading', 'loadKidHome',
    'choreForm', 'setChoreForm', 'choreRepeat', 'setChoreRepeat', 'addChoreUI', 'completeChoreUI', 'reopenChoreUI', 'deleteChoreUI',
    'billForm', 'setBillForm', 'addBillUI', 'payBillUI', 'deleteBillUI',
    'allowanceForm', 'setAllowanceForm', 'setAllowanceUI',
    'piggyForm', 'setPiggyForm', 'piggyTransferUI', 'goalForm', 'setGoalForm', 'setSavingsGoalUI',
    'targetForm', 'setTargetForm', 'setPiggyTargetUI',
    'pinForm', 'setPinForm', 'setPinUI',
    'stocks', 'stockForm', 'setStockForm', 'buyStockUI', 'sellStockUI',
    'targetPctForm', 'setTargetPctForm', 'setTargetUI', 'depositForm', 'setDepositForm', 'addDepositUI',
    'audit', 'auditLoading',
    'couponForm', 'setCouponForm', 'addCouponUI', 'redeemCouponUI', 'deleteCouponUI',
    'walletAmount', 'setWalletAmount', 'walletNote', 'setWalletNote', 'adjustWalletUI',
    'policyText', 'setPolicyText', 'setMoneyModeUI', 'setInvestPolicyUI',
  ];
  assert.equal(KEYS.length, 59, 'รายการ keys ต้องเท่าของเดิมเป๊ะ');
  for (const k of KEYS) {
    assert.match(ret, new RegExp(`\\b${k}\\b`), `orchestrator ต้องคืน ${k}`);
  }
});
