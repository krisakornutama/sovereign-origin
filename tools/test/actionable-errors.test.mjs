#!/usr/bin/env node
// C4 — ข้อความ error ต้องบอก "แก้ยังไง" ไม่ใช่แค่ "พัง"
//
// เหตุผลที่ต้องมีไฟล์นี้: ทุกวันนี้แต่ละหน้าเก็บ error เป็น string แล้วโชว์ดิบ ๆ
// ("Failed to fetch", "Unauthorized", "P2021") — คนในบ้านอ่านแล้วทำอะไรต่อไม่ได้
// ⇒ ต้องมีตัวแปล error กลางที่คืน "เกิดอะไร" + "ต้องทำอะไรต่อ" และต้องมี
//   component ที่ประกาศ error ให้ screen reader ได้ยิน (role="alert")
//
// เทสต์นี้เรียกฟังก์ชันจริง (ไม่ใช่ grep) เพราะ Node 24 รัน .ts ได้ด้วย type stripping
// ⇒ พิสูจน์ได้ว่าการ map ถูกต้องจริง ไม่ใช่แค่มีข้อความอยู่ในไฟล์
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainError } from '../../sovereign-frontend/src/lib/actionableError.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ตัด comment ทิ้งก่อนตรวจ — บทเรียนจาก C1: คอมเมนต์ที่พูดถึง `role="alert"` / `explainError`
// ทำให้เทสต์ผ่านทั้งที่ attribute/โค้ดจริงหายไป
// (ไม่ใช้ /\*...\*/ แบบกว้างกับไฟล์ที่มีสตริงลูกน้ำดอกจัน — ที่นี่ไม่มี แต่คงรูปแบบเดียวกัน)
function stripComments(src) {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX comment {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comment
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line)) // full-line // comment
    .join('\n');
}

// คำกริยาที่บอก "ลงมือทำอะไรต่อ" — ถ้าไม่มีคำพวกนี้ = ยังไม่ใช่ข้อความที่บอกทางแก้
const TH_ACTION = /ตรวจ|ลอง|รอ|ล็อกอิน|โหลด|รัน|ติดต่อ|แก้|ย่อ|เปิด|ใช้|เพิ่ม|ตั้ง|ไปที่|ลบ|กรอก/;
const EN_ACTION = /check|try|wait|log in|reload|run|contact|fix|shrink|open|use|add|set|go to|delete|enter/i;

const KINDS = [
  'offline', 'unauthorized', 'forbidden', 'notFound', 'conflict',
  'rateLimited', 'server', 'dbNotReady', 'badId', 'badRequest', 'unknown',
];

describe('explainError — แปล error เป็น "เกิดอะไร + แก้ยังไง"', () => {
  test('ติดต่อเซิร์ฟเวอร์ไม่ได้ → บอกให้ตรวจ Docker', () => {
    const h = explainError(new TypeError('Failed to fetch'));
    assert.equal(h.kind, 'offline');
    assert.match(h.fix, /docker/i, 'ต้องบอกวิธีตรวจว่า backend รันอยู่');
    assert.equal(h.retryable, true);
  });

  test('string "Failed to fetch" ก็ต้องแปลได้ (บางหน้าเก็บแค่ message)', () => {
    assert.equal(explainError('Failed to fetch').kind, 'offline');
  });

  test('401 → บอกให้ล็อกอินใหม่', () => {
    const h = explainError({ status: 401 });
    assert.equal(h.kind, 'unauthorized');
    assert.match(h.fix, /ล็อกอิน/);
    assert.equal(h.retryable, false, 'กดลองซ้ำเฉย ๆ ไม่ช่วย — ต้องล็อกอินใหม่');
  });

  test('Error("Unauthorized") จาก authFetch → unauthorized', () => {
    assert.equal(explainError(new Error('Unauthorized')).kind, 'unauthorized');
  });

  test('403 → บอกเรื่องสิทธิ์/ADMIN', () => {
    const h = explainError({ status: 403 });
    assert.equal(h.kind, 'forbidden');
    assert.match(h.fix, /สิทธิ์|ADMIN/i);
  });

  test('404 → บอกให้ตรวจรหัส/ลิงก์', () => {
    const h = explainError({ status: 404 });
    assert.equal(h.kind, 'notFound');
    assert.match(h.fix, TH_ACTION);
  });

  test('409 → บอกให้โหลดใหม่แล้วทำอีกครั้ง', () => {
    const h = explainError({ status: 409 });
    assert.equal(h.kind, 'conflict');
    assert.match(h.fix, /โหลดใหม่/);
    assert.equal(h.retryable, true);
  });

  test('429 → บอกให้รอ', () => {
    const h = explainError({ status: 429 });
    assert.equal(h.kind, 'rateLimited');
    assert.match(h.fix, /รอ/);
    assert.equal(h.retryable, true);
  });

  test('500 → บอกให้ดู log ของ container', () => {
    const h = explainError({ status: 500 });
    assert.equal(h.kind, 'server');
    assert.match(h.fix, /docker logs/i);
    assert.equal(h.retryable, true);
  });

  test('400 → บอกให้ตรวจช่องที่กรอก', () => {
    const h = explainError({ status: 400 });
    assert.equal(h.kind, 'badRequest');
    assert.match(h.fix, TH_ACTION);
  });

  test('P2021 (ตารางยังไม่มี) → บอกให้รัน migration', () => {
    const h = explainError({ code: 'P2021', message: 'The table `public.x` does not exist' });
    assert.equal(h.kind, 'dbNotReady');
    assert.match(h.fix, /migrate/i);
  });

  test('P2023 (uuid ผิดรูป) → บอกว่ารหัสอ้างอิงผิด', () => {
    const h = explainError({ code: 'P2023' });
    assert.equal(h.kind, 'badId');
    assert.match(h.fix, TH_ACTION);
  });

  test('P2002 (ข้อมูลซ้ำ) → นับเป็น conflict', () => {
    assert.equal(explainError({ code: 'P2002' }).kind, 'conflict');
  });

  test('ไม่รู้จัก → เก็บข้อความเดิมไว้ ไม่กลืนหาย', () => {
    const h = explainError('อะไรสักอย่างที่เราไม่รู้จัก');
    assert.equal(h.kind, 'unknown');
    assert.equal(h.what, 'อะไรสักอย่างที่เราไม่รู้จัก');
    assert.match(h.fix, TH_ACTION);
  });

  test('null/undefined → ยังต้องมีข้อความใช้ได้', () => {
    for (const v of [null, undefined, '', {}]) {
      const h = explainError(v);
      assert.equal(h.kind, 'unknown');
      assert.ok(h.what.length > 0, 'what ต้องไม่ว่าง');
      assert.ok(h.fix.length > 0, 'fix ต้องไม่ว่าง');
    }
  });

  test('ทุก kind: what/fix ไม่ว่าง และ fix ไม่ใช่การพูดซ้ำ what', () => {
    const samples = {
      offline: new TypeError('Failed to fetch'),
      unauthorized: { status: 401 },
      forbidden: { status: 403 },
      notFound: { status: 404 },
      conflict: { status: 409 },
      rateLimited: { status: 429 },
      server: { status: 500 },
      dbNotReady: { code: 'P2021' },
      badId: { code: 'P2023' },
      badRequest: { status: 400 },
      unknown: 'x',
    };
    for (const kind of KINDS) {
      const h = explainError(samples[kind]);
      assert.equal(h.kind, kind, `sample ของ ${kind} ให้ kind ผิด`);
      assert.ok(h.what.trim().length >= 4, `${kind}: what สั้นเกิน`);
      assert.ok(h.fix.trim().length >= 10, `${kind}: fix สั้นเกิน`);
      assert.notEqual(h.fix, h.what, `${kind}: fix ซ้ำกับ what`);
      assert.match(h.fix, TH_ACTION, `${kind}: fix ไม่มีคำบอกให้ลงมือทำ`);
    }
  });

  test('ภาษาอังกฤษต้องได้ข้อความอังกฤษจริง (ไม่ใช่ไทย)', () => {
    const th = explainError({ status: 401 }, 'th');
    const en = explainError({ status: 401 }, 'en');
    assert.notEqual(en.what, th.what);
    assert.match(en.fix, EN_ACTION);
    assert.doesNotMatch(en.fix, /[\u0E00-\u0E7F]/, 'โหมด en ต้องไม่มีอักษรไทย');
  });

  test('ทุก kind มีคำอธิบายอังกฤษที่บอกทางแก้', () => {
    for (const kind of KINDS) {
      const samples = { offline: 'Failed to fetch', unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, rateLimited: 429, server: 500, dbNotReady: 'P2021', badId: 'P2023', badRequest: 400, unknown: 'zzz' };
      const input = typeof samples[kind] === 'number' ? { status: samples[kind] } : samples[kind];
      const h = explainError(input, 'en');
      assert.match(h.fix, EN_ACTION, `${kind}: en fix ไม่มีคำบอกให้ลงมือทำ`);
      assert.doesNotMatch(h.fix, /[\u0E00-\u0E7F]/, `${kind}: en fix มีอักษรไทย`);
    }
  });
});

describe('ErrorNotice — component ที่ประกาศ error + บอกทางแก้', () => {
  const FILE = 'sovereign-frontend/src/components/ui/ErrorNotice.tsx';
  const code = () => stripComments(read(FILE));

  test('มีอยู่จริง และประกาศตัวเองด้วย role="alert"', () => {
    assert.match(code(), /role="alert"/);
  });

  test('ใช้ explainError (ไม่ hardcode ข้อความซ้ำ)', () => {
    assert.match(code(), /explainError/);
  });

  test('แสดงทั้ง "เกิดอะไร" และ "แก้ยังไง"', () => {
    const src = code();
    assert.match(src, /\.what/, 'ต้องแสดง what');
    assert.match(src, /\.fix/, 'ต้องแสดง fix');
  });

  test('มีปุ่มลองใหม่ที่เรียก onRetry และซ่อนเมื่อกดซ้ำไม่ได้', () => {
    const src = code();
    assert.match(src, /onRetry/, 'ต้องรับ onRetry');
    assert.match(src, /retryable/, 'ต้องเช็ค retryable ก่อนโชว์ปุ่มลองใหม่');
  });
});
