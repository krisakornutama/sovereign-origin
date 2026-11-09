// tools/test/license-issue.test.mjs — ผูกไลเซนส์ออฟไลน์เข้า quality gate
//
// 1) รันเทสต์ของ service (TS) ผ่าน tsx
// 2) ขับ CLI จริง: ออกไลเซนส์ → ตรวจผ่าน → ย้ายเครื่อง/แก้ token ต้องไม่ผ่าน
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_API = path.join(ROOT, 'sovereign-os', 'core-api');
const TSX_TEST = 'src/services/license.service.test.ts';
const CLI = path.join(ROOT, 'tools', 'license', 'issue.mjs');
const requireFromCoreApi = createRequire(path.join(CORE_API, 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

const run = (args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });

test('license service suite (tsx --test)', () => {
  const result = spawnSync(process.execPath, [TSX_CLI, '--test', TSX_TEST], {
    cwd: CORE_API,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
  });

  assert.equal(
    result.status,
    0,
    `${TSX_TEST} ล้ม (exit ${String(result.status)}):\n${result.stdout || ''}\n${result.stderr || ''}`
  );
});

test('CLI: ออกไลเซนส์ผูกเครื่อง → ตรวจผ่านบนเครื่องนั้น และไม่ผ่านบนเครื่องอื่น', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'license-cli-'));
  const privatePath = path.join(dir, 'priv.pem');
  const publicPath = path.join(dir, 'pub.pem');

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'utf8');
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'utf8');

  try {
    const issued = run([
      'issue',
      '--key',
      privatePath,
      '--licensee',
      'Sovereign Test Farm',
      '--tier',
      'business',
      '--features',
      '/business,/inventory',
      '--machines',
      'machine-A',
      '--days',
      '30',
      '--now',
      '2026-11-09T00:00:00.000Z',
    ]);

    assert.equal(issued.status, 0, issued.stderr);
    const token = issued.stdout.trim();
    assert.equal(token.split('.').length, 2, 'token ต้องเป็น payload.signature');
    assert.match(issued.stderr, /ออกไลเซนส์/);
    assert.equal(issued.stderr.includes(privatePath), false, 'ห้ามพิมพ์ path/เนื้อหาคีย์ส่วนตัว');

    const okOnMachine = run([
      'verify',
      '--token',
      token,
      '--public-key',
      publicPath,
      '--machine',
      'machine-A',
      '--now',
      '2026-11-10T00:00:00.000Z',
    ]);
    assert.equal(okOnMachine.status, 0, okOnMachine.stderr);
    const status = JSON.parse(okOnMachine.stdout);
    assert.equal(status.valid, true);
    assert.equal(status.tier, 'business');
    assert.deepEqual(status.features, ['/business', '/inventory']);

    const wrongMachine = run([
      'verify',
      '--token',
      token,
      '--public-key',
      publicPath,
      '--machine',
      'machine-B',
      '--now',
      '2026-11-10T00:00:00.000Z',
    ]);
    assert.equal(wrongMachine.status, 1);
    assert.equal(JSON.parse(wrongMachine.stdout).reason, 'wrong-machine');

    const expired = run([
      'verify',
      '--token',
      token,
      '--public-key',
      publicPath,
      '--machine',
      'machine-A',
      '--now',
      '2027-01-01T00:00:00.000Z',
    ]);
    assert.equal(expired.status, 1);
    assert.equal(JSON.parse(expired.stdout).reason, 'expired');

    const [body, signature] = token.split('.');
    const tampered = `${body.slice(0, -2)}AA.${signature}`;
    const forged = run([
      'verify',
      '--token',
      tampered,
      '--public-key',
      publicPath,
      '--machine',
      'machine-A',
      '--now',
      '2026-11-10T00:00:00.000Z',
    ]);
    assert.equal(forged.status, 1);
    assert.ok(['bad-signature', 'malformed'].includes(JSON.parse(forged.stdout).reason));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: ไม่ส่ง --key = exit 1 พร้อมบอกวิธีใช้ (ไม่เดาคีย์)', () => {
  const result = run(['issue', '--licensee', 'x']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--key/);
});

test('CLI: machine-id ให้ค่าเดิมทุกครั้งสำหรับ raw เดียวกัน', () => {
  const first = run(['machine-id', '--raw', 'my-laptop']);
  const second = run(['machine-id', '--raw', 'my-laptop']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout.trim(), /^[0-9a-f]{64}$/);
  assert.equal(first.stdout.trim(), second.stdout.trim());
});
