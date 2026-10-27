#!/usr/bin/env node
// Idempotency (central) — wiring contract.
// เหตุผลที่ต้องมีไฟล์นี้: ตัว middleware พิสูจน์แล้วว่า "กันซ้ำได้" (tests/idempotency.test.ts)
// แต่ถ้าไม่มีใครต่อมันเข้ากับ route จริง ระบบก็ยังขายซ้ำได้เหมือนเดิม —
// เทสต์นี้จึงคุม "จุดต่อ" ทั้ง 3 ชั้น:
//   1) backend: 4 endpoint ที่มีผลข้างเคียง (ออเดอร์/รับเงิน/รับซื้อ) ต้องติด middleware
//   2) frontend: ต้องสร้างคีย์ต่อ 1 การกระทำ และแนบไปกับทุก request ที่เปลี่ยนข้อมูล
//   3) คิวออฟไลน์: ต้องเก็บ header ไว้ replay (ไม่งั้นคีย์หาย = กันซ้ำไม่ได้ตอนเน็ตหลุด)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const BUSINESS = 'sovereign-os/core-api/src/modules/business/business.routes.ts';
const RESTAURANT = 'sovereign-os/core-api/src/modules/restaurant/restaurant.routes.ts';
const SERVICE = 'sovereign-os/core-api/src/services/idempotency.service.ts';
const REQUEST_ID = 'sovereign-frontend/src/lib/requestId.ts';
const API_FETCH = 'sovereign-frontend/src/lib/apiFetch.ts';
const OFFLINE_QUEUE = 'sovereign-frontend/src/lib/offlineQueue.ts';

describe('idempotency — backend routes', () => {
  test('business: เปิดออเดอร์ติด idempotent พร้อม scope ของตัวเอง', () => {
    const src = read(BUSINESS);
    assert.match(
      src,
      /router\.post\('\/:businessId\/orders',\s*authenticate,\s*idempotent\('business\.order'\)/,
      'POST /:businessId/orders ต้องมี idempotent("business.order") หลัง authenticate',
    );
  });

  test('business: บันทึกรับเงินติด idempotent (เงินซ้ำ = เสียเงินจริง)', () => {
    const src = read(BUSINESS);
    assert.match(
      src,
      /router\.post\('\/:businessId\/orders\/:id\/payments',\s*authenticate,\s*idempotent\('business\.payment'\)/,
      'POST /:businessId/orders/:id/payments ต้องมี idempotent("business.payment")',
    );
  });

  test('restaurant: เปิดออเดอร์ติด idempotent', () => {
    const src = read(RESTAURANT);
    assert.match(
      src,
      /router\.post\('\/orders',\s*authenticate,\s*idempotent\('restaurant\.order'\)/,
      'POST /orders ต้องมี idempotent("restaurant.order")',
    );
  });

  test('restaurant: รับซื้อวัตถุดิบติด idempotent หลังด่านสิทธิ์', () => {
    const src = read(RESTAURANT);
    assert.match(
      src,
      /router\.post\('\/purchases',\s*authenticate,\s*requireRole\(\.\.\.WRITE_ROLES\),\s*idempotent\('restaurant\.purchase'\)/,
      'POST /purchases ต้องมี idempotent("restaurant.purchase") หลัง requireRole (ไม่ให้คีย์ถูกจองก่อนรู้สิทธิ์)',
    );
  });

  test('ทุกจุดใช้ scope คนละชื่อ (คีย์ชนกันข้าม endpoint ไม่ได้)', () => {
    const scopes = [
      ...read(BUSINESS).matchAll(/idempotent\('([^']+)'\)/g),
      ...read(RESTAURANT).matchAll(/idempotent\('([^']+)'\)/g),
    ].map((m) => m[1]);
    assert.deepEqual(scopes.sort(), [
      'business.order',
      'business.payment',
      'restaurant.order',
      'restaurant.purchase',
    ]);
  });
});

describe('idempotency — backend service ↔ frontend contract', () => {
  test('รูปแบบคีย์ที่ frontend สร้าง ต้องผ่านกติกาของ backend', () => {
    const service = read(SERVICE);
    const pattern = service.match(/export const KEY_PATTERN\s*=\s*\/(.+)\/;/);
    assert.ok(pattern, 'ไม่พบ KEY_PATTERN ใน service');
    const re = new RegExp(pattern[1]);

    // crypto.randomUUID() → `idem-<uuid>`
    assert.equal(re.test('idem-9f1c2a7e-4b3d-4c5e-8a6b-1d2e3f4a5b6c'), true);
    // fallback ของ WebView เก่า → `idem-<base36>-<base36>`
    assert.equal(re.test('idem-lq3k9z-1a2b3c4d5e'), true);
    // คีย์ที่หลุดรูปแบบต้องไม่ผ่าน
    assert.equal(re.test('idem-'), false);
    assert.equal(re.test('idem key with space'), false);
  });

  test('frontend มีตัวสร้างคีย์แยกจาก request-id', () => {
    const src = read(REQUEST_ID);
    assert.match(src, /export function newIdempotencyKey\(\): string/);
    assert.match(src, /`idem-\$\{c\.randomUUID\(\)\}`/, 'ต้องมีคำนำหน้า idem- ให้ตาม log ได้');
    assert.match(src, /`idem-\$\{Date\.now\(\)\.toString\(36\)\}/, 'ต้องมี fallback เมื่อ crypto ใช้ไม่ได้');
  });
});

describe('idempotency — frontend behavior', () => {
  test('authFetch แนบ x-idempotency-key เฉพาะวิธีที่เปลี่ยนข้อมูล', () => {
    const src = read(API_FETCH);
    assert.match(src, /newIdempotencyKey/);
    assert.match(src, /MUTATING_METHODS\s*=\s*new Set\(\['POST', 'PUT', 'PATCH', 'DELETE'\]\)/);
    assert.match(src, /MUTATING_METHODS\.has\(method\)/);
    assert.match(src, /headers\['x-idempotency-key'\]\s*=\s*newIdempotencyKey\(\)/);
  });

  test('คีย์ที่ caller ตั้งมาเองต้องไม่ถูกทับ (retry ด้วยคีย์เดิมต้องทำได้)', () => {
    const src = read(API_FETCH);
    assert.match(
      src,
      /!headers\['x-idempotency-key'\]\s*&&\s*!headers\['Idempotency-Key'\]/,
      'ถ้ามีคีย์อยู่แล้วห้ามสร้างใหม่ — ไม่งั้นการ replay ของคิวจะกลายเป็นงานใหม่',
    );
  });

  test('คิวออฟไลน์เก็บ header ไว้ replay (คีย์ต้องรอดข้ามการปิดเบราว์เซอร์)', () => {
    const src = read(OFFLINE_QUEUE);
    assert.match(src, /headers:\s*normalizeHeaders\(init\?\.headers\)/, 'ตอนเข้าคิวต้องเก็บ header');
    assert.match(src, /headers:\s*action\.headers/, 'ตอน replay ต้องส่ง header เดิมกลับไป');
  });
});
