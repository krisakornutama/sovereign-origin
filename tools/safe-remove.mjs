// tools/safe-remove.mjs — ด่านกันพลาดก่อนลบ/ย้ายของที่ระบบยังพึ่งพา
//
// ของจริง 10/10/69: สคริปต์คัดของเสนอ "ลบ tools\Git" แล้วลบจริง (ได้ครึ่งเดียวเพราะไฟล์ถูกล็อก)
// ผลคือเครื่องนี้ไม่มี git เหลือเลย *และ* terminal ของแอปตายทั้งตัว เพราะ shell resolve ไปที่
// tools\Git\bin\bash.exe ⇒ ทุกคำสั่งตอบ  Top-level not found: ...\tools\Git\bin
//
// กติกาของโมดูลนี้:
//   1) ไม่มี "ลบตรง ๆ" — ของที่ผ่านด่านจะถูก *ย้ายเข้า archive* เสมอ (กู้คืนได้)
//   2) ปฏิเสธเมื่อยังมีอะไรอ้างถึง: PATH/PATHEXT ของเครื่อง, สิ่งที่ผู้เรียกระบุเอง
//      (เช่น terminal ของแอป), ไฟล์ที่ยังถูก process เปิดอยู่
//   3) ปฏิเสธเมื่อไม่มี "ของใช้แทนได้" — ลบแล้วระบบต้องไม่ขาดความสามารถนั้น
import fs from 'node:fs';
import path from 'node:path';

/** เทียบพาธแบบ Windows: absolute + ไม่สนตัวพิมพ์ + ไม่เอา trailing separator */
export const nrm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();

/** true ถ้า child อยู่ใต้ parent (หรือเท่ากัน) */
export function isInside(parent, child) {
  const p = nrm(parent);
  const c = nrm(child);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/**
 * โฟลเดอร์นี้ (หรือโฟลเดอร์ย่อยของมัน) ถูกอ้างใน PATH/PATHEXT ของ env ไหม
 * ⇒ ถ้าใช่ แปลว่ามีใครบางคน resolve โปรแกรมจากตรงนั้นอยู่ (terminal, task, launcher)
 */
export function referencedByPathEnv(target, env = process.env) {
  const t = nrm(target);
  const hits = [];
  for (const key of ['PATH', 'Path', 'path', 'PATHEXT', 'Pathext']) {
    const value = env[key];
    if (!value) continue;
    for (const raw of String(value).split(path.delimiter)) {
      const part = raw.trim().replace(/^"|"$/g, '');
      if (!part) continue;
      const p = nrm(part);
      if (p === t) hits.push(`${key} ชี้ตรงที่ ${part}`);
      else if (p.startsWith(t + path.sep)) hits.push(`${key} ชี้ที่โฟลเดอร์ย่อย ${part}`);
    }
  }
  return [...new Set(hits)];
}

/**
 * มีไฟล์ในโฟลเดอร์ที่ยังถูก process เปิดอยู่ไหม — ทดสอบด้วยการ rename ไปชื่อข้าง ๆ แล้วคืนชื่อเดิม
 * (ลบโฟลเดอร์ที่มีไฟล์ถูกล็อกจะได้ครึ่ง ๆ กลาง ๆ ซึ่งเป็นสาเหตุของ incident นี้)
 */
export function hasLockedFiles(target) {
  if (!fs.existsSync(target)) return false;
  const probe = `${target}.lockprobe-${process.pid}`;
  try {
    fs.renameSync(target, probe);
    fs.renameSync(probe, target);
    return false;
  } catch {
    try { if (fs.existsSync(probe) && !fs.existsSync(target)) fs.renameSync(probe, target); } catch { /* คืนไม่ได้ — ปล่อย */ }
    return true;
  }
}

/**
 * ตัดสินว่าลบ/ย้าย path นี้ได้ไหม
 * @param {string} target
 * @param {{
 *   env?: Record<string,string>,
 *   references?: Array<{what: string, detail: string}>,
 *   alternatives?: string[],
 *   lockProbe?: (target: string) => boolean,
 *   force?: boolean,
 * }} opts
 *   references   — สิ่งที่ผู้เรียกรู้อยู่แล้วว่าอ้างถึง path นี้ (เช่น shell ของ terminal)
 *   alternatives — ของที่ใช้แทนได้จริง ณ ตอนนี้ (ผู้เรียกรับรองว่า "รันได้" แล้ว)
 *   lockProbe    — ฉีดเข้ามาแทนการลอง rename จริงได้ (สำหรับเทสต์)
 */
export function removalVerdict(target, opts = {}) {
  const {
    env = process.env,
    references = [],
    alternatives = [],
    lockProbe = hasLockedFiles,
    force = false,
  } = opts;

  const blocked = [];
  const notes = [];

  if (!fs.existsSync(target)) {
    return { exists: false, allowed: false, target, blocked: ['ไม่พบ path นี้อยู่แล้ว'], notes };
  }
  if (isInside(target, path.resolve('.'))) {
    // กันเรียกพลาดจนไปลบโฟลเดอร์ที่ตัวเองยืนอยู่
    notes.push('ปลายทางเป็นโฟลเดอร์แม่ของ cwd ปัจจุบัน');
  }

  for (const hit of referencedByPathEnv(target, env)) blocked.push(`ยังถูกอ้างถึง: ${hit}`);
  for (const r of references) blocked.push(`ยังถูกอ้างถึงโดย ${r.what}${r.detail ? ` (${r.detail})` : ''}`);
  if (alternatives.length === 0) blocked.push('ไม่พบของใช้แทนได้ — เอาออกแล้วระบบจะขาดความสามารถนั้น');
  if (lockProbe(target)) blocked.push('มีไฟล์ที่ยังถูก process เปิดอยู่ (rename ไม่ผ่าน) — ลบตรง ๆ จะได้ครึ่ง ๆ กลาง ๆ');

  if (force) {
    notes.push('force: ผู้เรียกระบุว่ายอมรับความเสี่ยงนี้เอง');
    return { exists: true, allowed: true, target, blocked, notes };
  }
  return { exists: true, allowed: blocked.length === 0, target, blocked, notes };
}

/**
 * ย้ายเข้า archive แทนการลบ — และปฏิเสธเมื่อด่านไม่อนุญาต
 * @returns {{removed: boolean, archivedTo: string|null, verdict: object}}
 */
export function removeOrArchive(target, { archiveRoot, label = path.basename(target), ...opts } = {}) {
  const verdict = removalVerdict(target, opts);
  if (!verdict.exists || !verdict.allowed) return { removed: false, archivedTo: null, verdict };
  if (!archiveRoot) throw new Error('removeOrArchive ต้องการ archiveRoot (ของที่ย้ายต้องกู้คืนได้)');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dest = path.join(archiveRoot, label, `${label}-${stamp}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    fs.renameSync(target, dest);
  } catch {
    fs.cpSync(target, dest, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
  return { removed: true, archivedTo: dest, verdict };
}
