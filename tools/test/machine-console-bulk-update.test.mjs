#!/usr/bin/env node
/* ── ปุ่ม "อัปเดตทุกเครื่องที่ออนไลน์" + เครื่องที่ปิดอยู่ต้องขึ้นออฟไลน์ ─────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (เจ้าของสั่ง 11/10/69):
   "เพิ่มปุ่มสั่งอัปเดตเครื่องที่ออนไลน์ทั้งหมดพร้อมกัน แล้วโชว์ผลของแต่ละเครื่องกลับมา
    ในหน้าคอนโซลเดียว" และ "ตอนนี้ผมปิดเครื่องอยู่ มันต้องออฟไลน์"

   เทสต์นี้เฝ้า:
   1) ปุ่มสั่งรวมต้องมีจริงในหน้า /machine-console และยิงผ่านช่องควบคุมเดิม (update.apply)
   2) ต้องกรองเฉพาะเครื่องที่ออนไลน์ (เครื่องที่ปิดอยู่ต้องไม่ถูกส่งคำสั่งไปค้างคิว)
   3) ต้องมีตารางผลรายเครื่องในหน้านั้น (ไม่ใช่ยิงแล้วจบ ไม่รู้ว่าใครสำเร็จ)
   4) ฝั่ง HUB ต้องคิดสถานะจากอายุ heartbeat (คอลัมน์ status ใน DB ค้างเป็น online ได้)
      ⇒ มีฟังก์ชันบริสุทธิ์ให้เทสต์ + route ที่ใช้ค่าที่คำนวณจริง
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PAGE = 'sovereign-frontend/src/pages/machine-console.tsx';
const SERVICE = 'sovereign-os/core-api/src/services/agent-machines.service.ts';
const ROUTE_TEST = 'sovereign-os/core-api/tests/agentMachinesRoutes.test.ts';

describe('คอนโซลเครื่อง — สั่งอัปเดตทุกเครื่องที่ออนไลน์พร้อมกัน', () => {
  const page = read(PAGE);

  test('มีปุ่มสั่งรวม + ใช้ช่องควบคุมเดิม (ไม่ต้องมี endpoint ใหม่)', () => {
    assert.match(page, /อัปเดตทุกเครื่องที่ออนไลน์/, 'ปุ่มต้องมีชื่อที่คนอ่านออก');
    assert.match(page, /\/api\/machine-control\/command/, 'ต้องยิงผ่านช่องควบคุมเดิมของ HUB');
    assert.match(page, /type: "update\.apply"/, 'คำสั่งต้องเป็น update.apply (อัปเดต + รีสตาร์ทตัวเอง)');
  });

  test('ส่งเฉพาะเครื่องที่ออนไลน์ — เครื่องที่ปิดอยู่ถูกข้าม', () => {
    assert.match(page, /const onlineMachines = machines\.filter\(\(m\) => m\.status === "online"\)/, 'ต้องกรองเฉพาะออนไลน์');
    assert.match(
      page,
      /disabled=\{bulkBusy \|\| onlineMachines\.length === 0\}/,
      'ไม่มีเครื่องออนไลน์ = ปุ่มต้องกดไม่ได้ (ไม่ยิงคำสั่งไปค้างคิว)',
    );
    assert.match(page, /ยังไม่มีเครื่องที่ออนไลน์ให้สั่ง/, 'ต้องบอกผู้ใช้ตรง ๆ ว่าไม่มีอะไรให้สั่ง');
  });

  test('โชว์ผลของแต่ละเครื่องกลับมาในหน้าคอนโซลเดียว', () => {
    assert.match(page, /const \[bulkRows, setBulkRows\]/, 'ต้องเก็บผลรายเครื่องไว้ในหน้า');
    assert.match(page, /ผลการสั่งอัปเดต/, 'ต้องมีหัวตารางผล');
    assert.match(page, /state: "sent"|"sent"/, 'ต้องแยกผลสำเร็จ');
    assert.match(page, /"failed"/, 'ต้องแยกผลไม่สำเร็จ (ไม่กลืน error)');
  });

  test('เครื่องที่ปิดอยู่ต้องมีคำว่า "ออฟไลน์" ให้เห็น ไม่ใช่จุดเทาเฉย ๆ', () => {
    assert.match(page, /function machineStatusView/, 'ต้องมีที่เดียวที่แปลงสถานะเป็นข้อความ+สี');
    assert.match(page, /ออฟไลน์/, 'ต้องมีข้อความออฟไลน์');
    assert.match(page, /stale_sec/, 'ต้องใช้ค่าอายุสัญญาณจาก HUB (เงียบมากี่นาที)');
  });
});

describe('HUB — สถานะเครื่องคิดจากอายุ heartbeat', () => {
  const service = read(SERVICE);

  test('มีฟังก์ชันบริสุทธิ์ + เกณฑ์ที่ปรับได้', () => {
    assert.match(service, /export const MACHINE_STALE_MS/, 'ต้องมีเกณฑ์กลางที่เดียว (ปรับผ่าน env ได้)');
    assert.match(service, /export function effectiveMachineStatus/, 'ต้องมีฟังก์ชันบริสุทธิ์ให้เทสต์ได้');
    assert.match(service, /export function machineStaleSec/, 'ต้องบอกอายุสัญญาณเป็นวินาทีได้');
  });

  test('disabled คงไว้ · ไม่เคย heartbeat = offline · เกินเกณฑ์ = offline', () => {
    assert.match(service, /if \(row\.status === 'disabled'\) return 'disabled'/, 'คนปิดเองต้องคงเป็น disabled');
    assert.match(service, /if \(!Number\.isFinite\(at\)\) return 'offline'/, 'ยังไม่เคยส่งสัญญาณ = ยังไม่ออนไลน์');
    assert.match(service, /return now - at <= staleMs \? 'online' : 'offline'/, 'เกินเกณฑ์ = offline');
  });

  test('รายการเครื่องที่ส่งให้หน้าเว็บใช้ค่าที่คำนวณจริง ไม่ใช่ค่าดิบใน DB', () => {
    assert.match(service, /status: effectiveMachineStatus\(row, now\)/, 'listMachines ต้องแทนที่ status ด้วยค่าจริง');
    assert.match(service, /stale_sec: machineStaleSec\(row, now\)/, 'ต้องแนบอายุสัญญาณไปให้หน้าเว็บ');
  });

  test('มีเทสต์พฤติกรรมจริงที่ route (กันคนลบเงียบ ๆ)', () => {
    const routeTest = read(ROUTE_TEST);
    assert.match(routeTest, /เครื่องที่ปิดอยู่ต้องขึ้น offline/, 'ต้องมีเทสต์ระดับ route');
    assert.match(routeTest, /m-sleep/, 'ต้องมีเคสเครื่องที่เคย heartbeat แล้วถูกปิด');
  });
});
