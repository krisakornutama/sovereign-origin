// test/selfUpdateHub.test.mjs — ทดสอบ "อัปเดตโค้ดเองจาก HUB" แบบของจริง (HUB ต้องรันอยู่)
//
// ต่างจาก selfUpdate.test.mjs (ตรรกะล้วน): ที่นี่คุย HTTP จริงกับ HUB, ดาวน์โหลดชุดจริง,
// สลับไฟล์จริงในแซนด์บ็อกซ์ และปล่อยโปรเซสใหม่จริง (detached) เพื่อพิสูจน์ว่า
// "เครื่องลูกอัปเดตตัวเองได้โดยไม่มีใครแตะเครื่อง"
//
// ข้ามเองอย่างสุภาพเมื่อ HUB ไม่ได้รัน/ยังไม่เผยแพร่ชุดอัปเดต (ไม่ทำให้ชุดเทสต์ปกติแดง)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  selfUpdateOnce,
  fetchManifest,
  localVersion,
  readState,
  planBoot,
  markHealthy,
  REJECT_FILE,
  SNAPSHOT_DIR,
  STATE_FILE,
  HANDOFF_EXIT_CODE,
} from '../src/selfUpdate.mjs';

const RUNNER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(RUNNER_ROOT, '..', '..');
/** ที่มาของไฟล์ในชุดติดตั้ง — ต้องตรงกับ bundleSource() ของตัวแพ็ก (ไฟล์ติดตั้งอยู่ที่ tools/agent-pack) */
function sourcePath(rel) {
  const installer = ['setup-machine.mjs', 'SETUP-MACHINE.cmd', 'run-runner.cmd'];
  return installer.includes(rel) ? path.join(REPO_ROOT, 'tools', 'agent-pack', rel) : path.join(RUNNER_ROOT, rel);
}

const SANDBOX_ROOT = path.join(RUNNER_ROOT, '.freebuff', 'tmp');

function loadEnv() {
  const out = {};
  const file = path.join(RUNNER_ROOT, '.env');
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// ค่าจาก env ของโปรเซสชนะ .env (เหมือนที่ main.mjs ทำ) — ใช้รันเทสต์กับ token ที่ไม่ต้องเขียนลงไฟล์
const env = { ...loadEnv(), ...process.env };
const HUB = (env.HUB_URL || '').replace(/\/$/, '');
const TOKEN = env.MACHINE_TOKEN || '';
/** ไม่มี HUB_URL/token ใน .env = เครื่องนี้ไม่ได้ตั้งเป็น runner → ข้าม */
const skip = !HUB || !TOKEN ? 'ไม่มี HUB_URL/MACHINE_TOKEN ใน .env (เครื่องนี้ไม่ได้เป็น runner)' : false;

function newSandbox(tag) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SANDBOX_ROOT, `hub-${tag}-`));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of fs.readdirSync(path.join(RUNNER_ROOT, 'src')).filter((f) => f.endsWith('.mjs'))) {
    fs.copyFileSync(path.join(RUNNER_ROOT, 'src', f), path.join(dir, 'src', f));
  }
  fs.copyFileSync(path.join(RUNNER_ROOT, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

/** ทำให้ไฟล์ในแซนด์บ็อกซ์ "ต่างจากชุดบน HUB" เพื่อจำลองเครื่องที่ยังใช้โค้ดเก่า */
function stale(dir) {
  fs.appendFileSync(path.join(dir, 'src', 'main.mjs'), '\n// ของเก่าบนเครื่องลูก (จำลอง)\n');
}

/**
 * โปรเซสใหม่ในแซนด์บ็อกซ์ที่ "ประกาศตัวได้สำเร็จ":
 * นี่คือโปรแกรมเมอร์จริงที่ main.mjs เขียนในรอบต่อไป — ไม่ใช่โมค
 * ใช้ import() แบบคั่นบรรทัดให้ดูง่าย หนึ่งบรรทัดต่อการอิมปอร์ต
 */
function healthyLauncherBody() {
  // โปรเซสใหม่ในแซนด์บ็อกซ์ที่ประกาศตัวสำเร็จ (import ให้ครบ — เคยพลาด: ไม่ import dirname ⇒ ตายก่อนประกาศตัว)
  const src = [
    "import { planBoot } from './selfUpdate.mjs';",
    "import { dirname } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'const root = dirname(dirname(fileURLToPath(import.meta.url)));',
    'planBoot(root, { log: () => {} });',
    'setTimeout(() => process.exit(0), 800);',
  ].join(String.fromCharCode(10));
  return src;
}
test('อัปเดตโค้ดเองจาก HUB จริง: ดาวน์โหลด → ตรวจ hash → สลับไฟล์ → รันซ้ำไม่ทำอะไร', { skip }, async (t) => {
  let manifest = null;
  try {
    manifest = await fetchManifest({ hubUrl: HUB, token: TOKEN });
  } catch (err) {
    t.skip(`ต่อ HUB ไม่ได้ (${err instanceof Error ? err.message : err})`);
    return;
  }
  if (!manifest) {
    t.skip('HUB ยังไม่เผยแพร่ชุดอัปเดต — รัน node tools/agent-pack/pack.mjs ที่ HUB ก่อน');
    return;
  }

  const dir = newSandbox('apply');
  stale(dir);
  const before = localVersion(dir, manifest.files.map((f) => f.path));
  assert.notEqual(before, manifest.version, 'แซนด์บ็อกซ์ที่จำลองของเก่าต้องไม่ตรงเวอร์ชัน HUB');

  const out = await selfUpdateOnce({ hubUrl: HUB, token: TOKEN, dir, apply: true, restart: false, log: () => {} });
  assert.equal(out.status, 'updated', JSON.stringify(out));
  assert.equal(out.version, manifest.version);

  // ไฟล์ที่ได้ต้องเท่ากับต้นฉบับในโปรเจ็กทุกไบต์ (ไม่ได้แค่ "มีไฟล์")
  for (const f of manifest.files) {
    const got = fs.readFileSync(path.join(dir, f.path));
    const want = fs.readFileSync(sourcePath(f.path));
    assert.deepEqual(got, want, `ไฟล์ไม่ตรงต้นฉบับ: ${f.path}`);
  }
  assert.equal(localVersion(dir, manifest.files.map((f) => f.path)), manifest.version);
  assert.ok(fs.existsSync(path.join(dir, SNAPSHOT_DIR, before)), 'ต้องมีสำเนาของเดิมไว้ย้อนกลับ');

  const again = await selfUpdateOnce({ hubUrl: HUB, token: TOKEN, dir, apply: true, restart: false, log: () => {} });
  assert.equal(again.status, 'up-to-date', 'รอบถัดไปต้องไม่ดาวน์โหลดซ้ำ');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false, 'ไม่มี state ค้างเมื่อไม่ได้รีสตาร์ท');
});

test('โปรเซสใหม่ไม่ขึ้นจริง (ปล่อยโปรเซสจริง) = ย้อนกลับเวอร์ชันเดิมให้เอง', { skip }, async (t) => {
  let manifest = null;
  try {
    manifest = await fetchManifest({ hubUrl: HUB, token: TOKEN });
  } catch {
    t.skip('ต่อ HUB ไม่ได้');
    return;
  }
  if (!manifest) {
    t.skip('HUB ยังไม่เผยแพร่ชุดอัปเดต');
    return;
  }

  const dir = newSandbox('rollback');
  stale(dir);
  const beforeUpdate = fs.readFileSync(path.join(dir, 'src', 'main.mjs'));
  // จำลอง "โค้ดใหม่พังตอน import" — โปรเซสตายก่อนมีโอกาสประกาศตัว (จึงไม่เขียน startedAt)
  fs.writeFileSync(path.join(dir, 'src', 'broken-launcher.mjs'), "throw new Error('จำลองโค้ดใหม่พังตอน import');\n");

  const out = await selfUpdateOnce({
    hubUrl: HUB,
    token: TOKEN,
    dir,
    apply: true,
    restart: true,
    mainRel: 'src/broken-launcher.mjs',
    timeoutMs: 4000,
    pollMs: 150,
    log: () => {},
  });
  assert.equal(out.status, 'rolled-back', JSON.stringify(out));
  assert.equal(out.handoff?.ok, false);
  assert.equal(out.handoff?.rolledBack, true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'src', 'main.mjs')), beforeUpdate, 'ต้องได้โค้ดเดิมของเครื่องคืนมา (ไม่ใช่ของใหม่)');
  const rejected = JSON.parse(fs.readFileSync(path.join(dir, REJECT_FILE), 'utf8'));
  assert.equal(rejected.version, manifest.version, 'ต้องจำเวอร์ชันที่พังไว้ไม่ให้ลองซ้ำ');
  assert.equal(fs.existsSync(path.join(dir, STATE_FILE)), false);
});

test('โปรเซสใหม่ประกาศตัวจริง (ปล่อยโปรเซสจริง) = ส่งงานต่อสำเร็จ + ล้าง state เมื่อสุขภาพดี', { skip }, async (t) => {
  let manifest = null;
  try {
    manifest = await fetchManifest({ hubUrl: HUB, token: TOKEN });
  } catch {
    t.skip('ต่อ HUB ไม่ได้');
    return;
  }
  if (!manifest) {
    t.skip('HUB ยังไม่เผยแพร่ชุดอัปเดต');
    return;
  }

  const dir = newSandbox('handoff');
  stale(dir);
  // โปรเซสใหม่ในแซนด์บ็อกซ์ที่ "ประกาศตัวได้ตรงด้วย module โชว์อิมพอร์ตของตัวเอง":
  // นี่คือโปรแกรมเมอร์จริงที่ main.mjs เขียนในรอบต่อไป — ไม่ใช่โมค
  fs.writeFileSync(
    path.join(dir, 'src', 'healthy-launcher.mjs'),
    healthyLauncherBody(),
    'utf8',
  );

  const out = await selfUpdateOnce({
    hubUrl: HUB,
    token: TOKEN,
    dir,
    apply: true,
    restart: true,
    mainRel: 'src/healthy-launcher.mjs',
    timeoutMs: 15_000,
    pollMs: 200,
    log: () => {},
  });
  assert.equal(out.status, 'restarted', JSON.stringify(out));
  assert.equal(out.handoff?.exitCode, HANDOFF_EXIT_CODE, 'ตัวห่อต้องรู้ว่า "ยกให้โปรเซสใหม่แล้ว" ไม่ใช่ crash');
  assert.ok(readState(dir)?.startedAt, 'โปรเซสใหม่ต้องประกาศตัวไว้ให้ผู้ดูแลเห็น');

  markHealthy(dir, { now: Date.now() });
  assert.equal(planBoot(dir, {}).action, 'cleared', 'รอบถัดไปต้องล้าง state ทิ้งเมื่อรันได้ปกติ');
});
