#!/usr/bin/env node
/**
 * migrate-deploy.ts — `prisma migrate deploy` + baseline อัตโนมัติเมื่อเจอ P3005
 *
 * ใช้แทน `npx prisma migrate deploy` ตรง ๆ ใน container ของชุดติดตั้ง:
 *   - ฐานข้อมูลใหม่ (ว่าง) → deploy ปกติ
 *   - ฐานข้อมูลเดิมที่ไม่มี _prisma_migrations (schema ไม่ว่าง) → ตรวจ drift ก่อน
 *     ถ้า schema ตรง datamodel ⇒ resolve ทุก migration เป็น applied แล้ว deploy ซ้ำ
 *     ถ้าไม่ตรง ⇒ exit 1 พร้อมบอกให้คนตรวจ (ไม่เดาแทนลูกค้า)
 *
 * รันด้วย: node dist/scripts/migrate-deploy.js
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { decideMigrateAction, listMigrationNames, npxSpawnOptions } from '../lib/migrate-baseline';

const PRISMA_DIR = path.resolve(process.cwd(), 'prisma');
const MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');

function prisma(args: string[]): { ok: boolean; output: string } {
  const res = spawnSync('npx', ['prisma', ...args], { encoding: 'utf8', ...npxSpawnOptions() });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stdout.write(output);
  return { ok: res.status === 0, output };
}

function main(): number {
  const deploy = prisma(['migrate', 'deploy']);
  if (deploy.ok) return 0;

  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`✗ ไม่พบโฟลเดอร์ migration: ${MIGRATIONS_DIR}`);
    return 1;
  }

  // ตรวจว่า schema ใน DB ตรงกับ datamodel ปัจจุบันไหม — คืน 0 = ตรง
  const drift = prisma([
    'migrate',
    'diff',
    '--from-url',
    process.env.DATABASE_URL ?? '',
    '--to-schema-datamodel',
    path.join(PRISMA_DIR, 'schema.prisma'),
    '--exit-code',
  ]);
  const decision = decideMigrateAction({ deployOk: false, deployOutput: deploy.output, driftOk: drift.ok });

  if (decision === 'fail') {
    console.error(
      '\n✗ migrate ล้มและไม่สามารถ baseline ได้อย่างปลอดภัย\n' +
        '  baseline ทำได้เฉพาะฐานข้อมูลที่ schema ตรงกับ prisma/schema.prisma (drift ว่าง)\n' +
        '  ตรวจด้วย: npx prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code'
    );
    return 1;
  }

  const names = listMigrationNames(readdirSync(MIGRATIONS_DIR));
  if (names.length === 0) {
    console.error('✗ ไม่พบ migration ให้ baseline');
    return 1;
  }
  console.log(`\n▶ ฐานข้อมูลเดิมไม่มีประวัติ migration (P3005) — baseline ${names.length} migration`);
  for (const name of names) {
    if (!prisma(['migrate', 'resolve', '--applied', name]).ok) {
      console.error(`✗ resolve ${name} ไม่สำเร็จ`);
      return 1;
    }
  }

  const retry = prisma(['migrate', 'deploy']);
  if (!retry.ok) {
    console.error('✗ deploy ยังล้มหลัง baseline');
    return 1;
  }
  console.log('✓ baseline + deploy สำเร็จ');
  return 0;
}

process.exit(main());
