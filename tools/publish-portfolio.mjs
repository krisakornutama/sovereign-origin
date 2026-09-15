#!/usr/bin/env node
/* publish-portfolio — คำสั่งเดียวจบ: sync → commit → push → (watch CI)
   ที่มา: sync มือ + commit -c identity + จับ CI เอง — พลาดง่าย (ผิด dir, ลืม identity)
   ใช้: node tools/publish-portfolio.mjs [--check] [--watch] [--message "เหตุผลสั้น ๆ"]
   --check = ดูอย่างเดียว (dry-run) · --watch = รอ CI "Audit site" จนจบ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const WATCH = args.includes('--watch');
const MSG = (args.find((a) => a.startsWith('--message=')) || '').slice('--message='.length) || 'site update';

const sha = (dir, ref = 'HEAD') => execFileSync('git', ['-C', dir, 'rev-parse', '--short', ref]).toString().trim();
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a]).toString().trim();
const log = (s) => console.log(s);
const norm = (p) => fs.readFileSync(p).toString().replace(/\r\n/g, '\n'); // EOL-noise (autocrlf) ไม่นับเป็นต่าง — ไม่งั้น commit แล้วไม่มีอะไร staged

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
const pub = findPublishRepo();
if (!pub) { console.error('✗ หา publish repo ไม่เจอ (ไม่มี portfolio/.git ทั้งใน worktree นี้และ main worktree)'); process.exit(1); }
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
const publishFiles = [];
for (const f of fs.readdirSync(path.join(ROOT, 'portfolio'), { withFileTypes: true })) {
  if (f.name === 'node_modules' || f.name === '.git') continue;
  if (f.isFile() && (/\.html$/.test(f.name) || f.name === '.nojekyll' || f.name === 'README.md' ||
      f.name === 'package.json' || f.name === 'package-lock.json' || f.name === 'sitemap.xml' || f.name === 'robots.txt')) publishFiles.push(f.name);
  if (f.isDirectory() && (f.name === 'scripts' || f.name === '.github')) walk(f.name, publishFiles);
}

/* 3. dirty guard — publish repo ต้องสะอาดก่อน sync (กันกลืนงานคนอื่น) เว้นแต่ sameDir (งานเราเองที่รอ commit) */
const dirty = git(DEST, 'status', '--porcelain').split('\n').filter(Boolean);
if (dirty.length && !CHECK && !pub.sameDir) {
  console.error('✗ publish repo มีไฟล์ค้างก่อนเริ่ม — จัดการก่อน (ไม่ยุ่งให้):');
  dirty.slice(0, 10).forEach((d) => console.error('   ' + d));
  process.exit(1);
}
if (dirty.length) log(`publish repo มี ${dirty.length} ไฟล์ค้างอยู่แล้ว${pub.sameDir ? ' (sameDir — จะรวม commit ด้วย)' : ' — cross-worktree mode'}`);

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
  if (changed.length === 0) { log('✓ publish repo ตรงกับ monorepo อยู่แล้ว — ไม่มีอะไรจะ publish'); process.exit(0); }
  git(DEST, 'add', ...changed);
  const name = git(ROOT, 'config', 'user.name');
  const email = git(ROOT, 'config', 'user.email');
  execFileSync('git', ['-C', DEST, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit',
    '-m', `portfolio: ${MSG} (mirror of ${monorepoSha})`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const pubSha = sha(DEST);
  log(`commit: ${pubSha} (${name})`);
  git(DEST, 'push', 'origin', 'main');
  log(`push: origin/main → ${pubSha}`);
  log(`CI: https://github.com/${git(DEST, 'config', 'remote.origin.url').match(/[:/]([^/]+\/[^/.]+)\.git/)[1]}/actions`);

  /* 6. watch CI ถ้าสั่ง --watch */
  if (WATCH) {
    const full = git(DEST, 'rev-parse', 'HEAD');
    process.stdout.write('waiting for CI');
    for (let i = 0; i < 40; i++) {
      execFileSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', '15', '/nobreak'] : ['15'], { stdio: 'ignore', shell: true });
      process.stdout.write('.');
      let json = '';
      try { json = execFileSync('gh', ['run', 'list', '--commit', full, '--json', 'status,conclusion', '--limit', '1']).toString(); } catch { continue; }
      const run = JSON.parse(json)[0];
      if (run && run.status === 'completed') {
        log(`\nCI ${run.conclusion === 'success' ? '✓ success' : '✗ ' + run.conclusion}`);
        process.exit(run.conclusion === 'success' ? 0 : 1);
      }
    }
    log('\n⏱ CI ยังไม่จบใน 10 นาที — เช็คเองที่ Actions');
    process.exit(2);
  }
}
log(CHECK ? '✓ check จบ — รันจริงโดยตัด --check' : '✓ publish จบ');
