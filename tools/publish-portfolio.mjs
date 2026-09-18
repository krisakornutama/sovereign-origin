#!/usr/bin/env node
/* publish-portfolio — คำสั่งเดียวจบ: sync → commit → push → (watch CI)
   ที่มา: sync มือ + commit -c identity + จับ CI เอง — พลาดง่าย (ผิด dir, ลืม identity)
   ใช้: node tools/publish-portfolio.mjs [--check] [--watch] [--message "เหตุผลสั้น ๆ"] [--no-indexnow]
   --check = ดูอย่างเดียว (dry-run) · --watch = รอ CI "Audit site" จนจบ · --no-indexnow = ข้ามยิง IndexNow ท้ายงาน
   โหมด CI (GitHub Actions): ตั้ง env PUBLISH_REPO_URL=<url ของ publish repo> เมื่อรันบน runner ที่ไม่มี portfolio/.git — script จะ clone ชั่วคราว แล้ว push กลับ (workflow ต้องจัด credential ให้เอง) */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const WATCH = args.includes('--watch');
/* กันข้อความที่มี \(mirror of …\) ติดมาแล้ว → เคยออกซ้ำสองรอบในประวัติจริง */
const MSG = ((args.find((a) => a.startsWith('--message=')) || '').slice('--message='.length) || 'site update')
  .replace(/\s*\(mirror of [0-9a-f]{7,40}\)\s*$/i, '');
const SKIP_INDEXNOW = args.includes('--no-indexnow'); // IndexNow = ping บอทค้นหาท้ายงาน (fail-safe — ล้มได้ ไม่กระทบ publish)
const NOTIFIER = process.env.SOVEREIGN_NOTIFIER || path.join(ROOT, 'tools', 'indexnow-notify.mjs'); // override ได้เฉพาะเทสต์สัญญา
const CI_REPO_URL = process.env.PUBLISH_REPO_URL || ''; // โหมด CI: clone publish repo ชั่วคราวแทนการหาบนดิสก์
const CI_TOKEN = process.env.PAGES_TOKEN || ''; // token อยู่แค่ใน env — ห้ามปรากฏใน URL/log/config ทุกเส้นทาง
/* สิทธิ์แบบ actions/checkout: Basic auth ผ่าน http.extraheader เฉพาะคำสั่งที่ยิงไป github.com
   → token ไม่เคยฝังใน URL (ไม่โผล่ใน log/error ของ git) และไม่ถูกเขียนลง .git/config (–c เท่านั้น)
   ยังรองรับ URL แบบเก่าที่ฝัง token ไว้ด้วย (ยังใช้ได้) — แต่ log จะถูก redact เสมอ */
const ghAuthArgs = CI_TOKEN
  ? ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${CI_TOKEN}`).toString('base64')}`]
  : [];
const redact = (u) => String(u).replace(/\/\/[^/@\s]*@/, '//***@/'); // กันพลาด: URL ไหนมี credential ติดมา ห้ามโชว์ใน log
/* คำสั่ง git ที่ต้องพกสิทธิ์ (clone/push) ต้องผ่าน authed เท่านั้น — git ล้มแล้ว Node จะพิมพ์ command ทั้งแถวใน error
   ห้ามปล่อยหลุด: ทุก error ต้องผ่าน sanitizeErr (ตัด Basic auth + redact URL ก่อนพิมพ์ทุกครั้ง) */
const sanitizeErr = (e) => String((e && e.message) || e)
  .replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: Basic ***')
  .replace(/\/\/[^/@\s]*@/g, '//***@/');
const authed = (dir, ...a) => {
  try { return execFileSync('git', ['-C', dir, ...ghAuthArgs, ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
  catch (e) { throw new Error(sanitizeErr(e)); }
};

const LOG_FILE = path.join(ROOT, 'publish-indexnow.log'); // ประวัติการยิงลงไฟล์ท้ายโปรเจกต์ (*.log ถูก gitignore อยู่แล้ว)
const note = (kind, fields) => {
  try {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const pairs = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ')}`).join(' ');
    fs.appendFileSync(LOG_FILE, `${ts}  ${kind.padEnd(14)} ${pairs}\n`);
  } catch { /* log เขียนไม่ได้ = ไม่สำคัญพอให้ publish ล้ม */ }
};
const sha = (dir, ref = 'HEAD') => execFileSync('git', ['-C', dir, 'rev-parse', '--short', ref]).toString().trim();
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a]).toString().trim();
/* ห้าม trim ผลของ git status --porcelain: รูปแบบคือ "XY path" — ช่องว่างนำหน้ามีความหมาย
   (เจอจริงผ่านเทสต์สัญญา: trim ทำให้ slice(3) ตัดชื่อไฟล์ขาด → fatal: pathspec 'EADME.md') */
const gitRaw = (dir, ...a) => execFileSync('git', ['-C', dir, ...a]).toString().replace(/\r\n/g, '\n');
const log = (s) => console.log(s);
const norm = (p) => fs.readFileSync(p).toString().replace(/\r\n/g, '\n'); // EOL-noise (autocrlf) ไม่นับเป็นต่าง — ไม่งั้น commit แล้วไม่มีอะไร staged

/* job summary ของ GitHub Actions (หน้าสรุปรอบ run) — เขียนล้มได้ ต้องไม่ทำ publish ล้ม (นอก runner ไม่มีตัวแปรสภาพแวดล้อมนี้ = ข้าม) */
const summary = (lines) => {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try { fs.appendFileSync(f, lines.join('\n') + '\n'); } catch { /* ไม่สำคัญพอให้ publish ล้ม */ }
};

/* 1. locate publish repo — สองโทโพโลยี:
   (ก) main worktree: portfolio/ คือ publish repo เอง (มี .git ซ้อน) → sameDir, ไม่ต้อง sync
   (ข) task worktree: portfolio/ เป็นสำเนา git → publish repo อยู่ที่ portfolio/ ของ main worktree */
function findPublishRepo() {
  if (fs.existsSync(path.join(ROOT, 'portfolio', '.git'))) return { dir: path.join(ROOT, 'portfolio'), sameDir: true };
  try {
    const wt = execFileSync('git', ['-C', ROOT, 'worktree', 'list', '--porcelain']).toString();
    const main = (wt.split('\n').find((l) => l.startsWith('worktree ')) || '').slice(9);
    const cand = main && path.join(main, 'portfolio');
    if (cand && fs.existsSync(path.join(cand, '.git'))) return { dir: cand, sameDir: false };
  } catch { /* fallthrough */ }
  return null;
}
let pub = findPublishRepo();
/* โหมด CI: บน runner ไม่มี publish repo บนดิสก์ — clone ชั่วคราวใน workspace (ถูกทิ้งหลัง job ไม่ต้องเก็บกวาด)
   ในเครื่องปกติ findPublishRepo เจออยู่แล้ว สาขานี้จึงไม่มีวันทำงาน */
if (!pub && CI_REPO_URL) {
  const tmp = path.join(ROOT, '.publish-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  try { authed(ROOT, 'clone', '--depth', '1', CI_REPO_URL, tmp); }
  catch (e) { console.error(`✗ clone publish repo ไม่สำเร็จ: ${e.message.split('\n')[0]}`); process.exit(1); }
  pub = { dir: tmp, sameDir: false };
  log(`CI mode: clone ${redact(CI_REPO_URL)} → .publish-tmp`);
}
if (!pub) { console.error('✗ หา publish repo ไม่เจอ (ไม่มี portfolio/.git ทั้งใน worktree นี้และ main worktree) — หรือตั้ง env PUBLISH_REPO_URL สำหรับโหมด CI'); process.exit(1); }
const DEST = pub.dir;
const monorepoSha = sha(ROOT);

/* 2. whitelist ไฟล์ที่เผยแพร่ — ไม่แตะ node_modules/.git */
function walk(rel, out) {
  for (const e of fs.readdirSync(path.join(ROOT, 'portfolio', rel), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(r, out);
    else out.push(r);
  }
}
let publishFiles = [];
for (const f of fs.readdirSync(path.join(ROOT, 'portfolio'), { withFileTypes: true })) {
  if (f.name === 'node_modules' || f.name === '.git') continue;
  if (f.isFile() && (/\.html$/.test(f.name) || /\.(css|js|png|txt|xml)$/.test(f.name) || f.name === '.nojekyll' ||
      f.name === 'README.md' || f.name === 'package.json' || f.name === 'package-lock.json')) publishFiles.push(f.name);
  if (f.isDirectory() && (f.name === 'scripts' || f.name === '.github' || f.name === 'evidence')) { // evidence = หลักฐานหน้างานจริงของ guardmini (รูป/คลิป/CSV) — เจ้าของทิ้งไฟล์แล้วเว็บโชว์เอง
    walk(f.name, publishFiles);
    // กันไฟล์ทดลองหลุดขึ้น production (เคยเกิดจริง: scripts/tmp-perf.mjs ถูก sync ขึ้น Pages)
    publishFiles = publishFiles.filter((r) => !/(^|\/)(tmp-[^/]*|[^/]*\.bak)$/.test(r));
  }
}

/* 3. dirty guard — กันกลืนงานคนอื่น: diff เนื้อหาจริง = หยุด · EOL-noise (autocrlf) จัดการเองด้วย git add (git normalize เอง — noise แบบนี้เกิดจาก sync ตัวเองในรอบก่อนด้วย) */
const dirty = gitRaw(DEST, 'status', '--porcelain').split('\n').filter(Boolean);
if (dirty.length && !pub.sameDir) {
  if (!CHECK) {
    git(DEST, 'add', '-A');
    const real = git(DEST, 'diff', '--cached', '--name-only');
    if (real) {
      console.error('✗ publish repo มี diff เนื้อหาจริงค้างก่อนเริ่ม — จัดการก่อน (git reset เพื่อคืนสถานะเดิม):');
      real.split('\n').filter(Boolean).slice(0, 10).forEach((r) => console.error('   ' + r));
      process.exit(1);
    }
    log(`EOL-noise ${dirty.length} ไฟล์ — add แล้ว diff จริงเป็นศูนย์ เดินต่อได้`);
  } else {
    log(`publish repo มี ${dirty.length} ไฟล์ค้าง (dry-run — ไม่แตะ)`);
  }
}
if (dirty.length && pub.sameDir) log(`publish repo มี ${dirty.length} ไฟล์ค้างอยู่แล้ว (sameDir — จะรวม commit ด้วย)`);

/* 4. sync — copy เฉพาะตัวที่ต่างจริง ๆ (sameDir = ข้าม เพราะเป็นโฟลเดอร์เดียวกัน) */
let changed = [];
if (pub.sameDir) {
  changed = dirty.map((l) => l.slice(3));
  log(`sameDir mode: ${changed.length} ไฟล์ค้างใน publish repo (ไม่ต้อง sync)`);
  changed.slice(0, 20).forEach((c) => log('   M ' + c));
} else {
  for (const rel of publishFiles) {
    const a = path.join(DEST, rel);
    const b = path.join(ROOT, 'portfolio', rel);
    if (!fs.existsSync(b)) { console.error(`   ⚠ ข้าม ${rel} — ไม่มีใน monorepo`); continue; }
    const same = fs.existsSync(a) && norm(a) === norm(b);
    if (!same) {
      if (!CHECK) { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.copyFileSync(b, a); }
      changed.push(rel);
    }
  }
  log(`sync: ${changed.length} ไฟล์ต่างจาก publish repo${CHECK ? ' (dry-run — ไม่ได้คัดลอก)' : ''}`);
  changed.slice(0, 20).forEach((c) => log('   M ' + c));
  if (changed.length > 20) log(`   … +${changed.length - 20}`);
}

/* 5. commit (identity บ้านจาก monorepo — ไม่แก้ config) + push */
if (!CHECK) {
  if (changed.length === 0) {
    log('✓ publish repo ตรงกับ monorepo อยู่แล้ว — ไม่มีอะไรจะ publish');
    summary(['## Deploy portfolio — publish', '- ไม่มีอะไรจะ publish: publish repo ตรงกับ monorepo อยู่แล้ว', `- monorepo: \`${monorepoSha}\``]);
    process.exit(0);
  }
  git(DEST, 'add', ...changed);
  /* identity: ในเครื่องอ่านจาก config บ้าน — บน runner (โหมด CI) ไม่มี config จึง fallback เป็น bot */
  const cfg = (k, fb) => { try { return git(ROOT, 'config', k); } catch { return fb; } };
  const name = cfg('user.name', 'sovereign-pages-bot');
  const email = cfg('user.email', 'sovereign-pages-bot@users.noreply.github.com');
  execFileSync('git', ['-C', DEST, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit',
    '-m', `portfolio: ${MSG} (mirror of ${monorepoSha})`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const pubSha = sha(DEST);
  log(`commit: ${pubSha} (${name})`);
  try { authed(DEST, 'push', 'origin', 'main'); }
  catch (e) { console.error(`✗ push ไป publish repo ไม่สำเร็จ: ${e.message.split('\n')[0]}`); process.exit(1); }
  log(`push: origin/main → ${pubSha}`);
  /* ลิงก์ CI เป็นของแถม — remote ที่ไม่ใช่ GitHub (เช่น host อื่น) ต้องไม่ทำ publish ล้ม */
  const remoteUrl = git(DEST, 'config', 'remote.origin.url');
  const gh = remoteUrl.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  log(gh && /github\.com/.test(remoteUrl) ? `CI: https://github.com/${gh[1]}/actions` : `remote: ${redact(remoteUrl)} (ไม่ใช่ GitHub — ไม่มีหน้าต่าง CI)`);
  note('publish', { mirror: pubSha, mono: monorepoSha, files: changed.length, msg: MSG.slice(0, 90) });
  log(`log: ${path.relative(ROOT, LOG_FILE)}`);

  /* 5.5 IndexNow — ping เครื่องมือค้นหาให้บอทมา crawl หน้าใหม่ทันที (fail-safe ไม่มีวันทำ publish ล้ม)
     ส่งไฟล์ที่เปลี่ยนไปให้ด้วย: ตัวยิงจะรอจน production เสิร์ฟเนื้อหาชุดนั้นจริงก่อนยิง (ไม่ยิงก่อน deploy เสร็จ) */
  const verifyArgs = changed
    .filter((f) => /\.(html|md|xml|png|txt)$/i.test(f) && !f.startsWith('.'))
    .slice(0, 3)
    .flatMap((f) => [`--verify-file=${f}`]);
  let indexnowLine = '— (ไม่ได้ยิง: --no-indexnow)';
  if (!SKIP_INDEXNOW) {
    /* เปลี่ยนจาก execFileSync+inherit เป็น spawnSync เพื่อจับผลทั้ง stdout/stderr/status ไปเขียน job summary
       — ตัวยิง fail-safe จะ exit 0 พร้อมข้อความ ✗ บน stderr ได้ ห้ามตีความว่า exit 0 = ยิงสำเร็จ
       output พิมพ์คืนให้ log ครบเหมือนเดิม (ต่างแค่จบก่อนค่อยโผล่) */
    const r = spawnSync('node', [NOTIFIER, '--wait', `--expect-sha=${pubSha}`, ...verifyArgs], { encoding: 'utf8' });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.error) {
      indexnowLine = '⚠ เรียกตัวยิงไม่ได้ — publish ยังขึ้นจริง (ยิงเองทีหลังได้: node tools/indexnow-notify.mjs)';
      log(`indexnow: ⚠ เรียกตัวยิงไม่สำเร็จ (${r.error.message.split('\n')[0]}) — ข้าม แล้วไปต่อ`);
    } else if (r.status !== 0) {
      indexnowLine = `⚠ ยิงล้ม (exit ${r.status}) — publish ยังขึ้นจริง (ยิงเองทีหลังได้: node tools/indexnow-notify.mjs)`;
      log(`indexnow: ⚠ เรียกตัวยิงไม่สำเร็จ (exit ${r.status}) — ข้าม แล้วไปต่อ (publish ไม่ล้มตาม)`);
    } else if (/⏱ ยังไม่ตรง/.test(r.stdout)) {
      indexnowLine = '⚠ production ยังไม่ตรง — ยิงเข้าคิว IndexNow แล้ว (บอทมาเองภายหลัง)';
    } else if (/✗ indexnow:/.test(r.stderr)) {
      indexnowLine = '⚠ ยิงล้ม — publish ยังขึ้นจริง (ยิงเองทีหลังได้: node tools/indexnow-notify.mjs)';
    } else {
      const m = /HTTP (\d{3}) — ส่ง (\d+) URL/.exec(r.stdout);
      indexnowLine = m ? `✓ HTTP ${m[1]} · ${m[2]} URL` : '✓ ยิงสำเร็จ';
    }
  }

  /* 5.6 job summary — สรุปรอบ publish ให้เห็นในหน้า Actions ทุกรอบ (นอก runner = ไม่เขียน) */
  summary([
    '## Deploy portfolio — publish',
    `- monorepo: \`${monorepoSha}\``,
    `- publish commit: \`${pubSha}\`${gh ? ` ([project-sovereign](https://github.com/${gh[1]}/commit/${pubSha}))` : ' (project-sovereign/main)'}`,
    `- ไฟล์ที่ sync: ${changed.length}`,
    `- IndexNow: ${indexnowLine}`,
  ]);

  /* 6. watch CI ถ้าสั่ง --watch */
  if (WATCH) {
    const full = git(DEST, 'rev-parse', 'HEAD');
    process.stdout.write('waiting for CI');
    for (let i = 0; i < 40; i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
      process.stdout.write('.');
      let json = '';
      try { json = execFileSync('gh', ['run', 'list', '--commit', full, '--json', 'status,conclusion', '--limit', '1']).toString(); } catch { continue; }
      const run = JSON.parse(json)[0];
      if (run && run.status === 'completed') {
        log(`\nCI ${run.conclusion === 'success' ? '✓ success' : '✗ ' + run.conclusion}`);
        if (run.conclusion === 'success' && !SKIP_INDEXNOW) {
          try { execFileSync('node', [NOTIFIER, `--expect-sha=${pubSha}`, ...verifyArgs], { stdio: 'inherit' }); }
          catch (e) { log(`indexnow: ⚠ เรียกตัวยิงไม่สำเร็จ (${e.status ?? String(e.message || e).split('\n')[0]}) — ข้าม แล้วไปต่อ`); }
        }
        process.exit(run.conclusion === 'success' ? 0 : 1);
      }
    }
    log('\n⏱ CI ยังไม่จบใน 10 นาที — เช็คเองที่ Actions');
    process.exit(2);
  }
}
log(CHECK ? '✓ check จบ — รันจริงโดยตัด --check' : '✓ publish จบ');
