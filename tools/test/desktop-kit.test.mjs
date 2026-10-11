#!/usr/bin/env node
/* ── แอปเดสก์ท็อป (Electron) ต้องไปกับชุดติดตั้ง + ติดตั้งได้ที่เครื่องอื่น ──────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (เจ้าของสั่ง 11/10/69):
   "ผมไม่ได้หมายถึงเว็บ ผมหมายถึง app desktop ที่จะไปติดตั้งอีกเครื่อง"
   — ชุดติดตั้งเดิมมีแต่ agent-runner: ไม่มีซอร์สแอปเดสก์ท็อป ไม่มีตัวประกอบ
     และไม่มีตัวติดตั้งฝั่งเครื่องปลายทาง ⇒ เครื่องใหม่ไม่มีแอปให้เปิดเลย

   เทสต์นี้เฝ้า 3 อย่าง:
   1) ชุดติดตั้ง (fullKitFiles) ต้องมี "ทุกชิ้นที่แอปต้องใช้ตอนรัน": overlay (main/preload/
      wizard/offline/tray) · ตัว build static (ทุกหน้าที่แอปโหลด) · ตัวจัด dist-portable
   2) electron-builder ต้องแพ็กของครบทุกฟังก์ชั่น: static export (out) + sidecar core-api
      (dist/prisma/node_modules) — ถ้าใครถอดออก แอปจะเหลือแค่เปลือก
   3) โฟลเดอร์ติดตั้งต้องมีเส้นทางแอปเดสก์ท็อปจริง: PACK-DESKTOP.mjs (เรียกตัวประกอบ
      ของโปรเจ็ก ไม่มีสูตรซ้ำ) · BUILD-DESKTOP.cmd · INSTALL-DESKTOP.cmd (ทำงานบน E:)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullKitFiles } from '../agent-pack/pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const INSTALL_DIR = process.env.SOVEREIGN_INSTALL_DIR || 'E:\\My work\\Project Sovereign Origin Install';
const haveInstall = fs.existsSync(path.join(INSTALL_DIR, 'PACK-DESKTOP.mjs'));

describe('ชุดติดตั้งมีแอปเดสก์ท็อปครบชิ้น', () => {
  const files = fullKitFiles(ROOT);
  const set = new Set(files);

  test('overlay ของแอป (main/preload/wizard/offline/tray) อยู่ในชุด', () => {
    const required = [
      'sovereign-frontend/electron/main.js',
      'sovereign-frontend/electron/preload.js',
      'sovereign-frontend/electron/offline.html',
      'sovereign-frontend/electron/setup-wizard.html',
      'sovereign-frontend/electron/tray-icon.png',
      'sovereign-frontend/electron/download.js',
      'sovereign-frontend/electron/verify-asset.js',
    ];
    for (const rel of required) {
      assert.ok(set.has(rel), `ชุดติดตั้งขาด ${rel} — แอปเดสก์ท็อปที่เครื่องใหม่จะเปิดไม่ขึ้น`);
    }
  });

  test('ตัวประกอบ static export + ตัวจัด dist-portable อยู่ในชุด', () => {
    for (const rel of ['sovereign-frontend/scripts/build-static.mjs', 'tools/build-desktop.mjs', 'sovereign-frontend/package.json']) {
      assert.ok(set.has(rel), `ชุดติดตั้งขาด ${rel} — ประกอบแอปที่เครื่องใหม่ไม่ได้`);
    }
  });

  test('electron-builder แพ็กของครบ: static export + sidecar API (ทุกฟังก์ชั่น)', () => {
    const pkg = JSON.parse(read('sovereign-frontend/package.json'));
    assert.ok(pkg.scripts?.['electron:build'], 'ต้องมีสคริปต์ electron:build');
    const res = pkg.build?.extraResources ?? [];
    const pairs = res.map((r) => `${r.from ?? ''}→${r.to ?? ''}`);
    assert.ok(pairs.some((p) => /(^|\/)out→/.test(p)), 'ต้องมี out/ (หน้าเว็บ static ทุกหน้า) ในชุดแอป');
    assert.ok(pairs.some((p) => /core-api\/dist→/.test(p)), 'ต้องมี core-api/dist (sidecar API) ในชุดแอป');
    assert.ok(pairs.some((p) => /core-api\/prisma→/.test(p)), 'ต้องมี prisma (schema/DB ของ API ในตัว)');
    assert.ok(pairs.some((p) => /core-api\/node_modules→/.test(p)), 'ต้องมี node_modules ของ API — ไม่มี = แอปเปิด API ไม่ได้');
    const electronFiles = pkg.build?.files ?? [];
    assert.ok(electronFiles.includes('electron/**/*'), 'ต้องแพ็ก overlay จากซอร์ส (electron/**/*)');
  });
});

describe('โฟลเดอร์ติดตั้งมีเส้นทางแอปเดสก์ท็อป', () => {
  test('มีตัวประกอบ/ตัวติดตั้งครบ และเรียกตัวจริงของโปรเจ็ก (ไม่มีสูตรซ้ำ)', { skip: !haveInstall }, () => {
    for (const f of ['PACK-DESKTOP.mjs', 'BUILD-DESKTOP.cmd', 'INSTALL-DESKTOP.cmd']) {
      assert.ok(fs.existsSync(path.join(INSTALL_DIR, f)), `ไม่พบ ${f} ในโฟลเดอร์ติดตั้ง`);
    }
    const pack = fs.readFileSync(path.join(INSTALL_DIR, 'PACK-DESKTOP.mjs'), 'utf8');
    assert.match(pack, /electron:build/, 'ต้องเรียกสคริปต์จริงของเว็บ');
    assert.match(pack, /tools'?, ?'?build-desktop\.mjs|build-desktop\.mjs/, 'ต้องเรียก tools/build-desktop.mjs ของโปรเจ็ก');
    assert.match(pack, /DESKTOP-INFO\.json/, 'ต้องเขียนข้อมูลเวอร์ชัน/แฮชของชุดแอป');
    // ห้ามมีสูตรประกอบเองซ้ำ (ก็อป overlay เอง/สร้าง package.json เอง) — เสี่ยง drift แบบที่เคยเกิด
    assert.ok(!/cpSync\(.*electron.*\)/.test(pack), 'ห้ามก็อป overlay เอง — ให้ build-desktop.mjs เป็นคนทำ');
  });

  test('ตัวติดตั้งฝั่งเครื่องปลายทางไม่แตะไดรฟ์ C: และมี shortcut', { skip: !haveInstall }, () => {
    const inst = fs.readFileSync(path.join(INSTALL_DIR, 'INSTALL-DESKTOP.cmd'), 'utf8');
    // ของจริง 11/10/69: ไฟล์นี้หลุดมาเป็น LF ล้วน ⇒ cmd.exe อ่านข้อความไทยเป็นคำสั่ง ติดตั้งไม่สำเร็จตั้งแต่บรรทัดแรก
    const lfOnly = (inst.match(/(?<!\r)\n/g) || []).length;
    assert.equal(lfOnly, 0, `INSTALL-DESKTOP.cmd ต้องเป็น CRLF ทั้งไฟล์ (พบ LF เดี่ยว ${lfOnly}) — cmd.exe รันไฟล์ LF แล้วพัง`);
    assert.match(inst, /E:\\SovereignOS/, 'ค่าเริ่มต้นต้องอยู่บนดิสก์ E: ตามกฎโปรเจ็ก');
    assert.doesNotMatch(inst, /C:\\SovereignOS/, 'ห้ามติดตั้งลงไดรฟ์ C:');
    assert.match(inst, /CreateShortcut/i, 'ต้องทำไอคอนให้เปิดง่ายที่เครื่องปลายทาง');
    assert.match(inst, /robocopy/i, 'ต้องก็อปทั้งชุดแอป (มี runtime + API ในตัว)');
  });
});

describe('ช่องอัปเดตแอปจาก HUB (ไม่ต้อง build ที่เครื่องปลายทาง)', () => {
  test('โฟลเดอร์ติดตั้งมีโหมดเผยแพร่ชุดอัปเดตขึ้น HUB', { skip: !haveInstall }, () => {
    const pack = fs.readFileSync(path.join(INSTALL_DIR, 'PACK-DESKTOP.mjs'), 'utf8');
    assert.match(pack, /--publish/, 'PACK-DESKTOP ต้องมีโหมด --publish เผยแพร่เข้า HUB');
    assert.match(pack, /desktop-updates/, 'ต้องส่งชุดอัปเดตเข้าโฟลเดอร์ที่ API ให้บริการ');
    assert.match(pack, /sha256/, 'manifest ต้องมีแฮชไว้ให้เครื่องลูกตรวจ');
  });

  test('HUB มีทางให้เครื่องลูกถามเวอร์ชัน + โหลดชุดอัปเดต และแอปเป็นคนตรวจเอง', () => {
    const svc = read('sovereign-os/core-api/src/services/desktop-update.service.ts');
    assert.match(svc, /export function readDesktopManifest/, 'ต้องมีตัวอ่าน manifest ฝั่ง HUB');
    assert.match(svc, /export async function resolveVerifiedDesktopAsset/, 'ต้องตรวจแฮช/ขนาดก่อนปล่อยไฟล์');
    assert.match(svc, /hashFileStream/, 'ต้องแฮชแบบสตรีม — ไฟล์ติดตั้งระดับร้อย MB ห้ามอ่านทั้งก้อน');
    const routes = read('sovereign-os/core-api/src/modules/agent-machines/agent-machines.routes.ts');
    assert.match(routes, /desktop-update\/manifest/, 'ต้องมี route บอกเวอร์ชันล่าสุด');
    assert.match(routes, /desktop-update\/asset/, 'ต้องมี route ส่งไฟล์ให้เครื่องลูก');
    const main = read('sovereign-frontend/electron/main.js');
    assert.match(main, /desktop-update\/manifest/, 'แอปต้องถาม HUB ว่ามีเวอร์ชันใหม่ไหม');
    assert.match(main, /desktop-update\/asset/, 'แอปต้องโหลดชุดใหม่จาก HUB ได้');
  });
});
