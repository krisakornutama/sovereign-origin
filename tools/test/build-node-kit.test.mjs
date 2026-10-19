#!/usr/bin/env node
/* ── ประกอบชุดติดตั้งเครื่องใหม่: ต้องตัดของที่ทำให้เครื่องใหม่พัง ──────────────
   เคสจริง 11/10/69: BUILD-KIT พยายามอ่าน Docker/wsl/disk/docker_data.vhdx (88 GB)
     → node อ่านไฟล์ >2 GB ไม่ได้ (ERR_FS_FILE_TOO_LARGE) → ล้มกลางทั้งชุด
   เคสจริง 12/10/69: ชุดรอบแรกขาด setup-machine.mjs (ตันแบบพาธผิด) และขาด
     node_modules ที่ start-sovereign.bat ต้องใช้ → ต้องจับก่อนเผยแพร่

   เทสต์นี้ล็อก:
     1) ของใหญ่ผิดปกติ (vhdx/โมเดล) ไม่หลุดเข้าชุด
     2) ความลับของเครื่อง HUB (.env/join.json/key) ไม่หลุด
     3) ไฟล์ที่จำเป็นต่อการติดตั้งต้องครบ (ขาด = หยุด ไม่เผยแพร่ของเสีย)
     4) Ollama ตัดตามที่เจ้าของเลือก
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  collectKitFiles,
  missingRequired,
  isSkipped,
  REQUIRED_IN_KIT,
  BUILT_ON_TARGET,
} from '../build-node-kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

describe('isSkipped — ตัดของที่ทำให้เครื่องใหม่พังหรือรั่ว', () => {
  test('vhdx ของ Docker (88 GB) ไม่หลุด — เคสจริงที่ทำให้ BUILD-KIT ล้ม', () => {
    assert.equal(isSkipped('Docker/wsl/disk/docker_data.vhdx'), true);
    assert.equal(isSkipped('Docker/wsl'), true);
  });

  test('โมเดล Ollama (~11 GB) ถูกตัดตามที่เจ้าของเลือก', () => {
    // ค่าเริ่มต้น = ไม่เอา (เจ้าของสั่ง "ก" เมื่อ 12/10/69)
    assert.equal(isSkipped('Ollama'), true);
    assert.equal(isSkipped('Ollama/models/blobs/sha256-abc'), true);
    // สั่ง --with-ollama = เก็บ (แต่ต้องไม่ใช่โค้ดตาย — เคสจริงที่เทสต์นี้จับได้)
    assert.equal(isSkipped('Ollama/models/blobs/sha256-abc', { withOllama: true }), false);
  });

  test('โมเดลเสียง whisper (~465 MB) ถูกตัด', () => {
    assert.equal(isSkipped('tools/whisper.cpp/models/ggml-small.bin'), true);
  });

  test('ข้อมูลรันจริงของเครื่อง HUB ถูกตัด (WAL 25 GB + pgdata)', () => {
    assert.equal(isSkipped('sovereign-os/infra/data/wal-archive/000000010000000000000030'), true);
    assert.equal(isSkipped('sovereign-os/infra/data/pg/base'), true);
    assert.equal(isSkipped('sovereign-os/infra/offsite/sovereign_dump.sql.gz.age'), true);
  });

  test('ความลับของเครื่อง HUB ไม่หลุดเด็ดขาด', () => {
    for (const p of [
      'sovereign-os/core-api/.env',
      'sovereign-os/infra/.env',
      'sovereign-os/agent-runner/.env.local',
      'sovereign-os/core-api/.env.bak.20261004-004100',
      'sovereign-os/infra/.env.bak.20261005-005219',
      'sovereign-frontend/.env.playwright',
      'join.json',
      'age-identity.key',
      'server.pem',
      'server.pem.bak',
      'backup.enc',
    ]) {
      assert.equal(isSkipped(p, { withOllama: false }), true, `${p} ต้องถูกตัด — ถ้าหลุดไปของเครื่อง HUB ไปอยู่เครื่องอื่น`);
    }
  });

  test('ไฟล์ที่ระบบต้องใช้ ต้องไม่ถูกตัด', () => {
    for (const p of [
      'SETUP-NODE.cmd',
      'setup-first-time.bat',
      'start-sovereign.bat',
      'sovereign-os/infra/docker-compose.prod.yml',
      'sovereign-os/infra/.env.example',
      'sovereign-os/core-api/.env.example',
      'sovereign-frontend/.env.local.example',
      'tools/install/sovereign.env.template',
      'tools/agent-pack/setup-machine.mjs',
      'tools/setup-node.mjs',
      'sovereign-os/agent-runner/src/main.mjs',
      'sovereign-frontend/src/pages/index.tsx',
    ]) {
      assert.equal(isSkipped(p, { withOllama: false }), false, `${p} ต้องอยู่ในชุด`);
    }
  });

  test('ชุดส่งมอบ/ตัวติดตั้งที่ build แล้ว ต้องไม่หลุดเข้าชุดเครื่องใหม่', () => {
    for (const p of [
      'release/Sovereign-OS-1.1.1-win-x64/Sovereign-OS-1.1.1-portable.exe',
      'release/README.md',
      'dist-portable-prev-20261019/Sovereign OS.exe',
      'dist-portable-staging/Sovereign OS.exe',
      'sovereign-frontend/out/index.html',
    ]) {
      assert.equal(isSkipped(p, { withOllama: false }), true, `${p} ต้องถูกตัด — เป็น artifact ไม่ใช่ source`);
    }
    assert.equal(isSkipped('sovereign-frontend/src/pages/index.tsx'), false);
  });
});

describe('collectKitFiles — เดินได้จริงและไม่หลุดของต้องห้าม', () => {
  test('รันกับ repo จริง = ต้องไม่มีความลับหลุด และไม่มีไฟล์ใหญ่ผิดปกติ', () => {
    const { files } = collectKitFiles(REPO);
    assert.ok(files.length > 100, `ควรเก็บได้หลายร้อยไฟล์ แต่ได้ ${files.length}`);
    for (const f of files) {
      assert.ok(!/node_modules/.test(f.rel), `node_modules ต้องไม่หลุด: ${f.rel}`);
      const base = f.rel.split('/').pop();
      assert.ok(!base.startsWith('.env') || base.endsWith('.example'), `.env หลุด: ${f.rel}`);
      assert.ok(!f.rel.includes('join.json'), `join.json (มี token) หลุด: ${f.rel}`);
      assert.ok(f.size < 1024 * 1024 * 1024, `ไฟล์ใหญ่ผิดปกติหลุด: ${f.rel} (${f.size})`);
    }
  });

  test('ไม่มี Ollama เว้นแต่สั่ง --with-ollama', () => {
    const noO = collectKitFiles(REPO, { withOllama: false });
    const withO = collectKitFiles(REPO, { withOllama: true });
    assert.ok(!noO.files.some((f) => f.rel.startsWith('Ollama/')));
    assert.ok(withO.files.some((f) => f.rel.startsWith('Ollama/')), '--with-ollama ต้องเก็บ Ollama');
  });
});

describe('missingRequired — ขาด = หยุด ไม่เผยแพร่ของเสีย', () => {
  test('repo จริงต้องมีครบทุกไฟล์ที่จำเป็น', () => {
    const { files } = collectKitFiles(REPO);
    const missing = missingRequired(files);
    assert.equal(missing.length, 0, `ขาด: ${missing.join(', ')}\n(ตรวจพาธใน REQUIRED_IN_KIT ให้ตรงกับที่อยู่จริงใน repo)`);
  });

  test('ขาดไฟล์สำคัญ = รายงานชื่อที่ขาด (เคสจริง: setup-machine.mjs พาธผิด)', () => {
    const missing = missingRequired([{ rel: 'SETUP-NODE.cmd' }]);
    assert.ok(missing.includes('setup-first-time.bat'));
    assert.ok(missing.includes('tools/agent-pack/setup-machine.mjs'));
    assert.ok(!missing.includes('SETUP-NODE.cmd'));
  });

  test('รายการที่ต้องมี ต้องมี start-sovereign.bat (ไม่งั้นระบบไม่ขึ้น)', () => {
    assert.ok(REQUIRED_IN_KIT.includes('start-sovereign.bat'));
    assert.ok(REQUIRED_IN_KIT.includes('setup-first-time.bat'));
  });

  test('ของที่ให้สร้างเองบนเครื่องเป้าหมาย ต้องถูกประกาศ (ไม่งั้นลืมแล้ว build พัง)', () => {
    const fe = BUILT_ON_TARGET.find((b) => b.path.includes('sovereign-frontend'));
    assert.ok(fe, 'ต้องประกาศว่า frontend/node_modules ให้สร้างเอง');
    assert.ok(fe.mb > 100, 'ต้องมีตัวเลขขนาดจริงให้คนอ่านรู้ว่าจะเสียเวลาเท่าไร');
  });
});

describe('ต้องติดตาม git', () => {
  test('build-node-kit.mjs อยู่ใน git', () => {
    const out = spawnSync('git', ['ls-files', 'tools/'], { cwd: REPO, encoding: 'utf8' });
    assert.match(out.stdout, /tools\/build-node-kit\.mjs/, 'ยังไม่ถูก track — .gitignore มี tools/* อย่าลืมเพิ่ม whitelist');
  });
});
