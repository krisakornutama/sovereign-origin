#!/usr/bin/env node
/* system-health — ปุ่มเดียวตรวจสุขภาพทั้งระบบ (สร้างจากรอบ 2026-09-17)
   ดู: dependabot alerts · deploy run ล่าสุดบน main · production sitemap lastmod ·
       อายุ/วันทบทวน PAGES_TOKEN · เว็บ :3000 · API :3001 · containers
   ใช้: node tools/system-health.mjs   (หรือ npm run health)
   หมายเหตุ: ใช้ gh api (ต้อง gh login ไว้แล้ว) + fetch ของ Node — ไม่มี dependency เพิ่ม */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = process.env.HEALTH_REPO || 'krisakornutama/sovereign-origin';
const PROD_SITEMAP = 'https://krisakornutama.github.io/project-sovereign/sitemap.xml';
const gh = (args) =>
  new Promise((resolve) => {
    execFile('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
const fetchText = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.text() : `HTTP ${res.status}`;
  } catch (e) {
    return `ล้มเหลว (${e.name === 'TimeoutError' ? 'หมดเวลา' : e.cause?.code || e.message})`;
  }
};
const daysLeft = (ymd) => Math.round((new Date(`${ymd}T00:00:00Z`) - Date.now()) / 86400000);

const rows = [];
const problems = [];
const add = (name, status, detail, bad = false) => {
  rows.push({ name, status, detail });
  if (bad) problems.push(`${name}: ${detail}`);
};

/* 1) dependabot alerts */
const alertsRaw = await gh([`repos/${REPO}/dependabot/alerts?state=open&per_page=100`, '--paginate', '--jq', '.[].severity']);
if (alertsRaw === null) add('Dependabot', '?', 'ถาม API ไม่ได้ (gh login?)', true);
else {
  const list = alertsRaw.split('\n').filter(Boolean);
  const worst = ['critical', 'high', 'moderate', 'low'].find((s) => list.includes(s));
  add('Dependabot alerts', list.length === 0 ? '✓ 0' : `✗ ${list.length}`, worst ? `เปิดค้าง เร่งด่วนสุด: ${worst}` : 'ไม่มี alert เปิดค้าง', list.length > 0);
}

/* 2) deploy run ล่าสุดบน main */
const runRaw = await gh([`repos/${REPO}/actions/workflows/deploy-portfolio.yml/runs?branch=main&per_page=1`, '--jq', '.workflow_runs[0] | "\\(.conclusion // .status)|\\(.run_started_at)|\\(.html_url)"']);
if (!runRaw) add('Deploy portfolio', '?', 'ไม่พบ run', true);
else {
  const [conclusion, started, url] = runRaw.trim().split('|');
  const age = Math.round((Date.now() - new Date(started)) / 60000);
  add('Deploy portfolio (main)', conclusion === 'success' ? '✓' : `✗ ${conclusion}`, `${conclusion} · ${age < 90 ? `${age} นาทีก่อน` : `${Math.round(age / 60)} ชม.ก่อน`} · ${url}`, conclusion !== 'success');
}

/* 3) production lastmod */
const sitemap = await fetchText(PROD_SITEMAP);
const lastmod = /<lastmod>([\d-]+)<\/lastmod>/.exec(sitemap)?.[1];
if (lastmod) {
  const ageDays = -daysLeft(lastmod);
  add('Production lastmod', ageDays <= 7 ? '✓' : '⚠', `${lastmod} (${ageDays} วันก่อน)`, ageDays > 30);
} else add('Production lastmod', '✗', `อ่าน sitemap ไม่ได้: ${sitemap.slice(0, 60)}`, true);

/* 4) วันทบทวน PAGES_TOKEN */
const expires = await gh([`repos/${REPO}/actions/variables/PAGES_TOKEN_EXPIRES`, '--jq', '.value']);
if (!expires) add('PAGES_TOKEN ทบทวน', '⚠', 'ไม่พบตัวแปร PAGES_TOKEN_EXPIRES (ตั้งตาม docs/token-rotation.md)', true);
else {
  const d = daysLeft(expires.trim());
  add('PAGES_TOKEN ทบทวน', d <= 14 ? '⚠' : '✓', `${expires.trim()} (อีก ${d} วัน${d <= 0 ? ' — ถึงกำหนดทบทวน/หมุน' : ''})`, d <= 14);
}

/* 5) เว็บ :3000 + API :3001 (เฉพาะเครื่องนี้) */
const probe = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return `HTTP ${res.status}`;
  } catch (e) {
    return `ล้มเหลว (${e?.cause?.code || e?.name || 'unknown'})`;
  }
};
const web = await probe('http://localhost:3000');
add('เว็บ :3000 (local)', web === 'HTTP 200' ? '✓' : '⚠', web, web !== 'HTTP 200');
const api = await probe('http://localhost:3001/healthz');
const apiOk = api === 'HTTP 200';
add('API :3001 (local)', apiOk ? '✓' : '⚠', apiOk ? 'ok:true' : api, !apiOk);

/* 6) containers (ถ้ามี docker) */
const docker = await new Promise((resolve) => {
  execFile('docker', ['ps', '--filter', 'name=sovereign', '--format', '{{.Names}}: {{.Status}}'], { encoding: 'utf8' }, (err, stdout) => resolve(err ? null : stdout.trim()));
});
add('Containers', docker ? (docker.split('\n').filter((l) => l.includes('(healthy)')).length >= 3 ? '✓' : '⚠') : '—', docker ? docker.replace(/\n/g, ' · ') : 'docker ไม่ตอบ (ข้าม)', false);

/* ตาราง */
const W = [22, 6, 60];
const line = (c) => c.map((x, i) => String(x).padEnd(W[i])).join(' ');
console.log('\n═══ Sovereign System Health ═══');
console.log(line(['ระบบ', 'สถานะ', 'รายละเอียด']));
console.log('-'.repeat(W[0] + W[1] + W[2]));
for (const r of rows) console.log(line([r.name, r.status, r.detail.slice(0, W[2])]));
console.log('-'.repeat(W[0] + W[1] + W[2]));
console.log(problems.length === 0 ? '✓ ทุกระบบปกติ' : `⚠ มี ${problems.length} ข้อควรดู:\n  - ${problems.join('\n  - ')}`);
process.exit(problems.some((p) => p.startsWith('Dependabot') || p.startsWith('Deploy')) ? 1 : 0);
