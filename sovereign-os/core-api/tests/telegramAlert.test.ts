// tests/telegramAlert.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY_ICON,
  TelegramAlertDispatcher,
  formatTelegramAlert,
  isSeverityEnabled,
  type TelegramAlertConfig,
} from '../src/services/telegram-alert.service';

const CFG: TelegramAlertConfig = {
  minSeverity: 'warn',
  dedupWindowMs: 300000,
  criticalRatePerMin: 5,
  globalRatePerMin: 60,
  dashboardUrl: 'http://sovereign.local',
};

function makeDispatcher(
  over: Partial<TelegramAlertConfig> = {},
  send = async () => true,
  now = () => 0
) {
  const sent: string[] = [];
  const dispatcher = new TelegramAlertDispatcher(
    {
      send: async (html) => {
        const ok = await send(html);
        sent.push(html);
        return ok;
      },
      now,
    },
    { ...CFG, ...over }
  );
  return { dispatcher, sent };
}

describe('severity filter (pure)', () => {
  it('enables only >= min severity', () => {
    assert.equal(isSeverityEnabled('critical', 'warn'), true);
    assert.equal(isSeverityEnabled('warn', 'warn'), true);
    assert.equal(isSeverityEnabled('info', 'warn'), false);
    assert.equal(isSeverityEnabled('info', 'info'), true);
  });

  it('formats HTML with icon, label and dashboard link', () => {
    const html = formatTelegramAlert('Battery at 5%', 'critical', 'http://sovereign.local');
    assert.match(html, new RegExp(ALERT_SEVERITY_ICON.critical));
    assert.match(html, /<b>🚨 CRITICAL<\/b>/);
    assert.match(html, /Battery at 5%/);
    assert.match(html, /href="http:\/\/sovereign\.local"/);
  });
});

describe('TelegramAlertDispatcher', () => {
  it('blocks INFO below min severity by default', async () => {
    const { dispatcher, sent } = makeDispatcher();
    const r = await dispatcher.send({ text: 'daily digest', severity: 'info' });
    assert.equal(r.sent, false);
    assert.match(r.reason, /below_min_severity/);
    assert.equal(sent.length, 0);
  });

  it('sends WARN and CRITICAL', async () => {
    const { dispatcher, sent } = makeDispatcher();
    await dispatcher.send({ text: 'battery low', severity: 'warn' });
    await dispatcher.send({ text: 'relay stuck', severity: 'critical' });
    assert.equal(sent.length, 2);
  });

  it('enables INFO when TELEGRAM_MIN_SEVERITY=info', async () => {
    const { dispatcher, sent } = makeDispatcher({ minSeverity: 'info' });
    await dispatcher.send({ text: 'daily backup ok', severity: 'info' });
    assert.equal(sent.length, 1);
  });

  it('dedups identical eventKey within window (non-critical)', async () => {
    const { dispatcher, sent } = makeDispatcher();
    const r1 = await dispatcher.send({ text: 'sensor flapping', severity: 'warn', eventKey: 'sensor:temp' });
    const r2 = await dispatcher.send({ text: 'sensor flapping', severity: 'warn', eventKey: 'sensor:temp' });
    assert.equal(r1.sent, true);
    assert.equal(r2.sent, false);
    assert.match(r2.reason, /dedup/);
    assert.equal(sent.length, 1);
  });

  it('dedups by normalized text when no eventKey', async () => {
    const { dispatcher, sent } = makeDispatcher();
    await dispatcher.send({ text: '   same   text  ', severity: 'warn' });
    await dispatcher.send({ text: 'same text', severity: 'warn' });
    assert.equal(sent.length, 1);
  });

  it('dedup window expires → sends again', async () => {
    let now = 0;
    const { dispatcher, sent } = makeDispatcher({}, undefined, () => now);
    await dispatcher.send({ text: 'warn once', severity: 'warn' });
    now = 300001;
    const r = await dispatcher.send({ text: 'warn once', severity: 'warn' });
    assert.equal(r.sent, true);
    assert.equal(sent.length, 2);
  });

  it('CRITICAL bypasses dedup (emergency) but dedup still records', async () => {
    const { dispatcher, sent } = makeDispatcher();
    await dispatcher.send({ text: 'urgent', severity: 'critical', eventKey: 'k' });
    const r = await dispatcher.send({ text: 'urgent', severity: 'critical', eventKey: 'k' });
    assert.equal(r.sent, true, 'critical ข้าม dedup');
    assert.equal(sent.length, 2);
  });

  it('caps CRITICAL at 5/min (6th blocked)', async () => {
    const { dispatcher, sent } = makeDispatcher();
    for (let i = 0; i < 5; i++) {
      await dispatcher.send({ text: `crit ${i}`, severity: 'critical', eventKey: `c${i}` });
    }
    const r = await dispatcher.send({ text: 'crit 6', severity: 'critical', eventKey: 'c6' });
    assert.equal(r.sent, false);
    assert.match(r.reason, /critical_rate/);
    assert.equal(sent.length, 5);
  });

  it('caps GLOBAL rate (WARN flood blocked too)', async () => {
    const { dispatcher, sent } = makeDispatcher({ globalRatePerMin: 3 });
    for (let i = 0; i < 3; i++) {
      await dispatcher.send({ text: `w ${i}`, severity: 'warn', eventKey: `w${i}` });
    }
    const r = await dispatcher.send({ text: 'overflow', severity: 'warn', eventKey: 'wo' });
    assert.equal(r.sent, false);
    assert.match(r.reason, /global_rate/);
    assert.equal(sent.length, 3);
  });

  it('rate window slides — messages after 60s can send again', async () => {
    let now = 0;
    const { dispatcher, sent } = makeDispatcher({ globalRatePerMin: 2 }, undefined, () => now);
    await dispatcher.send({ text: 'a', severity: 'warn', eventKey: 'a' });
    await dispatcher.send({ text: 'b', severity: 'warn', eventKey: 'b' });
    now = 60001;
    const r = await dispatcher.send({ text: 'c', severity: 'warn', eventKey: 'c' });
    assert.equal(r.sent, true);
    assert.equal(sent.length, 3);
  });

  it('soft-fail: network error returns false without throwing', async () => {
    const { dispatcher } = makeDispatcher({}, async () => {
      throw new Error('ECONNRESET');
    });
    const r = await dispatcher.send({ text: 'x', severity: 'critical' });
    assert.equal(r.sent, false);
    assert.match(r.reason, /network_error/);
  });

  it('soft-fail: send returning false is reported', async () => {
    const { dispatcher } = makeDispatcher({}, async () => false);
    const r = await dispatcher.send({ text: 'x', severity: 'warn' });
    assert.equal(r.sent, false);
    assert.match(r.reason, /send_returned_false/);
  });

  it('default severity is INFO (filtered when min=warn)', async () => {
    const { dispatcher, sent } = makeDispatcher();
    await dispatcher.send({ text: 'no severity' });
    assert.equal(sent.length, 0);
  });

  it('validates config on construction', () => {
    assert.throws(() => makeDispatcher({ dedupWindowMs: 0 }));
    assert.throws(() => makeDispatcher({ minSeverity: 'bogus' as never }));
    assert.throws(() => makeDispatcher({ criticalRatePerMin: -1 }));
  });
});