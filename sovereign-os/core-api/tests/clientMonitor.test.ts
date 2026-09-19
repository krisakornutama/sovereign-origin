// tests/clientMonitor.test.ts — pure functions (ไม่ ping DB/network จริง)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBrowser,
  isWebViewUa,
  errorFingerprint,
  normalizeClientError,
  shouldAlert,
  tally,
  aggregateClientHealth,
  type ClientHealthEventRow,
} from '../src/services/client-monitor.service';

const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 LINE/13.19.1';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FB_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/456.0.0.49.80;]';

describe('Client Monitor: extractBrowser', () => {
  it('จับ LINE WebView จาก UA', () => {
    assert.equal(extractBrowser(LINE_UA), 'LINE WebView');
  });
  it('จับ Facebook in-app ทั้ง iOS/Android รูปแบบ', () => {
    assert.equal(extractBrowser(FB_ANDROID_UA), 'Facebook');
    assert.equal(extractBrowser('...FBIOS...'), 'Facebook');
  });
  it('Chrome ปกติไม่โดนจัดเป็น WebView', () => {
    assert.equal(extractBrowser(CHROME_UA), 'Chrome');
  });
  it('UA แปลก/ว่าง → unknown/Other ไม่ crash', () => {
    assert.equal(extractBrowser(''), 'unknown');
    assert.equal(extractBrowser('blahblah'), 'Other');
  });
});

describe('Client Monitor: isWebViewUa', () => {
  it('LINE + Facebook = in-app browser', () => {
    assert.equal(isWebViewUa(LINE_UA), true);
    assert.equal(isWebViewUa(FB_ANDROID_UA), true);
  });
  it('Chrome/Safari ปกติ = false', () => {
    assert.equal(isWebViewUa(CHROME_UA), false);
  });
});

describe('Client Monitor: errorFingerprint', () => {
  it('error เดิม (ต่างเลข line/uuid) → fingerprint เดียวกัน', () => {
    const a = errorFingerprint('Cannot read properties of undefined (reading id:99)', 'app.js', '/shop');
    const b = errorFingerprint('Cannot read properties of undefined (reading id:77)', 'app.js', '/shop');
    assert.equal(a, b);
  });
  it('error คนละแบบ → fingerprint ต่างกัน', () => {
    const a = errorFingerprint('localStorage setItem failed', '', '/');
    const b = errorFingerprint('crypto.subtle is undefined', '', '/');
    assert.notEqual(a, b);
  });
  it('message ยาวมากก็ normalize ได้ (ไม่ crash)', () => {
    const fp = errorFingerprint('x'.repeat(5000), '', '/');
    assert.equal(typeof fp, 'string');
  });
});

describe('Client Monitor: normalizeClientError', () => {
  it('ตัดข้อความเกิน 1000 ตัวอักษร (กัน payload ยักษ์)', () => {
    const n = normalizeClientError({ message: 'a'.repeat(5000) }, LINE_UA);
    assert.ok(n.message.length <= 1000);
    assert.equal(n.isWebView, true);
  });
  it('field แปลก ๆ (object/number) ไม่ทำ crash — แปลงเป็น string', () => {
    const n = normalizeClientError({ message: { evil: true }, line: '12' } as any, CHROME_UA);
    assert.ok(typeof n.message === 'string');
    assert.equal(n.line, 12);
    assert.equal(n.isWebView, false);
  });
  it('payload ว่าง = default ปลอดภัย', () => {
    const n = normalizeClientError({}, '');
    assert.ok(n.message.length > 0);
    assert.equal(n.page, '/');
  });
});

describe('Client Monitor: tally', () => {
  it('เรียงจากมากไปน้อย + tie-break ตามชื่อ key', () => {
    const r = tally([['b', 2], ['a', 5], ['c', 2], ['d', 9]]);
    assert.deepEqual(r.map((x) => x.key), ['d', 'a', 'b', 'c']);
    assert.deepEqual(r.map((x) => x.count), [9, 5, 2, 2]);
  });
  it('entries ว่าง = ผลว่าง', () => {
    assert.deepEqual(tally([]), []);
  });
});

describe('Client Monitor: aggregateClientHealth', () => {
  const now = new Date('2026-09-19T10:00:00Z');
  const mk = (over: Partial<ClientHealthEventRow>): ClientHealthEventRow => ({
    timestamp: now,
    description: '[client] boom',
    raw_data: {},
    ...over,
  });

  it('รวมตาม browser/page/kind + นับ WebView + strip prefix [client]', () => {
    const events: ClientHealthEventRow[] = [
      mk({ raw_data: { browser: 'LINE WebView', page: '/shop', kind: 'js', isWebView: true } }),
      mk({ raw_data: { browser: 'LINE WebView', page: '/shop', kind: 'fetch', isWebView: true } }),
      mk({ description: '[client] fetch failed: ERR', raw_data: { browser: 'Chrome', page: '/dashboard', kind: 'fetch' } }),
    ];
    const s = aggregateClientHealth(events, 7);
    assert.equal(s.total, 3);
    assert.equal(s.webviewCount, 2);
    assert.equal(s.byBrowser[0].key, 'LINE WebView');
    assert.equal(s.byPage[0].key, '/shop');
    assert.equal(s.byKind[0].key, 'fetch');
    assert.equal(s.topErrors[0].message, 'boom');
    assert.equal(s.topErrors[1].message, 'fetch failed: ERR');
  });

  it('กราฟรายวันครบ 7 วัน — วันที่ไม่มี error = 0 และเรียงเก่า→ใหม่', () => {
    const s = aggregateClientHealth([mk({ timestamp: new Date('2026-09-19T08:00:00Z') })], 7);
    assert.equal(s.daily.length, 7);
    assert.equal(s.daily[6].date, '2026-09-19');
    assert.equal(s.daily[6].count, 1);
    assert.ok(s.daily.slice(0, 6).every((d) => d.count === 0));
  });

  it('raw_data ว่าง/แปลก ๆ ไม่ crash — ใช้ค่า default', () => {
    const s = aggregateClientHealth([mk({ raw_data: null }), mk({ raw_data: 'not-an-object' }), mk({ timestamp: 'garbage' as any })], 3);
    assert.equal(s.total, 3);
    assert.equal(s.byBrowser[0].key, 'unknown');
    assert.equal(s.daily.filter((d) => d.date === 'unknown').length, 0); // timestamp เพี้ยนไม่หลุดเข้ากราฟ
  });
});

describe('Client Monitor: shouldAlert (threshold 3 ใน 5 นาที)', () => {
  const counters = new Map<string, number[]>();

  it('ครั้งที่ 1-2 ยังไม่ alert', () => {
    assert.equal(shouldAlert(counters, 'fp1', 1000), false);
    assert.equal(shouldAlert(counters, 'fp1', 2000), false);
  });
  it('ครั้งที่ 3 ขึ้น threshold พอดี — alert รอบเดียว', () => {
    assert.equal(shouldAlert(counters, 'fp1', 3000), true);
    assert.equal(shouldAlert(counters, 'fp1', 4000), false);
    assert.equal(shouldAlert(counters, 'fp1', 5000), false);
  });
  it('error คนละกลุ่มนับแยกกัน', () => {
    assert.equal(shouldAlert(counters, 'fp2', 5000), false);
    assert.equal(shouldAlert(counters, 'fp2', 5100), false);
    assert.equal(shouldAlert(counters, 'fp2', 5200), true);
  });
  it('error เก่าเกิน window ไม่นับรวม — หมดอายุแล้วเริ่มนับใหม่', () => {
    assert.equal(shouldAlert(counters, 'fp3', 1), false);
    assert.equal(shouldAlert(counters, 'fp3', 2), false);
    // เลย window (5 นาที) — สองครั้งเก่าหมดอายุ นับใหม่ตั้งแต่ 1 (ถ้ายังนับเก่าจะ alert พร่าม)
    const late = 5 * 60_000 + 3_000;
    assert.equal(shouldAlert(counters, 'fp3', late), false); // ครั้งที่ 1 ของ window ใหม่
    assert.equal(shouldAlert(counters, 'fp3', late + 1), false); // ครั้งที่ 2
    assert.equal(shouldAlert(counters, 'fp3', late + 2), true); // ครั้งที่ 3 → alert
  });
});
