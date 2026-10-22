#!/usr/bin/env node
// tools/runtime-layers.mjs — ชั้นการทำงานของ Sovereign OS ("เปิดเท่าที่ใช้")
//
// แนวคิด:
//   - registry (tools/runtime-layers.json) บอกว่าแต่ละ mode ต้องมี service ไหน
//   - runtime-mode.json (core-api/data/) = "โหมดที่ต้องการ" ที่ watchdog ทุกตัวอ่านร่วมกัน
//   - watchdog จะไม่ปลุก service ที่โหมดปัจจุบันไม่ได้เปิด (เดิม docker-watchdog ปลุก emqx ทุกนาที)
//
// คำสั่ง:
//   node tools/runtime-layers.mjs status            # ดูสถานะ + หน่วยความจำ (อ่านอย่างเดียว)
//   node tools/runtime-layers.mjs evidence          # หลักฐานว่าอะไรถูกใช้จริง
//   node tools/runtime-layers.mjs plan connected    # ดูก่อนว่าจะ stop/start อะไร
//   node tools/runtime-layers.mjs use connected     # เปลี่ยนโหมดจริง
//   node tools/runtime-layers.mjs ensure core       # เปิดเฉพาะที่ขาด (ไม่หยุดอะไร)
//
// ความปลอดภัย:
//   - db/api/web อยู่ในทุก mode ⇒ backup/nightly/frontend ยังทำงานได้เสมอ
//   - ไม่มีคำสั่งลบข้อมูล/volume; stop เป็น docker stop (start กลับได้ทันที)
//   - ถ้า registry/mode ไฟล์เสีย → ใช้ defaultMode = full (อย่าหยุดของที่อาจจำเป็น)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_MODE = 'full';
const REGISTRY_FILE = path.join(REPO_ROOT, 'tools', 'runtime-layers.json');
const SERVICE_ORDER = ['db', 'api', 'web', 'tunnel', 'emqx', 'wazuh'];
const WEB_PORT = 3000;

export function loadRegistry(file = REGISTRY_FILE) {
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateRegistry(registry);
  return registry;
}

export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('registry ไม่ถูกต้อง');
  if (!registry.modes || typeof registry.modes !== 'object') throw new Error('registry ต้องมี modes');
  if (!registry.services || typeof registry.services !== 'object') throw new Error('registry ต้องมี services');
  if (!registry.modes[registry.defaultMode]) throw new Error(`defaultMode ไม่มีใน modes: ${registry.defaultMode}`);
  for (const [id, svc] of Object.entries(registry.services)) {
    if (!['docker', 'process'].includes(svc.kind)) throw new Error(`service ${id}: kind ต้องเป็น docker/process`);
    if (svc.kind === 'docker' && !svc.container) throw new Error(`service ${id}: ต้องมี container`);
    if (svc.kind === 'process' && !Number.isInteger(svc.port)) throw new Error(`service ${id}: ต้องมี port`);
  }
  for (const [name, mode] of Object.entries(registry.modes)) {
    if (!Array.isArray(mode.services) || mode.services.length === 0) throw new Error(`mode ${name}: ต้องมี services`);
    for (const id of mode.services) {
      if (!registry.services[id]) throw new Error(`mode ${name}: อ้าง service ที่ไม่มี (${id})`);
    }
    for (const essential of ['db', 'api', 'web']) {
      if (!mode.services.includes(essential)) throw new Error(`mode ${name}: ต้องมี ${essential}`);
    }
  }
  return registry;
}

export function serviceIdsForMode(registry, mode) {
  const found = registry.modes[mode];
  if (!found) throw new Error(`mode ไม่รู้จัก: ${mode}`);
  return [...found.services];
}

/** container ที่ docker-watchdog ควรเฝ้าในโหมดนี้ (เฉพาะ kind=docker + watch=true) */
export function watchContainerNamesForMode(mode, { registry } = {}) {
  let reg;
  try {
    reg = registry || loadRegistry();
    return serviceIdsForMode(reg, mode)
      .filter((id) => reg.services[id]?.kind === 'docker' && reg.services[id]?.watch === true)
      .map((id) => reg.services[id].container);
  } catch {
    // registry พัง/โหมดไม่รู้จัก = เฝ้าแบบเดิม (db/api/emqx) ดีกว่าปล่อยให้ระบบดับเงียบ
    reg = reg || safeRegistry();
    return ['db', 'api', 'emqx']
      .filter((id) => reg.services[id]?.watch === true)
      .map((id) => reg.services[id].container)
      .filter(Boolean);
  }
}

function safeRegistry() {
  try { return loadRegistry(); } catch { return { services: {} }; }
}

/** โหมดนี้ต้องมีเว็บ (:3000) ไหม — ถ้าตัดสินไม่ได้ให้ true (fail-safe) */
export function modeHasWeb(mode, { registry } = {}) {
  try {
    const reg = registry || loadRegistry();
    return serviceIdsForMode(reg, mode).includes('web');
  } catch {
    return true;
  }
}

export function modeFile(root = REPO_ROOT) {
  return path.join(root, 'sovereign-os', 'core-api', 'data', 'runtime-mode.json');
}

export function readRuntimeMode({ root = REPO_ROOT, registry } = {}) {
  const reg = registry || safeRegistry();
  try {
    const parsed = JSON.parse(fs.readFileSync(modeFile(root), 'utf8'));
    if (typeof parsed?.mode === 'string' && reg.modes?.[parsed.mode]) {
      return {
        mode: parsed.mode,
        source: 'file',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    }
    return { mode: reg.defaultMode || DEFAULT_MODE, source: 'invalid-mode', updatedAt: null };
  } catch (err) {
    return {
      mode: reg.defaultMode || DEFAULT_MODE,
      source: err?.code === 'ENOENT' ? 'default' : 'invalid-json',
      updatedAt: null,
    };
  }
}

export function writeRuntimeMode(mode, { root = REPO_ROOT, registry, updatedBy = 'cli', now = new Date() } = {}) {
  const reg = registry || loadRegistry();
  if (!reg.modes[mode]) throw new Error(`mode ไม่รู้จัก: ${mode}`);
  const file = modeFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { mode, updatedAt: now.toISOString(), updatedBy };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { mode, path: file };
}

/**
 * วางแผนเปลี่ยนโหมด — pure
 * states: { db: 'running'|'exited'|'created'|'missing'|'unknown', ... }
 * - stop: อยู่ใน from, ไม่อยู่ใน to และกำลัง running
 * - start: อยู่ใน to แต่ยังไม่ running (exited/created) — ไม่ยุ่ง unknown/missing
 */
export function planTransitions({ registry, fromMode, toMode, states = {} }) {
  const from = new Set(serviceIdsForMode(registry, fromMode));
  const to = new Set(serviceIdsForMode(registry, toMode));
  const stop = [...SERVICE_ORDER].reverse()
    .filter((id) => from.has(id) && !to.has(id) && states[id] === 'running');
  const start = SERVICE_ORDER
    .filter((id) => to.has(id) && (states[id] === 'exited' || states[id] === 'created'));
  const keep = SERVICE_ORDER.filter((id) => to.has(id) && !start.includes(id));
  return { stop, start, keep };
}

/**
 * หยุด EMQX = ตัด MQTT ของ core-api ทุกตัว
 * โค้ดใหม่มี error listener แล้ว แต่ **container ที่รันอยู่** จะได้โค้ดใหม่หลัง restart เท่านั้น
 * ระหว่าง Cold Soak (ห้าม restart) จึงต้องยืนยันด้วย --force ก่อนหยุด EMQX
 */
export function stoppingEmqxNeedsConfirmation({ registry, toMode, states = {} }) {
  return !serviceIdsForMode(registry, toMode).includes('emqx') && states.emqx === 'running';
}

// ───────────────────────────────────────────────────────────────────────────
//  Docker / process helpers (ใช้เฉพาะตอน CLI ถูกเรียก — import แล้วไม่แตะระบบ)
// ───────────────────────────────────────────────────────────────────────────
function run(cmd, args, timeout = 20_000) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function dockerAlive() {
  try { run('docker', ['info', '--format', '{{.ServerVersion}}'], 15_000); return true; } catch { return false; }
}

function dockerLines(containers) {
  try {
    return run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}'])
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [name, state] = l.split('\t'); return { name, state }; })
      .filter((c) => !containers || containers.includes(c.name));
  } catch {
    return null;
  }
}

function dockerStats() {
  try {
    const map = {};
    for (const line of run('docker', ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}'], 30_000).split('\n')) {
      const [name, usage] = line.trim().split('\t');
      if (!name) continue;
      map[name] = usage || '';
    }
    return map;
  } catch {
    return {};
  }
}

function parseMb(usage) {
  if (!usage) return null;
  const first = String(usage).split('/')[0].trim();
  const num = parseFloat(first);
  if (!Number.isFinite(num)) return null;
  return /GiB/i.test(first) ? num * 1024 : num;
}

function fmtMb(mb) {
  return Number.isFinite(mb) ? `${Math.round(mb)} MB` : '—';
}

function findListenerPid(port = WEB_PORT) {
  try {
    const out = run('powershell', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess`], 15_000);
    return Number(out.trim()) || 0;
  } catch { return 0; }
}

function serverKind(pid) {
  try {
    const out = run('powershell', ['-NoProfile', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){ $pp=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; "$($p.CommandLine)|||$($pp.CommandLine)" }`], 15_000);
    const norm = String(out).toLowerCase().replace(/["']/g, ' ');
    if (/\bnext\s+dev\b|\brun\s+dev\b/.test(norm)) return 'dev';
    if (/\bnext\s+start\b|\brun\s+start\b|start-server/.test(norm)) return 'prod';
    return 'unknown';
  } catch { return 'unknown'; }
}

function processMb(pid) {
  if (!pid) return null;
  try {
    const out = run('powershell', ['-NoProfile', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`], 10_000);
    const bytes = Number(out.trim());
    return Number.isFinite(bytes) ? bytes / (1024 * 1024) : null;
  } catch { return null; }
}

async function httpCode(url, timeout = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    await res.arrayBuffer().catch(() => {});
    return res.status;
  } catch { return 0; }
}

async function webState() {
  const pid = findListenerPid();
  if (!pid) return { state: 'exited', pid: 0 };
  return { state: 'running', pid };
}

async function collectStates(registry) {
  const docker = dockerAlive();
  const containers = dockerLines(Object.values(registry.services)
    .filter((s) => s.kind === 'docker').map((s) => s.container)) || [];
  const byName = Object.fromEntries(containers.map((c) => [c.name, c.state]));
  const states = {};
  for (const [id, svc] of Object.entries(registry.services)) {
    if (svc.kind === 'docker') states[id] = byName[svc.container] || 'missing';
  }
  const web = await webState();
  states.web = web.state;
  return { states, webPid: web.pid, docker };
}

async function waitFor(cond, timeoutMs, everyMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

async function waitDockerRunning(container, timeoutMs = 20_000) {
  return waitFor(() => {
    try {
      const out = run('docker', ['inspect', '-f', '{{.State.Status}}', container], 8_000).trim();
      return out === 'running';
    } catch { return false; }
  }, timeoutMs);
}

async function waitDb() {
  return waitFor(() => {
    try { run('docker', ['exec', 'sovereign-db', 'pg_isready', '-U', 'sovereign'], 8_000); return true; } catch { return false; }
  }, 90_000);
}

async function waitApi() {
  const ok = await waitFor(async () => (await httpCode('http://127.0.0.1:3001/healthz')) === 200, 180_000, 3000);
  if (ok) return true;
  return (await httpCode('http://127.0.0.1:3001/healthz')) === 200;
}

async function startWeb() {
  if (findListenerPid()) return true;
  const frontend = path.join(REPO_ROOT, 'sovereign-frontend');
  const child = spawn('cmd', ['/c', 'npm', 'run', 'start', '--', '-p', String(WEB_PORT)], {
    cwd: frontend, windowsHide: true, stdio: 'ignore',
  });
  child.unref();
  return waitFor(async () => (await httpCode(`http://127.0.0.1:${WEB_PORT}/`)) === 200, 90_000, 3000);
}

async function stopWeb() {
  const pid = findListenerPid();
  if (!pid) return;
  const kind = serverKind(pid);
  if (kind === 'unknown') throw new Error(`:${WEB_PORT} มี process (PID ${pid}) ที่จับชนิดไม่ได้ — fail-safe ไม่ kill`);
  try {
    run('taskkill', ['/PID', String(pid), '/F', '/T'], 20_000);
  } catch { /* อาจจบไปแล้ว */ }
  await waitFor(() => !findListenerPid(), 20_000, 1000);
}

async function startService(id, registry) {
  const svc = registry.services[id];
  if (!svc) throw new Error(`ไม่รู้จัก service: ${id}`);
  if (svc.kind === 'process') {
    if (id !== 'web') throw new Error(`process service ที่ยังไม่รองรับ: ${id}`);
    if (!(await startWeb())) throw new Error('บูต :3000 ไม่สำเร็จภายใน 90 วิ');
    return;
  }
  const exists = (dockerLines([svc.container]) || []).some((c) => c.name === svc.container);
  if (!exists) throw new Error(`ไม่พบ container ${svc.container} — ต้องสร้างก่อน (docker compose up -d)`);
  try { run('docker', ['start', svc.container], 60_000); } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (!/already running/i.test(msg)) throw new Error(`start ${svc.container} ไม่สำเร็จ: ${msg.slice(0, 200)}`);
  }
  if (id === 'db') { if (!(await waitDb())) throw new Error('DB ยังไม่พร้อมหลัง start (90 วิ)'); }
  else if (id === 'api') { if (!(await waitApi())) throw new Error('API ยังไม่ตอบ /healthz หลัง start (180 วิ)'); }
  else if (!(await waitDockerRunning(svc.container))) throw new Error(`${svc.container} ไม่ขึ้น running`);
}

async function stopService(id, registry) {
  const svc = registry.services[id];
  if (!svc) throw new Error(`ไม่รู้จัก service: ${id}`);
  if (svc.kind === 'process') {
    if (id !== 'web') throw new Error(`process service ที่ยังไม่รองรับ: ${id}`);
    await stopWeb();
    return;
  }
  try {
    run('docker', ['stop', svc.container], 60_000);
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (!/not running|no such container/i.test(msg)) throw new Error(`stop ${svc.container} ไม่สำเร็จ: ${msg.slice(0, 200)}`);
  }
}

function modeSummary(registry, mode) {
  return registry.modes[mode].services.map((id) => {
    const svc = registry.services[id];
    return svc.kind === 'docker' ? `${id} (${svc.container})` : `${id} (:${svc.port})`;
  }).join(', ');
}

function printPlan(registry, fromMode, toMode, plan) {
  console.log(`plan: ${fromMode} → ${toMode}`);
  if (!plan.stop.length && !plan.start.length) {
    console.log('  ไม่มีอะไรต้องเปลี่ยน');
    return;
  }
  for (const id of plan.stop) {
    const svc = registry.services[id];
    console.log(`  STOP  ${id}${svc.container ? ` (${svc.container})` : ''}`);
  }
  for (const id of plan.start) console.log(`  START ${id}`);
  console.log(`  KEEP  ${plan.keep.join(', ')}`);
}

async function status({ json = false } = {}) {
  const registry = loadRegistry();
  const active = readRuntimeMode({ registry });
  const { states, webPid, docker } = await collectStates(registry);
  const stats = docker ? dockerStats() : {};
  const rows = [];
  for (const [id, svc] of Object.entries(registry.services)) {
    const inMode = registry.modes[active.mode].services.includes(id);
    const state = states[id] || 'unknown';
    const mem = svc.kind === 'docker' ? parseMb(stats[svc.container]) : (id === 'web' ? processMb(webPid) : null);
    rows.push({ id, container: svc.container || `:${svc.port}`, state, mem, inMode, watch: svc.watch, essential: svc.essential });
  }
  if (json) {
    console.log(JSON.stringify({ mode: active.mode, source: active.source, docker, services: rows }, null, 2));
    return 0;
  }
  console.log(`Sovereign runtime layers — mode: ${active.mode} (${active.source})${active.updatedAt ? ` · ${active.updatedAt}` : ''}`);
  console.log(`default: ${registry.defaultMode} · docker: ${docker ? 'up' : 'DOWN'}`);
  console.log('');
  console.log('service   container                 state     mem       in-mode  watch');
  for (const r of rows) {
    const drift = r.state === 'running' && !r.inMode ? '  DRIFT' : '';
    console.log(
      `${r.id.padEnd(9)} ${r.container.padEnd(24)} ${r.state.padEnd(9)} ${fmtMb(r.mem).padEnd(9)} ${(r.inMode ? 'yes' : 'no').padEnd(7)} ${r.watch ? 'yes' : 'no'}${drift}`
    );
  }
  const activeMem = rows.filter((r) => r.inMode && r.state === 'running').reduce((sum, r) => sum + (r.mem || 0), 0);
  console.log('');
  console.log(`active layers: ${modeSummary(registry, active.mode)}`);
  console.log(`memory (containers + web): ~${Math.round(activeMem)} MB`);
  if (active.source !== 'file') console.log(`ℹ️  ยังไม่มี runtime-mode.json — ใช้ default (${registry.defaultMode})`);
  const drift = rows.filter((r) => r.state === 'running' && !r.inMode).map((r) => r.id);
  if (drift.length) console.log(`⚠️  ทำงานนอกโหมด: ${drift.join(', ')} — ปิดด้วย: node tools/runtime-layers.mjs use ${active.mode}`);
  return 0;
}

async function plan(mode) {
  const registry = loadRegistry();
  if (!registry.modes[mode]) { console.error(`mode ไม่รู้จัก: ${mode} (มี: ${Object.keys(registry.modes).join(', ')})`); return 2; }
  const active = readRuntimeMode({ registry });
  const { states } = await collectStates(registry);
  const result = planTransitions({ registry, fromMode: active.mode, toMode: mode, states });
  printPlan(registry, active.mode, mode, result);
  return 0;
}

async function use(mode, { force = false } = {}) {
  const registry = loadRegistry();
  if (!registry.modes[mode]) { console.error(`mode ไม่รู้จัก: ${mode} (มี: ${Object.keys(registry.modes).join(', ')})`); return 2; }
  if (!dockerAlive()) { console.error('❌ Docker ยังไม่ทำงาน — เปิด Docker Desktop ก่อน'); return 1; }
  const active = readRuntimeMode({ registry });
  const { states } = await collectStates(registry);
  if (stoppingEmqxNeedsConfirmation({ registry, toMode: mode, states }) && !force) {
    console.error(`⚠️  โหมด ${mode} จะหยุด EMQX — core-api ที่รันอยู่ยังใช้โค้ดเดิม (error listener ใหม่มีผลหลัง restart)`);
    console.error('   ระหว่าง Cold Soak ห้าม restart: ใช้โหมด iot (เก็บ EMQX) หรือเติม --force เมื่อยอมรับความเสี่ยง');
    return 3;
  }
  const result = planTransitions({ registry, fromMode: active.mode, toMode: mode, states });
  printPlan(registry, active.mode, mode, result);
  writeRuntimeMode(mode, { registry, updatedBy: 'tools/runtime-layers.mjs' });
  console.log(`\nmode → ${mode} (บันทึกแล้ว — watchdog จะใช้โหมดนี้)`);
  try {
    for (const id of result.stop) { console.log(`  … stop ${id}`); await stopService(id, registry); }
    for (const id of result.start) { console.log(`  … start ${id}`); await startService(id, registry); }
  } catch (err) {
    console.error(`\n❌ เปลี่ยนโหมดไม่สมบูรณ์: ${err?.message || err}`);
    console.error('   mode ที่ต้องการถูกบันทึกแล้ว — แก้ต่อด้วย status/ensure หรือกลับไปใช้ full');
    return 1;
  }
  console.log('\n✅ เปลี่ยนโหมดแล้ว');
  await status();
  return 0;
}

async function ensure(mode) {
  const registry = loadRegistry();
  if (!registry.modes[mode]) { console.error(`mode ไม่รู้จัก: ${mode} (มี: ${Object.keys(registry.modes).join(', ')})`); return 2; }
  if (!dockerAlive()) { console.error('❌ Docker ยังไม่ทำงาน — เปิด Docker Desktop ก่อน'); return 1; }
  const { states } = await collectStates(registry);
  const need = registry.modes[mode].services.filter((id) => states[id] === 'exited' || states[id] === 'created');
  if (!need.length) { console.log(`ทุก service ของ ${mode} ทำงานอยู่แล้ว`); return 0; }
  for (const id of need) {
    console.log(`  … start ${id}`);
    try { await startService(id, registry); } catch (err) { console.error(`❌ ${id}: ${err?.message || err}`); return 1; }
  }
  console.log(`✅ ${mode} พร้อมใช้งาน`);
  return 0;
}

async function evidence() {
  const registry = loadRegistry();
  const { states, docker } = await collectStates(registry);
  console.log('หลักฐานการใช้งานจริง (อ่านจาก container โดยไม่แตะข้อมูล)');
  console.log(`docker: ${docker ? 'up' : 'DOWN'}`);
  console.log(`web :3000: ${states.web === 'running' ? 'running' : 'stopped'}`);

  const wazuh = states.wazuh;
  let agents = null;
  if (wazuh === 'running') {
    try {
      const out = run('docker', ['exec', 'wazuh-manager', 'sh', '-c', 'wc -l < /var/ossec/etc/client.keys'], 10_000).trim();
      agents = Number(out) || 0;
    } catch { agents = null; }
  }
  console.log(`Wazuh: ${wazuh} · agents: ${agents === null ? '—' : agents}`);

  let total = null; let external = null;
  if (states.emqx === 'running') {
    try {
      const out = run('docker', ['exec', 'sovereign-emqx', 'sh', '-c', 'emqx ctl clients list 2>/dev/null || true'], 15_000);
      const lines = out.split('\n').filter((l) => l.trim().startsWith('Client('));
      total = lines.length;
      external = lines.filter((l) => {
        const m = l.match(/peername=([^,\s]+)/);
        if (!m) return true;
        const host = m[1].split(':')[0];
        return !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$)/.test(host);
      }).length;
    } catch { /* ignore */ }
  }
  console.log(`EMQX: ${states.emqx} · clients: ${total === null ? '—' : total} (ภายนอก: ${external === null ? '—' : external})`);

  const conns = (() => {
    try {
      const out = run('powershell', ['-NoProfile', '-Command',
        `@(Get-NetTCPConnection -LocalPort ${WEB_PORT} -State Established -ErrorAction SilentlyContinue).Count`], 15_000);
      return Number(out.trim()) || 0;
    } catch { return null; }
  })();
  console.log(`TCP ที่ต่อกับ :${WEB_PORT}: ${conns === null ? '—' : conns}`);
  console.log(`Tunnel: ${states.tunnel}`);
  console.log('');
  console.log('สรุป:');
  if (agents === 0) console.log('  - Wazuh ไม่มี agent → หยุดได้ (ประหยัด ~472 MB)');
  if (wazuh !== 'running') console.log(`  - Wazuh ${wazuh} อยู่ → เปิดกลับด้วย: node tools/runtime-layers.mjs use full`);
  if (external === 0) console.log('  - EMQX ไม่มี client ภายนอก → เก็บไว้ถ้าใช้เซนเซอร์/รีเลย์; หยุดได้หลัง core-api restart (มี error listener)');
  if (states.tunnel === 'running') console.log('  - Tunnel ยังทำงาน → เก็บไว้ถ้าต้องการลิงก์สาธารณะ');
  return 0;
}

function help() {
  console.log(`Sovereign runtime layers
  node tools/runtime-layers.mjs status [--json]
  node tools/runtime-layers.mjs evidence
  node tools/runtime-layers.mjs plan <mode>
  node tools/runtime-layers.mjs use <mode>
  node tools/runtime-layers.mjs use <mode> --force   # ยอมรับการหยุด EMQX ก่อน restart core-api
  node tools/runtime-layers.mjs ensure <mode>
modes: ${Object.keys(loadRegistry().modes).join(', ')}`);
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  let code = 0;
  try {
    if (!cmd || cmd === 'help' || cmd === '--help') { help(); }
    else if (cmd === 'status') code = await status({ json: args.includes('--json') });
    else if (cmd === 'evidence') code = await evidence();
    else if (cmd === 'plan') code = await plan(args[1]);
    else if (cmd === 'use' || cmd === 'apply') code = await use(args[1], { force: args.includes('--force') });
    else if (cmd === 'ensure') code = await ensure(args[1]);
    else { console.error(`ไม่รู้จักคำสั่ง: ${cmd}`); help(); code = 2; }
  } catch (err) {
    console.error(`❌ ${err?.message || err}`);
    code = 1;
  }
  process.exit(code);
}
