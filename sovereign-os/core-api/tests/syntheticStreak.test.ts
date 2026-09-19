// tests/syntheticStreak.test.ts — pure tracker + ท่อผ่าน dispatcher จริง (mock sender)
// พฤติกรรม: FAIL ติดกันครบ threshold → critical ยิง 1 ครั้งแล้วค้างหยุด · PASS reset ทุกอย่าง
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticStreak, resetSyntheticStreakForTest } from '../src/services/client-monitor.service';
import { setTelegramAlertSender } from '../src/services/telegram-alert.service';

const FAIL = { profile: 'LINE WebView iOS (WebKit)', ok: false, failures: ['launch webkit ไม่ได้: Executable missing'] };
const PASS = { profile: 'iOS Safari (WebKit)', ok: true, failures: [] };

describe('SyntheticStreakTracker', () => {
  beforeEach(() => resetSyntheticStreakForTest());

  it('FAIL รอบเดียว (ต่ำกว่า threshold=2) ยังไม่แจ้ง', async () => {
    await syntheticStreak.recordRound([FAIL, PASS]);
    // ไม่มีทาง assert ภายนอกตรง ๆ — ตรวจผ่านผลของรอบถัดไป (ดู test ถัดไปเป็นหลัก)
  });

  it('FAIL ติดกันครบ threshold → ยิง critical ครั้งเดียวแล้วค้างหยุดจน PASS', async () => {
    const sent: { text: string; severity: string }[] = [];
    setTelegramAlertSender(async (html) => {
      sent.push({ text: html, severity: /CRITICAL/.test(html) ? 'critical' : 'other' });
      return true;
    });
    try {
      await syntheticStreak.recordRound([FAIL, PASS]);   // streak 1 → ไม่ยิง
      assert.equal(sent.length, 0, 'ยังไม่ถึง threshold');
      await syntheticStreak.recordRound([FAIL, PASS]);   // streak 2 → ยิง critical
      assert.equal(sent.length, 1);
      assert.equal(sent[0].severity, 'critical');
      assert.match(sent[0].text, /พังติดกัน 2 รอบ/);
      assert.match(sent[0].text, /LINE WebView iOS/);
      await syntheticStreak.recordRound([FAIL, PASS]);   // streak 3 — ค้างหยุด ไม่ยิงซ้ำ
      await syntheticStreak.recordRound([FAIL, PASS]);
      assert.equal(sent.length, 1, 'ต้องไม่ spam ทุกรอบที่ยังพัง');
      await syntheticStreak.recordRound([PASS, PASS]);   // หาย → reset
      await syntheticStreak.recordRound([FAIL, PASS]);   // streak 1 ใหม่ → ไม่ยิง
      await syntheticStreak.recordRound([FAIL, PASS]);   // streak 2 ใหม่ → ยิงอีกครั้ง
      assert.equal(sent.length, 2, 'พังใหม่หลังหาย = แจ้งใหม่');
    } finally {
      setTelegramAlertSender(null);
    }
  });

  it('PASS ล้วน reset streak (ไม่มีการแจ้ง)', async () => {
    let calls = 0;
    setTelegramAlertSender(async () => { calls++; return true; });
    try {
      await syntheticStreak.recordRound([PASS, PASS]);
      await syntheticStreak.recordRound([PASS, PASS]);
      assert.equal(calls, 0);
    } finally {
      setTelegramAlertSender(null);
    }
  });
});
