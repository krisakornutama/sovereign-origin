#!/usr/bin/env node
// กัน public key ของ signed manifest หลุดจากกันคนละดอก
// (ถ้า rotate key แล้วแก้ฝั่งเดียว HUB จะเซ็นด้วย key ใหม่แต่ runner ยังถือ key เก่า
//  ⇒ เครื่องลูกทุกตัวปฏิเสธการอัปเดตพร้อมกัน)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join(ROOT, 'sovereign-os', 'agent-runner', 'src', 'updateTrust.mjs');
const BACKEND = path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'services', 'update-manifest-trust.service.ts');

function publicPem(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = text.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/);
  assert.ok(match, `${path.relative(ROOT, file)} ไม่มี public key PEM`);
  return match[0].trim();
}

test('public key ของ signed manifest ตรงกันระหว่าง runner และ core-api', () => {
  assert.equal(publicPem(RUNNER), publicPem(BACKEND));
});

test('keyId ที่ใช้เซ็นตรงกัน', () => {
  const runner = fs.readFileSync(RUNNER, 'utf8');
  const backend = fs.readFileSync(BACKEND, 'utf8');
  assert.match(runner, /UPDATE_SIGNING_KEY_ID = 'fleet-update-v1'/);
  assert.match(backend, /UPDATE_SIGNING_KEY_ID = 'fleet-update-v1'/);
});
