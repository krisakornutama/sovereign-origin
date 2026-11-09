#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// uninstall.mjs — ถอน Sovereign OS ออกจากเครื่องลูกอย่างสะอาด
//
// ทำไมต้องมี: ตัวติดตั้งทำ 4 อย่างที่ไม่มีใครจำได้ครบ (task, containers, volumes,
// ไฟล์ env) — ถอนไม่ครบจะเหลือ container ค้าง port และข้อมูลลูกค้าค้างใน volume
// ซึ่งเป็นทั้งปัญหาซัพพอร์ตและปัญหากฎหมาย (ข้อมูลส่วนบุคคลต้องลบได้จริง)
//
// หลักการ: "แสดงแผนก่อน แล้วค่อยทำ" — ค่าเริ่มต้นเป็น dry-run
//   node tools/install/uninstall.mjs                 → พิมพ์แผน (ไม่แตะอะไร)
//   node tools/install/uninstall.mjs --yes           → ทำจริง (เก็บข้อมูล/volume ไว้)
//   node tools/install/uninstall.mjs --yes --purge-data  → ลบ volume + backup ด้วย
//   node tools/install/uninstall.mjs --yes --purge-images → ลบ image ที่ดึงมา
//
// ไม่ลบไฟล์ซอร์สของ repo เว้นแต่ส่ง --remove-files (อันตราย: ใช้เฉพาะชุดที่แจก)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TASK_NAME = 'Sovereign Agent Runner';
const COMPOSE_FILE = join(ROOT, 'deploy', 'community', 'docker-compose.yml');

/** ไฟล์ env ที่ compose ใช้ interpolate — ต้องส่งให้ `docker compose` เอง ไม่งั้นตัวแปร ${...} ว่าง
 *  และ `compose down` จะล้มก่อนได้หยุด container (เจอจริง: สแตก community รันด้วย .env.test) */
export const COMPOSE_ENV_CANDIDATES = [
  join(ROOT, 'deploy', 'community', '.env'),
  join(ROOT, 'deploy', 'community', '.env.test'),
  join(ROOT, '.env'),
  join(ROOT, 'sovereign-os', 'infra', '.env'),
];

/** เลือกไฟล์ env ตัวแรกที่มีอยู่ (บริสุทธิ์ — ฉีด exists เพื่อเทส) */
export function resolveComposeEnvFile({ candidates = COMPOSE_ENV_CANDIDATES, exists = existsSync } = {}) {
  return candidates.find((file) => exists(file)) || null;
}

/**
 * ความล้มเหลวของ `compose down` ที่ “ถอนซ้ำได้” (ไม่มีอะไรให้ถอนแล้ว) — ส่วน error อื่น
 * เช่น interpolate env ไม่ครบ = หยุดไม่ได้จริง ต้องรายงานเป็นความล้มเหลว ไม่ใช่กลืนหาย
 */
const TOLERATED_COMPOSE_FAILURES = [/no such (project|object|service|container)/i, /nothing to (remove|stop)/i, /no resource found/i];

export function classifyComposeFailure(output) {
  return TOLERATED_COMPOSE_FAILURES.some((re) => re.test(String(output ?? '')));
}

/** อาร์กิวเมนต์ compose down — แยกออกมาเพื่อเทสลำดับ/การส่ง --env-file */
export function buildComposeDownArgs({ composeFile = COMPOSE_FILE, envFile = null, purgeData = false } = {}) {
  return [
    'compose',
    ...(envFile ? ['--env-file', envFile] : []),
    '-f',
    composeFile,
    'down',
    ...(purgeData ? ['-v', '--remove-orphans'] : []),
  ];
}

/**
 * สร้างแผนถอน (บริสุทธิ์ — ไม่แตะดิสก์/โปรเซส) เพื่อให้เทสได้โดยไม่ต้องมี Docker
 * แต่ละขั้นมี `command`/`args` ว่างได้ = ไม่มีคำสั่ง (เช่น ข้ามเพราะไม่มีไฟล์)
 */
export function buildUninstallPlan(options = {}) {
  const {
    platform = process.platform,
    hasCompose = existsSync(COMPOSE_FILE),
    purgeData = false,
    purgeImages = false,
    removeFiles = false,
    taskName = TASK_NAME,
    composeEnvFile = resolveComposeEnvFile(),
  } = options;

  const steps = [];
  const add = (step) => steps.push({ status: 'pending', ...step });

  // 1) หยุด scheduler ที่ติดตั้งไว้ (Windows) — ต้องหยุดก่อนลบโฟลเดอร์
  if (platform === 'win32') {
    add({
      id: 'stop-task',
      label: `หยุด + ลบ scheduled task "${taskName}"`,
      command: 'schtasks',
      args: ['/Delete', '/TN', taskName, '/F'],
      // task ไม่มีอยู่ = ถือว่าสำเร็จ (ถอนซ้ำได้)
      tolerateFailure: true,
    });
  }

  // 2) หยุด container + network (ไม่ลบ volume ถ้าไม่สั่ง purge-data)
  if (hasCompose) {
    add({
      id: 'compose-down',
      label: purgeData ? 'หยุด container + ลบ volume/ข้อมูล' : 'หยุด container (เก็บ volume ข้อมูลไว้)',
      command: 'docker',
      args: buildComposeDownArgs({ envFile: composeEnvFile, purgeData }),
      // ไม่ใช้ tolerateFailure: ต้องแยก "ไม่มีอะไรให้ถอน" ออกจาก "หยุดไม่ได้จริง"
      classifyFailure: classifyComposeFailure,
      nextAction: 'ตรวจว่า deploy/community/.env มี POSTGRES_PASSWORD/JWT_SECRET/EMQX_PASSWORD ครบ',
    });
  } else {
    add({
      id: 'compose-down',
      label: 'ไม่พบ docker-compose.yml — ข้ามการหยุด container',
      command: '',
      args: [],
      skip: true,
    });
  }

  // 3) ลบ image ที่ชุดนี้ดึงมา (ไม่บังคับ — เปลืองพื้นที่หลาย GB)
  if (purgeImages) {
    for (const image of ['ghcr.io/project-sovereign/sovereign-os-api:1.2.0', 'ghcr.io/project-sovereign/sovereign-os-web:1.2.0']) {
      add({
        id: `rmi:${image}`,
        label: `ลบ image ${image}`,
        command: 'docker',
        args: ['rmi', image],
        tolerateFailure: true,
      });
    }
  }

  // 4) ลบโฟลเดอร์ backup (เฉพาะเมื่อ purge-data — เป็นข้อมูลส่วนบุคคล)
  if (purgeData) {
    add({
      id: 'purge-backups',
      label: 'ลบโฟลเดอร์ backup ของฐานข้อมูล',
      command: platform === 'win32' ? 'cmd' : 'rm',
      args: platform === 'win32' ? ['/c', 'rmdir', '/s', '/q', join(ROOT, 'backups')] : ['-rf', join(ROOT, 'backups')],
      tolerateFailure: true,
    });
  }

  // 5) ลบไฟล์ชุดติดตั้ง (อันตราย — ต้องสั่งชัดเจน)
  if (removeFiles) {
    add({
      id: 'remove-files',
      label: `ลบโฟลเดอร์ติดตั้ง ${ROOT}`,
      command: '',
      args: [],
      manual: platform === 'win32'
        ? `ปิดหน้าต่างนี้ก่อน แล้วรัน: rmdir /s /q "${ROOT}"`
        : `ปิดเชลล์นี้ก่อน แล้วรัน: rm -rf "${ROOT}"`,
    });
  }

  // 6) สิ่งที่ *ไม่* ถอน — ต้องบอกผู้ใช้ก่อนจบ ไม่งั้นเขาคิดว่าข้อมูลหายไปแล้ว
  //    (หรือแย่กว่า: คิดว่าถูกลบแล้วทั้งที่ยังอยู่ = ผิด PDPA)
  const kept = [
    ...(hasCompose && !purgeData ? ['ข้อมูลฐานข้อมูลใน Docker volume (ไม่ลบ — ใช้ --purge-data ถ้าต้องการลบถาวร)'] : []),
    ...(!purgeData ? ['โฟลเดอร์ backups/ ของฐานข้อมูล (ใช้ --purge-data เพื่อลบ)'] : []),
    ...(!purgeImages ? ['Docker image ที่ชุดนี้ดึงมา (ใช้ --purge-images เพื่อลบ)'] : []),
    ...(!removeFiles ? [`โฟลเดอร์ชุดติดตั้ง/ซอร์ส ${ROOT} (ใช้ --remove-files เพื่อลบ — อันตราย)`] : []),
    'ไฟล์ .env (infra/.env, core-api/.env) — เก็บไว้เพื่อติดตั้งซ้ำ/ตรวจสอบ; ลบเองเมื่อไม่ใช้แล้ว',
  ];

  return {
    root: ROOT,
    purgeData: Boolean(purgeData),
    purgeImages: Boolean(purgeImages),
    removeFiles: Boolean(removeFiles),
    steps,
    kept,
    warnings: [
      ...(purgeData ? ['--purge-data จะลบ volume ฐานข้อมูลถาวร กู้คืนไม่ได้'] : []),
      ...(removeFiles ? ['--remove-files จะลบซอร์ส/ชุดติดตั้งในโฟลเดอร์นี้'] : []),
    ],
  };
}

function runStep(step) {
  if (step.skip) {
    console.log(`  - ${step.label}`);
    return true;
  }
  if (step.manual) {
    console.log(`  ! ${step.label}\n    → ${step.manual}`);
    return true;
  }
  // ขั้นที่ต้องแยกชนิดความล้มเหลว: เก็บ output ไว้ตรวจก่อนตัดสิน
  if (step.classifyFailure) {
    const res = spawnSync(step.command, step.args, { encoding: 'utf8', shell: false });
    const output = `${res.stdout || ''}${res.stderr || ''}`;
    if (res.status === 0) {
      console.log(`  ✓ ${step.label}`);
      return true;
    }
    if (step.classifyFailure(output)) {
      console.log(`  ~ ${step.label} (ไม่มีอะไรให้ถอนแล้ว)`);
      return true;
    }
    console.error(`  ✗ ${step.label} (exit ${res.status ?? 'unknown'})`);
    for (const line of output.trim().split(/\r?\n/).slice(0, 3)) console.error(`    ${line}`);
    return false;
  }

  const res = spawnSync(step.command, step.args, { stdio: 'inherit', shell: false });
  if (res.status === 0) {
    console.log(`  ✓ ${step.label}`);
    return true;
  }
  if (step.tolerateFailure) {
    console.log(`  ~ ${step.label} (ไม่มีอยู่/ข้ามได้)`);
    return true;
  }
  console.error(`  ✗ ${step.label} (exit ${res.status ?? 'unknown'})`);
  return false;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/install/uninstall.mjs');
if (isMain) {
  const yes = process.argv.includes('--yes') || process.argv.includes('-y');
  const plan = buildUninstallPlan({
    purgeData: process.argv.includes('--purge-data'),
    purgeImages: process.argv.includes('--purge-images'),
    removeFiles: process.argv.includes('--remove-files'),
  });

  console.log('══════════════════════════════════════════════════');
  console.log('  ถอน Sovereign OS —', plan.root);
  console.log('══════════════════════════════════════════════════');
  for (const step of plan.steps) console.log(`  • ${step.label}`);
  for (const warning of plan.warnings) console.log(`  ⚠ ${warning}`);
  console.log('\n  สิ่งที่จะไม่ถอน (ยังอยู่บนเครื่อง):');
  for (const item of plan.kept) console.log(`  · ${item}`);

  if (!yes) {
    console.log('\nยังไม่ทำอะไร — นี่เป็น dry-run');
    console.log('ทำจริง: เพิ่ม --yes (เก็บข้อมูล) หรือ --yes --purge-data (ลบข้อมูลทั้งหมด)');
    process.exit(0);
  }

  console.log('\nกำลังถอน…');
  let ok = true;
  for (const step of plan.steps) ok = runStep(step) && ok;
  // พิมพ์ซ้ำหลังทำจริง — ผู้ใช้ปิด transcript ไว้หรือเลื่อนผ่านตอนต้นก็ยังเห็น
  console.log('\n  ไม่ได้ถอน (ข้อมูลของคุณยังอยู่):');
  for (const item of plan.kept) console.log(`  · ${item}`);
  console.log(ok ? '\n✅ ถอนเสร็จ' : '\n⚠ ถอนไม่เสร็จ — มีขั้นที่หยุดไม่ได้ (ดูข้อความด้านบน) แล้วรันซ้ำ');
  process.exit(ok ? 0 : 1);
}
