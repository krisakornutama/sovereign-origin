// src/services/startup-migration.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// migrate DB "ก่อนเสิร์ฟ" สำหรับ sidecar ที่รันในชุดติดตั้ง
//
// ปัญหาที่กัน: แอปเดสก์ท็อปส่ง DATABASE_URL = `file:<userData>/data.db` แต่ Prisma
// datasource เป็น postgresql ⇒ ทุกคิวรี DB ล้ม และ health คืน migrationHead: null
// ซึ่งอ่านเหมือน "ยังไม่มี migration" ทั้งที่จริงคือ "ต่อ DB ไม่ได้" — ไม่มีการ
// migrate อะไรเลยทั้งที่ตารางไม่มี
//
// กติกา:
//   · ไม่ทำงานเลยถ้าไม่ได้ตั้ง MIGRATE_ON_START=1/true (production ที่มี entrypoint
//     รัน migrate เองอยู่แล้วต้องไม่ถูก migrate ซ้ำโดยไม่ตั้งใจ)
//   · `file:` = SQLite → บอกตรง ๆ ว่าใช้ไม่ได้ (Prisma ตัวนี้เป็น postgresql) ไม่เดา
//   · ไม่มี DATABASE_URL → ไม่มีอะไรให้ migrate และต้องบอกเหตุผล
//   · ล้มเหลว = คืน ok:false พร้อมท่อนท้าย output ให้ log (ไม่กลืนสาเหตุ)
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DETAIL_MAX = 600;

export type StartupMigrationResult =
  | { ran: false; reason: 'disabled' | 'no-database' | 'unsupported-sqlite'; detail: string }
  | { ran: true; ok: boolean; detail: string };

function tail(text: string): string {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= DETAIL_MAX) return trimmed;
  return '…' + trimmed.slice(trimmed.length - DETAIL_MAX);
}

function isEnabled(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function defaultScriptPath(): string {
  // compiled: dist/services/… → dist/scripts/migrate-deploy.js
  // dev (tsx): src/services/… → src/scripts/migrate-deploy.ts
  const compiled = path.join(__dirname, '..', 'scripts', 'migrate-deploy.js');
  const source = path.join(__dirname, '..', 'scripts', 'migrate-deploy.ts');
  return existsSync(compiled) ? compiled : source;
}

export interface RunStartupMigrationsOptions {
  env?: NodeJS.ProcessEnv;
  run?: (cmd: string, args: string[], opts: Record<string, unknown>) => { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
  scriptPath?: string;
  scriptExists?: (file: string) => boolean;
  nodePath?: string;
}

export function runStartupMigrations(options: RunStartupMigrationsOptions = {}): StartupMigrationResult {
  const env = options.env ?? process.env;
  if (!isEnabled(env.MIGRATE_ON_START)) {
    return { ran: false, reason: 'disabled', detail: 'MIGRATE_ON_START ไม่ได้เปิด' };
  }

  const url = String(env.DATABASE_URL ?? '').trim();
  if (!url) {
    return { ran: false, reason: 'no-database', detail: 'ไม่มี DATABASE_URL — sidecar นี้ไม่มี DB' };
  }
  if (url.startsWith('file:')) {
    return {
      ran: false,
      reason: 'unsupported-sqlite',
      detail: 'DATABASE_URL ชี้ SQLite (file:) แต่ Prisma datasource เป็น postgresql — ต้องใช้ Postgres',
    };
  }

  const scriptPath = options.scriptPath ?? defaultScriptPath();
  const exists = options.scriptExists ?? existsSync;
  if (!exists(scriptPath)) {
    return { ran: true, ok: false, detail: 'ไม่พบสคริปต์ migrate-deploy: ' + scriptPath };
  }

  const run = options.run ?? spawnSync;
  const res = run(options.nodePath ?? process.execPath, [scriptPath], {
    encoding: 'utf8',
    env,
    // migrate-deploy หา prisma/ จาก process.cwd() ⇒ ต้องรันที่ราก core-api (<core-api>/dist/scripts/x.js → <core-api>)
    cwd: path.dirname(path.dirname(path.dirname(scriptPath))),
    timeout: 120_000,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status === 0) {
    return { ran: true, ok: true, detail: tail(output) || 'migrate เรียบร้อย' };
  }
  return { ran: true, ok: false, detail: tail(output) || `migrate-deploy exit ${res.status}` };
}
