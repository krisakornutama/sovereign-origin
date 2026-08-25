// tests/portfolio-signal.test.ts
// AI Portfolio Manager — pure signal engine tests (ไม่แตะ DB/เน็ต)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateTrigger, formatPortfolioAlert,
  DEFAULT_TRIGGERS, type PortfolioTriggerDef, type TickerState,
} from '../src/services/portfolio-signal.service.ts';

const aspi = DEFAULT_TRIGGERS.find((t) => t.symbol === 'ASPI')!;
const rdw = DEFAULT_TRIGGERS.find((t) => t.symbol === 'RDW')!;
const emptyState: TickerState = { peakPrice: null, trailingArmed: false, l1Done: false, l2Done: false };

describe('Portfolio Signal Engine', () => {
  it('BUY_DIP: ASPI ราคา $3.80 เข้าโซน $3.50-4.00 → สัญญาณซื้อ', () => {
    const { signal } = evaluateTrigger(aspi, 3.80, { ...emptyState });
    assert.equal(signal.action, 'BUY_DIP');
    assert.equal(signal.alert, true);
    assert.ok(signal.message.includes('BUY DIP'));
    assert.ok(signal.message.includes('ASPI'));
    // ราคาบาท = 3.80 × 35 = 133
    assert.equal(signal.priceTHB, 133);
  });

  it('SELL_L1: ASPI แตะ $7.00 (โซน 6.50-8.00) → ขาย 25% ครั้งเดียว', () => {
    const first = evaluateTrigger(aspi, 7.00, { ...emptyState });
    assert.equal(first.signal.action, 'SELL_L1');
    assert.ok(first.signal.message.includes('25%'));
    assert.equal(first.nextState.l1Done, true);
    // ครั้งที่สองราคายังอยู่โซนเดิม → ไม่ส่งซ้ำ (l1Done แล้ว)
    const second = evaluateTrigger(aspi, 7.20, first.nextState);
    assert.notEqual(second.signal.action, 'SELL_L1');
  });

  it('Rule 2 TRAILING_STOP: พุ่ง +50% แล้วร่วงเกิน 20% จาก peak → ล็อกกำไร', () => {
    // ซื้อโซน 4.00 (costRef) → peak ต้อง ≥ 6.00 ถึง arm
    let st: TickerState = { ...emptyState };
    st = evaluateTrigger(aspi, 6.50, st).nextState; // peak=6.50, บวก 62.5% → armed
    assert.equal(st.trailingArmed, true);
    // ร่วงเหลือ 5.10 = peak×0.784 (หลุด -20% จาก 6.50 → stop=5.20)
    const drop = evaluateTrigger(aspi, 5.10, st);
    assert.equal(drop.signal.action, 'TRAILING_STOP');
    assert.ok(drop.signal.message.includes('TRAILING STOP'));
  });

  it('Rule 1 Rotation: RDW (SATELLITE) ชนเป้า $15.00 → สั่งขาย 100% โยกเข้า ASPI/POET', () => {
    const { signal } = evaluateTrigger(rdw, 15.00, { ...emptyState });
    assert.equal(signal.action, 'SELL_L1');
    assert.ok(signal.message.includes('Rule 1'));
    assert.ok(signal.message.includes('ASPI/POET'));
    assert.ok(signal.message.includes('100%'));
    // RDW noNewMoney → ราคาถูกแค่ไหนก็ไม่มี BUY_DIP
    const dip = evaluateTrigger(rdw, 5.00, { ...emptyState });
    assert.equal(dip.signal.action, 'NONE');
  });

  it('Rule 3 format: [PORTFOLIO ALERT] ครบ 4 บรรทัด + SPCX (MOONSHOT) ไม่มีสัญญาณ', () => {
    const { signal } = evaluateTrigger(aspi, 3.80, { ...emptyState });
    const msg = formatPortfolioAlert(signal);
    assert.ok(msg.startsWith('[PORTFOLIO ALERT]'));
    assert.ok(msg.includes('Ticker: ASPI'));
    assert.ok(msg.includes('Action: BUY_DIP'));
    // SPCX: ไม่มี sellLevels, ไม่มี buyDip, trailingStopPct=0 → ราคาอะไรก็ NONE
    const spcx = DEFAULT_TRIGGERS.find((t) => t.symbol === 'SPCX')!;
    const hold = evaluateTrigger(spcx, 100.00, { ...emptyState });
    assert.equal(hold.signal.action, 'NONE');
    assert.equal(hold.signal.alert, false);
  });
});
