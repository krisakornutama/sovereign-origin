// tools/fingerprint-lib.mjs — อัลกอริทึม fingerprint ฝั่ง tools — ต้องตรงกับ
// sovereign-os/core-api/src/lib/runtime-fingerprint.ts ทุกไบต์ (sort เดียวกัน, รูปแบบ update เดียวกัน)
// ใช้โดย tools/prod-truth.mjs เพื่อเทียบ "โค้ดบนดิสก์" กับ "ที่ prod โหลดอยู่"
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const FINGERPRINT_ALGO = 'fp-v1-sha256';

export function computeDirFingerprintSync(dir) {
  const entries = [];
  const walk = (current) => {
    let list = [];
    try {
      list = readdirSync(current);
    } catch {
      return;
    }
    for (const name of list) {
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        try {
          entries.push({ rel: relative(dir, full).split(sep).join('/'), size: st.size, content: readFileSync(full) });
        } catch {
          continue;
        }
      }
    }
  };
  walk(dir);
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = createHash('sha256');
  hash.update(`${FINGERPRINT_ALGO}|${entries.length}`);
  let totalBytes = 0;
  for (const e of entries) {
    totalBytes += e.size;
    hash.update(`${e.rel}:${e.size}\n`);
    hash.update(e.content);
  }
  return { algo: FINGERPRINT_ALGO, fingerprint: hash.digest('hex').slice(0, 16), files: entries.length, totalBytes };
}
