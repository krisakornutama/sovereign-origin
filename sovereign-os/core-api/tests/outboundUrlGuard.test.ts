// Outbound URL guard used when the server fetches a URL supplied by a user
// (currently: POST /api/vision/analyze-url).
//
// Intent: a self-hosted home OS legitimately fetches LAN cameras (RFC1918 and
// IPv6 ULA are allowed). What must never be reachable: the appliance's own
// loopback services, link-local / cloud metadata endpoints, or a URL carrying
// credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OutboundUrlBlocked,
  assertSafeOutboundUrl,
  createGuardedLookup,
  isBlockedOutboundAddress,
} from '../src/lib/outbound-url-guard';

test('blocks loopback, unspecified and link-local addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '169.254.169.254', // AWS/GCP/Azure metadata
    '100.100.100.200', // Alibaba metadata (CGNAT range)
    '::1',
    '::',
    'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isBlockedOutboundAddress(ip), true, ip);
  }
});

test('allows LAN cameras (RFC1918 / IPv6 ULA) and public addresses', () => {
  for (const ip of [
    '192.168.1.50',
    '10.0.0.7',
    '172.16.4.4',
    'fd12:3456::1',
    '8.8.8.8',
    '2606:4700:4700::1111',
  ]) {
    assert.equal(isBlockedOutboundAddress(ip), false, ip);
  }
});

test('assertSafeOutboundUrl rejects non-http(s), credentials and blocked hosts', () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://192.168.1.5/snap.jpg',
    'http://user:pass@192.168.1.5/snap.jpg',
    'http://127.0.0.1/snap.jpg',
    'http://localhost:8080/snap.jpg',
    'http://app.localhost/snap.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://[::1]/snap.jpg',
    'http://2130706433/snap.jpg', // decimal form of 127.0.0.1 — URL parser normalizes it
  ]) {
    assert.throws(() => assertSafeOutboundUrl(url), OutboundUrlBlocked, url);
  }
});

test('assertSafeOutboundUrl accepts a normal LAN camera URL', () => {
  const url = assertSafeOutboundUrl('http://192.168.1.50:8080/snapshot.jpg?t=1');
  assert.equal(url.hostname, '192.168.1.50');
  assert.equal(url.port, '8080');
  assert.equal(assertSafeOutboundUrl('https://camera.local/snap.jpg').hostname, 'camera.local');
});

test('guarded lookup rejects a hostname that resolves to loopback (DNS rebinding)', () => {
  const fake = (_hostname: string, _options: any, callback: any) => callback(null, '127.0.0.1', 4);
  const lookup = createGuardedLookup(fake) as any;
  let error: any = null;
  lookup('evil.example', {}, (err: any) => {
    error = err;
  });
  assert.ok(error instanceof OutboundUrlBlocked, `ต้องถูกบล็อก (ได้ ${error})`);
});

test('guarded lookup allows a hostname that resolves to a LAN address', () => {
  const fake = (_hostname: string, _options: any, callback: any) => callback(null, '192.168.1.50', 4);
  const lookup = createGuardedLookup(fake) as any;
  let received: any = null;
  let error: any = null;
  lookup('camera.local', {}, (err: any, address: any) => {
    error = err;
    received = address;
  });
  assert.equal(error, null);
  assert.equal(received, '192.168.1.50');
});
