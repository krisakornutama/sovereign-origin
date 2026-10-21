#!/usr/bin/env node
/* ── next.config.js — distDir ต้องเปลี่ยนได้ด้วย env (Cold Soak safety) ──────
   เหตุผล: `npm run verify` สั่ง `next build` ซึ่งเขียนทับ `sovereign-frontend/.next`
   ที่ production `next start` (:3000) กำลัง serve อยู่ ⇒ chunk hash ใหม่ แต่ server
   ยังถือ build เก่าในหน่วยความจำ = หน้าเว็บ 404 ทั้งแอปจนกว่าจะ restart
   (เคสจริง 23-09-69 ตามคอมเมนต์ใน tools/verify.mjs)

   ทางออกที่ไม่ต้อง restart อะไร: ให้ build ของ verify ไปลงโฟลเดอร์อื่น
   ด้วย `NEXT_DIST_DIR=.next-verify` — prod .next ไม่ถูกแตะ

   เทสต์นี้ล็อกสัญญา:
   1) ไม่ตั้ง env → distDir = '.next' (พฤติกรรม production เดิมเป๊ะ)
   2) NEXT_DIST_DIR ตั้ง → ใช้ค่านั้น
   3) SOVEREIGN_STATIC_EXPORT=1 ต้องชนะเสมอ (electron export ลง out/)
   4) โฟลเดอร์ build ชั่วคราวต้องถูก gitignore
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join(ROOT, 'sovereign-frontend', 'next.config.js');
const requireCjs = createRequire(import.meta.url);

const KEYS = ['NEXT_DIST_DIR', 'SOVEREIGN_STATIC_EXPORT'];

function loadConfig(env = {}) {
  const saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  try {
    delete requireCjs.cache[requireCjs.resolve(CONFIG)];
    return requireCjs(CONFIG);
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('next.config.js — distDir', () => {
  test('ไม่ตั้ง env → .next (production เดิม)', () => {
    assert.equal(loadConfig().distDir, '.next');
  });

  test('NEXT_DIST_DIR ใช้ได้ — verify build ไปลงโฟลเดอร์อื่น', () => {
    assert.equal(loadConfig({ NEXT_DIST_DIR: '.next-verify' }).distDir, '.next-verify');
  });

  test('static export ชนะทุกกรณี (electron ต้องได้ out/)', () => {
    const cfg = loadConfig({ SOVEREIGN_STATIC_EXPORT: '1', NEXT_DIST_DIR: '.next-verify' });
    assert.equal(cfg.output, 'export');
    assert.equal(cfg.distDir, 'out');
  });

  test('โฟลเดอร์ build ชั่วคราวถูก gitignore', () => {
    const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(ignored, /^\.next-verify\/$/m, '.gitignore ต้องมี .next-verify/');
  });
});
