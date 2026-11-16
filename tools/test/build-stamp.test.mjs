#!/usr/bin/env node
// build stamp — "กันลืมรัน write-build-info ก่อน deploy"
//
// เคสจริง 16/11/69: `/api/health` ตอบ commit ได้ก็ต่อเมื่อมี `core-api/data/build-info.json`
// (คอนเทนเนอร์ไม่มี .git) — แต่ไม่มีใครบังคับให้เขียนไฟล์นั้นก่อน `docker restart`
// ⇒ restart ไปแล้ว health จะรายงาน commit เก่า (หรือ null) ทั้งที่โค้ดใหม่ขึ้นแล้ว
// เทสต์นี้ปักหมุดว่า (1) ตรวจได้ว่า stamp เก่ากว่า HEAD (2) deploy wrapper เขียน stamp ให้เองก่อน restart
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stampStatus, buildStampPayload } from '../write-build-info.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'write-build-info.mjs');
const DEPLOY = path.join(HERE, '..', 'deploy-core-api.mjs');

function tmpStamp(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  const file = path.join(dir, 'build-info.json');
  if (body !== undefined) fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return file;
}

describe('stampStatus', () => {
  test('commit ตรงกับ HEAD = ok', () => {
    assert.equal(stampStatus({ commit: 'abc123def456' }, 'abc123def456'), 'ok');
  });

  test('commit ต่างจาก HEAD = stale (deploy ไปแล้ว health จะโกหก)', () => {
    assert.equal(stampStatus({ commit: 'abc123def456' }, '999999999999'), 'stale');
  });

  test('ไม่มีไฟล์ / ไฟล์เสีย / ไม่มี commit = missing', () => {
    assert.equal(stampStatus(null, 'abc123def456'), 'missing');
    assert.equal(stampStatus({}, 'abc123def456'), 'missing');
    assert.equal(stampStatus({ commit: '   ' }, 'abc123def456'), 'missing');
  });

  test('เทียบแบบ prefix: stamp 12 ตัวแรกของ HEAD เต็ม 40 ตัวก็นับว่า ok', () => {
    assert.equal(
      stampStatus({ commit: 'abc123def456' }, 'abc123def4567890123456789012345678901234'),
      'ok',
    );
  });
});

describe('buildStampPayload', () => {
  test('ตัด commit เหลือ 12 ตัว แต่เก็บ full ไว้ และติดธง dirty', () => {
    const p = buildStampPayload({
      commitFull: 'abc123def4567890123456789012345678901234',
      branch: 'main',
      dirty: true,
      now: new Date('2026-11-16T20:00:00.000Z'),
    });
    assert.equal(p.commit, 'abc123def456');
    assert.equal(p.commitFull, 'abc123def4567890123456789012345678901234');
    assert.equal(p.branch, 'main');
    assert.equal(p.dirty, true);
    assert.equal(p.builtAt, '2026-11-16T20:00:00.000Z');
  });

  test('ไม่มี commit (ไม่มี git) = null ไม่ใช่สตริงว่าง', () => {
    const p = buildStampPayload({ commitFull: '', branch: '', dirty: false, now: new Date(0) });
    assert.equal(p.commit, null);
    assert.equal(p.commitFull, null);
    assert.equal(p.branch, null);
  });
});

describe('CLI --check', () => {
  test('stamp เก่ากว่า HEAD → exit 1 และบอกทั้งสองค่า', () => {
    const file = tmpStamp({ commit: 'aaaaaaaaaaaa' });
    const r = spawnSync(process.execPath, [TOOL, '--check', '--stamp', file, '--head', 'bbbbbbbbbbbb'], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /aaaaaaaaaaaa/);
    assert.match(out, /bbbbbbbbbbbb/);
    assert.match(out, /เก่า|stale/i);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('stamp ตรงกับ HEAD → exit 0', () => {
    const file = tmpStamp({ commit: 'abc123def456' });
    const r = spawnSync(process.execPath, [TOOL, '--check', '--stamp', file, '--head', 'abc123def456'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('ไม่มีไฟล์ stamp → exit 1 พร้อมบอกว่าต้องรันอะไร', () => {
    const file = tmpStamp(undefined);
    const r = spawnSync(process.execPath, [TOOL, '--check', '--stamp', file, '--head', 'abc123def456'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /write-build-info/);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});

describe('deploy-core-api', () => {
  test('--dry-run: เขียน stamp ให้เอง + แสดงคำสั่ง docker restart แต่ไม่รันจริง', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
    const stamp = path.join(dir, 'build-info.json');
    const r = spawnSync(process.execPath, [DEPLOY, '--dry-run', '--stamp', stamp, '--head', 'abc123def456'], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, out);
    assert.match(out, /docker restart sovereign-core-api/);
    assert.match(out, /DRY-RUN|dry-run/i);
    const written = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    assert.equal(written.commit, 'abc123def456', 'ต้องเขียน stamp ใหม่จาก HEAD ที่กำหนด');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ไฟล์ tool มีอยู่จริงและอ้างถึง health (ยืนยันหลัง restart)', () => {
    const src = fs.readFileSync(DEPLOY, 'utf8');
    assert.match(src, /\/api\/health/);
    assert.match(src, /commit/);
  });
});
