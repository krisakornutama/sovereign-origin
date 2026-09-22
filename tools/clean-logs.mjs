// tools/clean-logs.mjs — กวาดไฟล์ log ที่ราก repo (dev-server.log, mock-api.log ฯลฯ)
// ใช้: node tools/clean-logs.mjs          (ลบทิ้ง — log เหล่านี้เกิดใหม่เองทุกรอบรัน)
//      node tools/clean-logs.mjs --check (แค่รายงาน ไม่ลบ)
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--check');

const found = readdirSync(ROOT).filter((f) => f.endsWith('.log'));
let bytes = 0;
for (const f of found) {
  try { bytes += statSync(join(ROOT, f)).size; } catch {}
}
if (found.length === 0) {
  console.log('[clean-logs] รากสะอาด — ไม่มี *.log');
  process.exit(0);
}
console.log(`[clean-logs] เจอ ${found.length} ไฟล์ (${(bytes / 1024).toFixed(1)} KB): ${found.join(', ')}`);
if (dry) process.exit(0);
for (const f of found) {
  try { rmSync(join(ROOT, f)); } catch (e) { console.warn(`[clean-logs] ข้าม ${f}: ${e.message}`); }
}
console.log('[clean-logs] ลบแล้ว');
