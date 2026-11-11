#!/usr/bin/env node
// tools/release-check.mjs — ด่าน "พร้อมปล่อยแพทช์หรือยัง"
//
// ปัญหาที่กัน: workflow ปล่อยรุ่น (.github/workflows/release.yml) หยุดทันทีถ้า tag
// ไม่ตรง version ใน sovereign-frontend/package.json และถ้า CHANGELOG ไม่มีหัวข้อ
// ของรุ่นนั้น ผู้ใช้ก็ไม่รู้ว่าเปลี่ยนอะไร — ทั้งสองอย่างเสียเวลารอบ build ทั้งรอบ
// จึงตรวจให้จบในไม่กี่มิลลิวินาทีก่อน push tag
//
// ใช้: node tools/release-check.mjs [--version=1.3.1] [--json]
//   ไม่ใส่ --version = ใช้ version ใน sovereign-frontend/package.json
//   exit 0 = พร้อม, exit 1 = ยังมีจุดต้องแก้ (พิมพ์รายการให้ครบ)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

export const PACKAGE_PATHS = {
  root: 'package.json',
  api: 'sovereign-os/core-api/package.json',
  frontend: 'sovereign-frontend/package.json',
};

const DATE = /—\s*(\d{4}-\d{2}-\d{2})/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readVersions(root = ROOT) {
  const versions = {};
  for (const [key, rel] of Object.entries(PACKAGE_PATHS)) {
    const pkg = readJson(path.join(root, rel));
    versions[key] = String(pkg?.version ?? '');
  }
  return versions;
}

/** ทุก package ต้องเป็นรุ่นเดียวกัน ไม่งั้น tag จะไปตรงกับตัวใดตัวหนึ่งเท่านั้น */
export function checkVersionsAligned(versions, expectedVersion) {
  const failures = [];
  for (const [key, raw] of Object.entries(versions ?? {})) {
    const value = String(raw ?? '').trim();
    if (!value) failures.push(`${key}: ไม่พบ version`);
    else if (value !== expectedVersion) failures.push(`${key}: ${value} ≠ ${expectedVersion}`);
  }
  return { ok: failures.length === 0, failures };
}

/** ต้องมีหัวข้อของรุ่นนี้พร้อมวันที่ — ผู้ใช้ต้องหาอ่านได้ว่าเปลี่ยนอะไร */
export function checkChangelogSection(changelog, version) {
  const text = String(changelog ?? '');
  const wanted = `[v${version}]`;
  const line = text
    .split('\n')
    .find((l) => l.trimStart().startsWith('##') && l.replace(/\s+/g, ' ').includes(wanted));

  if (!line) {
    return { ok: false, failures: [`CHANGELOG: ไม่มีหัวข้อของรุ่น v${version} (ผู้ใช้จะไม่เห็นว่าเปลี่ยนอะไร)`] };
  }
  if (!DATE.test(line)) {
    return { ok: false, failures: [`CHANGELOG: หัวข้อ v${version} ยังไม่มีวันที่ (ต้องเป็น — YYYY-MM-DD)`] };
  }
  return { ok: true, failures: [] };
}

/** บล็อก [Unreleased] ต้องว่าง — ถ้ายังมีรายการ = งานยังไม่ปิด แต่จะหลุดจากรุ่นนี้ */
export function checkUnreleasedEmpty(changelog) {
  const lines = String(changelog ?? '').split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith('##') && l.includes('[Unreleased]'));
  if (start === -1) return { ok: true, failures: [] };

  const rest = lines.slice(start + 1);
  const endOffset = rest.findIndex((l) => l.trimStart().startsWith('##') && l.includes('['));
  const block = endOffset === -1 ? rest : rest.slice(0, endOffset);
  const leftover = block.filter((l) => /^\s*[-*]\s+\S/.test(l));

  if (leftover.length === 0) return { ok: true, failures: [] };
  return {
    ok: false,
    failures: [`CHANGELOG: [Unreleased] ยังมี ${leftover.length} รายการ — ย้ายไปหัวข้อของรุ่นก่อนปล่อย`],
  };
}

export function checkReleaseReadiness({ versions, changelog, expectedVersion }) {
  const version = String(expectedVersion ?? versions?.frontend ?? '').trim();
  const failures = [];
  if (!version) {
    failures.push('ไม่พบรุ่นที่จะปล่อย (--version หรือ sovereign-frontend/package.json)');
  } else {
    failures.push(...checkVersionsAligned(versions, version).failures);
    failures.push(...checkChangelogSection(changelog, version).failures);
  }
  failures.push(...checkUnreleasedEmpty(changelog).failures);
  return { ok: failures.length === 0, version, failures };
}

function main(argv) {
  const argVersion = argv.find((a) => a.startsWith('--version='))?.split('=')[1];
  const asJson = argv.includes('--json');

  const versions = readVersions();
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const result = checkReleaseReadiness({ versions, changelog, expectedVersion: argVersion || versions.frontend });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`✅ พร้อมปล่อย v${result.version} — version ตรงกันทุก package, CHANGELOG มีหัวข้อ, [Unreleased] ว่าง`);
    console.log(`   ขั้นถัดไป: git tag v${result.version} && git push origin v${result.version}`);
  } else {
    console.error(`❌ ยังไม่พร้อมปล่อย v${result.version} — ${result.failures.length} จุด`);
    for (const f of result.failures) console.error(`   - ${f}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
