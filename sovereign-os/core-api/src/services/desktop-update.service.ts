// src/services/desktop-update.service.ts
//
// ── ชุดอัปเดต "แอปเดสก์ท็อป" (Sovereign OS / Electron) ให้เครื่องลูกดึงจาก HUB ─────
// เจ้าของสั่ง 11/10/69: "ผมไม่ได้หมายถึงเว็บ ผมหมายถึง app desktop ที่จะไปติดตั้งอีกเครื่อง"
// และเลือกให้ HUB เป็นแหล่งอัปเดตของแอป (เครื่องปลายทางถาม HUB ก่อน แล้วค่อยตกไป GitHub)
//
// ต่างจากชุด runner (agent-update.service.ts):
//   runner = ไฟล์โค้ดหลายไฟล์เล็ก ๆ → อัปเดตทีละไฟล์ได้
//   แอปเดสก์ท็อป = ไฟล์เดียว (portable .exe ที่มี runtime + overlay + sidecar API + หน้าเว็บ
//   static อยู่ในตัว) → ชุดอัปเดต = artifact เดียว + แฮช SHA-256
//   เครื่องปลายทางดาวน์โหลดทั้งไฟล์ ตรวจแฮช (fail-closed) แล้วเปิดตัวติดตั้ง — พฤติกรรมเดิมของแอป
//
// ที่เก็บ: core-api/data/desktop-updates/ (volume เดียวกับ agent-updates ⇒ ไม่ต้องแก้ compose)
//   manifest.json  { version, generatedAt, asset: { name, sha256, size }, notes }
//   files/<name>   ไฟล์ตัวติดตั้งจริง (ให้บริการผ่าน route เท่านั้น)
//
// ตัวเขียนชุด = PACK-DESKTOP.mjs ของโฟลเดอร์ติดตั้ง (รันที่ HUB) — ไม่มีสูตรซ้ำในโค้ดนี้
//
// ⚠️ ไฟล์ระดับร้อย MB: ห้ามอ่านทั้งก้อนเข้า memory และห้ามแฮชซ้ำทุกครั้งที่เครื่องมาถาม
//    ⇒ แฮชแบบสตรีม + จำผลไว้ต่อ (ขนาด + เวลาแก้) และตรวจกับ manifest ก่อนส่งออกทุกครั้ง
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DESKTOP_UPDATE_ROOT =
  process.env.DESKTOP_UPDATE_DIR || path.join(__dirname, '..', '..', 'data', 'desktop-updates');

export interface DesktopAssetEntry {
  name: string;
  sha256: string;
  size: number;
}

export interface DesktopUpdateManifest {
  version: string;
  generatedAt: string;
  asset: DesktopAssetEntry;
  notes?: string | null;
}

/** ชื่อไฟล์ตัวติดตั้งที่ปลอดภัย: ชื่อไฟล์เดี่ยว ไม่มีเส้นทาง/ไดรฟ์/.. */
export function isSafeAssetName(name: unknown): name is string {
  if (typeof name !== 'string' || !name.trim()) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/** อ่าน manifest ที่ตัวประกอบเขียนไว้ — คืน null เมื่อยังไม่เคยเผยแพร่/ไฟล์เสีย/ค่าไม่ครบ */
export function readDesktopManifest(root: string = DESKTOP_UPDATE_ROOT): DesktopUpdateManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as DesktopUpdateManifest;
    if (!raw?.version || !raw.asset) return null;
    const asset = raw.asset;
    if (!isSafeAssetName(asset.name)) return null;
    if (!/^[0-9a-f]{64}$/i.test(String(asset.sha256 ?? ''))) return null;
    if (!Number.isFinite(Number(asset.size)) || Number(asset.size) <= 0) return null;
    return { version: String(raw.version), generatedAt: String(raw.generatedAt ?? ''), asset, notes: raw.notes ?? null };
  } catch {
    return null;
  }
}

/** หาไฟล์จริงของชุดอัปเดต — null ถ้าไม่อยู่ใน manifest หรือไฟล์หายจากดิสก์ */
export function resolveDesktopAsset(
  root: string = DESKTOP_UPDATE_ROOT,
  manifest: DesktopUpdateManifest | null = readDesktopManifest(root),
): { abs: string; entry: DesktopAssetEntry } | null {
  if (!manifest) return null;
  const abs = path.join(root, 'files', manifest.asset.name);
  if (!fs.existsSync(abs)) return null;
  return { abs, entry: manifest.asset };
}

/** แฮช SHA-256 แบบสตรีม — ไม่โหลดทั้งไฟล์เข้า memory */
export function hashFileStream(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(abs);
    s.on('data', (chunk) => h.update(chunk));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** ผลแฮชที่จำไว้ต่อไฟล์ — กุญแจคือขนาด+เวลาแก้ (ไฟล์ถูกเผยแพร่ใหม่ = แฮชใหม่) */
const hashCache = new Map<string, { key: string; sha256: string }>();

/**
 * หาไฟล์ + ยืนยันว่า "บนดิสก์ยังตรงกับ manifest" ก่อนปล่อยให้ส่งออก
 * คืน null เมื่อไฟล์หาย/ขนาดไม่ตรง/แฮชไม่ตรง (ผู้เรียกตอบ 404 หรือ 500 ตามบริบท)
 */
export async function resolveVerifiedDesktopAsset(
  root: string = DESKTOP_UPDATE_ROOT,
  manifest: DesktopUpdateManifest | null = readDesktopManifest(root),
): Promise<{ abs: string; entry: DesktopAssetEntry; sha256: string } | null> {
  const found = resolveDesktopAsset(root, manifest);
  if (!found) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(found.abs);
  } catch {
    return null;
  }
  if (stat.size !== Number(found.entry.size)) {
    console.error('[desktop-update] ขนาดไฟล์ไม่ตรง manifest — เผยแพร่ใหม่');
    return null;
  }
  const key = `${stat.size}|${stat.mtimeMs}`;
  const cached = hashCache.get(found.abs);
  let sha256 = cached?.key === key ? cached.sha256 : '';
  if (!sha256) {
    try {
      sha256 = await hashFileStream(found.abs);
    } catch (err) {
      console.error('[desktop-update] แฮชไฟล์ไม่สำเร็จ:', err instanceof Error ? err.message : err);
      return null;
    }
    hashCache.set(found.abs, { key, sha256 });
  }
  if (sha256 !== String(found.entry.sha256).toLowerCase()) {
    console.error('[desktop-update] แฮชไฟล์บนดิสก์ไม่ตรง manifest — ไม่ส่งออก');
    return null;
  }
  return { abs: found.abs, entry: found.entry, sha256 };
}

/** สรุปสั้น ๆ ให้หน้าเว็บ/ดีบัก (ไม่คืนเนื้อไฟล์) */
export function desktopUpdateSummary(root: string = DESKTOP_UPDATE_ROOT) {
  const manifest = readDesktopManifest(root);
  if (!manifest) {
    return {
      published: false as const,
      root,
      hint: 'ประกอบแอปเดสก์ท็อปที่ HUB:  BUILD-DESKTOP.cmd  แล้วรัน  node PACK-DESKTOP.mjs --publish',
    };
  }
  return {
    published: true as const,
    root,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    assetName: manifest.asset.name,
    assetBytes: manifest.asset.size,
    assetSha256: manifest.asset.sha256,
    notes: manifest.notes ?? null,
  };
}
