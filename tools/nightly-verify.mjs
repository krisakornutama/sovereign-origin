#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// nightly-verify.mjs — รัน verify:full ทุกคืนโดยอัตโนมัติ (Phase 3: ระบบพิสูจน์สุขภาพตัวเอง)
// โครง: lock กันรันซ้อน → รัน verify:full → เก็บ status/log บน E: → ส่งสรุป Telegram
// หลักการ fail-safe: ล้มเหลวทุกจุด = เขียน status + รายงานเสมอ (ไม่มีความพังแบบเงียบ)
// log ทั้งหมดอยู่บน E: ตามกฎ PROJECT DRIVE ONLY (ข้อ 7)
// ติดตั้ง: tools/register-nightly-task.ps1 (Task Scheduler 02:00 ทุกคืน)
// ────────────────────────────────────────────────────────────────────────────
import { spawnSync, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// REPO = root ของ repo (ไฟล์อยู่ tools/ → ต้องขึ้น 2 ชั้น: ไฟล์ → tools → root)
// (บั๊กจริงรอบแรก: ขึ้นชั้นเดียว → REPO=tools → log หลุดไป tools/logs และไม่เรียก report)
function repoOf(file) {
  const inTools = dirname1(file);
  return dirname1(inTools);
}
function dirname1(p) {
  const i = p.lastIndexOf('\\');
  return i > 3 ? p.slice(0, i) : p;
}
const REPO = repoOf(fileURLToPath(import.meta.url));
const LOGDIR = join(REPO, 'logs', 'nightly');
const LOCK = join(LOGDIR, 'nightly.lock');
const STATUS = join(LOGDIR, 'status.json');
function isAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', timeout: 15_000 });
    return out.includes(String(pid)); // tasklist ตอบสำเร็จแม้ไม่เจอ PID (ต้องดูเนื้อความ)
  } catch { return false; }
}

// ── lock กันรันซ้อน (เช่น verify ปกติกำลังรัน / nightly ค้างจากเมื่อคืน) ──
mkdirSync(LOGDIR, { recursive: true });
if (existsSync(LOCK)) {
  try {
    const old = JSON.parse(readFileSync(LOCK, 'utf8'));
    if (old.pid && isAlive(old.pid)) {
      console.log(`nightly: มีรอบก่อนหน้า (pid ${old.pid} เริ่ม ${old.startedAt}) ยังทำงานอยู่ — ข้ามคืนนี้`);
      process.exit(0);
    }
  } catch { /* lock เสีย — ลบแล้วทำต่อ */ }
  try { unlinkSync(LOCK); } catch { /* ข้าม */ }
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const t0 = Date.now();
const runStartedAt = new Date().toISOString(); // ใช้ตรวจว่า system-truth.json เป็นของรอบนี้จริง (ด้านล่าง)

// ── Phase 4: ตรวจสุขภาพเครื่องจริงก่อนรัน — แจ้งเตือนก่อน verify จะพังเพราะสภาพแวดล้อม ──
// (แรมต่ำ → OOM exit 134 · ดิสก์เต็ม → build พัง · docker ล่ม → เทส/e2e ล้มหรือถูกข้าม)
let machine = { ok: true, problems: [], info: {} };
try {
  const mh = spawnSync('node', [join(REPO, 'tools', 'machine-health.mjs')], {
    cwd: REPO, encoding: 'utf8', timeout: 90_000,
    // ห้าม shell:true กับ path absolute ที่มีเว้นวรรค — shell ตัดที่ช่องว่าง → "Cannot find module 'E:\\My'"
    // (บั๊กแฝงจาก phase4a-c: ยังไม่เคยรันจริงเพราะ commit หลังตี 2 — machine-alert มาพิสูจน์ให้เห็นก่อน)
  });
  machine = JSON.parse((mh.stdout || '{}').trim());
} catch { /* soft-fail — ตรวจไม่ได้ก็ยังรัน verify ต่อ */ }
for (const p of machine.problems ?? []) {
  console.log(`⚠️ เครื่อง [${p.level}] ${p.area}: ${p.message}`);
}

// ── Phase 3b: ทำให้ e2e ได้รันจริงทุกคืน ไม่ใช่ถูกข้ามเงียบ ──
// เคสจริง (เจอใน status.json รอบ 1/10): verify.mjs ข้าม e2e อัตโนมัติเมื่อ backend :3001 ไม่ตอบ
// → เครื่องรีบูตแล้ว docker ยังไม่ขึ้นตอน 02:00 = รายงาน "ผ่าน" ทั้งที่สเปก 0 ตัวถูกรัน
//   (สังเกตได้จาก status.json: steps มีแค่ 5 ขั้น ไม่มี prod-truth / Playwright เลย)
// แก้โดย (ก) บูต docker stack ให้เองก่อน (ข) ถ้ายังไม่ได้ = รัน verify ธรรมดา + บันทึกว่าข้าม (ข) ตรวจสุขภาพด้วย fetch จริง
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function backendAlive(timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(6000) });
      if (res.status === 200) return true;
    } catch { /* ยังไม่ขึ้น — ลองต่อ */ }
    if (Date.now() >= deadline) return false;
    await sleepMs(5000);
  }
}
const backend = { up: await backendAlive(0), startedByUs: false, error: null };
if (!backend.up) {
  console.log('⚠️  backend :3001 ไม่ตอบ — บูต docker stack ก่อน (ไม่งั้น e2e จะถูกข้ามเงียบ)');
  const infra = join(REPO, 'sovereign-os', 'infra');
  const up = spawnSync('docker', ['compose', '-f', join(infra, 'docker-compose.yml'), 'up', '-d'],
    { cwd: infra, encoding: 'utf8', timeout: 300_000 });
  backend.startedByUs = true;
  backend.up = await backendAlive(180_000);
  if (!backend.up) {
    backend.error = `${up.stdout ?? ''}${up.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ').slice(0, 300);
  }
  console.log(backend.up ? '   ✅ backend กลับมาแล้ว' : `   🚨 backend บูตไม่ขึ้น — คืนนี้ e2e ไม่ได้รัน${backend.error ? ` (${backend.error})` : ''}`);
}

let ok = false;
try {
  // E2E_REQUIRE_BACKEND=1 = e2e ห้ามถูกข้ามเงียบ (ถ้า backend ตายกลางทาง = ต้อง fail ให้เห็น ไม่ใช่รายงานผ่าน)
  const script = backend.up ? 'verify:full' : 'verify';
  console.log(`▶ gate: npm run ${script}${backend.up ? ' (e2e บังคับรัน)' : ' (e2e ไม่รวม — backend ไม่ขึ้น)'}`);
  const r = spawnSync('npm', ['run', script], {
    cwd: REPO, encoding: 'utf8', timeout: 30 * 60_000, shell: true,
    env: backend.up ? { ...process.env, E2E_REQUIRE_BACKEND: '1' } : process.env,
  });
  ok = r.status === 0;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  writeFileSync(join(LOGDIR, 'last-run.log'), out);
  console.log(out.split('\n').slice(-8).join('\n'));
} catch (err) {
  writeFileSync(join(LOGDIR, 'last-run.log'), `runner error: ${err instanceof Error ? err.stack : String(err)}`);
}

// ── SEO: IndexNow (บอท Bing/Yandex/Seznam/Naver) — ให้รู้ทันทีที่ URL เปลี่ยน (คำสั่งเจ้าของ 2/10/69)
//  รัน --strict เพื่อให้ exit code สะท้อนผลจริง แต่ไม่มีวันทำ nightly พัง: ผลแค่ไปโชว์ในรายงาน
let indexnow = null;
{
  const r = spawnSync('node', [join(REPO, 'tools', 'indexnow-shop-notify.mjs'), '--strict'], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((s) => s.trim()).filter(Boolean);
  indexnow = { ok: r.status === 0, last: out.find((l) => l.startsWith('indexnow-shop:')) ?? out[out.length - 1] ?? '' };
  writeFileSync(join(LOGDIR, 'indexnow.log'), out.join('\n') + '\n');
  console.log(`🔎 IndexNow: ${indexnow.last || '(ไม่มีผลลัพธ์)'}`);
}

// ── SEO pre-flight: ทุก URL ใน sitemap ยัง 200 + title/description/canonical ครบไหม (2/10/69) ──
let seo = null;
{
  const r = spawnSync('node', [join(REPO, 'tools', 'verify', 'seo-preflight.mjs'), '--strict'], {
    cwd: REPO, encoding: 'utf8', timeout: 180_000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((s) => s.trim()).filter(Boolean);
  seo = { ok: r.status === 0, last: out.find((l) => l.startsWith('seo-preflight:')) ?? out[out.length - 1] ?? '' };
  writeFileSync(join(LOGDIR, 'seo-preflight.log'), out.join('\n') + '\n');
  console.log(`🔎 SEO pre-flight: ${seo.last}`);
}

// ── SEO: GSC coverage — หน้าที่ Google เห็นจริง ตรงกับ sitemap ไหม (2/10/69) ──
//  ต้องมี credential (ยังไม่ได้ตั้ง = ข้ามเงียบ ไม่ทำให้ nightly แดง) · จับ "หน้าเคยติด index แล้วหายไป"
//  ซึ่ง seo-preflight มองไม่เห็นเพราะมันไม่รู้ว่า Google เข้ามาแล้วหรือยัง
let gsc = null;
{
  const r = spawnSync('node', [join(REPO, 'tools', 'verify', 'gsc-coverage.mjs'), '--strict'], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((s) => s.trim()).filter(Boolean);
  gsc = { ok: r.status === 0, last: out.find((l) => l.startsWith('gsc-coverage:')) ?? out[out.length - 1] ?? '' };
  writeFileSync(join(LOGDIR, 'gsc-coverage.log'), out.join('\n') + '\n');
  console.log(`🔎 GSC coverage: ${gsc.last}`);
}

// ── Backup: พิสูจน์ว่า dump ล่าสุดกู้คืนได้จริง (กู้เข้า DB ชั่วคราวแล้วลบทิ้ง ไม่แตะ DB จริง) ──
// ปิดได้ด้วย NIGHTLY_SKIP_RESTORE=1 (ถ้าเครื่องหนัก) · ค่าดีฟอลต์ = รันทุกคืน เพราะไฟล์ backup ที่กู้ไม่ได้
// = สำรองที่ใช้ไม่ได้ตอนฉุกเฉิน ซึ่งจะรู้ตัวทันทีไม่ได้ถ้าไม่ลอง
let restore = null;
if (process.env.NIGHTLY_SKIP_RESTORE === '1') {
  console.log('⏭ ข้ามการพิสูจน์ backup (NIGHTLY_SKIP_RESTORE=1)');
  restore = { ok: null, skipped: true, last: 'ข้าม (NIGHTLY_SKIP_RESTORE=1)' };
} else {
  const r = spawnSync('node', [join(REPO, 'tools', 'verify', 'backup-restore-check.mjs'), '--strict'], {
    cwd: REPO, encoding: 'utf8', timeout: 900_000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((s) => s.trim()).filter(Boolean);
  restore = { ok: r.status === 0, last: out.find((l) => l.startsWith('backup-restore-check:')) ?? out[out.length - 1] ?? '' };
  writeFileSync(join(LOGDIR, 'backup-restore-check.log'), out.join('\n') + '\n');
  console.log(`💾 Backup restore-check: ${restore.last}`);
}

// ── สถานะรวม (ให้ report + watchdog + หน้าเว็บอ่านต่อ) ──
// โครง system-truth.json: { ok, steps, prodTruth:{diskFingerprint,...} } — codeMatch/migrationHead
// ต้องคำนวณเองจาก /api/health (runtime fingerprint) เทียบกับดิสก์
let truth = {};
try { truth = JSON.parse(readFileSync(join(REPO, 'sovereign-os', 'core-api', 'data', 'system-truth.json'), 'utf8')); } catch { /* ไม่มี = เกตไม่ถึงขั้นเขียน */ }
// system-truth.json เขียนโดย verify.mjs ตอน gate ผ่านหมด (ล้ม = process.exit ก่อนเขียน)
// → ถ้าอ่านไฟล์เก่ามาแล้วรายงานว่า "ผ่าน" ทั้งที่รอบนี้ล้ม = ข้อมูลลวง (เคยเกิดจริง: ok=false แต่ lastGateOk=true)
// → เชื่อได้เฉพาะไฟล์ที่เขียนหลังเริ่มรอบนี้
const truthFresh = typeof truth?.writtenAt === 'string' && new Date(truth.writtenAt) >= new Date(runStartedAt);
if (!truthFresh) {
  console.log(`⚠️  system-truth.json ไม่ใช่ของรอบนี้${truth?.writtenAt ? ` (เขียนเมื่อ ${truth.writtenAt})` : ''} — จะไม่อ้างผลขั้นตอนในรายงาน`);
}
let runtimeFp = null, migrationHead = null;
try {
  const h = await fetch('http://localhost:3001/api/health', { signal: AbortSignal.timeout(10_000) });
  const j = await h.json();
  runtimeFp = j?.build?.fingerprint ?? null;
  migrationHead = j?.db?.migrationHead ?? null;
} catch { /* backend ล่ม = codeMatch ไม่มีข้อมูล */ }
const diskFp = truth.prodTruth?.diskFingerprint ?? null;
const codeMatch = diskFp && runtimeFp ? diskFp === runtimeFp : null;
const steps = truthFresh ? (truth.steps ?? []) : [];

// ── รวบรวม "ข้าม" — คำว่าผ่านที่มีรู ไม่ควรเงียบ (สั่งเจ้าของ 2/10/69) ──
// ต้นเหตุที่ทำให้เพิ่งเจอ: ข้ามแล้วรายงานเหมือนผ่าน ทำให้เชื่อว่าเทสต์รันทุกคืนตอนที่ไม่เคยรัน
const skipped = [];
for (const st of steps) {
  if (st.skipped) skipped.push({ name: st.name, why: 'เงื่อนไขขั้นตอนไม่ครบ (ดู logs/nightly/last-run.log)' });
}
if (!backend.up) {
  skipped.push({ name: 'e2e: prod-truth + Playwright', why: `backend :3001 ขึ้นไม่ได้${backend.error ? ` · ${backend.error.slice(0, 140)}` : ''}` });
}
if (restore?.skipped) skipped.push({ name: 'backup restore-check', why: 'NIGHTLY_SKIP_RESTORE=1' });
if (!indexnow) skipped.push({ name: 'IndexNow', why: 'สคริปต์ไม่คืนผลลัพธ์' });
if (!seo) skipped.push({ name: 'SEO pre-flight', why: 'สคริปต์ไม่คืนผลลัพธ์' });
if (!gsc) skipped.push({ name: 'GSC coverage', why: 'สคริปต์ไม่คืนผลลัพธ์' });

const status = {
  ok,
  durationMin: Math.round((Date.now() - t0) / 60_000),
  finishedAt: new Date().toISOString(),
  lastGateOk: truthFresh ? (truth.ok ?? null) : null,
  gateStepsFresh: truthFresh,
  codeMatch,
  migrationHead,
  steps,
  skipped,
  skippedCount: skipped.length,
  backend,
  indexnow,
  seo,
  gsc,
  restore,
  machine: { ok: machine.ok, problems: machine.problems ?? [], ramFreeGB: machine.info?.ramFreeGB ?? null, diskFreeGB: machine.info?.diskFreeGB ?? null, containers: machine.info?.containers ?? null },
};
writeFileSync(STATUS, JSON.stringify(status, null, 2) + '\n');

// ── Phase 4: history 30 วัน — ให้ /system-health วาดกราฟแนวโน้ม (ตามวันที่ รันซ้อน = แทนที่) ──
try {
  const histPath = join(REPO, 'sovereign-os', 'core-api', 'data', 'nightly-history.json');
  let hist = [];
  try { hist = JSON.parse(readFileSync(histPath, 'utf8')); } catch { /* ยังไม่มี */ }
  const day = status.finishedAt.slice(0, 10);
  const entry = {
    day,
    ok: status.ok,
    durationMin: status.durationMin,
    lastGateOk: status.lastGateOk,
    codeMatch: status.codeMatch,
    machineOk: status.machine?.ok ?? null,
    skippedCount: status.skippedCount,
  };
  hist = Array.isArray(hist) ? hist.filter((e) => e.day !== day) : [];
  hist.push(entry);
  while (hist.length > 30) hist.shift(); // เก็บ 30 วันล่าสุด
  writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
} catch { /* soft-fail — history พังไม่กระทบ nightly */ }
try { unlinkSync(LOCK); } catch { /* ข้าม */ }

// ── สรุป Telegram (สคริปต์แยก — soft-fail) — เก็บ output ไว้พิสูจน์เสมอ (ส่ง/skip/พลาด) ──
// NIGHTLY_REPORT_DRY=1 = พิมพ์ข้อความลง report.log แต่ไม่ส่งจริง (ใช้ตอนทดสอบระบบ = ไม่ต้องกวนเจ้าของตอนตี 2)
const rep = spawnSync('node', [join(REPO, 'tools', 'nightly-report.mjs'), STATUS,
  ...(process.env.NIGHTLY_REPORT_DRY === '1' ? ['--dry'] : [])], { cwd: REPO, encoding: 'utf8' });
writeFileSync(join(LOGDIR, 'report.log'), `${rep.stdout ?? ''}\n${rep.stderr ?? ''}`);
// process.exitCode ไม่ใช่ process.exit: บน Node 24/Windows การ exit ทันทีหลัง fetch
// (health check ข้างบน) ทำให้ libuv assert → Task Scheduler ได้ 127 แม้งานผ่านจริง
process.exitCode = ok ? 0 : 1;
