#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/license/issue.ts — CLI ของเจ้าของ: ออก/ตรวจไลเซนส์ออฟไลน์
//
// ใช้ (แนะนำ через shim ที่ไม่ต้องมี tsx global):
//   node tools/license/issue.mjs issue --key <private.pem> --licensee "ชื่อร้าน" \
//        --tier business --features /business,/inventory --machines <machine-id> --days 365
//   node tools/license/issue.mjs verify --token <token> --public-key <public.pem> --machine <machine-id>
//   node tools/license/issue.mjs machine-id --raw "my-laptop"
//
// หลักการ: private key อยู่เฉพาะเครื่องเจ้าของ (ไฟล์นอก repo) — CLI ไม่พิมพ์ key ออกมาเลย
// token ออกทาง stdout อย่างเดียว, ข้อความมนุษย์ออกทาง stderr
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, randomBytes, sign as edSign } from 'node:crypto';
import { arch, cpus, hostname, platform } from 'node:os';

import {
  LICENSE_TIERS,
  LICENSE_VERSION,
  encodeLicenseToken,
  hashMachineId,
  verifyLicenseToken,
  type LicensePayload,
  type LicenseTier,
} from '../../sovereign-os/core-api/src/services/license.service';

interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return { command, flags };
}

function fail(message: string): never {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((v) => v.trim()).filter(Boolean))];
}

function usage(): void {
  process.stdout.write(
    [
      'Sovereign OS — offline license tool',
      '',
      '  issue --key <private.pem> --licensee <name> [--tier home|business|pro]',
      '        [--features a,b] [--machines <machineId,...>] [--days N | --perpetual]',
      '        [--id lic_xxx] [--out file] [--print-public-key] [--now ISO]',
      '  verify --token <token|@file> (--public-key <public.pem> | env LICENSE_PUBLIC_KEY_PATH)',
      '        [--machine <machineId>] [--now ISO]',
      '  machine-id [--raw <string>]   # ไม่ระบุ --raw = ใช้ hostname|platform|arch|cpu',
      '',
      'exit: 0 = ถูกต้อง · 1 = ไม่ผ่าน/ใช้ผิด',
      '',
    ].join('\n')
  );
}

function readKeyPem(flags: Record<string, string>): string {
  const keyPath = flags.key ?? process.env.LICENSE_PRIVATE_KEY_PATH;
  if (!keyPath) fail('ต้องระบุ --key <private.pem> (หรือตั้ง LICENSE_PRIVATE_KEY_PATH)');
  try {
    return readFileSync(keyPath, 'utf8');
  } catch {
    return fail(`อ่านไฟล์คีย์ไม่ได้: ${keyPath}`);
  }
}

function issue(flags: Record<string, string>): void {
  const privatePem = readKeyPem(flags);
  let privateKey;
  try {
    privateKey = createPrivateKey(privatePem);
  } catch {
    fail('ไฟล์คีย์ไม่ใช่ private key ที่อ่านได้ (ต้องเป็น PEM ของ Ed25519)');
  }

  const licensee = (flags.licensee ?? '').trim();
  if (!licensee) fail('ต้องระบุ --licensee "<ชื่อผู้ซื้อ/ร้าน>"');

  const tier = (flags.tier ?? 'home') as LicenseTier;
  if (!LICENSE_TIERS.includes(tier)) fail(`tier ต้องเป็นหนึ่งใน: ${LICENSE_TIERS.join(', ')}`);

  const nowIso = flags.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(nowIso))) fail('--now ต้องเป็น ISO timestamp');

  const perpetual = flags.perpetual === 'true' || flags.days === '0';
  const days = perpetual ? null : Number(flags.days ?? '365');
  if (days !== null && (!Number.isInteger(days) || days <= 0)) {
    fail('--days ต้องเป็นจำนวนเต็มบวก (หรือใช้ --perpetual)');
  }

  const machines = csv(flags.machines);
  const payload: LicensePayload = {
    v: LICENSE_VERSION,
    id: flags.id ?? `lic_${randomBytes(4).toString('hex')}`,
    licensee,
    tier,
    features: csv(flags.features),
    issuedAt: nowIso,
    expiresAt: days === null ? null : new Date(Date.parse(nowIso) + days * 86_400_000).toISOString(),
    maxMachines: machines.length,
    machineHashes: machines.map(hashMachineId),
  };

  const token = encodeLicenseToken(payload, (data) => edSign(null, data, privateKey));
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();

  if (flags['print-public-key'] === 'true') {
    process.stdout.write(publicPem);
    return;
  }

  const outPath = flags.out;
  if (outPath) {
    writeFileSync(outPath, `${token}\n`, 'utf8');
  } else {
    process.stdout.write(`${token}\n`);
  }

  process.stderr.write(
    `✓ ออกไลเซนส์ ${payload.id} · tier=${payload.tier} · features=${payload.features.length} · ` +
      `machines=${payload.maxMachines} · expires=${payload.expiresAt ?? 'perpetual'}\n`
  );
}

function verify(flags: Record<string, string>): void {
  let token = flags.token;
  if (token?.startsWith('@')) token = readFileSync(token.slice(1), 'utf8');
  if (!token) fail('ต้องระบุ --token <token|@file>');

  const publicPath = flags['public-key'] ?? process.env.LICENSE_PUBLIC_KEY_PATH;
  if (!publicPath) fail('ต้องระบุ --public-key <public.pem> (หรือตั้ง LICENSE_PUBLIC_KEY_PATH)');

  let publicPem: string;
  try {
    publicPem = readFileSync(publicPath, 'utf8');
  } catch {
    fail(`อ่านไฟล์ public key ไม่ได้: ${publicPath}`);
  }

  const nowIso = flags.now;
  const status = verifyLicenseToken(token, {
    publicKey: publicPem,
    machineId: flags.machine ?? null,
    now: nowIso ? new Date(nowIso) : new Date(),
  });

  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exitCode = status.valid ? 0 : 1;
}

function machineId(flags: Record<string, string>): void {
  const raw =
    flags.raw ??
    [hostname(), platform(), arch(), cpus()[0]?.model ?? 'unknown'].join('|');
  process.stdout.write(`${hashMachineId(raw)}\n`);
}

function main(): void {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'issue':
      issue(flags);
      break;
    case 'verify':
      verify(flags);
      break;
    case 'machine-id':
      machineId(flags);
      break;
    default:
      usage();
      process.exitCode = command === 'help' ? 0 : 2;
  }
}

main();
