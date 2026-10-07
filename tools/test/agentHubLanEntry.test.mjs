#!/usr/bin/env node
/* กันเครื่องใน LAN ถูกบอกให้ชี้ HUB ไปที่ API ที่ผูก loopback เท่านั้น

   บั๊กจริง (เจอ 7 ต.ค. 2569): infra/docker-compose.yml ประกาศ core-api เป็น
   `127.0.0.1:3001:3001` ⇒ เครื่องที่ 2 ใน LAN ต่อ :3001 ไม่ติด แต่ .env.example +
   INSTALL-HUB.md สอนให้ใส่ `HUB_URL=http://<IP-โน้ตบุ๊ค>:3001` → ติดตั้ง "สำเร็จ"
   แต่ runner รายงาน "ติดต่อ HUB ไม่ได้" ทุก 15 วินาที ไม่มีอะไรบอกสาเหตุ

   ทางที่ใช้ได้จริงคือ :3000 (frontend prod ที่ bind 0.0.0.0) ซึ่ง rewrite /api/* → 127.0.0.1:3001
   พิสูจน์แล้ว: GET http://<LAN-IP>:3000/api/health = 200 · POST .../heartbeat + multipart = 401 จาก core-api

   เขียนเทสต์นี้ก่อนแก้เอกสาร → ต้องแดงก่อน (exit 1) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const COMPOSE = 'sovereign-os/infra/docker-compose.yml';
const ENV_EXAMPLE = 'sovereign-os/agent-runner/.env.example';
const INSTALL_DOC = 'sovereign-os/agent-runner/INSTALL-HUB.md';
const RUNNER_README = 'sovereign-os/agent-runner/README.md';
const ARCH_DOC = 'docs/ARCHITECTURE.md';

/** host ที่ประกาศไว้หน้าพอร์ตของ container: `- "127.0.0.1:3001:3001"` → `127.0.0.1` */
export function publishedHosts(composeText, containerPort) {
  const re = new RegExp(
    '^\\s*-\\s*"?([^"\\s#]*):' + containerPort + ':' + containerPort + '"?\\s*(?:#.*)?$',
    'gm'
  );
  return [...composeText.matchAll(re)].map((m) => m[1]);
}

export function isLoopbackHost(host) {
  return host === 'localhost' || /^127\./.test(host);
}

/** ทุกตัวอย่าง `HUB_URL=http://...` ที่ผู้ใช้อ่านแล้วคัดลอกตามได้ */
function hubUrlExamples(text) {
  return [...text.matchAll(/HUB_URL\s*=\s*https?:\/\/[^\s`"'|]+/g)].map((m) => m[0]);
}

test('ตรวจสมมติฐาน: core-api :3001 ถูกประกาศแบบ loopback เท่านั้น', () => {
  const hosts = publishedHosts(read(COMPOSE), '3001');
  assert.ok(hosts.length > 0, `ต้องเจอ mapping :3001 ใน ${COMPOSE}`);
  assert.ok(
    hosts.every(isLoopbackHost),
    `สมมติฐานของเทสต์ชุดนี้คือ API ไม่เห็นจาก LAN (พบ host: ${hosts.join(', ')}) — ` +
      'ถ้าเปิด API สู่ LAN จริงแล้ว ให้ทบทวนเอกสาร runner ทั้งชุดก่อนแก้เทสต์นี้'
  );
});

test('.env.example: HUB_URL ต้องชี้ :3000 พร้อมบอกเหตุผลว่า :3001 ผูก loopback', () => {
  const text = read(ENV_EXAMPLE);
  const lines = text.split(/\r?\n/).filter((l) => /^\s*(#\s*)?HUB_URL\s*=/.test(l));
  assert.ok(lines.length > 0, `ต้องมีบรรทัด HUB_URL ใน ${ENV_EXAMPLE}`);
  for (const line of lines) {
    assert.ok(!/:3001\b/.test(line), `ห้ามให้ HUB_URL ชี้ :3001 (เครื่องใน LAN ต่อไม่ติด) → ${line.trim()}`);
    assert.match(line, /:3000\b/, `ตัวอย่าง HUB_URL ต้องชี้ :3000 → ${line.trim()}`);
  }
  assert.match(
    text,
    /127\.0\.0\.1:3001/,
    'ต้องเขียนเหตุผลตรง ๆ ว่าทำไมไม่ใช่ :3001 (API ผูกกับ 127.0.0.1 เท่านั้น) — ผู้อ่านจะได้ไม่ไปแก้กลับ'
  );
});

test('INSTALL-HUB.md: ตัวอย่าง HUB_URL ต้องเป็น IP ใน LAN + :3000 และไม่มี :3001', () => {
  const text = read(INSTALL_DOC);
  const urls = hubUrlExamples(text);
  assert.ok(urls.length > 0, `ต้องมีตัวอย่าง HUB_URL ให้คัดลอกใน ${INSTALL_DOC}`);
  for (const u of urls) assert.ok(!/:3001\b/.test(u), `ห้ามชี้ :3001 → ${u}`);
  assert.ok(urls.some((u) => /:3000\b/.test(u)), 'ต้องมีตัวอย่างที่ชี้ :3000');
  assert.ok(
    urls.some((u) => /:\/\/\d+\.\d+\.\d+\.\d+/.test(u)),
    'ต้องมีตัวอย่างที่ใช้ IP ใน LAN จริง (ไม่ใช่ 127.0.0.1 ซึ่งเป็นของเครื่องเดียวกัน)'
  );
  assert.match(text, /127\.0\.0\.1:3001/, 'ต้องอธิบายเหตุผลว่าทำไมไม่ใช่ :3001');
});

test('README ของ runner: ต้องบอก :3000 และห้ามมีตัวอย่าง HUB_URL ที่ชี้ :3001', () => {
  const text = read(RUNNER_README);
  assert.match(text, /:3000\b/, 'ต้องบอกพอร์ตที่เครื่องใน LAN เข้าถึงได้ (:3000)');
  // :3001 พูดถึงได้ (เพื่อเตือนว่าห้ามใช้) — ที่ห้ามคือ "ตัวอย่างที่คัดลอกตามแล้วพัง"
  for (const u of hubUrlExamples(text)) {
    assert.ok(!/:3001\b/.test(u), `ห้ามมีตัวอย่าง HUB_URL ที่ชี้ :3001 → ${u}`);
  }
});

test('ARCHITECTURE (Deployment จริง): บรรทัดพอร์ตต้องบอกว่า :3001 ผูก loopback', () => {
  const text = read(ARCH_DOC);
  const line = text.split(/\r?\n/).find((l) => /:3001/.test(l) && /:3000/.test(l));
  assert.ok(line, `${ARCH_DOC} ต้องมีบรรทัดที่พูดถึงทั้ง :3001 และ :3000 ในที่เดียว`);
  assert.match(
    line,
    /127\.0\.0\.1:3001|loopback/,
    `บรรทัดพอร์ตต้องระบุว่า :3001 เห็นได้แค่ในเครื่องนี้ → ${line.trim()}`
  );
});

test('สอดคล้องกับความจริง: ถ้า API ผูก loopback เอกสาร runner ห้ามมี HUB_URL :3001 เลย', () => {
  const hosts = publishedHosts(read(COMPOSE), '3001');
  const loopbackOnly = hosts.length > 0 && hosts.every(isLoopbackHost);
  if (!loopbackOnly) return; // API เปิดสู่ LAN แล้ว → :3001 ใช้ได้ เอกสารไม่ผิด
  for (const file of [ENV_EXAMPLE, INSTALL_DOC, RUNNER_README]) {
    for (const u of hubUrlExamples(read(file))) {
      assert.ok(
        !/:3001\b/.test(u),
        `${file} ให้เครื่องใน LAN ชี้ :3001 แต่ API ผูก loopback (${hosts.join(', ')}) → ${u}`
      );
    }
  }
});
