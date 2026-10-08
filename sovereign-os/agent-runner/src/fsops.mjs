// src/fsops.mjs — แตะไฟล์บนเครื่องนี้ตามคำสั่งจากหน้าเว็บ (ผ่าน HUB)
//
// ขอบเขตที่เจ้าของเลือกไว้: **อ่าน-เขียนได้ทั้งไดรฟ์** และจำกัดสิทธิ์ที่ HUB
// (SUPERADMIN เท่านั้น + บันทึก audit ทุกคำสั่งที่เปลี่ยนไฟล์)
//
// ยังมีเบรกมือให้รัดเพิ่มได้โดยไม่ต้องแก้โค้ด: ตั้ง `REMOTE_FS_ROOTS` ใน .env
// ของเครื่องนี้ (คั่นด้วย `;` บน Windows) ⇒ จำกัดเฉพาะโฟลเดอร์ที่ระบุ
//
// หลักการ:
// - ทุกฟังก์ชันคืน { ok, ... } หรือ { ok:false, error } — ห้าม throw ออกไป
//   เพราะผู้ใช้ต้องเห็นสาเหตุจริง (ไม่มีสิทธิ์/ไม่พบไฟล์/ดิสก์เต็ม) ไม่ใช่ \"ค้าง\"
// - เพดานขนาดอ่าน/เขียนกันไม่ให้ไฟล์ 2 GB ถูกยัดเข้า JSON แล้วทำหน่วยความจำระเบิด
import { promises as fsp } from 'node:fs';
import path from 'node:path';

/** เพดานขนาดไฟล์ที่อ่าน/เขียนผ่านช่องนี้ได้ (เกินนี้ต้องไปดึงด้วยวิธีอื่น) */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** จำนวนรายการสูงสุดที่คืนในหนึ่งครั้ง — โฟลเดอร์ที่มีแสนไฟล์ต้องไม่ทำเบราว์เซอร์ตาย */
export const MAX_DIR_ENTRIES = 2000;

/** อ่านค่า REMOTE_FS_ROOTS จาก env → รายการโฟลเดอร์ที่อนุญาต (ว่าง = ทั้งไดรฟ์) */
export function resolveAllowedRoots(env = process.env) {
  const raw = String(env?.REMOTE_FS_ROOTS ?? '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
}

/** ตรวจว่า path อยู่ในขอบเขตที่อนุญาต (ว่าง = อนุญาตทั้งหมด) */
export function isAllowedPath(target, roots = []) {
  if (!roots.length) return true;
  const resolved = path.resolve(target);
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/** ข้อผิดพลาดเป็นข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง — ไม่ใช่ stack trace ของ Node */
function describeError(err, target) {
  const code = err?.code;
  if (code === 'ENOENT') return `ไม่พบ: ${target}`;
  if (code === 'EACCES' || code === 'EPERM') return `ไม่มีสิทธิ์เข้าถึง: ${target}`;
  if (code === 'EISDIR') return `เป็นโฟลเดอร์ ไม่ใช่ไฟล์: ${target}`;
  if (code === 'ENOTDIR') return `ไม่ใช่โฟลเดอร์: ${target}`;
  if (code === 'ENOTEMPTY') return `โฟลเดอร์ไม่ว่าง — ต้องสั่งลบแบบ recursive: ${target}`;
  if (code === 'EBUSY') return `ไฟล์ถูกใช้งานอยู่: ${target}`;
  if (code === 'ENOSPC') return 'ดิสก์เต็ม';
  return `${err?.message || err}`;
}

/** เดาชนิดไฟล์ว่าเป็นข้อความหรือไบนารี (มี NUL = ไบนารี ตามธรรมเนียมของ git) */
export function looksBinary(buffer) {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i += 1) if (buffer[i] === 0) return true;
  return false;
}

/** รายการในโฟลเดอร์ — เรียงโฟลเดอร์ก่อน แล้วตามด้วยชื่อ */
export async function listDir(target, { roots = [] } = {}) {
  if (!target || typeof target !== 'string') return { ok: false, error: 'ต้องระบุ path' };
  const resolved = path.resolve(target);
  if (!isAllowedPath(resolved, roots)) return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };

  try {
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const out = [];
    for (const entry of entries.slice(0, MAX_DIR_ENTRIES)) {
      const full = path.join(resolved, entry.name);
      let size = null;
      let mtime = null;
      try {
        const st = await fsp.stat(full);
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        // ไฟล์ที่ stat ไม่ได้ (เช่น symlink ปลายทางหาย) ยังต้องแสดงให้เห็นว่ามีอยู่
      }
      out.push({
        name: entry.name,
        isDir: entry.isDirectory(),
        size,
        mtime,
        path: full,
      });
    }
    out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return {
      ok: true,
      path: resolved,
      parent: path.dirname(resolved) === resolved ? null : path.dirname(resolved),
      entries: out,
      truncated: entries.length > MAX_DIR_ENTRIES,
    };
  } catch (err) {
    return { ok: false, error: describeError(err, resolved) };
  }
}

/**
 * อ่านไฟล์ — คืน { text } สำหรับไฟล์ข้อความ หรือ { base64 } สำหรับไบนารี
 * ผู้ใช้เลือกบังคับได้ด้วย encoding: 'text' | 'base64'
 */
export async function readFile(target, { roots = [], encoding = 'auto', maxBytes = MAX_FILE_BYTES } = {}) {
  if (!target || typeof target !== 'string') return { ok: false, error: 'ต้องระบุ path' };
  const resolved = path.resolve(target);
  if (!isAllowedPath(resolved, roots)) return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };

  try {
    const st = await fsp.stat(resolved);
    if (st.isDirectory()) return { ok: false, error: `เป็นโฟลเดอร์ ไม่ใช่ไฟล์: ${resolved}` };
    if (st.size > maxBytes) {
      return { ok: false, error: `ไฟล์ใหญ่ ${st.size} bytes เกินเพดาน ${maxBytes} bytes` };
    }
    const buffer = await fsp.readFile(resolved);
    const asBinary = encoding === 'base64' || (encoding === 'auto' && looksBinary(buffer));
    const base = { ok: true, path: resolved, size: buffer.length, mtime: st.mtime.toISOString() };
    if (asBinary) return { ...base, base64: buffer.toString('base64'), binary: true };
    return { ...base, text: buffer.toString('utf8'), binary: false };
  } catch (err) {
    return { ok: false, error: describeError(err, resolved) };
  }
}

/** เขียนไฟล์ — รับ text หรือ base64, สร้างโฟลเดอร์พ่อให้ถ้ายังไม่มี */
export async function writeFile(target, { roots = [], text, base64, maxBytes = MAX_FILE_BYTES } = {}) {
  if (!target || typeof target !== 'string') return { ok: false, error: 'ต้องระบุ path' };
  const resolved = path.resolve(target);
  if (!isAllowedPath(resolved, roots)) return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };

  let buffer;
  if (typeof base64 === 'string') {
    buffer = Buffer.from(base64, 'base64');
  } else if (typeof text === 'string') {
    buffer = Buffer.from(text, 'utf8');
  } else {
    return { ok: false, error: 'ต้องส่ง text หรือ base64 มาอย่างใดอย่างหนึ่ง' };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, error: `เนื้อหาใหญ่ ${buffer.length} bytes เกินเพดาน ${maxBytes} bytes` };
  }

  try {
    await fsp.mkdir(path.dirname(resolved), { recursive: true });
    await fsp.writeFile(resolved, buffer);
    return { ok: true, path: resolved, bytes: buffer.length };
  } catch (err) {
    return { ok: false, error: describeError(err, resolved) };
  }
}

export async function makeDir(target, { roots = [] } = {}) {
  if (!target || typeof target !== 'string') return { ok: false, error: 'ต้องระบุ path' };
  const resolved = path.resolve(target);
  if (!isAllowedPath(resolved, roots)) return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };
  try {
    await fsp.mkdir(resolved, { recursive: true });
    return { ok: true, path: resolved };
  } catch (err) {
    return { ok: false, error: describeError(err, resolved) };
  }
}

/**
 * ลบไฟล์/โฟลเดอร์
 * โฟลเดอร์ต้องส่ง recursive: true มาชัด ๆ — กันการลบต้นไม้ทั้งต้นด้วยการพิมพ์ผิด
 */
export async function removePath(target, { roots = [], recursive = false } = {}) {
  if (!target || typeof target !== 'string') return { ok: false, error: 'ต้องระบุ path' };
  const resolved = path.resolve(target);
  if (!isAllowedPath(resolved, roots)) return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };
  // กันการลบรากของไดรฟ์/โฟลเดอร์ทำงานโดยอุบัติเหตุ
  if (resolved === path.dirname(resolved)) return { ok: false, error: `ปฏิเสธการลบรากของไดรฟ์: ${resolved}` };

  try {
    const st = await fsp.stat(resolved);
    if (st.isDirectory()) {
      if (!recursive) {
        await fsp.rmdir(resolved); // ลบได้เฉพาะโฟลเดอร์ว่าง
        return { ok: true, path: resolved, removed: 'dir' };
      }
      await fsp.rm(resolved, { recursive: true, force: false });
      return { ok: true, path: resolved, removed: 'dir-tree' };
    }
    await fsp.unlink(resolved);
    return { ok: true, path: resolved, removed: 'file' };
  } catch (err) {
    return { ok: false, error: describeError(err, resolved) };
  }
}

/** ย้าย/เปลี่ยนชื่อ — ปลายทางต้องไม่มีอยู่แล้ว (กันการทับไฟล์โดยไม่ตั้งใจ) */
export async function renamePath(from, to, { roots = [] } = {}) {
  if (!from || !to) return { ok: false, error: 'ต้องระบุ from และ to' };
  const resolvedFrom = path.resolve(from);
  const resolvedTo = path.resolve(to);
  if (!isAllowedPath(resolvedFrom, roots) || !isAllowedPath(resolvedTo, roots)) {
    return { ok: false, error: 'path นอกขอบเขตที่อนุญาต (REMOTE_FS_ROOTS)' };
  }
  try {
    // ⚠️ Windows ต่างจาก POSIX ตรงนี้: `fs.rename` **ทับไฟล์ปลายทางให้เงียบ ๆ**
    //   ⇒ ต้องเช็คเองว่าไม่มีอยู่ก่อน ไม่งั้นชื่อไฟล์ที่พิมพ์ผิดจะลบงานเดิมทิ้งโดยไม่ถาม
    //   (ช่องว่างที่เหลือ: ระหว่างเช็คกับ rename มีคู่แข่งแทรกได้ — ยอมรับได้เพราะ
    //    คำสั่งมาจากคนทีละคำสั่ง ไม่ใช่ลูปที่ชนกันเอง)
    let exists = true;
    try {
      await fsp.stat(resolvedTo);
    } catch (err) {
      if (err?.code === 'ENOENT') exists = false;
      else throw err;
    }
    if (exists) return { ok: false, error: `ปลายทางมีอยู่แล้ว: ${resolvedTo}` };

    await fsp.rename(resolvedFrom, resolvedTo);
    return { ok: true, from: resolvedFrom, to: resolvedTo };
  } catch (err) {
    if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
      return { ok: false, error: `ปลายทางมีอยู่แล้วหรือเขียนทับไม่ได้: ${resolvedTo}` };
    }
    return { ok: false, error: describeError(err, resolvedFrom) };
  }
}

/**
 * ตัวจัดการคำสั่งจาก HUB — รับ command { type, payload } แล้วเรียกฟังก์ชันที่ตรง
 * คืน { ok, ... } เสมอ (ไม่ throw) ⇒ runner รายงานผลกลับได้ทุกกรณี
 */
export async function runFsCommand(command, { roots = [] } = {}) {
  const type = String(command?.type ?? '');
  const p = command?.payload ?? {};
  switch (type) {
    case 'fs.list':
      return await listDir(p.path, { roots });
    case 'fs.read':
      return await readFile(p.path, { roots, encoding: p.encoding });
    case 'fs.write':
      return await writeFile(p.path, { roots, text: p.text, base64: p.base64 });
    case 'fs.mkdir':
      return await makeDir(p.path, { roots });
    case 'fs.delete':
      return await removePath(p.path, { roots, recursive: p.recursive === true });
    case 'fs.rename':
      return await renamePath(p.from, p.to, { roots });
    default:
      return { ok: false, error: `ไม่รู้จักคำสั่งไฟล์: ${type || '(ว่าง)'}` };
  }
}
