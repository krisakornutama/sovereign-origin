#!/usr/bin/env node
// preflight — ด่านในเครื่องเทียบเท่า CI
//
// เหตุผลที่ต้องมีไฟล์นี้: เรา push แล้วเจอ `audit` แดงเพราะคำไทยในคิว และเคยต้องรอ
// CI ทั้งชุดเพื่อรู้ว่าล้ม — เทสต์นี้ปักหมุดว่า preflight "จับได้จริง" ทั้งคำไทยผิด
// และคีย์ปลอม และ **ห้ามพิมพ์ค่าคีย์ลง log** (นับอย่างเดียว)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  countSecrets,
  totalSecrets,
  formatSecretReport,
  SECRET_PATTERNS,
  countSecretsInGitLog,
  countSecretsInDiffText,
  ROOT,
} from '../preflight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('secret scan — นับอย่างเดียว ไม่รั่วค่า', () => {
  test('จับคีย์ปลอมครบทุกชนิดที่ประกาศไว้', () => {
    const fake = [
      'sk_live_' + 'a'.repeat(24),
      'sk_test_' + 'b'.repeat(24),
      'ghp_' + 'c'.repeat(36),
      'xoxb-' + '1'.repeat(24),
      'AKIA' + 'D'.repeat(16),
      // สร้างจากชิ้นส่วน — ไฟล์เทสต์เองก็ถูกสแกน ถ้าใส่ marker ตรง ๆ จะเป็น false positive
      '-----BEGIN ' + 'RSA PRIVATE KEY' + '-----',
    ].join('\n');
    const counts = countSecrets(fake);
    assert.equal(counts.stripe_live, 1);
    assert.equal(counts.stripe_test, 1);
    assert.equal(counts.github_pat, 1);
    assert.equal(counts.slack_bot, 1);
    assert.equal(counts.aws_key_id, 1);
    assert.equal(counts.private_key, 1);
    assert.equal(totalSecrets(counts), 6);
  });

  test('ข้อความสะอาด = 0 ทุกชนิด', () => {
    const counts = countSecrets('const x = 1; // ไม่มีคีย์');
    assert.equal(totalSecrets(counts), 0);
    assert.equal(formatSecretReport(counts), 'ไม่พบ');
  });

  test('รายงานต้องไม่มีค่าคีย์อยู่ข้างใน (กันหลุดลง terminal/log)', () => {
    const token = 'ghp_' + 'z'.repeat(36);
    const report = formatSecretReport(countSecrets(`token=${token}`));
    assert.equal(report.includes(token), false, 'ห้ามพิมพ์ค่าคีย์');
    assert.equal(report.includes('z'.repeat(20)), false, 'ห้ามพิมพ์แม้บางส่วนของคีย์');
    assert.match(report, /github_pat=1/);
  });

  test('pattern ครอบชนิดหลักครบ', () => {
    for (const k of ['stripe_live', 'stripe_test', 'github_pat', 'slack_bot', 'aws_key_id', 'private_key']) {
      assert.ok(SECRET_PATTERNS[k], `ขาด pattern ${k}`);
    }
  });
});

describe('secret scan — นับเฉพาะบรรทัดที่เพิ่ม', () => {
  test('บรรทัดที่ถุก "ลบ" (ขึ้นด้วย -) ต้องไม่ทำให้ gate ล้ม', () => {
    const key = 'ghp_' + 'w'.repeat(36);
    const patch = [`-const t = '${key}';`, '+const t = process.env.TOKEN;'].join('\n');
    assert.equal(totalSecrets(countSecretsInDiffText(patch)), 0);
  });

  test('บรรทัดที่เพิ่ม (+) ต้องถูกนับ', () => {
    const key = 'ghp_' + 'w'.repeat(36);
    const patch = [`+const t = '${key}';`, '-const t = null;'].join('\n');
    assert.equal(countSecretsInDiffText(patch).github_pat, 1);
  });

  test('หัวไฟล์ +++/--- ของ diff ไม่ถูกนับเป็นความลับ', () => {
    const patch = ['+++ b/app.js', '--- a/app.js'].join('\n');
    assert.equal(totalSecrets(countSecretsInDiffText(patch)), 0);
  });
});

describe('copy gate — จับคำไทยผิดได้จริง', () => {
  // check-copy อ่านไฟล์จากโครงสร้าง <site>/scripts + <site>/../docs — จึงสร้างถ้ำจำลอง
  function makeSandbox(mdBody) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-copy-'));
    fs.mkdirSync(path.join(dir, 'portfolio', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'portfolio', 'scripts', 'check-copy.mjs'),
      path.join(dir, 'portfolio', 'scripts', 'check-copy.mjs'),
    );
    fs.writeFileSync(path.join(dir, 'docs', 'note.md'), mdBody, 'utf8');
    return dir;
  }

  test('คำที่ตกตัวท้ายคำ (โปรเจ็ก) ต้องถูกจับ', () => {
    const dir = makeSandbox('# note\n\nโปรเจ็ก นี้ทำงานได้\n');
    const r = spawnSync(process.execPath, ['scripts/check-copy.mjs'], { cwd: path.join(dir, 'portfolio'), encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'ต้องไม่ผ่านเมื่อมีคำผิด');
    assert.match(r.stdout + r.stderr, /ตกตัวท้ายคำ/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('อักษรละตินติดไทย (คrawl) ต้องถูกจับ', () => {
    const dir = makeSandbox('# note\n\nระบบคrawl ทำงาน\n');
    const r = spawnSync(process.execPath, ['scripts/check-copy.mjs'], { cwd: path.join(dir, 'portfolio'), encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /ไทยติดละติน/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ข้อความสะอาดต้องผ่าน (ด่านไม่กล่าวหาผิด)', () => {
    const dir = makeSandbox('# note\n\nโปรเจ็กต์นี้ทำงานได้ปกติ\n');
    const r = spawnSync(process.execPath, ['scripts/check-copy.mjs'], { cwd: path.join(dir, 'portfolio'), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('preflight — ประกอบขั้นและคืน exit code เดียว', () => {
  test('มีขั้นครบตามที่ประกาศ', async () => {
    const { buildSteps } = await import('../preflight.mjs');
    const names = buildSteps('HEAD', { prod: false }).map((s) => s.name);
    assert.deepEqual(names, ['copy', 'secrets', 'arch-gate', 'frontend-gate', 'host-smoke', 'prod-build', 'promote-web']);
  });

  test('--only ที่ไม่มีขั้นจริง = exit 2 (กันสั่งผิดแล้วเข้าใจว่าผ่าน)', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, '..', 'preflight.mjs'), '--only', 'nope'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });

  test('--only secrets บนเรนจ์สะอาด = exit 0', () => {
    const r = spawnSync(
      process.execPath,
      [path.join(HERE, '..', 'preflight.mjs'), '--only', 'secrets', '--range', 'HEAD~1..HEAD', '--quiet'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('git log ที่มีคีย์ปลอมต้องถูกนับ (stream ไม่ชน maxBuffer)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-git-'));
    const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    fs.writeFileSync(path.join(dir, 'leak.txt'), 'token = ' + 'ghp_' + 'q'.repeat(36) + '\n', 'utf8');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'leak']);
    const res = await countSecretsInGitLog('HEAD', { cwd: dir });
    assert.equal(res.code, 0);
    assert.ok(res.counts.github_pat >= 1, `ต้องนับได้ (ได้ ${JSON.stringify(res.counts)})`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
