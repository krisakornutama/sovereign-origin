import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  isDimeEmail,
  findPdfPart,
  fetchDimeStatementPdf,
  loadDimeImapConfig,
  isDimeConfigured,
  type DimeImapConfig,
} from '../src/services/dime-imap.service';

const cfg: DimeImapConfig = {
  host: 'imap.test',
  port: 993,
  user: 'me@test',
  pass: 'secret',
  tls: true,
  mailbox: 'INBOX',
  lookbackDays: 45,
};

// ── filters ──

test('isDimeEmail: จาก @dime.co.th หรือ subject มี dime', () => {
  assert.equal(isDimeEmail({ from: [{ address: 'no-reply@dime.co.th' }] } as never, 'Statement'), true);
  assert.equal(isDimeEmail({ from: [{ address: 'x@y.com' }] } as never, 'Dime! Statement August'), true);
  assert.equal(isDimeEmail({ from: [{ address: 'x@y.com' }] } as never, 'ข่าวสารประจำวัน'), false);
});

test('findPdfPart: หา attachment PDF ในโครงสร้าง multipart ได้ (shape เก่า)', () => {
  const bs = {
    part: '1',
    mediaType: 'multipart',
    subtype: 'mixed',
    childNodes: [
      { part: '1.1', mediaType: 'text', subtype: 'plain', childNodes: [] },
      {
        part: '1.2',
        mediaType: 'application',
        subtype: 'pdf',
        disposition: { type: 'attachment', params: { filename: 'Statement_Mar2026.pdf' } },
        childNodes: [],
      },
    ],
  };
  assert.equal(findPdfPart(bs as never), '1.2');
});

test('findPdfPart: shape จริงจาก Gmail (octet-stream + parameters.name + disposition string)', () => {
  const bs = {
    part: '1',
    type: 'multipart/mixed',
    childNodes: [
      { part: '1.1', type: 'text/html', parameters: { charset: 'utf-8' }, encoding: 'base64', size: 68332 },
      {
        part: '1.2',
        type: 'application/octet-stream',
        parameters: { name: 'Dime_monthly_statement_DIME17225630475945q_42026.pdf' },
        encoding: 'base64',
        size: 1120172,
        disposition: 'attachment',
        childNodes: [],
      },
    ],
  };
  assert.equal(findPdfPart(bs as never), '1.2');
});

test('findPdfPart: octet-stream ที่ไม่มีชื่อ .pdf → ไม่นับเป็น PDF', () => {
  const bs = {
    part: '1',
    type: 'multipart/mixed',
    childNodes: [
      { part: '1.1', type: 'application/octet-stream', parameters: { name: 'receipt.eml' }, disposition: 'attachment' },
    ],
  };
  assert.equal(findPdfPart(bs as never), null);
});

test('findPdfPart: ไม่มี PDF → null', () => {
  const bs = {
    part: '1',
    mediaType: 'multipart',
    subtype: 'alternative',
    childNodes: [{ part: '1.1', mediaType: 'text', subtype: 'plain', childNodes: [] }],
  };
  assert.equal(findPdfPart(bs as never), null);
  assert.equal(findPdfPart(undefined), null);
});

// ── config ──

test('loadDimeImapConfig: อ่านจาก env + default', () => {
  const c = loadDimeImapConfig({
    DIME_IMAP_HOST: 'imap.test',
    DIME_IMAP_USER: 'u',
    DIME_IMAP_PASS: 'p',
  } as never);
  assert.equal(c.port, 993);
  assert.equal(c.tls, true);
  assert.equal(c.mailbox, 'INBOX');
  assert.equal(c.lookbackDays, 45);
  assert.equal(isDimeConfigured(c), true);
  assert.equal(isDimeConfigured({ ...c, host: '' }), false);
});

// ── fetchDimeStatementPdf — fake IMAP client ──

function fakeClient(msgs: Array<Record<string, unknown>>) {
  let flagged: Array<{ range: unknown; flags: string[] }> = [];
  const client = {
    async connect() {},
    async getMailboxLock() {
      return { release: async () => {} };
    },
    async *fetch() {
      for (const m of msgs) yield m;
    },
    async download(_uid: unknown, _part: unknown) {
      return { content: Readable.from([Buffer.from('%PDF-1.4 fake pdf bytes')]) as never };
    },
    async messageFlagsAdd(range: unknown, flags: string[]) {
      flagged.push({ range, flags });
    },
    async logout() {},
  };
  return { client, flagged };
}

test('fetchDimeStatementPdf: ข้ามอีเมลอื่น → เจอ Dime PDF → mark Seen → คืนผล', async () => {
  const { client, flagged } = fakeClient([
    {
      uid: 11,
      envelope: { from: [{ address: 'news@bank.com' }], subject: 'โปรโมชัน' },
      internalDate: new Date('2026-08-10'),
      bodyStructure: { part: '1', mediaType: 'multipart', subtype: 'mixed', childNodes: [] },
    },
    {
      uid: 12,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] สรุปข้อมูลการลงทุน สิงหาคม 2569 | Monthly Statement of August 2026' },
      internalDate: new Date('2026-08-15'),
      bodyStructure: {
        part: '1',
        mediaType: 'multipart',
        subtype: 'mixed',
        childNodes: [
          { part: '1.1', mediaType: 'text', subtype: 'plain', childNodes: [] },
          { part: '1.2', mediaType: 'application', subtype: 'pdf', childNodes: [] },
        ],
      },
    },
  ]);

  const result = await fetchDimeStatementPdf(cfg, {
    connect: async () => client as never,
  });

  assert.ok(result);
  assert.equal(result!.messageId, 'uid:12');
  assert.match(result!.subject, /Monthly Statement of August/);
  assert.equal(result!.pdf.toString(), '%PDF-1.4 fake pdf bytes');
  // mark \Seen เฉพาะใบที่เลือก (uid 12)
  assert.deepEqual(flagged.map((f) => f.range), [12]);
  assert.deepEqual(flagged[0].flags, ['\\Seen']);
});

test('fetchDimeStatementPdf: มีทั้ง Confirmation Note และ Monthly Statement → เลือกสเตตเมนต์ (แม้มาทีหลัง)', async () => {
  // จำลองกล่องจริง: ใบยืนยันการซื้อขาย (uid 20) มาอยู่ก่อนสเตตเมนต์ (uid 21)
  const { client, flagged } = fakeClient([
    {
      uid: 20,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] ใบยืนยันการซื้อขาย | Confirmation Note' },
      internalDate: new Date('2026-08-01'),
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'text/html' },
          { part: '1.2', type: 'application/octet-stream', parameters: { name: 'note.pdf' }, disposition: 'attachment' },
        ],
      },
    },
    {
      uid: 21,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] สรุปข้อมูลการลงทุน กรกฎาคม 2569 | Monthly Statement of July 2026' },
      internalDate: new Date('2026-08-05'),
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'text/html' },
          { part: '1.2', type: 'application/octet-stream', parameters: { name: 'Dime_monthly_statement_72026.pdf' }, disposition: 'attachment' },
        ],
      },
    },
  ]);

  const result = await fetchDimeStatementPdf(cfg, { connect: async () => client as never });
  assert.ok(result);
  assert.match(result!.subject, /Monthly Statement of July/);
  assert.deepEqual(flagged.map((f) => f.range), [21]);
});

test('fetchDimeStatementPdf: มีสเตตเมนต์หลายฉบับ → เลือกฉบับเก่าสุดก่อน (catch-up เรียงเวลา)', async () => {
  const { client, flagged } = fakeClient([
    {
      uid: 41,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] สรุปข้อมูลการลงทุน มิถุนายน 2569 | Monthly Statement of June 2026' },
      internalDate: new Date('2026-07-05'),
      bodyStructure: {
        part: '1', type: 'multipart/mixed',
        childNodes: [{ part: '1.1', type: 'text/html' }, { part: '1.2', type: 'application/octet-stream', parameters: { name: 'june.pdf' }, disposition: 'attachment' }],
      },
    },
    {
      uid: 42,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] สรุปข้อมูลการลงทุน กรกฎาคม 2569 | Monthly Statement of July 2026' },
      internalDate: new Date('2026-08-05'),
      bodyStructure: {
        part: '1', type: 'multipart/mixed',
        childNodes: [{ part: '1.1', type: 'text/html' }, { part: '1.2', type: 'application/octet-stream', parameters: { name: 'july.pdf' }, disposition: 'attachment' }],
      },
    },
  ]);

  const result = await fetchDimeStatementPdf(cfg, { connect: async () => client as never });
  assert.ok(result);
  assert.equal(result!.messageId, 'uid:41'); // มิถุนายน (เก่ากว่า) ก่อน
  assert.deepEqual(flagged.map((f) => f.range), [41]);
});

test('fetchDimeStatementPdf: มีแต่ Confirmation Note → ไม่แตะอะไร (null)', async () => {
  const { client, flagged } = fakeClient([
    {
      uid: 30,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] ใบยืนยันการซื้อขาย | Confirmation Note' },
      internalDate: new Date('2026-08-01'),
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'text/html' },
          { part: '1.2', type: 'application/octet-stream', parameters: { name: 'note-a.pdf' }, disposition: 'attachment' },
        ],
      },
    },
    {
      uid: 31,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: '[Dime!] ใบยืนยันการซื้อขาย | Confirmation Note' },
      internalDate: new Date('2026-08-10'),
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'text/html' },
          { part: '1.2', type: 'application/octet-stream', parameters: { name: 'note-b.pdf' }, disposition: 'attachment' },
        ],
      },
    },
  ]);

  const result = await fetchDimeStatementPdf(cfg, { connect: async () => client as never });
  assert.equal(result, null);
  assert.equal(flagged.length, 0, 'ห้าม mark seen ใบ confirmation');
});

test('fetchDimeStatementPdf: ไม่มีอีเมลที่เข้าเกณฑ์ → null และไม่ mark อะไร', async () => {
  const { client, flagged } = fakeClient([
    {
      uid: 1,
      envelope: { from: [{ address: 'foo@bar.com' }], subject: 'อื่นๆ' },
      bodyStructure: { part: '1', mediaType: 'multipart', subtype: 'mixed', childNodes: [] },
    },
  ]);
  const result = await fetchDimeStatementPdf(cfg, { connect: async () => client as never });
  assert.equal(result, null);
  assert.equal(flagged.length, 0);
});

test('fetchDimeStatementPdf: อีเมลเข้าเกณฑ์แต่ไม่มี PDF → null', async () => {
  const { client } = fakeClient([
    {
      uid: 7,
      envelope: { from: [{ address: 'no-reply@dime.co.th' }], subject: 'Dime! Statement' },
      bodyStructure: { part: '1', mediaType: 'multipart', subtype: 'mixed', childNodes: [] },
    },
  ]);
  const result = await fetchDimeStatementPdf(cfg, { connect: async () => client as never });
  assert.equal(result, null);
});