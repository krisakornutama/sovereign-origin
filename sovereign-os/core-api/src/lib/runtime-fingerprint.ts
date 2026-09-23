// src/lib/runtime-fingerprint.ts
//
// RUNTIME FINGERPRINT — ความจริงฉบับเดียวว่า "โปรเซสที่รันอยู่ มาจากโค้ดชุดไหน"
// (Phase 0 arch-hardening — เคสจริง 23 ก.ย. 2026: prod รัน build 21 ก.ย. ทั้งที่โค้ดใหม่มา 2 วัน
//  และไม่มีช่องทางเทียบ "โค้ดบนดิสก์ vs ที่โปรเซสโหลดอยู่")
//
// หลักการ:
// - fingerprint = sha256 ของ { path + size + เนื้อไฟล์ } ทุกไฟล์ในโฟลเดอร์ที่โปรเซสนี้โหลด (sort ก่อนเสมอ)
//   → **content-based**: build ซ้ำจากซอร์สเดิมได้ค่าเดิม (ไม่แกว่งตาม mtime) — เทียบดิสก์ vs คอนเทนเนอร์ได้จริง
// - คำนวณครั้งเดียวตอน request แรกแล้วแคช — โค้ดที่โหลดแล้วไม่เปลี่ยนกลางอากาศ
// - คู่ตรงข้ามฝั่ง tools: tools/fingerprint-lib.mjs (อัลกอริทึมเดียวกันทุกไบต์) + tools/prod-truth.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const FINGERPRINT_ALGO = 'fp-v1-sha256';

export interface DirFingerprint {
  algo: string;
  fingerprint: string;
  files: number;
  totalBytes: number;
}

/** hash รายการ path+size+เนื้อไฟล์ ทั้ง dir (recursive, ข้าม symlink) — deterministic ทุกครั้ง */
export async function computeDirFingerprint(dir: string): Promise<DirFingerprint> {
  const entries: Array<{ rel: string; size: number; content: Buffer }> = [];

  async function walk(current: string): Promise<void> {
    let list: string[];
    try {
      list = await readdir(current);
    } catch {
      return; // อ่านไม่ได้ = ข้ามโฟลเดอร์นั้น
    }
    for (const name of list) {
      const full = join(current, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // symlink ไม่นับ — กันวนวง / กันนับของนอกโฟลเดอร์
      if (st.isDirectory()) {
        await walk(full);
      } else if (st.isFile()) {
        try {
          const content = await readFile(full);
          entries.push({ rel: relative(dir, full).split(sep).join('/'), size: st.size, content });
        } catch {
          continue; // อ่านไฟล์ไม่ได้ชั่วคราว (build ค้างเขียน) = ข้าม
        }
      }
    }
  }

  await walk(dir);
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

/** โฟลเดอร์ที่ "โปรเซสนี้โหลดจริง": prod = dist (dist/lib/*.js → dist) · dev (tsx) = src (src/lib/*.ts → src) */
export function getLoadedCodeDir(): string {
  return join(__dirname, '..');
}

/** ป้ายโหมดโหลดสำหรับ health/diag — 'dist' (prod build) หรือ 'src' (tsx dev) */
export function getLoadedCodeDirLabel(): string {
  const parts = getLoadedCodeDir().split(sep);
  return parts[parts.length - 1] === 'dist' ? 'dist' : 'src';
}

let cached: DirFingerprint | null = null;

/** fingerprint ของโค้ดที่โปรเซสนี้รันอยู่ (แคชหลังครั้งแรก) */
export async function getSelfFingerprint(): Promise<DirFingerprint> {
  if (!cached) cached = await computeDirFingerprint(getLoadedCodeDir());
  return cached;
}
