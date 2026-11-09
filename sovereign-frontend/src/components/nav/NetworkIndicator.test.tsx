// src/components/nav/NetworkIndicator.test.tsx — red-first test ของ Network Indicator
// รันด้วย: npx --prefix ../sovereign-os/core-api tsx src/components/nav/NetworkIndicator.test.tsx
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-network-indicator.test.mjs)
//
// กติกาที่ล็อกไว้ (คำสั่งเจ้าของ — Sprint 2 ระยะ 3 · Transparent Offline UX):
//   1) networkState(isOnline, queuedCount, syncing) → 'online' | 'offline' | 'syncing'
//      — syncing ชนะทุกสถานะ (กำลังส่งคิวจริง), ออฟไลน์ชนะความออนไลน์ปกติ
//   2) Badge ออนไลน์ = จุดเขียว + "ออนไลน์" · ออฟไลน์ = จุดส้ม + "ออฟไลน์" · ซิงก์ = จุดฟ้าพัลส์ + "กำลังซิงก์"
//   3) มีคิวค้าง (queuedCount > 0) → แสดงตัวเลข + "รายการรอส่ง" ประกบทุกสถานะ
//   4) Badge ต้องถูกผู้อ่านหน้าจอรับรู้: role="status" + aria-live="polite" (เปลี่ยนสถานะแบบฟ้องเงียบได้)
//   5) กรณีมี onSync (คลิกได้) = <button> · ไม่มี = <span> (ห้ามปุ่มลอยให้กดมั่วตอนไม่มี queue)
//   6) label/pendingLabel override สำหรับ i18n container — presentational ไม่ bind สมองสโตร์
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// static import ได้เลย — Badge เป็น presentational (ไม่ bind สมองสโตร์ i18n)
import { NetworkIndicatorBadge, networkState } from './NetworkIndicator';

const render = (props: {
  state: 'online' | 'offline' | 'syncing';
  queuedCount: number;
  label?: string;
  pendingLabel?: string;
  onSync?: () => void;
}) => renderToStaticMarkup(React.createElement(NetworkIndicatorBadge, props));

// ── state machine ──────────────────────────────────────────────────────────────
test('networkState: syncing ชนะทุกกรณี, ออฟไลน์ก่อนรู้ตัวว่าคิวรอ, ออนไลน์เป็นค่าเริ่มไม่มีอะไร', () => {
  assert.equal(networkState(true, 0, false), 'online');
  assert.equal(networkState(false, 0, false), 'offline');
  assert.equal(networkState(false, 3, false), 'offline');
  assert.equal(networkState(true, 2, true), 'syncing');
  assert.equal(networkState(false, 2, true), 'syncing');
});

// ── สี + ข้อความตามสถานะ ───────────────────────────────────────────────────────
test('Badge online: จุดเขียว + "ออนไลน์" + role=status + aria-live — ไม่มีชิปรอส่งเมื่อคิวว่าง', () => {
  const html = render({ state: 'online', queuedCount: 0, label: 'Online', pendingLabel: 'pending' });
  assert.match(html, /bg-emerald-400/);
  assert.match(html, /Online/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /pending/);
  assert.doesNotMatch(html, /bg-orange-400/);
  assert.doesNotMatch(html, /<button/);
});

test('Badge offline: จุดส้ม + "ออฟไลน์" — และห้ามเรียกตัวเองว่ากำลังซิงก์', () => {
  const html = render({ state: 'offline', queuedCount: 0, label: 'Offline', pendingLabel: 'pending' });
  assert.match(html, /bg-orange-400/);
  assert.match(html, /Offline/);
  assert.doesNotMatch(html, /กำลังซิงก์/);
  assert.doesNotMatch(html, /<button/);
});

test('Badge syncing: จุดฟ้าพัลส์ + "กำลังซิงก์" — ชิปคิวยังตามจำนวนจริง', () => {
  const html = render({ state: 'syncing', queuedCount: 2, label: 'Syncing', pendingLabel: 'pending' });
  assert.match(html, /bg-sky-400/);
  assert.match(html, /animate-pulse/);
  assert.match(html, /Syncing/);
  assert.match(html, /2/);
  assert.match(html, /pending/);
});

test('Badge offline ค้าง 3 รายการ → ตัวเลข 3 + "รายการรอส่ง" ชัดเจนบน badge', () => {
  const html = render({ state: 'offline', queuedCount: 3, label: 'Offline', pendingLabel: '3 pending' });
  assert.match(html, /3/);
  assert.match(html, /pending/);
  assert.match(html, /bg-orange-400/);
});

// ── i18n seam (container จะส่งข้อความตามภาษามาตรง ๆ) ───────────────────────────
test('label override ชนะ fallback — ใช้ตอน container อ่านจาก useLanguageStore', () => {
  const html = render({
    state: 'online',
    queuedCount: 5,
    label: 'Online',
    pendingLabel: 'pending',
  });
  assert.match(html, /Online/);
  assert.match(html, /pending/);
});

test('fallback: ไม่ส่ง label/pendingLabel = ข้อความไทย literal (badge ห้ามข้อความว่าง)', () => {
  const html = render({ state: 'offline', queuedCount: 2 });
  assert.match(html, /ออฟไลน์/);
  assert.match(html, /2 รายการรอส่ง/);
  const htmlOnline = render({ state: 'online', queuedCount: 0 });
  assert.match(htmlOnline, /ออนไลน์/);
  const htmlSyncing = render({ state: 'syncing', queuedCount: 0 });
  assert.match(htmlSyncing, /กำลังซิงก์/);
});

// ── ปุ่มซิงก์เอง (คลิกได้เมื่อมีสิ่งให้ทำ) ──────────────────────────────────────
test('มี onSync = เรนเดอร์เป็น <button> (กดซิงก์ได้จาก badge)', () => {
  const html = render({ state: 'offline', queuedCount: 3, onSync: () => undefined, label: 'Offline', pendingLabel: '3 pending' });
  assert.match(html, /<button/);
  assert.match(html, /3/);
});

test('ไม่มี onSync = เรนเดอร์เป็น <span> (สถานะเพียว ๆ ห้ามปุ่มลอย)', () => {
  const html = render({ state: 'online', queuedCount: 0, label: 'Online', pendingLabel: 'pending' });
  assert.match(html, /<span/);
  assert.doesNotMatch(html, /<button/);
});