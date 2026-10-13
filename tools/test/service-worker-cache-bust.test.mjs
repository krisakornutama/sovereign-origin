// ─────────────────────────────────────────────────────────────────────────────
// tools/test/service-worker-cache-bust.test.mjs
// กติกา: service worker ต้อง "หายขาด" เองทุก build — client ห้ามค้างที่ UI เก่า
//
// เคสจริง 13/10/69: แก้ publicAccess.ts ให้ desktop ไม่โผล่สนามทดลองแล้ว
//  แต่เปิดแอปแล้วยังเห็นหน้าสนามทดลองเหมือนเดิม ทั้งที่ :3000 เสิร์ฟโค้ดใหม่แล้ว
//  ราก 2 ชั้น (ทั้งคู่อยู่ใน sw.js):
//   1) ชื่อ cache = VERSION คงที่ (sovereign-v12) → build ใหม่ก็ยังใช้ cache เดิม
//   2) **/sw-precache.json ถูก cache-first** → SW ดึง manifest เก่า ทั้งที่ caller
//      สั่ง cache:'no-store' ก็ยังโดนตัว SW ดัก (fetch ภายใน SW วิ่งผ่าน fetch handler ตัวเอง)
//      → precache ของเก่าซ้ำ → UI เก่าได้เป็นสัปดาห์ (เคยเจอแบบนี้ตอน P16 ต้องแก้ VERSION เอง)
//
// รัน: npm run test:tools
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SW = path.join(ROOT, 'sovereign-frontend', 'public', 'sw.js');
const text = fs.readFileSync(SW, 'utf8');

describe('service worker: cache bust อัตโนมัติ', () => {
  test('manifest ถูกดึงจาก network เท่านั้น (cache:' + "'no-store'" + ' ในตัว SW ไม่พอ — ตัว fetch handler ดักเอง)', () => {
    assert.match(
      text,
      /manifestVersion[\s\S]{0,400}sw-precache\.json\?ts=[\s\S]{0,120}cache:\s*'reload'/,
      'ต้องมี manifestVersion() ที่ดึง sw-precache.json จาก network (บัญญัติ ?ts= + cache reload)',
    );
  });

  test('/sw-precache.json ไม่ถูก cache-first (เคยเป็นต้นเหตุ)', () => {
    const m = text.match(/url\.pathname === '\/sw-precache\.json'\)\s*\{([\s\S]{0,160})/);
    assert.ok(m, 'ต้องมีกรณี /sw-precache.json แยกต่างหากใน fetch handler');
    assert.match(
      m[1],
      /networkFirst/,
      '/sw-precache.json ต้องเป็น network-first — cache-first ทำให้ได้ manifest เก่า',
    );
  });

  test('ชื่อ cache ผูกกับเวอร์ชัน manifest (build ใหม่ = กลุ่ม cache ใหม่)', () => {
    assert.match(text, /async function activeCacheName\(\)/, 'ต้องมี activeCacheName()');
    assert.match(text, /VERSION\s*\+\s*'-'\s*\+\s*ACTIVE_VERSION/, 'ชื่อ cache ต้องต่อด้วยเวอร์ชัน manifest');
  });

  test('ไม่มี caches.open(VERSION) เปล่า ๆ ทิ้งไว้ (จะข้ามกลไกเวอร์ชัน)', () => {
    const bad = text.split(/\r?\n/).filter((l) => /caches\.open\(VERSION\)/.test(l));
    assert.deepEqual(bad, [], 'ทุกจุดต้องใช้ activeCacheName() ไม่ใช่ VERSION ตรง ๆ');
  });

  test('navigate handler ต้อง purge cache เก่าก่อนเสิร์ฟ (build เปลี่ยนแล้วได้ bundle ใหม่เสมอ)', () => {
    assert.match(
      text,
      /request\.mode === 'navigate'\)[\s\S]{0,300}purgeStaleCaches\(\)/,
      'navigate handler ต้องเรียก purgeStaleCaches()',
    );
  });

  test('activate ล้างเฉพาะ cache ที่ไม่ใช่ชุดปัจจุบัน และสั่งหน้าต่างโหลดใหม่เมื่อมีของค้าง', () => {
    assert.match(text, /addEventListener\('activate'[\s\S]{0,600}stale\.length/, 'activate ต้องอ้างถึง stale');
    assert.match(text, /clients\.matchAll\(\{\s*type:\s*'window'\s*\}\)/, 'ต้องสั่ง reload หน้าต่างเมื่อมี cache เก่าค้าง');
    assert.match(text, /self\.skipWaiting\(\)/, 'ต้อง skipWaiting เพื่อไม่รอปิดทุกแท็บ');
    assert.match(text, /self\.clients\.claim\(\)/, 'ต้อง clients.claim เพื่อคุมหน้าที่เปิดอยู่');
  });

  test('VERSION ไม่ค้างที่ค่าที่เคยทำให้เก่า (ต้องเลื่อนขึ้น)', () => {
    const m = text.match(/const VERSION = '([^']+)'/);
    assert.ok(m, 'ต้องมี VERSION');
    const n = Number((m[1].match(/v(\d+)$/) || [])[1]);
    assert.ok(Number.isFinite(n), `VERSION ต้องลงท้ายด้วย v<ตัวเลข>: ${m[1]}`);
    assert.ok(n >= 13, `VERSION ต้อง >= v13 (v12 คือค่าที่ทำให้ client ค้าง UI เก่า) — พบ ${m[1]}`);
  });
});