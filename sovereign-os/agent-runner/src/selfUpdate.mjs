// src/selfUpdate.mjs — เครื่องลูกอัปเดตโค้ด runner เองจาก HUB
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────────────
// เดิมโค้ดเครื่องลูกถูกส่งด้วยมือ (ก็อปโฟลเดอร์ผ่าน USB) ⇒ แก้บั๊กที่ HUB แล้วเครื่องลูก
// ไม่มีทางได้โค้ดใหม่เลย จนกว่าคนจะเดินไปเสียบ USB — ไฟล์ตกหล่นและเวอร์ชันไม่ตรงกันเป็นเรื่องปกติ
//
// ── วงจร (ไม่มีอะไรต้องพิมพ์ที่เครื่องลูก) ─────────────────────────────────────
//   1) เทียบเวอร์ชัน: เวอร์ชัน = sha256 ของ (ชื่อไฟล์ + hash เนื้อหา) ทุกไฟล์ เรียงชื่อ
//      ⇒ ฝั่ง HUB คำนวณด้วยสูตรเดียวกัน (tools/agent-pack/pack.mjs import ไฟล์นี้)
//      ⇒ ไม่มีไฟล์เก็บเวอร์ชันให้เพี้ยน: คำนวณจากเนื้อไฟล์จริงทั้งสองฝั่ง
//   2) ดาวน์โหลดทั้งชุดลงโฟลเดอร์พัก + ตรวจ sha256 ให้ครบก่อน
//   3) ตรวจไวยากรณ์ (node --check) → เก็บสำเนาของเดิม → สลับไฟล์ → เขียน state ค้าง
//   4) ปล่อยโปรเซสใหม่ (detached) แล้ว "เฝ้า": ถ้าโปรเซสใหม่ไม่ประกาศตัวในเวลาที่กำหนด
//      ⇒ ย้อนกลับไฟล์ชุดเดิมทันที + จำเวอร์ชันนั้นไว้ (ไม่ให้วนอัปเดตซ้ำ)
//
// ⚠️ กฎเหล็ก: ห้ามเขียนทับไฟล์เดิมก่อนที่ทุกไฟล์ใหม่จะผ่านการตรวจ
//    (เครื่องลูกที่โค้ดพังครึ่งทาง = เครื่องนั้นหลุดจาก HUB ถาวรจนกว่าคนจะไปนั่งเครื่อง)
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const STATE_FILE = '.update-state.json';
export const REJECT_FILE = '.update-rejected.json';
export const SNAPSHOT_DIR = '.runner-backup';
/** รหัสออกพิเศษ: "ส่งงานต่อให้โปรเซสใหม่แล้ว" — ตัวเรียก (run-runner.cmd) ห้ามเริ่มรอบใหม่ */
export const HANDOFF_EXIT_CODE = 86;
/** เวอร์ชันที่เพิ่งทำให้เครื่องล่ม — ไม่ลองซ้ำภายในเวลานี้ */
export const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** ไฟล์ที่ยอมให้อยู่ในชุดอัปเดต — นามสกุล/ที่อยู่นอกนี้ถูกปฏิเสธ */
const ALLOWED = /^(src\/[A-Za-z0-9._-]+\.mjs|package\.json|\.env\.example|README\.md|INSTALL-HUB\.md|setup-machine\.mjs|SETUP-MACHINE\.cmd|run-runner\.cmd)$/;

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** เวอร์ชันของชุดไฟล์ — เรียงชื่อก่อนเสมอ ⇒ สองฝั่งคำนวณตรงกันโดยไม่ขึ้นกับลำดับ */
export function computeVersionFromEntries(entries) {
  const lines = [...entries].map((e) => `${e.path}:${e.sha256}`).sort().join('\n');
  return sha256Hex(Buffer.from(lines, 'utf8')).slice(0, 12);
}

/** อ่านไฟล์ตามรายชื่อแล้วคืน hash — ไฟล์ที่หายใช้คำว่า missing (ยังคำนวณเวอร์ชันได้ ไม่โยน error) */
export function readEntries(dir, paths, fsImpl = fsSync) {
  return [...paths].sort().map((rel) => {
    try {
      return { path: rel, sha256: sha256Hex(fsImpl.readFileSync(path.join(dir, rel))) };
    } catch {
      return { path: rel, sha256: 'missing' };
    }
  });
}

export function localVersion(dir, paths, fsImpl = fsSync) {
  return computeVersionFromEntries(readEntries(dir, paths, fsImpl));
}

/** ตัดสินใจจากข้อมูลล้วน ๆ (เทสต์ตรงนี้ได้ ไม่ต้องมีเครือข่าย/ดิสก์) */
export function decideUpdate({ localVersion: local, manifest, rejected, now = Date.now(), cooldownMs = REJECT_COOLDOWN_MS }) {
  if (!manifest?.version) return { action: 'no-bundle', reason: 'HUB ยังไม่ได้เผยแพร่ชุดอัปเดต' };
  if (manifest.version === local) return { action: 'up-to-date', version: manifest.version };
  if (rejected?.version === manifest.version && now - Number(rejected.at || 0) < cooldownMs) {
    return { action: 'skip-rejected', version: manifest.version, reason: rejected.reason || 'เคยFAIL' };
  }
  return { action: 'update', version: manifest.version, localVersion: local };
}

export function readState(dir, fsImpl = fsSync) {
  try {
    return JSON.parse(fsImpl.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(dir, state, fsImpl = fsSync) {
  fsImpl.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2));
}

function readRejected(dir, fsImpl = fsSync) {
  try {
    return JSON.parse(fsImpl.readFileSync(path.join(dir, REJECT_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** กันชื่อไฟล์จากภายนอก (HUB): ต้องอยู่ในรายการที่อนุญาตและไม่มีทางลัดออกนอกโฟลเดอร์ */
function assertSafeRel(rel) {
  const norm = String(rel ?? '').replace(/\\/g, '/');
  const bad = !ALLOWED.test(norm) || norm.includes('..') || path.isAbsolute(norm) || /^[A-Za-z]:/.test(norm);
  if (bad) throw new Error(`ชื่อไฟล์ในชุดอัปเดตไม่ถูกต้อง (path): ${rel}`);
  return norm;
}

/** ตรวจไวยากรณ์ก่อนสลับไฟล์ — ไฟล์ที่โหลดขาดครึ่งจะถูกจับที่นี่ ไม่ใช่ตอนเครื่องล่ม */
async function defaultCheckFile(rel, abs) {
  if (!rel.endsWith('.mjs')) return;
  await promisify(execFile)(process.execPath, ['--check', abs]);
}

/**
 * ดาวน์โหลด → ตรวจ → สลับไฟล์ → เก็บสำเนาเดิม → เขียน state ค้าง
 * คืน { ok, version, fromVersion } · throw เมื่อมีอะไรไม่ผ่าน (ของเดิมไม่ถูกแตะ)
 */
export async function applyUpdate({ dir, version, files, fetchFile, checkFile = defaultCheckFile, fsImpl = fsSync, now = Date.now(), log = () => {} }) {
  const list = [...(files || [])].map((f) => ({ ...f, path: assertSafeRel(f.path) }));
  if (!list.length) throw new Error('ชุดอัปเดตว่างเปล่า — ไม่มีไฟล์ให้ติดตั้ง');
  if (!version) throw new Error('ชุดอัปเดตไม่มีเวอร์ชัน');

  const local = localVersion(dir, list.map((f) => f.path), fsImpl);
  const stage = path.join(dir, `.update-${version}`);
  await fsImpl.promises.rm(stage, { recursive: true, force: true });
  fsImpl.mkdirSync(path.join(stage, 'src'), { recursive: true });

  try {
    // (1) โหลด+ตรวจให้ครบก่อน — ยังไม่แตะโฟลเดอร์จริง
    for (const f of list) {
      const buf = await fetchFile(f.path);
      const body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      const got = sha256Hex(body);
      if (f.sha256 && got !== f.sha256) throw new Error(`hash ไม่ตรง: ${f.path} (ได้ ${got.slice(0, 12)} ต้องการ ${String(f.sha256).slice(0, 12)})`);
      const abs = path.join(stage, f.path);
      fsImpl.mkdirSync(path.dirname(abs), { recursive: true });
      fsImpl.writeFileSync(abs, body);
      await checkFile(f.path, abs);
    }

    // (2) เก็บสำเนาของเดิม (ย้อนกลับได้เสมอ) — เขียนทับโฟลเดอร์เดิมของเวอร์ชันนี้ได้
    const snap = path.join(dir, SNAPSHOT_DIR, local);
    fsImpl.mkdirSync(snap, { recursive: true });
    for (const f of list) {
      const abs = path.join(dir, f.path);
      if (!fsImpl.existsSync(abs)) continue;
      const to = path.join(snap, f.path);
      fsImpl.mkdirSync(path.dirname(to), { recursive: true });
      fsImpl.copyFileSync(abs, to);
    }

    // (3) สลับไฟล์ (เขียนจากโฟลเดอร์พัก — ต้นทางผ่านการตรวจแล้ว)
    for (const f of list) {
      const abs = path.join(dir, f.path);
      fsImpl.mkdirSync(path.dirname(abs), { recursive: true });
      fsImpl.writeFileSync(abs, fsImpl.readFileSync(path.join(stage, f.path)));
    }

    // (4) state ค้าง: บูตถัดไปจะประกาศตัวว่า "ฉันคือเวอร์ชันใหม่" — ถ้าไม่ประกาศ = ย้อนกลับ
    writeState(dir, { pendingSince: now, fromVersion: local, toVersion: version, startedAt: null, healthyAt: null }, fsImpl);
    log(`[update] ติดตั้งเวอร์ชัน ${version} แล้ว (จาก ${local}) — เก็บสำเนาเดิมที่ ${SNAPSHOT_DIR}/${local}`);
    return { ok: true, version, fromVersion: local };
  } finally {
    try {
      fsImpl.rmSync(stage, { recursive: true, force: true });
    } catch {
      /* เก็บกวาดไม่ได้ก็ไม่ควรทำให้การอัปเดตล้มเหลว */
    }
  }
}

/**
 * ล้าง state ที่ค้างอยู่ — ใช้เมื่อ "ไม่มีการส่งงานต่อ"
 * (state มีไว้บอกผู้ดูแลที่เฝ้าอยู่ว่าโปรเซสใหม่ขึ้นหรือยัง · ไม่มีผู้ดูแล = ไม่ควรเหลือธุรกรรมค้าง)
 */
export function clearPending(dir, { fsImpl = fsSync, log = () => {} } = {}) {
  const state = readState(dir, fsImpl);
  if (!state) return false;
  fsImpl.rmSync(path.join(dir, STATE_FILE), { force: true });
  if (state.toVersion) log(`[update] ติดตั้งเวอร์ชัน ${state.toVersion} แล้วโดยไม่รีสตาร์ท — ล้าง state ค้าง`);
  return true;
}

/** เรียกตอนบูต: ประกาศตัว / ล้าง state ที่จบแล้ว — ใช้ตัดสินว่าอัปเดตรอบก่อนสำเร็จจริง */
export function planBoot(dir, { now = Date.now(), fsImpl = fsSync, log = () => {} } = {}) {
  const state = readState(dir, fsImpl);
  if (!state) return { action: 'none' };
  if (state.healthyAt) {
    writeState(dir, { ...state, clearedAt: now }, fsImpl);
    fsImpl.rmSync(path.join(dir, STATE_FILE), { force: true });
    log(`[update] เวอร์ชัน ${state.toVersion} ทำงานปกติแล้ว`);
    return { action: 'cleared', version: state.toVersion };
  }
  if (!state.startedAt) {
    writeState(dir, { ...state, startedAt: now }, fsImpl);
    log(`[update] เริ่มรันเวอร์ชัน ${state.toVersion} (เดิม ${state.fromVersion}) — ผู้ดูแลรอบก่อนกำลังเฝ้าอยู่`);
    return { action: 'starting', toVersion: state.toVersion, fromVersion: state.fromVersion };
  }
  return { action: 'running', toVersion: state.toVersion };
}

/** ประกาศว่า "รันได้สักพักแล้ว" — ผู้ดูแลที่เฝ้าอยู่จะเห็นแล้วจบตัวลงอย่างสะอาด */
export function markHealthy(dir, { now = Date.now(), fsImpl = fsSync } = {}) {
  const state = readState(dir, fsImpl);
  if (!state || state.healthyAt) return false;
  writeState(dir, { ...state, healthyAt: now }, fsImpl);
  return true;
}

/**
 * ย้อนกลับไฟล์ชุดเดิม + จำเวอร์ชันที่พังไว้กันวน
 * สำเนามาจาก SNAPSHOT_DIR/<fromVersion> ที่ applyUpdate เขียนไว้ (ไม่มีการดึงจากเครือข่าย)
 */
export function rollback(dir, { now = Date.now(), reason = 'โปรเซสใหม่ไม่ทำงาน', fsImpl = fsSync, log = () => {} } = {}) {
  const state = readState(dir, fsImpl);
  if (!state) return { rolledBack: false, reason: 'ไม่มี state ค้าง' };
  const snap = path.join(dir, SNAPSHOT_DIR, state.fromVersion);
  if (!fsImpl.existsSync(snap)) {
    fsImpl.writeFileSync(path.join(dir, REJECT_FILE), JSON.stringify({ version: state.toVersion, at: now, reason: `${reason} · ไม่พบสำเนาเดิม` }, null, 2));
    return { rolledBack: false, reason: 'ไม่พบสำเนาเดิมให้ย้อนกลับ', toVersion: state.toVersion };
  }
  for (const f of fsImpl.readdirSync(snap, { recursive: true, withFileTypes: true }) ?? []) {
    if (!f.isFile()) continue;
    const rel = path.relative(snap, path.join(f.parentPath ?? f.path, f.name)).replace(/\\/g, '/');
    const to = path.join(dir, rel);
    fsImpl.mkdirSync(path.dirname(to), { recursive: true });
    fsImpl.copyFileSync(path.join(snap, rel), to);
  }
  fsImpl.writeFileSync(path.join(dir, REJECT_FILE), JSON.stringify({ version: state.toVersion, at: now, reason }, null, 2));
  fsImpl.rmSync(path.join(dir, STATE_FILE), { force: true });
  log(`[update] ย้อนกลับเป็นเวอร์ชัน ${state.fromVersion} แล้ว — เวอร์ชัน ${state.toVersion} ถูกกันไว้จนกว่าจะมีชุดใหม่`);
  return { rolledBack: true, fromVersion: state.fromVersion, toVersion: state.toVersion };
}

/**
 * ปล่อยโปรเซสใหม่ (detached) แล้วเฝ้าดู:
 *   - โปรเซสใหม่ประกาศตัว (เขียน startedAt) → คืน ok (ผู้เรียกออกด้วย HANDOFF_EXIT_CODE)
 *   - ไม่ประกาศภายใน timeout → ย้อนกลับไฟล์เอง แล้วรันโค้ดเดิมต่อ (ไม่ต้องมีใครไปนั่งเครื่อง)
 */
export async function restartSupervised({
  dir,
  spawnImpl = spawn,
  nodePath = process.execPath,
  mainRel = 'src/main.mjs',
  timeoutMs = 45_000,
  pollMs = 500,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  fsImpl = fsSync,
  log = () => {},
} = {}) {
  const state = readState(dir, fsImpl);
  if (!state?.toVersion) return { ok: false, reason: 'ไม่มี state ค้างให้ส่งงานต่อ' };
  // เริ่มรอบใหม่: ล้างเครื่องหมายของรอบก่อน เพื่อไม่ให้เข้าใจผิดว่าโปรเซสใหม่ "ประกาศตัวแล้ว"
  writeState(dir, { ...state, startedAt: null, healthyAt: null }, fsImpl);
  log(`[update] ปล่อยโปรเซสใหม่ (${mainRel}) แล้วเฝ้าดู ${timeoutMs}ms ...`);
  const child = spawnImpl(nodePath, [path.join(dir, mainRel)], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, RUNNER_SUPERVISOR_PID: String(process.pid) },
  });
  child?.unref?.();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = readState(dir, fsImpl);
    if (s?.startedAt && s.toVersion === state.toVersion) {
      const out = { ok: true, version: state.toVersion, exitCode: HANDOFF_EXIT_CODE, pid: child?.pid ?? null };
      log(`[update] โปรเซสใหม่ทำงานแล้ว (pid ${out.pid}) — รอบนี้จบ`);
      return out;
    }
    await sleepImpl(pollMs);
  }
  const back = rollback(dir, { reason: `โปรเซสใหม่ (${state.toVersion}) ไม่ประกาศตัวภายใน ${timeoutMs}ms`, fsImpl, log });
  return { ok: false, rolledBack: back.rolledBack, version: state.toVersion, backTo: back.fromVersion ?? state.fromVersion };
}

// ── สัญญากับ HUB (ฝั่ง HUB: modules/agent-machines/agent-machines.routes.ts) ──
//   GET /api/agent-machines/update/manifest  header x-machine-token → { version, files:[{path,sha256,size}] }
//   GET /api/agent-machines/update/file?path=src/main.mjs           → เนื้อไฟล์ดิบ
export async function fetchManifest({ hubUrl, token, fetchImpl = fetch }) {
  const res = await fetchImpl(`${String(hubUrl).replace(/\/$/, '')}/api/agent-machines/update/manifest`, {
    headers: { 'x-machine-token': token },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`manifest -> HTTP ${res.status}`);
  return await res.json();
}

export async function fetchUpdateFile({ hubUrl, token, path: rel, fetchImpl = fetch }) {
  const url = `${String(hubUrl).replace(/\/$/, '')}/api/agent-machines/update/file?path=${encodeURIComponent(rel)}`;
  const res = await fetchImpl(url, { headers: { 'x-machine-token': token } });
  if (!res.ok) throw new Error(`${rel} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** รอบเดียวจบ: เช็ค → (ถ้าต่าง) อัปเดต → ส่งงานต่อโปรเซสใหม่ · คืนผลไว้ให้ log/เทสต์ */
export async function selfUpdateOnce({
  hubUrl,
  token,
  dir,
  fetchImpl = fetch,
  apply = true,
  restart = true,
  now = Date.now(),
  fsImpl = fsSync,
  log = () => {},
  ...rest
}) {
  const manifest = await fetchManifest({ hubUrl, token, fetchImpl });
  const local = manifest ? localVersion(dir, manifest.files.map((f) => f.path), fsImpl) : null;
  const decision = decideUpdate({ localVersion: local, manifest, rejected: readRejected(dir, fsImpl), now });
  if (decision.action !== 'update') return { status: decision.action, localVersion: local, remoteVersion: manifest?.version ?? null, reason: decision.reason };
  if (!apply) return { status: 'update-available', localVersion: local, remoteVersion: manifest.version };

  const out = await applyUpdate({
    dir,
    version: manifest.version,
    files: manifest.files,
    fetchFile: (rel) => fetchUpdateFile({ hubUrl, token, path: rel, fetchImpl }),
    now,
    fsImpl,
    log,
    ...rest,
  });
  if (!restart) {
    clearPending(dir, { fsImpl, log });
    return { status: 'updated', ...out };
  }
  const handoff = await restartSupervised({ dir, fsImpl, log, ...rest });
  return { status: handoff.ok ? 'restarted' : 'rolled-back', ...out, handoff };
}
