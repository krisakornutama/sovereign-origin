#!/usr/bin/env node
// prod-build-check — "prod รัน build เก่ากว่าที่ควรหรือเปล่า"
//
// เคสจริง: โค้ดขึ้น main แล้วแต่คอนเทนเนอร์ยังไม่ restart ⇒ /api/health ยังรายงาน
// commit เก่า และไม่มีใครรู้จนของพัง · ด่านนี้เทียบ health.build.commit กับ HEAD
// แล้วเตือน/ล้มให้เห็นก่อนที่คนอื่นจะเจอ
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { compareBuildCommit, judgeProdBuild } from '../prod-build-check.mjs';
import { judgeProdBuild as smokeJudge, summarize } from '../host-smoke.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'prod-build-check.mjs');

/** เสิร์ฟ /api/health ปลอมด้วยพอร์ตสุ่ม — ยิงของจริง ไม่ได้ mock fetch */
function serveHealth(body) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404).end('{}');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const health = (commit) => ({ status: 'ok', build: { commit, builtAt: '2026-11-16T21:00:00.000Z' } });

describe('compareBuildCommit', () => {
  test('ตรงกัน (รวมแบบ prefix) = match', () => {
    assert.equal(compareBuildCommit('abc123def456', 'abc123def456'), 'match');
    assert.equal(compareBuildCommit('abc123def456', 'abc123def4567890abcdef1234567890abcdef12'), 'match');
  });

  test('prod เป็นคนละรุ่น = stale', () => {
    assert.equal(compareBuildCommit('aaaaaaaaaaaa', 'bbbbbbbbbbbb'), 'stale');
  });

  test('ไม่มี commit (null/ว่าง) = unknown ไม่ใช่ match', () => {
    assert.equal(compareBuildCommit(null, 'bbbbbbbbbbbb'), 'unknown');
    assert.equal(compareBuildCommit('   ', 'bbbbbbbbbbbb'), 'unknown');
    assert.equal(compareBuildCommit('aaaaaaaaaaaa', ''), 'unknown');
  });
});

describe('judgeProdBuild', () => {
  test('match = ผ่าน', () => {
    const r = judgeProdBuild(health('abc123def456'), 'abc123def456');
    assert.equal(r.status, 'match');
    assert.equal(r.ok, true);
  });

  test('stale = ไม่ผ่าน พร้อมบอกทั้งสองค่า + ทางแก้', () => {
    const r = judgeProdBuild(health('aaaaaaaaaaaa'), 'bbbbbbbbbbbb');
    assert.equal(r.status, 'stale');
    assert.equal(r.ok, false);
    assert.match(r.detail, /aaaaaaaaaaaa/);
    assert.match(r.detail, /bbbbbbbbbbbb/);
    assert.match(r.detail, /deploy-core-api/);
  });

  test('health ที่ไม่มี build.commit = unknown (ไม่กล่าวหาว่า stale)', () => {
    const r = judgeProdBuild({ status: 'ok' }, 'bbbbbbbbbbbb');
    assert.equal(r.status, 'unknown');
    assert.equal(r.ok, true, 'ข้อมูลไม่พอ = เตือน แต่ไม่ทำให้ล้ม');
  });
});

describe('CLI', () => {
  test('prod ตรง HEAD = exit 0', async () => {
    const { server, url } = await serveHealth(health('abc123def456'));
    const r = await runTool(['--url', `${url}/api/health`, '--head', 'abc123def456']);
    server.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ตรงกับ/);
  });

  test('prod เก่ากว่า HEAD = exit 1 + บอก commit ที่ prod รันกับ HEAD', async () => {
    const { server, url } = await serveHealth(health('aaaaaaaaaaaa'));
    const r = await runTool(['--url', `${url}/api/health`, '--head', 'bbbbbbbbbbbb']);
    server.close();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /aaaaaaaaaaaa/);
    assert.match(r.out, /bbbbbbbbbbbb/);
    assert.match(r.out, /deploy-core-api/);
  });

  test('--warn: prod เก่าแต่ไม่ล้ม (exit 0) — ใช้ใน preflight ที่ยังไม่ deploy', async () => {
    const { server, url } = await serveHealth(health('aaaaaaaaaaaa'));
    const r = await runTool(['--url', `${url}/api/health`, '--head', 'bbbbbbbbbbbb', '--warn']);
    server.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⚠/);
  });

  test('prod ไม่ตอบ = exit 2 (แยกจาก stale) และไม่ทำให้ preflight ล้ม', async () => {
    const r = await runTool(['--url', 'http://127.0.0.1:9', '--head', 'bbbbbbbbbbbb', '--timeout', '800']);
    assert.equal(r.code, 2, r.out);
  });
});

describe('host-smoke integration', () => {
  test('stale เป็นข้อเตือน (soft) — ไม่ทำให้ host-smoke ล้ม', () => {
    const soft = smokeJudge(health('aaaaaaaaaaaa'), 'bbbbbbbbbbbb');
    assert.equal(soft.ok, false);
    assert.equal(soft.critical, false, 'ต้องเป็น soft เพื่อไม่ให้ขัดคำสั่ง deploy ปกติ');
    const result = summarize([{ name: 'API /api/health', ok: true, detail: 'ok', critical: true }, soft]);
    assert.equal(result.ok, true, 'มีแต่ข้อเตือน = ยังผ่าน');
    assert.equal(result.failedSoft.length, 1);
  });
});
