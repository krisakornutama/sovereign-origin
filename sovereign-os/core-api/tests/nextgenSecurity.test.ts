import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ═══ Next-Gen Security — unit tests ═══
// พาร์สเซอร์ + โปรโตคอลล้วนๆ (ไม่พึ่งบริการภายนอก) — ทำงบน DB จริงเฉพาะ match/add แล้วลบออก

import { parseHostsFile, guessCategory } from '../src/services/threat-intel.service';
import { parseEveLine, severityOf } from '../src/services/ids-reader.service';
import { sniffMime, policyVerdict, EICAR, MAX_SCAN_BYTES } from '../src/services/hash-engine.service';
import {
  parseSummaryV5,
  parseSummaryV6,
  parseTopBlocked,
  parseTopClients,
  parseQueriesV5,
  parseListOp,
} from '../src/services/pihole.service';

describe('Threat Intel parsers', () => {
  test('parseHostsFile: hosts format + comments + blank', () => {
    const text = [
      '# StevenBlack hosts',
      '0.0.0.0 doubleclick.net',
      '0.0.0.0 ads.example.com # with comment',
      '127.0.0.1 localhost',
      '',
      '  0.0.0.0   UPPER.CASE.com  ',
      '! adblock-format-only-line',
    ].join('\n');
    const out = parseHostsFile(text);
    assert.ok(out.some((d) => d.value === 'doubleclick.net'), 'doubleclick.net ควรถูกจับ');
    assert.ok(out.some((d) => d.value === 'ads.example.com'), 'โดเมนที่ comment ต่อท้ายควรถูกจับ');
    assert.ok(out.some((d) => d.value === 'upper.case.com'), 'ควร normalize เป็น lowercase');
    assert.ok(!out.some((d) => d.value === 'localhost'), 'localhost ควรถูก filter (ไม่มี dot)');
    assert.ok(out.every((d) => !d.value.includes(' ')), 'ไม่ควรมี whitespace หลงเหลือ');
  });

  test('parseHostsFile: adblock (||) format และ plain domain', () => {
    const out = parseHostsFile('||tracker.example^$third-party\nplain-domain.com\n[Adblock Plus 2.0]\n');
    assert.ok(out.some((d) => d.value === 'tracker.example'), '||tracker.example^ ควรกลายเป็น tracker.example');
    assert.ok(out.some((d) => d.value === 'plain-domain.com'), 'plain domain ควรถูกจับ');
  });

  test('guessCategory: เดา category จากคำในโดเมน', () => {
    assert.equal(guessCategory('ads.example.com'), 'ad');
    assert.equal(guessCategory('casino-ufa999.com'), 'gambling');
    assert.equal(guessCategory('tracker.analytics.io'), 'tracking');
    assert.equal(guessCategory('example-xyz.net'), 'unknown');
    assert.equal(guessCategory('account-verify-bank.com'), 'phishing');
  });
});

describe('IDS reader (Suricata eve.json)', () => {
  test('parseEveLine: alert ปกติ', () => {
    const line = JSON.stringify({
      timestamp: '2026-08-14T10:00:00.123456+0700',
      event_type: 'alert',
      src_ip: '185.220.101.1',
      dest_ip: '192.168.1.50',
      src_port: 44321,
      dest_port: 22,
      alert: { signature: 'ET SCAN Possible SSH Scan', severity: 2, category: 'Attempted Information Leak', gid: 1, rev: 3 },
    });
    const a = parseEveLine(line);
    assert.ok(a);
    assert.equal(a.signature, 'ET SCAN Possible SSH Scan');
    assert.equal(a.severity, 2);
    assert.equal(a.sourceIp, '185.220.101.1');
    assert.equal(a.destPort, 22);
    assert.equal(a.category, 'Attempted Information Leak');
  });

  test('parseEveLine: ไม่ใช่ alert / ข้อมูลเสีย → null', () => {
    assert.equal(parseEveLine(JSON.stringify({ event_type: 'dns', dns: { qname: 'a.com' } })), null);
    assert.equal(parseEveLine('not json at all {{{'), null);
    assert.equal(parseEveLine(''), null);
    assert.equal(parseEveLine(JSON.stringify({ event_type: 'alert' })), null); // ไม่มี alert object
  });

  test('severityOf: 1=critical, 2=warning, อื่น=info', () => {
    assert.equal(severityOf(1), 'critical');
    assert.equal(severityOf(2), 'warning');
    assert.equal(severityOf(3), 'info');
    assert.equal(severityOf(null), 'info');
  });
});

describe('Lite AV: MIME sniff (magic bytes)', () => {
  test('sniffMime: PNG/JPEG/PDF/ELF/MZ ถูกต้อง', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal(sniffMime(png), 'image/png');
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    assert.equal(sniffMime(jpg), 'image/jpeg');
    const pdf = Buffer.from('%PDF-1.7\n...');
    assert.equal(sniffMime(pdf), 'application/pdf');
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    assert.equal(sniffMime(elf), 'application/x-executable');
    const mz = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
    assert.equal(sniffMime(mz), 'application/x-dosexec');
    assert.equal(sniffMime(Buffer.from([0x00, 0xff, 0x01, 0xfe, 0x02, 0x80])), null);
  });

  test('policyVerdict: executable ต้องห้าม / ภาพผ่าน / ไม่รู้จักปฏิเสธ', () => {
    assert.equal(policyVerdict('application/x-executable').verdict, 'rejected');
    assert.equal(policyVerdict('application/x-dosexec').verdict, 'rejected');
    assert.equal(policyVerdict('image/png').verdict, 'clean');
    assert.equal(policyVerdict(null).verdict, 'rejected');
  });

  test('EICAR signature ถูกต้อง (ใช้ใน hash engine test)', () => {
    assert.ok(EICAR.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'));
    assert.ok(MAX_SCAN_BYTES > 0);
  });
});

describe('Pi-hole parsers (pure)', () => {
  test('parseSummaryV5', () => {
    const s = parseSummaryV5({
      domains_being_blocked: 118000,
      dns_queries_today: 4021,
      ads_blocked_today: 631,
      ads_percentage_today: 15.69,
      unique_clients: 12,
      unique_domains: 902,
      queries_forwarded: 3110,
      status: 'enabled',
    });
    assert.equal(s.domainsBeingBlocked, 118000);
    assert.equal(s.adsBlockedToday, 631);
    assert.equal(s.adsPercentageToday, 15.69);
    assert.equal(s.status, 'enabled');
  });

  test('parseSummaryV6 (nested shape)', () => {
    const s = parseSummaryV6({
      dns_queries: { total: 500, blocked: { total: 40, percent: 8 } },
      gravity: { domains_being_blocked: 90000 },
      clients: { active: 6, total: 6 },
      status: { active: true },
    });
    assert.equal(s.dnsQueriesToday, 500);
    assert.equal(s.adsBlockedToday, 40);
    assert.equal(s.domainsBeingBlocked, 90000);
    assert.equal(s.uniqueClients, 6);
    assert.equal(s.status, 'enabled');
  });

  test('parseTopBlocked: array และ object', () => {
    const arr = parseTopBlocked([{ domain: 'ads.com', count: 5 }, { domain: 'track.io', count: 2 }]);
    assert.equal(arr[0].domain, 'ads.com');
    const obj = parseTopBlocked({ top_blocked: { 'x.com': 9, 'y.com': 1 } });
    assert.equal(obj[0].domain, 'x.com');
    assert.equal(parseTopBlocked(null).length, 0);
  });

  test('parseTopClients: พร้อม client_info (hostname/MAC)', () => {
    const out = parseTopClients({
      clients: { '192.168.1.10': 200, '192.168.1.11': 50 },
      client_info: { '192.168.1.10': { name: 'living-room-tv', MAC: 'AA:BB:CC:DD:EE:FF' } },
    });
    assert.equal(out.length, 2);
    const tv = out.find((c) => c.ip === '192.168.1.10');
    assert.equal(tv?.hostname, 'living-room-tv');
    assert.equal(tv?.mac, 'AA:BB:CC:DD:EE:FF');
    assert.equal(tv?.count, 200);
  });

  test('parseQueriesV5: array rows', () => {
    const out = parseQueriesV5([
      ['2026-08-14 10:00:00', 'A', 'ads.doubleclick.net', '192.168.1.10', 'gravity blocked'],
    ]);
    assert.equal(out[0].domain, 'ads.doubleclick.net');
    assert.equal(out[0].status, 'gravity blocked');
    assert.equal(parseQueriesV5(null).length, 0);
  });

  test('parseListOp', () => {
    assert.equal(parseListOp('OK'), true);
    assert.equal(parseListOp('{}'), true);
    assert.equal(parseListOp('gravity reloaded'), false);
  });
});

describe('App Control (catalog + state file)', () => {
  let testDir: string;
  let appControl: any;
  let APP_CATALOG: any[];

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-appcontrol-'));
    process.env.APP_CONTROL_STATE_FILE = path.join(testDir, 'data', 'app-control.json');
    process.env.APP_CONTROL_CUSTOM_FILE = path.join(testDir, 'data', 'app-custom-domains.json');
    const modPath = path.resolve(__dirname, '..', 'src', 'services', 'app-control.service.ts');
    delete require.cache[modPath];
    const mod = await import('../src/services/app-control.service');
    appControl = mod.appControl;
    APP_CATALOG = mod.APP_CATALOG;
    appControl.init();
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('catalog มีแอปและโดเมนครบ', () => {
    assert.ok(APP_CATALOG.length >= 10, 'catalog ควรมี >= 10 แอป');
    for (const app of APP_CATALOG) {
      assert.ok(app.domains.length > 0, `${app.id} ต้องมีโดเมน`);
      assert.ok(app.domains.every((d) => d.includes('.')), `${app.id} โดเมนต้องมี dot`);
    }
  });

  test('setBlocked + blockedDomains + custom domain + persistence', () => {
    assert.equal(appControl.setBlocked('tiktok', true), true);
    assert.equal(appControl.setBlocked('tiktok', true), true); // idempotent
    assert.equal(appControl.setBlocked('not-exist-app', true), false);
    const domains = appControl.blockedDomains();
    assert.ok(domains.includes('tiktok.com'), 'blockedDomains ต้องมี tiktok.com');
    assert.ok(appControl.addCustomDomain('evil.example.net'));
    assert.ok(appControl.blockedDomains().includes('evil.example.net'));
    assert.ok(appControl.removeCustomDomain('evil.example.net'));
    assert.ok(!appControl.blockedDomains().includes('evil.example.net'));
    // persistence: state ถูก save ไป testDir แล้วอ่านใหม่ได้
    const fresh = JSON.parse(fs.readFileSync(path.join(testDir, 'data', 'app-control.json'), 'utf8'));
    assert.equal(fresh.tiktok, true);
  });

  test('toHostsFile: ขึ้นต้นด้วย 0.0.0.0', () => {
    appControl.setBlocked('facebook', true);
    const hosts = appControl.toHostsFile();
    assert.ok(hosts.includes('0.0.0.0 facebook.com'));
    assert.ok(hosts.startsWith('#'));
  });
});

describe('Threat Intel service (DB จริง — ลบข้อมูลหลังทดสอบ)', () => {
  test('add + matchDomains + hits เพิ่ม + remove', async () => {
    const { threatIntel } = await import('../src/services/threat-intel.service');
    const value = `unittest-${Date.now()}.example.com`;
    const item = await threatIntel.add({ type: 'DOMAIN', value, category: 'malware', note: 'test' });
    try {
      const matched1 = await threatIntel.matchDomains([value]);
      assert.equal(matched1.length, 1);
      assert.equal(matched1[0].category, 'malware');
      const matched2 = await threatIntel.matchDomains([value]);
      assert.equal(matched2.length, 1, 'match ซ้ำต้องเจออีก');
      const list = await threatIntel.list({ q: value });
      assert.ok(list.items.some((i: any) => i.value === value), 'list ค้นหาควรเจอ');
    } finally {
      await threatIntel.remove(item.id);
    }
    const after = await threatIntel.matchDomains([value]);
    assert.equal(after.length, 0, 'ลบแล้วต้องไม่เจอ');
  });

  test('add IP ต้อง validate IPv4', async () => {
    const { threatIntel } = await import('../src/services/threat-intel.service');
    await assert.rejects(() => threatIntel.add({ type: 'IP', value: '999.1.1.1' }), /IP/);
    await assert.rejects(() => threatIntel.add({ type: 'IP', value: 'not-an-ip' }), /IP/);
  });

  test('seedIfEmpty ไม่ทำอะไรถ้าฐานมีข้อมูลแล้ว', async () => {
    const { threatIntel } = await import('../src/services/threat-intel.service');
    const n = await threatIntel.seedIfEmpty();
    assert.equal(n, 0, 'มีข้อมูลอยู่แล้ว seed ควรคืน 0');
  });
});

describe('AI Analyst helpers', () => {
  test('extractRecommendations: ดึงบรรทัดที่ขึ้นต้น - * • เลข', async () => {
    const { extractRecommendations } = await import('../src/services/ai-analyst.service');
    const text = [
      'สรุป: สถานการณ์ปกติ',
      '- อัปเดต firmware ทุกจุด',
      '* เปลี่ยนรหัสผ่านให้แข็งแรง',
      '• ตั้งค่า 2FA',
      '1) ไม่ควรขึ้นเพราะเป็นตัวเลขกับวงเล็บ',
      'x สั้น',
    ].join('\n');
    const recs = extractRecommendations(text);
    assert.ok(recs.length >= 3, `ควรได้ >=3 ข้อแนะนำ แต่ได้ ${recs.length}`);
    assert.ok(!recs.some((r: string) => r.length < 8), 'ไม่ควรมีบรรทัดสั้นเกิน');
  });
});
