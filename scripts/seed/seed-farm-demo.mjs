#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed-farm-demo.mjs — ใส่ข้อมูลตัวอย่างฟาร์มลงฐานข้อมูล dev เพื่อดูหน้า
// /farm-executive ได้ทันทีโดยไม่ต้องใช้ fixture
//
// ใช้:
//   node scripts/seed/seed-farm-demo.mjs --dry-run     # พิมพ์ SQL เฉย ๆ
//   node scripts/seed/seed-farm-demo.mjs               # รันใน container db ที่ API ใช้จริงอัตโนมัติ
//   node scripts/seed/seed-farm-demo.mjs --container=sovereign-db-1
//
// ความปลอดภัย:
//   · SQL เป็น transaction เดียว + ลบเฉพาะ id ของชุด DEMO (ไม่แตะข้อมูลจริง)
//   · ไม่พิมพ์รหัสผ่าน: ใช้ POSTGRES_USER/POSTGRES_DB ที่มีอยู่ใน container
//   · ต้องมี Docker และ container db รันอยู่ (dev/staging)
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SQL_PATH = fileURLToPath(new URL('./seed-farm-demo.sql', import.meta.url));
const sql = readFileSync(SQL_PATH, 'utf8');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const containerArg = argv.find((a) => a.startsWith('--container='))?.slice('--container='.length);

function findDbContainer() {
  if (containerArg) return containerArg;
  try {
    const candidates = execFileSync(
      'docker',
      [
        'ps',
        '--filter', 'label=com.docker.compose.service',
        '--format', '{{.Names}}\t{{.Label "com.docker.compose.service"}}',
      ],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, service] = line.split('\t');
        return { name, service: service || '' };
      })
      .filter((c) => /^(db|timescaledb|postgres)$/i.test(c.service));
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].name;
    // มีหลาย container (เช่นตัวเก่าค้างจาก compose คนละโปรเจกต์) — เลือกตัวที่ฐานข้อมูล
    // มีผู้ใช้จริงมากที่สุด เพราะนั่นคือ DB ที่ API ต่ออยู่ ไม่ใช่ตัวที่ว่างเปล่า
    const scored = candidates
      .map(({ name }) => {
        const q = spawnSync(
          'docker',
          ['exec', name, 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from users" 2>/dev/null'],
          { encoding: 'utf8' }
        );
        return { name, users: Number((q.stdout || '').trim()) || 0 };
      })
      .sort((a, b) => b.users - a.users);
    console.log(
      '[seed-farm] พบหลาย DB container:',
      scored.map((s) => `${s.name}(${s.users} users)`).join(', ')
    );
    return scored[0].name;
  } catch {
    return null;
  }
}

if (dryRun) {
  console.log(sql);
  process.exit(0);
}

const container = findDbContainer();
if (!container) {
  console.error('[seed-farm] ไม่พบ container ฐานข้อมูล — เปิด stack ก่อน หรือระบุ --container=<name>');
  process.exit(1);
}

console.log(`[seed-farm] ใส่ข้อมูลตัวอย่างลง ${container} …`);
const res = spawnSync(
  'docker',
  ['exec', '-i', container, 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q -f -'],
  { input: sql, encoding: 'utf8' }
);

if (res.status !== 0) {
  console.error('[seed-farm] ล้มเหลว:', (res.stderr || res.stdout || '').trim().slice(0, 800));
  process.exit(res.status ?? 1);
}

// ตรวจผลเบา ๆ: นับแถวชุด DEMO แล้วบอกจำนวน
const check = spawnSync(
  'docker',
  [
    'exec', container, 'sh', '-c',
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc ' +
      '"select (select count(*) from farm_plots where name like \'DEMO %\') || \' plots, \' || ' +
      '(select count(*) from livestock_groups where code like \'DEMO-%\') || \' groups\'"',
  ],
  { encoding: 'utf8' }
);
console.log('[seed-farm] สำเร็จ:', (check.stdout || '').trim() || '(ตรวจจำนวนไม่สำเร็จ แต่ SQL ผ่าน)');
console.log('[seed-farm] เปิด /farm-executive เพื่อดูผล (ต้อง rebuild API ให้มี route ใหม่ถ้ายัง 404)');
