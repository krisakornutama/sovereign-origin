// ─────────────────────────────────────────────────────────────────────────────
// license.service.test.ts — เทสต์ของไลเซนส์ออฟไลน์
//
// รันด้วย: node <tsx/cli> --test src/services/license.service.test.ts
// (ผูกเข้า quality gate ผ่าน tools/test/license-issue.test.mjs)
//
// ทุกเคสเขียนจากมุมผู้โจมตี: แก้ token, ใช้คีย์อื่น, ย้ายเครื่อง, ต่ออายุเอง
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from 'node:crypto';

import {
  LICENSE_ENV_PUBLIC_KEY,
  LICENSE_ENV_TOKEN,
  encodeLicenseToken,
  hasFeature,
  hashMachineId,
  licenseStatusFromEnv,
  verifyLicenseToken,
  type LicensePayload,
} from './license.service';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');

const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const signWith = (key: KeyObject) => (data: Buffer) => edSign(null, data, key);

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    id: 'lic_test_0001',
    licensee: 'Sovereign Test Farm',
    tier: 'business',
    features: ['/business', '/inventory', '/treasury'],
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-11-01T00:00:00.000Z',
    maxMachines: 2,
    machineHashes: [hashMachineId('machine-A')],
    ...overrides,
  };
}

const NOW = new Date('2026-11-09T00:00:00.000Z');

test('ไลเซนส์ที่ถูกต้อง + เครื่องตรง = ผ่าน และได้ tier/features ครบ', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(status.valid, true);
  assert.equal(status.reason, 'ok');
  assert.equal(status.tier, 'business');
  assert.deepEqual(status.features, ['/business', '/inventory', '/treasury']);
  assert.equal(status.machineBound, true);
  assert.ok((status.daysLeft ?? 0) > 300, `daysLeft ควรเกิน 300 ได้ ${String(status.daysLeft)}`);
});

test('ไลเซนส์ที่ไม่ผูกเครื่องใช้ได้โดยไม่ต้องส่ง machineId', () => {
  const token = encodeLicenseToken(payload({ machineHashes: [], maxMachines: 0 }), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, now: NOW });

  assert.equal(status.valid, true);
  assert.equal(status.machineBound, false);
});

test('แก้ payload หลังเซ็น = bad-signature (ไม่ใช่แค่ parse ไม่ได้)', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const [body, signature] = token.split('.');
  const tampered = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  tampered.tier = 'pro';
  tampered.features = ['*'];
  const forgedBody = Buffer.from(JSON.stringify(tampered), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const status = verifyLicenseToken(`${forgedBody}.${signature}`, {
    publicKey: publicPem,
    machineId: 'machine-A',
    now: NOW,
  });

  assert.equal(status.valid, false);
  assert.equal(status.reason, 'bad-signature');
  assert.deepEqual(status.features, []);
});

test('เซ็นด้วยคีย์อื่น (ซื้อคีย์ปลอม) = bad-signature', () => {
  const token = encodeLicenseToken(payload(), signWith(otherKeys.privateKey as KeyObject));
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(status.reason, 'bad-signature');
  assert.equal(status.valid, false);
});

test('ย้ายไปเครื่องอื่น = wrong-machine', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-B', now: NOW });

  assert.equal(status.valid, false);
  assert.equal(status.reason, 'wrong-machine');
});

test('ไลเซนส์ผูกเครื่องแต่ไม่ส่ง machineId = wrong-machine (fail-closed)', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, now: NOW });

  assert.equal(status.valid, false);
  assert.equal(status.reason, 'wrong-machine');
});

test('หมดอายุ = expired และถูกถอดสิทธิ์ทั้งหมด', () => {
  const token = encodeLicenseToken(
    payload({ expiresAt: '2026-11-08T00:00:00.000Z' }),
    signWith(privateKey)
  );
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(status.valid, false);
  assert.equal(status.reason, 'expired');
  assert.equal(status.daysLeft, 0);
  assert.deepEqual(status.features, []);
  assert.equal(hasFeature(status, '/business'), false, 'ไลเซนส์หมดอายุต้องไม่ให้สิทธิ์');
});

test('ซื้อขาด (expiresAt null) = ไม่มีวันหมดอายุ', () => {
  const token = encodeLicenseToken(payload({ expiresAt: null }), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(status.valid, true);
  assert.equal(status.expiresAt, null);
  assert.equal(status.daysLeft, null);
});

test('token ผิดรูป = malformed ไม่ throw', () => {
  for (const bad of ['', 'abc', 'a.b.c', '.', 'not-a-token']) {
    const status = verifyLicenseToken(bad, { publicKey: publicPem, machineId: 'machine-A', now: NOW });
    assert.equal(status.valid, false, `ควรไม่ผ่าน: ${JSON.stringify(bad)}`);
    assert.ok(['malformed', 'bad-signature'].includes(status.reason), `reason=${status.reason}`);
  }
});

test('payload ที่เซ็นถูกแต่ค่าไม่ถูกกฎ (tier ไม่มีจริง) = bad-payload', () => {
  const bogus = { ...payload(), tier: 'gold' } as unknown as LicensePayload;
  const token = encodeLicenseToken(bogus, signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(status.valid, false);
  assert.equal(status.reason, 'bad-payload');
});

test('public key ใช้ไม่ได้ = no-public-key', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const status = verifyLicenseToken(token, { publicKey: 'not-a-key', machineId: 'machine-A', now: NOW });
  assert.equal(status.reason, 'no-public-key');
});

test('hasFeature: ตรงตัว, wildcard, และไลเซนส์ไม่ผ่าน = false เสมอ', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const ok = verifyLicenseToken(token, { publicKey: publicPem, machineId: 'machine-A', now: NOW });

  assert.equal(hasFeature(ok, '/business'), true);
  assert.equal(hasFeature(ok, '/farm'), false);
  assert.equal(hasFeature(ok, ''), false);
  assert.equal(hasFeature(null, '/business'), false);

  const all = verifyLicenseToken(
    encodeLicenseToken(payload({ features: ['*'] }), signWith(privateKey)),
    { publicKey: publicPem, machineId: 'machine-A', now: NOW }
  );
  assert.equal(hasFeature(all, '/anything'), true);
});

test('hashMachineId: คงที่ ตัดช่องว่างหัวท้าย และไม่เปิดเผยค่าดิบ', () => {
  assert.equal(hashMachineId('  machine-A  '), hashMachineId('machine-A'));
  assert.notEqual(hashMachineId('machine-A'), hashMachineId('machine-B'));
  assert.match(hashMachineId('machine-A'), /^[0-9a-f]{64}$/);
  assert.equal(hashMachineId('machine-A').includes('machine-A'), false);
});

test('licenseStatusFromEnv: ไม่ได้ตั้ง = null, ตั้งแล้วตรวจได้ และรับ PEM ที่ escape \\n', () => {
  assert.equal(licenseStatusFromEnv({}, 'machine-A', NOW), null);

  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const escaped = publicPem.replace(/\n/g, '\\n');

  const status = licenseStatusFromEnv(
    { [LICENSE_ENV_TOKEN]: token, [LICENSE_ENV_PUBLIC_KEY]: escaped },
    'machine-A',
    NOW
  );
  assert.equal(status?.valid, true);

  const withoutKey = licenseStatusFromEnv({ [LICENSE_ENV_TOKEN]: token }, 'machine-A', NOW);
  assert.equal(withoutKey?.reason, 'no-public-key');
});

test('ตัวแปรจากไฟล์คีย์ที่ generate ใหม่ตรวจ token เดิมไม่ได้ (ยืนยันว่าไม่ได้ผูกกับคีย์คงที่)', () => {
  const token = encodeLicenseToken(payload(), signWith(privateKey));
  const strangerPem = createPublicKey(
    createPrivateKey({ key: otherKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }), format: 'pem' })
  )
    .export({ type: 'spki', format: 'pem' })
    .toString();

  assert.notEqual(strangerPem, publicPem);
  assert.notEqual(privatePem, '');
  assert.equal(
    verifyLicenseToken(token, { publicKey: strangerPem, machineId: 'machine-A', now: NOW }).reason,
    'bad-signature'
  );
});
