#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/license/sell.mjs — ปิดการขายหนึ่งครั้งด้วยคำสั่งเดียว
//
// ที่มา: `issue` ออกไลเซนส์ได้แล้ว แต่หลังขายจริงเจ้าของยังต้อง (ก) ออกใบ (ข) ตรวจซ้ำ
// (ค) พิมพ์ข้อความส่งลูกค้าเอง (ง) จดว่าขายอะไรให้ใคร เท่าไร — สี่ขั้นนี้ทำมือทุกออเดอร์
// และขั้น (ข) มักถูกข้ามตอนรีบ ⇒ ใบที่ลายเซ็นพังหลุดถึงลูกค้าได้
//
// หลักการ:
//   • ตรวจก่อนส่งเสมอ (fail-closed): verify ไม่ผ่าน = ไม่มีไฟล์ให้ส่ง ไม่มีแถวใน ledger
//   • ไม่พิมพ์ token หรือ private key ออกจอ — token อยู่ในไฟล์ของออเดอร์เท่านั้น
//   • ledger เป็น JSONL ต่อท้ายอย่างเดียว (มี `paid` ให้รู้ว่าเงินเข้าแล้วหรือยัง)
//
// ใช้:
//   node tools/license/sell.mjs --key license-priv.pem --public-key license-pub.pem \
//     --licensee "ร้านตัวอย่าง" --tier business --machines <machine-id> --days 365 \
//     --amount 4900 --sku SW-BUSINESS --paid
// ─────────────────────────────────────────────────────────────────────────────

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISSUE = path.join(ROOT, 'tools', 'license', 'issue.mjs');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    [
      'Sovereign OS — ปิดการขายหนึ่งครั้ง (ออก + ตรวจ + ชุดส่งลูกค้า + ledger)',
      '',
      '  --key <private.pem>         (หรือ LICENSE_PRIVATE_KEY_PATH)',
      '  --public-key <public.pem>   (หรือ LICENSE_PUBLIC_KEY_PATH)',
      '  --licensee "<ชื่อผู้ซื้อ>"',
      '  --amount <บาท>              ราคาที่ตกลง (ต้องระบุ — ไม่มีค่าปริยาย)',
      '  [--tier home|business|pro]  ปริยาย home',
      '  [--features a,b] [--machines <id,...>] [--days N | --perpetual]',
      '  [--sku SW-BUSINESS] [--order ORD-...] [--outdir sales/<order>]',
      '  [--ledger sales/ledger.jsonl] [--paid] [--now ISO]',
      '',
      'exit: 0 = ออกและตรวจผ่าน · 1 = ไม่ผ่าน (ไม่มีไฟล์ส่ง ไม่มีแถว ledger)',
      '',
    ].join('\n')
  );
}

function runIssue(args) {
  return spawnSync(process.execPath, [ISSUE, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function thb(amount) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(amount);
}

const flags = parseArgs(process.argv.slice(2));
if (flags.help === 'true' || Object.keys(flags).length === 0) {
  usage();
  process.exit(0);
}

const privateKeyPath = flags.key ?? process.env.LICENSE_PRIVATE_KEY_PATH;
const publicKeyPath = flags['public-key'] ?? process.env.LICENSE_PUBLIC_KEY_PATH;
if (!privateKeyPath) fail('ต้องระบุ --key <private.pem> (หรือตั้ง LICENSE_PRIVATE_KEY_PATH)');
if (!publicKeyPath) fail('ต้องระบุ --public-key <public.pem> (หรือตั้ง LICENSE_PUBLIC_KEY_PATH)');

const licensee = (flags.licensee ?? '').trim();
if (!licensee) fail('ต้องระบุ --licensee "<ชื่อผู้ซื้อ/ร้าน>"');

const amount = Number(flags.amount);
if (!Number.isFinite(amount) || amount <= 0) {
  fail('ต้องระบุ --amount <บาท> เป็นตัวเลขมากกว่า 0 (ราคาที่ตกลงกับผู้ซื้อ)');
}

const tier = flags.tier ?? 'home';
const machines = (flags.machines ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const order = flags.order ?? `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;

if (!/^[A-Za-z0-9._-]+$/.test(order)) fail('--order ใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (ใช้เป็นชื่อโฟลเดอร์)');

const outdir = path.resolve(ROOT, flags.outdir ?? path.join('sales', order));
const ledgerPath = path.resolve(ROOT, flags.ledger ?? path.join('sales', 'ledger.jsonl'));
const tokenPath = path.join(outdir, 'license.txt');

mkdirSync(outdir, { recursive: true });

const issueArgs = [
  'issue',
  '--key',
  privateKeyPath,
  '--licensee',
  licensee,
  '--tier',
  tier,
  '--out',
  tokenPath,
];
if (flags.features) issueArgs.push('--features', flags.features);
if (machines.length > 0) issueArgs.push('--machines', machines.join(','));
if (flags.perpetual === 'true') issueArgs.push('--perpetual');
else issueArgs.push('--days', flags.days ?? '365');
if (flags.id) issueArgs.push('--id', flags.id);
if (flags.now) issueArgs.push('--now', flags.now);

const issued = runIssue(issueArgs);
if (issued.status !== 0) {
  if (existsSync(tokenPath)) rmSync(tokenPath);
  fail(`ออกไลเซนส์ไม่สำเร็จ:\n${issued.stderr || issued.stdout || ''}`.trim());
}
if (!existsSync(tokenPath)) fail('ออกไลเซนส์แล้วแต่ไม่พบไฟล์ token — ยกเลิกการขายครั้งนี้');

// ── ด่านสำคัญ: ตรวจซ้ำด้วย public key (+ เครื่องแรก) ก่อนส่งถึงลูกค้า ──
const verifyArgs = ['verify', '--token', `@${tokenPath}`, '--public-key', publicKeyPath];
if (machines.length > 0) verifyArgs.push('--machine', machines[0]);
const verified = runIssue(verifyArgs);
if (verified.status !== 0) {
  rmSync(tokenPath);
  fail(`ตรวจใบที่เพิ่งออกไม่ผ่าน ⇒ ไม่ส่งให้ลูกค้า (fail-closed):\n${verified.stdout || verified.stderr || ''}`.trim());
}

const status = JSON.parse(verified.stdout);
const licenseId = status.payload?.id ?? null;
const expiresAt = status.payload?.expiresAt ?? null;

const publicPem = readFileSync(publicKeyPath, 'utf8').trim();
const deliveryPath = path.join(outdir, 'delivery.md');
writeFileSync(
  deliveryPath,
  [
    `# ใบส่งมอบไลเซนส์ Sovereign OS — ${order}`,
    '',
    `- ผู้รับสิทธิ์: **${licensee}**`,
    `- tier: \`${tier}\``,
    `- ไลเซนส์: \`${licenseId}\``,
    `- หมดอายุ: ${expiresAt ?? 'ซื้อขาด (ไม่มีวันหมดอายุ)'}`,
    `- จำนวนเครื่อง: ${machines.length === 0 ? 'ไม่ผูกเครื่อง' : machines.length}`,
    `- ยอดที่ตกลง: **${thb(amount)} บาท**`,
    '',
    '## สิ่งที่ได้รับ',
    '',
    '- `license.txt` — ไฟล์ไลเซนส์ (ข้อความยาวบรรทัดเดียว)',
    '- public key ด้านล่าง — ใช้ตรวจใบนี้บนเครื่องของคุณ',
    '',
    '```',
    publicPem,
    '```',
    '',
    '## วิธีติดตั้ง',
    '',
    '1. เปิดไฟล์ `.env` ของ Sovereign OS บนเครื่องคุณ',
    '2. วางค่า (เครื่องของคุณตรวจเองแบบออฟไลน์ ไม่ต้องต่อเน็ต):',
    '',
    '```',
    'SOVEREIGN_LICENSE=<เนื้อหาใน license.txt>',
    'SOVEREIGN_LICENSE_PUBLIC_KEY="<public key ด้านบน แทนบรรทัดใหม่ด้วย \\n>"',
    '```',
    '',
    '3. รีสตาร์ท แล้วเปิดหน้า `/system` — การ์ดไลเซนส์ต้องขึ้น tier และจำนวนวันที่เหลือ',
    '',
    '## เงื่อนไข',
    '',
    `- ใบนี้${machines.length === 0 ? 'ไม่ผูกกับเครื่องใดเครื่องหนึ่ง' : 'ผูกกับเครื่องที่ให้ machine id มาเท่านั้น'} — ถ้าเปลี่ยนเครื่อง แจ้งเพื่อออกใบใหม่`,
    '- ห้ามส่งต่อ/เผยแพร่ไฟล์นี้ ผู้อื่นใช้ไม่ได้แต่จะทำให้ตรวจสอบย้อนหลังลำบาก',
    '- ไลเซนส์ไม่ผ่าน (หมดอายุ/ผิดเครื่อง) ระบบจะไม่ล็อกข้อมูลของคุณ — จะกลับไปโหมด CE',
    '',
    '## หลักฐานการขาย',
    '',
    `- ออเดอร์: \`${order}\``,
    `- SKU: \`${flags.sku ?? '-'}\``,
    `- ตรวจใบแล้วด้วย public key: ผ่าน (${new Date().toISOString()})`,
    '',
  ].join('\n'),
  'utf8'
);

const paid = flags.paid === 'true';
const row = {
  order,
  at: new Date().toISOString(),
  licensee,
  sku: flags.sku ?? null,
  tier,
  days: flags.perpetual === 'true' ? null : Number(flags.days ?? '365'),
  machines: machines.length,
  amountThb: amount,
  paid,
  licenseId,
  outdir: path.relative(ROOT, outdir).split(path.sep).join('/'),
};
mkdirSync(path.dirname(ledgerPath), { recursive: true });
const fd = openSync(ledgerPath, 'a');
try {
  writeFileSync(fd, `${JSON.stringify(row)}\n`, 'utf8');
} finally {
  closeSync(fd);
}

process.stdout.write(
  [
    `✓ ปิดการขาย ${order}`,
    `  ไลเซนส์: ${licenseId} · tier=${tier} · เครื่อง=${machines.length || 'ไม่ผูก'} · หมดอายุ=${expiresAt ?? 'ซื้อขาด'}`,
    `  ยอด: ${thb(amount)} บาท${paid ? ' (รับเงินแล้ว)' : ' (ยังไม่บันทึกรับเงิน — เติม --paid เมื่อเงินเข้า)'}`,
    `  ชุดส่งลูกค้า: ${path.join(path.relative(ROOT, outdir), 'delivery.md')}`,
    `  ledger: ${path.relative(ROOT, ledgerPath)}`,
    '',
  ].join('\n')
);
