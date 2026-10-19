// WAL: ค่า archive_timeout ต้องไม่กลับไป 300s (วัดจริง 19/10/69: idle สร้าง WAL ~24 GB/วัน)
//
// ทำไม 900s: archive_timeout บังคับปิด segment เมื่อไม่มีธุรกรรม — 300s = 16 MB ทุก 5 นาที
// ≈ 4.6 GB/วันแม้ระบบว่าง; 900s = ทุก 15 นาที ≈ 1.5 GB/วัน (ลด ~3 เท่า)
// ค่านี้เป็น config ของ compose (มีผลเมื่อ container ถูก recreate) — ไม่ใช่ runtime migration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPOSE = path.join(ROOT, 'sovereign-os', 'infra', 'docker-compose.yml');

test('WAL: archive_timeout = 900s (ไม่ใช่ 300s)', () => {
  const txt = fs.readFileSync(COMPOSE, 'utf8');
  assert.match(txt, /^\s*-\s*archive_timeout=900s\s*$/m, 'ต้องมี archive_timeout=900s ใน compose');
  assert.doesNotMatch(txt, /archive_timeout=300s/, 'ห้ามเหลือ 300s — จะกลับไปสร้าง WAL 24 GB/วัน');
});

test('WAL: archive_mode + archive_command + bind mount ยังอยู่', () => {
  const txt = fs.readFileSync(COMPOSE, 'utf8');
  assert.match(txt, /^\s*-\s*archive_mode=on\s*$/m);
  assert.match(txt, /^\s*-\s*archive_command=/m);
  assert.match(txt, /\.\/data\/wal-archive:\/var\/lib\/postgresql\/wal-archive/);
});
