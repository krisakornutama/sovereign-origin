// src/services/node-kit.service.ts
//
// ── ชุดติดตั้ง "เครื่องใหม่แบบโนดเต็ม" ให้เครื่องลูกดึงจาก HUB ────────────
// เจ้าของสั่ง 12/10/69: "เอาจริงนะ ผมงงมากเลย เครื่องลูกไม่รู้จะรันไฟล์ไหน
//   เยอะซะเหลือเกิน ผมก็บอกให้ทำให้เป็นไฟล์ติดตั้งไฟล์เดียวก็ไม่ทำ"
//   ⇒ ตัวติดตั้งไฟล์เดียวต้องดึงชุดระบบ (~700 MB) มาจาก HUB เอง
//     ไม่ใช่ให้เจ้าของก๊อปทั้งโฟลเดอร์ไปเอง
//
// ต่างจากชุด desktop-update ยังไง:
//   desktop-update = artifact เดียว (portable .exe) · มีแล้วในระบบ
//   node-kit       = แตกเป็นโฟลเดอร์ (ต้องมีทั้ง compose, setup-*.bat, ระบบทั้งหมด)
//                    → จึงส่งเป็น archive ไฟล์เดียว (.zip) แล้วเครื่องลูกแตกเอง
//
// ที่เก็บ: core-api/data/node-kits/ (volume เดียวกับ agent-updates)
//   manifest.json  { version, generatedAt, asset: { name, sha256, size }, notes }
//   files/<name>   archive จริง
//
// ⚠️ ไฟล์ระดับร้อย MB: แฮชแบบสตรีม + จำผลไว้ต่อ (ขนาด+เวลาแก้) และตรวจกับ manifest ก่อนส่งทุกครั้ง
//    ⇒ ไฟล์ที่หาย/โดนแก้ = ไม่ส่งออก (fail-closed)
import fs from 'node:fs';
import path from 'node:path';
import { isSafeAssetName, hashFileStream } from './desktop-update.service';

export const NODE_KIT_ROOT =
  process.env.NODE_KIT_DIR || path.join(__dirname, '..', '..', 'data', 'node-kits');

export interface NodeKitAssetEntry {
  name: string;
  sha256: string;
  size: number;
}

export interface NodeKitManifest {
  version: string;
  generatedAt: string;
  asset: NodeKitAssetEntry;
  /**
   * สคริปต์ตัวติดตั้งไฟล์เดียว (~10 KB) — ไฟล์ .cmd ที่คนก๊อปไปเครื่องใหม่จะโหลดตัวนี้
   * มาก่อน แล้วค่อยดึงชุดติดตั้งตาม
   *   เหตุผลที่ต้องแยกออกมา: ไฟล์ .cmd ต้องเป็น ASCII ล้วน (กฎของโครงการ — ข้อความไทย
   *   ทำให้ cmd.exe พัง) แต่ข้อความที่คนอ่านต้องเป็นไทย ⇒ เก็บข้อความไทยไว้ในไฟล์นี้
   *   ที่เสิร์ฟเป็น UTF-8 แทน
   */
  bootstrap?: NodeKitAssetEntry | null;
  /** ขั้นตอนที่คนใช้ต้องทำหลังแตกเสร็จ (ให้ installer อ้างอิงได้ ไม่ต้องเดาเอง) */
  entrypoint?: string | null;
  /** ต้องมีโค้ดรหัสเชิญหรือไม่ — ถ้า false = HUB ยังไม่ได้เปิดให้ลงทะเบียน */
  enrollmentOpen?: boolean;
  notes?: string | null;
}

/**
 * อ่าน manifest — null เมื่อยังไม่เคยเผยแพร่ / ไฟล์เสีย / ค่าไม่ครบ
 * ใช้เงื่อนไขเดียวกับ desktop-update เพื่อให้ผู้ดูแลคาดเดาได้
 */
export function readNodeKitManifest(root: string = NODE_KIT_ROOT): NodeKitManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as NodeKitManifest;
    if (!raw?.version || !raw.asset) return null;
    const asset = raw.asset;
    if (!isSafeAssetName(asset.name)) return null;
    if (!/^[0-9a-f]{64}$/i.test(String(asset.sha256 ?? ''))) return null;
    if (!Number.isFinite(Number(asset.size)) || Number(asset.size) <= 0) return null;
    // bootstrap ไม่บังคับ — ชุดรุ่นเก่ายังใช้ได้ (ไฟล์ .cmd รุ่นก่อนดึงชุดตรง)
    //   แต่ถ้ามีใน manifest แล้วต้องถูกต้องเต็ม ไม่งั้นถือว่าไม่มี (ไม่เดาว่าใช้ได้)
    let bootstrap: NodeKitAssetEntry | null = null;
    if (raw.bootstrap != null) {
      const b = raw.bootstrap as NodeKitAssetEntry;
      const bOk =
        isSafeAssetName(String(b?.name ?? '')) &&
        /^[0-9a-f]{64}$/i.test(String(b?.sha256 ?? '')) &&
        Number.isFinite(Number(b?.size)) &&
        Number(b?.size) > 0;
      if (!bOk) return null;
      bootstrap = { name: String(b.name), sha256: String(b.sha256), size: Number(b.size) };
    }
    return {
      version: String(raw.version),
      generatedAt: String(raw.generatedAt ?? ''),
      asset,
      bootstrap,
      entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : null,
      // ห้ามเดา: ไม่มีฟิลด์นี้ = ถือว่าปิด (fail-closed) เครื่องลูกจะได้บอกชัด
      enrollmentOpen: raw.enrollmentOpen === true,
      notes: raw.notes ?? null,
    };
  } catch {
    return null;
  }
}

/** หาไฟล์ archive จริง — null ถ้าไม่อยู่ใน manifest หรือไฟล์หายจากดิสก์ */
export function resolveNodeKitAsset(
  root: string = NODE_KIT_ROOT,
  manifest: NodeKitManifest | null = readNodeKitManifest(root),
): { abs: string; entry: NodeKitAssetEntry } | null {
  if (!manifest) return null;
  const abs = path.join(root, 'files', manifest.asset.name);
  if (!fs.existsSync(abs)) return null;
  return { abs, entry: manifest.asset };
}

/** หาไฟล์สคริปต์ตัวติดตั้งไฟล์เดียว — null ถ้ายังไม่มี/ไฟล์หาย */
export function resolveNodeKitBootstrap(
  root: string = NODE_KIT_ROOT,
  manifest: NodeKitManifest | null = readNodeKitManifest(root),
): { abs: string; entry: NodeKitAssetEntry } | null {
  if (!manifest?.bootstrap) return null;
  const abs = path.join(root, 'files', manifest.bootstrap.name);
  if (!fs.existsSync(abs)) return null;
  return { abs, entry: manifest.bootstrap };
}

/** ผลแฮชที่จำไว้ต่อไฟล์ — กุญแจคือขนาด+เวลาแก้ (ไฟล์ใหม่ = แฮชใหม่) */
const hashCache = new Map<string, { key: string; sha256: string }>();

/**
 * ยืนยันไฟล์ที่อยู่ใต้ data/node-kits/files ว่าตรงกับรายการใน manifest ก่อนส่งออก
 * คืน null ถ้าไฟล์หาย/ขนาดไม่ตรง/แฮชไม่ตรง (fail-closed — ไม่เดาว่าไฟล์เดิมยังใช้ได้)
 */
export async function verifyPublishedFile(
  abs: string,
  entry: NodeKitAssetEntry,
  label: string,
): Promise<boolean> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return false;
  }
  if (stat.size !== Number(entry.size)) {
    console.error(`[node-kit] ขนาด ${label} ไม่ตรง manifest — ให้ประกอบใหม่`);
    return false;
  }
  const key = `${stat.size}|${stat.mtimeMs}`;
  const cached = hashCache.get(abs);
  let sha256 = cached?.key === key ? cached.sha256 : '';
  if (!sha256) {
    try {
      sha256 = await hashFileStream(abs);
    } catch (err) {
      console.error(`[node-kit] แฮช ${label} ไม่สำเร็จ:`, err instanceof Error ? err.message : err);
      return false;
    }
    hashCache.set(abs, { key, sha256 });
  }
  if (sha256 !== String(entry.sha256).toLowerCase()) {
    console.error(`[node-kit] แฮช ${label} บนดิสก์ไม่ตรง manifest — ไม่ส่งออก`);
    return false;
  }
  return true;
}

/**
 * ยืนยันว่า "ไฟล์บนดิสก์ยังตรงกับ manifest" ก่อนปล่อยให้ส่งออก
 * คืน null เมื่อไฟล์หาย/ขนาดไม่ตรง/แฮชไม่ตรง ⇒ ผู้เรียกตอบ 404
 */
export async function resolveVerifiedNodeKitAsset(
  root: string = NODE_KIT_ROOT,
  manifest: NodeKitManifest | null = readNodeKitManifest(root),
): Promise<{ abs: string; entry: NodeKitAssetEntry; sha256: string } | null> {
  const found = resolveNodeKitAsset(root, manifest);
  if (!found) return null;
  if (!(await verifyPublishedFile(found.abs, found.entry, found.entry.name))) return null;
  return { abs: found.abs, entry: found.entry, sha256: found.entry.sha256 };
}

/**
 * สคริปต์ตัวติดตั้งไฟล์เดียว พร้อมยืนยันแฮช — ไฟล์ .cmd ที่คนก๊อปไปเครื่องใหม่เรียกตัวนี้
 * คืน null เมื่อยังไม่ได้ประกอบ/ไฟล์หาย/แฮชไม่ตรง
 */
export async function resolveVerifiedBootstrap(
  root: string = NODE_KIT_ROOT,
  manifest: NodeKitManifest | null = readNodeKitManifest(root),
): Promise<{ abs: string; entry: NodeKitAssetEntry } | null> {
  const found = resolveNodeKitBootstrap(root, manifest);
  if (!found) return null;
  if (!(await verifyPublishedFile(found.abs, found.entry, found.entry.name))) return null;
  return found;
}

/**
 * แถวที่ client ต้องการจริง (ไม่คืนพาธบนดิสก์ — เผยรายละเอียดเครื่องเกิน)
 * HUB ที่ต่างกัน/โฟลเดอร์ว่าง = คนละทาง ⇒ คืน assetUrl ว่างให้ client ประกอบเอง
 */
export function nodeKitManifestForClient(
  manifest: NodeKitManifest | null,
  assetUrl: string,
): Record<string, unknown> | null {
  if (!manifest) return null;
  const bootstrapUrl = manifest.bootstrap ? assetUrl.replace(/\/asset$/, '/bootstrap') : '';
  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    asset: { name: manifest.asset.name, sha256: manifest.asset.sha256, size: manifest.asset.size },
    assetUrl,
    // ไฟล์ .cmd เรียกตัวนี้ก่อน (ดูไฟล์ .ps1 ต้องเป็น UTF-8 ส่วน .cmd ต้อง ASCII)
    bootstrapUrl,
    bootstrapSha256: manifest.bootstrap?.sha256 ?? null,
    bootstrapSize: manifest.bootstrap?.size ?? null,
    entrypoint: manifest.entrypoint ?? 'SETUP-NODE.cmd',
    enrollmentOpen: manifest.enrollmentOpen,
    notes: manifest.notes ?? null,
  };
}

/** สรุปสำหรับดีบัก/หน้าเว็บ (ไม่คืนเนื้อไฟล์) */
export function nodeKitSummary(root: string = NODE_KIT_ROOT) {
  const manifest = readNodeKitManifest(root);
  if (!manifest) {
    return {
      published: false as const,
      root,
      hint: 'ยังไม่ได้เผยแพร่ชุดติดตั้งเครื่องใหม่ — รัน: node tools/build-node-kit.mjs --publish',
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
    bootstrap: manifest.bootstrap
      ? { name: manifest.bootstrap.name, bytes: manifest.bootstrap.size, sha256: manifest.bootstrap.sha256 }
      : null,
    enrollmentOpen: manifest.enrollmentOpen,
    entrypoint: manifest.entrypoint ?? 'SETUP-NODE.cmd',
    notes: manifest.notes ?? null,
  };
}