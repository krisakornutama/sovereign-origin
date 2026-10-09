#!/usr/bin/env node
// tools/install/install.mjs
//
// ── ตัวติดตั้ง "ครั้งเดียวจบ" ของทั้งโปรเจ็ก ─────────────────────────────────────
// เดิมงานติดตั้งกระจายอยู่หลายที่: Docker/ฐานข้อมูลอยู่ที่ install.ps1 · env ของ core-api
// อยู่ที่ setup-first-time.bat · ส่วน runner อยู่ที่ INSTALL-HUB.md (ทำมือ) ⇒ ติดตั้ง
// "สำเร็จ" แต่ยังใช้งานไม่ได้ เพราะขาดชั้นใดชั้นหนึ่งเสมอ
//
// ที่นี่รวมทุกชั้นไว้ที่เดียว: ตรวจเครื่อง → เขียน env ทุกชั้น → ติดตั้ง dependency
// → ยก stack (DB/MQTT/API) → migrate+seed → dashboard → runner ของเครื่องนี้
// → ตรวจสุขภาพทุกชั้นแล้วสรุปว่าอะไรพร้อม/อะไรต้องทำต่อ
//
//   node tools/install/install.mjs                 # ติดตั้ง/ซ่อมให้ครบ
//   node tools/install/install.mjs --dry-run       # ดูก่อน ไม่แตะอะไรเลย
//   node tools/install/install.mjs --verify-only   # ตรวจอย่างเดียว (ไม่เขียน/ไม่รัน)
//   node tools/install/install.mjs --with-runner --machine-token=<token จากหน้าเว็บ>
//
// รันซ้ำได้เสมอ: secret เดิม/ค่าที่ผู้ใช้ตั้งไว้จะไม่ถูกทับ (ดู tools/test/install-one-shot.test.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(HERE, 'sovereign.env.template');
const TASK_NAME = 'Sovereign Agent Runner';
const FRONTEND_PORT = 3000;
const API_PORT = 3001;

/** ลำดับขั้นของโหมดติดตั้งเต็ม */
const STEP_ORDER = ['preflight', 'env', 'deps', 'stack', 'db', 'frontend', 'runner', 'verify'];

const PATHS = {
  infraDir: 'sovereign-os/infra',
  infraEnv: 'sovereign-os/infra/.env',
  coreDir: 'sovereign-os/core-api',
  coreEnv: 'sovereign-os/core-api/.env',
  frontendDir: 'sovereign-frontend',
  frontendEnv: 'sovereign-frontend/.env.local',
  runnerDir: 'sovereign-os/agent-runner',
  runnerEnv: 'sovereign-os/agent-runner/.env',
};

// ── ที่รันคำสั่ง / อ่านเวลา / เรียกเครือข่าย: ฉีดได้ทั้งหมดเพื่อให้เทสต์คุมได้จริง ──

async function defaultExec(cmd, args = [], opts = {}) {
  return await new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 15 * 60 * 1000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      }
    );
  });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

/** npm บน Windows ต้องเป็น npm.cmd (execFile ไม่ผ่าน shell) */
const npmBin = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npxBin = () => (process.platform === 'win32' ? 'npx.cmd' : 'npx');

function parseArgv(argv = []) {
  const out = { flags: new Set(), values: {} };
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] === undefined) out.flags.add(m[1]);
    else out.values[m[1]] = m[2];
  }
  return out;
}

export async function runInstall(opts = {}) {
  const root = path.resolve(opts.root ?? path.resolve(HERE, '..', '..'));
  const exec = opts.exec ?? defaultExec;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? noop;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const dryRun = Boolean(opts.dryRun);
  const verifyOnly = Boolean(opts.verifyOnly);
  const withRunner = Boolean(opts.withRunner);
  const noFrontend = Boolean(opts.noFrontend);
  const skipDeps = Boolean(opts.skipDeps) || dryRun || verifyOnly;
  const force = Boolean(opts.force);
  const platform = opts.platform ?? process.platform;

  const steps = [];
  const plan = STEP_ORDER.map((name) => ({ name }));
  const add = (name, status, detail = '', nextAction = '') => {
    steps.push({ name, status, detail, nextAction });
    log(`  ${status === 'ok' ? '✔' : status === 'fail' ? '✘' : status === 'warn' ? '!' : '·'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const skipped = (name, why) => add(name, 'skipped', why);

  // ── 0. ค่าเริ่มต้น ───────────────────────────────────────────────────────────
  const hubUrlRaw = opts.hubUrl ?? process.env.SOVEREIGN_HUB_URL ?? `http://127.0.0.1:${API_PORT}`;
  const machineName = opts.machineName ?? opts.machine_name ?? os.hostname();
  const executors = opts.executors ?? 'echo';
  let hubUrl = hubUrlRaw;

  // ── verify-only: ตรวจอย่างเดียว ไม่แตะไฟล์ ไม่รันคำสั่ง ─────────────────────
  if (verifyOnly) {
    plan.length = 0;
    plan.push({ name: 'verify' });
    const r = await verifyLayer({ add, fetchImpl, hubUrl, withRunner, noFrontend, token: opts.machineToken ?? null });
    return finish({ steps, plan, add, dryRun: false, verifyOnly: true, hubUrl, verified: r });
  }

  // ── 1. preflight (บริสุทธิ์ — ไม่รันคำสั่ง ⇒ --dry-run ยังไม่แตะเครื่อง) ─────
  const composeFile = path.join(root, PATHS.infraDir, opts.prod ? 'docker-compose.prod.yml' : 'docker-compose.yml');
  const templateOk = fs.existsSync(TEMPLATE_PATH);
  try {
    if (!fs.existsSync(composeFile)) {
      throw new Error(`ไม่พบ ${path.relative(root, composeFile)} — ให้รันตัวติดตั้งจากรากโปรเจ็ก (หรือส่ง --root=<พาธราก>)`);
    }
    hubUrl = lib.assertHubUrl(hubUrlRaw);
    if (!templateOk) throw new Error(`ไม่พบเทมเพลต ${path.relative(root, TEMPLATE_PATH)}`);
    add('preflight', 'ok', `รากโปรเจ็ก=${root} · HUB=${hubUrl}`);
  } catch (err) {
    add('preflight', 'fail', String(err?.message ?? err), String(err?.message ?? err));
    for (const name of STEP_ORDER.slice(1)) skipped(name, 'preflight ไม่ผ่าน');
    return finish({ steps, plan, add, dryRun, hubUrl });
  }

  const templateText = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const readIf = (rel) => {
    const abs = path.join(root, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const writeIf = (rel, text) => {
    const abs = path.join(root, rel);
    const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (prev === text) return false;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, 'utf8');
    }
    return true;
  };

  // ── 2. env ทุกชั้น ──────────────────────────────────────────────────────────
  const preview = {};
  let infraText = readIf(PATHS.infraEnv);
  {
    const secrets = lib.generateSecrets();
    const built = lib.buildInfraEnv({
      templateText,
      existingText: infraText,
      secrets,
      force: force && !dryRun,
    });
    infraText = built.text;
    const rendered = lib.renderTemplate(templateText, secrets);
    const shown = built.text ?? rendered;
    preview[PATHS.infraEnv] = lib.redactSecrets(shown);
  }
  const coreBuilt = lib.buildCoreApiEnv({ infraText, existingText: readIf(PATHS.coreEnv) });
  preview[PATHS.coreEnv] = lib.redactSecrets(coreBuilt.text);
  const infraValues = lib.parseEnv(infraText);

  const envTouched = [];
  if (writeIf(PATHS.infraEnv, infraText)) envTouched.push(PATHS.infraEnv);
  if (writeIf(PATHS.coreEnv, coreBuilt.text)) envTouched.push(PATHS.coreEnv);

  const apiUrl = `http://localhost:${API_PORT}`;
  if (!noFrontend) {
    const feBuilt = lib.buildFrontendEnv({ apiUrl, existingText: readIf(PATHS.frontendEnv) });
    preview[PATHS.frontendEnv] = feBuilt.text;
    if (writeIf(PATHS.frontendEnv, feBuilt.text)) envTouched.push(PATHS.frontendEnv);
  }

  let runnerEnvText = null;
  if (withRunner) {
    // token เดิมในไฟล์มีค่าสูงกว่าธง — เครื่องนี้ลงทะเบียนแล้วไม่ต้องขอใหม่
    const existingRunner = readIf(PATHS.runnerEnv);
    const existingToken = existingRunner ? lib.parseEnv(existingRunner).MACHINE_TOKEN || '' : '';
    const built = lib.buildRunnerEnv({
      hubUrl,
      token: existingToken || opts.machineToken || '',
      name: machineName,
      executors,
      existingText: existingRunner,
    });
    runnerEnvText = built.text;
    // token ของผู้ใช้ต้องเห็นได้ (จะได้ตรวจว่าตัวถูก) — คีย์ที่ตัวติดตั้งสุ่มเองไม่มีในไฟล์นี้อยู่แล้ว
    preview[PATHS.runnerEnv] = built.text;
    if (writeIf(PATHS.runnerEnv, built.text)) envTouched.push(PATHS.runnerEnv);

    const launcher = lib.buildRunnerLauncher({ runnerDir: path.join(root, PATHS.runnerDir), nodeExe: process.execPath });
    if (writeIf(path.join(PATHS.runnerDir, 'run-runner.cmd'), launcher.text)) {
      envTouched.push(path.join(PATHS.runnerDir, 'run-runner.cmd'));
    }
  }

  if (!dryRun) {
    fs.mkdirSync(path.join(root, PATHS.infraDir), { recursive: true });
    const creds = `# เข้าสู่ระบบ Sovereign OS — อย่า commit ไฟล์นี้ (อยู่ใน .gitignore)\n` +
      `SEED_ADMIN_PASSWORD=${infraValues.SEED_ADMIN_PASSWORD ?? ''}\nJWT_SECRET=${infraValues.JWT_SECRET ?? ''}\n`;
    writeIf(path.join(PATHS.infraDir, '.credentials'), creds);
  }
  add(
    'env',
    'ok',
    envTouched.length ? `เขียน/อัปเดต ${envTouched.length} ไฟล์: ${envTouched.join(', ')}` : 'ไฟล์ตั้งค่าครบแล้ว (ไม่แก้ของเดิม)'
  );

  if (dryRun) {
    for (const name of ['deps', 'stack', 'db', 'frontend', 'runner', 'verify']) {
      plan.push({ name });
      skipped(name, 'dry-run — ไม่ได้ลงมือ');
    }
    return finish({ steps, plan, add, dryRun, hubUrl, preview });
  }

  // ── 3. dependency ──────────────────────────────────────────────────────────
  if (skipDeps) {
    skipped('deps', 'ข้ามตามที่สั่ง');
  } else {
    const targets = [PATHS.coreDir, ...(noFrontend ? [] : [PATHS.frontendDir])];
    const done = [];
    let failure = '';
    for (const rel of targets) {
      const dir = path.join(root, rel);
      if (!fs.existsSync(dir)) {
        failure = `ไม่พบโฟลเดอร์ ${rel}`;
        break;
      }
      if (fs.existsSync(path.join(dir, 'node_modules'))) {
        done.push(`${rel} (มีอยู่แล้ว)`);
        continue;
      }
      const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
      log(`  … ติดตั้ง dependency ของ ${rel} (${hasLock ? 'npm ci' : 'npm install'})`);
      const res = await exec(npmBin(), [hasLock ? 'ci' : 'install'], { cwd: dir });
      if (res.code !== 0) {
        failure = `${rel}: ${(res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ')}`;
        break;
      }
      done.push(rel);
    }
    if (failure) add('deps', 'fail', failure, 'ติดตั้ง dependency ไม่สำเร็จ — ตรวจเน็ต/สิทธิ์เขียนโฟลเดอร์ แล้วรันใหม่');
    else add('deps', 'ok', done.join(' · ') || 'ไม่มีอะไรต้องติดตั้ง');
  }

  // ── 4. stack: DB + MQTT + API ──────────────────────────────────────────────
  {
    const info = await exec('docker', ['info']);
    if (info.code !== 0) {
      add(
        'stack',
        'fail',
        'Docker daemon ไม่ตอบ',
        'เปิด Docker Desktop ให้เรียบร้อยแล้วรันตัวติดตั้งใหม่'
      );
    } else {
      const composeV2 = await exec('docker', ['compose', 'version']);
      if (composeV2.code !== 0) {
        add('stack', 'fail', 'ไม่มี docker compose v2', 'อัปเดต Docker Desktop (ต้องมี plugin compose v2)');
      } else {
        const up = await exec('docker', [
          'compose',
          '-f',
          composeFile,
          'up',
          '-d',
          'timescaledb',
          'emqx',
          'core-api',
        ]);
        if (up.code !== 0) {
          const tail = (up.stderr || up.stdout || '').trim().split('\n').slice(-3).join(' ');
          add('stack', 'fail', `compose up ล้ม: ${tail}`, `ดู log: docker compose -f "${composeFile}" logs core-api`);
        } else {
          const user = infraValues.POSTGRES_USER || 'sovereign';
          let ready = false;
          for (let i = 0; i < 30; i += 1) {
            const ping = await exec('docker', ['exec', 'sovereign-db', 'pg_isready', '-U', user]);
            if (ping.code === 0) {
              ready = true;
              break;
            }
            await sleep(2000);
          }
          if (ready) add('stack', 'ok', 'containers ขึ้นแล้ว · ฐานข้อมูลตอบ pg_isready');
          else add('stack', 'fail', 'ฐานข้อมูลไม่พร้อมใน 60 วินาที', 'ดู log: docker logs sovereign-db');
        }
      }
    }
  }

  // ── 5. db: migrate + seed ──────────────────────────────────────────────────
  if (steps.some((s) => s.name === 'stack' && s.status === 'fail')) {
    skipped('db', 'stack ยังไม่พร้อม');
  } else {
    const migrate = await exec('docker', ['exec', 'sovereign-core-api', 'npx', 'prisma', 'migrate', 'deploy']);
    if (migrate.code !== 0) {
      const tail = (migrate.stderr || migrate.stdout || '').trim().split('\n').slice(-3).join(' ');
      add('db', 'fail', `migrate ล้ม: ${tail}`, 'ดู log: docker logs sovereign-core-api');
    } else {
      // seed เป็น best-effort: รันซ้ำจะไม่พัง และการ seed ล้มไม่ควรทำให้ทั้งการติดตั้งถูกมองว่าไม่ผ่าน
      const seed = await exec('docker', ['exec', 'sovereign-core-api', 'npx', 'tsx', 'src/scripts/seed.ts']);
      if (seed.code !== 0) add('db', 'warn', 'migrate ผ่าน แต่ seed ไม่ผ่าน (มีข้อมูลอยู่แล้วได้)');
      else add('db', 'ok', 'migrate + seed ผ่าน');
    }
  }

  // ── 6. dashboard ───────────────────────────────────────────────────────────
  if (noFrontend) {
    skipped('frontend', 'ข้ามตามที่สั่ง (--no-frontend)');
  } else {
    const already = await probe(fetchImpl, `http://127.0.0.1:${FRONTEND_PORT}/`);
    if (already.state === 'up') {
      add('frontend', 'ok', `มีตัวให้บริการอยู่แล้วที่ :${FRONTEND_PORT}`);
    } else {
      const feDir = path.join(root, PATHS.frontendDir);
      const buildId = path.join(feDir, '.next', 'BUILD_ID');
      let buildFailed = false;
      if (!fs.existsSync(buildId)) {
        log('  … ยังไม่มี production build — npm run build (ครั้งแรกอาจหลายนาที)');
        const build = await exec(npmBin(), ['run', 'build'], { cwd: feDir });
        if (build.code !== 0) {
          buildFailed = true;
          add('frontend', 'fail', 'build ล้ม', `รันเองเพื่อดู error: cd ${PATHS.frontendDir} && npm run build`);
        }
      }
      if (!buildFailed) {
        if (platform === 'win32') {
          await exec('cmd', ['/c', 'start', 'Sovereign-Frontend', '/min', 'cmd', '/k', `npm run start -- -p ${FRONTEND_PORT}`], { cwd: feDir });
        } else {
          await exec('sh', ['-c', `nohup npm run start -- -p ${FRONTEND_PORT} >> ../logs/frontend.log 2>&1 &`], { cwd: feDir });
        }
        let up = false;
        for (let i = 0; i < 30; i += 1) {
          const p = await probe(fetchImpl, `http://127.0.0.1:${FRONTEND_PORT}/`);
          if (p.state === 'up') {
            up = true;
            break;
          }
          await sleep(2000);
        }
        add(
          'frontend',
          up ? 'ok' : 'warn',
          up ? `เปิด dashboard ที่ :${FRONTEND_PORT} แล้ว` : 'สั่งเปิดแล้วแต่ยังไม่ตอบใน 60 วินาที',
          up ? '' : `เปิดเองได้: cd ${PATHS.frontendDir} && npm run start -- -p ${FRONTEND_PORT}`
        );
      }
    }
  }

  // ── 7. runner ของเครื่องนี้ ────────────────────────────────────────────────
  let runnerToken = '';
  if (!withRunner) {
    skipped('runner', 'ไม่ได้สั่ง (ใส่ --with-runner เพื่อติดตั้งบนเครื่องนี้)');
  } else {
    runnerToken = lib.parseEnv(runnerEnvText ?? '').MACHINE_TOKEN || '';
    if (!runnerToken) {
      add(
        'runner',
        'fail',
        'ยังไม่มี MACHINE_TOKEN — เครื่องนี้จะต่อ HUB ไม่ได้',
        'เปิดหน้า /agent-queue → ลงทะเบียนเครื่องใหม่ → คัดลอก token แล้วรันใหม่ด้วย --machine-token=<token>'
      );
    } else if (platform !== 'win32') {
      add('runner', 'warn', 'ไม่ใช่ Windows — ยังไม่ตั้ง scheduled task', `รันเอง: cd ${PATHS.runnerDir} && node src\\main.mjs`);
    } else {
      const launcherPath = path.join(root, PATHS.runnerDir, 'run-runner.cmd');
      const createArgs = lib.buildRunnerTaskCreateArgs({ taskName: TASK_NAME, launcherPath });
      const create = await exec(createArgs[0], createArgs.slice(1));
      const query = await exec('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST', '/V']);
      const parsed = lib.parseSchtasksQuery(query.stdout || query.stderr || '');
      if (create.code !== 0 || !parsed.exists) {
        add(
          'runner',
          'fail',
          lib.pathHasSpace(root)
            ? 'สร้าง scheduled task ไม่สำเร็จ (พาธมีเว้นวรรค)'
            : 'สร้าง scheduled task ไม่สำเร็จ',
          'คลิกขวาตัวติดตั้ง/terminal → Run as administrator แล้วรันใหม่ (ต้องมีสิทธิ์สร้าง task)'
        );
      } else if (!/run-runner\.cmd/i.test(parsed.taskToRun)) {
        add('runner', 'fail', `task ชี้ผิดที่: ${parsed.taskToRun}`, 'ลบ task เก่าแล้วรันใหม่: schtasks /Delete /TN "' + TASK_NAME + '" /F');
      } else {
        await exec('schtasks', ['/Run', '/TN', TASK_NAME]);
        add('runner', 'ok', `scheduled task พร้อม (ONLOGON + สั่งรันเดี๋ยวนี้) → ${parsed.taskToRun}`);
      }
    }
  }

  // ── 8. ตรวจสุขภาพทุกชั้น ──────────────────────────────────────────────────
  await verifyLayer({ add, fetchImpl, hubUrl, withRunner: withRunner && Boolean(runnerToken), noFrontend, token: runnerToken || null });

  return finish({ steps, plan, add, dryRun, hubUrl, preview });
}

/** ตรวจสุขภาพ — คืนรายละเอียดไว้ให้ผู้เรียกใช้ต่อได้ */
async function verifyLayer({ add, fetchImpl, hubUrl, withRunner, noFrontend, token }) {
  const problems = [];

  const api = await probe(fetchImpl, `http://127.0.0.1:${API_PORT}/api/health`);
  if (api.state === 'up') {
    add('verify:api', 'ok', `core-api ตอบ ${api.status} ที่ /api/health`);
  } else {
    problems.push(`core-api ไม่ตอบปกติ (${api.state}${api.status ? ` ${api.status}` : ''}) ที่ http://127.0.0.1:${API_PORT}/api/health`);
  }

  if (!noFrontend) {
    const web = await probe(fetchImpl, `http://127.0.0.1:${FRONTEND_PORT}/`);
    if (web.state === 'up') add('verify:web', 'ok', `dashboard ตอบ ${web.status} ที่ :${FRONTEND_PORT}`);
    else problems.push(`dashboard ไม่ตอบปกติ (${web.state}) ที่ http://127.0.0.1:${FRONTEND_PORT}/`);
  }

  // ช่องควบคุมเครื่อง: ฟีเจอร์เสริมจากสาย ai/machine-console — ตัวติดตั้งไม่ได้สร้าง route นี้เอง
  // เดิมนับ 404 เป็นขั้นล้ม ⇒ เครื่องที่รันโค้ดจาก main ติดตั้งจบแล้วได้ exit 1 และคำแนะนำ
  // "restart core-api" ที่แก้ไม่ได้จริง (รีสตาร์ทไม่ทำให้ route ที่ไม่มีในโค้ดโผล่มา)
  const mc = await raw(fetchImpl, `${hubUrl}/api/machine-control/state`);
  if (mc.status === 0) {
    add('verify:machine-console', 'warn', `${hubUrl}/api/machine-control/state — ไม่ตอบคำถามจากเครื่องนี้ (ตรวจไม่ได้)`);
  } else if (mc.status === 404) {
    add(
      'verify:machine-console',
      'warn',
      `${hubUrl}/api/machine-control/state = 404 — สาขาที่ HUB รันอยู่ยังไม่มีฟีเจอร์นี้ (ไม่นับเป็นความล้มเหลวของการติดตั้ง)`,
      'ถ้าต้องใช้ช่องควบคุมเครื่อง: เอาโค้ด machine-console (สาย ai/machine-console) เข้าสาขาที่ HUB รันอยู่ แล้ว build/ปล่อย core-api ใหม่'
    );
  } else {
    add('verify:machine-console', 'ok', `route ช่องควบคุมตอบ ${mc.status} (พร้อมใช้งาน)`);
  }

  if (withRunner && token) {
    const hb = await raw(fetchImpl, `${hubUrl}/api/agent-machines/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-machine-token': token },
      body: JSON.stringify({ version: process.version }),
    });
    if (hb.status === 200) add('verify:runner', 'ok', 'token ของเครื่องนี้ใช้ได้จริง (heartbeat ผ่าน)');
    else problems.push(`heartbeat ของ runner ตอบ ${hb.status} — token อาจไม่ถูกต้องหรือ HUB ยังไม่พร้อม`);
  }

  if (problems.length) add('verify', 'fail', problems.join(' · '), problems[0]);
  else add('verify', 'ok', 'ทุกชั้นที่ตรวจตอบปกติ');
  return { problems };
}

async function probe(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (res?.ok || (res?.status ?? 0) < 400) return { state: 'up', status: res.status };
    return { state: 'bad', status: res.status };
  } catch (err) {
    return { state: 'down', error: String(err?.message ?? err) };
  }
}

async function raw(fetchImpl, url, init) {
  try {
    const res = await fetchImpl(url, init);
    return { status: res?.status ?? 0 };
  } catch (err) {
    return { status: 0, error: String(err?.message ?? err) };
  }
}

/** สรุป + ส่งออกผล (exitCode จากขั้นที่ล้มเท่านั้น — ห้ามรายงานว่าเสร็จเมื่อมีขั้นล้ม) */
function finish({ steps, plan, dryRun, hubUrl, preview = null }) {
  const summary = lib.summarizeSteps(steps);
  const lines = [];
  lines.push('══════════════════════════════════════════════════');
  lines.push('  Sovereign Origin — ตัวติดตั้งครั้งเดียว (ทั้งโปรเจ็ก)');
  lines.push('══════════════════════════════════════════════════');
  for (const s of steps) {
    const mark = s.status === 'ok' ? '✔' : s.status === 'fail' ? '✘' : s.status === 'warn' ? '!' : '·';
    lines.push(`  ${mark} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  }
  if (dryRun) {
    lines.push('');
    lines.push('  [dry-run] ไม่ได้ลงมือ — นี่คือแผนและไฟล์ที่จะสร้าง (ค่าความลับถูกปิด)');
    if (preview) {
      for (const [file, text] of Object.entries(preview)) {
        lines.push('');
        lines.push(`  ── ${file} ─────────────────────────────`);
        for (const line of String(text).split('\n')) if (/^[A-Z]/.test(line)) lines.push(`  ${line}`);
      }
    }
  }
  if (summary.nextActions.length) {
    lines.push('');
    lines.push('  ขั้นถัดไป:');
    for (const a of summary.nextActions) lines.push(`    - ${a}`);
  } else if (!dryRun) {
    const webUrl = lib.webUiUrl(hubUrl);
    const dashboardReady = steps.some((s) => (s.name === 'frontend' || s.name === 'verify:web') && s.status === 'ok');
    lines.push('');
    lines.push(
      dashboardReady
        ? `  ✅ พร้อมใช้งาน — เข้าหน้าเว็บที่ ${webUrl} แล้วล็อกอินด้วยรหัสใน sovereign-os/infra/.credentials`
        : `  ✅ พร้อมใช้งานฝั่ง API — เครื่องนี้ไม่ได้ติดตั้งหน้าเว็บ (หน้าเว็บของ HUB: ${webUrl} · รหัสใน sovereign-os/infra/.credentials)`
    );
  }
  lines.push('');
  const report = lines.join('\n');

  return { exitCode: summary.exitCode, failed: summary.failed, nextActions: summary.nextActions, steps, plan, report, preview };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const { flags, values } = parseArgv(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) {
    console.log(`ตัวติดตั้งครั้งเดียวของ Sovereign Origin

  node tools/install/install.mjs [options]

  --dry-run              ดูแผน + ไฟล์ที่จะสร้าง โดยไม่เขียนและไม่รันอะไรเลย
  --verify-only          ตรวจสุขภาพทุกชั้นอย่างเดียว (ปลอดภัย ไม่แตะระบบ)
  --with-runner          ติดตั้ง agent-runner บนเครื่องนี้ (+ scheduled task)
  --machine-token=..     token จากหน้า /agent-queue (แสดงครั้งเดียวตอนลงทะเบียนเครื่อง)
  --machine-name=..      ชื่อเครื่องที่จะโผล่ใน HUB (ค่าเริ่มต้น = ชื่อเครื่องนี้)
  --executors=..         executor ที่เครื่องนี้ทำได้ เช่น echo,opencode (ค่าเริ่มต้น echo)
  --hub-url=..           ที่อยู่ HUB (ค่าเริ่มต้น http://127.0.0.1:3001)
  --no-frontend          ข้าม dashboard (กรณีมีตัวอื่นถือพอร์ต 3000 อยู่)
  --prod                 ใช้ docker-compose.prod.yml
  --skip-deps            ข้ามการติดตั้ง dependency
  --force                สุ่มความลับใหม่ (สำรอง .env เดิมเป็น .bak ให้เอง)
  --root=<พาธ>           รากโปรเจ็ก (ค่าเริ่มต้น = โฟลเดอร์ที่ไฟล์นี้อยู่)
`);
    return;
  }

  const root = values.root ?? path.resolve(HERE, '..', '..');
  if (flags.has('force')) {
    const envPath = path.join(root, PATHS.infraEnv);
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, `${envPath}.bak`);
      console.log('  ! สำรองไฟล์ตั้งค่าเดิมไว้ที่ sovereign-os/infra/.env.bak');
    }
  }
  const out = await runInstall({
    root,
    dryRun: flags.has('dry-run'),
    verifyOnly: flags.has('verify-only'),
    withRunner: flags.has('with-runner'),
    noFrontend: flags.has('no-frontend'),
    skipDeps: flags.has('skip-deps'),
    force: flags.has('force'),
    prod: flags.has('prod'),
    hubUrl: values['hub-url'],
    machineName: values['machine-name'],
    machineToken: values['machine-token'],
    executors: values.executors,
    log: (m) => console.log(m),
  });
  console.log(out.report);
  process.exitCode = out.exitCode;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error('[install] ล้มเหลว:', err?.stack ?? err);
    process.exitCode = 1;
  });
}
