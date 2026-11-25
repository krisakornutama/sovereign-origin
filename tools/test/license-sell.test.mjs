import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELL = path.join(ROOT, 'tools', 'license', 'sell.mjs');
const ISSUE = path.join(ROOT, 'tools', 'license', 'issue.mjs');

function keyPair(dir) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePath = path.join(dir, 'license-priv.pem');
  const publicPath = path.join(dir, 'license-pub.pem');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { privatePath, publicPath };
}

function sell(args) {
  return spawnSync(process.execPath, [SELL, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
}

function verify(args) {
  return spawnSync(process.execPath, [ISSUE, 'verify', ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
}

function ledgerRows(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('sell: ออก + ตรวจผ่าน + เขียนชุดส่งลูกค้าและ ledger พร้อมยอดจริง', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lic-sell-'));
  const { privatePath, publicPath } = keyPair(dir);
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const outdir = path.join(dir, 'out');

  const run = sell([
    '--key',
    privatePath,
    '--public-key',
    publicPath,
    '--licensee',
    'ร้านทดสอบ',
    '--tier',
    'business',
    '--machines',
    'machine-1',
    '--days',
    '365',
    '--amount',
    '4900',
    '--sku',
    'SW-BUSINESS',
    '--order',
    'ORD-TEST-1',
    '--outdir',
    outdir,
    '--ledger',
    ledgerPath,
    '--paid',
  ]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ปิดการขาย ORD-TEST-1/);
  assert.doesNotMatch(run.stdout, /[A-Za-z0-9_-]{40,}/, 'ต้องไม่พิมพ์ token ออกจอ');

  const delivery = readFileSync(path.join(outdir, 'delivery.md'), 'utf8');
  assert.match(delivery, /ร้านทดสอบ/);
  assert.match(delivery, /4,900/);
  assert.match(delivery, /SOVEREIGN_LICENSE=/);

  const rows = ledgerRows(ledgerPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order, 'ORD-TEST-1');
  assert.equal(rows[0].amountThb, 4900);
  assert.equal(rows[0].paid, true);
  assert.equal(rows[0].sku, 'SW-BUSINESS');
  assert.equal(rows[0].machines, 1);
  assert.ok(rows[0].licenseId, 'ledger ต้องมี id ของไลเซนส์');

  // ใบที่ส่งลูกค้าตรวจผ่านบนเครื่องที่แจ้ง …
  const ok = verify(['--token', `@${path.join(outdir, 'license.txt')}`, '--public-key', publicPath, '--machine', 'machine-1']);
  assert.equal(ok.status, 0, ok.stdout);
  // … และไม่ผ่านบนเครื่องอื่น
  const other = verify(['--token', `@${path.join(outdir, 'license.txt')}`, '--public-key', publicPath, '--machine', 'machine-2']);
  assert.equal(other.status, 1, 'ไลเซนส์ผูกเครื่องต้องใช้บนเครื่องอื่นไม่ได้');
});

test('sell: ไม่ระบุราคา = ไม่ขาย (ไม่มีไฟล์ ไม่มีแถว ledger)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lic-sell-'));
  const { privatePath, publicPath } = keyPair(dir);
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const outdir = path.join(dir, 'out');

  const run = sell([
    '--key',
    privatePath,
    '--public-key',
    publicPath,
    '--licensee',
    'ร้านทดสอบ',
    '--outdir',
    outdir,
    '--ledger',
    ledgerPath,
  ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /--amount/);
  assert.equal(existsSync(path.join(outdir, 'license.txt')), false);
  assert.equal(existsSync(ledgerPath), false);
});

test('sell: คีย์ผิด = fail-closed (ไม่มีไฟล์ส่ง ไม่มี ledger)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lic-sell-'));
  const { privatePath } = keyPair(dir);
  const otherDir = mkdtempSync(path.join(tmpdir(), 'lic-sell-other-'));
  const { publicPath: otherPublic } = keyPair(otherDir);
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const outdir = path.join(dir, 'out');

  const run = sell([
    '--key',
    privatePath,
    '--public-key',
    otherPublic,
    '--licensee',
    'ร้านทดสอบ',
    '--amount',
    '100',
    '--outdir',
    outdir,
    '--ledger',
    ledgerPath,
  ]);

  assert.equal(run.status, 1, 'public key ที่ไม่ตรงกับ private key ต้องทำให้การขายถูกยกเลิก');
  assert.equal(existsSync(path.join(outdir, 'license.txt')), false, 'ต้องลบ token ที่ตรวจไม่ผ่าน');
  assert.equal(existsSync(ledgerPath), false, 'ต้องไม่บันทึกยอดขายที่ยังพิสูจน์ไม่ได้');
});
