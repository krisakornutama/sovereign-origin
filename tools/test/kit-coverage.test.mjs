#!/usr/bin/env node
/* ── ชุดติดตั้งเครื่องอื่นต้องครอบคลุม "ทุกส่วน" ของโปรเจ็ก ────────────────────────
   ปัญหาที่เทสต์ชุดนี้ล็อกไว้ (เจ้าของสั่ง 11/10/69):
   "Project Sovereign Origin Install ไฟล์นี้ทั้งไฟล์มันครอบคลุมทุกส่วนของโปรเจ็กผมหรอ"
   — ตอนนั้นชุดมีแค่ agent-runner รวม ~14 ไฟล์ ⇒ เครื่องใหม่ได้แค่โหนดรับคำสั่ง
     ไม่ใช่ทั้งโปรเจ็ก (เว็บ/API/ฐานข้อมูล/เครื่องมือ หายไปหมด)

   เทสต์นี้เฝ้า 4 อย่าง:
   1) pack.fullKitFiles() ต้องเดินจากดิสก์จริงและได้ครบทุกส่วน (เว็บ · API · prisma ·
      docker · runner · tools · docs · ไฟล์เปิดระบบ)
   2) ไฟล์ใต้โฟลเดอร์โค้ดที่สำคัญ (pages/, core-api/src/, agent-runner/src/) ต้องไปครบทุกไฟล์
      — ไม่ใช่แค่มีโฟลเดอร์ชื่อถูก (คัดลอกไม่ครบเงียบ ๆ = เครื่องใหม่พังโดยไม่มีใครรู้)
   3) ของที่ห้ามหลุดต้องไม่หลุด: .env · node_modules · .next · backups/logs/data ·
      .freebuff · tools/Git · dist-* (มี machine token) · โมเดล Ollama (โดยดีฟอลต์)
   4) ค่าตั้งต้นของเครื่องมือต้องเป็นชุดเต็ม (BUILD-KIT.mjs / MAKE-MACHINE.mjs / pack.mjs CLI)
      และไฟล์ในชุด OTA ต้องเป็นเซตย่อยของชุดเต็ม (สองรายการจะได้ไม่ตกลงกันไม่ได้)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullKitFiles, bundleFiles } from '../agent-pack/pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** โฟลเดอร์ติดตั้งที่เจ้าของแยกไว้ (อยู่นอกรีโป) — ตรวจเมื่อมีจริงเท่านั้น */
const INSTALL_DIR = process.env.SOVEREIGN_INSTALL_DIR || 'E:\\My work\\Project Sovereign Origin Install';
const haveInstall = fs.existsSync(path.join(INSTALL_DIR, 'BUILD-KIT.mjs'));

/** เดินไฟล์ใต้โฟลเดอร์หนึ่ง (ใช้เทียบว่า \"ไปครบทุกไฟล์\" จริง ไม่ใช่แค่มีชื่อโฟลเดอร์) */
function walkRel(dir, out = [], prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkRel(path.join(dir, entry.name), out, rel);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** ไฟล์ชุด OTA (rel แบบ bundleFiles) → path จริงในชุดเต็ม */
function otaPathInKit(rel) {
  if (rel === 'setup-machine.mjs' || rel === 'SETUP-MACHINE.cmd' || rel === 'run-runner.cmd') {
    return `tools/agent-pack/${rel}`;
  }
  return `sovereign-os/agent-runner/${rel}`;
}

describe('ชุดติดตั้ง = ทั้งโปรเจ็ก (ไม่ใช่แค่ agent-runner)', () => {
  const files = fullKitFiles(ROOT);
  const set = new Set(files);

  test('มีทุกส่วนหลักของโปรเจ็ก', () => {
    const required = [
      // ไฟล์เปิดระบบ/เอกสารรากโปรเจ็ก
      'AGENTS.md',
      'package.json',
      'launcher-server.mjs',
      'launcher.html',
      'launcher.bat',
      'start-sovereign.bat',
      'setup-first-time.bat',
      // เว็บ
      'sovereign-frontend/package.json',
      'sovereign-frontend/src/pages/dashboard.tsx',
      'sovereign-frontend/src/pages/machine-console.tsx',
      // API + ฐานข้อมูล + docker
      'sovereign-os/core-api/package.json',
      'sovereign-os/core-api/src/routes.ts',
      'sovereign-os/core-api/prisma/schema.prisma',
      'sovereign-os/infra/docker-compose.yml',
      // runner + ตัวติดตั้งเครื่องลูก
      'sovereign-os/agent-runner/package.json',
      'sovereign-os/agent-runner/src/main.mjs',
      'tools/agent-pack/pack.mjs',
      'tools/agent-pack/setup-machine.mjs',
      'tools/agent-pack/SETUP-MACHINE.cmd',
      // เครื่องมือ/เอกสาร
      'tools/verify.mjs',
      'docs/ARCHITECTURE.md',
    ];
    for (const rel of required) {
      assert.ok(set.has(rel), `ชุดติดตั้งขาด ${rel} (ทั้งโปรเจ็กต้องมีส่วนนี้)`);
    }
  });

  test('ไฟล์โค้ดใต้โฟลเดอร์สำคัญไปครบทุกไฟล์ (ไม่ใช่แค่มีโฟลเดอร์)', () => {
    const trees = [
      'sovereign-frontend/src/pages',
      'sovereign-frontend/src/components',
      'sovereign-os/core-api/src',
      'sovereign-os/agent-runner/src',
    ];
    let checked = 0;
    for (const tree of trees) {
      const abs = path.join(ROOT, tree);
      if (!fs.existsSync(abs)) continue;
      for (const rel of walkRel(abs)) {
        checked += 1;
        assert.ok(set.has(`${tree}/${rel}`), `ชุดติดตั้งขาด ${tree}/${rel}`);
      }
    }
    assert.ok(checked > 150, `ต้องตรวจไฟล์จริงพอสมควร (ตรวจได้ ${checked} ไฟล์) — ถ้าน้อยกว่านี้คือเดินไม่ถึงโฟลเดอร์จริง`);
    // กันกรณีชุดหดกลับไปเป็นชุดเล็กแบบเดิม (14 ไฟล์) แล้วเทสต์ยังผ่าน
    assert.ok(files.length > 300, `ชุดติดตั้งต้องมีไฟล์มากกว่านี้ (ได้ ${files.length})`);
    assert.ok(
      files.filter((f) => f.startsWith('sovereign-frontend/src/pages/')).length > 50,
      'หน้าทั้งหมดของเว็บต้องไปครบ',
    );
  });

  test('ของที่ห้ามหลุดต้องไม่หลุด', () => {
    const patterns = [
      [/(^|\/)node_modules\//, 'node_modules'],
      [/(^|\/)\.next\//, '.next'],
      [/(^|\/)\.env$/, 'ไฟล์ความลับ .env'],
      [/(^|\/)\.env\.(local|production|development|test)$/, 'ไฟล์ความลับ .env.local / .env.production'],
      [/^backups\//, 'backups'],
      [/^logs\//, 'logs'],
      [/^\.freebuff\//, '.freebuff'],
      [/^tools\/Git\//, 'tools/Git (PortableGit ประจำเครื่อง)'],
      [/^dist-/, 'เอาต์พุตของตัวแพ็กเอง (มี machine token)'],
      [/^Ollama\//, 'โมเดล Ollama (ต้องเติม --with-ollama ถ้าต้องการ)'],
      [/\.(log|tmp|pid)$/, 'ไฟล์ชั่วคราว/บันทึก'],
    ];
    for (const rel of files) {
      for (const [re, why] of patterns) {
        assert.ok(!re.test(rel), `ห้ามยก ${why} ไปกับชุดติดตั้ง (เจอ ${rel})`);
      }
    }
  });

  test('ตัวอย่าง env (.env.example) ต้องไปด้วย — ไม่งั้นเครื่องใหม่ตั้งค่าไม่ได้', () => {
    const examples = files.filter((f) => /\.env\.example$/.test(f));
    assert.ok(examples.length > 0, 'ต้องมีอย่างน้อย .env.example ของ agent-runner ติดไปกับชุด');
    assert.ok(
      files.some((f) => f.startsWith('sovereign-os/agent-runner/') && f.endsWith('.env.example')),
      'agent-runner/.env.example ต้องอยู่ในชุด (OTA ใช้ไฟล์นี้ด้วย)',
    );
  });

  test('การยกเว้นต้องมีผลจริง — ของที่อยู่บนดิสก์ต้องไม่ถูกยกไป', () => {
    const mustNotTravel = ['sovereign-os/infra/.env', 'backups', 'logs', '.freebuff', 'tools/Git', 'sovereign-frontend/node_modules'];
    let present = 0;
    for (const rel of mustNotTravel) {
      if (!fs.existsSync(path.join(ROOT, rel))) continue; // เครื่องที่ไม่มีของนี้ = ไม่มีอะไรต้องกัน
      present += 1;
      assert.ok(
        !files.some((f) => f === rel || f.startsWith(`${rel}/`)),
        `${rel} มีอยู่บนดิสก์ แต่ต้องไม่ถูกยกไปกับชุดติดตั้ง`,
      );
    }
    assert.ok(present > 0, 'ต้องเจอของที่ต้องกันอย่างน้อยหนึ่งรายการ (ไม่งั้นเทสต์นี้ไม่ได้ตรวจอะไร)');
  });

  test('ไฟล์ชุด OTA ต้องเป็นส่วนย่อยของชุดเต็ม (สองรายการตกลงกันได้)', () => {
    for (const rel of bundleFiles(ROOT)) {
      assert.ok(set.has(otaPathInKit(rel)), `ชุด OTA มี ${rel} แต่ชุดเต็มไม่มี (${otaPathInKit(rel)})`);
    }
  });
});

describe('ค่าตั้งต้นของเครื่องมือ = ชุดเต็ม', () => {
  test('pack.mjs: CLI ไม่ได้สั่ง --minimal ก็ต้องเป็นชุดเต็ม', () => {
    const src = read('tools/agent-pack/pack.mjs');
    assert.match(src, /export function fullKitFiles/, 'ต้องมีรายการไฟล์ทั้งโปรเจ็ก');
    assert.match(src, /fullKit: !flags\.has\('minimal'\)/, 'ค่าเริ่มต้นของ CLI ต้องเป็นชุดเต็ม');
    assert.match(src, /--full\s/, 'ต้องมีคำอธิบาย --full ใน help ให้ผู้ใช้รู้ว่ามีชุดเต็ม');
  });

  test('โฟลเดอร์ติดตั้งใช้ชุดเต็ม + มีตาราง FUNCTIONS.md', { skip: !haveInstall }, () => {
    const kit = fs.readFileSync(path.join(INSTALL_DIR, 'BUILD-KIT.mjs'), 'utf8');
    assert.match(kit, /fullKitFiles/, 'BUILD-KIT ต้องประกอบจากทั้งโปรเจ็ก');
    assert.match(kit, /FUNCTIONS\.md/, 'ต้องเขียนตารางว่าชุดนี้ครอบคลุมอะไร (เจ้าของตรวจด้วยตาได้)');
    assert.match(kit, /minimal/, 'ต้องมีทางถอยไปชุดเล็กได้');

    const make = fs.readFileSync(path.join(INSTALL_DIR, 'MAKE-MACHINE.mjs'), 'utf8');
    assert.match(make, /'--full'/, 'ชุดต่อเครื่องต้องเป็นชุดเต็มเป็นค่าตั้งต้น');
    assert.match(make, /'--minimal'/, 'ต้องถอยไปชุดเล็กได้');
  });
});
